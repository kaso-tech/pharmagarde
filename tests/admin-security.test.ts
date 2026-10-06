import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({
  getDb: vi.fn(),
}));

const { appRouter } = await import("../server/routers");

function caller(role: "user" | "admin" | null) {
  return appRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: role ? ({ id: 42, role, openId: "local:+22670123456" } as never) : null,
  });
}

describe("console admin · contrôle d’accès serveur", () => {
  it("refuse une session absente avant tout accès aux procédures admin", async () => {
    await expect(caller(null).admin.access()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(null).admin.dashboard()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuse une session utilisateur ordinaire, y compris les mutations d’annuaire", async () => {
    await expect(caller("user").admin.users.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").admin.directory.archive({ id: "ph-ouagadougou-test", kind: "pharmacy" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
