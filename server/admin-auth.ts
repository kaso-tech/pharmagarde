import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { parse as parseCookieHeader } from "cookie";
import { createHash } from "node:crypto";
import type { Request } from "express";

import { adminRoles, adminSessions, type User } from "../drizzle/schema";
import { adminAccess, effectiveAdminRole, type AdminArea, type AdminRole } from "../shared/admin-roles";
import { COOKIE_NAME } from "../shared/const.js";
import { createAttemptLimiter } from "./admin-account";
import { getDb } from "./db";
import { issueVerificationCode, verifyCode, VERIFY_ERROR_MESSAGES } from "./verification-codes";
import { adminProcedure } from "./_core/trpc";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Durée d'accès à la console après le code SMS. */
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

const codeRequests = createAttemptLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

/** Table absente : migration 0012 pas encore appliquée. */
function isMissingTable(error: unknown) {
  const record = error as { errno?: number; code?: string; cause?: { errno?: number; code?: string } } | null;
  return record?.errno === 1146 || record?.code === "ER_NO_SUCH_TABLE" || record?.cause?.errno === 1146 || record?.cause?.code === "ER_NO_SUCH_TABLE";
}

/**
 * Double facteur à la connexion à la console : actif sauf `ADMIN_SECOND_FACTOR=off`. En
 * production sans fournisseur SMS il est suspendu (aucun code ne pourrait arriver), ce que la
 * page Système signale ; `ADMIN_SECOND_FACTOR=on` l'impose malgré tout.
 */
export function secondFactorMode(env: NodeJS.ProcessEnv = process.env): "on" | "off" | "unavailable" {
  const setting = env.ADMIN_SECOND_FACTOR?.trim().toLowerCase();
  if (setting === "off") return "off";
  if (setting === "on") return "on";
  if (env.NODE_ENV === "production" && !env.SMS_WEBHOOK_URL?.trim()) return "unavailable";
  return "on";
}

/** Jeton de session de la requête (Bearer de l'application ou cookie du navigateur). */
export function sessionTokenFrom(req: Pick<Request, "headers">) {
  const header = req.headers.authorization;
  const bearer = typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (bearer) return bearer;
  const cookies = req.headers.cookie ? parseCookieHeader(req.headers.cookie) : {};
  return cookies[COOKIE_NAME] ?? null;
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** « +226 70 •• •• 34 » */
export function maskPhone(phone: string | null | undefined) {
  if (!phone) return null;
  const digits = phone.replace(/\s+/g, "");
  return digits.length > 6 ? `${digits.slice(0, -6).replace(/(\+\d{3})(\d+)/, "$1 $2")} •• •• ${digits.slice(-2)}` : "••••";
}

/** Rôle détaillé d'un compte admin (super-admin sans ligne ou sans migration 0012). */
export async function readAdminRole(db: Database | null, user: Pick<User, "id" | "role">): Promise<AdminRole | null> {
  if (user.role !== "admin") return null;
  if (!db) return "super_admin";
  try {
    const [row] = await db.select({ role: adminRoles.role }).from(adminRoles).where(eq(adminRoles.userId, user.id)).limit(1);
    return effectiveAdminRole({ role: user.role, adminRole: row?.role });
  } catch (error) {
    if (isMissingTable(error)) return "super_admin";
    throw error;
  }
}

/** Rôles détaillés de plusieurs comptes (liste des utilisateurs). */
export async function readAdminRoleMap(db: Database) {
  try {
    const rows = await db.select().from(adminRoles);
    return new Map(rows.map((row) => [row.userId, row.role]));
  } catch (error) {
    if (isMissingTable(error)) return new Map<number, AdminRole>();
    throw error;
  }
}

export type ConsoleAccess = {
  role: AdminRole;
  secondFactor: { mode: ReturnType<typeof secondFactorMode>; verified: boolean; sessionId: number | null; expiresAt: string | null };
};

/** Rôle et état du double facteur pour la session de la requête. */
export async function resolveConsoleAccess(req: Pick<Request, "headers">, user: User, now = new Date()): Promise<ConsoleAccess> {
  const db = await getDb();
  const role = (await readAdminRole(db, user)) ?? "super_admin";
  const mode = secondFactorMode();
  if (mode !== "on") return { role, secondFactor: { mode, verified: true, sessionId: null, expiresAt: null } };
  const token = sessionTokenFrom(req);
  if (!db || !token) return { role, secondFactor: { mode, verified: false, sessionId: null, expiresAt: null } };
  try {
    const [session] = await db
      .select()
      .from(adminSessions)
      .where(and(eq(adminSessions.tokenHash, hashSessionToken(token)), eq(adminSessions.userId, user.id), isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, now)))
      .limit(1);
    if (!session) return { role, secondFactor: { mode, verified: false, sessionId: null, expiresAt: null } };
    if (now.getTime() - new Date(session.lastSeenAt).getTime() > LAST_SEEN_RESOLUTION_MS) {
      await db.update(adminSessions).set({ lastSeenAt: now }).where(eq(adminSessions.id, session.id));
    }
    return { role, secondFactor: { mode, verified: true, sessionId: session.id, expiresAt: new Date(session.expiresAt).toISOString() } };
  } catch (error) {
    // Sans la migration 0012, le double facteur ne peut pas être enregistré : l'accès reste ouvert
    // pour que la page Système permette de le constater.
    if (isMissingTable(error)) return { role, secondFactor: { mode: "unavailable", verified: true, sessionId: null, expiresAt: null } };
    throw error;
  }
}

/** Envoie le code de connexion à la console par SMS au numéro du compte. */
export async function requestConsoleCode(user: User) {
  if (!user.phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Aucun numéro de téléphone sur ce compte : ajoutez-en un pour recevoir le code." });
  if (codeRequests.isBlocked(user.id)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Trop de codes demandés. Réessayez dans un quart d’heure." });
  codeRequests.recordFailure(user.id);
  await issueVerificationCode(user.phone, "admin_login");
  return { phone: maskPhone(user.phone) };
}

/** Vérifie le code et ouvre l'accès à la console pour cette session (12 h). */
export async function confirmConsoleCode(req: Pick<Request, "headers" | "ip">, user: User, code: string, now = new Date()) {
  if (!user.phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Aucun numéro de téléphone sur ce compte." });
  const token = sessionTokenFrom(req);
  if (!token) throw new TRPCError({ code: "UNAUTHORIZED", message: "Session introuvable : reconnectez-vous." });
  const result = await verifyCode(user.phone, "admin_login", code);
  if (result !== "ok") throw new TRPCError({ code: "BAD_REQUEST", message: VERIFY_ERROR_MESSAGES[result] });
  codeRequests.reset(user.id);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de données indisponible." });
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 255) : null;
  const values = { userId: user.id, tokenHash: hashSessionToken(token), userAgent, ip: req.ip?.slice(0, 64) ?? null, lastSeenAt: now, expiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_MS), revokedAt: null };
  await db.insert(adminSessions).values(values).onDuplicateKeyUpdate({ set: { lastSeenAt: now, expiresAt: values.expiresAt, revokedAt: null } });
  return { expiresAt: values.expiresAt.toISOString() };
}

/** Accès de la console de ce compte, du plus récent au plus ancien. */
export async function listConsoleSessions(db: Database, userId: number, now = new Date()) {
  try {
    const rows = await db.select().from(adminSessions).where(eq(adminSessions.userId, userId)).orderBy(desc(adminSessions.lastSeenAt)).limit(30);
    return rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: new Date(row.createdAt).toISOString(),
      lastSeenAt: new Date(row.lastSeenAt).toISOString(),
      expiresAt: new Date(row.expiresAt).toISOString(),
      active: !row.revokedAt && new Date(row.expiresAt).getTime() > now.getTime(),
    }));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

/** Ferme un accès à la console (ou tous sauf `keepId`). */
export async function revokeConsoleSessions(db: Database, userId: number, target: { id: number } | { allExcept: number | null }, now = new Date()) {
  const scope = "id" in target ? eq(adminSessions.id, target.id) : target.allExcept ? ne(adminSessions.id, target.allExcept) : undefined;
  try {
    await db
      .update(adminSessions)
      .set({ revokedAt: now })
      .where(and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt), scope));
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
}

/** Procédure de la console : compte admin dont le double facteur est validé. */
export const consoleProcedure = adminProcedure.use(async ({ ctx, next }) => {
  const access = await resolveConsoleAccess(ctx.req, ctx.user);
  if (!access.secondFactor.verified) throw new TRPCError({ code: "FORBIDDEN", message: "SECOND_FACTOR_REQUIRED" });
  return next({ ctx: { ...ctx, adminRole: access.role, consoleSessionId: access.secondFactor.sessionId } });
});

/** Procédure d'une page : lecture pour les requêtes, modification pour les mutations. */
export function areaProcedure(area: AdminArea) {
  return consoleProcedure.use(({ ctx, type, next }) => {
    const access = adminAccess(ctx.adminRole, area);
    const allowed = type === "mutation" ? access === "write" : access !== "none";
    if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: type === "mutation" ? "Votre rôle ne permet pas cette modification." : "Votre rôle ne donne pas accès à cette page." });
    return next();
  });
}

/** Vérifie un droit supplémentaire dans une procédure (ex. publier une proposition dans l'annuaire). */
export function requireAccess(role: AdminRole, area: AdminArea, mode: "read" | "write" = "write") {
  const access = adminAccess(role, area);
  if (mode === "write" ? access !== "write" : access === "none") throw new TRPCError({ code: "FORBIDDEN", message: "Votre rôle ne permet pas cette action." });
}
