import type { Express, Request, Response } from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { applyCorsHeaders } from "./_core/security";
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
  openingHours?: Record<string, unknown>;
  businessStatus?: string;
  source?: "google" | "local";
  googlePlaceId?: string;
  googlePlaceTypes?: string[];
  googlePrimaryType?: string;
  collectionQuery?: string;
  collectionMethod?: "textsearch" | "nearbysearch";
  updatedAt?: string;
};

type CacheBuckets = Record<string, CachedHealthPlace[]>;

type CacheState = {
  version: 2;
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

type SearchPoint = SupportedCity & { zone: "centre" | "nord" | "sud" | "est" | "ouest" };

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
const DEFAULT_RADIUS_METERS = 15000;
const GOOGLE_PAGE_DELAY_MS = Number(process.env.PHARMAGARDE_GOOGLE_PAGE_DELAY_MS ?? 2000);
const CACHE_DIR = process.env.PHARMAGARDE_CACHE_DIR ?? path.join(process.cwd(), "server", ".cache");
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
const PREMIUM_RESULT_LIMIT = 3;

const TEXT_SEARCH_TERMS = ["pharmacie", "hôpital", "clinique", "CSPS", "centre médical", "dispensaire"] as const;
const PHARMACY_TEXT_SEARCH_TEMPLATES = [
  "pharmacie à {ville}",
  "pharmacy in {ville}",
  "dépôt pharmaceutique à {ville}",
  "médicament à {ville}",
  "pharmacie de garde à {ville}",
] as const;
const NEARBY_SEARCH_TYPES = ["pharmacy", "hospital", "doctor"] as const;
const PHARMACY_NEARBY_SEARCH_TYPE = "pharmacy" as const;
const PHARMACY_ZONE_OFFSET_KM = Number(process.env.PHARMAGARDE_PHARMACY_ZONE_OFFSET_KM ?? 7);
const MEDICAL_NAME_TERMS = ["pharmacie", "pharmacy", "hopital", "hospital", "clinique", "clinic", "csps", "chu", "chr", "cma", "centre medical", "centre de sante", "dispensaire", "medical", "sante", "health"];
const NON_MEDICAL_NAME_TERMS = ["veterinaire", "vétérinaire", "animal", "boutique", "supermarche", "supermarché", "hotel", "hôtel", "restaurant", "bar", "ecole", "école"];

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
    version: 2,
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

function getString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function getNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function getStringArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
      if (strings.length > 0) return strings;
    }
    if (typeof value === "string" && value.trim()) {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return undefined;
}

function mergeRecords(primary: Record<string, unknown>, secondary?: Record<string, unknown>) {
  return secondary ? ({ ...primary, ...secondary } as Record<string, unknown>) : primary;
}

function selectGooglePrimaryType(types?: string[]) {
  if (!types?.length) return undefined;
  const genericTypes = new Set(["establishment", "point_of_interest", "health"]);
  return types.find((type) => !genericTypes.has(type)) ?? types[0];
}

function classifyPlace(name: string, types: string[] = []): { category: CachedPlaceCategory; type: LocalEstablishmentType } {
  const normalizedName = normalizeCityName(name);
  const normalizedTypes = types.map((type) => type.toLowerCase());
  if (normalizedTypes.includes("pharmacy") || normalizedName.includes("pharmacie") || normalizedName.includes("pharmacy")) return { category: "pharmacy", type: "Pharmacie" };
  if (/\bchu\b/.test(normalizedName)) return { category: "healthcare", type: "CHU" };
  if (/\bchr\b/.test(normalizedName)) return { category: "healthcare", type: "CHR" };
  if (/\bcma\b/.test(normalizedName)) return { category: "healthcare", type: "CMA" };
  if (/\bcsps\b/.test(normalizedName)) return { category: "healthcare", type: "CSPS" };
  if (normalizedName.includes("clinique") || normalizedName.includes("clinic")) return { category: "healthcare", type: "Clinique" };
  if (normalizedTypes.includes("hospital") || normalizedName.includes("hopital") || normalizedName.includes("hospital")) return { category: "healthcare", type: "Hôpital" };
  return { category: "healthcare", type: "Centre de santé" };
}

function hasQualitySignal(raw: Record<string, unknown>) {
  const rating = getNumber(raw, ["rating"]);
  const userRatingsTotal = getNumber(raw, ["user_ratings_total", "userRatingsTotal"]);
  const phone = getString(raw, ["international_phone_number", "formatted_phone_number", "phone", "telephone"]);
  const businessStatus = getString(raw, ["business_status", "businessStatus"]);
  return (rating !== undefined && rating >= 2) || (userRatingsTotal !== undefined && userRatingsTotal >= 1) || !!phone || businessStatus === "OPERATIONAL";
}

function isPharmacyCandidate(name: string, types: string[] = []) {
  const normalizedName = normalizeCityName(name);
  const normalizedTypes = types.map((type) => type.toLowerCase());
  return normalizedTypes.includes("pharmacy") || normalizedName.includes("pharmacie") || normalizedName.includes("pharmacy");
}

function isClearlyMedical(name: string, types: string[] = []) {
  const normalizedName = normalizeCityName(name);
  if (NON_MEDICAL_NAME_TERMS.some((term) => normalizedName.includes(normalizeCityName(term)))) return false;
  const normalizedTypes = types.map((type) => type.toLowerCase());
  if (normalizedTypes.some((type) => ["pharmacy", "hospital", "doctor", "health"].includes(type))) return true;
  return MEDICAL_NAME_TERMS.some((term) => normalizedName.includes(normalizeCityName(term)));
}

function buildSearchPoints(city: SupportedCity): SearchPoint[] {
  const latitudeDelta = PHARMACY_ZONE_OFFSET_KM / 111;
  const longitudeDelta = PHARMACY_ZONE_OFFSET_KM / (111 * Math.max(Math.cos((city.latitude * Math.PI) / 180), 0.2));
  return [
    { ...city, zone: "centre" },
    { ...city, latitude: city.latitude + latitudeDelta, zone: "nord" },
    { ...city, latitude: city.latitude - latitudeDelta, zone: "sud" },
    { ...city, longitude: city.longitude + longitudeDelta, zone: "est" },
    { ...city, longitude: city.longitude - longitudeDelta, zone: "ouest" },
  ];
}

function buildPharmacyTextSearchQueries(city: SupportedCity) {
  return PHARMACY_TEXT_SEARCH_TEMPLATES.map((template) => template.replace("{ville}", city.name));
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

function normalizeOpeningHours(raw: Record<string, unknown>) {
  const openingHours = raw.opening_hours;
  return isRecord(openingHours) ? openingHours : undefined;
}

function normalizeGooglePlace(rawBase: Record<string, unknown>, city: SupportedCity, index: number, options?: { collectionQuery?: string; collectionMethod?: "textsearch" | "nearbysearch"; targetKind?: CacheKind }): CachedHealthPlace | null {
  const raw = rawBase;
  const geometry = isRecord(raw.geometry) ? raw.geometry : undefined;
  const location = geometry && isRecord(geometry.location) ? geometry.location : undefined;
  const placeId = getString(raw, ["place_id", "id"]);
  const name = getString(raw, ["name", "nom", "title"]);
  if (!name) return null;

  const googlePlaceTypes = getStringArray(raw, ["types"]) ?? [];
  if (options?.targetKind === "pharmacies") {
    if (!isPharmacyCandidate(name, googlePlaceTypes)) return null;
  } else {
    if (!isClearlyMedical(name, googlePlaceTypes)) return null;
    if (!hasQualitySignal(raw)) return null;
  }

  const slug = cityKey(city.name);
  const classification = classifyPlace(name, googlePlaceTypes);
  const openingHours = normalizeOpeningHours(raw);
  return {
    id: placeId ?? `${slug}-${classification.category}-${name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}-${index}`,
    type: classification.type,
    category: classification.category,
    name,
    address: getString(raw, ["formatted_address", "vicinity", "address", "adresse"]),
    city: city.name,
    phone: getString(raw, ["international_phone_number", "formatted_phone_number", "phone", "telephone"]),
    rating: getNumber(raw, ["rating", "note", "googleRating", "google_rating", "noteGoogle", "stars"]),
    userRatingsTotal: getNumber(raw, ["user_ratings_total", "userRatingsTotal"]),
    latitude: location ? getNumber(location, ["lat", "latitude"]) : getNumber(raw, ["lat", "latitude"]),
    longitude: location ? getNumber(location, ["lng", "lon", "longitude"]) : getNumber(raw, ["lng", "lon", "longitude"]),
    isOpen: openingHours && typeof openingHours.open_now === "boolean" ? openingHours.open_now : undefined,
    openingHours,
    businessStatus: getString(raw, ["business_status", "businessStatus"]),
    source: "google",
    googlePlaceId: placeId,
    googlePlaceTypes,
    googlePrimaryType: selectGooglePrimaryType(googlePlaceTypes),
    collectionQuery: options?.collectionQuery,
    collectionMethod: options?.collectionMethod,
    updatedAt: nowIso(),
  };
}

function dedupePlaces(items: CachedHealthPlace[]) {
  const seen = new Set<string>();
  const unique: CachedHealthPlace[] = [];
  for (const item of items) {
    const key = `${item.googlePlaceId ?? `${item.category}:${item.name}:${item.latitude ?? ""}:${item.longitude ?? ""}`}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
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

async function callGooglePaged(url: URL): Promise<Record<string, unknown>[]> {
  if (!GOOGLE_API_KEY) {
    throw new Error("GOOGLE_PLACES_API_KEY ou GOOGLE_MAPS_API_KEY non configurée.");
  }

  const results: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    if (pageToken) {
      await sleep(GOOGLE_PAGE_DELAY_MS);
      url.searchParams.set("pagetoken", pageToken);
    }

    const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Google Places a répondu ${response.status} ${response.statusText}`);
    }
    const payload = await response.json();
    if (!isRecord(payload)) break;
    const status = getString(payload, ["status"]);
    if (status && !["OK", "ZERO_RESULTS"].includes(status)) {
      throw new Error(`Google Places status=${status}${getString(payload, ["error_message"]) ? `: ${getString(payload, ["error_message"])}` : ""}`);
    }
    if (Array.isArray(payload.results)) results.push(...payload.results.filter(isRecord));
    const nextPageToken = getString(payload, ["next_page_token"]);
    if (!nextPageToken || status === "ZERO_RESULTS") break;
    pageToken = nextPageToken;
  }
  return results;
}

async function callGoogleTextSearch(point: Pick<SupportedCity, "latitude" | "longitude">, query: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("query", `${query} Burkina Faso`);
  url.searchParams.set("location", `${point.latitude},${point.longitude}`);
  url.searchParams.set("radius", String(Number(process.env.PHARMAGARDE_GOOGLE_RADIUS_METERS ?? DEFAULT_RADIUS_METERS)));
  url.searchParams.set("language", "fr");
  url.searchParams.set("region", "bf");
  return callGooglePaged(url);
}

async function callGoogleNearby(point: Pick<SupportedCity, "latitude" | "longitude">, type: (typeof NEARBY_SEARCH_TYPES)[number] | typeof PHARMACY_NEARBY_SEARCH_TYPE) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("location", `${point.latitude},${point.longitude}`);
  url.searchParams.set("radius", String(Number(process.env.PHARMAGARDE_GOOGLE_RADIUS_METERS ?? DEFAULT_RADIUS_METERS)));
  url.searchParams.set("type", type);
  url.searchParams.set("language", "fr");
  return callGooglePaged(url);
}

async function callGoogleDetails(placeId: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("language", "fr");
  url.searchParams.set("fields", "name,place_id,types,formatted_address,geometry,rating,user_ratings_total,international_phone_number,formatted_phone_number,opening_hours,business_status");

  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Google Place Details a répondu ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  if (!isRecord(payload)) return undefined;
  const status = getString(payload, ["status"]);
  if (status && !["OK", "ZERO_RESULTS", "NOT_FOUND"].includes(status)) {
    throw new Error(`Google Place Details status=${status}${getString(payload, ["error_message"]) ? `: ${getString(payload, ["error_message"])}` : ""}`);
  }
  return isRecord(payload.result) ? payload.result : undefined;
}

async function enrichPlacesWithDetails(items: Record<string, unknown>[]) {
  const byPlaceId = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const placeId = getString(item, ["place_id", "id"]);
    if (placeId && !byPlaceId.has(placeId)) byPlaceId.set(placeId, item);
  }

  const enriched: Record<string, unknown>[] = [];
  for (const item of byPlaceId.values()) {
    const placeId = getString(item, ["place_id", "id"]);
    if (!placeId) {
      enriched.push(item);
      continue;
    }
    const details = await callGoogleDetails(placeId).catch(() => undefined);
    enriched.push(mergeRecords(item, details));
  }
  return enriched;
}

async function fetchGoogleItemsForCity(city: SupportedCity, kind: CacheKind) {
  const rawItems: Record<string, unknown>[] = [];
  const queryByPlaceId = new Map<string, { collectionQuery: string; collectionMethod: "textsearch" | "nearbysearch"; targetKind: CacheKind }>();

  if (kind === "pharmacies") {
    const points = buildSearchPoints(city);
    for (const point of points) {
      for (const query of buildPharmacyTextSearchQueries(city)) {
        const results = await callGoogleTextSearch(point, query);
        rawItems.push(...results);
        for (const result of results) {
          const placeId = getString(result, ["place_id", "id"]);
          if (placeId && !queryByPlaceId.has(placeId)) queryByPlaceId.set(placeId, { collectionQuery: `${point.zone}:${query}`, collectionMethod: "textsearch", targetKind: kind });
        }
      }

      const nearbyResults = await callGoogleNearby(point, PHARMACY_NEARBY_SEARCH_TYPE);
      rawItems.push(...nearbyResults);
      for (const result of nearbyResults) {
        const placeId = getString(result, ["place_id", "id"]);
        if (placeId && !queryByPlaceId.has(placeId)) queryByPlaceId.set(placeId, { collectionQuery: `${point.zone}:nearby:${PHARMACY_NEARBY_SEARCH_TYPE}`, collectionMethod: "nearbysearch", targetKind: kind });
      }
    }
  } else {
    for (const term of TEXT_SEARCH_TERMS) {
      const query = `${term} à ${city.name}`;
      const results = await callGoogleTextSearch(city, query);
      rawItems.push(...results);
      for (const result of results) {
        const placeId = getString(result, ["place_id", "id"]);
        if (placeId && !queryByPlaceId.has(placeId)) queryByPlaceId.set(placeId, { collectionQuery: query, collectionMethod: "textsearch", targetKind: kind });
      }
    }

    for (const nearbyType of NEARBY_SEARCH_TYPES) {
      const results = await callGoogleNearby(city, nearbyType);
      rawItems.push(...results);
      for (const result of results) {
        const placeId = getString(result, ["place_id", "id"]);
        if (placeId && !queryByPlaceId.has(placeId)) queryByPlaceId.set(placeId, { collectionQuery: `nearby:${nearbyType}`, collectionMethod: "nearbysearch", targetKind: kind });
      }
    }
  }

  const enrichedItems = await enrichPlacesWithDetails(rawItems);
  return enrichedItems.map((item, index) => {
    const placeId = getString(item, ["place_id", "id"]);
    return normalizeGooglePlace(item, city, index, placeId ? queryByPlaceId.get(placeId) : { targetKind: kind });
  }).filter((item): item is CachedHealthPlace => item !== null);
}

async function fetchGoogleItemsByCity(kind: CacheKind) {
  const settled = await Promise.allSettled(
    SUPPORTED_CITIES.map(async (city) => {
      const allItems = dedupePlaces(await fetchGoogleItemsForCity(city, kind));
      const category = kind === "pharmacies" ? "pharmacy" : "healthcare";
      return { city, items: allItems.filter((item) => item.category === category) };
    }),
  );
  const byCity = createEmptyBuckets();
  const errors: string[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      byCity[cityKey(result.value.city.name)] = result.value.items.map((item) => ({ ...item, city: result.value.city.name }));
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : "Erreur Google API inconnue");
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
    if (parsed.version === 2 && parsed.kind === kind && isRecord(parsed.byCity)) {
      memoryCache[kind] = {
        version: 2,
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
      const byCity = await fetchGoogleItemsByCity(kind);
      const updatedAt = nowIso();
      const next: CacheState = {
        version: 2,
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
      const message = error instanceof Error ? error.message : "Erreur Google API inconnue";
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
  res.setHeader("Cache-Control", kind === "pharmacies" ? "public, max-age=300, stale-while-revalidate=86400" : "public, max-age=1800, stale-while-revalidate=604800");
  if (state.updatedAt) res.setHeader("Last-Modified", new Date(state.updatedAt).toUTCString());
  if (state.expiresAt) res.setHeader("X-PharmaGarde-Cache-Expires-At", state.expiresAt);
  res.setHeader("X-PharmaGarde-Cache-Source", "server-local-cache-by-city");
}

function selectItemsByCity(state: CacheState, cityFilter: RequestedCityFilter) {
  if (cityFilter.key) return state.byCity[cityFilter.key] ?? [];
  return flattenBuckets(state.byCity);
}

async function getPremiumAccessFromRequest(req: Request) {
  const user = await getAuthenticatedDbUser(req);
  return getPremiumStatusForUser(user ?? null).isPremium;
}

async function sendCachedDataset(req: Request, res: Response, kind: CacheKind, rootKey: "pharmacies" | "healthcare" | "cliniques") {
  const state = memoryCache[kind];
  const cityFilter = getRequestedCityFilter(req);
  const allItems = selectItemsByCity(state, cityFilter);
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
      kind,
      city: responseCity,
      cityKey: cityFilter.key ?? null,
      supportedCities: SUPPORTED_CITIES.map((city) => city.name),
      itemCount: items.length,
      unrestrictedItemCount: allItems.length,
      totalItemCount: countBuckets(state.byCity),
      premiumRequiredForFullResults: !isPremium,
      freeResultLimit: isPremium ? null : PREMIUM_RESULT_LIMIT,
      updatedAt: state.updatedAt,
      expiresAt: state.expiresAt,
      stale: !isCacheFresh(kind),
      lastError: state.lastError,
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

  res.json({
    medicaments: [],
    medicines: [],
    data: [],
    meta: { premiumRequired: true, itemCount: 0 },
  });
}

function isAdminRequest(req: Request) {
  const configuredToken = process.env.PHARMAGARDE_ADMIN_TOKEN;
  if (!configuredToken) return process.env.NODE_ENV !== "production";
  const header = req.header("authorization") ?? "";
  return header === `Bearer ${configuredToken}` || req.header("x-admin-token") === configuredToken;
}

export function registerPharmaGardeCacheRoutes(app: Express) {
  app.get("/pharmacies", (req, res) => sendCachedDataset(req, res, "pharmacies", "pharmacies"));
  app.get("/pharmacies/nearby", (req, res) => sendCachedDataset(req, res, "pharmacies", "pharmacies"));

  app.get("/healthcare", (req, res) => sendCachedDataset(req, res, "healthcare", "healthcare"));
  app.get("/cliniques/nearby", (req, res) => sendCachedDataset(req, res, "healthcare", "cliniques"));
  app.get("/medicaments", (req, res) => sendMedicinesDataset(req, res));
  app.get("/medicines", (req, res) => sendMedicinesDataset(req, res));

  app.post("/admin/update-data", async (req, res) => {
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
