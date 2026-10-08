import { readFileSync } from "node:fs";
import path from "node:path";

import type { Medicine, MedicineProductType } from "../lib/pharmagarde/types";

// S12 : catalogue servi uniquement par le serveur (GET /medicaments) aux abonnés Premium. Il n'est
// pas embarqué dans l'app, où il serait lisible sans abonnement.
//
// Source : Liste nationale des médicaments et autres produits essentiels de santé du Burkina Faso
// (édition 2023), versionnée dans server/data/medicines.json et générée à partir du tableur par
// `pnpm import:medicines chemin/vers/liste.xlsx`.

export const MEDICINES_CATALOG_PATH = process.env.PHARMAGARDE_MEDICINES_CATALOG ?? path.join(process.cwd(), "server", "data", "medicines.json");

export const MEDICINE_PRODUCT_TYPES: readonly MedicineProductType[] = ["Médicaments enfants", "Médicaments adultes", "Intrants nutritionnels", "Dispositifs médicaux"];

export type MedicinesCatalog = {
  version: 1;
  source: string;
  updatedAt: string;
  medicines: Medicine[];
};

export const MEDICINES_NOTICE =
  "Liste nationale des médicaments et autres produits essentiels de santé du Burkina Faso (édition 2023). Prix approximatifs en FCFA, à l’unité indiquée : prix public officiel lorsqu’il est fixé par arrêté, estimation sinon. Les prix peuvent varier selon la ville, la disponibilité et le point de vente.";

function fail(index: number, message: string): never {
  throw new Error(`Catalogue des médicaments, produit ${index + 1} : ${message}`);
}

/** Vérifie le catalogue versionné : identifiants uniques, type connu, prix cohérents. */
export function validateMedicinesCatalog(raw: unknown): MedicinesCatalog {
  const catalog = raw as Partial<MedicinesCatalog> | null;
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.medicines)) throw new Error("Catalogue des médicaments illisible (version 1 attendue).");
  const ids = new Set<string>();
  catalog.medicines.forEach((medicine, index) => {
    if (!medicine || typeof medicine.id !== "string" || !medicine.id) fail(index, "identifiant manquant");
    if (ids.has(medicine.id)) fail(index, `identifiant en double (${medicine.id})`);
    ids.add(medicine.id);
    if (medicine.type !== "medicine" || typeof medicine.name !== "string" || !medicine.name.trim()) fail(index, "nom manquant");
    if (!medicine.productType || !MEDICINE_PRODUCT_TYPES.includes(medicine.productType)) fail(index, `type inconnu (${String(medicine.productType)})`);
    const { priceApprox, priceMax } = medicine;
    if (priceApprox !== undefined && !(Number.isFinite(priceApprox) && priceApprox > 0)) fail(index, "prix invalide");
    if (priceMax !== undefined && !(priceApprox !== undefined && Number.isFinite(priceMax) && priceMax >= priceApprox)) fail(index, "fourchette de prix invalide");
  });
  return { version: 1, source: String(catalog.source ?? ""), updatedAt: String(catalog.updatedAt ?? ""), medicines: catalog.medicines };
}

let loaded: MedicinesCatalog | null = null;

/** Catalogue lu une seule fois depuis server/data/medicines.json. */
export function getMedicinesCatalog(filePath = MEDICINES_CATALOG_PATH): MedicinesCatalog {
  if (!loaded || filePath !== MEDICINES_CATALOG_PATH) {
    const catalog = validateMedicinesCatalog(JSON.parse(readFileSync(filePath, "utf8")));
    if (filePath !== MEDICINES_CATALOG_PATH) return catalog;
    loaded = catalog;
  }
  return loaded;
}

export function getEssentialMedicines(): Medicine[] {
  return getMedicinesCatalog().medicines;
}

/** Champs d'un produit modifiables depuis la console. */
export const EDITABLE_MEDICINE_FIELDS = ["name", "productType", "category", "subcategory", "ageCategory", "pharmaceuticalType", "dosage", "priceApprox", "priceMax", "priceUnit", "priceOfficial"] as const;
export type MedicineEdit = Partial<Pick<Medicine, (typeof EDITABLE_MEDICINE_FIELDS)[number]>>;

export type MedicineOverride = { id: string; data: MedicineEdit; hidden: boolean; added: boolean; updatedAt?: Date | string | null };
export type MedicineCategoryLabel = { level: "category" | "subcategory"; original: string; label: string };
export type AdminMedicine = Medicine & { hidden: boolean; source: "catalog" | "modified" | "added"; updatedAt: string | null };

let overlay: { overrides: MedicineOverride[]; labels: MedicineCategoryLabel[] } = { overrides: [], labels: [] };
let overlayVersion = 0;
let mergedCache: { version: number; items: AdminMedicine[] } | null = null;

/** Lit le JSON partiel enregistré en base ; les champs inconnus ou mal typés sont ignorés. */
export function parseMedicineEdit(raw: unknown): MedicineEdit {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const edit: Record<string, unknown> = {};
  for (const field of EDITABLE_MEDICINE_FIELDS) {
    const item = record[field];
    if (item === undefined) continue;
    if (field === "priceApprox" || field === "priceMax") {
      if (item === null || (typeof item === "number" && Number.isFinite(item) && item > 0)) edit[field] = item;
    } else if (field === "priceOfficial") {
      if (typeof item === "boolean") edit[field] = item;
    } else if (field === "productType") {
      if (MEDICINE_PRODUCT_TYPES.includes(item as MedicineProductType)) edit[field] = item;
    } else if (item === null || typeof item === "string") {
      edit[field] = item;
    }
  }
  return edit as MedicineEdit;
}

/** Remplace les modifications de la console (rechargées depuis la base). */
export function setMedicineOverlay(overrides: readonly MedicineOverride[], labels: readonly MedicineCategoryLabel[]) {
  overlay = { overrides: [...overrides], labels: [...labels] };
  overlayVersion += 1;
}

/** Change à chaque rechargement des modifications : sert à invalider les réponses préparées. */
export function medicinesOverlayVersion() {
  return overlayVersion;
}

export function applyEdit(medicine: Medicine, edit: MedicineEdit): Medicine {
  const next: Record<string, unknown> = { ...medicine };
  for (const [key, value] of Object.entries(edit)) {
    if (value === null || value === "") delete next[key];
    else next[key] = value;
  }
  // Une fourchette sans bas de fourchette n'a pas de sens : le maximum seul est retiré.
  if (next.priceMax !== undefined && (next.priceApprox === undefined || (next.priceMax as number) < (next.priceApprox as number))) delete next.priceMax;
  return next as Medicine;
}

export type EffectiveMedicine = { medicine: Medicine; base: Medicine | null; hidden: boolean; source: AdminMedicine["source"]; updatedAt: string | null };

/** Catalogue versionné + modifications de la console, avant renommage des catégories. */
export function getEffectiveMedicines(): EffectiveMedicine[] {
  const overrides = new Map(overlay.overrides.map((override) => [override.id, override]));
  const toIso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);
  const base = getMedicinesCatalog().medicines;
  const baseIds = new Set(base.map((medicine) => medicine.id));
  const items: EffectiveMedicine[] = base.map((medicine) => {
    const override = overrides.get(medicine.id);
    return override
      ? { medicine: applyEdit(medicine, override.data), base: medicine, hidden: override.hidden, source: "modified", updatedAt: toIso(override.updatedAt) }
      : { medicine, base: medicine, hidden: false, source: "catalog", updatedAt: null };
  });
  for (const override of overlay.overrides) {
    if (baseIds.has(override.id) || !override.added || !override.data.name) continue;
    items.push({ medicine: applyEdit({ id: override.id, type: "medicine", name: override.data.name }, override.data), base: null, hidden: override.hidden, source: "added", updatedAt: toIso(override.updatedAt) });
  }
  return items;
}

/** Intitulés de catégorie et de sous-catégorie corrigés depuis la console. */
export function relabelMedicine(medicine: Medicine): Medicine {
  const label = (level: MedicineCategoryLabel["level"], original?: string) => (original ? overlay.labels.find((item) => item.level === level && item.original === original)?.label : undefined);
  const category = label("category", medicine.category);
  const subcategory = label("subcategory", medicine.subcategory);
  return category || subcategory ? { ...medicine, ...(category ? { category } : {}), ...(subcategory ? { subcategory } : {}) } : medicine;
}

/** Catalogue tel que publié (catégories renommées), produits masqués compris. */
export function getAdminMedicines(): AdminMedicine[] {
  if (mergedCache?.version === overlayVersion) return mergedCache.items;
  const items = getEffectiveMedicines().map(({ medicine, hidden, source, updatedAt }) => ({ ...relabelMedicine(medicine), hidden, source, updatedAt }));
  mergedCache = { version: overlayVersion, items };
  return items;
}

/** Produits publiés dans l'application (sans les produits masqués ni les champs propres à la console). */
export function getPublishedMedicines(): Medicine[] {
  return getAdminMedicines()
    .filter((medicine) => !medicine.hidden)
    .map(({ hidden: _hidden, source: _source, updatedAt: _updatedAt, ...medicine }) => medicine);
}

/** Champs à enregistrer pour obtenir `next` à partir de `base` (null : champ vidé dans la console). */
export function medicineEditBetween(base: Medicine | null, next: MedicineEdit): MedicineEdit {
  const edit: Record<string, unknown> = {};
  for (const field of EDITABLE_MEDICINE_FIELDS) {
    const raw = next[field];
    const value = raw === "" || raw === undefined ? null : raw;
    const current = base?.[field] ?? null;
    if (value !== current && !(base === null && value === null)) edit[field] = value;
  }
  return edit as MedicineEdit;
}

/** Champs dont la valeur diffère (pour les rapports d'import et le journal). */
export function changedMedicineFields(current: Medicine, next: MedicineEdit) {
  return EDITABLE_MEDICINE_FIELDS.filter((field) => (next[field] ?? null) !== (current[field] ?? null) && !(next[field] === "" && current[field] === undefined));
}
