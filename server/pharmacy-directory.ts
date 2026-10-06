import { readFile } from "node:fs/promises";
import path from "node:path";

// Annuaire des pharmacies géré par PharmaGarde : un fichier JSON versionné dans le dépôt
// (server/data/pharmacies.json), généré à partir du tableur par `pnpm import:pharmacies`.
// Aucune donnée de pharmacie ne vient plus de Google ni d'une API tierce au fonctionnement.

export const PHARMACY_DIRECTORY_PATH = process.env.PHARMAGARDE_PHARMACY_DIRECTORY ?? path.join(process.cwd(), "server", "data", "pharmacies.json");

/** Groupes de garde utilisés par l'Ordre des pharmaciens pour la rotation des gardes. */
export const DUTY_GROUPS = [1, 2, 3, 4] as const;
export type DutyGroup = (typeof DUTY_GROUPS)[number];

export type DirectoryPharmacy = {
  /** Identifiant stable entre deux imports (favoris des utilisateurs) : ville + nom. */
  id: string;
  city: string;
  name: string;
  phone: string;
  /** Groupe de garde (1 à 4), null s'il n'est pas renseigné dans l'annuaire. */
  dutyGroup: DutyGroup | null;
  address?: string;
  latitude: number;
  longitude: number;
};

export type PharmacyDirectory = {
  version: 1;
  updatedAt: string;
  pharmacies: DirectoryPharmacy[];
};

// --- Normalisation (partagée avec le script d'import) ------------------------------------------

const BURKINA_BOUNDS = { minLat: 9.3, maxLat: 15.2, minLon: -5.6, maxLon: 2.5 };

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function slugify(value: string) {
  return stripAccents(value).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** « Archanges » → « Pharmacie Archanges » ; un nom qui commence déjà par « Pharmacie » est gardé. */
export function displayPharmacyName(rawName: string) {
  const name = rawName.trim().replace(/\s+/g, " ");
  return /^pharmacie\b/i.test(stripAccents(name)) ? name : `Pharmacie ${name}`;
}

/** « 79 20 01 83 » → « +226 79 20 01 83 ». Renvoie null si ce n'est pas un numéro burkinabè. */
export function normalizeBurkinaPhone(raw: unknown) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("226") ? digits.slice(3) : digits;
  if (local.length !== 8) return null;
  return `+226 ${local.replace(/(\d{2})(?=\d)/g, "$1 ")}`;
}

export function parseDutyGroup(raw: unknown): DutyGroup | null {
  const value = Number(String(raw ?? "").trim());
  return (DUTY_GROUPS as readonly number[]).includes(value) ? (value as DutyGroup) : null;
}

export function parseCoordinate(raw: unknown) {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function isInBurkinaFaso(latitude: number, longitude: number) {
  return latitude >= BURKINA_BOUNDS.minLat && latitude <= BURKINA_BOUNDS.maxLat && longitude >= BURKINA_BOUNDS.minLon && longitude <= BURKINA_BOUNDS.maxLon;
}

// --- Lecture ------------------------------------------------------------------------------------

export function validateDirectory(value: unknown): PharmacyDirectory {
  const directory = value as Partial<PharmacyDirectory>;
  if (!directory || directory.version !== 1 || !Array.isArray(directory.pharmacies)) {
    throw new Error("Annuaire des pharmacies invalide (version ou liste manquante).");
  }
  const ids = new Set<string>();
  for (const pharmacy of directory.pharmacies) {
    if (!pharmacy.id || !pharmacy.name || !pharmacy.city) throw new Error(`Pharmacie invalide : ${JSON.stringify(pharmacy)}`);
    if (ids.has(pharmacy.id)) throw new Error(`Identifiant de pharmacie en double : ${pharmacy.id}`);
    ids.add(pharmacy.id);
    if (!isInBurkinaFaso(pharmacy.latitude, pharmacy.longitude)) throw new Error(`Coordonnées hors du Burkina Faso : ${pharmacy.id}`);
  }
  return directory as PharmacyDirectory;
}

export async function loadPharmacyDirectory(filePath = PHARMACY_DIRECTORY_PATH): Promise<PharmacyDirectory> {
  return validateDirectory(JSON.parse(await readFile(filePath, "utf8")));
}
