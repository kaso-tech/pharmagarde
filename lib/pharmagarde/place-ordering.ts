import { HealthPlace } from "./types";

const UNKNOWN_DISTANCE_KM = Number.POSITIVE_INFINITY;

/** Pharmacies de garde d'abord, puis les lieux ouverts, puis les autres. */
function openRank(place: HealthPlace) {
  if (place.onDuty === true) return 0;
  return place.isOpen === true ? 1 : 2;
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
  if (place.onDuty === true) return "De garde";
  return place.isOpen === true ? "Ouvert" : place.isOpen === false ? "Fermé" : "Statut inconnu";
}
