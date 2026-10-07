import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedDbUser = vi.fn();
vi.mock("../server/premium", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/premium")>();
  return { ...original, getAuthenticatedDbUser: (req: Request) => getAuthenticatedDbUser(req) };
});

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
}

function medicinesRoute(register: (app: never) => void) {
  const routes: Record<string, (req: Request, res: Response) => Promise<void>> = {};
  register({ get: (path: string, handler: never) => (routes[path] = handler), post: () => undefined } as never);
  return routes["/medicaments"];
}

afterEach(() => {
  getAuthenticatedDbUser.mockReset();
  vi.unstubAllEnvs();
});

describe("S12 · médicaments servis par le serveur aux seuls abonnés", async () => {
  const { registerPharmaGardeCacheRoutes } = await import("../server/pharmagarde-cache");
  const route = medicinesRoute(registerPharmaGardeCacheRoutes as never);
  const req = { headers: {}, header: () => undefined, query: {} } as unknown as Request;

  it("refuse le catalogue sans abonnement actif", async () => {
    getAuthenticatedDbUser.mockResolvedValue(undefined);
    const res = new FakeResponse();
    await route(req, res as unknown as Response);
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("Paracétamol");
  });

  it("renvoie le catalogue complet à un abonné, sans mise en cache", async () => {
    getAuthenticatedDbUser.mockResolvedValue({ id: 1, subscriptionEnd: new Date(Date.now() + 86_400_000) });
    const res = new FakeResponse();
    await route(req, res as unknown as Response);
    const body = res.body as { medicaments: { name: string }[]; meta: { itemCount: number } };
    expect(res.statusCode).toBe(200);
    expect(body.medicaments.length).toBeGreaterThanOrEqual(20);
    expect(body.meta.itemCount).toBe(body.medicaments.length);
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("compresse le catalogue pour les clients qui acceptent gzip", async () => {
    getAuthenticatedDbUser.mockResolvedValue({ id: 1, subscriptionEnd: new Date(Date.now() + 86_400_000) });
    let sent: Buffer | undefined;
    const res = Object.assign(new FakeResponse(), { end: (chunk: Buffer) => void (sent = chunk) });
    await route({ ...req, headers: { "accept-encoding": "gzip, deflate" } } as unknown as Request, res as unknown as Response);
    expect(res.headers["Content-Encoding"]).toBe("gzip");
    const body = JSON.parse(gunzipSync(sent!).toString("utf8")) as { medicaments: unknown[]; meta: { itemCount: number } };
    expect(body.meta.itemCount).toBe(body.medicaments.length);
    expect(sent!.length).toBeLessThan(200_000);
  });

  it("le catalogue n'est plus embarqué dans l'app", () => {
    expect(existsSync("lib/pharmagarde/medicines-data.ts")).toBe(false);
    expect(readFileSync("lib/pharmagarde/app-state.tsx", "utf8")).not.toContain("LOCAL_ESSENTIAL_MEDICINES");
  });
});

describe("S12 · le client envoie le jeton pour obtenir les droits Premium", () => {
  afterEach(() => vi.restoreAllMocks());

  it("transmet Authorization et sépare le cache gratuit du cache Premium", async () => {
    const api = await import("../lib/pharmagarde/api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ pharmacies: [] }), { status: 200 }));

    await api.fetchPharmacies("https://api.example", undefined, "Kaya", { authHeaders: { Authorization: "Bearer tok" }, cacheVariant: "free" });
    await api.fetchPharmacies("https://api.example", undefined, "Kaya", { authHeaders: { Authorization: "Bearer tok" }, cacheVariant: "premium" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("ne met jamais le catalogue de médicaments en cache local", async () => {
    const api = await import("../lib/pharmagarde/api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ medicaments: [{ id: "m", name: "M" }] }), { status: 200 }));
    await api.fetchMedicines("https://api.example", { authHeaders: { Authorization: "Bearer tok" } });
    await api.fetchMedicines("https://api.example", { authHeaders: { Authorization: "Bearer tok" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lit la forme, l'âge et le prix fournis par le serveur", async () => {
    const api = await import("../lib/pharmagarde/api");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ medicaments: [{ id: "p", type: "medicine", name: "Paracétamol", pharmaceuticalType: "Comprimé", ageCategory: "Adulte", priceApprox: 300 }] }), { status: 200 }),
    );
    const [medicine] = await api.fetchMedicines("https://api.example", {});
    expect(medicine).toMatchObject({ pharmaceuticalType: "Comprimé", ageCategory: "Adulte", priceApprox: 300 });
  });
});

describe("S13 · en-têtes de sécurité HTTP", async () => {
  const { securityHeadersMiddleware } = await import("../server/_core/security");

  function run() {
    const res = new FakeResponse();
    const next = vi.fn() as unknown as NextFunction;
    securityHeadersMiddleware({} as Request, res as unknown as Response, next);
    return res;
  }

  it("pose nosniff, l'interdiction d'iframe et une CSP stricte", () => {
    const res = run();
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["X-Frame-Options"]).toBe("DENY");
    expect(res.headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(res.headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("active HSTS en production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(run().headers["Strict-Transport-Security"]).toContain("max-age=31536000");
  });

  it("masque X-Powered-By et limite les corps de requête à 100 Ko", () => {
    const entry = readFileSync("server/_core/index.ts", "utf8");
    expect(entry).toContain('app.disable("x-powered-by")');
    expect(entry).toContain("app.use(securityHeadersMiddleware)");
    expect(entry).toContain('express.json({ limit: "100kb" })');
  });
});
