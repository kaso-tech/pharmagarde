import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { facetOptions, filterMedicines, formatPriceRange } from "../lib/pharmagarde/medicines";
import { parsePrice, serializeCatalog } from "../scripts/import-medicines";
import { getEssentialMedicines, getMedicinesCatalog, validateMedicinesCatalog } from "../server/medicines-data";

const medicines = getEssentialMedicines();

describe("catalogue des médicaments et produits essentiels (Liste nationale 2023)", () => {
  it("remplace l'ancien catalogue par les 1 787 produits du tableur, répartis par type", () => {
    expect(medicines).toHaveLength(1787);
    expect(Object.fromEntries(facetOptions(medicines, "productType").map((option) => [option.value, option.count]))).toEqual({
      "Médicaments adultes": 617,
      "Médicaments enfants": 511,
      "Intrants nutritionnels": 12,
      "Dispositifs médicaux": 647,
    });
    expect(medicines.some((medicine) => medicine.id === "paracetamol-500mg")).toBe(false);
  });

  it("renseigne type, catégorie, sous-catégorie, forme et prix", () => {
    for (const medicine of medicines) {
      expect(medicine.type).toBe("medicine");
      expect(medicine.name.trim().length).toBeGreaterThan(0);
      expect(medicine.priceApprox).toBeGreaterThan(0);
      if (medicine.productType !== "Intrants nutritionnels") expect(medicine.category).toMatch(/^\d+\. /);
    }
    // Seuls la carbocistéine et l'air médical n'ont pas de forme dans le document source.
    expect(medicines.filter((medicine) => medicine.productType?.startsWith("Médicaments") && !medicine.pharmaceuticalType).map((medicine) => medicine.id)).toEqual(["enf-477-carbocisteine", "adu-1-air-medical"]);
    expect(medicines.find((medicine) => medicine.id === "enf-1-citrate-de-sufentanil")).toMatchObject({
      productType: "Médicaments enfants",
      ageCategory: "Enfant",
      category: "1. ANESTHESIQUES",
      subcategory: "1.1 Anesthésiques généraux et oxygène",
      pharmaceuticalType: "Injectable",
      priceApprox: 1500,
      priceMax: 2500,
      priceUnit: "par ampoule / flacon",
      priceOfficial: false,
    });
    expect(medicines.filter((medicine) => medicine.priceOfficial)).toHaveLength(377);
  });

  it("remplace les intitulés de catégorie absents ou tronqués du document source", () => {
    const categories = new Set(medicines.map((medicine) => medicine.category));
    expect(categories.has("19. SERUMS, IMMUNOGLOBULINES ET VACCINS")).toBe(true);
    expect(categories.has("14. CONSOMMABLES ET REACTIFS D'HEMODIALYSE")).toBe(true);
    expect([...categories].some((category) => category?.includes("intitulé absent") || category === "14. CONSOMMABLES ET R")).toBe(false);
  });

  it("valide le fichier versionné et refuse un catalogue incohérent", () => {
    expect(() => getMedicinesCatalog()).not.toThrow();
    const base = { version: 1, source: "", updatedAt: "", medicines: [{ id: "a", type: "medicine", name: "A", productType: "Médicaments adultes", priceApprox: 100 }] };
    expect(() => validateMedicinesCatalog(base)).not.toThrow();
    expect(() => validateMedicinesCatalog({ ...base, medicines: [...base.medicines, ...base.medicines] })).toThrow(/double/);
    expect(() => validateMedicinesCatalog({ ...base, medicines: [{ ...base.medicines[0], productType: "Autre" }] })).toThrow(/type inconnu/);
    expect(() => validateMedicinesCatalog({ ...base, medicines: [{ ...base.medicines[0], priceMax: 50 }] })).toThrow(/fourchette/);
  });

  it("garde une ligne par produit dans le fichier JSON", () => {
    const catalog = getMedicinesCatalog();
    expect(readFileSync("server/data/medicines.json", "utf8")).toBe(serializeCatalog(catalog));
  });
});

describe("import et affichage des prix", () => {
  it("lit les prix uniques et les fourchettes du tableur", () => {
    expect(parsePrice("1 500 – 2 500")).toEqual({ priceApprox: 1500, priceMax: 2500 });
    expect(parsePrice(20700)).toEqual({ priceApprox: 20700 });
    expect(parsePrice(7.5)).toEqual({ priceApprox: 7.5 });
    expect(parsePrice("")).toEqual({});
  });

  it("affiche une fourchette ou un prix unique en FCFA", () => {
    expect(formatPriceRange(1500, 2500)).toBe(`${(1500).toLocaleString("fr-FR")} – ${(2500).toLocaleString("fr-FR")} FCFA`);
    expect(formatPriceRange(300)).toBe("300 FCFA");
    expect(formatPriceRange(undefined)).toBe("Prix variable");
  });
});

describe("recherche et filtres du catalogue", () => {
  it("filtre par type, catégorie et sous-catégorie, et cherche sans tenir compte des accents", () => {
    const adults = filterMedicines(medicines, { productType: "Médicaments adultes" });
    expect(adults).toHaveLength(617);
    const access = filterMedicines(medicines, { productType: "Médicaments adultes", category: "6. ANTI-INFECTIEUX", subcategory: "6.2.1 Antibiotiques du groupe Access" });
    expect(access).toHaveLength(21);
    expect(filterMedicines(medicines, { query: "paracetamol" }).every((medicine) => /parac[ée]tamol/i.test(medicine.name))).toBe(true);
    expect(filterMedicines(medicines, { query: "paracetamol" }).length).toBeGreaterThan(0);
    expect(facetOptions(adults, "category")[0]).toEqual({ value: "1. ANESTHESIQUES", count: expect.any(Number) });
  });
});
