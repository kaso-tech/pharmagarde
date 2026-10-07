import { describe, expect, it } from "vitest";

import { directoryArchiveSchema, directoryUpsertSchema, filterAdminDirectoryItems, listDirectoryCities, mergeAdminDirectoryItems, normalizeDirectoryUpsert, type AdminDirectoryItem } from "../server/admin-directory";

const base: AdminDirectoryItem[] = [
  {
    id: "ph-ouagadougou-centrale",
    kind: "pharmacy",
    status: "active",
    city: "Ouagadougou",
    name: "Pharmacie Centrale",
    phone: "+226 70 00 00 00",
    address: null,
    latitude: 12.37,
    longitude: -1.52,
    dutyGroup: 1,
    establishmentType: "Pharmacie",
    openingHours: null,
    insurances: [],
    source: "annuaire",
    managed: false,
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
];

describe("console admin · annuaire", () => {
  it("applique une surcharge active sans écrire dans l’annuaire versionné", () => {
    const entries = mergeAdminDirectoryItems(base, [
      {
        id: "ph-ouagadougou-centrale",
        kind: "pharmacy",
        status: "active",
        city: "Ouagadougou",
        name: "Pharmacie Centrale mise à jour",
        phone: "+226 70 11 22 33",
        address: "Centre-ville",
        latitude: 12.37,
        longitude: -1.52,
        dutyGroup: 2,
        establishmentType: "Pharmacie",
        createdAt: new Date("2026-10-05T10:00:00.000Z"),
        updatedAt: new Date("2026-10-05T10:00:00.000Z"),
      },
    ] as never);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "Pharmacie Centrale mise à jour", dutyGroup: 2, managed: true, source: "admin" });
    expect(base[0]?.name).toBe("Pharmacie Centrale");
  });

  it("masque un élément archivé sans suppression physique, mais le garde restaurable", () => {
    const entries = mergeAdminDirectoryItems(base, [{ id: "ph-ouagadougou-centrale", kind: "pharmacy", status: "archived" }] as never);
    expect(filterAdminDirectoryItems(entries, {})).toEqual([]);
    expect(filterAdminDirectoryItems(entries, { status: "archived" })).toMatchObject([{ id: "ph-ouagadougou-centrale", status: "archived", name: "Pharmacie Centrale" }]);
  });

  it("filtre par ville sans tenir compte des accents ni de la casse, et par groupe de garde", () => {
    const items: AdminDirectoryItem[] = [
      ...base,
      { ...base[0]!, id: "ph-bobo-abby", city: "Bobo-Dioulasso", name: "Pharmacie Abby", dutyGroup: null },
      { ...base[0]!, id: "ph-bobo-aeroport", city: "Bobo-Dioulasso", name: "Pharmacie Aéroport", dutyGroup: 2 },
    ];
    expect(filterAdminDirectoryItems(items, { city: "bobo dioulasso" }).map((item) => item.id)).toEqual(["ph-bobo-abby", "ph-bobo-aeroport"]);
    expect(filterAdminDirectoryItems(items, { dutyGroup: "none" }).map((item) => item.id)).toEqual(["ph-bobo-abby"]);
    expect(filterAdminDirectoryItems(items, { dutyGroup: "2" }).map((item) => item.id)).toEqual(["ph-bobo-aeroport"]);
    expect(listDirectoryCities(items).slice(0, 2)).toEqual([{ name: "Bobo-Dioulasso", count: 2 }, { name: "Ouagadougou", count: 1 }]);
  });

  it("reprend l’orthographe d’une ville connue pour éviter les doublons", () => {
    const entry = normalizeDirectoryUpsert({ kind: "pharmacy", city: "  ouagadougou ", name: "Pharmacie Neuve", latitude: 12.36, longitude: -1.5 }, ["Ouagadougou", "Bobo-Dioulasso"]);
    expect(entry.city).toBe("Ouagadougou");
    expect(normalizeDirectoryUpsert({ kind: "pharmacy", city: "Koudougou", name: "Pharmacie Neuve", latitude: 12.25, longitude: -2.36 }, ["Ouagadougou"]).city).toBe("Koudougou");
  });

  it("exige des coordonnées pour une pharmacie, pas pour une structure de santé", () => {
    expect(directoryUpsertSchema.safeParse({ kind: "pharmacy", city: "Ouagadougou", name: "Pharmacie Test" }).success).toBe(false);
    expect(directoryUpsertSchema.safeParse({ kind: "pharmacy", city: "Ouagadougou", name: "Pharmacie Test", latitude: 12.37, longitude: -1.52 }).success).toBe(true);
    expect(directoryUpsertSchema.safeParse({ kind: "healthcare", city: "Ouagadougou", name: "CSPS Test" }).success).toBe(true);
  });

  it("refuse des coordonnées incomplètes, hors Burkina ou un téléphone non valide", () => {
    const common = { kind: "pharmacy" as const, city: "Ouagadougou", name: "Pharmacie Test" };
    expect(directoryUpsertSchema.safeParse({ ...common, latitude: 12.37 }).success).toBe(false);
    expect(directoryUpsertSchema.safeParse({ ...common, latitude: 48.85, longitude: 2.35 }).success).toBe(false);
    expect(directoryUpsertSchema.safeParse({ ...common, phone: "123" }).success).toBe(false);
  });

  it("exige une confirmation explicite pour archiver un établissement", () => {
    const target = { id: "ph-ouagadougou-centrale", kind: "pharmacy" as const };
    expect(directoryArchiveSchema.safeParse(target).success).toBe(false);
    expect(directoryArchiveSchema.safeParse({ ...target, confirmArchive: false }).success).toBe(false);
    expect(directoryArchiveSchema.safeParse({ ...target, confirmArchive: true }).success).toBe(true);
  });
});
