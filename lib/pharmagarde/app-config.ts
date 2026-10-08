import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeBaseUrl } from "./api";
import { setPublishedCities, type PublishedCity } from "./city-coordinates";
import { normalizeCityName } from "./city-utils";
import { INSURER_ID_PATTERN, setInsurers } from "./insurances";
import { PREMIUM_PLANS, type PremiumPlan, type PremiumPlanId } from "./premium-plans";

/**
 * Réglages publiés par le serveur (`GET /app-config`) et modifiés depuis la console : villes,
 * assurances, formules Premium et annonces. La dernière réponse est gardée sur l'appareil pour
 * démarrer hors connexion ; à défaut, les listes de référence embarquées restent en vigueur.
 */
export type AppAnnouncement = {
  id: number;
  city: string | null;
  title: string;
  body: string;
  tone: "info" | "warning" | "danger";
  startsAt: string;
  endsAt: string | null;
};

export type AppConfig = {
  cities: PublishedCity[];
  insurers: { id: string; label: string }[];
  plans: PremiumPlan[];
  announcements: AppAnnouncement[];
  updatedAt: string;
};

const STORAGE_KEY = "pharmagarde:app-config:v1";
const TIMEOUT_MS = 10_000;
const PLAN_IDS: readonly PremiumPlanId[] = ["week", "month", "quarter", "semester"];
const TONES = ["info", "warning", "danger"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Lit la réponse du serveur ; les entrées incomplètes sont ignorées. */
export function parseAppConfig(raw: unknown): AppConfig | null {
  if (!isRecord(raw)) return null;
  const cities = list(raw.cities).flatMap((city) => {
    const name = text(city.name);
    const latitude = finite(city.latitude);
    const longitude = finite(city.longitude);
    if (!name || latitude === null || longitude === null) return [];
    return [{ name, latitude, longitude, aliases: Array.isArray(city.aliases) ? city.aliases.filter((alias): alias is string => typeof alias === "string") : [] }];
  });
  const insurers = list(raw.insurers).flatMap((insurer) => {
    const id = text(insurer.id);
    const label = text(insurer.label);
    return id && label && INSURER_ID_PATTERN.test(id) ? [{ id, label }] : [];
  });
  const plans = list(raw.plans).flatMap((plan) => {
    const id = PLAN_IDS.find((planId) => planId === plan.id);
    const label = text(plan.label);
    const amount = finite(plan.amount);
    const durationDays = finite(plan.durationDays);
    return id && label && amount !== null && amount > 0 && durationDays !== null && durationDays > 0 ? [{ id, label, amount, durationDays }] : [];
  });
  const announcements = list(raw.announcements).flatMap((announcement) => {
    const id = finite(announcement.id);
    const title = text(announcement.title);
    const body = text(announcement.body);
    const startsAt = text(announcement.startsAt);
    if (id === null || !title || !body || !startsAt) return [];
    const tone = TONES.find((value) => value === announcement.tone) ?? "info";
    return [{ id, city: text(announcement.city), title, body, tone, startsAt, endsAt: text(announcement.endsAt) }];
  });
  return { cities, insurers, plans, announcements, updatedAt: text(raw.updatedAt) ?? new Date().toISOString() };
}

/** Rend les villes et les assurances publiées visibles par tous les modules de l'application. */
export function applyAppConfig(config: AppConfig | null) {
  if (!config) return;
  if (config.cities.length) setPublishedCities(config.cities);
  if (config.insurers.length) setInsurers(config.insurers.map((insurer) => ({ ...insurer, active: true })));
}

export async function loadStoredAppConfig() {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? parseAppConfig(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

export async function fetchAppConfig(baseUrl: string) {
  const cleanBase = normalizeBaseUrl(baseUrl);
  if (!cleanBase) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${cleanBase}/app-config`, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return null;
    const config = parseAppConfig(await response.json());
    if (config) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config)).catch(() => undefined);
    return config;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Formules proposées : celles publiées par le serveur, sinon les formules de référence. */
export function premiumPlansOf(config: AppConfig | null) {
  return config?.plans.length ? config.plans : PREMIUM_PLANS;
}

/** Annonces en cours pour une ville (et celles destinées à toutes les villes). */
export function announcementsFor(config: AppConfig | null, city: string, now = new Date()) {
  const cityKey = normalizeCityName(city);
  return (config?.announcements ?? []).filter((announcement) => {
    if (announcement.city && normalizeCityName(announcement.city) !== cityKey) return false;
    if (new Date(announcement.startsAt).getTime() > now.getTime()) return false;
    return !announcement.endsAt || new Date(announcement.endsAt).getTime() > now.getTime();
  });
}
