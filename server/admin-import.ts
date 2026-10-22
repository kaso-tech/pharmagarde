import { sql } from "drizzle-orm";
import express, { type Express, type Request, type Response } from "express";

import { medicineOverrides } from "../drizzle/schema";
import type { Medicine } from "../lib/pharmagarde/types";
import type { AdminDirectoryItem } from "./admin-directory";
import { readMergedDirectory, saveDirectoryEntries, writeAudit } from "./admin";
import { reloadContentConfig } from "./content-config";
import { getDb } from "./db";
import { readMedicinesWorkbook } from "./medicine-import";
import { changedMedicineFields, getEffectiveMedicines, medicineEditBetween, type EffectiveMedicine } from "./medicines-data";
import type { DirectoryPharmacy } from "./pharmacy-directory";
import { readPharmacyWorkbook } from "./pharmacy-import";
import { readHealthcareWorkbook, type ImportedHealthcarePlace } from "./healthcare-import";
import { cityMatchKey } from "./admin-directory";
import { slugify } from "./pharmacy-directory";
import { distanceKm } from "../lib/pharmagarde/city-utils";
import { canWrite, type AdminArea } from "../shared/admin-roles";
import { resolveConsoleAccess } from "./admin-auth";
import { sdk } from "./_core/sdk";

const MAX_IMPORT_BYTES = 3 * 1024 * 1024;
const MAX_MEDICINES_IMPORT_BYTES = 8 * 1024 * 1024;
/** Lignes renvoyées par catégorie dans l'aperçu (les totaux restent exacts). */
const PREVIEW_ROWS = 300;

/** Champs comparés pour décider si une ligne du tableur modifie une fiche existante. */
const COMPARED = ["name", "city", "phone", "address", "latitude", "longitude", "dutyGroup"] as const;
const FIELD_LABELS: Record<(typeof COMPARED)[number] | "status", string> = {
  name: "nom",
  city: "ville",
  phone: "téléphone",
  address: "adresse",
  latitude: "position",
  longitude: "position",
  dutyGroup: "groupe de garde",
  status: "republiée",
};

function sameValue(a: unknown, b: unknown) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  return (a ?? null) === (b ?? null);
}

/** Compare le tableur à l'annuaire publié : ajouts, modifications (avec les champs changés), inchangées. */
export function diffImport(imported: readonly DirectoryPharmacy[], current: readonly AdminDirectoryItem[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  const adds: DirectoryPharmacy[] = [];
  const updates: { pharmacy: DirectoryPharmacy; existing: AdminDirectoryItem; changes: string[] }[] = [];
  let unchanged = 0;
  for (const pharmacy of imported) {
    const existing = byId.get(pharmacy.id);
    if (!existing) {
      adds.push(pharmacy);
      continue;
    }
    const changes = new Set<string>();
    for (const field of COMPARED) if (!sameValue(pharmacy[field], existing[field])) changes.add(FIELD_LABELS[field]);
    if (existing.status === "archived") changes.add(FIELD_LABELS.status);
    if (changes.size) updates.push({ pharmacy, existing, changes: [...changes] });
    else unchanged += 1;
  }
  return { adds, updates, unchanged };
}

const MEDICINE_FIELD_LABELS: Record<string, string> = {
  name: "nom",
  productType: "type",
  category: "catégorie",
  subcategory: "sous-catégorie",
  ageCategory: "âge",
  pharmaceuticalType: "forme",
  dosage: "dosage",
  priceApprox: "prix",
  priceMax: "prix",
  priceUnit: "unité de prix",
  priceOfficial: "source du prix",
};

/** Compare le tableur au catalogue en vigueur : ajouts, modifications, produits absents du fichier. */
export function diffMedicinesImport(imported: readonly Medicine[], current: readonly EffectiveMedicine[]) {
  const byId = new Map(current.map((item) => [item.medicine.id, item]));
  const importedIds = new Set(imported.map((medicine) => medicine.id));
  const adds: Medicine[] = [];
  const updates: { medicine: Medicine; existing: EffectiveMedicine; changes: string[] }[] = [];
  let unchanged = 0;
  for (const medicine of imported) {
    const existing = byId.get(medicine.id);
    if (!existing) {
      adds.push(medicine);
      continue;
    }
    const changes = [...new Set(changedMedicineFields(existing.medicine, medicine).map((field) => MEDICINE_FIELD_LABELS[field] ?? field))];
    if (changes.length) updates.push({ medicine, existing, changes });
    else unchanged += 1;
  }
  const missing = current.filter((item) => !item.hidden && item.source !== "added" && !importedIds.has(item.medicine.id));
  return { adds, updates, unchanged, missing };
}

/** Compte de la console avec le double facteur validé et le droit de modifier la page. */
/** Mots trop courants pour distinguer deux structures de santé (« Clinique », « Centre médical »…). */
const GENERIC_WORDS = new Set(["clinique", "polyclinique", "centre", "medical", "medicale", "medico", "chirurgical", "chirurgicale", "sante", "soins", "csps", "cma", "cmu", "chu", "chr", "hopital", "urbain", "prive", "publique", "public", "de", "du", "des", "la", "le", "les", "l", "d", "et"]);

/** Mots distinctifs d'un nom : « Clinique Médicale Sainte Odile » → « sainte odile ». */
export function healthcareNameCore(name: string) {
  return slugify(name)
    .replace(/\bst\b/g, "saint")
    .replace(/\bste\b/g, "sainte")
    .split("-")
    .filter((word) => word && !GENERIC_WORDS.has(word))
    .join(" ");
}

function wordOverlap(left: string, right: string) {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / Math.min(a.size, b.size);
}

/**
 * Rapproche un tableur de structures de santé de l'annuaire en vigueur. Une structure est
 * reconnue par son nom (mots distinctifs identiques, même ville) ou par sa position (moins de
 * 150 m avec un nom proche). Une structure reconnue n'est que complétée : téléphone, adresse ou
 * position manquants, type précis à la place de « Centre de santé ». Rien n'est écrasé.
 */
export function diffHealthcareImport(imported: readonly ImportedHealthcarePlace[], current: readonly AdminDirectoryItem[]) {
  const healthcare = current.filter((item) => item.kind === "healthcare");
  const used = new Set<string>();
  const adds: ImportedHealthcarePlace[] = [];
  const updates: { place: ImportedHealthcarePlace; existing: AdminDirectoryItem; changes: string[]; completed: Partial<AdminDirectoryItem> }[] = [];
  let unchanged = 0;
  for (const place of imported) {
    const core = healthcareNameCore(place.name);
    const sameCity = healthcare.filter((item) => !used.has(item.id) && cityMatchKey(item.city) === cityMatchKey(place.city));
    const existing =
      sameCity.find((item) => core && healthcareNameCore(item.name) === core) ??
      (place.latitude !== null && place.longitude !== null
        ? sameCity.find(
            (item) =>
              item.latitude !== null &&
              item.longitude !== null &&
              distanceKm({ latitude: place.latitude!, longitude: place.longitude! }, { latitude: item.latitude, longitude: item.longitude }) < 0.15 &&
              wordOverlap(core, healthcareNameCore(item.name)) >= 0.5,
          )
        : undefined);
    if (!existing) {
      adds.push(place);
      continue;
    }
    used.add(existing.id);
    const completed: Partial<AdminDirectoryItem> = {};
    const changes: string[] = [];
    if (!existing.phone && place.phone) {
      completed.phone = place.phone;
      changes.push("téléphone");
    }
    if (!existing.address && place.address) {
      completed.address = place.address;
      changes.push("adresse");
    }
    if ((existing.latitude === null || existing.longitude === null) && place.latitude !== null) {
      completed.latitude = place.latitude;
      completed.longitude = place.longitude;
      changes.push("position");
    }
    if ((!existing.establishmentType || existing.establishmentType === "Centre de santé") && place.type !== "Centre de santé") {
      completed.establishmentType = place.type;
      changes.push(`type (${place.type})`);
    }
    if (existing.status === "archived") changes.push("republiée");
    if (changes.length) updates.push({ place, existing, changes, completed });
    else unchanged += 1;
  }
  return { adds, updates, unchanged };
}

async function authenticateAdmin(req: Request, res: Response, area: AdminArea) {
  let user: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    res.status(401).json({ error: "Connexion requise." });
    return null;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Accès administrateur requis." });
    return null;
  }
  const access = await resolveConsoleAccess(req, user);
  if (!access.secondFactor.verified) {
    res.status(403).json({ error: "Code de connexion à la console requis." });
    return null;
  }
  if (!canWrite(access.role, area)) {
    res.status(403).json({ error: "Votre rôle ne permet pas cet import." });
    return null;
  }
  return user;
}

/**
 * Import Excel de l'annuaire depuis la console : `POST /api/admin/import/pharmacies` avec le fichier
 * .xlsx en corps brut. Sans `?apply=1`, renvoie l'aperçu (ajouts, modifications, lignes rejetées) ;
 * avec, enregistre les ajouts et modifications comme fiches administrées. Les horaires propres et les
 * assurances déjà saisies sont conservés.
 */
export function registerAdminImportRoutes(app: Express) {
  app.post("/api/admin/import/pharmacies", express.raw({ type: () => true, limit: MAX_IMPORT_BYTES }), async (req: Request, res: Response) => {
    const user = await authenticateAdmin(req, res, "directory");
    if (!user) return;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Fichier Excel manquant." });
      return;
    }

    let parsed: Awaited<ReturnType<typeof readPharmacyWorkbook>>;
    try {
      parsed = await readPharmacyWorkbook({ buffer: req.body });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? `Fichier illisible : ${error.message}` : "Fichier Excel illisible." });
      return;
    }

    const current = await readMergedDirectory();
    const { adds, updates, unchanged } = diffImport(parsed.pharmacies, current);
    const apply = req.query.apply === "1";
    if (apply && adds.length + updates.length > 0) {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Base de données indisponible." });
        return;
      }
      const toInput = (pharmacy: DirectoryPharmacy, existing?: AdminDirectoryItem) => ({
        id: pharmacy.id,
        kind: "pharmacy" as const,
        city: pharmacy.city,
        name: pharmacy.name,
        phone: pharmacy.phone,
        address: pharmacy.address ?? null,
        latitude: pharmacy.latitude,
        longitude: pharmacy.longitude,
        dutyGroup: pharmacy.dutyGroup,
        openingHours: existing?.openingHours ?? null,
        insurances: (existing?.insurances ?? []) as never,
      });
      try {
        await saveDirectoryEntries(db, user.id, [...adds.map((pharmacy) => toInput(pharmacy)), ...updates.map(({ pharmacy, existing }) => toInput(pharmacy, existing))], "excel_import");
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? `Import refusé : ${error.message}` : "Import refusé." });
        return;
      }
      await writeAudit(db, { actorUserId: user.id, action: "directory.imported", targetType: "pharmacy", metadata: { added: adds.length, updated: updates.length, skipped: parsed.skipped.length } });
    }

    res.json({
      applied: apply,
      total: parsed.pharmacies.length,
      cities: [...new Set(parsed.pharmacies.map((pharmacy) => pharmacy.city))],
      adds: adds.map((pharmacy) => ({ id: pharmacy.id, name: pharmacy.name, city: pharmacy.city, dutyGroup: pharmacy.dutyGroup })),
      updates: updates.map(({ pharmacy, changes }) => ({ id: pharmacy.id, name: pharmacy.name, city: pharmacy.city, changes })),
      unchanged,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
    });
  });

  /**
   * Import Excel du catalogue des médicaments (même tableur que `pnpm import:medicines`) : aperçu
   * puis, avec `?apply=1`, enregistrement des ajouts et modifications dans la base. Avec
   * `&hideMissing=1`, les produits absents du fichier sont masqués (jamais supprimés).
   */
  app.post("/api/admin/import/medicines", express.raw({ type: () => true, limit: MAX_MEDICINES_IMPORT_BYTES }), async (req: Request, res: Response) => {
    const user = await authenticateAdmin(req, res, "medicines");
    if (!user) return;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Fichier Excel manquant." });
      return;
    }
    let parsed: Awaited<ReturnType<typeof readMedicinesWorkbook>>;
    try {
      parsed = await readMedicinesWorkbook({ buffer: req.body });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? `Fichier illisible : ${error.message}` : "Fichier Excel illisible." });
      return;
    }

    await reloadContentConfig();
    const { adds, updates, unchanged, missing } = diffMedicinesImport(parsed.medicines, getEffectiveMedicines());
    const apply = req.query.apply === "1";
    const hideMissing = req.query.hideMissing === "1";
    if (apply) {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Base de données indisponible." });
        return;
      }
      const rows = [
        ...adds.map((medicine) => ({ id: medicine.id, data: JSON.stringify(medicineEditBetween(null, medicine)), hidden: false, added: true, updatedBy: user.id })),
        ...updates.map(({ medicine, existing }) => ({
          id: medicine.id,
          data: JSON.stringify(medicineEditBetween(existing.source === "added" ? null : existing.base, medicine)),
          hidden: existing.hidden,
          added: existing.source === "added",
          updatedBy: user.id,
        })),
        ...(hideMissing ? missing.map((item) => ({ id: item.medicine.id, data: JSON.stringify(item.base ? medicineEditBetween(item.base, item.medicine) : {}), hidden: true, added: false, updatedBy: user.id })) : []),
      ];
      for (let start = 0; start < rows.length; start += 250) {
        await db
          .insert(medicineOverrides)
          .values(rows.slice(start, start + 250))
          .onDuplicateKeyUpdate({ set: { data: sql`values(${medicineOverrides.data})`, hidden: sql`values(${medicineOverrides.hidden})`, added: sql`values(${medicineOverrides.added})`, updatedBy: sql`values(${medicineOverrides.updatedBy})` } });
      }
      await writeAudit(db, { actorUserId: user.id, action: "medicines.imported", targetType: "medicine", metadata: { added: adds.length, updated: updates.length, hidden: hideMissing ? missing.length : 0 } });
      await reloadContentConfig();
    }

    const describe = (medicine: Medicine) => ({ id: medicine.id, name: medicine.name, productType: medicine.productType ?? null, dosage: medicine.dosage ?? null });
    res.json({
      applied: apply,
      hideMissing,
      total: parsed.medicines.length,
      counts: { adds: adds.length, updates: updates.length, unchanged, missing: missing.length },
      adds: adds.slice(0, PREVIEW_ROWS).map(describe),
      updates: updates.slice(0, PREVIEW_ROWS).map(({ medicine, changes }) => ({ ...describe(medicine), changes })),
      missing: missing.slice(0, PREVIEW_ROWS).map((item) => describe(item.medicine)),
      warnings: parsed.warnings.slice(0, 100),
      warningCount: parsed.warnings.length,
    });
  });

  /**
   * Import Excel de structures de santé : `POST /api/admin/import/healthcare` (même principe que les
   * pharmacies). Les nouvelles structures deviennent des fiches administrées ; celles déjà connues
   * (OpenStreetMap ou console) sont seulement complétées.
   */
  app.post("/api/admin/import/healthcare", express.raw({ type: () => true, limit: MAX_IMPORT_BYTES }), async (req: Request, res: Response) => {
    const user = await authenticateAdmin(req, res, "directory");
    if (!user) return;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Fichier Excel manquant." });
      return;
    }
    let parsed: Awaited<ReturnType<typeof readHealthcareWorkbook>>;
    try {
      parsed = await readHealthcareWorkbook({ buffer: req.body });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? `Fichier illisible : ${error.message}` : "Fichier Excel illisible." });
      return;
    }

    const current = await readMergedDirectory();
    const { adds, updates, unchanged } = diffHealthcareImport(parsed.places, current);
    const apply = req.query.apply === "1";
    if (apply && adds.length + updates.length > 0) {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Base de données indisponible." });
        return;
      }
      const inputs = [
        ...adds.map((place) => ({
          kind: "healthcare" as const,
          city: place.city,
          name: place.name,
          phone: place.phone,
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          establishmentType: place.type,
        })),
        ...updates.map(({ existing, completed }) => {
          const item = { ...existing, ...completed };
          return {
            id: item.id,
            kind: "healthcare" as const,
            city: item.city,
            name: item.name,
            phone: item.phone,
            address: item.address,
            latitude: item.latitude,
            longitude: item.longitude,
            establishmentType: item.establishmentType,
            openingHours: item.openingHours,
            insurances: item.insurances as never,
          };
        }),
      ];
      try {
        await saveDirectoryEntries(db, user.id, inputs, "excel_import");
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? `Import refusé : ${error.message}` : "Import refusé." });
        return;
      }
      await writeAudit(db, { actorUserId: user.id, action: "directory.imported", targetType: "healthcare", metadata: { added: adds.length, updated: updates.length, skipped: parsed.skipped.length } });
    }

    res.json({
      applied: apply,
      total: parsed.places.length,
      cities: [...new Set(parsed.places.map((place) => place.city))],
      adds: adds.map((place) => ({ id: `${slugify(place.city)}-${slugify(place.name)}`, name: place.name, city: place.city, detail: `${place.type}${place.latitude === null ? " · sans position" : ""}${place.phone ? "" : " · sans téléphone"}` })),
      updates: updates.map(({ existing, changes }) => ({ id: existing.id, name: existing.name, city: existing.city, changes })),
      unchanged,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
    });
  });
}
