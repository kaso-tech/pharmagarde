/**
 * Horaires de service des pharmacies et des structures de santé.
 *
 * Une semaine d'horaires : pour chaque jour, des plages « HH:MM »–« HH:MM » (aucune plage = fermé).
 * Les heures sont celles du Burkina Faso, UTC+0 toute l'année : pas de conversion de fuseau.
 * Chaque ville a ses horaires (fixés par l'ONPBF), qu'un établissement peut remplacer par les siens.
 * Une pharmacie de garde est ouverte 24 h/24, quels que soient ses horaires.
 */
export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export type TimeRange = { open: string; close: string };
export type WeeklyHours = Record<WeekDay, TimeRange[]>;

export const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  mon: "Lundi",
  tue: "Mardi",
  wed: "Mercredi",
  thu: "Jeudi",
  fri: "Vendredi",
  sat: "Samedi",
  sun: "Dimanche",
};

const SHORT_LABELS: Record<WeekDay, string> = { mon: "Lun", tue: "Mar", wed: "Mer", thu: "Jeu", fri: "Ven", sat: "Sam", sun: "Dim" };

/** Horaires par défaut d'une ville : lundi à vendredi 8 h–20 h, samedi 8 h–12 h, dimanche fermé. */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  mon: [{ open: "08:00", close: "20:00" }],
  tue: [{ open: "08:00", close: "20:00" }],
  wed: [{ open: "08:00", close: "20:00" }],
  thu: [{ open: "08:00", close: "20:00" }],
  fri: [{ open: "08:00", close: "20:00" }],
  sat: [{ open: "08:00", close: "12:00" }],
  sun: [],
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export function isValidTime(value: string) {
  return TIME_PATTERN.test(value);
}

export function minutesOf(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/** Message d'erreur en français, ou null si les horaires sont valides. */
export function validateWeeklyHours(hours: WeeklyHours): string | null {
  for (const day of WEEK_DAYS) {
    const ranges = [...(hours[day] ?? [])].sort((left, right) => minutesOf(left.open) - minutesOf(right.open));
    for (const [index, range] of ranges.entries()) {
      if (!isValidTime(range.open) || !isValidTime(range.close)) return `${WEEK_DAY_LABELS[day]} : heure invalide (format HH:MM).`;
      if (minutesOf(range.open) >= minutesOf(range.close)) return `${WEEK_DAY_LABELS[day]} : l’heure de fermeture doit suivre l’heure d’ouverture.`;
      const previous = ranges[index - 1];
      if (previous && minutesOf(range.open) < minutesOf(previous.close)) return `${WEEK_DAY_LABELS[day]} : les plages horaires se chevauchent.`;
    }
  }
  return null;
}

/** Lit des horaires enregistrés en JSON ; null si absents ou invalides. */
export function parseWeeklyHours(value: unknown): WeeklyHours | null {
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const hours = {} as WeeklyHours;
  for (const day of WEEK_DAYS) {
    const ranges = record[day];
    if (!Array.isArray(ranges)) return null;
    hours[day] = ranges
      .filter((range): range is TimeRange => !!range && typeof range === "object" && typeof (range as TimeRange).open === "string" && typeof (range as TimeRange).close === "string")
      .map((range) => ({ open: range.open, close: range.close }));
  }
  return validateWeeklyHours(hours) ? null : hours;
}

const DAY_BY_UTC_INDEX: readonly WeekDay[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Ouvert à l'instant donné (heure du Burkina Faso = UTC). */
export function isOpenAt(hours: WeeklyHours, at: Date = new Date()) {
  const day = DAY_BY_UTC_INDEX[at.getUTCDay()]!;
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  return hours[day].some((range) => minute >= minutesOf(range.open) && minute < minutesOf(range.close));
}

function formatTime(value: string) {
  return value.replace(":", " h ").replace(/ h 00$/, " h").replace(/^0/, "");
}

function formatRanges(ranges: TimeRange[]) {
  return ranges.length ? ranges.map((range) => `${formatTime(range.open)}–${formatTime(range.close)}`).join(", ") : "fermé";
}

/** Résumé lisible, jours identiques regroupés : « Lun–Ven 8 h–20 h · Sam 8 h–12 h · Dim fermé ». */
export function formatWeeklyHours(hours: WeeklyHours) {
  const parts: string[] = [];
  let start = 0;
  for (let index = 1; index <= WEEK_DAYS.length; index += 1) {
    const current = formatRanges(hours[WEEK_DAYS[start]!]);
    const next = index < WEEK_DAYS.length ? formatRanges(hours[WEEK_DAYS[index]!]) : null;
    if (next === current) continue;
    const first = SHORT_LABELS[WEEK_DAYS[start]!];
    const last = SHORT_LABELS[WEEK_DAYS[index - 1]!];
    parts.push(`${index - 1 === start ? first : `${first}–${last}`} ${current}`);
    start = index;
  }
  return parts.join(" · ");
}

export function sameWeeklyHours(left: WeeklyHours, right: WeeklyHours) {
  return WEEK_DAYS.every((day) => formatRanges(left[day]) === formatRanges(right[day]));
}
