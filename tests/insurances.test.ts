import { describe, expect, it } from "vitest";

import { INSURERS, formatInsurers, normalizeInsurerIds } from "../lib/pharmagarde/insurances";
import { directoryUpsertSchema, filterAdminDirectoryItems, mergeAdminDirectoryItems, normalizeDirectoryUpsert, type AdminDirectoryItem } from "../server/admin-directory";
import { applyDirectoryOverrides } from "../server/directory-overrides";

const pharmacy = { kind: "pharmacy" as const, city: "Ouagadougou", name: "Pharmacie Test", latitude: 12.37, longitude: -1.52 };

describe("assurances", () => {
  it("contient les 17 assurances de référence", () => {
    expect(INSURERS.map((insurer) => insurer.label)).toEqual(["Ascoma", "Coris", "Faari+", "GA", "Gras Savoye", "Maado", "MCI", "MSH", "Mutraf", "Olea", "Onea", "Raynal", "Saham", "Sonar", "Sunu", "UAB", "Yelen"]);
  });

  it("garde des identifiants valides, sans doublon, dans l'ordre de la liste", () => {
    expect(normalizeInsurerIds(["uab", "sunu", "inconnue", "uab"])).toEqual(["sunu", "uab"]);
    expect(normalizeInsurerIds('["yelen","faari-plus"]')).toEqual(["faari-plus", "yelen"]);
    expect(normalizeInsurerIds(null)).toEqual([]);
    expect(formatInsurers(["faari-plus", "gras-savoye"])).toBe("Faari+, Gras Savoye");
  });

  it("refuse une assurance inconnue et enregistre la sélection d'un établissement", () => {
    expect(directoryUpsertSchema.safeParse({ ...pharmacy, insurances: ["inconnue"] }).success).toBe(false);
    const entry = normalizeDirectoryUpsert(directoryUpsertSchema.parse({ ...pharmacy, insurances: ["uab", "sunu"] }));
    expect(JSON.parse(entry.insurances!)).toEqual(["sunu", "uab"]);
    expect(normalizeDirectoryUpsert(directoryUpsertSchema.parse(pharmacy)).insurances).toBeNull();
  });

  it("filtre l'annuaire de la console et publie les assurances dans l'API", () => {
    const base: AdminDirectoryItem[] = [
      { id: "a", kind: "pharmacy", status: "active", city: "Ouagadougou", name: "A", phone: null, address: null, latitude: 12.3, longitude: -1.5, dutyGroup: 1, establishmentType: "Pharmacie", openingHours: null, insurances: [], source: "annuaire", managed: false, updatedAt: null },
      { id: "b", kind: "pharmacy", status: "active", city: "Ouagadougou", name: "B", phone: null, address: null, latitude: 12.3, longitude: -1.5, dutyGroup: 2, establishmentType: "Pharmacie", openingHours: null, insurances: [], source: "annuaire", managed: false, updatedAt: null },
    ];
    const override = { id: "b", kind: "pharmacy", status: "active", city: "Ouagadougou", name: "B", phone: null, address: null, latitude: 12.3, longitude: -1.5, dutyGroup: 2, establishmentType: "Pharmacie", openingHours: null, insurances: '["sunu","uab"]', createdAt: new Date(), updatedAt: new Date() } as const;
    const merged = mergeAdminDirectoryItems(base, [override]);
    expect(filterAdminDirectoryItems(merged, { insurance: "sunu" }).map((item) => item.id)).toEqual(["b"]);
    const published = applyDirectoryOverrides([{ id: "b", type: "Pharmacie", category: "pharmacy", name: "B", city: "Ouagadougou" }], [override], "pharmacy");
    expect(published[0]?.insurances).toEqual(["sunu", "uab"]);
  });
});
