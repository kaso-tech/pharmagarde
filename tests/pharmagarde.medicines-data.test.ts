import { describe, expect, it } from "vitest";

import { ESSENTIAL_MEDICINES as LOCAL_ESSENTIAL_MEDICINES } from "../server/medicines-data";

describe("catalogue local des médicaments essentiels", () => {
  it("fournit les champs nécessaires à l’affichage mobile demandé", () => {
    expect(LOCAL_ESSENTIAL_MEDICINES.length).toBeGreaterThanOrEqual(20);

    for (const medicine of LOCAL_ESSENTIAL_MEDICINES) {
      expect(medicine.type).toBe("medicine");
      expect(medicine.name.trim().length).toBeGreaterThan(0);
      expect(medicine.category?.trim().length).toBeGreaterThan(0);
      expect(["Enfant", "Adulte", "Tous"]).toContain(medicine.ageCategory);
      expect(medicine.pharmaceuticalType?.trim().length).toBeGreaterThan(0);
      expect(typeof medicine.priceApprox).toBe("number");
      expect(medicine.priceApprox).toBeGreaterThan(0);
    }
  });

  it("couvre les catégories enfant et adulte ainsi que plusieurs formes pharmaceutiques", () => {
    const ageCategories = new Set(LOCAL_ESSENTIAL_MEDICINES.map((medicine) => medicine.ageCategory));
    const forms = new Set(LOCAL_ESSENTIAL_MEDICINES.map((medicine) => medicine.pharmaceuticalType));

    expect(ageCategories.has("Enfant")).toBe(true);
    expect(ageCategories.has("Adulte")).toBe(true);
    expect(forms.size).toBeGreaterThanOrEqual(6);
  });
});
