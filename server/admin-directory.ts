import { z } from "zod";

import type { DirectoryEntry } from "../drizzle/schema";
import { INSURER_IDS, normalizeInsurerIds } from "../lib/pharmagarde/insurances";
import { WEEK_DAYS, parseWeeklyHours, validateWeeklyHours, type WeeklyHours } from "../lib/pharmagarde/opening-hours";
import { SUPPORTED_CITIES, getCacheState, type CachedHealthPlace } from "./pharmagarde-cache";
import { DUTY_GROUPS, isInBurkinaFaso, loadPharmacyDirectory, normalizeBurkinaPhone, slugify } from "./pharmacy-directory";

export type AdminDirectoryKind = "pharmacy" | "healthcare";
export type AdminDirectoryStatus = "active" | "archived";

export type AdminDirectoryItem = {
  id: string;
  kind: AdminDirectoryKind;
  status: AdminDirectoryStatus;
  city: string;
  name: string;
  phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  dutyGroup: number | null;
  establishmentType: string | null;
  /** Horaires propres ; null = horaires de la ville. */
  openingHours: WeeklyHours | null;
  /** Assurances acceptées (identifiants de lib/pharmagarde/insurances.ts). */
  insurances: string[];
  source: "annuaire" | "cache" | "admin";
  managed: boolean;
  updatedAt: string | null;
};

const timeRangeSchema = z.object({ open: z.string().trim(), close: z.string().trim() });

/** Semaine d'horaires : pour chaque jour, jusqu'à 4 plages (aucune = fermé). */
export const weeklyHoursSchema = z
  .object(Object.fromEntries(WEEK_DAYS.map((day) => [day, z.array(timeRangeSchema).max(4)])) as Record<(typeof WEEK_DAYS)[number], z.ZodArray<typeof timeRangeSchema>>)
  .superRefine((value, ctx) => {
    const error = validateWeeklyHours(value);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  });

export const directoryUpsertSchema = z
  .object({
    id: z.string().trim().min(3).max(128).optional(),
    kind: z.enum(["pharmacy", "healthcare"]),
    city: z.string().trim().min(2).max(96),
    name: z.string().trim().min(2).max(255),
    phone: z.string().trim().max(40).nullable().optional(),
    address: z.string().trim().max(1000).nullable().optional(),
    latitude: z.number().finite().nullable().optional(),
    longitude: z.number().finite().nullable().optional(),
    dutyGroup: z.number().int().nullable().optional(),
    establishmentType: z.string().trim().max(64).nullable().optional(),
    /** Horaires propres ; null ou absent = horaires de la ville. */
    openingHours: weeklyHoursSchema.nullable().optional(),
    /** Assurances acceptées ; vide = aucune assurance renseignée. */
    insurances: z.array(z.enum(INSURER_IDS)).max(INSURER_IDS.length).optional(),
  })
  .superRefine((value, ctx) => {
    const hasLatitude = value.latitude !== null && value.latitude !== undefined;
    const hasLongitude = value.longitude !== null && value.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Les coordonnées latitude et longitude doivent être renseignées ensemble.", path: ["latitude"] });
    }
    if (value.kind === "pharmacy" && !hasLatitude && !hasLongitude) {
      // Même règle que l'import : une pharmacie sans position ne peut pas être affichée sur la carte.
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Les coordonnées sont obligatoires pour une pharmacie.", path: ["latitude"] });
    }
    if (hasLatitude && hasLongitude && !isInBurkinaFaso(value.latitude as number, value.longitude as number)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Les coordonnées doivent se situer au Burkina Faso.", path: ["latitude"] });
    }
    if (value.kind === "pharmacy" && value.dutyGroup !== null && value.dutyGroup !== undefined && !(DUTY_GROUPS as readonly number[]).includes(value.dutyGroup)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Le groupe de garde doit être compris entre 1 et 4.", path: ["dutyGroup"] });
    }
    if (value.phone && !normalizeBurkinaPhone(value.phone)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Le numéro doit être un numéro burkinabè valide.", path: ["phone"] });
    }
  });

/** Un archivage requiert un consentement explicite, même si l’appel contourne l’interface. */
export const directoryArchiveSchema = z.object({
  id: z.string().trim().min(3).max(128),
  kind: z.enum(["pharmacy", "healthcare"]),
  confirmArchive: z.literal(true),
});

export const directoryRestoreSchema = z.object({
  id: z.string().trim().min(3).max(128),
});

export type DirectoryUpsertInput = z.infer<typeof directoryUpsertSchema>;

export type NormalizedDirectoryUpsert = {
  id: string;
  kind: AdminDirectoryKind;
  status: "active";
  city: string;
  name: string;
  phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  dutyGroup: number | null;
  establishmentType: string | null;
  openingHours: string | null;
  insurances: string | null;
};

function compact(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/** Clé de comparaison des villes : « ouaga dougou », « Ouagadougou » et « OUAGADOUGOU » sont identiques. */
export function cityMatchKey(value: string) {
  return slugify(value).replace(/-/g, "");
}

/**
 * Prépare une fiche saisie dans la console. Une ville déjà connue reprend son orthographe de
 * référence, pour ne pas créer « ouagadougou » à côté de « Ouagadougou ».
 */
export function normalizeDirectoryUpsert(input: DirectoryUpsertInput, knownCities: readonly string[] = []): NormalizedDirectoryUpsert {
  const typedCity = compact(input.city);
  const city = knownCities.find((known) => cityMatchKey(known) === cityMatchKey(typedCity)) ?? typedCity;
  const name = compact(input.name);
  const id = input.id?.trim() || `admin-${input.kind}-${slugify(city)}-${slugify(name)}`;
  const phone = input.phone ? normalizeBurkinaPhone(input.phone) : null;

  return {
    id,
    kind: input.kind,
    status: "active",
    city,
    name,
    phone,
    address: input.address ? compact(input.address) : null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    dutyGroup: input.kind === "pharmacy" ? input.dutyGroup ?? null : null,
    establishmentType: input.kind === "healthcare" ? input.establishmentType ?? "Centre de santé" : "Pharmacie",
    openingHours: input.openingHours ? JSON.stringify(input.openingHours) : null,
    insurances: input.insurances?.length ? JSON.stringify(normalizeInsurerIds(input.insurances)) : null,
  };
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function pharmacyItems(directory: Awaited<ReturnType<typeof loadPharmacyDirectory>>): AdminDirectoryItem[] {
  return directory.pharmacies.map((item) => ({
    id: item.id,
    kind: "pharmacy",
    status: "active",
    city: item.city,
    name: item.name,
    phone: item.phone,
    address: item.address ?? null,
    latitude: item.latitude,
    longitude: item.longitude,
    dutyGroup: item.dutyGroup,
    establishmentType: "Pharmacie",
    openingHours: null,
    insurances: [],
    source: "annuaire",
    managed: false,
    updatedAt: directory.updatedAt,
  }));
}

function healthcareItems(items: CachedHealthPlace[]): AdminDirectoryItem[] {
  return items.map((item) => ({
    id: item.id,
    kind: "healthcare",
    status: "active",
    city: item.city ?? "Non renseignée",
    name: item.name,
    phone: item.phone ?? null,
    address: item.address ?? null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    dutyGroup: null,
    establishmentType: item.type,
    openingHours: null,
    insurances: [],
    source: "cache",
    managed: false,
    updatedAt: item.updatedAt ?? null,
  }));
}

/** Sources existantes, sans I/O externe : annuaire versionné et cache mémoire déjà initialisé. */
export async function getBaseAdminDirectoryItems(): Promise<AdminDirectoryItem[]> {
  const directory = await loadPharmacyDirectory();
  const healthcare = Object.values(getCacheState("healthcare").byCity).flat();
  return [...pharmacyItems(directory), ...healthcareItems(healthcare)];
}

/**
 * Applique les surcharges administrées. Une archive masque l’enregistrement source sans le supprimer :
 * il reste listé avec le statut « archived » pour pouvoir être restauré.
 */
export function mergeAdminDirectoryItems(baseItems: AdminDirectoryItem[], overrides: DirectoryEntry[]): AdminDirectoryItem[] {
  const items = new Map(baseItems.map((item) => [item.id, item]));

  for (const override of overrides) {
    const current = items.get(override.id);
    const kind = override.kind as AdminDirectoryKind;
    const next: AdminDirectoryItem = {
      id: override.id,
      kind,
      status: override.status === "archived" ? "archived" : "active",
      city: override.city ?? current?.city ?? "Non renseignée",
      name: override.name ?? current?.name ?? override.id,
      // Même règle que les routes publiques (server/directory-overrides.ts) : une surcharge est un
      // enregistrement complet, un champ vidé dans la console l'est aussi pour les utilisateurs.
      phone: override.phone ?? null,
      address: override.address ?? null,
      latitude: override.latitude ?? null,
      longitude: override.longitude ?? null,
      dutyGroup: kind === "pharmacy" ? override.dutyGroup ?? null : null,
      establishmentType: override.establishmentType ?? current?.establishmentType ?? (kind === "pharmacy" ? "Pharmacie" : "Centre de santé"),
      openingHours: parseWeeklyHours(override.openingHours),
      insurances: normalizeInsurerIds(override.insurances),
      source: "admin",
      managed: true,
      updatedAt: toIso(override.updatedAt),
    };
    items.set(next.id, next);
  }

  return [...items.values()].sort((left, right) => left.city.localeCompare(right.city, "fr") || left.name.localeCompare(right.name, "fr"));
}

export type AdminDirectoryFilter = {
  kind?: AdminDirectoryKind | "all";
  search?: string;
  status?: AdminDirectoryStatus;
  city?: string;
  /** « none » : pharmacies sans groupe de garde. */
  dutyGroup?: "all" | "none" | "1" | "2" | "3" | "4";
  /** Identifiant d'assurance acceptée. */
  insurance?: string;
};

export function filterAdminDirectoryItems(items: AdminDirectoryItem[], input: AdminDirectoryFilter) {
  const search = input.search?.trim().toLocaleLowerCase("fr");
  const cityKey = input.city ? cityMatchKey(input.city) : null;
  const dutyGroup = input.dutyGroup ?? "all";
  return items.filter((item) => {
    if (item.status !== (input.status ?? "active")) return false;
    if (input.kind && input.kind !== "all" && item.kind !== input.kind) return false;
    if (cityKey && cityMatchKey(item.city) !== cityKey) return false;
    if (dutyGroup === "none" && (item.kind !== "pharmacy" || item.dutyGroup !== null)) return false;
    if (dutyGroup !== "all" && dutyGroup !== "none" && item.dutyGroup !== Number(dutyGroup)) return false;
    if (input.insurance && !item.insurances.includes(input.insurance)) return false;
    if (!search) return true;
    return [item.name, item.city, item.phone ?? "", item.address ?? "", item.establishmentType ?? ""].some((value) => value.toLocaleLowerCase("fr").includes(search));
  });
}

/**
 * Villes proposées dans la console : celles où l'annuaire a des établissements publiés, puis les
 * villes prises en charge par l'application, chacune avec son nombre d'établissements publiés.
 */
export function listDirectoryCities(items: AdminDirectoryItem[]) {
  const counts = new Map<string, { name: string; count: number }>();
  for (const item of items) {
    if (item.status !== "active") continue;
    const key = cityMatchKey(item.city);
    const entry = counts.get(key) ?? { name: item.city, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  for (const city of SUPPORTED_CITIES) {
    const key = cityMatchKey(city.name);
    if (!counts.has(key)) counts.set(key, { name: city.name, count: 0 });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "fr"));
}
