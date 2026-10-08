import { z } from "zod";

import { MIN_PASSWORD_LENGTH } from "./_core/local-auth";

/** Profil de l'administrateur connecté. Le téléphone sert d'identifiant de connexion et n'est pas modifiable ici. */
export const accountUpdateSchema = z.object({
  name: z.string().trim().min(2, "Le nom doit contenir au moins 2 caractères.").max(120),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Adresse e-mail invalide.").max(320)]),
});

export const passwordChangeSchema = z
  .object({
    /** Absent pour un compte qui n'a pas encore de mot de passe. */
    currentPassword: z.string().max(200).default(""),
    newPassword: z.string().trim().min(MIN_PASSWORD_LENGTH, `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`).max(200),
    confirmPassword: z.string().trim().max(200),
  })
  .refine((input) => input.newPassword === input.confirmPassword, { message: "Les deux mots de passe ne correspondent pas.", path: ["confirmPassword"] });

/** Durées proposées dans la console pour offrir le Premium. */
export const PREMIUM_GIFT_DURATIONS = [7, 30, 90, 180, 365] as const;

export const premiumGrantSchema = z.object({
  userId: z.number().int().positive(),
  durationDays: z.number().int().min(1, "Durée minimale : 1 jour.").max(366, "Durée maximale : 1 an."),
  reason: z.string().trim().max(200).optional(),
});

export const premiumRevokeSchema = z.object({
  userId: z.number().int().positive(),
  reason: z.string().trim().max(200).optional(),
});

/** Formule enregistrée dans les transactions pour un Premium offert depuis la console. */
export const OFFERED_PLAN_ID = "offered";

/**
 * Limite les essais de mot de passe actuel : après `max` échecs en `windowMs`, le changement est
 * refusé jusqu'à la fin de la fenêtre (une session volée ne suffit pas à deviner le mot de passe).
 */
export function createAttemptLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const failures = new Map<number | string, { count: number; resetAt: number }>();
  return {
    isBlocked(key: number | string, now = Date.now()) {
      const entry = failures.get(key);
      if (entry && entry.resetAt <= now) failures.delete(key);
      return (failures.get(key)?.count ?? 0) >= max;
    },
    recordFailure(key: number | string, now = Date.now()) {
      const entry = failures.get(key);
      if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + windowMs });
      else entry.count += 1;
    },
    reset(key: number | string) {
      failures.delete(key);
    },
  };
}
