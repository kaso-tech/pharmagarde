import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getSessionCookieOptions } from "../server/_core/cookies";
import { validateRegisterPayload } from "../server/_core/local-auth";
import { corsMiddleware, createRateLimiter, getPublicPaymentUrls, isOriginAllowed, parseTrustProxy } from "../server/_core/security";

class FakeResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown = null;
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(payload: unknown) {
    this.body = payload;
    return this;
  }
  sendStatus(code: number) {
    this.statusCode = code;
    return this;
  }
}

function fakeRequest(init: { method?: string; origin?: string; ip?: string; body?: unknown; hostname?: string; protocol?: string } = {}) {
  return {
    method: init.method ?? "GET",
    headers: init.origin ? { origin: init.origin } : {},
    ip: init.ip ?? "203.0.113.10",
    body: init.body,
    hostname: init.hostname ?? "localhost",
    protocol: init.protocol ?? "http",
  } as unknown as Request;
}

function run(middleware: (req: Request, res: Response, next: NextFunction) => void, req: Request) {
  const res = new FakeResponse();
  const next = vi.fn();
  middleware(req, res as unknown as Response, next);
  return { res, next };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("S2 · CORS limité aux origines autorisées", () => {
  it("ne renvoie aucun en-tête CORS à une origine inconnue, même avec credentials", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://app.pharmagarde.bf");

    const { res, next } = run(corsMiddleware, fakeRequest({ origin: "https://site-malveillant.example" }));

    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(res.headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("autorise une origine listée et refuse le preflight d'une origine inconnue", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://app.pharmagarde.bf/, https://admin.pharmagarde.bf");

    const allowed = run(corsMiddleware, fakeRequest({ origin: "https://app.pharmagarde.bf" }));
    expect(allowed.res.headers["Access-Control-Allow-Origin"]).toBe("https://app.pharmagarde.bf");
    expect(allowed.res.headers["Access-Control-Allow-Credentials"]).toBe("true");

    const preflight = run(corsMiddleware, fakeRequest({ method: "OPTIONS", origin: "https://site-malveillant.example" }));
    expect(preflight.res.statusCode).toBe(403);
    expect(preflight.next).not.toHaveBeenCalled();
  });

  it("n'autorise localhost qu'hors production", () => {
    expect(isOriginAllowed("http://localhost:8081", { NODE_ENV: "development" })).toBe(true);
    expect(isOriginAllowed("http://localhost:8081", { NODE_ENV: "production" })).toBe(false);
  });

  it("émet le cookie de session en SameSite=Lax par défaut", () => {
    expect(getSessionCookieOptions(fakeRequest({ protocol: "https" })).sameSite).toBe("lax");
    vi.stubEnv("SESSION_COOKIE_SAMESITE", "none");
    expect(getSessionCookieOptions(fakeRequest({ protocol: "https" })).sameSite).toBe("none");
    // SameSite=None sans HTTPS serait rejeté par les navigateurs : on reste en Lax.
    expect(getSessionCookieOptions(fakeRequest({ protocol: "http" })).sameSite).toBe("lax");
  });
});

describe("S3 · aucun mot de passe dans les journaux d'inscription", () => {
  it("le code d'inscription ne journalise plus req.body", async () => {
    const { readFileSync } = await import("node:fs");
    const oauth = readFileSync("server/_core/oauth.ts", "utf8");
    expect(oauth).not.toMatch(/console\.\w+\([^)]*req\.body/);
  });
});

describe("S4 · limitation de débit et mot de passe minimum", () => {
  it("renvoie 429 avec Retry-After une fois la limite dépassée, par clé", () => {
    const limiter = createRateLimiter({ name: "test", windowMs: 60_000, max: 2, key: (req) => req.ip, message: "Trop de tentatives." });

    expect(run(limiter, fakeRequest({ ip: "198.51.100.1" })).next).toHaveBeenCalled();
    expect(run(limiter, fakeRequest({ ip: "198.51.100.1" })).next).toHaveBeenCalled();
    const blocked = run(limiter, fakeRequest({ ip: "198.51.100.1" }));
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.res.statusCode).toBe(429);
    expect(blocked.res.headers["Retry-After"]).toBe("60");

    // Une autre IP garde son propre quota.
    expect(run(limiter, fakeRequest({ ip: "198.51.100.2" })).next).toHaveBeenCalled();
  });

  it("rouvre la fenêtre après expiration", () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter({ name: "test-window", windowMs: 1_000, max: 1, key: (req) => req.ip, message: "Trop." });
      run(limiter, fakeRequest());
      expect(run(limiter, fakeRequest()).res.statusCode).toBe(429);
      vi.advanceTimersByTime(1_001);
      expect(run(limiter, fakeRequest()).next).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ne croit X-Forwarded-For que si TRUST_PROXY est configuré", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("10.0.0.0/8")).toBe("10.0.0.0/8");
  });

  it("refuse un mot de passe de moins de 8 caractères à l'inscription", () => {
    const tooShort = validateRegisterPayload({ phone: "+22670123456", password: "1234567", confirmPassword: "1234567" });
    expect(tooShort.ok).toBe(false);
    const valid = validateRegisterPayload({ phone: "+22670123456", password: "12345678", confirmPassword: "12345678" });
    expect(valid.ok).toBe(true);
  });
});

describe("S5 · URLs de paiement jamais déduites de l'en-tête Host", () => {
  it("exige PUBLIC_APP_URL et PUBLIC_API_URL", () => {
    expect(() => getPublicPaymentUrls({ NODE_ENV: "production" })).toThrow("PUBLIC_APP_URL");
    expect(() => getPublicPaymentUrls({ NODE_ENV: "production", PUBLIC_APP_URL: "https://app.pharmagarde.bf" })).toThrow("PUBLIC_API_URL");
  });

  it("refuse une URL non HTTPS en production et normalise la barre finale", () => {
    expect(() => getPublicPaymentUrls({ NODE_ENV: "production", PUBLIC_APP_URL: "http://app.pharmagarde.bf", PUBLIC_API_URL: "https://api.pharmagarde.bf" })).toThrow("https");
    expect(getPublicPaymentUrls({ NODE_ENV: "production", PUBLIC_APP_URL: "https://app.pharmagarde.bf/", PUBLIC_API_URL: "https://api.pharmagarde.bf" })).toEqual({
      appUrl: "https://app.pharmagarde.bf",
      apiUrl: "https://api.pharmagarde.bf",
    });
  });

  it("le serveur n'utilise plus req.get(\"host\") pour construire les URLs de paiement", async () => {
    const { readFileSync } = await import("node:fs");
    const premium = readFileSync("server/premium.ts", "utf8");
    expect(premium).not.toContain('req.get("host")');
    expect(premium).toContain("getPublicPaymentUrls()");
  });
});
