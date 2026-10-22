// Lecture d'un tableur de structures de santé (cliniques, CSPS, CMA, hôpitaux, cabinets, opticiens…) pour l'import
// depuis la console d'administration.
//
// Colonnes lues dans la première feuille (ligne d'en-tête détectée parmi les 5 premières) :
//   Ville · Nom · Type   (obligatoires)
//   Téléphone · Latitude · Longitude · Adresse   (facultatives)

import ExcelJS from "exceljs";

import { SUPPORTED_CITIES } from "./cities";
import { HEALTHCARE_TYPES, type HealthcareType } from "../lib/pharmagarde/healthcare-types";
import { isInBurkinaFaso, normalizeBurkinaPhone, parseCoordinate, slugify } from "./pharmacy-directory";

export type { HealthcareType };

export const HEALTHCARE_IMPORT_TYPES: readonly HealthcareType[] = HEALTHCARE_TYPES;

export type ImportedHealthcarePlace = {
  city: string;
  name: string;
  type: HealthcareType;
  phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

type Skipped = { line: number; city: string; name: string; reason: string };

const REQUIRED = ["Ville", "Nom", "Type"] as const;
const OPTIONAL = ["Téléphone", "Latitude", "Longitude", "Adresse"] as const;
type Column = (typeof REQUIRED)[number] | (typeof OPTIONAL)[number];

/**
 * Type de l'application à partir du libellé du tableur : types de l'application tels quels, et
 * libellés courants des annuaires (« (Poly)Clinique », « CSPS (Public) », « CMU / CMA »…).
 */
export function resolveHealthcareType(raw: string, name = ""): HealthcareType | null {
  const key = slugify(raw);
  const direct = HEALTHCARE_IMPORT_TYPES.find((type) => slugify(type) === key);
  if (direct) return direct;
  if (key.includes("chu") || key.includes("chr")) return /\bchu\b/i.test(name) || key === "chu" ? "CHU" : "CHR";
  if (key.includes("dentaire")) return "Cabinet dentaire";
  if (key.includes("ophtalmo")) return "Ophtalmologie";
  if (key.includes("laboratoire") || key.includes("imagerie") || key.includes("radiologie")) return "Laboratoire et imagerie";
  if (key.includes("opticien") || key.includes("optique")) return "Opticien";
  if (key.includes("infirmier")) return "Cabinet de soins infirmiers";
  if (key.includes("clinique")) return "Clinique";
  if (key.includes("csps")) return "CSPS";
  if (key.includes("cma") || key.includes("cmu")) return "CMA";
  if (key.includes("hopital")) return "Hôpital";
  if (key.includes("cabinet")) return "Cabinet médical";
  if (key.includes("centre-medical") || key.includes("centre-de-sante")) return "Centre de santé";
  return null;
}

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

function resolveCity(raw: string) {
  const key = slugify(raw);
  return SUPPORTED_CITIES.find((city) => slugify(city.name) === key)?.name;
}

/** Premier numéro burkinabè valide d'une cellule (« 70 11 22 33 / 25 30 40 50 »). */
function firstPhone(raw: string) {
  for (const part of raw.split(/[\/;,]| ou /)) {
    const phone = normalizeBurkinaPhone(part);
    if (phone) return phone;
  }
  return null;
}

export function parseHealthcareWorkbook(workbook: ExcelJS.Workbook) {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Aucune feuille dans le fichier.");

  let headerLine = 0;
  let columnIndex: Partial<Record<Column, number>> = {};
  for (let line = 1; line <= Math.min(5, sheet.rowCount) && !headerLine; line += 1) {
    const header = (sheet.getRow(line).values as ExcelJS.CellValue[]).map((value) => cellText(value).trim());
    if (REQUIRED.every((name) => header.indexOf(name) >= 1)) {
      headerLine = line;
      columnIndex = Object.fromEntries([...REQUIRED, ...OPTIONAL].map((name) => [name, header.indexOf(name)]).filter(([, index]) => (index as number) >= 1));
    }
  }
  if (!headerLine) throw new Error(`Colonnes manquantes dans « ${sheet.name} » : ${REQUIRED.join(", ")} sont obligatoires.`);

  const places: ImportedHealthcarePlace[] = [];
  const skipped: Skipped[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  sheet.eachRow((row, line) => {
    if (line <= headerLine) return;
    const get = (name: Column) => (columnIndex[name] ? row.getCell(columnIndex[name]!).value : null);
    const rawCity = cellText(get("Ville")).trim();
    const name = cellText(get("Nom")).trim().replace(/\s+/g, " ");
    if (!rawCity && !name) return;

    const city = resolveCity(rawCity);
    if (!city) return void skipped.push({ line, city: rawCity, name, reason: "ville non prise en charge par l'app" });
    if (name.length < 2) return void skipped.push({ line, city, name, reason: "nom manquant" });
    const rawType = cellText(get("Type")).trim();
    const type = resolveHealthcareType(rawType, name);
    if (!type) return void skipped.push({ line, city, name, reason: `type non pris en charge (« ${rawType} »)` });

    const key = `${slugify(city)}|${slugify(name)}`;
    if (seen.has(key)) return void skipped.push({ line, city, name, reason: "en double dans le fichier" });
    seen.add(key);

    let latitude = parseCoordinate(cellValue(get("Latitude")));
    let longitude = parseCoordinate(cellValue(get("Longitude")));
    if ((latitude === null) !== (longitude === null)) {
      warnings.push(`Ligne ${line} · ${name} (${city}) : coordonnées incomplètes, ignorées.`);
      latitude = longitude = null;
    } else if (latitude !== null && longitude !== null && !isInBurkinaFaso(latitude, longitude)) {
      warnings.push(`Ligne ${line} · ${name} (${city}) : coordonnées hors du Burkina Faso, ignorées.`);
      latitude = longitude = null;
    }
    if (latitude === null) warnings.push(`Ligne ${line} · ${name} (${city}) : sans coordonnées (pas de distance ni de carte).`);

    const rawPhone = cellText(get("Téléphone")).trim();
    const phone = rawPhone ? firstPhone(rawPhone) : null;
    if (rawPhone && !phone) warnings.push(`Ligne ${line} · ${name} (${city}) : téléphone invalide (« ${rawPhone} »), ignoré.`);
    const address = cellText(get("Adresse")).trim().replace(/\s+/g, " ") || null;

    places.push({
      city,
      name,
      type,
      phone,
      address,
      latitude: latitude === null ? null : Number(latitude.toFixed(7)),
      longitude: longitude === null ? null : Number(longitude.toFixed(7)),
    });
  });

  return { places, skipped, warnings };
}

export async function readHealthcareWorkbook(input: { buffer: Buffer | ArrayBuffer } | { filePath: string }) {
  const workbook = new ExcelJS.Workbook();
  if ("filePath" in input) await workbook.xlsx.readFile(input.filePath);
  else await workbook.xlsx.load(input.buffer as ArrayBuffer);
  return parseHealthcareWorkbook(workbook);
}
