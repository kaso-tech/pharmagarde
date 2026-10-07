import { describe, expect, it, vi } from "vitest";

import { auditLogs, transactions, users } from "../drizzle/schema";

process.env.JWT_SECRET ||= "secret-de-test-pour-les-jetons-de-session";

/** Base factice : chaque lecture renvoie la prochaine réponse prévue, les écritures sont enregistrées. */
function fakeDb(reads: unknown[][]) {
  const queue = [...reads];
  const writes: { op: "update" | "insert"; table: unknown; values: Record<string, unknown> }[] = [];
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: async () => queue.shift() ?? [],
  };
  return {
    writes,
    db: {
      select: () => builder,
      update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => void writes.push({ op: "update", table, values }) }) }),
      insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => void writes.push({ op: "insert", table, values }) }),
    },
  };
}

const getDb = vi.fn();
vi.mock("../server/db", () => ({ getDb: () => getDb() }));

const { appRouter } = await import("../server/routers");
const { hashPassword, verifyPassword } = await import("../server/_core/local-auth");
const { extendSubscriptionEnd } = await import("../server/premium");
const { createAttemptLimiter } = await import("../server/admin-account");
const { sdk } = await import("../server/_core/sdk");

function caller(userId: number, role: "user" | "admin" = "admin") {
  const cookies: Record<string, string> = {};
  const ctx = {
    req: { hostname: "localhost", protocol: "http", headers: {}, get: () => undefined } as never,
    res: { cookie: (name: string, value: string) => void (cookies[name] = value) } as never,
    user: { id: userId, role, openId: `local:+2267000000${userId}` } as never,
  };
  return { api: appRouter.createCaller(ctx), cookies };
}

function adminUser(overrides: Record<string, unknown> = {}) {
  return { id: 1, openId: "local:+22670000001", name: "Admin", email: null, phone: "+22670000001", role: "admin", passwordHash: hashPassword("ancien-mdp-1"), subscriptionEnd: null, ...overrides };
}

describe("console · mon compte", () => {
  it("refuse les nouvelles procédures à un utilisateur ordinaire", async () => {
    const { api } = caller(9, "user");
    await expect(api.admin.account.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.admin.account.changePassword({ currentPassword: "x", newPassword: "nouveau-mdp", confirmPassword: "nouveau-mdp" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.admin.users.grantPremium({ userId: 2, durationDays: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("change le mot de passe, déconnecte les autres sessions et renouvelle celle en cours", async () => {
    const fake = fakeDb([[adminUser({ id: 11 })]]);
    getDb.mockResolvedValue(fake.db);
    const { api, cookies } = caller(11);
    const before = Date.now();

    const { token } = await api.admin.account.changePassword({ currentPassword: "ancien-mdp-1", newPassword: "nouveau-mdp-2", confirmPassword: "nouveau-mdp-2" });

    const update = fake.writes.find((write) => write.op === "update" && write.table === users)!;
    expect(verifyPassword("nouveau-mdp-2", update.values.passwordHash as string)).toBe(true);
    expect((update.values.sessionsValidAfter as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(cookies.app_session_id ?? Object.values(cookies)[0]).toBe(token);
    const session = await sdk.verifySession(token);
    expect(session?.openId).toBe("local:+22670000001");
    expect(fake.writes.some((write) => write.table === auditLogs && write.values.action === "account.password_changed")).toBe(true);
  });

  it("refuse un mot de passe actuel incorrect, puis bloque après 5 échecs", async () => {
    const attempt = () => {
      getDb.mockResolvedValue(fakeDb([[adminUser({ id: 12 })]]).db);
      return caller(12).api.admin.account.changePassword({ currentPassword: "mauvais", newPassword: "nouveau-mdp-2", confirmPassword: "nouveau-mdp-2" });
    };
    for (let index = 0; index < 5; index += 1) await expect(attempt()).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Mot de passe actuel incorrect." });
    await expect(attempt()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("valide la confirmation et la longueur du nouveau mot de passe", async () => {
    const { api } = caller(13);
    await expect(api.admin.account.changePassword({ currentPassword: "ancien-mdp-1", newPassword: "court", confirmPassword: "court" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(api.admin.account.changePassword({ currentPassword: "ancien-mdp-1", newPassword: "nouveau-mdp-2", confirmPassword: "autre-mdp-3" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuse une adresse e-mail déjà utilisée par un autre compte", async () => {
    getDb.mockResolvedValue(fakeDb([[{ id: 99 }]]).db);
    await expect(caller(14).api.admin.account.update({ name: "Admin", email: "pris@example.com" })).rejects.toMatchObject({ code: "CONFLICT" });

    const fake = fakeDb([[]]);
    getDb.mockResolvedValue(fake.db);
    await expect(caller(14).api.admin.account.update({ name: "Awa Ouédraogo", email: "Awa@Example.com" })).resolves.toEqual({ name: "Awa Ouédraogo", email: "awa@example.com" });
    expect(fake.writes[0]).toMatchObject({ op: "update", table: users, values: { name: "Awa Ouédraogo", email: "awa@example.com" } });
  });

  it("limite les essais par compte et réinitialise après la fenêtre", () => {
    const limiter = createAttemptLimiter({ max: 2, windowMs: 1000 });
    limiter.recordFailure(1, 0);
    limiter.recordFailure(1, 10);
    expect(limiter.isBlocked(1, 20)).toBe(true);
    expect(limiter.isBlocked(2, 20)).toBe(false);
    expect(limiter.isBlocked(1, 1001)).toBe(false);
  });
});

describe("console · offrir le Premium", () => {
  const now = new Date("2026-10-08T10:00:00Z");

  it("prolonge un abonnement actif ou démarre maintenant", () => {
    expect(extendSubscriptionEnd(new Date("2026-10-20T10:00:00Z"), 30, now).toISOString()).toBe("2026-11-19T10:00:00.000Z");
    expect(extendSubscriptionEnd(new Date("2026-09-01T10:00:00Z"), 7, now).toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(extendSubscriptionEnd(null, 7, now).toISOString()).toBe("2026-10-15T10:00:00.000Z");
  });

  it("enregistre l'offre sur le compte, comme transaction gratuite, et dans le journal", async () => {
    const activeEnd = new Date(Date.now() + 10 * 86_400_000);
    const fake = fakeDb([[{ id: 2, subscriptionEnd: activeEnd }]]);
    getDb.mockResolvedValue(fake.db);

    const result = await caller(1).api.admin.users.grantPremium({ userId: 2, durationDays: 30, reason: "Partenaire" });

    expect(new Date(result.subscriptionEnd).getTime()).toBe(activeEnd.getTime() + 30 * 86_400_000);
    expect(fake.writes.find((write) => write.table === users)?.values).toEqual({ subscriptionEnd: new Date(result.subscriptionEnd) });
    expect(fake.writes.find((write) => write.table === transactions)?.values).toMatchObject({ userId: 2, provider: "admin", planId: "offered", amount: 0, status: "success" });
    expect(fake.writes.find((write) => write.table === auditLogs)?.values).toMatchObject({ actorUserId: 1, action: "users.premium_granted", targetId: "2" });
  });

  it("retire un Premium actif et refuse de retirer un Premium inexistant", async () => {
    getDb.mockResolvedValue(fakeDb([[{ id: 3, subscriptionEnd: null }]]).db);
    await expect(caller(1).api.admin.users.revokePremium({ userId: 3 })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const fake = fakeDb([[{ id: 3, subscriptionEnd: new Date(Date.now() + 86_400_000) }]]);
    getDb.mockResolvedValue(fake.db);
    await caller(1).api.admin.users.revokePremium({ userId: 3 });
    expect((fake.writes[0]?.values.subscriptionEnd as Date).getTime()).toBeLessThanOrEqual(Date.now());
    expect(fake.writes.some((write) => write.table === auditLogs && write.values.action === "users.premium_revoked")).toBe(true);
  });

  it("refuse une durée hors limites et un utilisateur introuvable", async () => {
    await expect(caller(1).api.admin.users.grantPremium({ userId: 2, durationDays: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller(1).api.admin.users.grantPremium({ userId: 2, durationDays: 400 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    getDb.mockResolvedValue(fakeDb([[]]).db);
    await expect(caller(1).api.admin.users.grantPremium({ userId: 404, durationDays: 30 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
