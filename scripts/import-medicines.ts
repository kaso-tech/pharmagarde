// Importe le catalogue des médicaments et produits essentiels depuis le tableur Excel vers
// server/data/medicines.json. Le catalogue précédent est entièrement remplacé.
//
//   pnpm import:medicines chemin/vers/liste.xlsx
//
// Colonnes lues dans la feuille « Tous les produits avec prix » (ligne d'en-tête détectée) :
//   Produit · Forme · Dosage · Prix approximatif (FCFA) · Unité de prix · Source du prix · Liste ·
//   N° · Groupe · Sous-groupe

import { writeFile } from "node:fs/promises";

import ExcelJS from "exceljs";

import type { Medicine, MedicineProductType } from "../lib/pharmagarde/types";
import { MEDICINES_CATALOG_PATH, type MedicinesCatalog, validateMedicinesCatalog } from "../server/medicines-data";
import { slugify } from "../server/pharmacy-directory";

const SHEET_NAME = "Tous les produits avec prix";
const REQUIRED_COLUMNS = ["Produit", "Forme", "Dosage", "Prix approximatif (FCFA)", "Unité de prix", "Source du prix", "Liste", "N°", "Groupe", "Sous-groupe"] as const;
type Column = (typeof REQUIRED_COLUMNS)[number];

const LISTS: Record<string, { productType: MedicineProductType; prefix: string; ageCategory?: Medicine["ageCategory"] }> = {
  "medicaments-enfants": { productType: "Médicaments enfants", prefix: "enf", ageCategory: "Enfant" },
  "medicaments-adultes": { productType: "Médicaments adultes", prefix: "adu", ageCategory: "Adulte" },
  "intrants-nutritionnels": { productType: "Intrants nutritionnels", prefix: "nut" },
  "dispositifs-medicaux": { productType: "Dispositifs médicaux", prefix: "dm" },
};

/**
 * Intitulés de catégorie absents ou tronqués dans le PDF d'origine, remplacés par un intitulé tiré
 * des produits qu'elles contiennent (signalés dans le rapport d'import).
 */
const CATEGORY_FIXES: Record<string, string> = {
  "19. (intitulé absent du PDF d'origine)": "19. SERUMS, IMMUNOGLOBULINES ET VACCINS",
  "14. CONSOMMABLES ET R": "14. CONSOMMABLES ET REACTIFS D'HEMODIALYSE",
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
  }
  return String(value);
}

function clean(value: ExcelJS.CellValue) {
  return cellText(value).replace(/\s+/g, " ").trim();
}

/** « 1 500 – 2 500 » → 1500 / 2500 ; « 20700 » → 20700. */
export function parsePrice(raw: ExcelJS.CellValue): { priceApprox?: number; priceMax?: number } {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? { priceApprox: raw } : {};
  const numbers = cellText(raw)
    .split(/[–-]/)
    .map((part) => Number(part.replace(/[\s  ]/g, "").replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (numbers.length === 0) return {};
  const [low, high] = [Math.min(...numbers), Math.max(...numbers)];
  return high > low ? { priceApprox: low, priceMax: high } : { priceApprox: low };
}

function capitalize(value: string) {
  return value ? value.charAt(0).toLocaleUpperCase("fr") + value.slice(1) : value;
}

export async function readMedicinesSheet(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) throw new Error(`Feuille « ${SHEET_NAME} » introuvable.`);

  let headerLine = 0;
  let columnIndex = {} as Record<Column, number>;
  for (let line = 1; line <= Math.min(sheet.rowCount, 10) && !headerLine; line += 1) {
    const header = (sheet.getRow(line).values as ExcelJS.CellValue[]).map((value) => clean(value));
    if (header.includes("Produit") && header.includes("Liste")) {
      headerLine = line;
      columnIndex = Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, header.indexOf(name)])) as Record<Column, number>;
    }
  }
  const missing = REQUIRED_COLUMNS.filter((name) => !(columnIndex[name] >= 1));
  if (!headerLine || missing.length > 0) throw new Error(`Colonnes manquantes dans « ${SHEET_NAME} » : ${missing.join(", ") || REQUIRED_COLUMNS.join(", ")}`);

  const medicines: Medicine[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();

  sheet.eachRow((row, line) => {
    if (line <= headerLine) return;
    const get = (name: Column) => row.getCell(columnIndex[name]).value;
    const name = clean(get("Produit"));
    const listLabel = clean(get("Liste"));
    if (!name && !listLabel) return;
    const list = LISTS[slugify(listLabel)];
    if (!name) return void warnings.push(`Ligne ${line} : produit sans nom, ignoré.`);
    if (!list) return void warnings.push(`Ligne ${line} · ${name} : liste inconnue (« ${listLabel} »), ignoré.`);

    const rawCategory = clean(get("Groupe"));
    const category = CATEGORY_FIXES[rawCategory] ?? rawCategory;
    if (category !== rawCategory) warnings.push(`Ligne ${line} · ${name} : catégorie « ${rawCategory} » renommée « ${category} ».`);
    const subcategory = clean(get("Sous-groupe"));
    const form = capitalize(clean(get("Forme")));
    const dosage = clean(get("Dosage"));
    const priceUnit = clean(get("Unité de prix"));
    const { priceApprox, priceMax } = parsePrice(get("Prix approximatif (FCFA)"));
    if (priceApprox === undefined) warnings.push(`Ligne ${line} · ${name} : prix non renseigné.`);

    const number = slugify(clean(get("N°")));
    const baseId = `${list.prefix}-${number ? `${number}-` : ""}${slugify(name)}`.slice(0, 96);
    let id = baseId;
    for (let suffix = 2; ids.has(id); suffix += 1) id = `${baseId}-${suffix}`;
    ids.add(id);

    medicines.push({
      id,
      type: "medicine",
      name,
      productType: list.productType,
      ...(category ? { category } : {}),
      ...(subcategory ? { subcategory } : {}),
      ...(list.ageCategory ? { ageCategory: list.ageCategory } : {}),
      ...(form ? { pharmaceuticalType: form } : {}),
      ...(dosage ? { dosage } : {}),
      ...(priceApprox !== undefined ? { priceApprox } : {}),
      ...(priceMax !== undefined ? { priceMax } : {}),
      ...(priceUnit ? { priceUnit } : {}),
      ...(priceApprox !== undefined ? { priceOfficial: clean(get("Source du prix")).toLocaleLowerCase("fr").startsWith("officiel") } : {}),
    });
  });

  return { medicines, warnings };
}

/** Une ligne par produit : le fichier reste lisible et ses différences courtes dans Git. */
export function serializeCatalog(catalog: MedicinesCatalog) {
  const lines = catalog.medicines.map((medicine) => `    ${JSON.stringify(medicine)}`);
  return `{\n  "version": 1,\n  "source": ${JSON.stringify(catalog.source)},\n  "updatedAt": ${JSON.stringify(catalog.updatedAt)},\n  "medicines": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage : pnpm import:medicines chemin/vers/liste.xlsx");
    process.exit(1);
  }

  const { medicines, warnings } = await readMedicinesSheet(filePath);
  const catalog = validateMedicinesCatalog({
    version: 1,
    source: "Liste nationale des médicaments et autres produits essentiels de santé, Burkina Faso, édition 2023",
    updatedAt: new Date().toISOString(),
    medicines,
  });
  await writeFile(MEDICINES_CATALOG_PATH, serializeCatalog(catalog), "utf8");

  const byType = new Map<string, number>();
  for (const medicine of medicines) byType.set(medicine.productType!, (byType.get(medicine.productType!) ?? 0) + 1);
  console.log(`Importé : ${medicines.length} produits (${[...byType].map(([type, count]) => `${type} ${count}`).join(", ")}) → ${MEDICINES_CATALOG_PATH}`);
  if (warnings.length > 0) console.log(`\nAvertissements (${warnings.length}) :\n${warnings.map((warning) => `  - ${warning}`).join("\n")}`);
}

if (process.argv[1]?.endsWith("import-medicines.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
