import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({ getDb: async () => null, getUserByOpenId: vi.fn(), deleteUserAccount: vi.fn() }));

const { loadHealthcareDirectory, validateHealthcareDirectory } = await import("../server/healthcare-directory");
const { mergeHealthcareDirectory, normalizeOsmElement } = await import("../server/pharmagarde-cache");
const { SUPPORTED_CITIES } = await import("../server/cities");

describe("annuaire des structures de santé", () => {
  it("est valide et ne contient que des structures avec position", async () => {
    const directory = await loadHealthcareDirectory();
    expect(directory.places.length).toBe(257);
    const byCity: Record<string, number> = {};
    for (const place of directory.places) {
      byCity[place.city] = (byCity[place.city] ?? 0) + 1;
      expect(Number.isFinite(place.latitude) && Number.isFinite(place.longitude)).toBe(true);
      expect(place.id).toMatch(/^hc-/);
      expect(Object.keys(place).every((key) => ["id", "city", "name", "type", "phone", "address", "latitude", "longitude"].includes(key))).toBe(true);
    }
    expect(byCity).toEqual({ "Fada N'gourma": 3, Koupéla: 4, Ouagadougou: 247, Tenkodogo: 3 });
  });

  it("classe les lieux OpenStreetMap dans les nouveaux types", () => {
    const typeOf = (name: string, tags: Record<string, string> = {}) => normalizeOsmElement({ type: "node", id: 1, lat: 12.37, lon: -1.52, tags: { name, ...tags } }, SUPPORTED_CITIES[0]!)?.type;
    expect(typeOf("Clinique Dentaire Amaria")).toBe("Cabinet dentaire");
    expect(typeOf("Clinique Ophtalmologique La Lumière")).toBe("Ophtalmologie");
    expect(typeOf("Laboratoire Bio2000")).toBe("Laboratoire et imagerie");
    expect(typeOf("Lunetterie du Faso")).toBe("Opticien");
    expect(typeOf("Cabinet de Soins Infirmiers La Paix")).toBe("Cabinet de soins infirmiers");
    expect(typeOf("Cabinet Médical Aurore", { amenity: "doctors" })).toBe("Cabinet médical");
    expect(typeOf("Clinique Sainte Odile")).toBe("Clinique");
  });

  it("refuse un type inconnu ou des coordonnées incomplètes", () => {
    const base = { version: 1, updatedAt: "2026-10-22", source: "test" };
    expect(() => validateHealthcareDirectory({ ...base, places: [{ id: "hc-1", city: "Ouagadougou", name: "Clinique vétérinaire", type: "Vétérinaire", latitude: 12.3, longitude: -1.5 }] })).toThrow(/Type inconnu/);
    expect(() => validateHealthcareDirectory({ ...base, places: [{ id: "hc-1", city: "Ouagadougou", name: "CSPS", type: "CSPS", latitude: 12.3 }] })).toThrow(/incomplètes/);
  });

  it("remplace la structure OpenStreetMap correspondante et garde les autres", () => {
    const osm = {
      ouagadougou: [
        { id: "osm-1", type: "Centre de santé" as const, category: "healthcare" as const, name: "Clinique Sainte Odile", city: "Ouagadougou", phone: "+226 25 00 00 00", latitude: 12.36, longitude: -1.51, source: "osm" as const },
        { id: "osm-2", type: "CSPS" as const, category: "healthcare" as const, name: "CSPS de Zongo", city: "Ouagadougou", latitude: 12.3, longitude: -1.6, source: "osm" as const },
      ],
    };
    const merged = mergeHealthcareDirectory(osm, { version: 1, updatedAt: "2026-10-22", source: "test", places: [{ id: "hc-odile", city: "Ouagadougou", name: "Clinique Médicale Ste Odile", type: "Clinique", latitude: 12.3601, longitude: -1.5101 }] });
    expect(merged.ouagadougou?.map((item) => item.id)).toEqual(["osm-2", "hc-odile"]);
    // Le téléphone de la fiche OpenStreetMap est repris ; la source d'origine n'est pas modifiée.
    expect(merged.ouagadougou?.[1]).toMatchObject({ type: "Clinique", phone: "+226 25 00 00 00", source: "annuaire" });
    expect(osm.ouagadougou).toHaveLength(2);
  });
});
