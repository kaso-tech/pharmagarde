import { afterEach, describe, expect, it, vi } from "vitest";

import { adminRoles, adminSessions } from "../drizzle/schema";
import { adminAccess, adminPermissions, effectiveAdminRole } from "../shared/admin-roles";

process.env.JWT_SECRET ||= "secret-de-test-pour-les-jetons-de-session";

/** Base factice : chaque table renvoie les lignes prévues ; les écritures sont enregistrées. */
function fakeDb(tables: Map<unknown, unknown[]>) {
  const writes: { table: unknown; values: unknown }[] = [];
  const chain = () => {
    let table: unknown;
    const builder: Record<string, unknown> = {};
    for (const method of ["where", "leftJoin", "innerJoin", "orderBy", "limit", "offset"]) builder[method] = () => builder;
    builder.from = (source: unknown) => {
      table = source;
      return builder;
    };
    builder.then = (resolve: (value: unknown) => void) => resolve(tables.get(table) ?? []);
    return builder;
  };
  return {
    writes,
    db: {
      select: () => chain(),
      update: (table: unknown) => ({ set: (values: unknown) => ({ where: async () => void writes.push({ table, values }) }) }),
      insert: (table: unknown) => ({ values: (values: unknown) => Object.assign(Promise.resolve(void writes.push({ table, values })), { onDuplicateKeyUpdate: async () => undefined }) }),
    },
  };
}

const getDb = vi.fn();
vi.mock("../server/db", () => ({ getDb: () => getDb(), getUserByOpenId: vi.fn(), deleteUserAccount: vi.fn() }));

const { appRouter } = await import("../server/routers");
const { hashSessionToken, maskPhone, secondFactorMode } = await import("../server/admin-auth");
const { diffChanges, safeMetadata } = await import("../server/audit-log");
const { aggregateUsage, usageDay } = await import("../server/usage");

function caller(userId: number, headers: Record<string, string> = {}) {
  return appRouter.createCaller({
    req: { hostname: "localhost", protocol: "http", headers, get: () => undefined } as never,
    res: { cookie: vi.fn() } as never,
    user: { id: userId, role: "admin", openId: `local:${userId}`, phone: "+22670112233" } as never,
  });
}

afterEach(() => {
  delete process.env.ADMIN_SECOND_FACTOR;
  getDb.mockReset();
});

describe("rôles de la console", () => {
  it("donne à chaque rôle les droits attendus", () => {
    expect(adminAccess("super_admin", "system")).toBe("write");
    expect(adminAccess("editor", "directory")).toBe("write");
    expect(adminAccess("editor", "users")).toBe("none");
    expect(adminAccess("editor", "audit")).toBe("read");
    expect(adminAccess("support", "users")).toBe("write");
    expect(adminAccess("support", "directory")).toBe("read");
    expect(adminAccess("support", "duty")).toBe("none");
    expect(Object.values(adminPermissions("viewer")).every((access) => access === "read")).toBe(true);
    expect(effectiveAdminRole({ role: "admin" })).toBe("super_admin");
    expect(effectiveAdminRole({ role: "admin", adminRole: "support" })).toBe("support");
    expect(effectiveAdminRole({ role: "user", adminRole: "editor" })).toBeNull();
  });

  it("refuse les modifications hors du rôle, côté serveur", async () => {
    process.env.ADMIN_SECOND_FACTOR = "off";
    getDb.mockResolvedValue(fakeDb(new Map([[adminRoles, [{ role: "editor" }]]])).db);
    await expect(caller(5).admin.users.setSuspended({ userId: 5, suspended: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(5).admin.plans.save({ id: "month", label: "1 mois", amount: 500, durationDays: 30, active: true })).rejects.toMatchObject({ code: "FORBIDDEN" });

    getDb.mockResolvedValue(fakeDb(new Map([[adminRoles, [{ role: "support" }]]])).db);
    // Le support peut agir sur les comptes (ici refusé seulement parce que c'est son propre compte).
    await expect(caller(5).admin.users.setSuspended({ userId: 5, suspended: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller(5).admin.duty.overview({ weeks: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(5).admin.users.setRole({ userId: 6, role: "editor" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    getDb.mockResolvedValue(fakeDb(new Map([[adminRoles, [{ role: "viewer" }]]])).db);
    await expect(caller(5).admin.directory.archive({ id: "ph-test", kind: "pharmacy", confirmArchive: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("décrit le rôle et les droits dans admin.access", async () => {
    process.env.ADMIN_SECOND_FACTOR = "off";
    getDb.mockResolvedValue(fakeDb(new Map([[adminRoles, [{ role: "support" }]]])).db);
    const access = await caller(5).admin.access();
    expect(access).toMatchObject({ adminRole: "support", secondFactor: { mode: "off", verified: true } });
    expect(access.permissions.users).toBe("write");
    expect(access.permissions.system).toBe("none");
  });
});

describe("double facteur de la console", () => {
  it("exige un accès validé par SMS pour la session en cours", async () => {
    process.env.ADMIN_SECOND_FACTOR = "on";
    const headers = { authorization: "Bearer jeton-de-test" };
    getDb.mockResolvedValue(fakeDb(new Map()).db);
    await expect(caller(5, headers).admin.dashboard()).rejects.toMatchObject({ code: "FORBIDDEN", message: "SECOND_FACTOR_REQUIRED" });
    const access = await caller(5, headers).admin.access();
    expect(access.secondFactor).toMatchObject({ mode: "on", verified: false, phone: "+226 70 •• •• 33" });

    const session = { id: 3, userId: 5, tokenHash: hashSessionToken("jeton-de-test"), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null };
    getDb.mockResolvedValue(fakeDb(new Map<unknown, unknown[]>([[adminSessions, [session]]])).db);
    expect((await caller(5, headers).admin.access()).secondFactor.verified).toBe(true);
    // Le contrôle passe : l'erreur vient ensuite de la procédure elle-même (son propre compte).
    await expect(caller(5, headers).admin.users.setSuspended({ userId: 5, suspended: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("se règle par ADMIN_SECOND_FACTOR et se suspend sans fournisseur SMS en production", () => {
    const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;
    expect(secondFactorMode(env({ NODE_ENV: "development" }))).toBe("on");
    expect(secondFactorMode(env({ NODE_ENV: "production" }))).toBe("unavailable");
    expect(secondFactorMode(env({ NODE_ENV: "production", SMS_WEBHOOK_URL: "https://sms.example" }))).toBe("on");
    expect(secondFactorMode(env({ NODE_ENV: "production", ADMIN_SECOND_FACTOR: "on" }))).toBe("on");
    expect(secondFactorMode(env({ ADMIN_SECOND_FACTOR: "off" }))).toBe("off");
    expect(maskPhone("+22670112233")).toBe("+226 70 •• •• 33");
    expect(maskPhone(null)).toBeNull();
  });
});

describe("journal avant/après", () => {
  it("ne garde que les champs modifiés", () => {
    const changes = diffChanges({ nom: "Pharmacie A", groupe: 1, téléphone: null }, { nom: "Pharmacie A", groupe: 2, téléphone: "" });
    expect(changes).toEqual({ groupe: { before: 1, after: 2 } });
    expect(diffChanges(null, { nom: "B" })).toEqual({ nom: { before: null, after: "B" } });
    expect(JSON.parse(safeMetadata({ source: "console", vide: undefined }, changes))).toEqual({ source: "console", changes: { groupe: { before: 1, after: 2 } } });
    expect(JSON.parse(safeMetadata({ source: "console" }, {}))).toEqual({ source: "console" });
  });
});

describe("statistiques d'usage", () => {
  it("additionne les événements par jour, ville et type", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const rows = aggregateUsage(
      [
        { event: "search", city: "ouagadougou", count: 2 },
        { event: "search", city: "Ouagadougou", count: 1 },
        { event: "call", city: "Ville inconnue", count: 1 },
        { event: "app_open", day: "2026-10-06", count: 1 },
        { event: "app_open", day: "2025-01-01", count: 1 },
      ],
      now,
    );
    expect(rows).toEqual([
      { day: "2026-10-08", city: "Ouagadougou", event: "search", count: 3 },
      { day: "2026-10-08", city: "", event: "call", count: 1 },
      { day: "2026-10-06", city: "", event: "app_open", count: 1 },
      { day: "2026-10-08", city: "", event: "app_open", count: 1 },
    ]);
    expect(usageDay("2026-10-09", now)).toBe("2026-10-08");
  });
});
