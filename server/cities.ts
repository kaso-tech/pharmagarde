/**
 * Villes couvertes par l'application. La liste de référence ci-dessous est complétée, modifiée ou
 * dépubliée depuis la console (table `cities`, server/content-config.ts) : `SUPPORTED_CITIES` est
 * alors mis à jour sur place, pour que tous les modules qui l'ont importé voient la même liste.
 */
export type SupportedCity = {
  name: string;
  latitude: number;
  longitude: number;
};

export const DEFAULT_CITIES: readonly SupportedCity[] = [
  { name: "Ouagadougou", latitude: 12.3714, longitude: -1.5197 },
  { name: "Bobo-Dioulasso", latitude: 11.1771, longitude: -4.2979 },
  { name: "Koudougou", latitude: 12.2526, longitude: -2.3627 },
  { name: "Ouahigouya", latitude: 13.5828, longitude: -2.4216 },
  { name: "Kaya", latitude: 13.0917, longitude: -1.0844 },
  { name: "Tenkodogo", latitude: 11.78, longitude: -0.3697 },
  { name: "Fada N'gourma", latitude: 12.0616, longitude: 0.3587 },
  { name: "Dori", latitude: 14.0354, longitude: -0.0345 },
  { name: "Gaoua", latitude: 10.3256, longitude: -3.1742 },
  { name: "Banfora", latitude: 10.6333, longitude: -4.7667 },
  { name: "Ziniaré", latitude: 12.5822, longitude: -1.2983 },
  { name: "Dédougou", latitude: 12.4634, longitude: -3.4608 },
  { name: "Manga", latitude: 11.6636, longitude: -1.0731 },
];

/** Villes publiées dans l'application (liste de référence tant que la console n'a rien changé). */
export const SUPPORTED_CITIES: SupportedCity[] = [...DEFAULT_CITIES];

export function setSupportedCities(list: readonly SupportedCity[]) {
  SUPPORTED_CITIES.splice(0, SUPPORTED_CITIES.length, ...list);
}
