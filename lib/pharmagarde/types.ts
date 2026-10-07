import type { WeeklyHours } from "./opening-hours";

export type EntityType = "pharmacy" | "clinic" | "medicine";

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type HealthPlace = {
  id: string;
  type: "pharmacy" | "clinic";
  name: string;
  address?: string;
  city?: string;
  phone?: string;
  rating?: number;
  distanceKm?: number;
  distanceLabel?: string;
  latitude?: number;
  longitude?: number;
  isOpen?: boolean;
  /** Type métier déduit des données OpenStreetMap : Pharmacie, CHU, CSPS, CMA, etc. */
  establishmentType?: string;
  /** Horaires au format OpenStreetMap, ex. « Mo-Sa 08:00-20:00 ». */
  openingHours?: string;
  /** Groupe de garde de la pharmacie (1 à 4) dans l'annuaire ; base de la programmation des gardes. */
  dutyGroup?: number;
  /** Pharmacie de garde cette semaine, calculé par le serveur selon la programmation de la ville. */
  onDuty?: boolean;
  /** Début et fin de la garde en cours (samedi 8 h), au format ISO. */
  dutyStart?: string;
  dutyEnd?: string;
  /** Horaires de service de la semaine (horaires propres ou de la ville), pour recalculer le statut. */
  serviceHours?: WeeklyHours;
  /** Assurances acceptées (identifiants de lib/pharmagarde/insurances.ts). */
  insurances?: string[];
};

export type MedicineAgeCategory = "Enfant" | "Adulte" | "Tous";

/** Liste de la Liste nationale des produits essentiels de santé à laquelle appartient le produit. */
export type MedicineProductType = "Médicaments enfants" | "Médicaments adultes" | "Intrants nutritionnels" | "Dispositifs médicaux";

export type Medicine = {
  id: string;
  type: "medicine";
  name: string;
  /** Type de produit (liste d'origine). */
  productType?: MedicineProductType;
  /** Catégorie : groupe pharmaco-thérapeutique ou catégorie de dispositifs (ex. « 6. ANTI-INFECTIEUX »). */
  category?: string;
  /** Sous-catégorie (ex. « 6.2.1 Antibiotiques du groupe Access »). */
  subcategory?: string;
  ageCategory?: MedicineAgeCategory;
  /** Forme pharmaceutique (comprimé, injectable…). */
  pharmaceuticalType?: string;
  dosage?: string;
  /** Prix approximatif en FCFA, ou bas de la fourchette lorsque priceMax est renseigné. */
  priceApprox?: number;
  priceMax?: number;
  /** Unité à laquelle s'applique le prix (ex. « par comprimé »). */
  priceUnit?: string;
  /** Prix public officiel fixé par arrêté (sinon estimation). */
  priceOfficial?: boolean;
  description?: string;
  imageUrl?: string;
};

export type AppMode = "Clair" | "Sombre";
export type AppLanguage = "FR" | "EN";
export type MapPreference = "Standard" | "Satellite";

export type AppPreferences = {
  mode: AppMode;
  language: AppLanguage;
  mapType: MapPreference;
  city: string;
};

export type FavoriteItem = {
  id: string;
  entityType: EntityType;
  title: string;
  subtitle?: string;
  metadata?: string;
  phone?: string;
  rating?: number;
  latitude?: number;
  longitude?: number;
};

export type ApiState = {
  configured: boolean;
  message?: string;
};

export type CombinedSearchItem = FavoriteItem & {
  sourceLabel: string;
};

export function favoriteKey(entityType: EntityType, id: string) {
  return `${entityType}:${id}`;
}
