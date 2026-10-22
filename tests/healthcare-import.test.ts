import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({ getDb: async () => null, getUserByOpenId: vi.fn(), deleteUserAccount: vi.fn() }));

const { parseHealthcareWorkbook, resolveHealthcareType } = await import("../server/healthcare-import");
const { diffHealthcareImport, healthcareNameCore } = await import("../server/admin-import");
const { isSameHealthcarePlace } = await import("../server/healthcare-match");

type Item = Parameters<typeof diffHealthcareImport>[1][number];

function workbook(rows: unknown[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Lot 1");
  sheet.addRow(["Ville", "Nom", "Type", "Téléphone", "Latitude", "Longitude", "Adresse"]);
  for (const row of rows) sheet.addRow(row);
  return book;
}

function item(overrides: Partial<Item>): Item {
  return { id: "osm-1", kind: "healthcare", status: "active", city: "Ouagadougou", name: "Centre de santé", phone: null, address: null, latitude: 12.37, longitude: -1.52, dutyGroup: null, establishmentType: "Centre de santé", openingHours: null, insurances: [], source: "cache", managed: false, updatedAt: null, ...overrides };
}

describe("import des structures de santé", () => {
  it("reconnaît les types de l'application et ceux des annuaires", () => {
    expect(resolveHealthcareType("Clinique")).toBe("Clinique");
    expect(resolveHealthcareType("(Poly)Clinique")).toBe("Clinique");
    expect(resolveHealthcareType("CSPS (Public)")).toBe("CSPS");
    expect(resolveHealthcareType("CMU / CMA")).toBe("CMA");
    expect(resolveHealthcareType("CHR / CHU", "CHU Yalgado Ouédraogo")).toBe("CHU");
    expect(resolveHealthcareType("CHR / CHU", "Centre Hospitalier Régional")).toBe("CHR");
    expect(resolveHealthcareType("Hôpital (Privé)")).toBe("Hôpital");
    expect(resolveHealthcareType("Centre Médical (Privé)")).toBe("Centre de santé");
    expect(resolveHealthcareType("Cabinet Infirmier")).toBe("Cabinet de soins infirmiers");
    expect(resolveHealthcareType("Cabinet Médical")).toBe("Cabinet médical");
    expect(resolveHealthcareType("Cabinet Dentaire")).toBe("Cabinet dentaire");
    expect(resolveHealthcareType("Ophtalmologue")).toBe("Ophtalmologie");
    expect(resolveHealthcareType("Laboratoire")).toBe("Laboratoire et imagerie");
    expect(resolveHealthcareType("Opticien")).toBe("Opticien");
    expect(resolveHealthcareType("Vétérinaire")).toBeNull();
  });

  it("lit le tableur et rejette les lignes inexploitables", () => {
    const { places, skipped, warnings } = parseHealthcareWorkbook(
      workbook([
        ["Ouagadougou", "Clinique Sainte Odile", "Clinique", "70 11 22 33 / 25 30 40 50", 12.36, -1.51, null],
        ["Koupèla", "CMA de Koupéla", "CMA", null, null, null, null],
        ["Bamako", "Clinique du Fleuve", "Clinique", null, null, null, null],
        ["Ouagadougou", "Clinique Vétérinaire", "Vétérinaire", null, null, null, null],
        ["Ouagadougou", "Clinique Sainte Odile", "Clinique", null, null, null, null],
        ["Ouagadougou", "CSPS Zongo", "CSPS", "12", 40, 2, "Zongo"],
      ]),
    );
    expect(places).toEqual([
      { city: "Ouagadougou", name: "Clinique Sainte Odile", type: "Clinique", phone: "+226 70 11 22 33", address: null, latitude: 12.36, longitude: -1.51 },
      { city: "Koupéla", name: "CMA de Koupéla", type: "CMA", phone: null, address: null, latitude: null, longitude: null },
      { city: "Ouagadougou", name: "CSPS Zongo", type: "CSPS", phone: null, address: "Zongo", latitude: null, longitude: null },
    ]);
    expect(skipped.map((row) => row.reason)).toEqual(["ville non prise en charge par l'app", "type non pris en charge (« Vétérinaire »)", "en double dans le fichier"]);
    expect(warnings.some((warning) => warning.includes("hors du Burkina Faso"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("téléphone invalide"))).toBe(true);
  });

  it("complète les structures connues sans rien écraser et ajoute les autres", () => {
    expect(healthcareNameCore("Clinique Médicale Ste Odile")).toBe("sainte odile");
    // Voisins dont seul « saint » ou le métier est commun : structures différentes.
    expect(isSameHealthcarePlace({ name: "Cabinet de Soins Infirmiers St Antoine", latitude: 12.3, longitude: -1.5 }, { name: "Clinique St Jean", latitude: 12.3001, longitude: -1.5 })).toBe(false);
    expect(isSameHealthcarePlace({ name: "Cabinet de Soins Infirmiers La Paix", latitude: 12.3, longitude: -1.5 }, { name: "Cabinet de Soins Infirmiers Laafi Zaka", latitude: 12.3001, longitude: -1.5 })).toBe(false);
    expect(isSameHealthcarePlace({ name: "Cabinet de Soins Médicaux La Croix Glorieuse", latitude: 12.3, longitude: -1.5 }, { name: "Centre Médical La Croix Glorieuse", latitude: 12.3001, longitude: -1.5 })).toBe(true);
    const current = [
      item({ id: "osm-odile", name: "Clinique Sainte Odile", phone: "+226 25 00 00 00", establishmentType: "Centre de santé" }),
      item({ id: "osm-zongo", name: "Dispensaire Zongo", latitude: 12.3, longitude: -1.6 }),
      item({ id: "osm-yalgado", name: "CHU Yalgado Ouédraogo", phone: "+226 25 31 16 55", establishmentType: "CHU" }),
    ];
    const { adds, updates, unchanged } = diffHealthcareImport(
      [
        { city: "Ouagadougou", name: "Clinique Médicale Ste Odile", type: "Clinique", phone: "+226 70 11 22 33", address: null, latitude: 12.36, longitude: -1.51 },
        { city: "Ouagadougou", name: "CSPS Zongo", type: "CSPS", phone: "+226 70 99 88 77", address: null, latitude: 12.3002, longitude: -1.6001 },
        { city: "Ouagadougou", name: "CHU Yalgado Ouédraogo", type: "CHU", phone: null, address: null, latitude: null, longitude: null },
        { city: "Ouagadougou", name: "Clinique Nouvelle", type: "Clinique", phone: null, address: null, latitude: null, longitude: null },
      ],
      current,
    );
    expect(adds.map((place) => place.name)).toEqual(["Clinique Nouvelle"]);
    expect(unchanged).toBe(1);
    expect(updates.map(({ existing, changes, completed }) => ({ id: existing.id, changes, completed }))).toEqual([
      // Le téléphone existant est gardé ; seul le type générique est précisé.
      { id: "osm-odile", changes: ["type (Clinique)"], completed: { establishmentType: "Clinique" } },
      // Reconnu par la position (moins de 150 m) et un mot commun.
      { id: "osm-zongo", changes: ["téléphone", "type (CSPS)"], completed: { phone: "+226 70 99 88 77", establishmentType: "CSPS" } },
    ]);
  });
});
