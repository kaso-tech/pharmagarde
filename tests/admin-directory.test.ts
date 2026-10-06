import { describe, expect, it } from "vitest";

import { directoryUpsertSchema, mergeAdminDirectoryItems, type AdminDirectoryItem } from "../server/admin-directory";

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

  it("masque un élément archivé sans suppression physique", () => {
    const entries = mergeAdminDirectoryItems(base, [{ id: "ph-ouagadougou-centrale", kind: "pharmacy", status: "archived" }] as never);
    expect(entries).toEqual([]);
  });

  it("refuse des coordonnées incomplètes, hors Burkina ou un téléphone non valide", () => {
    const common = { kind: "pharmacy" as const, city: "Ouagadougou", name: "Pharmacie Test" };
    expect(directoryUpsertSchema.safeParse({ ...common, latitude: 12.37 }).success).toBe(false);
    expect(directoryUpsertSchema.safeParse({ ...common, latitude: 48.85, longitude: 2.35 }).success).toBe(false);
    expect(directoryUpsertSchema.safeParse({ ...common, phone: "123" }).success).toBe(false);
  });
});
