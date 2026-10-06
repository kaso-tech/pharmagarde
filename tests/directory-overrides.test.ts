import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DirectoryEntry } from "../drizzle/schema";
import { applyDirectoryOverrides } from "../server/directory-overrides";
import type { CachedHealthPlace } from "../server/pharmagarde-cache";

const getDirectoryOverrides = vi.fn<() => Promise<DirectoryEntry[]>>();
vi.mock("../server/directory-overrides", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/directory-overrides")>();
  return { ...original, getDirectoryOverrides: () => getDirectoryOverrides() };
});

function entry(value: Partial<DirectoryEntry> & Pick<DirectoryEntry, "id" | "kind">): DirectoryEntry {
  return {
    status: "active",
    city: null,
    name: null,
    phone: null,
    address: null,
    latitude: null,
    longitude: null,
    dutyGroup: null,
    establishmentType: null,
    createdAt: new Date("2026-10-06T10:00:00.000Z"),
    updatedAt: new Date("2026-10-06T10:00:00.000Z"),
    ...value,
  };
}

const pharmacies: CachedHealthPlace[] = [
  { id: "ph-abby", type: "Pharmacie", category: "pharmacy", name: "Pharmacie Abby", city: "Bobo-Dioulasso", phone: "+226 20 97 63 64", latitude: 11.17, longitude: -4.29, dutyGroup: 4, source: "annuaire" },
  { id: "ph-centrale", type: "Pharmacie", category: "pharmacy", name: "Pharmacie Centrale", city: "Ouagadougou", phone: "+226 25 30 00 00", latitude: 12.37, longitude: -1.52, dutyGroup: 1, source: "annuaire" },
];

describe("annuaire public · surcharges de la console d’administration", () => {
  it("remplace une fiche modifiée à sa place, champs vidés compris", () => {
    const result = applyDirectoryOverrides(pharmacies, [entry({ id: "ph-abby", kind: "pharmacy", city: "Bobo-Dioulasso", name: "Pharmacie Abby (nouvelle adresse)", latitude: 11.18, longitude: -4.3, dutyGroup: 2 })], "pharmacy");

    expect(result.map((item) => item.id)).toEqual(["ph-abby", "ph-centrale"]);
    expect(result[0]).toMatchObject({ name: "Pharmacie Abby (nouvelle adresse)", dutyGroup: 2, latitude: 11.18, source: "admin", updatedAt: "2026-10-06T10:00:00.000Z" });
    expect(result[0]?.phone).toBeUndefined();
    expect(pharmacies[0]?.name).toBe("Pharmacie Abby");
  });

  it("retire une fiche archivée et ajoute une fiche créée dans la console", () => {
    const result = applyDirectoryOverrides(
      pharmacies,
      [entry({ id: "ph-centrale", kind: "pharmacy", status: "archived" }), entry({ id: "admin-pharmacy-ouagadougou-pharmacie-neuve", kind: "pharmacy", city: "Ouagadougou", name: "Pharmacie Neuve", latitude: 12.36, longitude: -1.5, dutyGroup: 3 })],
      "pharmacy",
    );

    expect(result.map((item) => item.id)).toEqual(["ph-abby", "admin-pharmacy-ouagadougou-pharmacie-neuve"]);
    expect(result[1]).toMatchObject({ type: "Pharmacie", category: "pharmacy", city: "Ouagadougou", dutyGroup: 3 });
  });

  it("ne publie une fiche que dans la liste de son type", () => {
    const moved = entry({ id: "ph-abby", kind: "healthcare", city: "Bobo-Dioulasso", name: "Clinique Abby", establishmentType: "Clinique" });
    expect(applyDirectoryOverrides(pharmacies, [moved], "pharmacy").map((item) => item.id)).toEqual(["ph-centrale"]);
    expect(applyDirectoryOverrides([], [moved], "healthcare")).toMatchObject([{ id: "ph-abby", type: "Clinique", category: "healthcare", dutyGroup: undefined }]);
  });
});

describe("routes /pharmacies avec surcharges", () => {
  afterEach(() => {
    getDirectoryOverrides.mockReset();
    vi.restoreAllMocks();
    delete process.env.PHARMAGARDE_CACHE_DIR;
  });

  it("sert les modifications de la console et suit la ville saisie", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "pharmagarde-overrides-"));
    await writeFile(
      path.join(cacheDir, "pharmacies.json"),
      JSON.stringify({
        version: 3,
        kind: "pharmacies",
        byCity: {
          ouagadougou: [pharmacies[1]],
          "bobo-dioulasso": [pharmacies[0]],
        },
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        lastRefreshAttemptAt: null,
      }),
      "utf8",
    );
    process.env.PHARMAGARDE_CACHE_DIR = cacheDir;
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    getDirectoryOverrides.mockResolvedValue([
      entry({ id: "ph-centrale", kind: "pharmacy", status: "archived" }),
      entry({ id: "ph-abby", kind: "pharmacy", city: "Ouagadougou", name: "Pharmacie Abby", phone: "+226 70 11 22 33", latitude: 12.35, longitude: -1.51, dutyGroup: 2 }),
    ]);

    vi.resetModules();
    const { initializePharmaGardeCache, registerPharmaGardeCacheRoutes } = await import("../server/pharmagarde-cache");
    await initializePharmaGardeCache();
    let route: ((req: unknown, res: unknown) => Promise<void>) | undefined;
    registerPharmaGardeCacheRoutes({ get: (routePath: string, handler: never) => (routePath === "/pharmacies" ? (route = handler) : undefined), post: () => undefined } as never);

    const body = async (query: Record<string, string>) => {
      const res = { headers: {} as Record<string, string>, body: null as unknown, setHeader(name: string, value: string) { this.headers[name] = value; }, json(payload: unknown) { this.body = payload; return this; } };
      await route?.({ headers: {}, header: () => undefined, query }, res);
      return res.body as { pharmacies: CachedHealthPlace[]; meta: { totalItemCount: number } };
    };

    const ouaga = await body({ city: "Ouagadougou" });
    expect(ouaga.pharmacies).toMatchObject([{ id: "ph-abby", phone: "+226 70 11 22 33", dutyGroup: 2, source: "admin" }]);
    expect(ouaga.meta.totalItemCount).toBe(1);
    expect((await body({ city: "Bobo-Dioulasso" })).pharmacies).toEqual([]);
  });
});
