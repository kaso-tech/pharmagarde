import { isOpenAt } from "./opening-hours";
import { HealthPlace } from "./types";

const UNKNOWN_DISTANCE_KM = Number.POSITIVE_INFINITY;

/**
 * Lieux en service d'abord (de garde ou ouverts selon leurs horaires, sans distinction), puis ceux au
 * statut inconnu, puis les fermés ; à l'intérieur de chaque bloc, du plus proche au plus loin.
 */
function openRank(place: HealthPlace) {
  if (place.onDuty === true || place.isOpen === true) return 0;
  return place.isOpen === false ? 2 : 1;
}

/**
 * Recalcule le statut à l'instant présent à partir des horaires et de la période de garde reçus du
 * serveur : une liste gardée en cache sur le téléphone garde ainsi un statut juste.
 */
export function resolvePlaceStatus<T extends HealthPlace>(place: T, at: Date = new Date()): T {
  const now = at.getTime();
  const dutyStart = place.dutyStart ? Date.parse(place.dutyStart) : Number.NaN;
  const dutyEnd = place.dutyEnd ? Date.parse(place.dutyEnd) : Number.NaN;
  const onDuty = place.onDuty === true && Number.isFinite(dutyEnd) ? now < dutyEnd && (!Number.isFinite(dutyStart) || now >= dutyStart) : place.onDuty;
  const isOpen = onDuty === true ? true : place.serviceHours ? isOpenAt(place.serviceHours, at) : place.isOpen;
  return onDuty === place.onDuty && isOpen === place.isOpen ? place : { ...place, onDuty, isOpen };
}

function distanceRank(place: HealthPlace) {
  return typeof place.distanceKm === "number" && Number.isFinite(place.distanceKm) ? place.distanceKm : UNKNOWN_DISTANCE_KM;
}

export function comparePlacesByOpenThenDistance(a: HealthPlace, b: HealthPlace) {
  const byOpenStatus = openRank(a) - openRank(b);
  if (byOpenStatus !== 0) return byOpenStatus;

  const aDistance = distanceRank(a);
  const bDistance = distanceRank(b);
  if (aDistance !== bDistance) return aDistance < bDistance ? -1 : 1;

  return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
}

export function sortPlacesByOpenThenDistance(places: HealthPlace[]) {
  return [...places].sort(comparePlacesByOpenThenDistance);
}

/** Libellé du badge de statut : la garde prime sur les horaires d'ouverture. */
export function placeStatusLabel(place: Pick<HealthPlace, "isOpen" | "onDuty">) {
  if (place.onDuty === true) return "Garde";
  return place.isOpen === true ? "Ouvert" : place.isOpen === false ? "Fermé" : "Statut inconnu";
}

/** Ligne d'horaires : la garde (24 h/24 jusqu'à la relève) prime sur les horaires de service. */
export function placeHoursLabel(place: Pick<HealthPlace, "onDuty" | "dutyEnd" | "openingHours">) {
  if (place.onDuty === true) {
    const end = place.dutyEnd ? new Date(place.dutyEnd) : null;
    // Heure du Burkina Faso = UTC.
    const until = end && Number.isFinite(end.getTime()) ? ` jusqu’au ${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(end)} à ${end.getUTCHours()} h` : "";
    return `Garde : ouverte 24 h/24${until}`;
  }
  return place.openingHours ?? null;
}
