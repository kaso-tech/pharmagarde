import { readFile } from "node:fs/promises";
import path from "node:path";

import type { HealthcareType } from "./healthcare-import";
import { HEALTHCARE_IMPORT_TYPES } from "./healthcare-import";
import { isInBurkinaFaso } from "./pharmacy-directory";

// Annuaire des structures de santé géré par PharmaGarde (server/data/healthcare.json), publié en
// plus des structures OpenStreetMap : une structure présente dans les deux sources n'est affichée
// qu'une fois, avec les informations de l'annuaire.

export const HEALTHCARE_DIRECTORY_PATH = process.env.PHARMAGARDE_HEALTHCARE_DIRECTORY ?? path.join(process.cwd(), "server", "data", "healthcare.json");

export type DirectoryHealthcarePlace = {
  id: string;
  city: string;
  name: string;
  type: HealthcareType;
  phone?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
};

export type HealthcareDirectory = {
  version: 1;
  updatedAt: string;
  source: string;
  places: DirectoryHealthcarePlace[];
};

export function validateHealthcareDirectory(value: unknown): HealthcareDirectory {
  const directory = value as Partial<HealthcareDirectory>;
  if (!directory || directory.version !== 1 || !Array.isArray(directory.places)) throw new Error("Annuaire des structures de santé invalide (version ou liste manquante).");
  const ids = new Set<string>();
  for (const place of directory.places) {
    if (!place.id || !place.name || !place.city) throw new Error(`Structure de santé invalide : ${JSON.stringify(place)}`);
    if (ids.has(place.id)) throw new Error(`Identifiant de structure en double : ${place.id}`);
    ids.add(place.id);
    if (!HEALTHCARE_IMPORT_TYPES.includes(place.type)) throw new Error(`Type inconnu (${String(place.type)}) : ${place.id}`);
    const hasLatitude = place.latitude !== undefined;
    if (hasLatitude !== (place.longitude !== undefined)) throw new Error(`Coordonnées incomplètes : ${place.id}`);
    if (hasLatitude && !isInBurkinaFaso(place.latitude!, place.longitude!)) throw new Error(`Coordonnées hors du Burkina Faso : ${place.id}`);
  }
  return { version: 1, updatedAt: String(directory.updatedAt ?? ""), source: String(directory.source ?? ""), places: directory.places };
}

/** Annuaire vide si le fichier est absent (installation sans données). */
export async function loadHealthcareDirectory(filePath = HEALTHCARE_DIRECTORY_PATH): Promise<HealthcareDirectory> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { version: 1, updatedAt: "", source: "", places: [] };
  }
  return validateHealthcareDirectory(JSON.parse(raw));
}
