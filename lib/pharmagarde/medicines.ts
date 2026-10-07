import type { Medicine, MedicineProductType } from "./types";

/** Ordre d'affichage des types de produits (listes de la Liste nationale). */
export const MEDICINE_TYPE_ORDER: readonly MedicineProductType[] = ["Médicaments adultes", "Médicaments enfants", "Intrants nutritionnels", "Dispositifs médicaux"];

/** « 1 500 – 2 500 FCFA », « 20 700 FCFA » ou « Prix variable ». */
export function formatPriceRange(priceApprox?: number, priceMax?: number) {
  if (priceApprox === undefined) return "Prix variable";
  const format = (value: number) => value.toLocaleString("fr-FR");
  return priceMax !== undefined && priceMax > priceApprox ? `${format(priceApprox)} – ${format(priceMax)} FCFA` : `${format(priceApprox)} FCFA`;
}

/** Forme et dosage sur une ligne : « Comprimé · 500 mg ». */
export function medicineFormLabel(medicine: Pick<Medicine, "pharmaceuticalType" | "dosage">) {
  return [medicine.pharmaceuticalType, medicine.dosage].filter(Boolean).join(" · ");
}

export function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function medicineSearchText(medicine: Medicine) {
  return normalizeSearchText(
    [medicine.name, medicine.dosage, medicine.pharmaceuticalType, medicine.productType, medicine.category, medicine.subcategory, medicine.ageCategory, "Médicament"].filter(Boolean).join(" "),
  );
}

export type MedicineFilter = { query?: string; productType?: MedicineProductType | null; category?: string | null; subcategory?: string | null };

export function filterMedicines(medicines: readonly Medicine[], filter: MedicineFilter) {
  const query = normalizeSearchText((filter.query ?? "").trim());
  const words = query ? query.split(/\s+/) : [];
  return medicines.filter((medicine) => {
    if (filter.productType && medicine.productType !== filter.productType) return false;
    if (filter.category && medicine.category !== filter.category) return false;
    if (filter.subcategory && medicine.subcategory !== filter.subcategory) return false;
    if (words.length === 0) return true;
    const text = medicineSearchText(medicine);
    return words.every((word) => text.includes(word));
  });
}

export type FacetOption = { value: string; count: number };

/** Valeurs distinctes d'un champ, dans l'ordre de la liste (celui du document officiel), avec leur effectif. */
export function facetOptions(medicines: readonly Medicine[], field: "productType" | "category" | "subcategory"): FacetOption[] {
  const counts = new Map<string, number>();
  for (const medicine of medicines) {
    const value = medicine[field];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const options = [...counts].map(([value, count]) => ({ value, count }));
  if (field === "productType") options.sort((a, b) => MEDICINE_TYPE_ORDER.indexOf(a.value as MedicineProductType) - MEDICINE_TYPE_ORDER.indexOf(b.value as MedicineProductType));
  return options;
}
