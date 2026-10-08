/**
 * Assurances santé que les établissements peuvent accepter (tiers payant). La liste de référence
 * ci-dessous est complétée, renommée ou désactivée depuis la console : le serveur publie la liste
 * en vigueur (`/app-config`) et chaque environnement (serveur, console, application) la charge avec
 * `setInsurers`. Les établissements enregistrent les identifiants, l'affichage utilise les libellés.
 */
export const INSURERS = [
  { id: "ascoma", label: "Ascoma" },
  { id: "coris", label: "Coris" },
  { id: "faari-plus", label: "Faari+" },
  { id: "ga", label: "GA" },
  { id: "gras-savoye", label: "Gras Savoye" },
  { id: "maado", label: "Maado" },
  { id: "mci", label: "MCI" },
  { id: "msh", label: "MSH" },
  { id: "mutraf", label: "Mutraf" },
  { id: "olea", label: "Olea" },
  { id: "onea", label: "Onea" },
  { id: "raynal", label: "Raynal" },
  { id: "saham", label: "Saham" },
  { id: "sonar", label: "Sonar" },
  { id: "sunu", label: "Sunu" },
  { id: "uab", label: "UAB" },
  { id: "yelen", label: "Yelen" },
] as const;

export type InsurerId = string;

export type Insurer = { id: InsurerId; label: string; active: boolean };

/** Identifiant d'assureur : minuscules, chiffres et tirets (ex. « gras-savoye »). */
export const INSURER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

const DEFAULT_REGISTRY: Insurer[] = INSURERS.map((insurer) => ({ ...insurer, active: true }));
let registry: Insurer[] = DEFAULT_REGISTRY;

/** Remplace la liste en vigueur (ordre conservé). Sans argument, revient à la liste de référence. */
export function setInsurers(list?: readonly Insurer[] | null) {
  registry = list?.length ? list.map((insurer) => ({ id: insurer.id, label: insurer.label, active: insurer.active !== false })) : DEFAULT_REGISTRY;
}

/** Assureurs en vigueur ; les désactivés ne sont renvoyés qu'avec `includeInactive`. */
export function getInsurers(options: { includeInactive?: boolean } = {}): Insurer[] {
  return options.includeInactive ? registry : registry.filter((insurer) => insurer.active);
}

/** Identifiant d'un assureur connu, actif ou désactivé. */
export function isInsurerId(value: unknown): value is InsurerId {
  return typeof value === "string" && registry.some((insurer) => insurer.id === value);
}

export function insurerLabel(id: string) {
  return registry.find((insurer) => insurer.id === id)?.label ?? id;
}

/** « Gras Savoye » → « gras-savoye » */
export function insurerIdFromLabel(label: string) {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/**
 * Identifiants valides, sans doublon, dans l'ordre de la liste en vigueur (JSON ou tableau). Les
 * assureurs désactivés sont retirés, sauf avec `includeInactive` (enregistrement, console).
 */
export function normalizeInsurerIds(value: unknown, options: { includeInactive?: boolean } = {}): InsurerId[] {
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const selected = new Set(raw.filter((item): item is string => typeof item === "string"));
  return getInsurers(options)
    .map((insurer) => insurer.id)
    .filter((id) => selected.has(id));
}

/** « Sunu, UAB, Yelen » */
export function formatInsurers(ids: readonly string[]) {
  return ids.map(insurerLabel).join(", ");
}
