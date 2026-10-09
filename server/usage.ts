import { gte, sql } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { z } from "zod";

import { usageDaily } from "../drizzle/schema";
import { SUPPORTED_CITIES } from "./cities";
import { getDb } from "./db";
import { applyCorsHeaders, clientIpKey, createRateLimiter } from "./_core/security";

/**
 * Statistiques d'usage anonymes : l'application envoie des compteurs (ouverture, recherche, fiche
 * consultée, appel, itinéraire) que le serveur additionne par jour, ville et événement. Ni
 * identifiant, ni position, ni texte recherché ne sont reçus ou enregistrés.
 */
export const USAGE_EVENTS = ["app_open", "search", "place_view", "call", "directions"] as const;
export type UsageEvent = (typeof USAGE_EVENTS)[number];

const usageBatchSchema = z.object({
  events: z
    .array(
      z.object({
        event: z.enum(USAGE_EVENTS),
        city: z.string().trim().max(96).optional(),
        /** Jour de l'événement (AAAA-MM-JJ), quand l'envoi a été différé hors connexion. */
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        count: z.number().int().min(1).max(50).default(1),
      }),
    )
    .min(1)
    .max(50),
});

const usageRateLimit = createRateLimiter({ name: "usage", windowMs: 60 * 60 * 1000, max: 120, key: clientIpKey, message: "Trop d'envois." });

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .trim();

/** Ville publiée correspondante ; les autres valeurs sont regroupées sous « » (non renseignée). */
export function usageCity(value: string | undefined) {
  if (!value) return "";
  const key = normalize(value);
  return SUPPORTED_CITIES.find((city) => normalize(city.name) === key)?.name ?? "";
}

/** Jour retenu : celui envoyé s'il date de moins d'une semaine, sinon aujourd'hui (UTC). */
export function usageDay(value: string | undefined, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (!value) return today;
  const age = now.getTime() - new Date(`${value}T00:00:00Z`).getTime();
  return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000 ? value : today;
}

/** Additionne un lot d'événements en compteurs (jour, ville, événement). */
export function aggregateUsage(events: z.infer<typeof usageBatchSchema>["events"], now = new Date()) {
  const counters = new Map<string, { day: string; city: string; event: UsageEvent; count: number }>();
  for (const item of events) {
    const row = { day: usageDay(item.day, now), city: usageCity(item.city), event: item.event, count: item.count };
    const key = `${row.day}|${row.city}|${row.event}`;
    const existing = counters.get(key);
    if (existing) existing.count += row.count;
    else counters.set(key, row);
  }
  return [...counters.values()];
}

export function registerUsageRoutes(app: Express) {
  app.post("/usage", usageRateLimit, async (req: Request, res: Response) => {
    applyCorsHeaders(req, res);
    const parsed = usageBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_USAGE_BATCH" });
      return;
    }
    const db = await getDb();
    if (!db) {
      res.status(202).json({ ok: false });
      return;
    }
    try {
      await db
        .insert(usageDaily)
        .values(aggregateUsage(parsed.data.events))
        .onDuplicateKeyUpdate({ set: { count: sql`${usageDaily.count} + values(${usageDaily.count})` } });
      res.status(202).json({ ok: true });
    } catch (error) {
      // Migration 0012 absente ou base indisponible : les statistiques sont perdues, l'application n'est pas gênée.
      console.warn("[Usage] Compteurs non enregistrés :", error instanceof Error ? error.message : error);
      res.status(202).json({ ok: false });
    }
  });
}

/** Statistiques sur les `days` derniers jours : totaux, série quotidienne et répartition par ville. */
export async function readUsageStats(days: number, now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const since = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db.select().from(usageDaily).where(gte(usageDaily.day, since));
  const empty = () => Object.fromEntries(USAGE_EVENTS.map((event) => [event, 0])) as Record<UsageEvent, number>;
  const totals = empty();
  const byDay = new Map<string, Record<UsageEvent, number>>();
  const byCity = new Map<string, Record<UsageEvent, number>>();
  for (let offset = days - 1; offset >= 0; offset -= 1) byDay.set(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), empty());
  for (const row of rows) {
    const event = row.event as UsageEvent;
    if (!USAGE_EVENTS.includes(event)) continue;
    totals[event] += row.count;
    const day = byDay.get(row.day);
    if (day) day[event] += row.count;
    const city = byCity.get(row.city) ?? empty();
    city[event] += row.count;
    byCity.set(row.city, city);
  }
  return {
    days,
    since,
    totals,
    daily: [...byDay.entries()].map(([day, counts]) => ({ day, ...counts })),
    cities: [...byCity.entries()].map(([city, counts]) => ({ city: city || null, ...counts })).sort((left, right) => right.app_open + right.search - (left.app_open + left.search)),
  };
}
