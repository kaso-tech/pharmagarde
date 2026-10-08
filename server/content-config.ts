import { announcements, cities, insurers, medicineCategoryLabels, medicineOverrides, premiumPlans, type AnnouncementRow, type CityRow, type InsurerRow, type PremiumPlanRow } from "../drizzle/schema";
import { KNOWN_BURKINA_CITIES } from "../lib/pharmagarde/city-coordinates";
import { INSURERS, setInsurers, type Insurer } from "../lib/pharmagarde/insurances";
import { DEFAULT_CITIES, setSupportedCities } from "./cities";
import { getDb } from "./db";
import { parseMedicineEdit, setMedicineOverlay } from "./medicines-data";

/**
 * Contenus gérés depuis la console (villes, assurances, formules Premium, annonces, modifications du
 * catalogue des médicaments). Comme pour les gardes, la base est relue après chaque modification et
 * au plus tard toutes les minutes ; sans base ou sans migration 0011, les listes de référence
 * restent en vigueur.
 */
const RELOAD_INTERVAL_MS = 60_000;

const DEFAULT_ALIASES = new Map(KNOWN_BURKINA_CITIES.map((city) => [city.name, [...city.aliases]]));

export type CityConfig = { name: string; latitude: number; longitude: number; aliases: string[]; published: boolean; source: "default" | "modified" | "added"; updatedAt: string | null };
export type InsurerConfig = Insurer & { source: "default" | "modified" | "added" };
export type ContentConfig = { cities: CityConfig[]; insurers: InsurerConfig[]; planRows: PremiumPlanRow[]; announcements: AnnouncementRow[] };

const toIso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

export function parseAliases(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((alias): alias is string => typeof alias === "string" && !!alias.trim()) : [];
  } catch {
    return [];
  }
}

/** Liste de référence, villes modifiées à leur place, villes ajoutées ensuite (ordre alphabétique). */
export function buildCityList(rows: readonly CityRow[]): CityConfig[] {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const fromRow = (row: CityRow, source: CityConfig["source"]): CityConfig => ({
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    aliases: [...new Set([...(DEFAULT_ALIASES.get(row.name) ?? []), ...parseAliases(row.aliases)])],
    published: row.published,
    source,
    updatedAt: toIso(row.updatedAt),
  });
  const list = DEFAULT_CITIES.map((city) => {
    const row = byName.get(city.name);
    return row ? fromRow(row, "modified") : { ...city, aliases: DEFAULT_ALIASES.get(city.name) ?? [], published: true, source: "default" as const, updatedAt: null };
  });
  const defaults = new Set(DEFAULT_CITIES.map((city) => city.name));
  const added = rows.filter((row) => !defaults.has(row.name)).sort((left, right) => left.name.localeCompare(right.name, "fr"));
  return [...list, ...added.map((row) => fromRow(row, "added"))];
}

/** Assureurs de référence (renommés ou désactivés le cas échéant), puis ceux ajoutés, par libellé. */
export function buildInsurerList(rows: readonly InsurerRow[]): InsurerConfig[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const list: InsurerConfig[] = INSURERS.map((insurer) => {
    const row = byId.get(insurer.id);
    return row ? { id: insurer.id, label: row.label, active: row.active, source: "modified" } : { id: insurer.id, label: insurer.label, active: true, source: "default" };
  });
  const defaults = new Set<string>(INSURERS.map((insurer) => insurer.id));
  const added = rows.filter((row) => !defaults.has(row.id)).sort((left, right) => left.label.localeCompare(right.label, "fr"));
  return [...list, ...added.map((row) => ({ id: row.id, label: row.label, active: row.active, source: "added" as const }))];
}

export function buildContentConfig(parts: { cities?: readonly CityRow[]; insurers?: readonly InsurerRow[]; planRows?: readonly PremiumPlanRow[]; announcements?: readonly AnnouncementRow[] } = {}): ContentConfig {
  return {
    cities: buildCityList(parts.cities ?? []),
    insurers: buildInsurerList(parts.insurers ?? []),
    planRows: [...(parts.planRows ?? [])],
    announcements: [...(parts.announcements ?? [])],
  };
}

/** Annonces actives dont la période couvre `now`. */
export function currentAnnouncements(config: ContentConfig, now = new Date()) {
  return config.announcements.filter((announcement) => announcement.active && new Date(announcement.startsAt).getTime() <= now.getTime() && (!announcement.endsAt || new Date(announcement.endsAt).getTime() > now.getTime()));
}

function applyContentConfig(config: ContentConfig) {
  setSupportedCities(config.cities.filter((city) => city.published).map(({ name, latitude, longitude }) => ({ name, latitude, longitude })));
  setInsurers(config.insurers);
}

let snapshot: ContentConfig = buildContentConfig();
let loadedAt = 0;
let generation = 0;
let pendingReload: Promise<void> | null = null;

export async function reloadContentConfig() {
  const current = ++generation;
  const db = await getDb();
  if (!db) {
    loadedAt = Date.now();
    return;
  }
  try {
    const [cityRows, insurerRows, planRows, announcementRows, overrideRows, labelRows] = await Promise.all([
      db.select().from(cities),
      db.select().from(insurers),
      db.select().from(premiumPlans),
      db.select().from(announcements),
      db.select().from(medicineOverrides),
      db.select().from(medicineCategoryLabels),
    ]);
    if (current !== generation) return;
    snapshot = buildContentConfig({ cities: cityRows, insurers: insurerRows, planRows, announcements: announcementRows });
    applyContentConfig(snapshot);
    setMedicineOverlay(
      overrideRows.map((row) => ({ id: row.id, data: parseMedicineEdit(row.data), hidden: row.hidden, added: row.added, updatedAt: row.updatedAt })),
      labelRows.map((row) => ({ level: row.level, original: row.original, label: row.label })),
    );
  } catch (error) {
    console.warn("[Contenus] Réglages de la console illisibles (migration 0011 appliquée ?), dernière version conservée :", error instanceof Error ? error.message : error);
  } finally {
    if (current === generation) loadedAt = Date.now();
  }
}

/** Contenus à jour (relus s'ils datent de plus d'une minute). */
export async function getContentConfig() {
  if (Date.now() - loadedAt >= RELOAD_INTERVAL_MS) {
    pendingReload ??= reloadContentConfig().finally(() => {
      pendingReload = null;
    });
    await pendingReload;
  }
  return snapshot;
}

/** Derniers contenus chargés, sans attendre. */
export function currentContentConfig() {
  return snapshot;
}
