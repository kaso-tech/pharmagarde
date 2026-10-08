import { auditLogs } from "../drizzle/schema";
import type { getDb } from "./db";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Metadata = Record<string, string | number | boolean | null | undefined>;

export function safeMetadata(value: Metadata) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)));
}

/** Journal d'audit de la console : qui a fait quoi, sur quelle cible. */
export async function writeAudit(
  db: Database,
  input: { actorUserId: number; action: string; targetType: string; targetId?: string | null; metadata?: Metadata },
) {
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: input.metadata ? safeMetadata(input.metadata) : null,
  });
}

