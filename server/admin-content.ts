import { TRPCError } from "@trpc/server";
import { and, count, eq, sql, sum } from "drizzle-orm";
import { z } from "zod";

import { announcements, cities, directoryEntries, insurers, medicineCategoryLabels, medicineOverrides, premiumPlans, transactions } from "../drizzle/schema";
import { INSURER_ID_PATTERN, insurerIdFromLabel } from "../lib/pharmagarde/insurances";
import type { MedicineProductType } from "../lib/pharmagarde/types";
import { cityMatchKey, getBaseAdminDirectoryItems, listDirectoryCities, mergeAdminDirectoryItems } from "./admin-directory";
import { writeAudit } from "./audit-log";
import { getContentConfig, reloadContentConfig } from "./content-config";
import { getDb } from "./db";
import { getDutyConfig } from "./duty-config";
import { dutyCityKey } from "./duty-roster";
import { MEDICINE_PRODUCT_TYPES, getAdminMedicines, getEffectiveMedicines, medicineEditBetween, relabelMedicine, type AdminMedicine, type MedicineEdit } from "./medicines-data";
import { slugify } from "./pharmacy-directory";
import { PREMIUM_PLAN_IDS, premiumPlansWithStatus } from "./premium";
import { adminProcedure, router } from "./_core/trpc";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de données indisponible." });
  return db;
}

const pageSchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

/** Texte comparé sans accents ni casse. */
function searchKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

async function readMergedDirectory(db: Database) {
  const [baseItems, overrides] = await Promise.all([getBaseAdminDirectoryItems(), db.select().from(directoryEntries)]);
  return mergeAdminDirectoryItems(baseItems, overrides);
}

// ——— Médicaments ———

const PRODUCT_TYPES = MEDICINE_PRODUCT_TYPES as [MedicineProductType, ...MedicineProductType[]];

const medicineListSchema = pageSchema.extend({
  search: z.string().trim().max(120).optional(),
  productType: z.enum(PRODUCT_TYPES).optional(),
  category: z.string().trim().max(255).optional(),
  status: z.enum(["all", "visible", "hidden", "modified", "added"]).default("all"),
});

const price = z.number().int().positive().max(10_000_000).nullish();

export const medicineFieldsSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    productType: z.enum(PRODUCT_TYPES),
    category: optionalText(255),
    subcategory: optionalText(255),
    ageCategory: z.enum(["Enfant", "Adulte", "Tous"]).nullish(),
    pharmaceuticalType: optionalText(120),
    dosage: optionalText(200),
    priceApprox: price,
    priceMax: price,
    priceUnit: optionalText(120),
    priceOfficial: z.boolean().optional(),
  })
  .refine((input) => !input.priceMax || (!!input.priceApprox && input.priceMax > input.priceApprox), { message: "Le prix maximum doit dépasser le prix minimum.", path: ["priceMax"] });

const medicineSaveSchema = medicineFieldsSchema.and(z.object({ id: z.string().trim().min(1).max(160).optional() }));
const medicineIdSchema = z.object({ id: z.string().trim().min(1).max(160) });

function filterMedicines(items: readonly AdminMedicine[], input: z.infer<typeof medicineListSchema>) {
  const terms = input.search ? searchKey(input.search).split(/\s+/).filter(Boolean) : [];
  return items.filter((item) => {
    if (input.productType && item.productType !== input.productType) return false;
    if (input.category && item.category !== input.category) return false;
    if (input.status === "visible" && item.hidden) return false;
    if (input.status === "hidden" && !item.hidden) return false;
    if (input.status === "modified" && item.source !== "modified") return false;
    if (input.status === "added" && item.source !== "added") return false;
    if (!terms.length) return true;
    const haystack = searchKey([item.name, item.dosage, item.pharmaceuticalType, item.category, item.subcategory, item.id].filter(Boolean).join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}

function toEdit(input: z.infer<typeof medicineFieldsSchema>): MedicineEdit {
  return {
    name: input.name,
    productType: input.productType,
    category: input.category ?? undefined,
    subcategory: input.subcategory ?? undefined,
    ageCategory: input.ageCategory ?? undefined,
    pharmaceuticalType: input.pharmaceuticalType ?? undefined,
    dosage: input.dosage ?? undefined,
    priceApprox: input.priceApprox ?? undefined,
    priceMax: input.priceMax ?? undefined,
    priceUnit: input.priceUnit ?? undefined,
    priceOfficial: input.priceApprox ? (input.priceOfficial ?? false) : undefined,
  };
}

function findEffective(id: string) {
  const item = getEffectiveMedicines().find((entry) => entry.medicine.id === id);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Produit introuvable." });
  return item;
}

/** Catégories (intitulés d'origine) avec leurs sous-catégories et le nombre de produits. */
function listMedicineCategories() {
  const categories = new Map<string, { original: string; label: string; productTypes: Set<string>; count: number; subcategories: Map<string, { original: string; label: string; count: number }> }>();
  for (const { medicine } of getEffectiveMedicines()) {
    if (!medicine.category) continue;
    const labelled = relabelMedicine(medicine);
    const entry = categories.get(medicine.category) ?? { original: medicine.category, label: labelled.category ?? medicine.category, productTypes: new Set<string>(), count: 0, subcategories: new Map() };
    entry.count += 1;
    if (medicine.productType) entry.productTypes.add(medicine.productType);
    if (medicine.subcategory) {
      const sub = entry.subcategories.get(medicine.subcategory) ?? { original: medicine.subcategory, label: labelled.subcategory ?? medicine.subcategory, count: 0 };
      sub.count += 1;
      entry.subcategories.set(medicine.subcategory, sub);
    }
    categories.set(medicine.category, entry);
  }
  const natural = (left: string, right: string) => left.localeCompare(right, "fr", { numeric: true });
  return [...categories.values()]
    .sort((left, right) => natural(left.original, right.original))
    .map((entry) => ({ ...entry, productTypes: [...entry.productTypes], subcategories: [...entry.subcategories.values()].sort((left, right) => natural(left.original, right.original)) }));
}

async function writeMedicineOverride(db: Database, id: string, values: { data: MedicineEdit; hidden: boolean; added: boolean }, actorUserId: number) {
  const row = { data: JSON.stringify(values.data), hidden: values.hidden, added: values.added, updatedBy: actorUserId };
  await db
    .insert(medicineOverrides)
    .values({ id, ...row })
    .onDuplicateKeyUpdate({ set: row });
}

/** Identifiant d'un produit ajouté depuis la console : « console-paracetamol-500-mg-k3f9 ». */
function newMedicineId(name: string, dosage?: string | null) {
  return `console-${slugify(`${name} ${dosage ?? ""}`).slice(0, 120)}-${Math.random().toString(36).slice(2, 6)}`;
}

const medicinesRouter = router({
  list: adminProcedure.input(medicineListSchema).query(async ({ input }) => {
    await getContentConfig();
    const all = getAdminMedicines();
    const filtered = filterMedicines(all, input);
    const start = (input.page - 1) * input.limit;
    const scope = input.productType ? all.filter((item) => item.productType === input.productType) : all;
    return {
      items: filtered.slice(start, start + input.limit),
      total: filtered.length,
      page: input.page,
      limit: input.limit,
      counts: {
        total: all.length,
        hidden: all.filter((item) => item.hidden).length,
        modified: all.filter((item) => item.source === "modified").length,
        added: all.filter((item) => item.source === "added").length,
        withoutPrice: all.filter((item) => !item.hidden && item.priceApprox === undefined).length,
      },
      categories: [...new Set(scope.map((item) => item.category).filter((value): value is string => !!value))].sort((left, right) => left.localeCompare(right, "fr", { numeric: true })),
      productTypes: MEDICINE_PRODUCT_TYPES,
    };
  }),

  export: adminProcedure.input(medicineListSchema.omit({ page: true, limit: true })).query(async ({ input }) => {
    await getContentConfig();
    return filterMedicines(getAdminMedicines(), { ...input, page: 1, limit: 1 });
  }),

  save: adminProcedure.input(medicineSaveSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await reloadContentConfig();
    const edit = toEdit(input);
    if (input.id) {
      const current = findEffective(input.id);
      // Les catégories saisies sont les intitulés affichés : un intitulé renommé est ramené à
      // l'original pour que le produit suive les prochains renommages.
      const labelled = current.base ? relabelMedicine(current.base) : null;
      if (current.base && labelled) {
        if (edit.category === labelled.category) edit.category = current.base.category;
        if (edit.subcategory === labelled.subcategory) edit.subcategory = current.base.subcategory;
      }
      const data = current.source === "added" ? medicineEditBetween(null, edit) : medicineEditBetween(current.base, edit);
      await writeMedicineOverride(db, input.id, { data, hidden: current.hidden, added: current.source === "added" }, ctx.user.id);
      await writeAudit(db, { actorUserId: ctx.user.id, action: "medicines.updated", targetType: "medicine", targetId: input.id, metadata: { name: input.name, fields: Object.keys(data).join(", ") || "aucun" } });
      await reloadContentConfig();
      return { id: input.id };
    }
    const id = newMedicineId(input.name, input.dosage);
    await writeMedicineOverride(db, id, { data: medicineEditBetween(null, edit), hidden: false, added: true }, ctx.user.id);
    await writeAudit(db, { actorUserId: ctx.user.id, action: "medicines.added", targetType: "medicine", targetId: id, metadata: { name: input.name, productType: input.productType } });
    await reloadContentConfig();
    return { id };
  }),

  setHidden: adminProcedure.input(medicineIdSchema.extend({ hidden: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await reloadContentConfig();
    const current = findEffective(input.id);
    const data = current.source === "added" ? medicineEditBetween(null, current.medicine) : current.base ? medicineEditBetween(current.base, current.medicine) : {};
    await writeMedicineOverride(db, input.id, { data, hidden: input.hidden, added: current.source === "added" }, ctx.user.id);
    await writeAudit(db, { actorUserId: ctx.user.id, action: input.hidden ? "medicines.hidden" : "medicines.shown", targetType: "medicine", targetId: input.id, metadata: { name: current.medicine.name } });
    await reloadContentConfig();
    return { id: input.id, hidden: input.hidden };
  }),

  /** Produit du catalogue : retour à la version d'origine. Produit ajouté : suppression. */
  reset: adminProcedure.input(medicineIdSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await reloadContentConfig();
    const current = findEffective(input.id);
    await db.delete(medicineOverrides).where(eq(medicineOverrides.id, input.id));
    await writeAudit(db, { actorUserId: ctx.user.id, action: current.source === "added" ? "medicines.deleted" : "medicines.reset", targetType: "medicine", targetId: input.id, metadata: { name: current.medicine.name } });
    await reloadContentConfig();
    return { id: input.id, deleted: current.source === "added" };
  }),

  categories: adminProcedure.query(async () => {
    await getContentConfig();
    return listMedicineCategories();
  }),

  renameCategory: adminProcedure
    .input(z.object({ level: z.enum(["category", "subcategory"]), original: z.string().trim().min(1).max(255), label: z.string().trim().min(2).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const known = listMedicineCategories().some((category) => (input.level === "category" ? category.original === input.original : category.subcategories.some((sub) => sub.original === input.original)));
      if (!known) throw new TRPCError({ code: "NOT_FOUND", message: "Catégorie introuvable." });
      if (input.label === input.original) {
        await db.delete(medicineCategoryLabels).where(and(eq(medicineCategoryLabels.level, input.level), eq(medicineCategoryLabels.original, input.original)));
      } else {
        await db
          .insert(medicineCategoryLabels)
          .values({ level: input.level, original: input.original, label: input.label, updatedBy: ctx.user.id })
          .onDuplicateKeyUpdate({ set: { label: input.label, updatedBy: ctx.user.id } });
      }
      await writeAudit(db, { actorUserId: ctx.user.id, action: "medicines.category_renamed", targetType: "medicine_category", targetId: input.original.slice(0, 120), metadata: { level: input.level, label: input.label } });
      await reloadContentConfig();
      return { ok: true };
    }),
});

// ——— Assurances ———

const insurersRouter = router({
  list: adminProcedure.query(async () => {
    const db = await requireDb();
    const config = await getContentConfig();
    const merged = await readMergedDirectory(db);
    const counts = new Map<string, number>();
    for (const item of merged) {
      if (item.status !== "active") continue;
      for (const id of item.insurances) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return config.insurers.map((insurer) => ({ ...insurer, establishments: counts.get(insurer.id) ?? 0 }));
  }),

  save: adminProcedure
    .input(z.object({ id: z.string().regex(INSURER_ID_PATTERN).optional(), label: z.string().trim().min(2).max(96), active: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const config = await getContentConfig();
      const labelTaken = config.insurers.find((insurer) => insurer.id !== input.id && searchKey(insurer.label) === searchKey(input.label));
      if (labelTaken) throw new TRPCError({ code: "CONFLICT", message: `« ${labelTaken.label} » existe déjà.` });
      let id = input.id;
      if (id) {
        if (!config.insurers.some((insurer) => insurer.id === id)) throw new TRPCError({ code: "NOT_FOUND", message: "Assureur introuvable." });
      } else {
        id = insurerIdFromLabel(input.label);
        if (!INSURER_ID_PATTERN.test(id)) throw new TRPCError({ code: "BAD_REQUEST", message: "Nom d’assureur invalide." });
        if (config.insurers.some((insurer) => insurer.id === id)) throw new TRPCError({ code: "CONFLICT", message: "Un assureur avec ce nom existe déjà." });
      }
      await db
        .insert(insurers)
        .values({ id, label: input.label, active: input.active, updatedBy: ctx.user.id })
        .onDuplicateKeyUpdate({ set: { label: input.label, active: input.active, updatedBy: ctx.user.id } });
      await writeAudit(db, { actorUserId: ctx.user.id, action: input.id ? "insurers.updated" : "insurers.added", targetType: "insurer", targetId: id, metadata: { label: input.label, active: input.active } });
      await reloadContentConfig();
      return { id };
    }),

  /** Assureur de référence : nom et état d'origine. Assureur ajouté : suppression s'il n'est plus utilisé. */
  reset: adminProcedure.input(z.object({ id: z.string().regex(INSURER_ID_PATTERN) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const config = await getContentConfig();
    const insurer = config.insurers.find((item) => item.id === input.id);
    if (!insurer || insurer.source === "default") throw new TRPCError({ code: "NOT_FOUND", message: "Rien à rétablir pour cet assureur." });
    if (insurer.source === "added") {
      const used = (await readMergedDirectory(db)).filter((item) => item.status === "active" && item.insurances.includes(input.id)).length;
      if (used) throw new TRPCError({ code: "CONFLICT", message: `${used} établissement(s) acceptent encore cet assureur : désactivez-le plutôt.` });
    }
    await db.delete(insurers).where(eq(insurers.id, input.id));
    await writeAudit(db, { actorUserId: ctx.user.id, action: insurer.source === "added" ? "insurers.deleted" : "insurers.reset", targetType: "insurer", targetId: input.id, metadata: { label: insurer.label } });
    await reloadContentConfig();
    return { id: input.id };
  }),
});

// ——— Villes ———

const coordinates = {
  latitude: z.number().min(9).max(15.5),
  longitude: z.number().min(-6).max(2.6),
};

const citiesRouter = router({
  list: adminProcedure.query(async () => {
    const db = await requireDb();
    const [config, duty] = await Promise.all([getContentConfig(), getDutyConfig()]);
    const merged = await readMergedDirectory(db);
    const programmed = new Set(duty.rotations.map((rotation) => dutyCityKey(rotation.city)));
    const counts = new Map<string, { pharmacies: number; healthcare: number }>();
    for (const item of merged) {
      if (item.status !== "active") continue;
      const key = cityMatchKey(item.city);
      const entry = counts.get(key) ?? { pharmacies: 0, healthcare: 0 };
      if (item.kind === "pharmacy") entry.pharmacies += 1;
      else entry.healthcare += 1;
      counts.set(key, entry);
    }
    const known = new Set(config.cities.map((city) => cityMatchKey(city.name)));
    return {
      cities: config.cities.map((city) => ({ ...city, ...(counts.get(cityMatchKey(city.name)) ?? { pharmacies: 0, healthcare: 0 }), dutyProgrammed: programmed.has(dutyCityKey(city.name)) })),
      // Villes présentes dans l'annuaire mais absentes de la liste : à ajouter pour les proposer dans l'application.
      suggestions: listDirectoryCities(merged)
        .filter((city) => !known.has(cityMatchKey(city.name)))
        .map((city) => ({ name: city.name, establishments: city.count })),
    };
  }),

  save: adminProcedure
    .input(z.object({ name: z.string().trim().min(2).max(96), ...coordinates, aliases: z.array(z.string().trim().min(2).max(60)).max(12).default([]), published: z.boolean().default(true), create: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const config = await getContentConfig();
      const existing = config.cities.find((city) => cityMatchKey(city.name) === cityMatchKey(input.name));
      if (input.create && existing) throw new TRPCError({ code: "CONFLICT", message: `${existing.name} figure déjà dans la liste.` });
      if (!input.create && !existing) throw new TRPCError({ code: "NOT_FOUND", message: "Ville introuvable." });
      const name = existing?.name ?? input.name;
      if (!input.published && config.cities.filter((city) => city.published && city.name !== name).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Au moins une ville doit rester publiée." });
      }
      const aliases = [...new Set(input.aliases.map((alias) => alias.toLowerCase()))];
      const row = { latitude: input.latitude, longitude: input.longitude, aliases: aliases.length ? JSON.stringify(aliases) : null, published: input.published, updatedBy: ctx.user.id };
      await db
        .insert(cities)
        .values({ name, ...row })
        .onDuplicateKeyUpdate({ set: row });
      await writeAudit(db, { actorUserId: ctx.user.id, action: input.create ? "cities.added" : "cities.updated", targetType: "city", targetId: name, metadata: { published: input.published, latitude: input.latitude, longitude: input.longitude } });
      await reloadContentConfig();
      return { name };
    }),

  /** Ville de référence : centre et publication d'origine. Ville ajoutée : retirée de la liste. */
  reset: adminProcedure.input(z.object({ name: z.string().trim().min(2).max(96) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const config = await getContentConfig();
    const city = config.cities.find((item) => item.name === input.name);
    if (!city || city.source === "default") throw new TRPCError({ code: "NOT_FOUND", message: "Rien à rétablir pour cette ville." });
    await db.delete(cities).where(eq(cities.name, input.name));
    await writeAudit(db, { actorUserId: ctx.user.id, action: city.source === "added" ? "cities.deleted" : "cities.reset", targetType: "city", targetId: input.name });
    await reloadContentConfig();
    return { name: input.name };
  }),
});

// ——— Annonces ———

const announcementSchema = z
  .object({
    id: z.number().int().positive().optional(),
    city: z
      .string()
      .trim()
      .max(96)
      .nullish()
      .transform((value) => value || null),
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(600),
    tone: z.enum(["info", "warning", "danger"]).default("info"),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullish(),
    active: z.boolean().default(true),
  })
  .refine((input) => !input.endsAt || input.endsAt.getTime() > input.startsAt.getTime(), { message: "La fin doit suivre le début.", path: ["endsAt"] });

function announcementStatus(row: { active: boolean; startsAt: Date | string; endsAt: Date | string | null }, now = new Date()) {
  if (!row.active) return "disabled" as const;
  if (new Date(row.startsAt).getTime() > now.getTime()) return "scheduled" as const;
  if (row.endsAt && new Date(row.endsAt).getTime() <= now.getTime()) return "ended" as const;
  return "live" as const;
}

const announcementsRouter = router({
  list: adminProcedure.query(async () => {
    const config = await getContentConfig();
    const order = { live: 0, scheduled: 1, disabled: 2, ended: 3 } as const;
    return config.announcements
      .map((row) => ({
        id: row.id,
        city: row.city,
        title: row.title,
        body: row.body,
        tone: row.tone,
        active: row.active,
        startsAt: new Date(row.startsAt).toISOString(),
        endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
        updatedAt: new Date(row.updatedAt).toISOString(),
        status: announcementStatus(row),
      }))
      .sort((left, right) => order[left.status] - order[right.status] || right.startsAt.localeCompare(left.startsAt));
  }),

  save: adminProcedure.input(announcementSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const config = await getContentConfig();
    if (input.city && !config.cities.some((city) => city.name === input.city)) throw new TRPCError({ code: "BAD_REQUEST", message: "Ville inconnue." });
    const values = { city: input.city, title: input.title, body: input.body, tone: input.tone, startsAt: input.startsAt, endsAt: input.endsAt ?? null, active: input.active };
    let id = input.id;
    if (id) {
      if (!config.announcements.some((row) => row.id === id)) throw new TRPCError({ code: "NOT_FOUND", message: "Annonce introuvable." });
      await db.update(announcements).set(values).where(eq(announcements.id, id));
    } else {
      const [result] = await db.insert(announcements).values({ ...values, createdBy: ctx.user.id });
      id = Number((result as { insertId?: number }).insertId ?? 0) || undefined;
    }
    await writeAudit(db, { actorUserId: ctx.user.id, action: input.id ? "announcements.updated" : "announcements.created", targetType: "announcement", targetId: id ? String(id) : null, metadata: { title: input.title, city: input.city ?? "toutes", active: input.active } });
    await reloadContentConfig();
    return { id: id ?? null };
  }),

  remove: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const config = await getContentConfig();
    const row = config.announcements.find((item) => item.id === input.id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Annonce introuvable." });
    await db.delete(announcements).where(eq(announcements.id, input.id));
    await writeAudit(db, { actorUserId: ctx.user.id, action: "announcements.deleted", targetType: "announcement", targetId: String(input.id), metadata: { title: row.title } });
    await reloadContentConfig();
    return { id: input.id };
  }),
});

// ——— Formules Premium ———

const planIdSchema = z.enum(PREMIUM_PLAN_IDS as [(typeof PREMIUM_PLAN_IDS)[number], ...(typeof PREMIUM_PLAN_IDS)[number][]]);

const plansRouter = router({
  list: adminProcedure.query(async () => {
    const db = await requireDb();
    const config = await getContentConfig();
    const sales = await db
      .select({ planId: transactions.planId, count: count(), revenue: sum(transactions.amount) })
      .from(transactions)
      .where(and(eq(transactions.status, "success"), sql`${transactions.provider} <> 'admin'`))
      .groupBy(transactions.planId);
    const byPlan = new Map(sales.map((row) => [row.planId, { count: Number(row.count ?? 0), revenue: Number(row.revenue ?? 0) }]));
    return premiumPlansWithStatus(config.planRows).map((plan) => ({ ...plan, sales: byPlan.get(plan.id)?.count ?? 0, revenue: byPlan.get(plan.id)?.revenue ?? 0 }));
  }),

  save: adminProcedure
    .input(z.object({ id: planIdSchema, label: z.string().trim().min(2).max(64), amount: z.number().int().min(100).max(1_000_000), durationDays: z.number().int().min(1).max(730), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const config = await getContentConfig();
      const others = premiumPlansWithStatus(config.planRows).filter((plan) => plan.id !== input.id && plan.active);
      if (!input.active && others.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Au moins une formule doit rester proposée." });
      const row = { label: input.label, amount: input.amount, durationDays: input.durationDays, active: input.active, updatedBy: ctx.user.id };
      await db
        .insert(premiumPlans)
        .values({ id: input.id, ...row })
        .onDuplicateKeyUpdate({ set: row });
      await writeAudit(db, { actorUserId: ctx.user.id, action: "plans.updated", targetType: "plan", targetId: input.id, metadata: { label: input.label, amount: input.amount, durationDays: input.durationDays, active: input.active } });
      await reloadContentConfig();
      return { id: input.id };
    }),

  reset: adminProcedure.input(z.object({ id: planIdSchema })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await db.delete(premiumPlans).where(eq(premiumPlans.id, input.id));
    await writeAudit(db, { actorUserId: ctx.user.id, action: "plans.reset", targetType: "plan", targetId: input.id });
    await reloadContentConfig();
    return { id: input.id };
  }),
});

export const contentRouters = {
  medicines: medicinesRouter,
  insurers: insurersRouter,
  cities: citiesRouter,
  announcements: announcementsRouter,
  plans: plansRouter,
};

