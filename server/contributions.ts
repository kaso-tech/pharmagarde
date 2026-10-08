import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { contributions } from "../drizzle/schema";
import { normalizeBurkinaPhone } from "./pharmacy-directory";
import { createAttemptLimiter } from "./admin-account";
import { weeklyHoursSchema } from "./admin-directory";
import { getDb } from "./db";
import { clientIpKey } from "./_core/security";
import { publicProcedure, router } from "./_core/trpc";

/** Catégories proposées dans « Signaler un problème ». */
export const PROBLEM_CATEGORIES = ["Information incorrecte", "Pharmacie fermée", "Position carte", "Prix médicament", "Autre"] as const;

const trimmed = (max: number) => z.string().trim().max(max);

export const placeProposalSchema = z.object({
  placeKind: z.enum(["pharmacy", "healthcare"]),
  name: trimmed(255).min(3, "Le nom doit contenir au moins 3 caractères."),
  city: trimmed(96).min(2, "Indiquez la ville."),
  address: trimmed(500).min(2, "Indiquez le quartier ou l’adresse."),
  phone: trimmed(40).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  openingHours: weeklyHoursSchema.nullable().optional(),
  notes: trimmed(1000).optional(),
});

export const problemReportSchema = z.object({
  category: z.enum(PROBLEM_CATEGORIES),
  subject: trimmed(255).min(3, "Le sujet doit contenir au moins 3 caractères."),
  message: trimmed(2000).min(8, "Décrivez le problème en quelques mots."),
  placeId: trimmed(128).optional(),
  placeName: trimmed(255).optional(),
  placeKind: z.enum(["pharmacy", "healthcare"]).optional(),
  city: trimmed(96).optional(),
});

/** 10 contributions par heure et par adresse IP : assez pour un usage normal, pas pour inonder la file. */
const submissions = createAttemptLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

function consumeQuota(key: string) {
  if (submissions.isBlocked(key)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Trop d’envois. Réessayez dans une heure." });
  submissions.recordFailure(key);
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Service momentanément indisponible." });
  return db;
}

export const contributionsRouter = router({
  /** Proposition d'un nouvel établissement, à valider dans la console. */
  proposePlace: publicProcedure.input(placeProposalSchema).mutation(async ({ ctx, input }) => {
    consumeQuota(`ip:${clientIpKey(ctx.req)}`);
    const db = await requireDb();
    const phone = input.phone ? normalizeBurkinaPhone(input.phone) ?? input.phone : null;
    await db.insert(contributions).values({
      kind: "new_place",
      userId: ctx.user?.id ?? null,
      placeKind: input.placeKind,
      name: input.name,
      city: input.city,
      address: input.address,
      phone,
      latitude: input.latitude,
      longitude: input.longitude,
      openingHours: input.openingHours ? JSON.stringify(input.openingHours) : null,
      message: input.notes || null,
    });
    return { ok: true as const };
  }),

  /** Signalement d'une erreur, lié ou non à un établissement de l'annuaire. */
  reportProblem: publicProcedure.input(problemReportSchema).mutation(async ({ ctx, input }) => {
    consumeQuota(`ip:${clientIpKey(ctx.req)}`);
    const db = await requireDb();
    await db.insert(contributions).values({
      kind: "problem",
      userId: ctx.user?.id ?? null,
      category: input.category,
      subject: input.subject,
      message: input.message,
      placeId: input.placeId || null,
      name: input.placeName || null,
      placeKind: input.placeKind ?? null,
      city: input.city || null,
    });
    return { ok: true as const };
  }),
});
