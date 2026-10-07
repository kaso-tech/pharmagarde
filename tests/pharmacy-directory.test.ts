import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { mergeIntoDirectory, readPharmacySheet } from "../scripts/import-pharmacies";
import { displayPharmacyName, normalizeBurkinaPhone, parseDutyGroup, validateDirectory } from "../server/pharmacy-directory";

const HEADER = ["N°", "Ville", "Pharmacie", "Téléphone", "Groupe", "Situation géographique", "Latitude", "Longitude", "Précision géo", "Repère géocodé", "Source", "Distance centre-ville (km)"];

async function writeWorkbook(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pharmacies");
  sheet.addRow(HEADER);
  for (const row of rows) sheet.addRow(row);
  const filePath = path.join(await mkdtemp(path.join(tmpdir(), "pharmacies-xlsx-")), "pharmacies.xlsx");
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

describe("normalisation de l'annuaire", () => {
  it("formate noms, téléphones et groupes de garde", () => {
    expect(displayPharmacyName("Archanges")).toBe("Pharmacie Archanges");
    expect(displayPharmacyName("Pharmacie de l'Avenir")).toBe("Pharmacie de l'Avenir");
    expect(normalizeBurkinaPhone("79 20 01 83")).toBe("+226 79 20 01 83");
    expect(normalizeBurkinaPhone("70 17 2823")).toBe("+226 70 17 28 23");
    expect(normalizeBurkinaPhone("+226 25 30 00 00")).toBe("+226 25 30 00 00");
    expect(normalizeBurkinaPhone("123")).toBeNull();
    expect(parseDutyGroup("3")).toBe(3);
    expect(parseDutyGroup("—")).toBeNull();
    expect(parseDutyGroup("5")).toBeNull();
  });
});

describe("import du tableur (pnpm import:pharmacies)", () => {
  it("garde les colonnes utiles, ignore les lignes sans coordonnées et signale les groupes manquants", async () => {
    const file = await writeWorkbook([
      [1, "Ouagadougou", "Archanges", "79 20 01 83", "1", "Pissy, face à la station OTAM", 12.3316319, -1.584736, "Point (fiche)", "Pharmacie ARCHANGES", "Google Maps", null],
      [2, "Bobo Dioulasso", "Diyama", "70 17 2823", "—", "Section 25", 11.159913, -4.24092, "Point (fiche)", "x", "y", null],
      [3, "Bobo Dioulasso", "Colombe", "70 00 00 00", "2", "Quelque part", null, null, "Non trouvé", null, null, null],
      [4, "Ouagadougou", "Hors pays", "70 00 00 01", "2", null, 48.85, 2.35, "Point (fiche)", null, null, null],
      [5, "Ville inconnue", "Nulle part", "70 00 00 02", "1", null, 12.3, -1.5, "Point (fiche)", null, null, null],
    ]);

    const { pharmacies, skipped, warnings } = await readPharmacySheet(file);

    expect(pharmacies).toEqual([
      { id: "ph-ouagadougou-archanges", city: "Ouagadougou", name: "Pharmacie Archanges", phone: "+226 79 20 01 83", dutyGroup: 1, address: "Pissy, face à la station OTAM", latitude: 12.3316319, longitude: -1.584736 },
      { id: "ph-bobo-dioulasso-diyama", city: "Bobo-Dioulasso", name: "Pharmacie Diyama", phone: "+226 70 17 28 23", dutyGroup: null, address: "Section 25", latitude: 11.159913, longitude: -4.24092 },
    ]);
    // Les colonnes Précision géo, Repère géocodé, Source et Distance ne sont pas reprises.
    expect(Object.keys(pharmacies[0] ?? {})).not.toEqual(expect.arrayContaining(["source", "precision"]));
    expect(skipped.map((item) => [item.name, item.reason.split(" (")[0]])).toEqual([
      ["Colombe", "sans coordonnées"],
      ["Hors pays", "coordonnées hors du Burkina Faso"],
      ["Nulle part", "ville non prise en charge par l'app"],
    ]);
    expect(warnings).toEqual([expect.stringContaining("Diyama")]);
  });

  it("remplace les villes importées et conserve les autres, avec des identifiants stables", () => {
    const existing = validateDirectory({
      version: 1,
      updatedAt: "2026-10-01T00:00:00.000Z",
      pharmacies: [
        { id: "ph-ouagadougou-ancienne", city: "Ouagadougou", name: "Pharmacie Ancienne", phone: "+226 70 00 00 00", dutyGroup: 1, latitude: 12.3, longitude: -1.5 },
        { id: "ph-koudougou-sainte-anne", city: "Koudougou", name: "Pharmacie Sainte Anne", phone: "+226 70 00 00 01", dutyGroup: 2, latitude: 12.25, longitude: -2.36 },
      ],
    });
    const merged = mergeIntoDirectory(existing, [
      { id: "ph-ouagadougou-archanges", city: "Ouagadougou", name: "Pharmacie Archanges", phone: "+226 79 20 01 83", dutyGroup: 1, latitude: 12.33, longitude: -1.58 },
    ]);
    expect(merged.pharmacies.map((pharmacy) => pharmacy.id)).toEqual(["ph-koudougou-sainte-anne", "ph-ouagadougou-archanges"]);
  });
});

describe("annuaire versionné dans le dépôt", () => {
  const directory = validateDirectory(JSON.parse(readFileSync("server/data/pharmacies.json", "utf8")));

  it("contient les villes importées, uniquement avec coordonnées et sans colonnes inutiles", () => {
    const byCity = new Map<string, number>();
    for (const pharmacy of directory.pharmacies) byCity.set(pharmacy.city, (byCity.get(pharmacy.city) ?? 0) + 1);
    expect(Object.fromEntries(byCity)).toEqual({
      Banfora: 5,
      "Bobo-Dioulasso": 70,
      Dori: 2,
      Dédougou: 4,
      "Fada N'gourma": 4,
      Gaoua: 3,
      Kaya: 5,
      Koudougou: 7,
      Ouagadougou: 239,
      Ouahigouya: 5,
      Tenkodogo: 5,
      Ziniaré: 2,
    });
    for (const pharmacy of directory.pharmacies) {
      expect(Number.isFinite(pharmacy.latitude) && Number.isFinite(pharmacy.longitude)).toBe(true);
      expect(Object.keys(pharmacy).every((key) => ["id", "city", "name", "phone", "dutyGroup", "address", "latitude", "longitude"].includes(key))).toBe(true);
    }
  });

  it("renseigne le groupe de garde à Ouagadougou et Bobo-Dioulasso, sauf Diyama (groupe absent du fichier)", () => {
    const groupCities = new Set(["Ouagadougou", "Bobo-Dioulasso"]);
    const withoutGroup = directory.pharmacies.filter((pharmacy) => groupCities.has(pharmacy.city) && pharmacy.dutyGroup === null).map((pharmacy) => pharmacy.name);
    expect(withoutGroup).toEqual(["Pharmacie Diyama"]);
  });

  it("n'attribue pas de groupe dans les villes dont la garde se fait par listes", () => {
    // Les groupes proposés pour ces villes ne correspondaient pas aux listes de l'ONPBF : ils ne sont pas importés.
    const groupCities = new Set(["Ouagadougou", "Bobo-Dioulasso"]);
    expect(directory.pharmacies.filter((pharmacy) => !groupCities.has(pharmacy.city) && pharmacy.dutyGroup !== null)).toEqual([]);
  });
});

describe("limite gratuite : les 3 pharmacies les plus proches", () => {
  it("trie par distance depuis la position de l'utilisateur avant de limiter", async () => {
    const { sortByDistanceFrom } = await import("../server/pharmagarde-cache");
    const place = (id: string, latitude: number, longitude: number) => ({ id, type: "Pharmacie" as const, category: "pharmacy" as const, name: id, latitude, longitude });
    const items = [place("loin", 12.46, -1.40), place("proche", 12.3716, -1.5199), place("moyen", 12.39, -1.52), place("sans-coord", NaN, NaN)];
    items[3] = { ...items[3], latitude: undefined as unknown as number, longitude: undefined as unknown as number };

    expect(sortByDistanceFrom(items, { latitude: 12.3714, longitude: -1.5197 }).map((item) => item.id)).toEqual(["proche", "moyen", "loin", "sans-coord"]);
    expect(sortByDistanceFrom(items, null).map((item) => item.id)).toEqual(["loin", "proche", "moyen", "sans-coord"]);
  });
});
