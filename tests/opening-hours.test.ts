import { describe, expect, it } from "vitest";

import { DEFAULT_WEEKLY_HOURS, formatWeeklyHours, isOpenAt, parseWeeklyHours, validateWeeklyHours, type WeeklyHours } from "../lib/pharmagarde/opening-hours";
import { placeHoursLabel, placeStatusLabel } from "../lib/pharmagarde/place-ordering";
import { directoryUpsertSchema, normalizeDirectoryUpsert } from "../server/admin-directory";
import { withServiceStatus, type CachedHealthPlace } from "../server/pharmagarde-cache";

// Le Burkina Faso est à UTC+0 : les heures UTC sont les heures locales.
const monday10h = new Date("2026-10-05T10:00:00Z");
const monday21h = new Date("2026-10-05T21:00:00Z");
const saturday11h = new Date("2026-10-10T11:00:00Z");
const saturday13h = new Date("2026-10-10T13:00:00Z");
const sunday10h = new Date("2026-10-11T10:00:00Z");

describe("horaires de service", () => {
  it("applique par défaut lundi–vendredi 8 h–20 h, samedi 8 h–12 h, dimanche fermé", () => {
    expect(isOpenAt(DEFAULT_WEEKLY_HOURS, monday10h)).toBe(true);
    expect(isOpenAt(DEFAULT_WEEKLY_HOURS, new Date("2026-10-05T20:00:00Z"))).toBe(false);
    expect(isOpenAt(DEFAULT_WEEKLY_HOURS, monday21h)).toBe(false);
    expect(isOpenAt(DEFAULT_WEEKLY_HOURS, saturday11h)).toBe(true);
    expect(isOpenAt(DEFAULT_WEEKLY_HOURS, saturday13h)).toBe(false);
    expect(isOpenAt(DEFAULT_WEEKLY_HOURS, sunday10h)).toBe(false);
    expect(formatWeeklyHours(DEFAULT_WEEKLY_HOURS)).toBe("Lun–Ven 8 h–20 h · Sam 8 h–12 h · Dim fermé");
  });

  it("refuse des heures invalides, inversées ou qui se chevauchent", () => {
    const withDay = (ranges: WeeklyHours["mon"]) => ({ ...DEFAULT_WEEKLY_HOURS, mon: ranges });
    expect(validateWeeklyHours(withDay([{ open: "8h", close: "20:00" }]))).toMatch(/Lundi/);
    expect(validateWeeklyHours(withDay([{ open: "20:00", close: "08:00" }]))).toMatch(/fermeture/);
    expect(validateWeeklyHours(withDay([{ open: "08:00", close: "13:00" }, { open: "12:00", close: "18:00" }]))).toMatch(/chevauchent/);
    expect(validateWeeklyHours(withDay([{ open: "08:00", close: "12:30" }, { open: "15:00", close: "19:00" }]))).toBeNull();
    expect(parseWeeklyHours(JSON.stringify(DEFAULT_WEEKLY_HOURS))).toEqual(DEFAULT_WEEKLY_HOURS);
    expect(parseWeeklyHours("pas du json")).toBeNull();
  });

  it("enregistre les horaires propres d'une fiche, ou null pour suivre la ville", () => {
    const common = { kind: "healthcare" as const, city: "Ouagadougou", name: "CSPS Test" };
    expect(directoryUpsertSchema.safeParse({ ...common, openingHours: { ...DEFAULT_WEEKLY_HOURS, sun: [{ open: "09:00", close: "08:00" }] } }).success).toBe(false);
    const parsed = directoryUpsertSchema.parse({ ...common, openingHours: DEFAULT_WEEKLY_HOURS });
    expect(JSON.parse(normalizeDirectoryUpsert(parsed).openingHours!)).toEqual(DEFAULT_WEEKLY_HOURS);
    expect(normalizeDirectoryUpsert(directoryUpsertSchema.parse(common)).openingHours).toBeNull();
  });
});

describe("trois statuts : de garde, ouvert, fermé", () => {
  const ouagaLate: WeeklyHours = { ...DEFAULT_WEEKLY_HOURS, mon: [{ open: "08:00", close: "22:00" }] };
  const hoursFor = (city: string | undefined) => (city === "Ouagadougou" ? ouagaLate : DEFAULT_WEEKLY_HOURS);
  const items: CachedHealthPlace[] = [
    // Semaine du 3 au 10 octobre 2026 : groupe 4 de garde.
    { id: "garde", type: "Pharmacie", category: "pharmacy", name: "De garde", city: "Bobo-Dioulasso", dutyGroup: 4 },
    { id: "pas-garde", type: "Pharmacie", category: "pharmacy", name: "Groupe 2", city: "Bobo-Dioulasso", dutyGroup: 2 },
    { id: "ville", type: "Pharmacie", category: "pharmacy", name: "Horaires de la ville", city: "Ouagadougou", dutyGroup: 1 },
    { id: "propres", type: "Clinique", category: "healthcare", name: "Clinique", city: "Bobo-Dioulasso", serviceHours: { ...DEFAULT_WEEKLY_HOURS, mon: [{ open: "00:00", close: "24:00" }] } },
  ];

  it("met une pharmacie de garde ouverte 24 h/24, les autres selon leurs horaires ou ceux de leur ville", () => {
    const status = Object.fromEntries(withServiceStatus(items, monday21h, hoursFor).map((item) => [item.id, [item.status, item.isOpen, item.customHours]]));
    expect(status).toEqual({
      garde: ["on_duty", true, false],
      "pas-garde": ["closed", false, false],
      ville: ["open", true, false],
      propres: ["open", true, true],
    });
  });

  it("publie un résumé des horaires et un libellé lisible dans l'application", () => {
    const [garde, pasGarde] = withServiceStatus(items, monday21h, hoursFor);
    expect(pasGarde?.openingHours).toBe("Lun–Ven 8 h–20 h · Sam 8 h–12 h · Dim fermé");
    expect(placeStatusLabel(garde!)).toBe("De garde");
    expect(placeStatusLabel(pasGarde!)).toBe("Fermé");
    expect(placeHoursLabel(garde!)).toBe("De garde, ouverte 24 h/24 jusqu’au samedi 10 octobre à 8 h");
  });
});
