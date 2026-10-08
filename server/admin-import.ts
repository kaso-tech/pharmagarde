import express, { type Express, type Request, type Response } from "express";

import type { AdminDirectoryItem } from "./admin-directory";
import { readMergedDirectory, saveDirectoryEntries, writeAudit } from "./admin";
import { getDb } from "./db";
import type { DirectoryPharmacy } from "./pharmacy-directory";
import { readPharmacyWorkbook } from "./pharmacy-import";
import { sdk } from "./_core/sdk";

const MAX_IMPORT_BYTES = 3 * 1024 * 1024;

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

/**
 * Import Excel de l'annuaire depuis la console : `POST /api/admin/import/pharmacies` avec le fichier
 * .xlsx en corps brut. Sans `?apply=1`, renvoie l'aperçu (ajouts, modifications, lignes rejetées) ;
 * avec, enregistre les ajouts et modifications comme fiches administrées. Les horaires propres et les
 * assurances déjà saisies sont conservés.
 */
export function registerAdminImportRoutes(app: Express) {
  app.post("/api/admin/import/pharmacies", express.raw({ type: () => true, limit: MAX_IMPORT_BYTES }), async (req: Request, res: Response) => {
    let user: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      res.status(401).json({ error: "Connexion requise." });
      return;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "Accès administrateur requis." });
      return;
    }
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
}
