import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({ getDb: async () => null, getUserByOpenId: vi.fn(), deleteUserAccount: vi.fn() }));

const { analyzeDirectory, filterVerificationQueue, osmCandidates, indexOsmPlaces, sortVerificationQueue } = await import("../server/place-verification");
const { applyDirectoryOverrides } = await import("../server/directory-overrides");

type Item = Parameters<typeof analyzeDirectory>[0]["items"][number];
type Osm = Parameters<typeof analyzeDirectory>[0]["osm"][number];
type Check = Parameters<typeof analyzeDirectory>[0]["checks"][number];

function item(overrides: Partial<Item> & Pick<Item, "id" | "name">): Item {
  return { kind: "healthcare", status: "active", city: "Ouagadougou", phone: "+226 70 00 00 01", address: null, latitude: 12.37, longitude: -1.52, dutyGroup: null, establishmentType: "Clinique", openingHours: null, insurances: [], source: "annuaire", managed: false, updatedAt: null, ...overrides };
}

function osm(name: string, latitude: number, longitude: number): Osm {
  return { id: `osm-${name}`, osmId: `node/${name.length}`, type: "Clinique", category: "healthcare", name, city: "Ouagadougou", latitude, longitude, source: "osm" };
}

function check(id: string, overrides: Partial<Check> = {}): Check {
  return { id, kind: "healthcare", status: "verified", positionConfirmed: true, note: null, checkedBy: 1, checkedAt: new Date("2026-10-20T10:00:00Z"), ...overrides };
}

describe("vérification des établissements", () => {
  const items = [
    item({ id: "hc-odile", name: "Clinique Sainte Odile", phone: "+226 70 33 33 33", approximateLocation: true }),
    // À 2,2 km du lieu OpenStreetMap de même nom.
    item({ id: "hc-nord", name: "Clinique du Nord", latitude: 12.40, longitude: -1.52, phone: null }),
    // Même point (moins de 40 m) qu'une autre fiche.
    item({ id: "hc-a", name: "Cabinet Shalom", latitude: 12.3, longitude: -1.5, phone: "+226 70 11 11 11" }),
    item({ id: "hc-b", name: "Optique Vision", latitude: 12.30002, longitude: -1.5, phone: "+226 70 22 22 22" }),
    item({ id: "hc-sans", name: "CSPS Espoir", phone: "+226 70 44 44 44", latitude: null, longitude: null }),
    item({ id: "hc-archive", name: "Clinique fermée", status: "archived" }),
  ];
  const places = [osm("Clinique Ste Odile", 12.3701, -1.5201), osm("Clinique du Nord", 12.38, -1.52), osm("Hôpital Yalgado", 12.38, -1.52)];

  it("détecte les problèmes de chaque fiche publiée", () => {
    const entries = analyzeDirectory({ items, osm: places, checks: [], reports: [{ placeId: "hc-a", createdAt: new Date("2026-10-21T10:00:00Z") }] });
    const issues = Object.fromEntries(entries.map((entry) => [entry.id, entry.issues]));
    expect(entries.map((entry) => entry.id)).not.toContain("hc-archive");
    expect(issues).toEqual({
      "hc-odile": ["approximate"],
      "hc-nord": ["position_gap", "no_phone"],
      "hc-a": ["reported", "duplicate"],
      "hc-b": ["duplicate"],
      "hc-sans": ["no_position"],
    });
    expect(entries.find((entry) => entry.id === "hc-nord")?.osmGapMeters).toBeGreaterThan(2000);
    expect(sortVerificationQueue(entries).map((entry) => entry.id)).toEqual(["hc-a", "hc-nord", "hc-b", "hc-odile", "hc-sans"]);
  });

  it("une position confirmée n'est plus approximative ; un nouveau signalement rouvre la fiche", () => {
    const entries = analyzeDirectory({
      items,
      osm: places,
      checks: [check("hc-odile"), check("hc-nord"), check("hc-a"), check("hc-b", { status: "needs_visit", positionConfirmed: false })],
      reports: [{ placeId: "hc-a", createdAt: new Date("2026-10-21T10:00:00Z") }],
    });
    const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
    expect(byId["hc-odile"]).toMatchObject({ approximate: false, issues: [], status: "verified" });
    expect(byId["hc-nord"]).toMatchObject({ issues: ["no_phone"], status: "verified" });
    expect(byId["hc-a"]?.status).toBe("todo");
    expect(byId["hc-b"]?.status).toBe("needs_visit");
    expect(filterVerificationQueue(entries, { status: "todo" }).map((entry) => entry.id)).toEqual(["hc-a", "hc-sans"]);
    expect(filterVerificationQueue(entries, { status: "all", issue: "duplicate", search: "optique" }).map((entry) => entry.id)).toEqual(["hc-b"]);
  });

  it("propose les lieux OpenStreetMap au nom proche", () => {
    const candidates = osmCandidates(items[0]!, indexOsmPlaces(places));
    expect(candidates).toEqual([expect.objectContaining({ name: "Clinique Ste Odile", similarity: 1, distanceMeters: 16 })]);
  });

  it("retire la mention approximative des positions confirmées dans l'application", () => {
    const published = [
      { id: "hc-odile", type: "Clinique" as const, category: "healthcare" as const, name: "Clinique Sainte Odile", city: "Ouagadougou", latitude: 12.37, longitude: -1.52, approximateLocation: true, source: "annuaire" as const },
      { id: "hc-autre", type: "CSPS" as const, category: "healthcare" as const, name: "CSPS Espoir", city: "Ouagadougou", latitude: 12.3, longitude: -1.5, approximateLocation: true, source: "annuaire" as const },
    ];
    const result = applyDirectoryOverrides(published, [], "healthcare", new Set(["hc-odile"]));
    expect(result.map((place) => place.approximateLocation)).toEqual([undefined, true]);
  });
});
