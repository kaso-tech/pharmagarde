import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gt, gte, isNotNull, isNull, like, lte, ne, notLike, or, sum, type SQL } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { auditLogs, cityHours, contributions, directoryEntries, dutyExceptions, dutyRotations, transactions, users } from "../drizzle/schema";
import { getDb } from "./db";
import { listCityHours, reloadCityHours } from "./city-hours";
import { INSURER_IDS } from "../lib/pharmagarde/insurances";
import { reloadDirectoryOverrides } from "./directory-overrides";
import { DUTY_ROTATIONS, dutyCityKey, dutyWeekAt, isPharmacyOnDuty, weekDateKey } from "./duty-roster";
import { dutyTurnListSchema, getDutyConfig, reloadDutyConfig } from "./duty-config";
import { cityMatchKey, weeklyHoursSchema, directoryArchiveSchema, directoryRestoreSchema, directoryUpsertSchema, filterAdminDirectoryItems, getBaseAdminDirectoryItems, listDirectoryCities, mergeAdminDirectoryItems, normalizeDirectoryUpsert } from "./admin-directory";
import { adminProcedure, router } from "./_core/trpc";
import { COOKIE_NAME, SESSION_TTL_MS } from "../shared/const.js";
import { accountUpdateSchema, createAttemptLimiter, OFFERED_PLAN_ID, passwordChangeSchema, premiumGrantSchema, premiumRevokeSchema } from "./admin-account";
import { getSessionCookieOptions } from "./_core/cookies";
import { hashPassword, verifyPassword } from "./_core/local-auth";
import { sdk } from "./_core/sdk";
import { extendSubscriptionEnd, isSubscriptionActive, recheckTransaction, resolveTransactionManually } from "./premium";
import { deleteUserAccount } from "./db";
import { readConsoleBackup, readSystemStatus } from "./system-status";
import { updateCachedDataset } from "./pharmagarde-cache";

const pageSchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});

const directoryListSchema = pageSchema.extend({
  kind: z.enum(["all", "pharmacy", "healthcare"]).default("all"),
  search: z.string().trim().max(120).optional(),
  status: z.enum(["active", "archived"]).default("active"),
  city: z.string().trim().max(96).optional(),
  dutyGroup: z.enum(["all", "none", "1", "2", "3", "4"]).default("all"),
  insurance: z.enum(INSURER_IDS).optional(),
});

const dutyOverviewSchema = z.object({
  weeks: z.number().int().min(1).max(26).default(8),
});

const saturdaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ.")
  .refine((value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 6, "La semaine de garde commence un samedi.");

const rotationSaveSchema = z.discriminatedUnion("mode", [
  z.object({ city: z.string().trim().min(2).max(96), mode: z.literal("groups"), groupCount: z.number().int().min(2).max(12), referenceStart: saturdaySchema, referenceTurn: z.number().int().min(1).max(12) }),
  z.object({ city: z.string().trim().min(2).max(96), mode: z.literal("lists"), turns: dutyTurnListSchema, referenceStart: saturdaySchema, referenceTurn: z.number().int().min(1).max(12) }),
  z.object({ city: z.string().trim().min(2).max(96), mode: z.literal("off") }),
]);

const dutyExceptionSchema = z.object({
  city: z.string().trim().min(2).max(96),
  weekStart: saturdaySchema,
  pharmacyId: z.string().trim().min(1).max(128),
  action: z.enum(["add", "remove"]),
  note: z.string().trim().max(255).optional(),
});

const cityHoursSchema = z.object({
  city: z.string().trim().min(2).max(96),
  openingHours: weeklyHoursSchema,
});

const cityHoursResetSchema = z.object({
  city: z.string().trim().min(2).max(96),
});

const auditListSchema = pageSchema.extend({
  /** Les consultations de pages sont journalisées mais masquées par défaut. */
  includeViews: z.boolean().default(false),
});

const userListSchema = pageSchema.extend({
  search: z.string().trim().max(120).optional(),
  premium: z.enum(["all", "active", "inactive"]).default("all"),
  verified: z.enum(["all", "verified", "unverified"]).default("all"),
  role: z.enum(["all", "admin", "user"]).default("all"),
});

const userIdSchema = z.object({ userId: z.number().int().positive() });
const noteSchema = z.string().trim().max(500).optional();

const contributionListSchema = pageSchema.extend({
  kind: z.enum(["new_place", "problem"]),
  status: z.enum(["new", "accepted", "rejected", "resolved", "all"]).default("new"),
});

const transactionListSchema = pageSchema.extend({
  status: z.enum(["all", "success", "pending", "failed", "cancelled"]).default("all"),
});

function startOfMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const activitySchema = z.object({
  area: z.enum(["dashboard", "directory", "duty", "hours", "users", "premium", "audit", "account", "contributions", "system"]),
});

function failIfNoDb<T>(db: T | null): T {
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de données indisponible." });
  return db;
}

function serializeDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeMetadata(value: Record<string, string | number | boolean | null | undefined>) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)));
}

function parseMetadata(value: string | null) {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function writeAudit(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: { actorUserId: number; action: string; targetType: string; targetId?: string | null; metadata?: Record<string, string | number | boolean | null | undefined> },
) {
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: input.metadata ? safeMetadata(input.metadata) : null,
  });
}

const passwordAttempts = createAttemptLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

async function readUser(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  return user;
}

function offsetOf(input: { page: number; limit: number }) {
  return (input.page - 1) * input.limit;
}

export async function readMergedDirectory() {
  const db = failIfNoDb(await getDb());
  const [baseItems, overrides] = await Promise.all([getBaseAdminDirectoryItems(), db.select().from(directoryEntries)]);
  return mergeAdminDirectoryItems(baseItems, overrides);
}

async function readAdminDirectory(input: z.infer<typeof directoryListSchema>) {
  const merged = await readMergedDirectory();
  const filtered = filterAdminDirectoryItems(merged, input);
  const offset = offsetOf(input);
  return {
    items: filtered.slice(offset, offset + input.limit),
    total: filtered.length,
    page: input.page,
    limit: input.limit,
    cities: listDirectoryCities(merged),
  };
}

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Crée ou modifie une fiche de l'annuaire (surcharge administrée) et la publie immédiatement. */
async function saveDirectoryEntry(db: Database, actorUserId: number, input: z.infer<typeof directoryUpsertSchema>, source: string) {
  const [id] = await saveDirectoryEntries(db, actorUserId, [input], source);
  return id!;
}

/** Enregistre plusieurs fiches dans une même transaction (import Excel), puis les publie. */
export async function saveDirectoryEntries(db: Database, actorUserId: number, inputs: readonly z.infer<typeof directoryUpsertSchema>[], source: string) {
  const knownCities = listDirectoryCities(await readMergedDirectory()).map((city) => city.name);
  const entries = inputs.map((input) => normalizeDirectoryUpsert(input, knownCities));
  await db.transaction(async (tx) => {
    for (const entry of entries) {
      await tx
        .insert(directoryEntries)
        .values(entry)
        .onDuplicateKeyUpdate({
          set: {
            kind: entry.kind,
            status: "active",
            city: entry.city,
            name: entry.name,
            phone: entry.phone,
            address: entry.address,
            latitude: entry.latitude,
            longitude: entry.longitude,
            dutyGroup: entry.dutyGroup,
            establishmentType: entry.establishmentType,
            openingHours: entry.openingHours,
            insurances: entry.insurances,
          },
        });
      // Un import groupé n'écrit qu'une ligne de journal (voir l'appelant), pas une par fiche.
      if (entries.length === 1) {
        await tx.insert(auditLogs).values({
          actorUserId,
          action: "directory.upserted",
          targetType: entry.kind,
          targetId: entry.id,
          metadata: safeMetadata({ kind: entry.kind, city: entry.city, source }),
        });
      }
    }
  });
  // Publication immédiate dans /pharmacies et /healthcare.
  await reloadDirectoryOverrides();
  return entries.map((entry) => entry.id);
}

async function readContribution(db: Database, id: number) {
  const [row] = await db.select().from(contributions).where(eq(contributions.id, id)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Contribution introuvable." });
  return row;
}

function userFilter(input: Omit<z.infer<typeof userListSchema>, "page" | "limit">) {
  const pattern = input.search ? `%${input.search.replace(/[\\%_]/g, "\\$&")}%` : null;
  const now = new Date();
  const conditions: (SQL | undefined)[] = [
    pattern ? or(like(users.name, pattern), like(users.email, pattern), like(users.phone, pattern)) : undefined,
    input.premium === "active" ? gt(users.subscriptionEnd, now) : input.premium === "inactive" ? or(isNull(users.subscriptionEnd), lte(users.subscriptionEnd, now)) : undefined,
    input.verified === "verified" ? isNotNull(users.phoneVerifiedAt) : input.verified === "unverified" ? isNull(users.phoneVerifiedAt) : undefined,
    input.role !== "all" ? eq(users.role, input.role) : undefined,
  ];
  return and(...conditions.filter((condition): condition is SQL => !!condition));
}

function forbidSelf(actorId: number, userId: number, message: string) {
  if (actorId === userId) throw new TRPCError({ code: "BAD_REQUEST", message });
}

export const adminRouter = router({
  access: adminProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    role: "admin" as const,
    name: ctx.user.name,
    phone: ctx.user.phone,
    email: ctx.user.email,
  })),

  activity: adminProcedure.input(activitySchema).mutation(async ({ ctx, input }) => {
    const db = failIfNoDb(await getDb());
    await writeAudit(db, {
      actorUserId: ctx.user.id,
      action: `admin.${input.area}.viewed`,
      targetType: "admin_console",
      targetId: input.area,
    });
    return { ok: true };
  }),

  /** Compte de l'administrateur connecté. */
  account: router({
    get: adminProcedure.query(async ({ ctx }) => {
      const user = await readUser(failIfNoDb(await getDb()), ctx.user.id);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        hasPassword: !!user.passwordHash,
        phoneVerifiedAt: serializeDate(user.phoneVerifiedAt),
        subscriptionEnd: serializeDate(user.subscriptionEnd),
        createdAt: serializeDate(user.createdAt),
        lastSignedIn: serializeDate(user.lastSignedIn),
      };
    }),

    update: adminProcedure.input(accountUpdateSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const email = input.email || null;
      if (email) {
        // L'e-mail peut servir d'identifiant de connexion : il doit rester unique.
        const [taken] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, ctx.user.id))).limit(1);
        if (taken) throw new TRPCError({ code: "CONFLICT", message: "Cette adresse e-mail est déjà utilisée par un autre compte." });
      }
      await db.update(users).set({ name: input.name, email }).where(eq(users.id, ctx.user.id));
      await writeAudit(db, { actorUserId: ctx.user.id, action: "account.updated", targetType: "user", targetId: String(ctx.user.id) });
      return { name: input.name, email };
    }),

    /**
     * Change le mot de passe puis déconnecte toutes les autres sessions du compte. La session en cours
     * reçoit un nouveau jeton (cookie sur le web, renvoyé pour le stockage sur mobile).
     */
    changePassword: adminProcedure.input(passwordChangeSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const user = await readUser(db, ctx.user.id);
      if (passwordAttempts.isBlocked(user.id)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Trop de tentatives. Réessayez dans quelques minutes." });
      const currentPassword = input.currentPassword.trim();
      if (user.passwordHash && !verifyPassword(currentPassword, user.passwordHash)) {
        passwordAttempts.recordFailure(user.id);
        throw new TRPCError({ code: "BAD_REQUEST", message: "Mot de passe actuel incorrect." });
      }
      if (user.passwordHash && currentPassword === input.newPassword) throw new TRPCError({ code: "BAD_REQUEST", message: "Le nouveau mot de passe doit être différent de l’actuel." });
      passwordAttempts.reset(user.id);

      const now = new Date();
      await db.update(users).set({ passwordHash: hashPassword(input.newPassword), sessionsValidAfter: now }).where(eq(users.id, user.id));
      const token = await sdk.createSessionToken(user.openId, { name: user.phone ?? user.email ?? user.openId, expiresInMs: SESSION_TTL_MS });
      ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: SESSION_TTL_MS });
      await writeAudit(db, { actorUserId: user.id, action: "account.password_changed", targetType: "user", targetId: String(user.id) });
      return { token };
    }),
  }),

  dashboard: adminProcedure.query(async () => {
    const db = failIfNoDb(await getDb());
    const monthStart = startOfMonth();
    const [allUsers, verifiedUsers, premiumUsers, allTransactions, pendingTransactions, baseItems, overrides, newUsers, revenue, revenueMonth] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(users).where(isNotNull(users.phoneVerifiedAt)),
      db.select({ value: count() }).from(users).where(gt(users.subscriptionEnd, new Date())),
      db.select({ value: count() }).from(transactions),
      db.select({ value: count() }).from(transactions).where(eq(transactions.status, "pending")),
      getBaseAdminDirectoryItems(),
      db.select().from(directoryEntries),
      db.select({ value: count() }).from(users).where(gte(users.createdAt, monthStart)),
      db.select({ value: sum(transactions.amount) }).from(transactions).where(eq(transactions.status, "success")),
      db.select({ value: sum(transactions.amount) }).from(transactions).where(and(eq(transactions.status, "success"), gte(transactions.createdAt, monthStart))),
    ]);

    const directoryCount = mergeAdminDirectoryItems(baseItems, overrides).filter((item) => item.status === "active").length;
    return {
      users: allUsers[0]?.value ?? 0,
      verifiedUsers: verifiedUsers[0]?.value ?? 0,
      premiumUsers: premiumUsers[0]?.value ?? 0,
      transactions: allTransactions[0]?.value ?? 0,
      pendingTransactions: pendingTransactions[0]?.value ?? 0,
      directoryEntries: directoryCount,
      newUsersThisMonth: newUsers[0]?.value ?? 0,
      revenueTotal: Number(revenue[0]?.value ?? 0),
      revenueThisMonth: Number(revenueMonth[0]?.value ?? 0),
    };
  }),

  directory: router({
    list: adminProcedure.input(directoryListSchema).query(({ input }) => readAdminDirectory(input)),

    /** Toutes les fiches correspondant aux filtres, pour l'export CSV. */
    export: adminProcedure.input(directoryListSchema.omit({ page: true, limit: true })).query(async ({ input }) => {
      const items = filterAdminDirectoryItems(await readMergedDirectory(), input);
      return items.map((item) => ({ id: item.id, kind: item.kind, status: item.status, city: item.city, name: item.name, phone: item.phone, address: item.address, latitude: item.latitude, longitude: item.longitude, dutyGroup: item.dutyGroup, establishmentType: item.establishmentType, insurances: item.insurances, customHours: !!item.openingHours, source: item.source }));
    }),

    upsert: adminProcedure.input(directoryUpsertSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const id = await saveDirectoryEntry(db, ctx.user.id, input, "admin_console");
      return { id, status: "active" as const };
    }),

    archive: adminProcedure
      .input(directoryArchiveSchema)
      .mutation(async ({ ctx, input }) => {
        const db = failIfNoDb(await getDb());
        const baseItems = await getBaseAdminDirectoryItems();
        await db.transaction(async (tx) => {
          const existing = await tx.select().from(directoryEntries).where(eq(directoryEntries.id, input.id)).limit(1);
          const current = existing[0];
          const source = baseItems.find((item) => item.id === input.id);
          const entry = current ?? source;
          if (!entry) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Établissement introuvable dans l’annuaire." });
          }
          if (current?.status === "archived") {
            throw new TRPCError({ code: "CONFLICT", message: "Cet établissement est déjà archivé." });
          }
          if (entry.kind !== input.kind) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Le type d’établissement ne correspond pas à la surcharge existante." });
          }
          await tx
            .insert(directoryEntries)
            .values({
              id: input.id,
              kind: input.kind,
              status: "archived",
              city: entry.city ?? null,
              name: entry.name ?? null,
              phone: entry.phone ?? null,
              address: entry.address ?? null,
              latitude: entry.latitude ?? null,
              longitude: entry.longitude ?? null,
              dutyGroup: entry.dutyGroup ?? null,
              establishmentType: entry.establishmentType ?? null,
              openingHours: current ? current.openingHours : source?.openingHours ? JSON.stringify(source.openingHours) : null,
              insurances: current ? current.insurances : source?.insurances.length ? JSON.stringify(source.insurances) : null,
            })
            .onDuplicateKeyUpdate({ set: { status: "archived" } });
          await tx.insert(auditLogs).values({
            actorUserId: ctx.user.id,
            action: "directory.archived",
            targetType: input.kind,
            targetId: input.id,
            metadata: safeMetadata({ kind: input.kind, confirmation: input.confirmArchive, source: "admin_console" }),
          });
        });
        await reloadDirectoryOverrides();
        return { id: input.id, status: "archived" as const };
      }),

    restore: adminProcedure.input(directoryRestoreSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      await db.transaction(async (tx) => {
        const existing = await tx.select().from(directoryEntries).where(eq(directoryEntries.id, input.id)).limit(1);
        const current = existing[0];
        if (!current || current.status !== "archived") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Aucun établissement archivé ne correspond à cet identifiant." });
        }
        await tx.update(directoryEntries).set({ status: "active" }).where(eq(directoryEntries.id, input.id));
        await tx.insert(auditLogs).values({
          actorUserId: ctx.user.id,
          action: "directory.restored",
          targetType: current.kind,
          targetId: input.id,
          metadata: safeMetadata({ kind: current.kind, source: "admin_console" }),
        });
      });
      await reloadDirectoryOverrides();
      return { id: input.id, status: "active" as const };
    }),
  }),

  duty: router({
    /** Programmation par ville : semaines à venir, pharmacies de garde, exceptions et réglages. */
    overview: adminProcedure.input(dutyOverviewSchema).query(async ({ input }) => {
      const [merged, config] = await Promise.all([readMergedDirectory(), getDutyConfig()]);
      const now = new Date();
      const pharmaciesOf = (city: string) => merged.filter((item) => item.status === "active" && item.kind === "pharmacy" && cityMatchKey(item.city) === cityMatchKey(city));
      const programmed = new Set(config.rotations.map((rotation) => dutyCityKey(rotation.city)));
      const cities = config.rotations.map((rotation) => {
        const pharmacies = pharmaciesOf(rotation.city);
        const nameOf = new Map(pharmacies.map((pharmacy) => [pharmacy.id, pharmacy.name]));
        const weeks = Array.from({ length: input.weeks }, (_, offset) => {
          const week = dutyWeekAt(rotation, now, offset);
          const exception = config.exceptions.get(`${dutyCityKey(rotation.city)}|${weekDateKey(week.start)}`);
          return {
            label: week.turn.label,
            dutyGroup: week.turn.dutyGroup ?? null,
            start: week.start.toISOString(),
            end: week.end.toISOString(),
            weekStart: weekDateKey(week.start),
            pharmacyCount: pharmacies.filter((pharmacy) => isPharmacyOnDuty(pharmacy, week, config.exceptions)).length,
            exceptionCount: (exception?.add.size ?? 0) + (exception?.remove.size ?? 0),
          };
        });
        const current = dutyWeekAt(rotation, now);
        const custom = config.custom.get(dutyCityKey(rotation.city));
        const lists = rotation.turns.every((turn) => turn.pharmacyIds);
        return {
          city: rotation.city,
          source: custom ? ("console" as const) : ("default" as const),
          mode: lists ? ("lists" as const) : ("groups" as const),
          groupCount: lists ? null : rotation.turns.length,
          referenceStart: rotation.reference.start,
          referenceTurn: rotation.reference.turnIndex + 1,
          turns: rotation.turns.map((turn) => ({ label: turn.label, pharmacyIds: turn.pharmacyIds ? [...turn.pharmacyIds] : null })),
          weeks,
          pharmacyCount: pharmacies.length,
          pharmacies: pharmacies.map((pharmacy) => ({ id: pharmacy.id, name: pharmacy.name, dutyGroup: pharmacy.dutyGroup, phone: pharmacy.phone })),
          withoutGroup: lists ? [] : pharmacies.filter((pharmacy) => pharmacy.dutyGroup === null).map((pharmacy) => ({ id: pharmacy.id, name: pharmacy.name })),
          onDutyNow: pharmacies
            .filter((pharmacy) => isPharmacyOnDuty(pharmacy, current, config.exceptions))
            .map((pharmacy) => ({ id: pharmacy.id, name: pharmacy.name, phone: pharmacy.phone, address: pharmacy.address })),
          exceptions: config.exceptionRows
            .filter((row) => dutyCityKey(row.city) === dutyCityKey(rotation.city) && row.weekStart >= weekDateKey(current.start))
            .map((row) => ({ id: row.id, weekStart: row.weekStart, pharmacyId: row.pharmacyId, pharmacyName: nameOf.get(row.pharmacyId) ?? row.pharmacyId, action: row.action, note: row.note })),
        };
      });
      // Villes de l'annuaire sans programmation (jamais programmées ou désactivées).
      const unprogrammed = listDirectoryCities(merged)
        .filter((city) => !programmed.has(dutyCityKey(city.name)) && pharmaciesOf(city.name).length > 0)
        .map((city) => ({
          city: city.name,
          disabled: config.custom.get(dutyCityKey(city.name))?.mode === "off",
          pharmacies: pharmaciesOf(city.name).map((pharmacy) => ({ id: pharmacy.id, name: pharmacy.name, dutyGroup: pharmacy.dutyGroup, phone: pharmacy.phone })),
        }));
      return { cities, unprogrammed, defaults: DUTY_ROTATIONS.map((rotation) => rotation.city) };
    }),

    /** Enregistre la programmation d'une ville (groupes, listes ou désactivée). */
    saveRotation: adminProcedure.input(rotationSaveSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const values =
        input.mode === "off"
          ? { city: input.city, mode: "off" as const, groupCount: null, referenceStart: "2026-10-03", referenceTurnIndex: 0, turns: null, updatedBy: ctx.user.id }
          : input.mode === "groups"
            ? { city: input.city, mode: "groups" as const, groupCount: input.groupCount, referenceStart: input.referenceStart, referenceTurnIndex: input.referenceTurn - 1, turns: null, updatedBy: ctx.user.id }
            : { city: input.city, mode: "lists" as const, groupCount: null, referenceStart: input.referenceStart, referenceTurnIndex: input.referenceTurn - 1, turns: JSON.stringify(input.turns), updatedBy: ctx.user.id };
      const turnCount = input.mode === "groups" ? input.groupCount : input.mode === "lists" ? input.turns.length : 1;
      if (input.mode !== "off" && input.referenceTurn > turnCount) throw new TRPCError({ code: "BAD_REQUEST", message: `Le tour de référence doit être compris entre 1 et ${turnCount}.` });
      const { city: _city, ...set } = values;
      await db.insert(dutyRotations).values(values).onDuplicateKeyUpdate({ set });
      await writeAudit(db, { actorUserId: ctx.user.id, action: "duty.rotation_saved", targetType: "city", targetId: input.city, metadata: { mode: input.mode, turns: turnCount, referenceStart: input.mode === "off" ? undefined : input.referenceStart } });
      await reloadDutyConfig();
      return { city: input.city };
    }),

    /** Revient à la programmation par défaut de la ville (ou à aucune). */
    resetRotation: adminProcedure.input(z.object({ city: z.string().trim().min(2).max(96) })).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      await db.delete(dutyRotations).where(eq(dutyRotations.city, input.city));
      await writeAudit(db, { actorUserId: ctx.user.id, action: "duty.rotation_reset", targetType: "city", targetId: input.city });
      await reloadDutyConfig();
      return { city: input.city };
    }),

    /** Ajoute une exception à une semaine : pharmacie ajoutée à la garde ou retirée. */
    addException: adminProcedure.input(dutyExceptionSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      await db.insert(dutyExceptions).values({ city: input.city, weekStart: input.weekStart, pharmacyId: input.pharmacyId, action: input.action, note: input.note || null, createdBy: ctx.user.id });
      await writeAudit(db, { actorUserId: ctx.user.id, action: "duty.exception_added", targetType: "city", targetId: input.city, metadata: { weekStart: input.weekStart, pharmacyId: input.pharmacyId, action: input.action, note: input.note || undefined } });
      await reloadDutyConfig();
      return { ok: true };
    }),

    removeException: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const [row] = await db.select().from(dutyExceptions).where(eq(dutyExceptions.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Exception introuvable." });
      await db.delete(dutyExceptions).where(eq(dutyExceptions.id, input.id));
      await writeAudit(db, { actorUserId: ctx.user.id, action: "duty.exception_removed", targetType: "city", targetId: row.city, metadata: { weekStart: row.weekStart, pharmacyId: row.pharmacyId } });
      await reloadDutyConfig();
      return { ok: true };
    }),
  }),

  hours: router({
    /** Horaires de service par ville (ceux par défaut tant qu'une ville n'a pas les siens). */
    cities: adminProcedure.query(async () => {
      const cities = listDirectoryCities(await readMergedDirectory()).map((city) => city.name);
      return listCityHours(cities);
    }),

    setCity: adminProcedure.input(cityHoursSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const openingHours = JSON.stringify(input.openingHours);
      await db.transaction(async (tx) => {
        await tx.insert(cityHours).values({ city: input.city, openingHours }).onDuplicateKeyUpdate({ set: { openingHours } });
        await tx.insert(auditLogs).values({
          actorUserId: ctx.user.id,
          action: "city_hours.updated",
          targetType: "city",
          targetId: input.city,
          metadata: safeMetadata({ source: "admin_console" }),
        });
      });
      await reloadCityHours();
      return { city: input.city };
    }),

    resetCity: adminProcedure.input(cityHoursResetSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      await db.transaction(async (tx) => {
        await tx.delete(cityHours).where(eq(cityHours.city, input.city));
        await tx.insert(auditLogs).values({
          actorUserId: ctx.user.id,
          action: "city_hours.reset",
          targetType: "city",
          targetId: input.city,
          metadata: safeMetadata({ source: "admin_console" }),
        });
      });
      await reloadCityHours();
      return { city: input.city };
    }),
  }),

  contributions: router({
    /** Nombre de contributions à traiter, pour le menu et le tableau de bord. */
    counts: adminProcedure.query(async () => {
      const db = failIfNoDb(await getDb());
      const [places, problems] = await Promise.all([
        db.select({ value: count() }).from(contributions).where(and(eq(contributions.kind, "new_place"), eq(contributions.status, "new"))),
        db.select({ value: count() }).from(contributions).where(and(eq(contributions.kind, "problem"), eq(contributions.status, "new"))),
      ]);
      return { newPlaces: places[0]?.value ?? 0, newProblems: problems[0]?.value ?? 0 };
    }),

    list: adminProcedure.input(contributionListSchema).query(async ({ input }) => {
      const db = failIfNoDb(await getDb());
      const where = and(eq(contributions.kind, input.kind), input.status === "all" ? undefined : eq(contributions.status, input.status));
      const [rows, totals] = await Promise.all([
        db
          .select({
            contribution: contributions,
            authorName: users.name,
            authorPhone: users.phone,
          })
          .from(contributions)
          .leftJoin(users, eq(contributions.userId, users.id))
          .where(where)
          .orderBy(desc(contributions.createdAt), desc(contributions.id))
          .limit(input.limit)
          .offset(offsetOf(input)),
        db.select({ value: count() }).from(contributions).where(where),
      ]);
      return {
        items: rows.map(({ contribution, authorName, authorPhone }) => ({
          ...contribution,
          openingHours: contribution.openingHours ? parseMetadata(contribution.openingHours) : null,
          createdAt: serializeDate(contribution.createdAt),
          handledAt: serializeDate(contribution.handledAt),
          updatedAt: serializeDate(contribution.updatedAt),
          authorName,
          authorPhone,
        })),
        total: totals[0]?.value ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),

    /** Accepte une proposition : la fiche (éventuellement corrigée) est publiée dans l'annuaire. */
    acceptPlace: adminProcedure.input(z.object({ id: z.number().int().positive(), entry: directoryUpsertSchema })).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const contribution = await readContribution(db, input.id);
      if (contribution.kind !== "new_place" || contribution.status !== "new") throw new TRPCError({ code: "BAD_REQUEST", message: "Cette proposition a déjà été traitée." });
      const placeId = await saveDirectoryEntry(db, ctx.user.id, input.entry, "contribution");
      await db.update(contributions).set({ status: "accepted", placeId, handledBy: ctx.user.id, handledAt: new Date() }).where(eq(contributions.id, contribution.id));
      await writeAudit(db, { actorUserId: ctx.user.id, action: "contribution.accepted", targetType: "contribution", targetId: String(contribution.id), metadata: { placeId } });
      return { placeId };
    }),

    /** Refuse une proposition ou clôt un signalement, avec une note interne. */
    close: adminProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["rejected", "resolved"]), note: noteSchema })).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const contribution = await readContribution(db, input.id);
      if (contribution.status !== "new") throw new TRPCError({ code: "BAD_REQUEST", message: "Cette contribution a déjà été traitée." });
      await db.update(contributions).set({ status: input.status, adminNote: input.note || null, handledBy: ctx.user.id, handledAt: new Date() }).where(eq(contributions.id, contribution.id));
      await writeAudit(db, { actorUserId: ctx.user.id, action: `contribution.${input.status}`, targetType: "contribution", targetId: String(contribution.id), metadata: { kind: contribution.kind, note: input.note || undefined } });
      return { id: contribution.id, status: input.status };
    }),
  }),

  users: router({
    /** Comptes correspondant aux filtres (10 000 au plus), pour l'export CSV ; sans mot de passe ni jeton. */
    export: adminProcedure.input(userListSchema.omit({ page: true, limit: true })).query(async ({ input }) => {
      const db = failIfNoDb(await getDb());
      const rows = await db
        .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role, phoneVerifiedAt: users.phoneVerifiedAt, subscriptionEnd: users.subscriptionEnd, suspendedAt: users.suspendedAt, createdAt: users.createdAt, lastSignedIn: users.lastSignedIn })
        .from(users)
        .where(userFilter(input))
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(10_000);
      return rows.map((user) => ({ ...user, phoneVerifiedAt: serializeDate(user.phoneVerifiedAt), subscriptionEnd: serializeDate(user.subscriptionEnd), suspendedAt: serializeDate(user.suspendedAt), createdAt: serializeDate(user.createdAt), lastSignedIn: serializeDate(user.lastSignedIn) }));
    }),

    list: adminProcedure.input(userListSchema).query(async ({ input }) => {
      const db = failIfNoDb(await getDb());
      const where = userFilter(input);
      const [rows, totals] = await Promise.all([
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            phone: users.phone,
            role: users.role,
            phoneVerifiedAt: users.phoneVerifiedAt,
            subscriptionEnd: users.subscriptionEnd,
            suspendedAt: users.suspendedAt,
            createdAt: users.createdAt,
            lastSignedIn: users.lastSignedIn,
          })
          .from(users)
          .where(where)
          .orderBy(desc(users.createdAt), desc(users.id))
          .limit(input.limit)
          .offset(offsetOf(input)),
        db.select({ value: count() }).from(users).where(where),
      ]);

      return {
        items: rows.map((user) => ({
          ...user,
          phoneVerifiedAt: serializeDate(user.phoneVerifiedAt),
          subscriptionEnd: serializeDate(user.subscriptionEnd),
          suspendedAt: serializeDate(user.suspendedAt),
          createdAt: serializeDate(user.createdAt),
          lastSignedIn: serializeDate(user.lastSignedIn),
          verificationStatus: user.phoneVerifiedAt ? "verified" as const : "unverified" as const,
        })),
        total: totals[0]?.value ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),

    /** Fiche d'un utilisateur : compte, abonnement, paiements, contributions et actions de la console. */
    get: adminProcedure.input(userIdSchema).query(async ({ input }) => {
      const db = failIfNoDb(await getDb());
      const user = await readUser(db, input.userId);
      const [payments, events, contributionCount] = await Promise.all([
        db
          .select({ id: transactions.id, planId: transactions.planId, amount: transactions.amount, status: transactions.status, provider: transactions.provider, merchantReference: transactions.merchantReference, createdAt: transactions.createdAt })
          .from(transactions)
          .where(eq(transactions.userId, user.id))
          .orderBy(desc(transactions.createdAt))
          .limit(20),
        db
          .select({ id: auditLogs.id, action: auditLogs.action, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt, actorName: users.name, actorPhone: users.phone })
          .from(auditLogs)
          .leftJoin(users, eq(auditLogs.actorUserId, users.id))
          .where(and(eq(auditLogs.targetType, "user"), eq(auditLogs.targetId, String(user.id))))
          .orderBy(desc(auditLogs.createdAt))
          .limit(20),
        db.select({ value: count() }).from(contributions).where(eq(contributions.userId, user.id)),
      ]);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        loginMethod: user.loginMethod,
        hasPassword: !!user.passwordHash,
        phoneVerifiedAt: serializeDate(user.phoneVerifiedAt),
        subscriptionEnd: serializeDate(user.subscriptionEnd),
        suspendedAt: serializeDate(user.suspendedAt),
        sessionsValidAfter: serializeDate(user.sessionsValidAfter),
        createdAt: serializeDate(user.createdAt),
        lastSignedIn: serializeDate(user.lastSignedIn),
        deleted: user.loginMethod === "deleted",
        contributions: contributionCount[0]?.value ?? 0,
        payments: payments.map((payment) => ({ ...payment, createdAt: serializeDate(payment.createdAt) })),
        history: events.map((event) => ({ ...event, createdAt: serializeDate(event.createdAt), metadata: parseMetadata(event.metadata) })),
      };
    }),

    /** Suspend un compte (connexion refusée, sessions fermées) ou le réactive. */
    setSuspended: adminProcedure.input(userIdSchema.extend({ suspended: z.boolean(), reason: noteSchema })).mutation(async ({ ctx, input }) => {
      forbidSelf(ctx.user.id, input.userId, "Vous ne pouvez pas suspendre votre propre compte.");
      const db = failIfNoDb(await getDb());
      const user = await readUser(db, input.userId);
      const now = new Date();
      await db.update(users).set(input.suspended ? { suspendedAt: now, sessionsValidAfter: now } : { suspendedAt: null }).where(eq(users.id, user.id));
      await writeAudit(db, { actorUserId: ctx.user.id, action: input.suspended ? "users.suspended" : "users.reactivated", targetType: "user", targetId: String(user.id), metadata: { reason: input.reason || undefined } });
      return { userId: user.id, suspended: input.suspended };
    }),

    /** Déconnecte tous les appareils de l'utilisateur. */
    revokeSessions: adminProcedure.input(userIdSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const user = await readUser(db, input.userId);
      await db.update(users).set({ sessionsValidAfter: new Date() }).where(eq(users.id, user.id));
      await writeAudit(db, { actorUserId: ctx.user.id, action: "users.sessions_revoked", targetType: "user", targetId: String(user.id) });
      return { userId: user.id };
    }),

    /** Donne ou retire le rôle administrateur. */
    setRole: adminProcedure.input(userIdSchema.extend({ role: z.enum(["user", "admin"]) })).mutation(async ({ ctx, input }) => {
      forbidSelf(ctx.user.id, input.userId, "Vous ne pouvez pas modifier votre propre rôle.");
      const db = failIfNoDb(await getDb());
      const user = await readUser(db, input.userId);
      if (user.loginMethod === "deleted") throw new TRPCError({ code: "BAD_REQUEST", message: "Ce compte a été supprimé." });
      await db.update(users).set({ role: input.role, sessionsValidAfter: new Date() }).where(eq(users.id, user.id));
      await writeAudit(db, { actorUserId: ctx.user.id, action: "users.role_changed", targetType: "user", targetId: String(user.id), metadata: { from: user.role, to: input.role } });
      return { userId: user.id, role: input.role };
    }),

    /** Supprime le compte comme le ferait l'utilisateur : coordonnées effacées, paiements anonymisés. */
    remove: adminProcedure.input(userIdSchema.extend({ confirm: z.literal(true), reason: noteSchema })).mutation(async ({ ctx, input }) => {
      forbidSelf(ctx.user.id, input.userId, "Vous ne pouvez pas supprimer votre propre compte depuis la console.");
      const db = failIfNoDb(await getDb());
      const user = await readUser(db, input.userId);
      await deleteUserAccount(user.id);
      await writeAudit(db, { actorUserId: ctx.user.id, action: "users.deleted", targetType: "user", targetId: String(user.id), metadata: { reason: input.reason || undefined } });
      return { userId: user.id };
    }),

    /** Offre (ou prolonge) le Premium d'un utilisateur ; tracé comme une transaction gratuite. */
    grantPremium: adminProcedure.input(premiumGrantSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const user = await readUser(db, input.userId);
      const subscriptionEnd = extendSubscriptionEnd(user.subscriptionEnd, input.durationDays);
      await db.update(users).set({ subscriptionEnd }).where(eq(users.id, user.id));
      await db.insert(transactions).values({
        userId: user.id,
        provider: "admin",
        merchantReference: `OFFERT-${Date.now()}-${randomBytes(4).toString("hex")}`,
        planId: OFFERED_PLAN_ID,
        amount: 0,
        status: "success",
      });
      await writeAudit(db, {
        actorUserId: ctx.user.id,
        action: "users.premium_granted",
        targetType: "user",
        targetId: String(user.id),
        metadata: { durationDays: input.durationDays, subscriptionEnd: subscriptionEnd.toISOString(), reason: input.reason || undefined },
      });
      return { userId: user.id, subscriptionEnd: subscriptionEnd.toISOString() };
    }),

    /** Met fin immédiatement au Premium d'un utilisateur. */
    revokePremium: adminProcedure.input(premiumRevokeSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const user = await readUser(db, input.userId);
      if (!isSubscriptionActive(user.subscriptionEnd)) throw new TRPCError({ code: "BAD_REQUEST", message: "Cet utilisateur n’a pas d’abonnement Premium actif." });
      await db.update(users).set({ subscriptionEnd: new Date() }).where(eq(users.id, user.id));
      await writeAudit(db, {
        actorUserId: ctx.user.id,
        action: "users.premium_revoked",
        targetType: "user",
        targetId: String(user.id),
        metadata: { previousEnd: serializeDate(user.subscriptionEnd), reason: input.reason || undefined },
      });
      return { userId: user.id };
    }),
  }),

  premium: router({
    /** Interroge de nouveau Ligdi Cash pour une transaction non confirmée. */
    recheck: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      try {
        const result = await recheckTransaction(db, input.id);
        await writeAudit(db, { actorUserId: ctx.user.id, action: "premium.rechecked", targetType: "transaction", targetId: String(input.id), metadata: { status: result.status, activated: result.activated } });
        return result;
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "TRANSACTION_NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND", message: "Transaction introuvable." });
        if (code === "NO_PROVIDER_TOKEN") throw new TRPCError({ code: "BAD_REQUEST", message: "Aucune facture Ligdi Cash n’est associée à cette transaction : réglez-la à la main." });
        throw new TRPCError({ code: "BAD_GATEWAY", message: "Ligdi Cash ne répond pas. Réessayez plus tard." });
      }
    }),

    /** Règle une transaction à la main (payée, échouée ou annulée), avec un motif obligatoire. */
    resolve: adminProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["success", "failed", "cancelled"]), note: z.string().trim().min(3, "Indiquez le motif.").max(500) })).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      try {
        const result = await resolveTransactionManually(db, input.id, input.status, { adminId: ctx.user.id, note: input.note });
        await writeAudit(db, { actorUserId: ctx.user.id, action: "premium.resolved", targetType: "transaction", targetId: String(input.id), metadata: { from: result.previousStatus, to: input.status, note: input.note } });
        return { id: input.id, status: input.status, activated: result.activated };
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "TRANSACTION_NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND", message: "Transaction introuvable." });
        if (code === "ALREADY_PAID") throw new TRPCError({ code: "BAD_REQUEST", message: "Cette transaction est déjà payée." });
        throw error;
      }
    }),

    /** Transactions (10 000 au plus) pour l'export comptable CSV, sans réponse brute du prestataire. */
    exportTransactions: adminProcedure.input(transactionListSchema.omit({ page: true, limit: true })).query(async ({ input }) => {
      const db = failIfNoDb(await getDb());
      const rows = await db
        .select({ id: transactions.id, createdAt: transactions.createdAt, merchantReference: transactions.merchantReference, provider: transactions.provider, planId: transactions.planId, amount: transactions.amount, currency: transactions.currency, status: transactions.status, userId: transactions.userId, userName: users.name, userPhone: users.phone })
        .from(transactions)
        .leftJoin(users, eq(transactions.userId, users.id))
        .where(input.status === "all" ? undefined : eq(transactions.status, input.status))
        .orderBy(desc(transactions.createdAt), desc(transactions.id))
        .limit(10_000);
      return rows.map((row) => ({ ...row, createdAt: serializeDate(row.createdAt) }));
    }),

    transactions: adminProcedure.input(transactionListSchema).query(async ({ input }) => {
      const db = failIfNoDb(await getDb());
      const where = input.status === "all" ? undefined : eq(transactions.status, input.status);
      const [rows, totals] = await Promise.all([
        db
          .select({
            id: transactions.id,
            userId: transactions.userId,
            provider: transactions.provider,
            merchantReference: transactions.merchantReference,
            planId: transactions.planId,
            amount: transactions.amount,
            currency: transactions.currency,
            status: transactions.status,
            createdAt: transactions.createdAt,
            updatedAt: transactions.updatedAt,
            userName: users.name,
            userPhone: users.phone,
            userEmail: users.email,
            subscriptionEnd: users.subscriptionEnd,
          })
          .from(transactions)
          .leftJoin(users, eq(transactions.userId, users.id))
          .where(where)
          .orderBy(desc(transactions.createdAt), desc(transactions.id))
          .limit(input.limit)
          .offset(offsetOf(input)),
        db.select({ value: count() }).from(transactions).where(where),
      ]);

      return {
        items: rows.map((transaction) => ({
          ...transaction,
          createdAt: serializeDate(transaction.createdAt),
          updatedAt: serializeDate(transaction.updatedAt),
          subscriptionEnd: serializeDate(transaction.subscriptionEnd),
        })),
        total: totals[0]?.value ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),
  }),

  system: router({
    /** État du serveur : base de données, migrations, données publiées, services configurés. */
    status: adminProcedure.query(() => readSystemStatus()),

    /** Met à jour tout de suite les pharmacies (annuaire) ou les structures de santé (OpenStreetMap). */
    refreshData: adminProcedure.input(z.object({ kind: z.enum(["pharmacies", "healthcare"]) })).mutation(async ({ ctx, input }) => {
      const result = await updateCachedDataset(input.kind, true);
      const db = await getDb();
      if (db) await writeAudit(db, { actorUserId: ctx.user.id, action: "data.refreshed", targetType: "admin_console", targetId: input.kind, metadata: { ok: result.ok } });
      return result;
    }),

    /** Sauvegarde JSON des données saisies dans la console. */
    backup: adminProcedure.query(async () => {
      try {
        return await readConsoleBackup();
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de données indisponible." });
      }
    }),
  }),

  audit: router({
    /** Journal (5 000 lignes au plus) pour l'export CSV. */
    export: adminProcedure.input(auditListSchema.omit({ page: true, limit: true })).query(async ({ input }) => {
      const db = failIfNoDb(await getDb());
      const rows = await db
        .select({ id: auditLogs.id, createdAt: auditLogs.createdAt, action: auditLogs.action, targetType: auditLogs.targetType, targetId: auditLogs.targetId, metadata: auditLogs.metadata, actorName: users.name, actorPhone: users.phone })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.actorUserId, users.id))
        .where(input.includeViews ? undefined : notLike(auditLogs.action, "%.viewed"))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(5_000);
      return rows.map((row) => ({ ...row, createdAt: serializeDate(row.createdAt) }));
    }),

    list: adminProcedure.input(auditListSchema).query(async ({ input }) => {
      const db = failIfNoDb(await getDb());
      const where = input.includeViews ? undefined : notLike(auditLogs.action, "%.viewed");
      const [rows, totals] = await Promise.all([
        db
          .select({
            id: auditLogs.id,
            action: auditLogs.action,
            targetType: auditLogs.targetType,
            targetId: auditLogs.targetId,
            metadata: auditLogs.metadata,
            createdAt: auditLogs.createdAt,
            actorUserId: auditLogs.actorUserId,
            actorName: users.name,
            actorPhone: users.phone,
            actorEmail: users.email,
          })
          .from(auditLogs)
          .leftJoin(users, eq(auditLogs.actorUserId, users.id))
          .where(where)
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(input.limit)
          .offset(offsetOf(input)),
        db.select({ value: count() }).from(auditLogs).where(where),
      ]);

      return {
        items: rows.map((event) => ({
          ...event,
          createdAt: serializeDate(event.createdAt),
          metadata: parseMetadata(event.metadata),
        })),
        total: totals[0]?.value ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),
  }),
});
