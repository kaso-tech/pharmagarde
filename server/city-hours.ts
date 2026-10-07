import { cityHours, type CityHours } from "../drizzle/schema";
import { DEFAULT_WEEKLY_HOURS, parseWeeklyHours, type WeeklyHours } from "../lib/pharmagarde/opening-hours";
import { getDb } from "./db";
import { slugify } from "./pharmacy-directory";

/**
 * Horaires de service par ville saisis dans la console (table city_hours). Une ville sans horaires
 * enregistrés prend DEFAULT_WEEKLY_HOURS. Comme les surcharges de l'annuaire, les horaires sont gardés
 * en mémoire, relus après chaque modification et au plus tard toutes les minutes.
 */
const RELOAD_INTERVAL_MS = 60_000;

let snapshot = new Map<string, { city: string; hours: WeeklyHours; updatedAt: Date | null }>();
let loadedAt = 0;
let generation = 0;
let pendingReload: Promise<void> | null = null;

function cityKey(city: string | null | undefined) {
  return slugify(city ?? "").replace(/-/g, "");
}

function toSnapshot(rows: CityHours[]) {
  const next = new Map<string, { city: string; hours: WeeklyHours; updatedAt: Date | null }>();
  for (const row of rows) {
    const hours = parseWeeklyHours(row.openingHours);
    if (hours) next.set(cityKey(row.city), { city: row.city, hours, updatedAt: row.updatedAt ?? null });
  }
  return next;
}

export async function reloadCityHours() {
  const current = ++generation;
  const db = await getDb();
  let rows: CityHours[] | null = [];
  if (db) {
    try {
      rows = await db.select().from(cityHours);
    } catch (error) {
      rows = null;
      console.warn("[Horaires] Horaires des villes illisibles (migration 0007 appliquée ?), dernière version conservée :", error instanceof Error ? error.message : error);
    }
  }
  if (current === generation) {
    if (rows) snapshot = toSnapshot(rows);
    loadedAt = Date.now();
  }
}

async function ensureFresh() {
  if (Date.now() - loadedAt >= RELOAD_INTERVAL_MS) {
    pendingReload ??= reloadCityHours().finally(() => {
      pendingReload = null;
    });
    await pendingReload;
  }
}

/** Fonction de recherche des horaires d'une ville, à utiliser pour toute une réponse. */
export async function getCityHoursLookup() {
  await ensureFresh();
  const current = snapshot;
  return (city: string | null | undefined): WeeklyHours => current.get(cityKey(city))?.hours ?? DEFAULT_WEEKLY_HOURS;
}

/** Horaires enregistrés pour les villes données (null = horaires par défaut). */
export async function listCityHours(cities: readonly string[]) {
  await ensureFresh();
  return cities.map((city) => {
    const custom = snapshot.get(cityKey(city));
    return { city, hours: custom?.hours ?? DEFAULT_WEEKLY_HOURS, custom: !!custom, updatedAt: custom?.updatedAt?.toISOString() ?? null };
  });
}
