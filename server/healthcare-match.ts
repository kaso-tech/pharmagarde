import { distanceKm } from "../lib/pharmagarde/city-utils";
import { slugify } from "./pharmacy-directory";

// Reconnaissance d'une même structure de santé entre deux sources (OpenStreetMap, annuaire
// versionné, fiches de la console, tableur importé), dont les noms s'écrivent rarement pareil.

/** Mots trop courants pour distinguer deux structures de santé (« Clinique », « Centre médical »…). */
const GENERIC_WORDS = new Set(["clinique", "polyclinique", "centre", "medical", "medicale", "medico", "chirurgical", "chirurgicale", "sante", "soins", "csps", "cma", "cmu", "chu", "chr", "hopital", "urbain", "prive", "publique", "public", "de", "du", "des", "la", "le", "les", "l", "d", "et"]);

/** Mots distinctifs d'un nom : « Clinique Médicale Sainte Odile » → « sainte odile ». */
export function healthcareNameCore(name: string) {
  return slugify(name)
    .replace(/\bst\b/g, "saint")
    .replace(/\bste\b/g, "sainte")
    .split("-")
    .filter((word) => word && !GENERIC_WORDS.has(word))
    .join(" ");
}

/**
 * Mots gardés dans le nom (« Cabinet Dentaire Shalom » n'est pas « CSPS Shalom ») mais qui ne
 * suffisent pas à rapprocher deux structures voisines : « St Antoine » n'est pas « St Jean ».
 */
const WEAK_WORDS = new Set(["saint", "sainte", "cabinet", "infirmier", "infirmiers", "infirmiere", "obstetricaux", "medicaux", "dentaire", "pediatrique", "ophtalmologie", "ophtalmologique", "optique", "optic", "opticien", "lunetterie", "laboratoire", "analyses", "biologie", "biomedicales", "medicales", "imagerie"]);

export function wordOverlap(left: string, right: string) {
  const a = new Set(left.split(" ").filter((word) => word && !WEAK_WORDS.has(word)));
  const b = new Set(right.split(" ").filter((word) => word && !WEAK_WORDS.has(word)));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / Math.min(a.size, b.size);
}

type Located = { name: string; latitude?: number | null; longitude?: number | null };

/** Même structure : mots distinctifs identiques, ou moins de 150 m avec un nom proche (même ville supposée). */
export function isSameHealthcarePlace(left: Located, right: Located) {
  const leftCore = healthcareNameCore(left.name);
  const rightCore = healthcareNameCore(right.name);
  if (leftCore && leftCore === rightCore) return true;
  if (left.latitude == null || left.longitude == null || right.latitude == null || right.longitude == null) return false;
  return distanceKm({ latitude: left.latitude, longitude: left.longitude }, { latitude: right.latitude, longitude: right.longitude }) < 0.15 && wordOverlap(leftCore, rightCore) >= 0.5;
}
