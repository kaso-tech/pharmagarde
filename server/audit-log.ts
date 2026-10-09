import { auditLogs } from "../drizzle/schema";
import type { getDb } from "./db";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Metadata = Record<string, string | number | boolean | null | undefined>;

/** Valeurs avant/après des champs modifiés, affichées dans le détail du journal. */
export type AuditChanges = Record<string, { before: unknown; after: unknown }>;

const MAX_VALUE_LENGTH = 400;

function compact(value: unknown): unknown {
  if (value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
  if (value && typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : value;
  }
  return value;
}

/** Champs dont la valeur change entre `before` et `after` (tous les champs d'`after` si `fields` est omis). */
export function diffChanges(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>, fields: readonly string[] = Object.keys(after)): AuditChanges {
  const changes: AuditChanges = {};
  for (const field of fields) {
    const previous = compact(before?.[field]);
    const next = compact(after[field]);
    if (JSON.stringify(previous) !== JSON.stringify(next)) changes[field] = { before: previous, after: next };
  }
  return changes;
}

export function safeMetadata(value: Metadata, changes?: AuditChanges) {
  const entries = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
  return JSON.stringify(changes && Object.keys(changes).length ? { ...entries, changes } : entries);
}

/** Journal d'audit de la console : qui a fait quoi, sur quelle cible. */
export async function writeAudit(
  db: Database,
  input: { actorUserId: number; action: string; targetType: string; targetId?: string | null; metadata?: Metadata; changes?: AuditChanges },
) {
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: input.metadata || input.changes ? safeMetadata(input.metadata ?? {}, input.changes) : null,
  });
}

