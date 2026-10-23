import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { auditLogs, contributions, placeVerifications, users, type PlaceVerificationRow } from "../drizzle/schema";
import { VERIFICATION_ISSUES, VERIFICATION_STATUSES } from "../shared/place-verification";
import { directoryUpsertSchema, listDirectoryCities, type AdminDirectoryItem } from "./admin-directory";
import { areaProcedure } from "./admin-auth";
import { writeAudit } from "./audit-log";
import { getDb } from "./db";
import { reloadDirectoryOverrides } from "./directory-overrides";
import { getCacheState, type CachedHealthPlace } from "./pharmagarde-cache";
import { analyzeDirectory, filterVerificationQueue, indexOsmPlaces, neighbours, osmCandidates, samePhone, sortVerificationQueue, type PendingReport } from "./place-verification";
import { router } from "./_core/trpc";

// Vérification des établissements une à une (console › Annuaire › Vérification). Droits de la page
// Établissements : un éditeur d'annuaire vérifie, un compte en lecture seule consulte.

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type VerificationDeps = {
  readMergedDirectory: () => Promise<AdminDirectoryItem[]>;
  saveDirectoryEntries: (db: Database, actorUserId: number, inputs: readonly z.infer<typeof directoryUpsertSchema>[], source: string) => Promise<string[]>;
};

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de données indisponible." });
  return db;
}

/** Vérifications enregistrées ; liste vide tant que la migration 0013 n'est pas appliquée. */
async function readChecks(db: Database): Promise<PlaceVerificationRow[]> {
  try {
    return await db.select().from(placeVerifications);
  } catch (error) {
    console.warn("[Vérification] Table place_verifications illisible (migration 0013 appliquée ?) :", error instanceof Error ? error.message : error);
    return [];
  }
}

async function readPendingReports(db: Database): Promise<PendingReport[]> {
  const rows = await db
    .select({ placeId: contributions.placeId, createdAt: contributions.createdAt })
    .from(contributions)
    .where(and(eq(contributions.kind, "problem"), eq(contributions.status, "new"), isNotNull(contributions.placeId)));
  return rows.filter((row): row is PendingReport => !!row.placeId);
}

function osmPlaces(): CachedHealthPlace[] {
  return Object.values(getCacheState("healthcare").byCity).flat();
}

const verificationIssueSchema = z.enum(VERIFICATION_ISSUES);

const queueSchema = z.object({
  status: z.enum([...VERIFICATION_STATUSES, "all"]).default("todo"),
  issue: verificationIssueSchema.optional(),
  kind: z.enum(["all", "pharmacy", "healthcare"]).default("all"),
  city: z.string().trim().max(96).optional(),
  search: z.string().trim().max(120).optional(),
});

const idSchema = z.object({ id: z.string().trim().min(3).max(128) });

const noteSchema = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((value) => value || null);

const validateSchema = z.object({
  id: z.string().trim().min(3).max(128),
  /** Informations vérifiées ; enregistrées dans l'annuaire si elles diffèrent de la fiche publiée. */
  name: z.string().trim().min(2).max(255),
  phone: z.string().trim().max(40).nullable(),
  establishmentType: z.string().trim().max(64).nullable(),
  address: z.string().trim().max(1000).nullable(),
  latitude: z.number().finite().nullable(),
  longitude: z.number().finite().nullable(),
  /** La position a été contrôlée (sur une carte, une image ou sur place). */
  positionConfirmed: z.boolean(),
  note: noteSchema,
});

const flagSchema = z.object({ id: z.string().trim().min(3).max(128), note: noteSchema });

function findItem(items: readonly AdminDirectoryItem[], id: string) {
  const item = items.find((candidate) => candidate.id === id && candidate.status === "active");
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Établissement introuvable ou archivé." });
  return item;
}

async function saveCheck(db: Database, input: { id: string; kind: AdminDirectoryItem["kind"]; status: "verified" | "needs_visit"; positionConfirmed: boolean; note: string | null; checkedBy: number }) {
  const values = { ...input, checkedAt: new Date() };
  await db.insert(placeVerifications).values(values).onDuplicateKeyUpdate({ set: { status: values.status, positionConfirmed: values.positionConfirmed, note: values.note, checkedBy: values.checkedBy, checkedAt: values.checkedAt } });
}

export function createVerificationRouter(deps: VerificationDeps) {
  const procedure = areaProcedure("directory");

  async function readQueue(db: Database) {
    const [items, checks, reports] = await Promise.all([deps.readMergedDirectory(), readChecks(db), readPendingReports(db)]);
    return { items, checks, entries: analyzeDirectory({ items, osm: osmPlaces(), checks, reports }) };
  }

  return router({
    /** File de vérification filtrée, avec les compteurs par état et par problème. */
    queue: procedure.input(queueSchema).query(async ({ input }) => {
      const db = await requireDb();
      const { items, entries } = await readQueue(db);
      const scope = filterVerificationQueue(entries, { kind: input.kind, city: input.city });
      const byStatus = Object.fromEntries(VERIFICATION_STATUSES.map((status) => [status, scope.filter((entry) => entry.status === status).length]));
      const statusScope = filterVerificationQueue(scope, { status: input.status });
      const byIssue = Object.fromEntries(VERIFICATION_ISSUES.map((issue) => [issue, statusScope.filter((entry) => entry.issues.includes(issue)).length]));
      const filtered = sortVerificationQueue(filterVerificationQueue(statusScope, { issue: input.issue, search: input.search }));
      return { items: filtered, total: scope.length, byStatus, byIssue, cities: listDirectoryCities(items).map((city) => city.name) };
    }),

    /** Fiche complète : positions concurrentes, voisins, signalements et historique. */
    detail: procedure.input(idSchema).query(async ({ input }) => {
      const db = await requireDb();
      const { items, checks, entries } = await readQueue(db);
      const item = findItem(items, input.id);
      const entry = entries.find((candidate) => candidate.id === item.id)!;
      const check = checks.find((candidate) => candidate.id === item.id);
      const [reports, history, checker] = await Promise.all([
        db
          .select({ id: contributions.id, createdAt: contributions.createdAt, category: contributions.category, subject: contributions.subject, message: contributions.message, phone: contributions.phone, latitude: contributions.latitude, longitude: contributions.longitude })
          .from(contributions)
          .where(and(eq(contributions.kind, "problem"), eq(contributions.status, "new"), eq(contributions.placeId, item.id)))
          .orderBy(desc(contributions.createdAt))
          .limit(10),
        db
          .select({ id: auditLogs.id, action: auditLogs.action, createdAt: auditLogs.createdAt, metadata: auditLogs.metadata, actorName: users.name })
          .from(auditLogs)
          .leftJoin(users, eq(auditLogs.actorUserId, users.id))
          .where(eq(auditLogs.targetId, item.id))
          .orderBy(desc(auditLogs.createdAt))
          .limit(10),
        check ? db.select({ name: users.name }).from(users).where(eq(users.id, check.checkedBy)).limit(1) : Promise.resolve([]),
      ]);
      return {
        item,
        entry,
        checkedByName: checker[0]?.name ?? null,
        osm: osmCandidates(item, indexOsmPlaces(osmPlaces())),
        neighbours: neighbours(item, items),
        samePhone: samePhone(item, items).map((other) => ({ id: other.id, name: other.name, latitude: other.latitude, longitude: other.longitude })),
        reports: reports.map((report) => ({ ...report, createdAt: report.createdAt.toISOString() })),
        history: history.map((row) => ({ id: row.id, action: row.action, createdAt: row.createdAt.toISOString(), actorName: row.actorName })),
      };
    }),

    /** Valide la fiche : enregistre les corrections éventuelles, puis la marque vérifiée. */
    validate: procedure.input(validateSchema).mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const items = await deps.readMergedDirectory();
      const item = findItem(items, input.id);
      const next = { ...item, name: input.name, phone: input.phone || null, establishmentType: item.kind === "healthcare" ? input.establishmentType : item.establishmentType, address: input.address || null, latitude: input.latitude, longitude: input.longitude };
      const changed = (["name", "phone", "establishmentType", "address", "latitude", "longitude"] as const).filter((key) => (next[key] ?? null) !== (item[key] ?? null));
      if (changed.length) {
        const upsert = directoryUpsertSchema.safeParse({
          id: item.id,
          kind: item.kind,
          city: item.city,
          name: next.name,
          phone: next.phone,
          address: next.address,
          latitude: next.latitude,
          longitude: next.longitude,
          dutyGroup: item.dutyGroup,
          establishmentType: next.establishmentType,
          openingHours: item.openingHours,
          insurances: item.insurances,
        });
        if (!upsert.success) throw new TRPCError({ code: "BAD_REQUEST", message: upsert.error.issues[0]?.message ?? "Fiche invalide." });
        await deps.saveDirectoryEntries(db, ctx.user.id, [upsert.data], "verification");
      }
      const positionConfirmed = input.positionConfirmed && next.latitude !== null && next.longitude !== null;
      await saveCheck(db, { id: item.id, kind: item.kind, status: "verified", positionConfirmed, note: input.note, checkedBy: ctx.user.id });
      await writeAudit(db, { actorUserId: ctx.user.id, action: "directory.verified", targetType: item.kind, targetId: item.id, metadata: { name: item.name, city: item.city, positionConfirmed, corrections: changed.join(", ") || null, note: input.note } });
      await reloadDirectoryOverrides();
      return { id: item.id, changed };
    }),

    /** À vérifier sur place (position douteuse, établissement peut-être fermé…). */
    flag: procedure.input(flagSchema).mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const item = findItem(await deps.readMergedDirectory(), input.id);
      await saveCheck(db, { id: item.id, kind: item.kind, status: "needs_visit", positionConfirmed: false, note: input.note, checkedBy: ctx.user.id });
      await writeAudit(db, { actorUserId: ctx.user.id, action: "directory.needs_visit", targetType: item.kind, targetId: item.id, metadata: { name: item.name, city: item.city, note: input.note } });
      await reloadDirectoryOverrides();
      return { id: item.id };
    }),

    /** Remet la fiche dans la file « à vérifier ». */
    reopen: procedure.input(idSchema).mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await db.delete(placeVerifications).where(eq(placeVerifications.id, input.id));
      await writeAudit(db, { actorUserId: ctx.user.id, action: "directory.verification_reopened", targetType: "place", targetId: input.id });
      await reloadDirectoryOverrides();
      return { id: input.id };
    }),
  });
}
