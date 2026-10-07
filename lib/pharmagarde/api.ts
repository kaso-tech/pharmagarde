import AsyncStorage from "@react-native-async-storage/async-storage";

import { Coordinates, HealthPlace, Medicine } from "./types";
import { normalizeCityName } from "./city-utils";
import { normalizeInsurerIds } from "./insurances";
import { parseWeeklyHours } from "./opening-hours";

const DEFAULT_TIMEOUT_MS = 12000;
// v3 : les réponses antérieures aux statuts (garde, ouvert, fermé) sont ignorées. Le cache frais est
// court car la garde et les horaires changent ; hors connexion, la dernière réponse reste utilisée.
const CLIENT_CACHE_PREFIX = "pharmagarde:api-cache:v3:";
const CLIENT_CACHE_TTL_MS: Record<"pharmacies" | "clinics" | "medicines", number> = {
  pharmacies: 5 * 60 * 1000,
  clinics: 30 * 60 * 1000,
  medicines: 24 * 60 * 60 * 1000,
};

type CachedPayload = {
  storedAt: number;
  expiresAt: number;
  payload: unknown;
};

const memoryPayloadCache = new Map<string, CachedPayload>();

function normalizeBaseUrl(value?: string | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

function getDefaultApiBaseUrl() {
  const configured = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? "");
  if (configured) return configured;

  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname, origin } = window.location;
    const previewApiHostname = hostname.replace(/^8081-/, "3000-");
    if (previewApiHostname !== hostname) return normalizeBaseUrl(`${protocol}//${previewApiHostname}`);
    return normalizeBaseUrl(origin);
  }

  return "";
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

function getBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.toLowerCase();
      if (["true", "1", "open", "ouvert", "yes"].includes(normalized)) return true;
      if (["false", "0", "closed", "fermé", "non"].includes(normalized)) return false;
    }
  }
  return undefined;
}

function asRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const possibleArrays = [record.data, record.items, record.results, record.pharmacies, record.healthcare, record.cliniques, record.clinics, record.medicaments, record.medicines];
    for (const value of possibleArrays) {
      if (Array.isArray(value)) return asRecords(value);
    }
  }
  return [];
}

function normalizePlace(raw: Record<string, unknown>, type: "pharmacy" | "clinic", index: number): HealthPlace | null {
  const name = getString(raw, ["name", "nom", "title", "libelle", "label", "raisonSociale"]);
  const id = getString(raw, ["id", "uuid", "_id", "code", "slug", "osmId"]) ?? (name ? `${type}-${name}-${index}` : undefined);
  if (!id || !name) return null;
  return {
    id,
    type,
    name,
    address: getString(raw, ["address", "adresse", "location", "quartier", "descriptionAdresse"]),
    city: getString(raw, ["city", "ville", "commune"]),
    phone: getString(raw, ["phone", "telephone", "tel", "mobile", "contact", "formatted_phone_number", "international_phone_number"]),
    rating: getNumber(raw, ["rating", "note", "googleRating", "google_rating", "noteGoogle", "stars"]),
    distanceKm: getNumber(raw, ["distanceKm", "distance_km", "distance", "distanceInKm"]),
    latitude: getNumber(raw, ["latitude", "lat"]),
    longitude: getNumber(raw, ["longitude", "lng", "lon"]),
    isOpen: getBoolean(raw, ["isOpen", "open", "ouvert"]),
    establishmentType: getString(raw, ["establishmentType", "establishment_type", "typeEtablissement", "type_etablissement", "localType", "local_type", "type"]),
    openingHours: getString(raw, ["openingHours", "opening_hours", "horaires"]),
    dutyGroup: getNumber(raw, ["dutyGroup", "groupe", "groupeGarde"]),
    onDuty: getBoolean(raw, ["onDuty", "garde"]),
    dutyStart: getString(raw, ["dutyStart"]),
    dutyEnd: getString(raw, ["dutyEnd"]),
    serviceHours: parseWeeklyHours(raw.serviceHours) ?? undefined,
    insurances: normalizeInsurerIds(raw.insurances),
  };
}

function normalizeMedicine(raw: Record<string, unknown>, index: number): Medicine | null {
  const name = getString(raw, ["name", "nom", "title", "libelle", "designation"]);
  const id = getString(raw, ["id", "uuid", "_id", "code", "slug"]) ?? (name ? `medicine-${name}-${index}` : undefined);
  if (!id || !name) return null;
  return {
    id,
    type: "medicine",
    name,
    category: getString(raw, ["category", "categorie", "classe", "famille"]),
    ageCategory: getString(raw, ["ageCategory", "age_category", "trancheAge"]) as Medicine["ageCategory"],
    pharmaceuticalType: getString(raw, ["pharmaceuticalType", "pharmaceutical_type", "forme", "form", "dosageForm"]),
    priceApprox: getNumber(raw, ["priceApprox", "price_approx", "prix", "price"]),
    description: getString(raw, ["description", "details", "indication"]),
    imageUrl: getString(raw, ["imageUrl", "image", "photo", "thumbnail", "picture"]),
  };
}

function getDatasetKind(path: string): "pharmacies" | "clinics" | "medicines" | null {
  if (path.includes("pharmacies")) return "pharmacies";
  if (path.includes("cliniques") || path.includes("clinics") || path.includes("healthcare")) return "clinics";
  if (path.includes("medicaments") || path.includes("medicines")) return "medicines";
  return null;
}

function requireCityForDataset(path: string, city?: string) {
  const datasetKind = getDatasetKind(path);
  if ((datasetKind === "pharmacies" || datasetKind === "clinics") && !city?.trim()) {
    throw new Error(`CITY_PARAM_REQUIRED:${path.startsWith("/") ? path : `/${path}`}`);
  }
  return city?.trim() ? normalizeCityName(city) : undefined;
}

function logApiExchange(datasetKind: "pharmacies" | "clinics" | "medicines" | null, stage: "request" | "response" | "cache" | "stale", details: Record<string, unknown>) {
  if (datasetKind !== "pharmacies" && datasetKind !== "clinics") return;
  const label = datasetKind === "pharmacies" ? "pharmacies" : "healthcare";
  console.info(`[PharmaGarde API] ${label} ${stage}`, details);
}

function buildCacheKey(baseUrl: string, path: string, coordinates?: Coordinates, city?: string) {
  const locationSuffix = coordinates ? `:${coordinates.latitude.toFixed(3)},${coordinates.longitude.toFixed(3)}` : "";
  const citySuffix = city?.trim() ? `:city=${city.trim().toLowerCase()}` : "";
  return `${CLIENT_CACHE_PREFIX}${normalizeBaseUrl(baseUrl)}:${path.startsWith("/") ? path : `/${path}`}${locationSuffix}${citySuffix}`;
}

async function readCachedPayload(cacheKey: string) {
  const memoryEntry = memoryPayloadCache.get(cacheKey);
  if (memoryEntry && memoryEntry.expiresAt > Date.now()) return memoryEntry.payload;

  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (parsed.expiresAt > Date.now()) {
      memoryPayloadCache.set(cacheKey, parsed);
      return parsed.payload;
    }
  } catch {
    return null;
  }
  return null;
}

async function writeCachedPayload(cacheKey: string, payload: unknown, ttlMs: number) {
  const entry: CachedPayload = { storedAt: Date.now(), expiresAt: Date.now() + ttlMs, payload };
  memoryPayloadCache.set(cacheKey, entry);
  try {
    await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch {
    // Le cache local ne doit jamais bloquer l’expérience mobile.
  }
}

async function readStalePayload(cacheKey: string) {
  const memoryEntry = memoryPayloadCache.get(cacheKey);
  if (memoryEntry) return memoryEntry.payload;

  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    memoryPayloadCache.set(cacheKey, parsed);
    return parsed.payload;
  } catch {
    return null;
  }
}

/**
 * Options d'accès aux données protégées par l'abonnement : le jeton de session est transmis pour
 * que le serveur applique les droits Premium, et la variante sépare dans le cache local les
 * réponses gratuites (3 résultats) des réponses complètes.
 */
export type DatasetRequestOptions = {
  authHeaders?: Record<string, string>;
  cacheVariant?: string;
};

async function requestJson(baseUrl: string, path: string, coordinates?: Coordinates, city?: string, options: DatasetRequestOptions & { cache?: boolean } = {}) {
  const requiredCity = requireCityForDataset(path, city);
  const cleanBase = normalizeBaseUrl(baseUrl);
  if (!cleanBase) {
    throw new Error("API_BASE_URL_NON_CONFIGUREE");
  }

  const datasetKind = getDatasetKind(path);
  const useCache = options.cache !== false;
  const cacheKey = datasetKind && useCache ? `${buildCacheKey(cleanBase, path, coordinates, requiredCity)}${options.cacheVariant ? `:${options.cacheVariant}` : ""}` : null;
  if (cacheKey) {
    const cached = await readCachedPayload(cacheKey);
    if (cached) {
      logApiExchange(datasetKind, "cache", { path, city: requiredCity, cacheKey });
      return cached;
    }
  }

  const url = new URL(`${cleanBase}${path.startsWith("/") ? path : `/${path}`}`);
  if (coordinates) {
    url.searchParams.set("lat", String(coordinates.latitude));
    url.searchParams.set("lng", String(coordinates.longitude));
    url.searchParams.set("latitude", String(coordinates.latitude));
    url.searchParams.set("longitude", String(coordinates.longitude));
  }
  if (requiredCity) {
    url.searchParams.set("city", requiredCity);
  }

  logApiExchange(datasetKind, "request", { path: url.pathname, city: requiredCity, url: url.toString() });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json", ...(options.authHeaders ?? {}) },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Erreur API ${response.status}`);
    }
    const payload = await response.json();
    logApiExchange(datasetKind, "response", { path: url.pathname, city: requiredCity, itemCount: asRecords(payload).length, payload });
    if (cacheKey && datasetKind) {
      await writeCachedPayload(cacheKey, payload, CLIENT_CACHE_TTL_MS[datasetKind]);
    }
    return payload;
  } catch (error) {
    if (cacheKey) {
      const stalePayload = await readStalePayload(cacheKey);
      if (stalePayload) {
        logApiExchange(datasetKind, "stale", { path, city: requiredCity, itemCount: asRecords(stalePayload).length });
        return stalePayload;
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPharmacies(baseUrl: string, coordinates?: Coordinates, city?: string, options: DatasetRequestOptions = {}) {
  const selectedCity = requireCityForDataset("/pharmacies", city);
  const payload = await requestJson(baseUrl, "/pharmacies", coordinates, selectedCity, options);
  return asRecords(payload).map((item, index) => normalizePlace(item, "pharmacy", index)).filter((item): item is HealthPlace => item !== null);
}

export async function fetchClinics(baseUrl: string, coordinates?: Coordinates, city?: string, options: DatasetRequestOptions = {}) {
  const selectedCity = requireCityForDataset("/healthcare", city);
  const payload = await requestJson(baseUrl, "/healthcare", coordinates, selectedCity, options);
  return asRecords(payload).map((item, index) => normalizePlace(item, "clinic", index)).filter((item): item is HealthPlace => item !== null);
}

export async function fetchMedicines(baseUrl: string, options: DatasetRequestOptions = {}) {
  // Catalogue réservé aux abonnés : jamais mis en cache local, pour qu'un abonnement expiré ne
  // laisse pas la liste disponible hors ligne.
  const payload = await requestJson(baseUrl, "/medicaments", undefined, undefined, { ...options, cache: false });
  return asRecords(payload).map((item, index) => normalizeMedicine(item, index)).filter((item): item is Medicine => item !== null);
}

export { getDefaultApiBaseUrl, normalizeBaseUrl };
