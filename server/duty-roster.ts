import { slugify } from "./pharmacy-directory";

/**
 * Programmation des gardes des pharmacies.
 *
 * La garde dure une semaine et change chaque samedi à 8 h (heure du Burkina Faso, UTC+0 toute
 * l'année, donc 8 h UTC). Chaque ville fait tourner une liste de tours dans un ordre fixe :
 * - Ouagadougou et Bobo-Dioulasso : les groupes 1 → 2 → 3 → 4 de l'annuaire ;
 * - les autres villes : des listes fixes de pharmacies (ex. Koudougou, 3 listes), à ajouter avec
 *   leurs pharmacies dans l'annuaire.
 *
 * Un tour de référence (une semaine connue et le tour de garde de cette semaine) suffit à
 * calculer toutes les semaines, passées et futures.
 */
export type DutyTurn = {
  label: string;
  /** Tour défini par un groupe de garde de l'annuaire (1 à 4). */
  dutyGroup?: number;
  /** Tour défini par une liste de pharmacies (identifiants de l'annuaire). */
  pharmacyIds?: readonly string[];
};

export type DutyRotation = {
  city: string;
  /** Samedi de début d'une semaine connue (AAAA-MM-JJ) et position du tour de garde de cette semaine. */
  reference: { start: string; turnIndex: number };
  turns: readonly DutyTurn[];
};

export type DutyWeek = {
  city: string;
  turn: DutyTurn;
  turnIndex: number;
  /** Début de la garde : samedi 8 h. */
  start: Date;
  /** Fin de la garde : samedi suivant 8 h. */
  end: Date;
};

export const DUTY_HANDOVER_HOUR_UTC = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const GROUP_TURNS: readonly DutyTurn[] = [1, 2, 3, 4].map((dutyGroup) => ({ label: `Groupe ${dutyGroup}`, dutyGroup }));

/** Base communiquée par l'Ordre : groupe 4 de garde du samedi 3 au samedi 10 octobre 2026, 8 h. */
export const DUTY_ROTATIONS: readonly DutyRotation[] = [
  { city: "Ouagadougou", reference: { start: "2026-10-03", turnIndex: 3 }, turns: GROUP_TURNS },
  { city: "Bobo-Dioulasso", reference: { start: "2026-10-03", turnIndex: 3 }, turns: GROUP_TURNS },
];

function cityKey(value: string | null | undefined) {
  return slugify(value ?? "").replace(/-/g, "");
}

export function findDutyRotation(city: string | null | undefined, rotations: readonly DutyRotation[] = DUTY_ROTATIONS) {
  const key = cityKey(city);
  return key ? rotations.find((rotation) => cityKey(rotation.city) === key) : undefined;
}

function referenceStart(rotation: DutyRotation) {
  const [year, month, day] = rotation.reference.start.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!, DUTY_HANDOVER_HOUR_UTC);
}

/** Semaine de garde contenant `at`, ou décalée de `offset` semaines (1 = la suivante). */
export function dutyWeekAt(rotation: DutyRotation, at: Date = new Date(), offset = 0): DutyWeek {
  const reference = referenceStart(rotation);
  const weeks = Math.floor((at.getTime() - reference) / WEEK_MS) + offset;
  const count = rotation.turns.length;
  const turnIndex = (((rotation.reference.turnIndex + weeks) % count) + count) % count;
  const start = reference + weeks * WEEK_MS;
  return { city: rotation.city, turn: rotation.turns[turnIndex]!, turnIndex, start: new Date(start), end: new Date(start + WEEK_MS) };
}

export function isPharmacyOnDuty(pharmacy: { id: string; dutyGroup?: number | null }, week: DutyWeek) {
  if (week.turn.pharmacyIds) return week.turn.pharmacyIds.includes(pharmacy.id);
  return week.turn.dutyGroup !== undefined && pharmacy.dutyGroup === week.turn.dutyGroup;
}

/** Statut de garde d'une pharmacie à un instant donné ; null si sa ville n'a pas de programmation. */
export function dutyStatusAt(pharmacy: { id: string; city?: string | null; dutyGroup?: number | null }, at: Date = new Date(), rotations: readonly DutyRotation[] = DUTY_ROTATIONS) {
  const rotation = findDutyRotation(pharmacy.city, rotations);
  if (!rotation) return null;
  const week = dutyWeekAt(rotation, at);
  return { onDuty: isPharmacyOnDuty(pharmacy, week), week };
}
