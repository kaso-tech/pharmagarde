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

import { readPharmacyWorkbook } from "../server/pharmacy-import";
import { type DirectoryPharmacy, PHARMACY_DIRECTORY_PATH, type PharmacyDirectory, validateDirectory } from "../server/pharmacy-directory";

export async function readPharmacySheet(filePath: string) {
  return readPharmacyWorkbook({ filePath });
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
