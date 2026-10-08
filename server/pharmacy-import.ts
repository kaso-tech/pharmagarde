// Lecture du tableur de l'annuaire des pharmacies, partagée par la commande `pnpm import:pharmacies`
// et par l'import depuis la console d'administration.
//
// Colonnes lues dans la feuille « Pharmacies » (les autres sont ignorées) :
//   Ville · Pharmacie · Téléphone · Groupe · Situation géographique · Latitude · Longitude

import ExcelJS from "exceljs";

import { SUPPORTED_CITIES } from "./pharmagarde-cache";
import { type DirectoryPharmacy, displayPharmacyName, isInBurkinaFaso, normalizeBurkinaPhone, parseCoordinate, parseDutyGroup, slugify } from "./pharmacy-directory";

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

/** Lit la feuille « Pharmacies » (ou la première) d'un classeur déjà chargé. */
export function parsePharmacyWorkbook(workbook: ExcelJS.Workbook) {
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

export async function readPharmacyWorkbook(input: { filePath: string } | { buffer: Buffer | ArrayBuffer }) {
  const workbook = new ExcelJS.Workbook();
  if ("filePath" in input) await workbook.xlsx.readFile(input.filePath);
  else await workbook.xlsx.load(input.buffer as ArrayBuffer);
  return parsePharmacyWorkbook(workbook);
}
