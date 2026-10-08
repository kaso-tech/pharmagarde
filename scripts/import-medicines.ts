// Importe le catalogue des médicaments et produits essentiels depuis le tableur Excel vers
// server/data/medicines.json. Le catalogue précédent est entièrement remplacé.
//
//   pnpm import:medicines chemin/vers/liste.xlsx
//
// Colonnes lues : voir server/medicine-import.ts.

import { writeFile } from "node:fs/promises";

import { readMedicinesWorkbook } from "../server/medicine-import";
import { MEDICINES_CATALOG_PATH, type MedicinesCatalog, validateMedicinesCatalog } from "../server/medicines-data";

export { parsePrice } from "../server/medicine-import";

export function readMedicinesSheet(filePath: string) {
  return readMedicinesWorkbook({ filePath });
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
