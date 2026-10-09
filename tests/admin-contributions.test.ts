import { describe, expect, it, vi } from "vitest";

import { adminRoles, adminSessions, auditLogs, contributions, users } from "../drizzle/schema";

// Le double facteur a ses propres tests (tests/admin-security-roles.test.ts).
process.env.ADMIN_SECOND_FACTOR = "off";

process.env.JWT_SECRET ||= "secret-de-test-pour-les-jetons-de-session";

type Write = { op: "update" | "insert"; table: unknown; values: Record<string, unknown> };

/** Base factice : chaque requête de lecture attendue renvoie la prochaine réponse prévue ; les écritures sont enregistrées. */
function fakeDb(reads: unknown[][]) {
  const queue = [...reads];
  const writes: Write[] = [];
  const chain = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    let table: unknown;
    for (const method of ["where", "leftJoin", "orderBy", "limit", "offset", "for"]) builder[method] = () => builder;
    builder.from = (source: unknown) => {
      table = source;
      return builder;
    };
    // Rôles et accès de la console : absents (super-admin), sans consommer les réponses prévues.
    builder.then = (resolve: (value: unknown) => void) => resolve(table === adminRoles || table === adminSessions ? [] : (queue.shift() ?? []));
    return builder;
  };
  const db = {
    select: () => chain(),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { writes.push({ op: "update", table, values }); return [{ affectedRows: 1 }]; } }) }),
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => { writes.push({ op: "insert", table, values }); return Object.assign(Promise.resolve(), { onDuplicateKeyUpdate: async () => undefined }); } }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db, writes };
}

const getDb = vi.fn();
const getUserByOpenId = vi.fn();
vi.mock("../server/db", () => ({ getDb: () => getDb(), getUserByOpenId: (openId: string) => getUserByOpenId(openId), deleteUserAccount: vi.fn() }));

const { appRouter } = await import("../server/routers");
const { sdk } = await import("../server/_core/sdk");

function caller(user: { id: number; role: "user" | "admin" } | null, ip = "10.0.0.1") {
  return appRouter.createCaller({
    req: { ip, headers: {}, socket: {} } as never,
    res: {} as never,
    user: user ? ({ ...user, openId: `local:+2267000000${user.id}` } as never) : null,
  });
}

const place = { placeKind: "pharmacy" as const, name: "Pharmacie Wend-Panga", city: "Ouagadougou", address: "Tampouy, face au marché", phone: "70 11 22 33", latitude: 12.39, longitude: -1.55 };

describe("contributions envoyées depuis l'application", () => {
  it("enregistre une proposition d'établissement, téléphone normalisé, sans compte", async () => {
    const fake = fakeDb([]);
    getDb.mockResolvedValue(fake.db);
    await expect(caller(null, "10.0.1.1").contributions.proposePlace(place)).resolves.toEqual({ ok: true });
    expect(fake.writes[0]).toMatchObject({ op: "insert", table: contributions, values: { kind: "new_place", placeKind: "pharmacy", name: "Pharmacie Wend-Panga", phone: "+226 70 11 22 33", userId: null } });
  });

  it("rattache un signalement à la fiche concernée et à son auteur connecté", async () => {
    const fake = fakeDb([]);
    getDb.mockResolvedValue(fake.db);
    await caller({ id: 7, role: "user" }, "10.0.1.2").contributions.reportProblem({ category: "Pharmacie fermée", subject: "Fermée depuis un mois", message: "La pharmacie a fermé ses portes.", placeId: "ph-ouagadougou-wend-panga", placeName: "Pharmacie Wend-Panga", placeKind: "pharmacy" });
    expect(fake.writes[0]?.values).toMatchObject({ kind: "problem", userId: 7, placeId: "ph-ouagadougou-wend-panga", category: "Pharmacie fermée" });
  });

  it("refuse une proposition incomplète et limite les envois à 10 par heure et par adresse", async () => {
    getDb.mockResolvedValue(fakeDb([]).db);
    await expect(caller(null, "10.0.1.3").contributions.proposePlace({ ...place, name: "P" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (let index = 0; index < 10; index += 1) {
      getDb.mockResolvedValue(fakeDb([]).db);
      await caller(null, "10.0.1.4").contributions.proposePlace(place);
    }
    await expect(caller(null, "10.0.1.4").contributions.proposePlace(place)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("console · file de modération", () => {
  it("réserve la file aux administrateurs", async () => {
    await expect(caller({ id: 7, role: "user" }).admin.contributions.counts()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("clôt un signalement avec une note et le journalise", async () => {
    const fake = fakeDb([[{ id: 3, kind: "problem", status: "new" }]]);
    getDb.mockResolvedValue(fake.db);
    await caller({ id: 1, role: "admin" }).admin.contributions.close({ id: 3, status: "resolved", note: "Téléphone corrigé" });
    expect(fake.writes[0]).toMatchObject({ op: "update", table: contributions, values: { status: "resolved", adminNote: "Téléphone corrigé", handledBy: 1 } });
    expect(fake.writes[1]).toMatchObject({ table: auditLogs, values: { action: "contribution.resolved", targetId: "3" } });
  });

  it("ne traite pas deux fois la même contribution", async () => {
    getDb.mockResolvedValue(fakeDb([[{ id: 4, kind: "new_place", status: "accepted" }]]).db);
    await expect(caller({ id: 1, role: "admin" }).admin.contributions.close({ id: 4, status: "rejected" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    getDb.mockResolvedValue(fakeDb([[{ id: 4, kind: "new_place", status: "accepted" }]]).db);
    await expect(caller({ id: 1, role: "admin" }).admin.contributions.acceptPlace({ id: 4, entry: { kind: "pharmacy", city: "Ouagadougou", name: "Pharmacie X", latitude: 12.3, longitude: -1.5 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("console · actions sur les comptes", () => {
  it("suspend un compte : sessions fermées et action journalisée", async () => {
    const fake = fakeDb([[{ id: 9, role: "user", loginMethod: "phone_password" }]]);
    getDb.mockResolvedValue(fake.db);
    await caller({ id: 1, role: "admin" }).admin.users.setSuspended({ userId: 9, suspended: true, reason: "Fraude" });
    const update = fake.writes.find((write) => write.table === users)!;
    expect(update.values.suspendedAt).toBeInstanceOf(Date);
    expect(update.values.sessionsValidAfter).toBe(update.values.suspendedAt);
    expect(fake.writes.find((write) => write.table === auditLogs)?.values).toMatchObject({ action: "users.suspended", targetId: "9" });
  });

  it("interdit d'agir sur son propre compte et exige la confirmation de suppression", async () => {
    const admin = caller({ id: 1, role: "admin" });
    await expect(admin.admin.users.setSuspended({ userId: 1, suspended: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.admin.users.setRole({ userId: 1, role: "user" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.admin.users.remove({ userId: 9, confirm: false as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuse les sessions d'un compte suspendu", async () => {
    const token = await sdk.createSessionToken("local:+22670000009", { name: "x" });
    getUserByOpenId.mockResolvedValue({ id: 9, openId: "local:+22670000009", sessionsValidAfter: null, suspendedAt: new Date() });
    await expect(sdk.authenticateRequest({ headers: { authorization: `Bearer ${token}` } } as never)).rejects.toThrow(/suspended/i);
    getUserByOpenId.mockResolvedValue({ id: 9, openId: "local:+22670000009", sessionsValidAfter: null, suspendedAt: null });
    await expect(sdk.authenticateRequest({ headers: { authorization: `Bearer ${token}` } } as never)).resolves.toMatchObject({ id: 9 });
  });
});

describe("console · paiements en attente", () => {
  it("exige un motif pour un règlement manuel et signale une transaction inconnue", async () => {
    const admin = caller({ id: 1, role: "admin" });
    await expect(admin.admin.premium.resolve({ id: 5, status: "success", note: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    getDb.mockResolvedValue(fakeDb([[]]).db);
    await expect(admin.admin.premium.resolve({ id: 5, status: "success", note: "Reçu Orange Money" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
