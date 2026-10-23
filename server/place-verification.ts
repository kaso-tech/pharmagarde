import { distanceKm } from "../lib/pharmagarde/city-utils";
import type { PlaceVerificationRow } from "../drizzle/schema";
import { DUPLICATE_DISTANCE_METERS, POSITION_GAP_METERS, VERIFICATION_ISSUES, type VerificationIssue, type VerificationStatus } from "../shared/place-verification";
import { cityMatchKey, type AdminDirectoryItem } from "./admin-directory";
import { healthcareNameCore, wordOverlap } from "./healthcare-match";
import type { CachedHealthPlace } from "./pharmagarde-cache";

// Analyse de l'annuaire pour la vérification des établissements une à une dans la console :
// problèmes de chaque fiche, positions concurrentes (OpenStreetMap) et voisins immédiats.

export type PendingReport = { placeId: string; createdAt: Date };

export type VerificationEntry = {
  id: string;
  kind: AdminDirectoryItem["kind"];
  city: string;
  name: string;
  establishmentType: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Position signalée « approximative » dans l'application (non confirmée). */
  approximate: boolean;
  issues: VerificationIssue[];
  /** Distance au lieu OpenStreetMap de même nom le plus proche, en mètres. */
  osmGapMeters: number | null;
  status: VerificationStatus;
  note: string | null;
  checkedAt: string | null;
  checkedBy: number | null;
};

export type PositionCandidate = { id: string; name: string; type: string; latitude: number; longitude: number; distanceMeters: number | null; similarity: number };

type Located = { latitude?: number | null; longitude?: number | null };

function meters(a: Located, b: Located) {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return null;
  return Math.round(distanceKm({ latitude: a.latitude, longitude: a.longitude }, { latitude: b.latitude, longitude: b.longitude }) * 1000);
}

/** Mots distinctifs du nom (sans « pharmacie », commun à toutes les pharmacies). */
function nameCore(name: string) {
  return healthcareNameCore(name)
    .split(" ")
    .filter((word) => word && word !== "pharmacie")
    .join(" ");
}

/** Ressemblance de deux noms : 1 si mêmes mots distinctifs, sinon part de mots en commun. */
export function nameSimilarity(left: string, right: string) {
  const a = nameCore(left);
  const b = nameCore(right);
  if (a && a === b) return 1;
  return wordOverlap(a, b);
}

function phoneKey(phone: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : null;
}

type OsmIndex = Map<string, { place: CachedHealthPlace; core: string }[]>;

export function indexOsmPlaces(places: readonly CachedHealthPlace[]): OsmIndex {
  const index: OsmIndex = new Map();
  for (const place of places) {
    if (place.source !== "osm" || place.latitude === undefined || place.longitude === undefined || !place.city) continue;
    const key = cityMatchKey(place.city);
    const list = index.get(key) ?? [];
    list.push({ place, core: nameCore(place.name) });
    index.set(key, list);
  }
  return index;
}

/** Lieux OpenStreetMap au nom proche (même ville), les plus ressemblants puis les plus proches. */
export function osmCandidates(item: Pick<AdminDirectoryItem, "city" | "name" | "latitude" | "longitude">, osm: OsmIndex, limit = 5): PositionCandidate[] {
  const core = nameCore(item.name);
  if (!core) return [];
  const candidates: PositionCandidate[] = [];
  for (const { place, core: other } of osm.get(cityMatchKey(item.city)) ?? []) {
    const similarity = core === other ? 1 : wordOverlap(core, other);
    if (similarity < 0.5) continue;
    candidates.push({ id: place.osmId ?? place.id, name: place.name, type: place.type, latitude: place.latitude!, longitude: place.longitude!, distanceMeters: meters(item, place), similarity });
  }
  return candidates.sort((a, b) => b.similarity - a.similarity || (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)).slice(0, limit);
}

/** Établissements publiés autour d'un point (doublons, agences ou erreurs de placement). */
export function neighbours(item: AdminDirectoryItem, items: readonly AdminDirectoryItem[], radiusMeters = 150) {
  return items
    .filter((other) => other.id !== item.id && other.status === "active" && cityMatchKey(other.city) === cityMatchKey(item.city))
    .map((other) => ({ id: other.id, kind: other.kind, name: other.name, establishmentType: other.establishmentType, phone: other.phone, latitude: other.latitude, longitude: other.longitude, distanceMeters: meters(item, other) }))
    .filter((other) => other.distanceMeters !== null && other.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters! - b.distanceMeters!);
}

/** Établissements de même numéro dans la même ville. */
export function samePhone(item: AdminDirectoryItem, items: readonly AdminDirectoryItem[]) {
  const key = phoneKey(item.phone);
  if (!key) return [];
  return items.filter((other) => other.id !== item.id && other.status === "active" && cityMatchKey(other.city) === cityMatchKey(item.city) && phoneKey(other.phone) === key);
}

/**
 * File de vérification : une entrée par établissement publié, avec ses problèmes et l'état de sa
 * vérification. Un signalement arrivé après la vérification remet la fiche « à vérifier ».
 */
export function analyzeDirectory(input: { items: readonly AdminDirectoryItem[]; osm: readonly CachedHealthPlace[]; checks: readonly PlaceVerificationRow[]; reports: readonly PendingReport[] }): VerificationEntry[] {
  const active = input.items.filter((item) => item.status === "active");
  const osm = indexOsmPlaces(input.osm);
  const checks = new Map(input.checks.map((check) => [check.id, check]));
  const lastReport = new Map<string, Date>();
  for (const report of input.reports) {
    const known = lastReport.get(report.placeId);
    if (!known || known < report.createdAt) lastReport.set(report.placeId, report.createdAt);
  }

  // Doublons : même point ou même numéro dans la même ville.
  const duplicates = new Set<string>();
  const byCity = new Map<string, AdminDirectoryItem[]>();
  for (const item of active) byCity.set(cityMatchKey(item.city), [...(byCity.get(cityMatchKey(item.city)) ?? []), item]);
  for (const list of byCity.values()) {
    const phones = new Map<string, string[]>();
    for (const item of list) {
      const key = phoneKey(item.phone);
      if (key) phones.set(key, [...(phones.get(key) ?? []), item.id]);
    }
    for (const ids of phones.values()) if (ids.length > 1) ids.forEach((id) => duplicates.add(id));
    const located = list.filter((item) => item.latitude !== null && item.longitude !== null);
    for (let i = 0; i < located.length; i += 1) {
      for (let j = i + 1; j < located.length; j += 1) {
        const distance = meters(located[i]!, located[j]!);
        if (distance !== null && distance < DUPLICATE_DISTANCE_METERS) {
          duplicates.add(located[i]!.id);
          duplicates.add(located[j]!.id);
        }
      }
    }
  }

  return active.map((item) => {
    const check = checks.get(item.id);
    const positionConfirmed = check?.status === "verified" && check.positionConfirmed;
    const approximate = !!item.approximateLocation && !positionConfirmed;
    const hasPosition = item.latitude !== null && item.longitude !== null;
    const best = hasPosition && item.kind === "healthcare" ? osmCandidates(item, osm, 1)[0] : undefined;
    const osmGapMeters = best?.distanceMeters ?? null;
    const reportedAt = lastReport.get(item.id);
    const issues = new Set<VerificationIssue>();
    if (reportedAt) issues.add("reported");
    if (osmGapMeters !== null && osmGapMeters > POSITION_GAP_METERS && !positionConfirmed) issues.add("position_gap");
    if (duplicates.has(item.id)) issues.add("duplicate");
    if (approximate) issues.add("approximate");
    if (!hasPosition) issues.add("no_position");
    if (!item.phone) issues.add("no_phone");
    const reopened = !!check && !!reportedAt && reportedAt > check.checkedAt;
    return {
      id: item.id,
      kind: item.kind,
      city: item.city,
      name: item.name,
      establishmentType: item.establishmentType,
      phone: item.phone,
      latitude: item.latitude,
      longitude: item.longitude,
      approximate,
      issues: VERIFICATION_ISSUES.filter((issue) => issues.has(issue)),
      osmGapMeters,
      status: !check || reopened ? "todo" : check.status,
      note: check?.note ?? null,
      checkedAt: check ? check.checkedAt.toISOString() : null,
      checkedBy: check?.checkedBy ?? null,
    };
  });
}

/** Ordre de traitement : problèmes les plus graves d'abord, puis ville et nom. */
export function sortVerificationQueue(entries: readonly VerificationEntry[]) {
  const rank = (entry: VerificationEntry) => (entry.issues.length ? VERIFICATION_ISSUES.indexOf(entry.issues[0]!) : VERIFICATION_ISSUES.length);
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.city.localeCompare(b.city, "fr") || a.name.localeCompare(b.name, "fr"));
}

export type VerificationFilter = { status?: VerificationStatus | "all"; issue?: VerificationIssue; kind?: "all" | AdminDirectoryItem["kind"]; city?: string; search?: string };

function searchKey(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filterVerificationQueue(entries: readonly VerificationEntry[], filter: VerificationFilter) {
  const search = filter.search ? searchKey(filter.search) : "";
  return entries.filter(
    (entry) =>
      (!filter.status || filter.status === "all" || entry.status === filter.status) &&
      (!filter.issue || entry.issues.includes(filter.issue)) &&
      (!filter.kind || filter.kind === "all" || entry.kind === filter.kind) &&
      (!filter.city || cityMatchKey(entry.city) === cityMatchKey(filter.city)) &&
      (!search || searchKey(`${entry.name} ${entry.phone ?? ""} ${entry.id}`).includes(search)),
  );
}
