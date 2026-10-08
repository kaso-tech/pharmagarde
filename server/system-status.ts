import { readFileSync } from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";

import { announcements, cities, cityHours, directoryEntries, dutyExceptions, dutyRotations, insurers, medicineCategoryLabels, medicineOverrides, premiumPlans } from "../drizzle/schema";
import { getDb } from "./db";
import { getMedicinesCatalog, getPublishedMedicines } from "./medicines-data";
import { getCacheState, type CacheKind } from "./pharmagarde-cache";
import { loadPharmacyDirectory } from "./pharmacy-directory";

type Check = { key: string; label: string; ok: boolean; detail: string };

function configured(...names: string[]) {
  return names.every((name) => !!process.env[name]?.trim());
}

/** Migrations attendues (journal drizzle livré avec le serveur). */
function expectedMigrations() {
  try {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries?: { tag: string }[] };
    return (journal.entries ?? []).map((entry) => entry.tag);
  } catch {
    return null;
  }
}

function cacheSummary(kind: CacheKind) {
  const state = getCacheState(kind);
  const items = Object.values(state.byCity).reduce((total, list) => total + list.length, 0);
  return { items, updatedAt: state.updatedAt, expiresAt: state.expiresAt, lastRefreshAttemptAt: state.lastRefreshAttemptAt, lastError: state.lastError ?? null };
}

/** État du serveur pour la page Système de la console : base, migrations, données, services, exécution. */
export async function readSystemStatus() {
  const db = await getDb();
  let database: { ok: boolean; latencyMs: number | null; error: string | null } = { ok: false, latencyMs: null, error: "DATABASE_URL non configurée" };
  let appliedMigrations: number | null = null;
  if (db) {
    const started = Date.now();
    try {
      await db.execute(sql`select 1`);
      database = { ok: true, latencyMs: Date.now() - started, error: null };
      const [rows] = (await db.execute(sql`select count(*) as applied from __drizzle_migrations`)) as unknown as [{ applied: number | string }[]];
      appliedMigrations = Number(rows?.[0]?.applied ?? 0);
    } catch (error) {
      if (!database.ok) database = { ok: false, latencyMs: null, error: error instanceof Error ? error.message : "Base injoignable" };
    }
  }
  const expected = expectedMigrations();
  const pending = expected && appliedMigrations !== null ? expected.slice(appliedMigrations) : null;

  const directory = await loadPharmacyDirectory().catch(() => null);
  let medicines: { count: number; updatedAt: string | null } | null = null;
  try {
    const catalog = getMedicinesCatalog();
    medicines = { count: getPublishedMedicines().length, updatedAt: catalog.updatedAt || null };
  } catch {
    medicines = null;
  }

  const services: Check[] = [
    { key: "jwt", label: "Sessions (JWT_SECRET)", ok: configured("JWT_SECRET"), detail: configured("JWT_SECRET") ? "Configuré" : "Manquant : aucune connexion possible" },
    { key: "sms", label: "Envoi des SMS", ok: configured("SMS_WEBHOOK_URL"), detail: configured("SMS_WEBHOOK_URL") ? "Webhook SMS configuré" : "SMS_WEBHOOK_URL manquante : codes de vérification non envoyés" },
    { key: "ligdicash", label: "Paiement Ligdi Cash", ok: configured("LIGDI_BASE_URL", "LIGDI_API_TOKEN"), detail: configured("LIGDI_BASE_URL", "LIGDI_API_TOKEN") ? "Identifiants configurés" : "LIGDI_BASE_URL ou LIGDI_API_TOKEN manquant : paiement impossible" },
    { key: "cors", label: "Origines autorisées (CORS)", ok: configured("CORS_ALLOWED_ORIGINS"), detail: process.env.CORS_ALLOWED_ORIGINS?.trim() || "Non renseignées : valeurs par défaut" },
    { key: "admin-token", label: "Jeton de mise à jour des données", ok: configured("PHARMAGARDE_ADMIN_TOKEN"), detail: configured("PHARMAGARDE_ADMIN_TOKEN") ? "Configuré" : "Absent : la mise à jour automatique par jeton est fermée (le bouton de la console reste disponible)" },
  ];

  return {
    serverTime: new Date().toISOString(),
    database,
    migrations: { expected: expected?.length ?? null, applied: appliedMigrations, pending, latest: expected?.at(-1) ?? null },
    data: {
      pharmacyDirectory: directory ? { count: directory.pharmacies.length, updatedAt: directory.updatedAt } : null,
      medicines,
      pharmaciesCache: cacheSummary("pharmacies"),
      healthcareCache: cacheSummary("healthcare"),
    },
    services,
    runtime: {
      node: process.version,
      environment: process.env.NODE_ENV ?? "development",
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  };
}

/** Sauvegarde JSON de tout ce que la console enregistre en base (hors comptes et paiements). */
export async function readConsoleBackup() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const [entries, hours, rotations, exceptions, medicineEdits, categoryLabels, insurerRows, cityRows, announcementRows, planRows] = await Promise.all([
    db.select().from(directoryEntries),
    db.select().from(cityHours),
    db.select().from(dutyRotations),
    db.select().from(dutyExceptions),
    db.select().from(medicineOverrides),
    db.select().from(medicineCategoryLabels),
    db.select().from(insurers),
    db.select().from(cities),
    db.select().from(announcements),
    db.select().from(premiumPlans),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    directoryEntries: entries,
    cityHours: hours,
    dutyRotations: rotations,
    dutyExceptions: exceptions,
    medicineOverrides: medicineEdits,
    medicineCategoryLabels: categoryLabels,
    insurers: insurerRows,
    cities: cityRows,
    announcements: announcementRows,
    premiumPlans: planRows,
  };
}
