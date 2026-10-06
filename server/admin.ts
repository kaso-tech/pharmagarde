import { TRPCError } from "@trpc/server";
import { count, desc, eq, gt, isNotNull, like, notLike, or } from "drizzle-orm";
import { z } from "zod";

import { auditLogs, directoryEntries, transactions, users } from "../drizzle/schema";
import { getDb } from "./db";
import { reloadDirectoryOverrides } from "./directory-overrides";
import { directoryArchiveSchema, directoryRestoreSchema, directoryUpsertSchema, filterAdminDirectoryItems, getBaseAdminDirectoryItems, listDirectoryCities, mergeAdminDirectoryItems, normalizeDirectoryUpsert } from "./admin-directory";
import { adminProcedure, router } from "./_core/trpc";

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
});

const auditListSchema = pageSchema.extend({
  /** Les consultations de pages sont journalisées mais masquées par défaut. */
  includeViews: z.boolean().default(false),
});

const userListSchema = pageSchema.extend({
  search: z.string().trim().max(120).optional(),
});

const activitySchema = z.object({
  area: z.enum(["dashboard", "directory", "users", "premium", "audit"]),
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

async function writeAudit(
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

function offsetOf(input: { page: number; limit: number }) {
  return (input.page - 1) * input.limit;
}

async function readMergedDirectory() {
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

export const adminRouter = router({
  access: adminProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    role: "admin" as const,
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

  dashboard: adminProcedure.query(async () => {
    const db = failIfNoDb(await getDb());
    const [allUsers, verifiedUsers, premiumUsers, allTransactions, pendingTransactions, baseItems, overrides] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(users).where(isNotNull(users.phoneVerifiedAt)),
      db.select({ value: count() }).from(users).where(gt(users.subscriptionEnd, new Date())),
      db.select({ value: count() }).from(transactions),
      db.select({ value: count() }).from(transactions).where(eq(transactions.status, "pending")),
      getBaseAdminDirectoryItems(),
      db.select().from(directoryEntries),
    ]);

    const directoryCount = mergeAdminDirectoryItems(baseItems, overrides).filter((item) => item.status === "active").length;
    return {
      users: allUsers[0]?.value ?? 0,
      verifiedUsers: verifiedUsers[0]?.value ?? 0,
      premiumUsers: premiumUsers[0]?.value ?? 0,
      transactions: allTransactions[0]?.value ?? 0,
      pendingTransactions: pendingTransactions[0]?.value ?? 0,
      directoryEntries: directoryCount,
    };
  }),

  directory: router({
    list: adminProcedure.input(directoryListSchema).query(({ input }) => readAdminDirectory(input)),

    upsert: adminProcedure.input(directoryUpsertSchema).mutation(async ({ ctx, input }) => {
      const db = failIfNoDb(await getDb());
      const knownCities = listDirectoryCities(await readMergedDirectory()).map((city) => city.name);
      const entry = normalizeDirectoryUpsert(input, knownCities);
      await db.transaction(async (tx) => {
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
            },
          });
        await tx.insert(auditLogs).values({
          actorUserId: ctx.user.id,
          action: "directory.upserted",
          targetType: entry.kind,
          targetId: entry.id,
          metadata: safeMetadata({ kind: entry.kind, city: entry.city, source: "admin_console" }),
        });
      });
      // Publication immédiate dans /pharmacies et /healthcare.
      await reloadDirectoryOverrides();
      return { id: entry.id, status: "active" as const };
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

  users: router({
    list: adminProcedure.input(userListSchema).query(async ({ input }) => {
      const db = failIfNoDb(await getDb());
      const pattern = input.search ? `%${input.search.replace(/[\\%_]/g, "\\$&")}%` : null;
      const where = pattern ? or(like(users.name, pattern), like(users.email, pattern), like(users.phone, pattern)) : undefined;
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
          createdAt: serializeDate(user.createdAt),
          lastSignedIn: serializeDate(user.lastSignedIn),
          verificationStatus: user.phoneVerifiedAt ? "verified" as const : "unverified" as const,
        })),
        total: totals[0]?.value ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),
  }),

  premium: router({
    transactions: adminProcedure.input(pageSchema).query(async ({ input }) => {
      const db = failIfNoDb(await getDb());
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
          .orderBy(desc(transactions.createdAt), desc(transactions.id))
          .limit(input.limit)
          .offset(offsetOf(input)),
        db.select({ value: count() }).from(transactions),
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

  audit: router({
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
