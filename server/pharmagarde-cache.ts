import express, { type Express, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { applyCorsHeaders } from "./_core/security";
import { distanceKm } from "../lib/pharmagarde/city-utils";
import { applyDirectoryOverrides, getDirectoryOverrides } from "./directory-overrides";
import { formatWeeklyHours, isOpenAt, type WeeklyHours } from "../lib/pharmagarde/opening-hours";
import { getCityHoursLookup } from "./city-hours";
import { currentDutyConfig, getDutyConfig, type DutyConfig } from "./duty-config";
import { dutyStatusAt, dutyWeekAt, findDutyRotation } from "./duty-roster";
import type { Medicine } from "../lib/pharmagarde/types";
import { getEssentialMedicines, MEDICINES_NOTICE } from "./medicines-data";
import { loadPharmacyDirectory, type PharmacyDirectory } from "./pharmacy-directory";
import { getAuthenticatedDbUser, getPremiumStatusForUser } from "./premium";

export type CacheKind = "pharmacies" | "healthcare";
export type CachedPlaceCategory = "pharmacy" | "healthcare";
export type LocalEstablishmentType = "Pharmacie" | "CHU" | "CHR" | "CMA" | "CSPS" | "Clinique" | "Hôpital" | "Centre de santé";

export type CachedHealthPlace = {
  id: string;
  /** Type local déduit pour l’usage métier Burkina Faso. */
  type: LocalEstablishmentType;
  /** Catégorie applicative stable pour séparer pharmacies et structures de santé. */
  category: CachedPlaceCategory;
  name: string;
  address?: string;
  city?: string;
  phone?: string;
  rating?: number;
  userRatingsTotal?: number;
  distanceKm?: number;
  latitude?: number;
  longitude?: number;
  isOpen?: boolean;
  /** Horaires lisibles publiés, ex. « Lun–Ven 8 h–20 h · Sam 8 h–12 h · Dim fermé ». */
  openingHours?: string;
  /** Horaires de service propres saisis dans la console ; sinon ceux de la ville. */
  serviceHours?: WeeklyHours;
  /** Assurances acceptées (identifiants de lib/pharmagarde/insurances.ts), saisies dans la console. */
  insurances?: string[];
  /** « admin » : fiche créée ou corrigée dans la console d’administration. */
  source?: "annuaire" | "osm" | "local" | "admin";
  /** Groupe de garde de la pharmacie (1 à 4), issu de l'annuaire ; sert à la programmation des gardes. */
  dutyGroup?: number | null;
  /** Identifiant OpenStreetMap, ex. « node/123456 ». */
  osmId?: string;
  /** Valeur OSM ayant classé le lieu (amenity ou healthcare), ex. « pharmacy », « hospital ». */
  osmType?: string;
  updatedAt?: string;
};

type CacheBuckets = Record<string, CachedHealthPlace[]>;

type CacheState = {
  version: 3;
  kind: CacheKind;
  byCity: CacheBuckets;
  updatedAt: string | null;
  expiresAt: string | null;
  lastRefreshAttemptAt: string | null;
  lastError?: string;
};

type UpdateResult = {
  kind: CacheKind;
  ok: boolean;
  refreshed: boolean;
  itemCount: number;
  updatedAt: string | null;
  expiresAt: string | null;
  error?: string;
};

export type SupportedCity = {
  name: string;
  latitude: number;
  longitude: number;
};

export const SUPPORTED_CITIES: SupportedCity[] = [
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

const PHARMACY_TTL_MS = 24 * 60 * 60 * 1000;
const HEALTHCARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_DIR = process.env.PHARMAGARDE_CACHE_DIR ?? path.join(process.cwd(), "server", ".cache");
const PREMIUM_RESULT_LIMIT = 3;

// Collecte OpenStreetMap via l'API Overpass. Instance publique par défaut : respecter sa politique
// d'usage (requêtes séquentielles, User-Agent identifiable) ou pointer OSM_OVERPASS_URL vers une
// instance dédiée en production.
const OVERPASS_URL = process.env.OSM_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const OSM_RADIUS_METERS = Number(process.env.PHARMAGARDE_OSM_RADIUS_METERS ?? 15000);
const OSM_REQUEST_DELAY_MS = Number(process.env.PHARMAGARDE_OSM_REQUEST_DELAY_MS ?? 1000);
const OSM_USER_AGENT = "PharmaGardeBF/1.0 (+https://github.com/kaso-tech/pharmagarde)";
export const OSM_ATTRIBUTION = "© contributeurs OpenStreetMap (ODbL)";
export const PHARMACY_DIRECTORY_ATTRIBUTION = "Annuaire PharmaGarde (Ordre national des pharmaciens du Burkina Faso)";
const NON_MEDICAL_NAME_TERMS = ["veterinaire", "animal"];

const memoryCache: Record<CacheKind, CacheState> = {
  pharmacies: createEmptyState("pharmacies"),
  healthcare: createEmptyState("healthcare"),
};

const refreshLocks: Partial<Record<CacheKind, Promise<UpdateResult>>> = {};
let schedulersStarted = false;

function normalizeCityName(value?: string | null) {
  return (value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function cityKey(value?: string | null) {
  return normalizeCityName(value).replace(/\s+/g, "-");
}

function createEmptyBuckets(): CacheBuckets {
  return Object.fromEntries(SUPPORTED_CITIES.map((city) => [cityKey(city.name), []]));
}

function createEmptyState(kind: CacheKind): CacheState {
  return {
    version: 3,
    kind,
    byCity: createEmptyBuckets(),
    updatedAt: null,
    expiresAt: null,
    lastRefreshAttemptAt: null,
  };
}

function ttlFor(kind: CacheKind) {
  return kind === "pharmacies" ? PHARMACY_TTL_MS : HEALTHCARE_TTL_MS;
}

function fileFor(kind: CacheKind) {
  return path.join(CACHE_DIR, `${kind}.json`);
}

function nowIso() {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function classifyPlace(name: string, osmTypes: string[] = []): { category: CachedPlaceCategory; type: LocalEstablishmentType } {
  const normalizedName = normalizeCityName(name);
  if (osmTypes.includes("pharmacy") || normalizedName.includes("pharmacie") || normalizedName.includes("pharmacy")) return { category: "pharmacy", type: "Pharmacie" };
  if (/\bchu\b/.test(normalizedName)) return { category: "healthcare", type: "CHU" };
  if (/\bchr\b/.test(normalizedName)) return { category: "healthcare", type: "CHR" };
  if (/\bcma\b/.test(normalizedName)) return { category: "healthcare", type: "CMA" };
  if (/\bcsps\b/.test(normalizedName)) return { category: "healthcare", type: "CSPS" };
  if (normalizedName.includes("clinique") || normalizedName.includes("clinic") || osmTypes.includes("clinic")) return { category: "healthcare", type: "Clinique" };
  if (osmTypes.includes("hospital") || normalizedName.includes("hopital") || normalizedName.includes("hospital")) return { category: "healthcare", type: "Hôpital" };
  return { category: "healthcare", type: "Centre de santé" };
}

function findSupportedCity(value?: string | null) {
  const normalized = normalizeCityName(value);
  if (!normalized) return undefined;
  return SUPPORTED_CITIES.find((city) => normalizeCityName(city.name) === normalized);
}

type RequestedCityFilter = {
  rawCity?: string;
  supportedCity?: SupportedCity;
  key?: string;
};

function getRequestedCityFilter(req: Request): RequestedCityFilter {
  const rawCity = typeof req.query.city === "string" ? req.query.city.trim() : typeof req.query.ville === "string" ? req.query.ville.trim() : undefined;
  if (!rawCity) return {};

  const supportedCity = findSupportedCity(rawCity);
  return {
    rawCity,
    supportedCity,
    key: cityKey(supportedCity?.name ?? rawCity),
  };
}

type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

function osmTag(tags: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = tags[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function osmAddress(tags: Record<string, string>) {
  const street = [osmTag(tags, ["addr:housenumber"]), osmTag(tags, ["addr:street"])].filter(Boolean).join(" ");
  const parts = [street, osmTag(tags, ["addr:quarter", "addr:suburb", "addr:neighbourhood"]), osmTag(tags, ["addr:city"])].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : osmTag(tags, ["addr:full"]);
}

export function normalizeOsmElement(element: OsmElement, city: SupportedCity): CachedHealthPlace | null {
  const tags = element.tags ?? {};
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;

  const amenity = osmTag(tags, ["amenity"]);
  const healthcare = osmTag(tags, ["healthcare"]);
  const osmTypes = [amenity, healthcare].filter((value): value is string => !!value);
  const taggedName = osmTag(tags, ["name:fr", "name", "official_name", "brand"]);
  // Une structure de santé sans nom n'est pas exploitable par l'utilisateur.
  const name = taggedName;
  if (!name) return null;
  if (NON_MEDICAL_NAME_TERMS.some((term) => normalizeCityName(name).includes(term))) return null;
  if (osmTag(tags, ["healthcare:speciality"])?.includes("veterinary")) return null;

  const classification = classifyPlace(name, osmTypes);
  const openingHours = osmTag(tags, ["opening_hours"]);
  const osmId = `${element.type}/${element.id}`;
  return {
    id: `osm-${element.type}-${element.id}`,
    type: classification.type,
    category: classification.category,
    name,
    address: osmAddress(tags),
    city: city.name,
    phone: osmTag(tags, ["phone", "contact:phone", "contact:mobile"]),
    latitude,
    longitude,
    // Seul « 24/7 » est interprété ; le reste des horaires OSM est conservé tel quel.
    isOpen: openingHours === "24/7" ? true : undefined,
    openingHours,
    source: "osm",
    osmId,
    osmType: healthcare ?? amenity,
    updatedAt: nowIso(),
  };
}

function dedupePlaces(items: CachedHealthPlace[]) {
  const seen = new Set<string>();
  const unique: CachedHealthPlace[] = [];
  for (const item of items) {
    // Un même établissement est souvent cartographié deux fois (point + bâtiment) : on rapproche
    // aussi par nom et position arrondie (~100 m) quand le nom est renseigné.
    const keys = [item.osmId ?? item.id];
    if (item.latitude !== undefined && item.longitude !== undefined) {
      keys.push(`${item.category}:${normalizeCityName(item.name)}:${item.latitude.toFixed(3)}:${item.longitude.toFixed(3)}`);
    }
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    unique.push(item);
  }
  return unique;
}

function normalizeBuckets(input: Record<string, unknown>): CacheBuckets {
  const buckets = createEmptyBuckets();
  for (const [rawKey, value] of Object.entries(input)) {
    if (!Array.isArray(value)) continue;
    const normalizedKey = cityKey(rawKey);
    if (!normalizedKey) continue;
    buckets[normalizedKey] = value.filter(isRecord).map((item) => {
      const cachedItem = item as Partial<CachedHealthPlace> & { type?: unknown };
      const rawType = cachedItem.type as unknown;
      const itemCity = typeof cachedItem.city === "string" && cachedItem.city.trim() ? cachedItem.city : findSupportedCity(rawKey)?.name ?? rawKey;
      const legacyType = rawType === "pharmacy" ? "Pharmacie" : rawType === "clinic" ? "Centre de santé" : rawType;
      const category = cachedItem.category ?? (legacyType === "Pharmacie" ? "pharmacy" : "healthcare");
      return { ...cachedItem, type: legacyType as LocalEstablishmentType, category, city: itemCity } as CachedHealthPlace;
    });
  }
  return buckets;
}

function flattenBuckets(byCity: CacheBuckets) {
  const orderedKeys = SUPPORTED_CITIES.map((city) => cityKey(city.name));
  const ordered = orderedKeys.flatMap((key) => byCity[key] ?? []);
  const supportedKeySet = new Set(orderedKeys);
  const extras = Object.keys(byCity)
    .filter((key) => !supportedKeySet.has(key))
    .sort()
    .flatMap((key) => byCity[key] ?? []);
  return [...ordered, ...extras];
}

function countBuckets(byCity: CacheBuckets) {
  return flattenBuckets(byCity).length;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Requête Overpass des structures de santé (les pharmacies viennent de l'annuaire PharmaGarde). */
export function buildOverpassQuery(city: Pick<SupportedCity, "latitude" | "longitude">, radiusMeters = OSM_RADIUS_METERS) {
  const around = `(around:${radiusMeters},${city.latitude},${city.longitude})`;
  const selectors = [`nwr["amenity"~"^(hospital|clinic|doctors)$"]${around};`, `nwr["healthcare"~"^(hospital|clinic|centre|doctor|health_post)$"]${around};`];
  return `[out:json][timeout:90];(${selectors.join("")});out center tags;`;
}

async function callOverpass(query: string): Promise<OsmElement[]> {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": OSM_USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!response.ok) {
    throw new Error(`Overpass a répondu ${response.status} ${response.statusText}`);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.elements)) {
    throw new Error("Réponse Overpass inattendue : champ elements absent.");
  }
  return payload.elements.filter((element): element is OsmElement => isRecord(element) && typeof element.type === "string" && typeof element.id === "number");
}

export function buildPharmacyBuckets(directory: PharmacyDirectory): CacheBuckets {
  const byCity = createEmptyBuckets();
  for (const pharmacy of directory.pharmacies) {
    const key = cityKey(pharmacy.city);
    (byCity[key] ??= []).push({
      id: pharmacy.id,
      type: "Pharmacie",
      category: "pharmacy",
      name: pharmacy.name,
      address: pharmacy.address,
      city: pharmacy.city,
      phone: pharmacy.phone,
      latitude: pharmacy.latitude,
      longitude: pharmacy.longitude,
      dutyGroup: pharmacy.dutyGroup,
      source: "annuaire",
      updatedAt: directory.updatedAt,
    });
  }
  return byCity;
}

async function fetchOsmHealthcareByCity() {
  const byCity = createEmptyBuckets();
  const errors: string[] = [];
  const category: CachedPlaceCategory = "healthcare";

  // Séquentiel : l'instance Overpass publique limite les requêtes simultanées.
  for (const [index, city] of SUPPORTED_CITIES.entries()) {
    if (index > 0 && OSM_REQUEST_DELAY_MS > 0) await sleep(OSM_REQUEST_DELAY_MS);
    try {
      const elements = await callOverpass(buildOverpassQuery(city));
      const items = elements
        .map((element) => normalizeOsmElement(element, city))
        .filter((item): item is CachedHealthPlace => item !== null && item.category === category);
      byCity[cityKey(city.name)] = dedupePlaces(items);
    } catch (error) {
      errors.push(`${city.name} : ${error instanceof Error ? error.message : "erreur OpenStreetMap inconnue"}`);
    }
  }

  if (countBuckets(byCity) === 0 && errors.length > 0) {
    throw new Error(errors.join(" | "));
  }

  return byCity;
}

async function persistState(kind: CacheKind, state: CacheState) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(fileFor(kind), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function loadState(kind: CacheKind) {
  try {
    const raw = await readFile(fileFor(kind), "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheState> & { version?: number; byCity?: unknown };
    // Version 3 = données OpenStreetMap. Les caches antérieurs (Google Places) sont ignorés.
    if (parsed.version === 3 && parsed.kind === kind && isRecord(parsed.byCity)) {
      memoryCache[kind] = {
        version: 3,
        kind,
        byCity: normalizeBuckets(parsed.byCity),
        updatedAt: parsed.updatedAt ?? null,
        expiresAt: parsed.expiresAt ?? null,
        lastRefreshAttemptAt: parsed.lastRefreshAttemptAt ?? null,
        lastError: parsed.lastError,
      };
      return;
    }
    memoryCache[kind] = createEmptyState(kind);
  } catch {
    memoryCache[kind] = createEmptyState(kind);
  }
}

export async function initializePharmaGardeCache() {
  await Promise.all([loadState("pharmacies"), loadState("healthcare")]);
}

export function getCacheState(kind: CacheKind) {
  return memoryCache[kind];
}

export function isCacheFresh(kind: CacheKind) {
  const expiresAt = memoryCache[kind].expiresAt;
  return !!expiresAt && Date.parse(expiresAt) > Date.now();
}

export async function updateCachedDataset(kind: CacheKind, force = false): Promise<UpdateResult> {
  if (!force && isCacheFresh(kind)) {
    const state = memoryCache[kind];
    return { kind, ok: true, refreshed: false, itemCount: countBuckets(state.byCity), updatedAt: state.updatedAt, expiresAt: state.expiresAt };
  }

  if (refreshLocks[kind]) return refreshLocks[kind];

  refreshLocks[kind] = (async () => {
    const attemptAt = nowIso();
    memoryCache[kind] = { ...memoryCache[kind], lastRefreshAttemptAt: attemptAt };
    try {
      // Pharmacies : annuaire PharmaGarde versionné (server/data/pharmacies.json), sans service
      // tiers. Structures de santé : OpenStreetMap, en attendant un annuaire équivalent.
      const byCity = kind === "pharmacies" ? buildPharmacyBuckets(await loadPharmacyDirectory()) : await fetchOsmHealthcareByCity();
      const updatedAt = nowIso();
      const next: CacheState = {
        version: 3,
        kind,
        byCity,
        updatedAt,
        expiresAt: new Date(Date.now() + ttlFor(kind)).toISOString(),
        lastRefreshAttemptAt: attemptAt,
      };
      memoryCache[kind] = next;
      await persistState(kind, next);
      return { kind, ok: true, refreshed: true, itemCount: countBuckets(byCity), updatedAt: next.updatedAt, expiresAt: next.expiresAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur de chargement des données";
      const fallback = { ...memoryCache[kind], lastRefreshAttemptAt: attemptAt, lastError: message };
      memoryCache[kind] = fallback;
      await persistState(kind, fallback).catch(() => undefined);
      return { kind, ok: false, refreshed: false, itemCount: countBuckets(fallback.byCity), updatedAt: fallback.updatedAt, expiresAt: fallback.expiresAt, error: message };
    } finally {
      delete refreshLocks[kind];
    }
  })();

  return refreshLocks[kind];
}

export function startPharmaGardeSchedulers() {
  if (schedulersStarted) return;
  schedulersStarted = true;

  void updateCachedDataset("pharmacies");
  void updateCachedDataset("healthcare");

  const pharmaciesTimer = setInterval(() => {
    void updateCachedDataset("pharmacies", true);
  }, PHARMACY_TTL_MS);

  const healthcareTimer = setInterval(() => {
    void updateCachedDataset("healthcare", true);
  }, HEALTHCARE_TTL_MS);

  maybeUnrefTimer(pharmaciesTimer);
  maybeUnrefTimer(healthcareTimer);
}

function maybeUnrefTimer(timer: ReturnType<typeof setInterval>) {
  const candidate = timer as unknown as { unref?: () => void };
  candidate.unref?.();
}

function withCacheHeaders(req: Request, res: Response, kind: CacheKind) {
  applyCorsHeaders(req, res);
  const state = memoryCache[kind];
  // La réponse dépend de l'abonnement de l'appelant (3 résultats ou liste complète) : elle ne doit
  // pas être partagée par un cache intermédiaire entre utilisateurs.
  // Le statut (de garde, ouvert, fermé) dépend de l'heure : réponse réutilisable une minute au plus.
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("Vary", "Origin, Authorization, Cookie");
  if (state.updatedAt) res.setHeader("Last-Modified", new Date(state.updatedAt).toUTCString());
  if (state.expiresAt) res.setHeader("X-PharmaGarde-Cache-Expires-At", state.expiresAt);
  res.setHeader("X-PharmaGarde-Cache-Source", "server-local-cache-by-city");
}

function selectItemsByCity(state: CacheState, cityFilter: RequestedCityFilter) {
  if (cityFilter.key) return state.byCity[cityFilter.key] ?? [];
  return flattenBuckets(state.byCity);
}

/**
 * Liste publique d'une ville (ou de toutes), surcharges de la console d'administration appliquées.
 * Un élément non modifié reste rattaché à son compartiment de ville ; un élément modifié suit la
 * ville saisie dans la console.
 */
async function selectPublishedItems(kind: CacheKind, cityFilter: RequestedCityFilter) {
  const state = memoryCache[kind];
  const overrides = await getDirectoryOverrides();
  if (overrides.length === 0) return { items: selectItemsByCity(state, cityFilter), total: countBuckets(state.byCity) };

  const merged = applyDirectoryOverrides(flattenBuckets(state.byCity), overrides, kind === "pharmacies" ? "pharmacy" : "healthcare");
  if (!cityFilter.key) return { items: merged, total: merged.length };

  const overriddenIds = new Set(overrides.map((override) => override.id));
  const bucketKeyById = new Map<string, string>();
  for (const [key, items] of Object.entries(state.byCity)) {
    for (const item of items) bucketKeyById.set(item.id, key);
  }
  const items = merged.filter((item) => (overriddenIds.has(item.id) ? cityKey(item.city) : bucketKeyById.get(item.id)) === cityFilter.key);
  return { items, total: merged.length };
}

function getRequestedPosition(req: Request) {
  const latitude = Number(req.query?.lat ?? req.query?.latitude);
  const longitude = Number(req.query?.lng ?? req.query?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

export function sortByDistanceFrom(items: CachedHealthPlace[], position: { latitude: number; longitude: number } | null) {
  if (!position) return items;
  const distanceOf = (item: CachedHealthPlace) =>
    item.latitude !== undefined && item.longitude !== undefined ? distanceKm(position, { latitude: item.latitude, longitude: item.longitude }) : Number.POSITIVE_INFINITY;
  return items
    .map((item) => ({ item, distance: distanceOf(item) }))
    .sort((a, b) => a.distance - b.distance)
    .map(({ item }) => item);
}

export type PublishedPlace = CachedHealthPlace & {
  /** Pharmacie de garde cette semaine, selon la programmation de sa ville (server/duty-roster.ts). */
  onDuty?: boolean;
  dutyStart?: string;
  dutyEnd?: string;
  /** Horaires propres à l'établissement (sinon horaires de la ville). */
  customHours?: boolean;
  status?: "on_duty" | "open" | "closed";
};

/** Ajoute le statut de garde aux pharmacies des villes qui ont une programmation. */
export function withDutyStatus(items: readonly CachedHealthPlace[], at: Date = new Date(), duty: DutyConfig = currentDutyConfig()): PublishedPlace[] {
  return items.map((item) => {
    if (item.category !== "pharmacy") return item;
    const status = dutyStatusAt(item, at, duty.rotations, duty.exceptions);
    if (!status) return item;
    return status.onDuty ? { ...item, onDuty: true, dutyStart: status.week.start.toISOString(), dutyEnd: status.week.end.toISOString() } : { ...item, onDuty: false };
  });
}

/**
 * Statut de service de chaque établissement : « de garde » (pharmacie de garde, ouverte 24 h/24),
 * sinon ouvert ou fermé selon ses horaires propres ou, à défaut, ceux de sa ville.
 */
export function withServiceStatus(items: readonly CachedHealthPlace[], at: Date, hoursFor: (city: string | undefined) => WeeklyHours, duty: DutyConfig = currentDutyConfig()): PublishedPlace[] {
  return withDutyStatus(items, at, duty).map((item) => {
    const hours = item.serviceHours ?? hoursFor(item.city);
    const onDuty = item.onDuty === true;
    const isOpen = onDuty || isOpenAt(hours, at);
    return {
      ...item,
      serviceHours: hours,
      customHours: !!item.serviceHours,
      openingHours: formatWeeklyHours(hours),
      isOpen,
      status: onDuty ? "on_duty" : isOpen ? "open" : "closed",
    };
  });
}

/**
 * Établissements en service en premier (de garde ou ouverts, sans distinction), l'ordre par distance
 * étant conservé à l'intérieur de chaque bloc : le plus proche en service passe devant.
 */
export function sortInServiceFirst<T extends { onDuty?: boolean; isOpen?: boolean }>(items: readonly T[]): T[] {
  const inService = (item: T) => item.onDuty === true || item.isOpen === true;
  return [...items.filter(inService), ...items.filter((item) => !inService(item))];
}

function dutyMeta(cityFilter: RequestedCityFilter, at: Date, duty: DutyConfig = currentDutyConfig()) {
  const rotations = cityFilter.rawCity ? [findDutyRotation(cityFilter.supportedCity?.name ?? cityFilter.rawCity, duty.rotations)].filter((rotation) => !!rotation) : duty.rotations;
  return rotations.map((rotation) => {
    const week = dutyWeekAt(rotation, at);
    return { city: week.city, label: week.turn.label, dutyGroup: week.turn.dutyGroup ?? null, start: week.start.toISOString(), end: week.end.toISOString() };
  });
}

function wantsOnDutyOnly(req: Request) {
  const value = req.query?.onDuty ?? req.query?.garde;
  return value === "1" || value === "true";
}

async function getPremiumAccessFromRequest(req: Request) {
  const user = await getAuthenticatedDbUser(req);
  return getPremiumStatusForUser(user ?? null).isPremium;
}

async function sendCachedDataset(req: Request, res: Response, kind: CacheKind, rootKey: "pharmacies" | "healthcare" | "cliniques") {
  const state = memoryCache[kind];
  const cityFilter = getRequestedCityFilter(req);
  // Tri par distance depuis la position envoyée par l'app, avant la limite gratuite : un
  // utilisateur sans abonnement reçoit les 3 lieux les plus proches, pas les 3 premiers de la liste.
  // Les établissements en service passent devant (avant la limite gratuite) ; pour les pharmacies,
  // `?onDuty=1` ne renvoie que celles de garde.
  const published = await selectPublishedItems(kind, cityFilter);
  const now = new Date();
  const hoursFor = await getCityHoursLookup();
  const duty = await getDutyConfig();
  const byDistance: PublishedPlace[] = sortByDistanceFrom(withServiceStatus(published.items, now, hoursFor, duty), getRequestedPosition(req));
  const allItems = kind === "pharmacies" && wantsOnDutyOnly(req) ? byDistance.filter((item) => item.onDuty === true) : sortInServiceFirst(byDistance);
  const isPremium = await getPremiumAccessFromRequest(req);
  const items = isPremium ? allItems : allItems.slice(0, PREMIUM_RESULT_LIMIT);
  const responseCity = cityFilter.supportedCity?.name ?? cityFilter.rawCity ?? null;

  console.info(`[PharmaGardeCache] ${kind}: ville demandée=${responseCity ?? "toutes"}, premium=${isPremium}, résultats retournés=${items.length}/${allItems.length}`);

  withCacheHeaders(req, res, kind);
  res.setHeader("X-PharmaGarde-Premium", isPremium ? "true" : "false");
  if (!isPremium) res.setHeader("X-PharmaGarde-Free-Limit", String(PREMIUM_RESULT_LIMIT));
  res.json({
    [rootKey]: items,
    data: items,
    meta: {
      cache: "server-local-cache-by-city",
      source: kind === "pharmacies" ? "annuaire" : "openstreetmap",
      attribution: kind === "pharmacies" ? PHARMACY_DIRECTORY_ATTRIBUTION : OSM_ATTRIBUTION,
      kind,
      city: responseCity,
      cityKey: cityFilter.key ?? null,
      supportedCities: SUPPORTED_CITIES.map((city) => city.name),
      itemCount: items.length,
      totalItemCount: published.total,
      premiumRequiredForFullResults: !isPremium,
      freeResultLimit: isPremium ? null : PREMIUM_RESULT_LIMIT,
      updatedAt: state.updatedAt,
      expiresAt: state.expiresAt,
      stale: !isCacheFresh(kind),
      ...(kind === "pharmacies" ? { duty: dutyMeta(cityFilter, now, duty) } : {}),
    },
  });
}

async function sendMedicinesDataset(req: Request, res: Response) {
  const isPremium = await getPremiumAccessFromRequest(req);
  applyCorsHeaders(req, res);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-PharmaGarde-Premium", isPremium ? "true" : "false");
  if (!isPremium) {
    res.status(403).json({ error: "PREMIUM_REQUIRED", message: "Abonnement Premium requis pour consulter les médicaments." });
    return;
  }

  let response: MedicinesResponse;
  try {
    response = getMedicinesResponse();
  } catch (error) {
    console.error("[Médicaments] Catalogue illisible :", error instanceof Error ? error.message : error);
    res.status(503).json({ error: "MEDICINES_UNAVAILABLE", message: "Catalogue des médicaments momentanément indisponible." });
    return;
  }
  res.setHeader("Vary", "Accept-Encoding");
  // Près de 1 800 produits (~650 Ko) : la réponse est envoyée compressée aux clients qui l'acceptent.
  if (/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.end(response.gzip);
    return;
  }
  res.json(response.payload);
}

type MedicinesResponse = { payload: { medicaments: Medicine[]; meta: { premiumRequired: true; itemCount: number; notice: string } }; gzip: Buffer };
let medicinesResponse: MedicinesResponse | null = null;

/** Réponse préparée une seule fois : le catalogue versionné ne change qu'au redéploiement. */
function getMedicinesResponse(): MedicinesResponse {
  if (!medicinesResponse) {
    const medicines = getEssentialMedicines();
    const payload = { medicaments: medicines, meta: { premiumRequired: true as const, itemCount: medicines.length, notice: MEDICINES_NOTICE } };
    medicinesResponse = { payload, gzip: gzipSync(JSON.stringify(payload)) };
  }
  return medicinesResponse;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * S6 : la route d'administration exige PHARMAGARDE_ADMIN_TOKEN dans tous les environnements (sans
 * jeton configuré, elle est fermée) et compare le jeton à temps constant.
 */
export function isAdminRequest(req: { header(name: string): string | undefined }, configuredToken = process.env.PHARMAGARDE_ADMIN_TOKEN?.trim()) {
  if (!configuredToken) return false;
  const authorization = req.header("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  const headerToken = req.header("x-admin-token") ?? "";
  return (bearer.length > 0 && safeEqual(bearer, configuredToken)) || (headerToken.length > 0 && safeEqual(headerToken, configuredToken));
}

export function registerPharmaGardeCacheRoutes(app: Express) {
  app.get("/pharmacies", (req, res) => sendCachedDataset(req, res, "pharmacies", "pharmacies"));
  app.get("/pharmacies/nearby", (req, res) => sendCachedDataset(req, res, "pharmacies", "pharmacies"));

  app.get("/healthcare", (req, res) => sendCachedDataset(req, res, "healthcare", "healthcare"));
  app.get("/cliniques/nearby", (req, res) => sendCachedDataset(req, res, "healthcare", "cliniques"));
  app.get("/medicaments", (req, res) => sendMedicinesDataset(req, res));
  app.get("/medicines", (req, res) => sendMedicinesDataset(req, res));

  // Route déclarée avant le parseur JSON global : on parse ici pour lire `kind` (B7).
  app.post("/admin/update-data", express.json({ limit: "10kb" }), async (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(401).json({ ok: false, error: "ADMIN_TOKEN_REQUIRED" });
      return;
    }

    const body = isRecord(req.body) ? req.body : {};
    const requestedKind = body.kind === "pharmacies" || body.kind === "healthcare" ? body.kind : "all";
    const kinds: CacheKind[] = requestedKind === "all" ? ["pharmacies", "healthcare"] : [requestedKind];
    const results = await Promise.all(kinds.map((kind) => updateCachedDataset(kind, true)));
    res.json({ ok: results.every((item) => item.ok), results });
  });
}
