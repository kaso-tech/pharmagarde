import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const screen = readFileSync("app/pharmagarde/contribution/nouvel-etablissement.tsx", "utf8");
const picker = readFileSync("components/pharmagarde/location-picker-view.tsx", "utf8");

describe("contribution · nouvel établissement", () => {
  it("propose le type Pharmacie ou Centre de santé", () => {
    expect(screen).toContain("Nouvel établissement");
    expect(screen).toContain('{ value: "pharmacy", label: "Pharmacie"');
    expect(screen).toContain('{ value: "healthcare", label: "Centre de santé"');
  });

  it("récupère les coordonnées en touchant la carte, et les exige avant l'envoi", () => {
    expect(screen).toContain("<LocationPicker");
    expect(screen).toContain("!!form.location");
    expect(picker).toContain('"use dom"');
    expect(picker).toContain('map.on("click"');
    expect(picker).toContain("draggable: true");
  });

  it("rend les horaires de service facultatifs", () => {
    expect(screen).toContain("Horaires de service (facultatif)");
    expect(screen).toContain("withHours: false");
    expect(screen).toContain("<WeeklyHoursEditor");
  });
});
