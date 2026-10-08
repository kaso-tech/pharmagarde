import { z } from "zod";

import { dutyExceptions, dutyRotations, type DutyExceptionRow, type DutyRotationRow } from "../drizzle/schema";
import { getDb } from "./db";
import { DUTY_ROTATIONS, dutyCityKey, exceptionKey, groupTurns, type DutyExceptions, type DutyRotation } from "./duty-roster";

/**
 * Programmation des gardes en service : celle par défaut (server/duty-roster.ts), remplacée ville par
 * ville par celle saisie dans la console (table duty_rotations), plus les exceptions de semaine
 * (table duty_exceptions). Gardée en mémoire, relue après chaque modification et au plus tard toutes
 * les minutes, comme les horaires des villes.
 */
const RELOAD_INTERVAL_MS = 60_000;

export const dutyTurnListSchema = z.array(z.object({ label: z.string().trim().min(1).max(60), pharmacyIds: z.array(z.string().trim().min(1).max(128)).max(200) })).min(2).max(12);

export type DutyConfig = {
  rotations: readonly DutyRotation[];
  exceptions: DutyExceptions;
  /** Programmation saisie dans la console, par clé de ville. */
  custom: ReadonlyMap<string, DutyRotationRow>;
  exceptionRows: readonly DutyExceptionRow[];
};

/** Programmation d'une ligne de la console ; null pour une ville désactivée ou une ligne illisible. */
export function rotationFromRow(row: DutyRotationRow): DutyRotation | null {
  const reference = { start: row.referenceStart, turnIndex: row.referenceTurnIndex };
  if (row.mode === "groups" && row.groupCount && row.groupCount >= 2) return { city: row.city, reference, turns: groupTurns(row.groupCount) };
  if (row.mode === "lists" && row.turns) {
    try {
      const turns = dutyTurnListSchema.parse(JSON.parse(row.turns));
      return { city: row.city, reference, turns };
    } catch {
      return null;
    }
  }
  return null;
}

export function buildDutyConfig(rows: readonly DutyRotationRow[], exceptionRows: readonly DutyExceptionRow[]): DutyConfig {
  const custom = new Map(rows.map((row) => [dutyCityKey(row.city), row]));
  const rotations: DutyRotation[] = [];
  for (const rotation of DUTY_ROTATIONS) {
    const row = custom.get(dutyCityKey(rotation.city));
    if (!row) rotations.push(rotation);
    else {
      const replaced = rotationFromRow(row);
      if (replaced) rotations.push(replaced);
    }
  }
  const defaults = new Set(DUTY_ROTATIONS.map((rotation) => dutyCityKey(rotation.city)));
  for (const row of rows) {
    if (defaults.has(dutyCityKey(row.city))) continue;
    const added = rotationFromRow(row);
    if (added) rotations.push(added);
  }

  const exceptions = new Map<string, { add: Set<string>; remove: Set<string> }>();
  for (const row of exceptionRows) {
    const key = exceptionKey(row.city, row.weekStart);
    const entry = exceptions.get(key) ?? { add: new Set<string>(), remove: new Set<string>() };
    entry[row.action].add(row.pharmacyId);
    exceptions.set(key, entry);
  }
  return { rotations, exceptions, custom, exceptionRows };
}

let snapshot: DutyConfig = buildDutyConfig([], []);
let loadedAt = 0;
let generation = 0;
let pendingReload: Promise<void> | null = null;

export async function reloadDutyConfig() {
  const current = ++generation;
  const db = await getDb();
  let next: DutyConfig | null = buildDutyConfig([], []);
  if (db) {
    try {
      const [rows, exceptionRows] = await Promise.all([db.select().from(dutyRotations), db.select().from(dutyExceptions)]);
      next = buildDutyConfig(rows, exceptionRows);
    } catch (error) {
      next = null;
      console.warn("[Gardes] Programmation illisible (migration 0010 appliquée ?), dernière version conservée :", error instanceof Error ? error.message : error);
    }
  }
  if (current === generation) {
    if (next) snapshot = next;
    loadedAt = Date.now();
  }
}

/** Programmation à jour (relue si elle date de plus d'une minute). */
export async function getDutyConfig() {
  if (Date.now() - loadedAt >= RELOAD_INTERVAL_MS) {
    pendingReload ??= reloadDutyConfig().finally(() => {
      pendingReload = null;
    });
    await pendingReload;
  }
  return snapshot;
}

/** Dernière programmation chargée, sans attendre (par défaut tant que rien n'a été lu). */
export function currentDutyConfig() {
  return snapshot;
}
