import { z } from "zod";

import type { DirectoryEntry } from "../drizzle/schema";
import { getCacheState, type CachedHealthPlace } from "./pharmagarde-cache";
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
  source: "annuaire" | "cache" | "admin";
  managed: boolean;
  updatedAt: string | null;
};

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
  })
  .superRefine((value, ctx) => {
    const hasLatitude = value.latitude !== null && value.latitude !== undefined;
    const hasLongitude = value.longitude !== null && value.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Les coordonnées latitude et longitude doivent être renseignées ensemble.", path: ["latitude"] });
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
};

function compact(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeDirectoryUpsert(input: DirectoryUpsertInput): NormalizedDirectoryUpsert {
  const city = compact(input.city);
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

/** Applique les surcharges administrées ; une archive masque l’enregistrement source sans le supprimer. */
export function mergeAdminDirectoryItems(baseItems: AdminDirectoryItem[], overrides: DirectoryEntry[]): AdminDirectoryItem[] {
  const items = new Map(baseItems.map((item) => [item.id, item]));

  for (const override of overrides) {
    if (override.status === "archived") {
      items.delete(override.id);
      continue;
    }

    const current = items.get(override.id);
    const kind = override.kind as AdminDirectoryKind;
    const next: AdminDirectoryItem = {
      id: override.id,
      kind,
      status: "active",
      city: override.city ?? current?.city ?? "Non renseignée",
      name: override.name ?? current?.name ?? override.id,
      phone: override.phone ?? current?.phone ?? null,
      address: override.address ?? current?.address ?? null,
      latitude: override.latitude ?? current?.latitude ?? null,
      longitude: override.longitude ?? current?.longitude ?? null,
      dutyGroup: override.dutyGroup ?? current?.dutyGroup ?? null,
      establishmentType: override.establishmentType ?? current?.establishmentType ?? (kind === "pharmacy" ? "Pharmacie" : "Centre de santé"),
      source: "admin",
      managed: true,
      updatedAt: toIso(override.updatedAt),
    };
    items.set(next.id, next);
  }

  return [...items.values()].sort((left, right) => left.city.localeCompare(right.city, "fr") || left.name.localeCompare(right.name, "fr"));
}

export function filterAdminDirectoryItems(items: AdminDirectoryItem[], input: { kind?: AdminDirectoryKind | "all"; search?: string }) {
  const search = input.search?.trim().toLocaleLowerCase("fr");
  return items.filter((item) => {
    if (input.kind && input.kind !== "all" && item.kind !== input.kind) return false;
    if (!search) return true;
    return [item.name, item.city, item.phone ?? "", item.address ?? "", item.establishmentType ?? ""].some((value) => value.toLocaleLowerCase("fr").includes(search));
  });
}
