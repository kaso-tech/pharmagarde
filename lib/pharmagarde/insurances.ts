/**
 * Assurances santé que les établissements peuvent accepter (tiers payant). Liste de référence
 * partagée par le serveur, la console d'administration et l'application : les établissements
 * enregistrent les identifiants, l'affichage utilise les libellés.
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

export type InsurerId = (typeof INSURERS)[number]["id"];

export const INSURER_IDS = INSURERS.map((insurer) => insurer.id) as [InsurerId, ...InsurerId[]];

export function isInsurerId(value: unknown): value is InsurerId {
  return typeof value === "string" && (INSURER_IDS as readonly string[]).includes(value);
}

export function insurerLabel(id: string) {
  return INSURERS.find((insurer) => insurer.id === id)?.label ?? id;
}

/** Identifiants valides, sans doublon, dans l'ordre de la liste de référence (JSON ou tableau). */
export function normalizeInsurerIds(value: unknown): InsurerId[] {
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const selected = new Set(raw.filter(isInsurerId));
  return INSURER_IDS.filter((id) => selected.has(id));
}

/** « Sunu, UAB, Yelen » */
export function formatInsurers(ids: readonly string[]) {
  return ids.map(insurerLabel).join(", ");
}
