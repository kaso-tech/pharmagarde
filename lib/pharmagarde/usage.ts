import { normalizeBaseUrl } from "./api";

/**
 * Statistiques d'usage anonymes envoyées au serveur (`POST /usage`) : uniquement le type
 * d'événement, la ville choisie et le jour. Ni identité, ni position, ni texte recherché.
 */
export type UsageEvent = "app_open" | "search" | "place_view" | "call" | "directions";

type Counter = { event: UsageEvent; city?: string; day: string; count: number };

const FLUSH_DELAY_MS = 20_000;
const MAX_COUNTERS = 200;

const counters = new Map<string, Counter>();
let baseUrl = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let sending = false;

export function configureUsage(url: string) {
  baseUrl = normalizeBaseUrl(url);
}

export function trackUsage(event: UsageEvent, city?: string, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const key = `${day}|${city ?? ""}|${event}`;
  const existing = counters.get(key);
  if (existing) existing.count += 1;
  else if (counters.size < MAX_COUNTERS) counters.set(key, { event, city, day, count: 1 });
  timer ??= setTimeout(() => {
    timer = null;
    void flushUsage();
  }, FLUSH_DELAY_MS);
}

/** Envoie les compteurs en attente ; ils sont gardés pour le prochain envoi en cas d'échec. */
export async function flushUsage() {
  if (sending || !baseUrl || counters.size === 0) return;
  sending = true;
  const batch = [...counters.values()].slice(0, 50).map((counter) => ({ ...counter, count: Math.min(counter.count, 50) }));
  try {
    const response = await fetch(`${baseUrl}/usage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }) });
    if (response.ok) {
      for (const sent of batch) {
        const key = `${sent.day}|${sent.city ?? ""}|${sent.event}`;
        const counter = counters.get(key);
        if (!counter) continue;
        counter.count -= sent.count;
        if (counter.count <= 0) counters.delete(key);
      }
    }
  } catch {
    // Hors connexion : nouvel essai au prochain événement.
  } finally {
    sending = false;
  }
}

/** Compteurs en attente (tests). */
export function pendingUsage() {
  return [...counters.values()];
}
