import { directoryEntries, type DirectoryEntry } from "../drizzle/schema";
import { normalizeInsurerIds } from "../lib/pharmagarde/insurances";
import { parseWeeklyHours } from "../lib/pharmagarde/opening-hours";
import { getDb } from "./db";
import type { CachedHealthPlace, CachedPlaceCategory, LocalEstablishmentType } from "./pharmagarde-cache";

/**
 * Surcharges de l'annuaire saisies dans la console d'administration (table directory_entries),
 * appliquées aux routes publiques /pharmacies et /healthcare.
 *
 * Les surcharges sont gardées en mémoire et relues après chaque modification faite par la console,
 * ainsi qu'au plus tard toutes les minutes pour qu'une autre instance du serveur les voie aussi.
 */
const RELOAD_INTERVAL_MS = 60_000;

const HEALTHCARE_TYPES: readonly LocalEstablishmentType[] = ["CHU", "CHR", "CMA", "CSPS", "Clinique", "Hôpital", "Centre de santé"];

let snapshot: DirectoryEntry[] = [];
let loadedAt = 0;
let generation = 0;
let pendingReload: Promise<DirectoryEntry[]> | null = null;

/** Relit les surcharges en base. En cas d'erreur, la dernière version lue reste en service. */
export async function reloadDirectoryOverrides(): Promise<DirectoryEntry[]> {
  const current = ++generation;
  const db = await getDb();
  let rows: DirectoryEntry[] | null = [];
  if (db) {
    try {
      rows = await db.select().from(directoryEntries);
    } catch (error) {
      rows = null;
      console.warn("[Annuaire] Surcharges administrées illisibles (migration 0006 appliquée ?), dernière version conservée :", error instanceof Error ? error.message : error);
    }
  }
  // Une lecture lancée avant une modification ne doit pas écraser une lecture plus récente.
  if (current === generation) {
    if (rows) snapshot = rows;
    loadedAt = Date.now();
  }
  return snapshot;
}

export async function getDirectoryOverrides(): Promise<readonly DirectoryEntry[]> {
  if (Date.now() - loadedAt >= RELOAD_INTERVAL_MS) {
    pendingReload ??= reloadDirectoryOverrides().finally(() => {
      pendingReload = null;
    });
    await pendingReload;
  }
  return snapshot;
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function healthcareType(override: DirectoryEntry, current?: CachedHealthPlace): LocalEstablishmentType {
  const requested = HEALTHCARE_TYPES.find((type) => type === override.establishmentType);
  return requested ?? current?.type ?? "Centre de santé";
}

/** Une surcharge active est un enregistrement complet : ses champs vides effacent ceux de la source. */
function toPlace(override: DirectoryEntry, category: CachedPlaceCategory, current?: CachedHealthPlace): CachedHealthPlace {
  return {
    ...current,
    id: override.id,
    type: category === "pharmacy" ? "Pharmacie" : healthcareType(override, current),
    category,
    name: override.name ?? current?.name ?? override.id,
    city: override.city ?? current?.city,
    phone: override.phone ?? undefined,
    address: override.address ?? undefined,
    latitude: override.latitude ?? undefined,
    longitude: override.longitude ?? undefined,
    dutyGroup: category === "pharmacy" ? override.dutyGroup ?? null : undefined,
    serviceHours: parseWeeklyHours(override.openingHours) ?? undefined,
    insurances: normalizeInsurerIds(override.insurances),
    source: "admin",
    updatedAt: toIso(override.updatedAt) ?? current?.updatedAt,
  };
}

/**
 * Applique les surcharges à une liste publique : un archivage retire l'établissement, une
 * modification le remplace à sa place, un ajout est placé en fin de liste. Une surcharge d'un autre
 * type (pharmacie devenue structure de santé, ou l'inverse) retire l'élément de cette liste.
 */
export function applyDirectoryOverrides(items: readonly CachedHealthPlace[], overrides: readonly DirectoryEntry[], category: CachedPlaceCategory): CachedHealthPlace[] {
  if (overrides.length === 0) return [...items];
  const overridesById = new Map(overrides.map((override) => [override.id, override]));
  const baseIds = new Set(items.map((item) => item.id));
  const isPublished = (override: DirectoryEntry) => override.status === "active" && override.kind === category;

  const result: CachedHealthPlace[] = [];
  for (const item of items) {
    const override = overridesById.get(item.id);
    if (!override) result.push(item);
    else if (isPublished(override)) result.push(toPlace(override, category, item));
  }
  for (const override of overrides) {
    if (!baseIds.has(override.id) && isPublished(override)) result.push(toPlace(override, category));
  }
  return result;
}
