import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { verificationCodes } from "../drizzle/schema";
import { APP_NAME } from "../app-identity";
import { ENV } from "./_core/env";
import { sendSms } from "./_core/sms";
import { getDb } from "./db";

export type VerificationPurpose = "register" | "password_reset";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

type StoredCode = { id: number; codeHash: string; attempts: number; expiresAt: Date };

/** Accès au stockage des codes ; remplaçable dans les tests. */
export type VerificationStore = {
  /** Invalide les codes encore actifs pour ce numéro et cet usage. */
  invalidate(phone: string, purpose: VerificationPurpose, now: Date): Promise<void>;
  insert(row: { phone: string; purpose: VerificationPurpose; codeHash: string; expiresAt: Date }): Promise<void>;
  /** Code actif le plus récent (non consommé), ou undefined. */
  findActive(phone: string, purpose: VerificationPurpose): Promise<StoredCode | undefined>;
  incrementAttempts(id: number): Promise<void>;
  consume(id: number, now: Date): Promise<void>;
};

const dbStore: VerificationStore = {
  async invalidate(phone, purpose, now) {
    const db = await requireDb();
    await db
      .update(verificationCodes)
      .set({ consumedAt: now })
      .where(and(eq(verificationCodes.phone, phone), eq(verificationCodes.purpose, purpose), isNull(verificationCodes.consumedAt)));
  },
  async insert(row) {
    const db = await requireDb();
    await db.insert(verificationCodes).values(row);
  },
  async findActive(phone, purpose) {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(verificationCodes)
      .where(and(eq(verificationCodes.phone, phone), eq(verificationCodes.purpose, purpose), isNull(verificationCodes.consumedAt)))
      .orderBy(desc(verificationCodes.id))
      .limit(1);
    return rows[0];
  },
  async incrementAttempts(id) {
    const db = await requireDb();
    await db.update(verificationCodes).set({ attempts: sql`${verificationCodes.attempts} + 1` }).where(eq(verificationCodes.id, id));
  },
  async consume(id, now) {
    const db = await requireDb();
    await db.update(verificationCodes).set({ consumedAt: now }).where(eq(verificationCodes.id, id));
  },
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db;
}

// Le code ne fait que 6 chiffres : un simple hachage se casserait par force brute si la base
// fuitait. Le HMAC avec le secret serveur l'empêche.
function hashCode(phone: string, purpose: VerificationPurpose, code: string) {
  const secret = ENV.cookieSecret || "pharmagarde-dev-only-secret";
  return createHmac("sha256", secret).update(`${purpose}:${phone}:${code}`).digest("hex");
}

function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function smsText(purpose: VerificationPurpose, code: string) {
  const minutes = Math.round(CODE_TTL_MS / 60_000);
  return purpose === "register"
    ? `${APP_NAME} : votre code de vérification est ${code}. Il expire dans ${minutes} minutes. Ne le communiquez à personne.`
    : `${APP_NAME} : votre code de réinitialisation du mot de passe est ${code}. Il expire dans ${minutes} minutes. Si vous n'avez rien demandé, ignorez ce message.`;
}

/** Crée un nouveau code (les précédents sont invalidés) et l'envoie par SMS. */
export async function issueVerificationCode(phone: string, purpose: VerificationPurpose, store: VerificationStore = dbStore, send = sendSms, now = new Date()) {
  const code = generateCode();
  await store.invalidate(phone, purpose, now);
  await store.insert({ phone, purpose, codeHash: hashCode(phone, purpose, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS) });
  await send({ to: phone, message: smsText(purpose, code) });
}

export type VerifyResult = "ok" | "invalid" | "expired" | "too_many_attempts";

/** Vérifie un code ; un code correct est consommé et ne peut plus servir. */
export async function verifyCode(phone: string, purpose: VerificationPurpose, code: string, store: VerificationStore = dbStore, now = new Date()): Promise<VerifyResult> {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return "invalid";

  const active = await store.findActive(phone, purpose);
  if (!active) return "invalid";
  if (active.expiresAt.getTime() <= now.getTime()) return "expired";
  if (active.attempts >= MAX_CODE_ATTEMPTS) return "too_many_attempts";

  const expected = Buffer.from(active.codeHash, "hex");
  const received = Buffer.from(hashCode(phone, purpose, normalized), "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    await store.incrementAttempts(active.id);
    return "invalid";
  }

  await store.consume(active.id, now);
  return "ok";
}

export const VERIFY_ERROR_MESSAGES: Record<Exclude<VerifyResult, "ok">, string> = {
  invalid: "Code incorrect.",
  expired: "Code expiré. Demandez un nouveau code.",
  too_many_attempts: "Trop d'essais pour ce code. Demandez un nouveau code.",
};
