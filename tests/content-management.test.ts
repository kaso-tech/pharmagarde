import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) } }));

import type { AnnouncementRow, CityRow, InsurerRow, PremiumPlanRow } from "../drizzle/schema";
import { announcementsFor, parseAppConfig, premiumPlansOf } from "../lib/pharmagarde/app-config";
import { KNOWN_BURKINA_CITIES, PHARMAGARDE_CITIES, setPublishedCities } from "../lib/pharmagarde/city-coordinates";
import { formatInsurers, getInsurers, insurerIdFromLabel, normalizeInsurerIds, setInsurers } from "../lib/pharmagarde/insurances";
import type { Medicine } from "../lib/pharmagarde/types";
import { diffMedicinesImport } from "../server/admin-import";
import { buildCityList, buildInsurerList, buildContentConfig, currentAnnouncements } from "../server/content-config";
import { getAdminMedicines, getEffectiveMedicines, getMedicinesCatalog, getPublishedMedicines, medicineEditBetween, setMedicineOverlay } from "../server/medicines-data";
import { PREMIUM_PLANS, premiumPlansWithStatus } from "../server/premium";

const at = new Date("2026-10-08T10:00:00Z");

afterEach(() => {
  setInsurers();
  setMedicineOverlay([], []);
});

describe("villes gérées depuis la console", () => {
  const row = (name: string, extra: Partial<CityRow> = {}): CityRow => ({ name, latitude: 12, longitude: -1, aliases: null, published: true, updatedBy: 1, updatedAt: at, ...extra });

  it("garde l'ordre de référence, applique les modifications et ajoute les nouvelles villes à la fin", () => {
    const list = buildCityList([row("Koupéla", { latitude: 12.18, longitude: -0.35, aliases: '["kouritenga"]' }), row("Manga", { published: false })]);
    expect(list[0]).toMatchObject({ name: "Ouagadougou", source: "default", published: true });
    expect(list.find((city) => city.name === "Manga")).toMatchObject({ source: "modified", published: false });
    expect(list.at(-1)).toMatchObject({ name: "Koupéla", source: "added", aliases: ["kouritenga"] });
    expect(list.find((city) => city.name === "Kaya")?.aliases).toContain("sanmatenga");
  });

  it("met à jour la liste de villes de l'application", () => {
    const snapshot = [...KNOWN_BURKINA_CITIES];
    try {
      setPublishedCities([{ name: "Ouagadougou", latitude: 12.37, longitude: -1.52 }, { name: "Koupéla", latitude: 12.18, longitude: -0.35, aliases: ["Kouritenga"] }]);
      expect(PHARMAGARDE_CITIES).toEqual(["Ouagadougou", "Koupéla"]);
      expect(KNOWN_BURKINA_CITIES[0]?.aliases).toContain("ouaga");
      expect(KNOWN_BURKINA_CITIES[1]?.aliases).toEqual(["koupéla", "kouritenga"]);
    } finally {
      setPublishedCities(snapshot);
    }
  });
});

describe("assurances gérées depuis la console", () => {
  const row = (id: string, label: string, active = true): InsurerRow => ({ id, label, active, updatedBy: 1, updatedAt: at });

  it("renomme, désactive et ajoute des assureurs", () => {
    const list = buildInsurerList([row("sunu", "Sunu Assurances"), row("uab", "UAB", false), row("allianz", "Allianz")]);
    expect(list.find((insurer) => insurer.id === "sunu")).toMatchObject({ label: "Sunu Assurances", source: "modified" });
    expect(list.at(-1)).toMatchObject({ id: "allianz", source: "added", active: true });
    setInsurers(list);
    expect(normalizeInsurerIds(["uab", "sunu", "allianz"])).toEqual(["sunu", "allianz"]);
    expect(normalizeInsurerIds(["uab", "sunu"], { includeInactive: true })).toEqual(["sunu", "uab"]);
    expect(formatInsurers(["sunu", "allianz"])).toBe("Sunu Assurances, Allianz");
    expect(getInsurers().some((insurer) => insurer.id === "uab")).toBe(false);
  });

  it("dérive un identifiant lisible du nom", () => {
    expect(insurerIdFromLabel("Gras Savoye")).toBe("gras-savoye");
    expect(insurerIdFromLabel("Faari+")).toBe("faari-plus");
    expect(insurerIdFromLabel("  Société Générale Assurance ")).toBe("societe-generale-assurance");
  });
});

describe("annonces", () => {
  const row = (id: number, extra: Partial<AnnouncementRow> = {}): AnnouncementRow => ({ id, city: null, title: "Titre", body: "Texte", tone: "info", startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: null, active: true, createdBy: 1, createdAt: at, updatedAt: at, ...extra });

  it("ne publie que les annonces actives en cours", () => {
    const config = buildContentConfig({
      announcements: [row(1), row(2, { active: false }), row(3, { startsAt: new Date("2026-10-20T00:00:00Z") }), row(4, { endsAt: new Date("2026-10-05T00:00:00Z") }), row(5, { city: "Kaya", endsAt: new Date("2026-10-30T00:00:00Z") })],
    });
    expect(currentAnnouncements(config, at).map((announcement) => announcement.id)).toEqual([1, 5]);
  });

  it("filtre les annonces par ville dans l'application", () => {
    const config = parseAppConfig({
      cities: [{ name: "Kaya", latitude: 13.09, longitude: -1.08 }],
      insurers: [{ id: "sunu", label: "Sunu" }, { id: "Mauvais id", label: "x" }],
      plans: [{ id: "month", label: "1 mois", amount: 500, durationDays: 30 }, { id: "year", label: "1 an", amount: 1, durationDays: 365 }],
      announcements: [
        { id: 1, city: null, title: "Pour tous", body: "Texte", tone: "info", startsAt: "2026-10-01T00:00:00Z", endsAt: null },
        { id: 2, city: "Kaya", title: "Kaya", body: "Texte", tone: "danger", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-30T00:00:00Z" },
        { id: 3, city: "Kaya", title: "Plus tard", body: "Texte", tone: "warning", startsAt: "2026-10-20T00:00:00Z", endsAt: null },
      ],
    });
    expect(config?.insurers).toEqual([{ id: "sunu", label: "Sunu" }]);
    expect(premiumPlansOf(config)).toEqual([{ id: "month", label: "1 mois", amount: 500, durationDays: 30 }]);
    expect(announcementsFor(config, "Kaya", at).map((announcement) => announcement.id)).toEqual([1, 2]);
    expect(announcementsFor(config, "Ouagadougou", at).map((announcement) => announcement.id)).toEqual([1]);
    expect(premiumPlansOf(null)).toHaveLength(4);
  });
});

describe("formules Premium", () => {
  it("applique les valeurs de la console", () => {
    const rows: PremiumPlanRow[] = [{ id: "month", label: "1 mois", amount: 500, durationDays: 31, active: true, updatedBy: 1, updatedAt: at }, { id: "week", label: "1 semaine", amount: 200, durationDays: 7, active: false, updatedBy: 1, updatedAt: at }];
    const plans = premiumPlansWithStatus(rows);
    expect(plans.find((plan) => plan.id === "month")).toMatchObject({ amount: 500, durationDays: 31, custom: true });
    expect(plans.find((plan) => plan.id === "week")?.active).toBe(false);
    expect(plans.find((plan) => plan.id === "quarter")).toMatchObject({ ...PREMIUM_PLANS.quarter, custom: false });
  });
});

describe("catalogue des médicaments modifié depuis la console", () => {
  const [first, second] = getMedicinesCatalog().medicines;

  it("modifie, masque, ajoute et renomme les catégories", () => {
    setMedicineOverlay(
      [
        { id: first!.id, data: medicineEditBetween(first!, { ...first!, priceApprox: 999, priceMax: undefined, priceUnit: "par boîte" }), hidden: false, added: false },
        { id: second!.id, data: {}, hidden: true, added: false },
        { id: "console-nouveau", data: { name: "Nouveau produit", productType: "Médicaments adultes", priceApprox: 150 }, hidden: false, added: true },
      ],
      [{ level: "category", original: first!.category!, label: "1. ANESTHÉSIQUES" }],
    );
    const published = getPublishedMedicines();
    const edited = published.find((medicine) => medicine.id === first!.id)!;
    expect(edited).toMatchObject({ priceApprox: 999, priceUnit: "par boîte", category: "1. ANESTHÉSIQUES" });
    expect(edited.priceMax).toBeUndefined();
    expect(published.some((medicine) => medicine.id === second!.id)).toBe(false);
    expect(published.at(-1)).toMatchObject({ id: "console-nouveau", name: "Nouveau produit", type: "medicine" });
    expect(published).toHaveLength(getMedicinesCatalog().medicines.length);
    expect(getAdminMedicines().find((medicine) => medicine.id === second!.id)).toMatchObject({ hidden: true, source: "modified" });
  });

  it("n'enregistre que les champs changés", () => {
    expect(medicineEditBetween(first!, { ...first! })).toEqual({});
    expect(medicineEditBetween(first!, { ...first!, dosage: "" })).toEqual({ dosage: null });
  });

  it("compare un tableur au catalogue en vigueur", () => {
    const changed: Medicine = { ...first!, priceApprox: (first!.priceApprox ?? 0) + 100 };
    const added: Medicine = { id: "adu-999-nouveau", type: "medicine", name: "Nouveau", productType: "Médicaments adultes" };
    const current = getEffectiveMedicines().slice(0, 3);
    const diff = diffMedicinesImport([changed, second!, added], current);
    expect(diff.adds.map((medicine) => medicine.id)).toEqual(["adu-999-nouveau"]);
    expect(diff.updates).toEqual([expect.objectContaining({ changes: ["prix"] })]);
    expect(diff.unchanged).toBe(1);
    expect(diff.missing.map((item) => item.medicine.id)).toEqual([current[2]!.medicine.id]);
  });
});
