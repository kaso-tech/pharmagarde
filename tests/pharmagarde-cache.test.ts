import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

type FakeRequest = {
  body?: unknown;
  query?: Record<string, unknown>;
  header?: (name: string) => string | undefined;
};

type RegisteredRoute = (req: FakeRequest, res: FakeResponse) => unknown;

type RouteMap = Record<string, RegisteredRoute>;

class FakeResponse {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public body: unknown = null;

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

function createRouteMap(registerPharmaGardeCacheRoutes: (app: never) => void) {
  const routes: RouteMap = {};
  const app = {
    get: (routePath: string, handler: RegisteredRoute) => {
      routes[`GET ${routePath}`] = handler;
    },
    post: (routePath: string, handler: RegisteredRoute) => {
      routes[`POST ${routePath}`] = handler;
    },
  };
  registerPharmaGardeCacheRoutes(app as never);
  return routes;
}

describe("cache backend PharmaGarde", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.PHARMAGARDE_CACHE_DIR;
    delete process.env.PHARMAGARDE_OSM_REQUEST_DELAY_MS;
  });

  it("sert les endpoints publics depuis le cache local par ville sans appel réseau", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "pharmagarde-cache-"));
    const updatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await writeFile(
      path.join(cacheDir, "pharmacies.json"),
      JSON.stringify({
        version: 3,
        kind: "pharmacies",
        byCity: {
          ouagadougou: [{ id: "ph-1", type: "pharmacy", name: "Pharmacie Centrale", city: "Ouagadougou", source: "local" }],
        },
        updatedAt,
        expiresAt,
        lastRefreshAttemptAt: null,
      }),
      "utf8",
    );

    await writeFile(
      path.join(cacheDir, "healthcare.json"),
      JSON.stringify({
        version: 3,
        kind: "healthcare",
        byCity: {
          ouagadougou: [{ id: "cl-1", type: "clinic", name: "Clinique du Centre", city: "Ouagadougou", source: "local" }],
        },
        updatedAt,
        expiresAt,
        lastRefreshAttemptAt: null,
      }),
      "utf8",
    );

    process.env.PHARMAGARDE_CACHE_DIR = cacheDir;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { initializePharmaGardeCache, registerPharmaGardeCacheRoutes } = await import("../server/pharmagarde-cache");

    await initializePharmaGardeCache();
    const routes = createRouteMap(registerPharmaGardeCacheRoutes as never);

    expect(routes["GET /pharmacies"]).toBeTypeOf("function");
    expect(routes["GET /healthcare"]).toBeTypeOf("function");

    const pharmaciesResponse = new FakeResponse();
    await routes["GET /pharmacies"]?.({ header: () => undefined, query: {} }, pharmaciesResponse);

    const healthcareResponse = new FakeResponse();
    await routes["GET /healthcare"]?.({ header: () => undefined, query: {}, headers: { origin: "https://preview.example" } } as never, healthcareResponse);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(pharmaciesResponse.headers["X-PharmaGarde-Cache-Source"]).toBe("server-local-cache-by-city");
    expect(pharmaciesResponse.body).toMatchObject({
      pharmacies: [{ id: "ph-1", name: "Pharmacie Centrale", city: "Ouagadougou" }],
      meta: { cache: "server-local-cache-by-city", kind: "pharmacies", itemCount: 1, totalItemCount: 1, stale: false },
    });
    // Origine non autorisée : aucun en-tête CORS (voir server/_core/security.ts).
    expect(healthcareResponse.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(healthcareResponse.headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(healthcareResponse.body).toMatchObject({
      healthcare: [{ id: "cl-1", name: "Clinique du Centre", city: "Ouagadougou" }],
      meta: { cache: "server-local-cache-by-city", kind: "healthcare", itemCount: 1, totalItemCount: 1, stale: false },
    });
  });

  it("filtre strictement pharmacies et structures de santé par clé de ville normalisée", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "pharmagarde-city-cache-"));
    const updatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await writeFile(
      path.join(cacheDir, "pharmacies.json"),
      JSON.stringify({
        version: 3,
        kind: "pharmacies",
        byCity: {
          ouagadougou: [{ id: "ph-ouaga", type: "pharmacy", name: "Pharmacie Ouaga", city: "Ouagadougou", source: "local" }],
          "bobo-dioulasso": [{ id: "ph-bobo", type: "pharmacy", name: "Pharmacie Bobo", city: "Bobo-Dioulasso", source: "local" }],
          koudougou: [{ id: "ph-kdg", type: "pharmacy", name: "Pharmacie Koudougou", city: "Koudougou", source: "local" }],
          kaya: [{ id: "ph-kaya", type: "pharmacy", name: "Pharmacie Kaya", city: "Kaya", source: "local" }],
        },
        updatedAt,
        expiresAt,
        lastRefreshAttemptAt: null,
      }),
      "utf8",
    );

    await writeFile(
      path.join(cacheDir, "healthcare.json"),
      JSON.stringify({
        version: 3,
        kind: "healthcare",
        byCity: {
          "bobo-dioulasso": [{ id: "cl-bobo", type: "clinic", name: "Clinique Bobo", city: "Bobo-Dioulasso", source: "local" }],
          ziniare: [{ id: "cl-ziniare", type: "clinic", name: "CSPS Ziniaré", city: "Ziniaré", source: "local" }],
          koudougou: [{ id: "cl-kdg", type: "clinic", name: "CMA Koudougou", city: "Koudougou", source: "local" }],
        },
        updatedAt,
        expiresAt,
        lastRefreshAttemptAt: null,
      }),
      "utf8",
    );

    process.env.PHARMAGARDE_CACHE_DIR = cacheDir;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { initializePharmaGardeCache, registerPharmaGardeCacheRoutes } = await import("../server/pharmagarde-cache");

    await initializePharmaGardeCache();
    const routes = createRouteMap(registerPharmaGardeCacheRoutes as never);

    const koudougouResponse = new FakeResponse();
    await routes["GET /pharmacies"]?.({ header: () => undefined, query: { city: "kOuDoUgOu" } }, koudougouResponse);

    const kayaResponse = new FakeResponse();
    await routes["GET /pharmacies"]?.({ header: () => undefined, query: { city: "Kaya" } }, kayaResponse);

    const allPharmaciesResponse = new FakeResponse();
    await routes["GET /pharmacies"]?.({ header: () => undefined, query: {} }, allPharmaciesResponse);

    const unsupportedCityResponse = new FakeResponse();
    await routes["GET /pharmacies"]?.({ header: () => undefined, query: { city: "Ville Introuvable" } }, unsupportedCityResponse);

    const healthcareResponse = new FakeResponse();
    await routes["GET /healthcare"]?.({ header: () => undefined, query: { city: "Ziniare" } }, healthcareResponse);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(koudougouResponse.body).toMatchObject({
      pharmacies: [{ id: "ph-kdg", city: "Koudougou" }],
      meta: { city: "Koudougou", cityKey: "koudougou", itemCount: 1, totalItemCount: 4 },
    });
    expect(koudougouResponse.body).not.toMatchObject({
      pharmacies: expect.arrayContaining([{ id: "ph-ouaga" }, { id: "ph-bobo" }, { id: "ph-kaya" }]),
    });
    expect(kayaResponse.body).toMatchObject({
      pharmacies: [{ id: "ph-kaya", city: "Kaya" }],
      meta: { city: "Kaya", cityKey: "kaya", itemCount: 1, totalItemCount: 4 },
    });
    expect(allPharmaciesResponse.body).toMatchObject({
      meta: { city: null, itemCount: 3, totalItemCount: 4, premiumRequiredForFullResults: true, freeResultLimit: 3 },
    });
    // S11 : ni le nombre de résultats masqués ni les erreurs internes ne sont exposés.
    const allMeta = (allPharmaciesResponse.body as { meta: Record<string, unknown> }).meta;
    expect(allMeta).not.toHaveProperty("unrestrictedItemCount");
    expect(allMeta).not.toHaveProperty("lastError");
    // La réponse dépend de l'abonnement : aucun cache partagé entre utilisateurs.
    expect(allPharmaciesResponse.headers["Cache-Control"]).toMatch(/^private/);
    expect(allPharmaciesResponse.headers.Vary).toContain("Authorization");
    expect(unsupportedCityResponse.body).toMatchObject({
      pharmacies: [],
      meta: { city: "Ville Introuvable", cityKey: "ville-introuvable", itemCount: 0, totalItemCount: 4 },
    });
    expect(healthcareResponse.body).toMatchObject({
      healthcare: [{ id: "cl-ziniare", city: "Ziniaré" }],
      meta: { city: "Ziniaré", cityKey: "ziniare", itemCount: 1, totalItemCount: 3 },
    });
    expect(infoSpy).toHaveBeenCalledWith("[PharmaGardeCache] pharmacies: ville demandée=Koudougou, premium=false, résultats retournés=1/1");
    expect(infoSpy).toHaveBeenCalledWith("[PharmaGardeCache] pharmacies: ville demandée=toutes, premium=false, résultats retournés=3/4");
    expect(infoSpy).toHaveBeenCalledWith("[PharmaGardeCache] pharmacies: ville demandée=Ville Introuvable, premium=false, résultats retournés=0/0");
    expect(infoSpy).toHaveBeenCalledWith("[PharmaGardeCache] healthcare: ville demandée=Ziniaré, premium=false, résultats retournés=1/1");
  });

  it("ignore complètement l’ancien cache plat version 1", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "pharmagarde-legacy-cache-"));
    const updatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await writeFile(
      path.join(cacheDir, "pharmacies.json"),
      JSON.stringify({
        version: 1,
        kind: "pharmacies",
        items: [{ id: "ph-legacy", type: "pharmacy", name: "Ancienne pharmacie globale", city: "Ouagadougou", source: "local" }],
        updatedAt,
        expiresAt,
        lastRefreshAttemptAt: null,
      }),
      "utf8",
    );

    process.env.PHARMAGARDE_CACHE_DIR = cacheDir;
    const { initializePharmaGardeCache, registerPharmaGardeCacheRoutes } = await import("../server/pharmagarde-cache");

    await initializePharmaGardeCache();
    const routes = createRouteMap(registerPharmaGardeCacheRoutes as never);
    const response = new FakeResponse();
    await routes["GET /pharmacies"]?.({ header: () => undefined, query: { city: "Ouagadougou" } }, response);

    expect(response.body).toMatchObject({
      pharmacies: [],
      meta: { cache: "server-local-cache-by-city", city: "Ouagadougou", cityKey: "ouagadougou", itemCount: 0, totalItemCount: 0 },
    });
  });

  it("ignore un cache Google Places antérieur (version 2) pour ne plus servir ces données", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "pharmagarde-google-legacy-"));
    await writeFile(
      path.join(cacheDir, "pharmacies.json"),
      JSON.stringify({
        version: 2,
        kind: "pharmacies",
        byCity: { ouagadougou: [{ id: "ChIJ-google", type: "Pharmacie", category: "pharmacy", name: "Pharmacie Google", city: "Ouagadougou", source: "google" }] },
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        lastRefreshAttemptAt: null,
      }),
      "utf8",
    );

    process.env.PHARMAGARDE_CACHE_DIR = cacheDir;
    const { initializePharmaGardeCache, getCacheState, isCacheFresh } = await import("../server/pharmagarde-cache");
    await initializePharmaGardeCache();

    expect(getCacheState("pharmacies").byCity.ouagadougou).toEqual([]);
    expect(isCacheFresh("pharmacies")).toBe(false);
  });

  it("sert les pharmacies depuis l'annuaire PharmaGarde, sans aucun appel réseau", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "pharmagarde-directory-"));
    const directoryPath = path.join(cacheDir, "pharmacies.json");
    await writeFile(
      directoryPath,
      JSON.stringify({
        version: 1,
        updatedAt: "2026-10-06T00:00:00.000Z",
        pharmacies: [
          { id: "ph-ouagadougou-archanges", city: "Ouagadougou", name: "Pharmacie Archanges", phone: "+226 79 20 01 83", dutyGroup: 1, address: "Pissy, face à la station OTAM", latitude: 12.3316319, longitude: -1.584736 },
          { id: "ph-bobo-dioulasso-abby", city: "Bobo-Dioulasso", name: "Pharmacie Abby", phone: "+226 20 97 63 64", dutyGroup: 4, latitude: 11.180476, longitude: -4.351685 },
          { id: "ph-bobo-dioulasso-diyama", city: "Bobo-Dioulasso", name: "Pharmacie Diyama", phone: "+226 70 17 28 23", dutyGroup: null, latitude: 11.159913, longitude: -4.24092 },
        ],
      }),
      "utf8",
    );
    process.env.PHARMAGARDE_CACHE_DIR = cacheDir;
    process.env.PHARMAGARDE_PHARMACY_DIRECTORY = directoryPath;

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { getCacheState, updateCachedDataset, registerPharmaGardeCacheRoutes } = await import("../server/pharmagarde-cache");
    const result = await updateCachedDataset("pharmacies", true);

    expect(result).toMatchObject({ ok: true, itemCount: 3 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getCacheState("pharmacies").byCity.ouagadougou).toEqual([
      expect.objectContaining({ id: "ph-ouagadougou-archanges", name: "Pharmacie Archanges", type: "Pharmacie", category: "pharmacy", source: "annuaire", dutyGroup: 1, phone: "+226 79 20 01 83", address: "Pissy, face à la station OTAM" }),
    ]);
    expect(getCacheState("pharmacies").byCity["bobo-dioulasso"].map((item) => item.dutyGroup)).toEqual([4, null]);
    expect(getCacheState("pharmacies").byCity.kaya).toEqual([]);

    const routes = createRouteMap(registerPharmaGardeCacheRoutes as never);
    const response = new FakeResponse();
    await routes["GET /pharmacies"]?.({ header: () => undefined, query: { city: "Ouagadougou" } }, response);
    expect(response.body).toMatchObject({ meta: { source: "annuaire", attribution: expect.stringContaining("Ordre national des pharmaciens") } });
    delete process.env.PHARMAGARDE_PHARMACY_DIRECTORY;
  });

  it("collecte les structures de santé (et elles seules) via Overpass, normalise, classe et stocke par ville", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "pharmagarde-osm-cache-"));
    process.env.PHARMAGARDE_CACHE_DIR = cacheDir;
    process.env.PHARMAGARDE_OSM_REQUEST_DELAY_MS = "0";

    const { SUPPORTED_CITIES, getCacheState, updateCachedDataset } = await import("../server/pharmagarde-cache");
    const queries: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(String(input)).toBe("https://overpass-api.de/api/interpreter");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["user-agent"]).toContain("PharmaGardeBF");
      const query = decodeURIComponent(String(init?.body).replace(/^data=/, ""));
      queries.push(query);
      const [, lat, lon] = /around:\d+,(-?[\d.]+),(-?[\d.]+)/.exec(query) ?? [];
      const base = { lat: Number(lat), lon: Number(lon) };
      const elements = [
        { type: "way", id: 10, center: base, tags: { amenity: "hospital", name: "CHU Yalgado Ouédraogo" } },
        // Même établissement cartographié aussi comme point : doit être dédoublonné.
        { type: "node", id: 14, ...base, tags: { amenity: "hospital", name: "CHU Yalgado Ouédraogo" } },
        { type: "node", id: 11, lat: base.lat + 0.01, lon: base.lon, tags: { amenity: "clinic", name: "Clinique Sandof", phone: "+226 25 00 00 00" } },
        { type: "node", id: 12, lat: base.lat + 0.02, lon: base.lon, tags: { healthcare: "centre", name: "CSPS Secteur 15" } },
        { type: "node", id: 13, lat: base.lat + 0.03, lon: base.lon, tags: { amenity: "doctors" } },
        { type: "node", id: 15, lat: base.lat + 0.04, lon: base.lon, tags: { amenity: "clinic", name: "Clinique vétérinaire du Kadiogo" } },
        { type: "node", id: 16, tags: { amenity: "clinic", name: "Sans coordonnées" } },
      ];
      return { ok: true, json: async () => ({ elements }) } as Response;
    });

    const healthcareResult = await updateCachedDataset("healthcare", true);

    expect(healthcareResult.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(SUPPORTED_CITIES.length);
    expect(queries.every((query) => query.startsWith("[out:json]") && query.includes("out center tags;") && !query.includes("pharmacy"))).toBe(true);

    const healthcare = getCacheState("healthcare").byCity.ouagadougou;
    expect(healthcare.map((item) => [item.name, item.type])).toEqual([
      ["CHU Yalgado Ouédraogo", "CHU"],
      ["Clinique Sandof", "Clinique"],
      ["CSPS Secteur 15", "CSPS"],
    ]);
    expect(healthcare[1]).toMatchObject({ id: "osm-node-11", osmId: "node/11", source: "osm", phone: "+226 25 00 00 00" });
    expect(getCacheState("healthcare").byCity["bobo-dioulasso"].every((item) => item.city === "Bobo-Dioulasso")).toBe(true);
  });

  it("garde les villes réussies et signale les erreurs Overpass sans vider le cache", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "pharmagarde-osm-errors-"));
    process.env.PHARMAGARDE_CACHE_DIR = cacheDir;
    process.env.PHARMAGARDE_OSM_REQUEST_DELAY_MS = "0";

    const { updateCachedDataset } = await import("../server/pharmagarde-cache");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 429, statusText: "Too Many Requests", json: async () => ({}) } as Response);

    const result = await updateCachedDataset("healthcare", true);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Overpass a répondu 429");
  });
});
