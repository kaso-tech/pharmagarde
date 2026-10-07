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
