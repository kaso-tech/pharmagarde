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

async function authenticateAdmin(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (user.role === "admin") return user;
    res.status(403).json({ error: "Accès administrateur requis." });
  } catch {
    res.status(401).json({ error: "Connexion requise." });
  }
  return null;
}

/**
 * Import Excel de l'annuaire depuis la console : `POST /api/admin/import/pharmacies` avec le fichier
 * .xlsx en corps brut. Sans `?apply=1`, renvoie l'aperçu (ajouts, modifications, lignes rejetées) ;
 * avec, enregistre les ajouts et modifications comme fiches administrées. Les horaires propres et les
 * assurances déjà saisies sont conservés.
 */
export function registerAdminImportRoutes(app: Express) {
  app.post("/api/admin/import/pharmacies", express.raw({ type: () => true, limit: MAX_IMPORT_BYTES }), async (req: Request, res: Response) => {
    const user = await authenticateAdmin(req, res);
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
    const user = await authenticateAdmin(req, res);
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
}
