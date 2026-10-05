import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("C6 · imagerie satellite sous licence uniquement", () => {
  it("masque le mode satellite et retombe sur le plan sans fournisseur configuré", async () => {
    vi.stubEnv("EXPO_PUBLIC_MAPLIBRE_SATELLITE_STYLE_URL", "");
    const config = await import("../lib/pharmagarde/map-config");
    expect(config.MAP_SATELLITE_STYLE_URL).toBeNull();
    expect(config.availableMapPreferences()).toEqual(["Standard"]);
    expect(config.effectiveMapPreference("Satellite")).toBe("Standard");
  });

  it("propose le satellite quand un style sous licence est fourni", async () => {
    vi.stubEnv("EXPO_PUBLIC_MAPLIBRE_SATELLITE_STYLE_URL", "https://api.maptiler.com/maps/hybrid/style.json?key=test");
    const config = await import("../lib/pharmagarde/map-config");
    expect(config.availableMapPreferences()).toEqual(["Standard", "Satellite"]);
    expect(config.effectiveMapPreference("Satellite")).toBe("Satellite");
  });

  it("ne charge plus aucune tuile Esri", () => {
    const view = readFileSync("components/pharmagarde/maplibre-view.tsx", "utf8");
    expect(view).not.toMatch(/arcgisonline|Esri/);
  });
});

describe("C7 · style de secours si le fond de carte principal est indisponible", () => {
  it("utilise un fournisseur distinct d'OpenFreeMap par défaut", async () => {
    const config = await import("../lib/pharmagarde/map-config");
    expect(new URL(config.MAP_FALLBACK_STYLE_URL).host).not.toBe(new URL(config.MAP_STYLE_URL).host);
  });

  it("bascule vers le style de secours sur erreur avant le premier chargement", () => {
    const view = readFileSync("components/pharmagarde/maplibre-view.tsx", "utf8");
    expect(view).toContain('map.on("error"');
    expect(view).toContain("map.setStyle(fallback)");
    expect(view).toContain("if (styleLoaded || usedFallback");
  });
});

describe("C5 · avertissement médical", () => {
  it("s'affiche en tête du catalogue et sur chaque fiche médicament", () => {
    const ui = readFileSync("components/pharmagarde/app-ui.tsx", "utf8");
    const screen = readFileSync("app/(tabs)/medicaments.tsx", "utf8");
    expect(ui).toContain("ne remplace pas l’avis d’un médecin ou d’un pharmacien");
    expect(ui.slice(ui.indexOf("export function MedicineCard"))).toContain("<MedicalDisclaimer compact />");
    expect(screen).toContain("<MedicalDisclaimer />");
  });
});
