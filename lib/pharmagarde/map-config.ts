import type { MapPreference } from "./types";

// Fonds de carte MapLibre. Chaque URL est un style MapLibre (style.json) et peut être remplacée par
// variable d'environnement sans changer le code.

/** Style principal : OpenFreeMap (gratuit, sans clé, données OpenStreetMap). */
export const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAPLIBRE_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";

/**
 * Style de secours chargé automatiquement si le style principal ne répond pas. Fournisseur
 * distinct (VersaTiles, gratuit, sans clé) pour ne pas dépendre d'une seule infrastructure.
 */
export const MAP_FALLBACK_STYLE_URL = process.env.EXPO_PUBLIC_MAPLIBRE_FALLBACK_STYLE_URL || "https://tiles.versatiles.org/assets/styles/colorful/style.json";

/**
 * Style satellite d'un fournisseur sous licence (ex. MapTiler :
 * https://api.maptiler.com/maps/hybrid/style.json?key=…). Absent : le mode satellite est masqué,
 * aucune imagerie n'est chargée sans contrat d'utilisation.
 */
export const MAP_SATELLITE_STYLE_URL = process.env.EXPO_PUBLIC_MAPLIBRE_SATELLITE_STYLE_URL || null;

export const MAP_ATTRIBUTION = "Pharmacies : annuaire PharmaGarde · Structures de santé © contributeurs OpenStreetMap";

export function availableMapPreferences(): MapPreference[] {
  return MAP_SATELLITE_STYLE_URL ? ["Standard", "Satellite"] : ["Standard"];
}

export function effectiveMapPreference(preference: MapPreference): MapPreference {
  return preference === "Satellite" && !MAP_SATELLITE_STYLE_URL ? "Standard" : preference;
}
