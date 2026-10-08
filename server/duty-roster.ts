import { slugify } from "./pharmacy-directory";

/**
 * Programmation des gardes des pharmacies.
 *
 * La garde dure une semaine et change chaque samedi à 8 h (heure du Burkina Faso, UTC+0 toute
 * l'année, donc 8 h UTC). Chaque ville fait tourner une liste de tours dans un ordre fixe :
 * - par groupes de l'annuaire, dans l'ordre 1 → 2 → … (4 groupes à Ouagadougou et Bobo-Dioulasso,
 *   2 ou 3 dans les autres villes programmées) ;
 * - ou par listes fixes de pharmacies (identifiants de l'annuaire).
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

export function groupTurns(count: number): DutyTurn[] {
  return Array.from({ length: count }, (_, index) => ({ label: `Groupe ${index + 1}`, dutyGroup: index + 1 }));
}

/** Rotation par groupes, à partir du groupe de garde de la semaine du samedi 3 au samedi 10 octobre 2026, 8 h. */
export function groupRotation(city: string, groupCount: number, groupOnDutyOct3: number): DutyRotation {
  return { city, reference: { start: "2026-10-03", turnIndex: groupOnDutyOct3 - 1 }, turns: groupTurns(groupCount) };
}

/**
 * Groupes de garde communiqués pour la semaine du 3 au 10 octobre 2026. Les villes absentes
 * (Dédougou, Dori, Fada N'gourma, Gaoua, Ziniaré) n'ont pas encore de programmation confirmée.
 */
export const DUTY_ROTATIONS: readonly DutyRotation[] = [
  groupRotation("Ouagadougou", 4, 4),
  groupRotation("Bobo-Dioulasso", 4, 4),
  groupRotation("Koudougou", 3, 3),
  groupRotation("Banfora", 3, 3),
  groupRotation("Kaya", 2, 2),
  groupRotation("Tenkodogo", 2, 1),
  groupRotation("Ouahigouya", 2, 1),
];

export function dutyCityKey(value: string | null | undefined) {
  return slugify(value ?? "").replace(/-/g, "");
}
const cityKey = dutyCityKey;

/**
 * Exceptions ponctuelles saisies dans la console, par ville et par semaine : pharmacies ajoutées à la
 * garde (remplaçante) ou retirées (fermeture). Clé : voir `exceptionKey`.
 */
export type DutyExceptions = ReadonlyMap<string, { add: ReadonlySet<string>; remove: ReadonlySet<string> }>;

/** Date (AAAA-MM-JJ) du samedi qui ouvre une semaine de garde. */
export function weekDateKey(start: Date) {
  return start.toISOString().slice(0, 10);
}

export function exceptionKey(city: string, weekStart: Date | string) {
  return `${cityKey(city)}|${typeof weekStart === "string" ? weekStart : weekDateKey(weekStart)}`;
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

export function isPharmacyOnDuty(pharmacy: { id: string; dutyGroup?: number | null }, week: DutyWeek, exceptions?: DutyExceptions) {
  const exception = exceptions?.get(exceptionKey(week.city, week.start));
  if (exception?.remove.has(pharmacy.id)) return false;
  if (exception?.add.has(pharmacy.id)) return true;
  if (week.turn.pharmacyIds) return week.turn.pharmacyIds.includes(pharmacy.id);
  return week.turn.dutyGroup !== undefined && pharmacy.dutyGroup === week.turn.dutyGroup;
}

/** Statut de garde d'une pharmacie à un instant donné ; null si sa ville n'a pas de programmation. */
export function dutyStatusAt(pharmacy: { id: string; city?: string | null; dutyGroup?: number | null }, at: Date = new Date(), rotations: readonly DutyRotation[] = DUTY_ROTATIONS, exceptions?: DutyExceptions) {
  const rotation = findDutyRotation(pharmacy.city, rotations);
  if (!rotation) return null;
  const week = dutyWeekAt(rotation, at);
  return { onDuty: isPharmacyOnDuty(pharmacy, week, exceptions), week };
}
