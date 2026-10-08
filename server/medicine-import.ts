// Lecture du tableur de la Liste nationale des médicaments et produits essentiels, partagée par
// `pnpm import:medicines` (remplace server/data/medicines.json) et l'import de la console
// (modifications enregistrées en base, voir server/admin-import.ts).
//
// Colonnes lues dans la feuille « Tous les produits avec prix » (ligne d'en-tête détectée) :
//   Produit · Forme · Dosage · Prix approximatif (FCFA) · Unité de prix · Source du prix · Liste ·
//   N° · Groupe · Sous-groupe

import ExcelJS from "exceljs";

import type { Medicine, MedicineProductType } from "../lib/pharmagarde/types";
import { slugify } from "./pharmacy-directory";

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

/** Lit le classeur de la Liste nationale (feuille « Tous les produits avec prix »). */
export function parseMedicinesWorkbook(workbook: ExcelJS.Workbook) {
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

export async function readMedicinesWorkbook(source: { filePath: string } | { buffer: Buffer | ArrayBuffer }) {
  const workbook = new ExcelJS.Workbook();
  if ("filePath" in source) await workbook.xlsx.readFile(source.filePath);
  else await workbook.xlsx.load(source.buffer as ArrayBuffer);
  return parseMedicinesWorkbook(workbook);
}
