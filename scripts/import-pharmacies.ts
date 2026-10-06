// Importe l'annuaire des pharmacies depuis le tableur Excel vers server/data/pharmacies.json.
//
//   pnpm import:pharmacies chemin/vers/pharmacies.xlsx
//
// Colonnes lues dans la feuille « Pharmacies » (les autres sont ignorées) :
//   Ville · Pharmacie · Téléphone · Groupe · Situation géographique · Latitude · Longitude
//
// Les villes présentes dans le fichier remplacent entièrement leurs pharmacies dans l'annuaire ;
// les autres villes déjà importées sont conservées. On peut donc ajouter une ville à la fois.
// Les lignes sans coordonnées sont ignorées et listées dans le rapport.

import { readFile, writeFile } from "node:fs/promises";

import ExcelJS from "exceljs";

import { SUPPORTED_CITIES } from "../server/pharmagarde-cache";
import {
  type DirectoryPharmacy,
  displayPharmacyName,
  isInBurkinaFaso,
  normalizeBurkinaPhone,
  parseCoordinate,
  parseDutyGroup,
  PHARMACY_DIRECTORY_PATH,
  type PharmacyDirectory,
  slugify,
  validateDirectory,
} from "../server/pharmacy-directory";

const REQUIRED_COLUMNS = ["Ville", "Pharmacie", "Téléphone", "Groupe", "Situation géographique", "Latitude", "Longitude"] as const;

type Skipped = { line: number; city: string; name: string; reason: string };

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
  }
  return String(value);
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value;
}

/** Associe le nom de ville du tableur à une ville prise en charge par l'app (« Bobo Dioulasso » → « Bobo-Dioulasso »). */
function resolveCity(raw: string) {
  const key = slugify(raw);
  return SUPPORTED_CITIES.find((city) => slugify(city.name) === key)?.name;
}

export async function readPharmacySheet(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("Pharmacies") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("Aucune feuille dans le fichier.");

  const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).map((value) => cellText(value).trim());
  const columnIndex = Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, header.indexOf(name)])) as Record<(typeof REQUIRED_COLUMNS)[number], number>;
  const missing = REQUIRED_COLUMNS.filter((name) => columnIndex[name] < 1);
  if (missing.length > 0) throw new Error(`Colonnes manquantes dans « ${sheet.name} » : ${missing.join(", ")}`);

  const pharmacies: DirectoryPharmacy[] = [];
  const skipped: Skipped[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();

  sheet.eachRow((row, line) => {
    if (line === 1) return;
    const get = (name: (typeof REQUIRED_COLUMNS)[number]) => row.getCell(columnIndex[name]).value;
    const rawCity = cellText(get("Ville")).trim();
    const rawName = cellText(get("Pharmacie")).trim();
    if (!rawCity && !rawName) return;

    const city = resolveCity(rawCity);
    if (!city) return void skipped.push({ line, city: rawCity, name: rawName, reason: "ville non prise en charge par l'app" });
    if (!rawName) return void skipped.push({ line, city, name: "", reason: "nom manquant" });

    const latitude = parseCoordinate(cellValue(get("Latitude")));
    const longitude = parseCoordinate(cellValue(get("Longitude")));
    if (latitude === null || longitude === null) return void skipped.push({ line, city, name: rawName, reason: "sans coordonnées" });
    if (!isInBurkinaFaso(latitude, longitude)) return void skipped.push({ line, city, name: rawName, reason: `coordonnées hors du Burkina Faso (${latitude}, ${longitude})` });

    const phone = normalizeBurkinaPhone(cellText(get("Téléphone")));
    if (!phone) return void skipped.push({ line, city, name: rawName, reason: `téléphone invalide (${cellText(get("Téléphone"))})` });

    const dutyGroup = parseDutyGroup(cellText(get("Groupe")));
    if (dutyGroup === null) warnings.push(`Ligne ${line} · ${rawName} (${city}) : groupe de garde non renseigné (« ${cellText(get("Groupe"))} »).`);

    const baseId = `ph-${slugify(city)}-${slugify(rawName)}`;
    let id = baseId;
    for (let suffix = 2; ids.has(id); suffix += 1) id = `${baseId}-${suffix}`;
    if (id !== baseId) warnings.push(`Ligne ${line} · ${rawName} (${city}) : nom en double, identifiant ${id}.`);
    ids.add(id);

    const address = cellText(get("Situation géographique")).trim().replace(/\s+/g, " ");
    pharmacies.push({
      id,
      city,
      name: displayPharmacyName(rawName),
      phone,
      dutyGroup,
      ...(address ? { address } : {}),
      latitude: Number(latitude.toFixed(7)),
      longitude: Number(longitude.toFixed(7)),
    });
  });

  return { pharmacies, skipped, warnings };
}

/** Remplace les villes importées et conserve les autres. */
export function mergeIntoDirectory(existing: PharmacyDirectory | null, imported: DirectoryPharmacy[], now = new Date()): PharmacyDirectory {
  const importedCities = new Set(imported.map((pharmacy) => pharmacy.city));
  const kept = (existing?.pharmacies ?? []).filter((pharmacy) => !importedCities.has(pharmacy.city));
  const pharmacies = [...kept, ...imported].sort((a, b) => a.city.localeCompare(b.city, "fr") || a.name.localeCompare(b.name, "fr"));
  return validateDirectory({ version: 1, updatedAt: now.toISOString(), pharmacies });
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage : pnpm import:pharmacies chemin/vers/pharmacies.xlsx");
    process.exit(1);
  }

  const { pharmacies, skipped, warnings } = await readPharmacySheet(filePath);
  const existing = await readFile(PHARMACY_DIRECTORY_PATH, "utf8").then((raw) => validateDirectory(JSON.parse(raw))).catch(() => null);
  const directory = mergeIntoDirectory(existing, pharmacies);
  await writeFile(PHARMACY_DIRECTORY_PATH, `${JSON.stringify(directory, null, 2)}\n`, "utf8");

  const byCity = new Map<string, number>();
  for (const pharmacy of pharmacies) byCity.set(pharmacy.city, (byCity.get(pharmacy.city) ?? 0) + 1);
  console.log(`Importé : ${pharmacies.length} pharmacies (${[...byCity].map(([city, count]) => `${city} ${count}`).join(", ")}).`);
  console.log(`Annuaire : ${directory.pharmacies.length} pharmacies au total → ${PHARMACY_DIRECTORY_PATH}`);
  if (skipped.length > 0) {
    console.log(`\nIgnorées (${skipped.length}) :`);
    for (const item of skipped) console.log(`  - ligne ${item.line} · ${item.name || "?"} (${item.city}) : ${item.reason}`);
  }
  if (warnings.length > 0) {
    console.log(`\nAvertissements (${warnings.length}) :`);
    for (const warning of warnings) console.log(`  - ${warning}`);
  }
}

if (process.argv[1]?.endsWith("import-pharmacies.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
