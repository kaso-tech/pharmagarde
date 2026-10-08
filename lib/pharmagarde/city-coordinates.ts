import { Coordinates } from "./types";

export type KnownBurkinaCity = Coordinates & {
  name: string;
  aliases: string[];
};

/** Villes proposées dans l'application (liste de référence, remplacée par celle publiée par le serveur). */
export const PHARMAGARDE_CITIES: string[] = [
  "Ouagadougou",
  "Bobo-Dioulasso",
  "Koudougou",
  "Ouahigouya",
  "Kaya",
  "Tenkodogo",
  "Fada N'gourma",
  "Dori",
  "Gaoua",
  "Banfora",
  "Ziniaré",
  "Dédougou",
  "Manga",
];

export const KNOWN_BURKINA_CITIES: KnownBurkinaCity[] = [
  { name: "Ouagadougou", latitude: 12.3714, longitude: -1.5197, aliases: ["ouagadougou", "ouaga", "kadiogo"] },
  { name: "Bobo-Dioulasso", latitude: 11.1784, longitude: -4.2979, aliases: ["bobo-dioulasso", "bobo dioulasso", "bobo", "houet"] },
  { name: "Koudougou", latitude: 12.2526, longitude: -2.3627, aliases: ["koudougou", "boulkiemde", "boulkiemdé"] },
  { name: "Ouahigouya", latitude: 13.5828, longitude: -2.4216, aliases: ["ouahigouya", "yatenga"] },
  { name: "Kaya", latitude: 13.0917, longitude: -1.0844, aliases: ["kaya", "sanmatenga"] },
  { name: "Tenkodogo", latitude: 11.78, longitude: -0.3697, aliases: ["tenkodogo", "boulgou"] },
  { name: "Fada N'gourma", latitude: 12.0616, longitude: 0.3589, aliases: ["fada n'gourma", "fada ngourma", "fada n’gourma", "fada", "gourma"] },
  { name: "Dori", latitude: 14.0354, longitude: -0.0345, aliases: ["dori", "séno", "seno"] },
  { name: "Gaoua", latitude: 10.325, longitude: -3.174, aliases: ["gaoua", "poni"] },
  { name: "Banfora", latitude: 10.6333, longitude: -4.7667, aliases: ["banfora", "comoé", "comoe"] },
  { name: "Ziniaré", latitude: 12.5822, longitude: -1.2972, aliases: ["ziniaré", "ziniare", "oubritenga"] },
  { name: "Dédougou", latitude: 12.4634, longitude: -3.4608, aliases: ["dédougou", "dedougou", "mouhoun"] },
  { name: "Manga", latitude: 11.6636, longitude: -1.0731, aliases: ["manga", "zoundwéogo", "zoundweogo"] },
];

const DEFAULT_CITIES = [...KNOWN_BURKINA_CITIES];

export type PublishedCity = Coordinates & { name: string; aliases?: string[] };

/**
 * Applique la liste des villes publiée par le serveur (`/app-config`) : les tableaux exportés sont
 * modifiés sur place pour que tous les modules voient la même liste. Les alias de la liste de
 * référence sont conservés ; une ville ajoutée depuis la console est reconnue par son nom et ses alias.
 */
export function setPublishedCities(list?: readonly PublishedCity[] | null) {
  if (!list?.length) return;
  const next = list.map((city) => {
    const known = DEFAULT_CITIES.find((item) => item.name === city.name);
    const aliases = [...new Set([city.name.toLowerCase(), ...(known?.aliases ?? []), ...(city.aliases ?? []).map((alias) => alias.toLowerCase())])];
    return { name: city.name, latitude: city.latitude, longitude: city.longitude, aliases };
  });
  KNOWN_BURKINA_CITIES.splice(0, KNOWN_BURKINA_CITIES.length, ...next);
  PHARMAGARDE_CITIES.splice(0, PHARMAGARDE_CITIES.length, ...next.map((city) => city.name));
}
