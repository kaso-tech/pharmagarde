import { readFileSync, existsSync } from "node:fs";

import type { Request } from "express";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserByOpenId = vi.fn();
vi.mock("../server/db", () => ({ getUserByOpenId: (openId: string) => getUserByOpenId(openId) }));
vi.mock("../server/_core/env", () => ({ ENV: { cookieSecret: "test-secret-for-sessions", appId: "pharmagarde" } }));

const { sdk, isSessionStillValid } = await import("../server/_core/sdk");
const { SESSION_TTL_MS } = await import("../shared/const.js");

function bearer(token: string) {
  return { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
}

describe("S7 · sessions de 30 jours, révocables", () => {
  beforeEach(() => getUserByOpenId.mockReset());

  it("émet un jeton avec iat et une expiration à 30 jours", async () => {
    const token = await sdk.createSessionToken("local:+22670123456", { name: "+22670123456" });
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { iat: number; exp: number };
    expect(typeof payload.iat).toBe("number");
    expect((payload.exp - payload.iat) * 1000).toBe(SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("refuse un jeton émis avant la révocation des sessions", async () => {
    const token = await sdk.createSessionToken("local:+22670123456", { name: "x" });
    getUserByOpenId.mockResolvedValue({ id: 1, openId: "local:+22670123456", sessionsValidAfter: new Date(Date.now() + 60_000) });
    await expect(sdk.authenticateRequest(bearer(token))).rejects.toThrow("Session revoked");

    getUserByOpenId.mockResolvedValue({ id: 1, openId: "local:+22670123456", sessionsValidAfter: null });
    await expect(sdk.authenticateRequest(bearer(token))).resolves.toMatchObject({ id: 1 });
  });

  it("refuse les anciens jetons sans date d'émission", async () => {
    const legacy = await new SignJWT({ openId: "local:+22670123456", appId: "pharmagarde", name: "x" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(new TextEncoder().encode("test-secret-for-sessions"));
    getUserByOpenId.mockResolvedValue({ id: 1, openId: "local:+22670123456", sessionsValidAfter: null });
    await expect(sdk.authenticateRequest(bearer(legacy))).rejects.toThrow("Invalid session");
  });

  it("compare la révocation à la seconde près", () => {
    const revokedAt = new Date("2026-10-05T10:00:00.900Z");
    expect(isSessionStillValid(Date.parse("2026-10-05T09:59:59.000Z"), revokedAt)).toBe(false);
    expect(isSessionStillValid(Date.parse("2026-10-05T10:00:00.000Z"), revokedAt)).toBe(true);
    expect(isSessionStillValid(Date.parse("2026-10-05T10:00:05.000Z"), revokedAt)).toBe(true);
  });

  it("propose « Déconnecter tous mes appareils » et révoque après réinitialisation du mot de passe", () => {
    expect(readFileSync("server/_core/oauth.ts", "utf8")).toContain('app.post("/api/auth/logout-all"');
    expect(readFileSync("components/pharmagarde/menu-content.tsx", "utf8")).toContain("Déconnecter tous mes appareils");
    expect(readFileSync("server/phone-auth.ts", "utf8")).toContain("await revokeUserSessions(user.id);");
  });
});

describe("S9 · aucune synchronisation d'un jeton inconnu avec un service tiers", () => {
  beforeEach(() => getUserByOpenId.mockReset());

  it("rejette un jeton valide dont le compte n'existe pas, sans appel réseau", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const token = await sdk.createSessionToken("inconnu", { name: "x" });
    getUserByOpenId.mockResolvedValue(undefined);
    await expect(sdk.authenticateRequest(bearer(token))).rejects.toThrow("User not found");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readFileSync("server/_core/sdk.ts", "utf8")).not.toMatch(/axios|GetUserInfoWithJwt|OAUTH_SERVER_URL/);
  });
});

describe("S8 · plus de jeton de session dans une URL de redirection", () => {
  it("le flux OAuth Manus inutilisé est supprimé côté serveur et app", () => {
    const oauth = readFileSync("server/_core/oauth.ts", "utf8");
    expect(oauth).not.toContain("/api/oauth/callback");
    expect(oauth).not.toContain("searchParams.set(\"sessionToken\"");
    expect(existsSync("app/oauth/callback.tsx")).toBe(false);
  });
});

describe("S6 · route d'administration", async () => {
  const { isAdminRequest } = await import("../server/pharmagarde-cache");
  const req = (headers: Record<string, string>) => ({ header: (name: string) => headers[name.toLowerCase()] });

  it("reste fermée quand aucun jeton n'est configuré, quel que soit l'environnement", () => {
    expect(isAdminRequest(req({ authorization: "Bearer x" }), undefined)).toBe(false);
    expect(isAdminRequest(req({}), "")).toBe(false);
  });

  it("n'accepte que le bon jeton, en Bearer ou en x-admin-token", () => {
    expect(isAdminRequest(req({ authorization: "Bearer secret-admin" }), "secret-admin")).toBe(true);
    expect(isAdminRequest(req({ "x-admin-token": "secret-admin" }), "secret-admin")).toBe(true);
    expect(isAdminRequest(req({ authorization: "Bearer secret-admiN" }), "secret-admin")).toBe(false);
    expect(isAdminRequest(req({ authorization: "Bearer " }), "secret-admin")).toBe(false);
  });
});
