import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readProjectFile = (path: string) => readFileSync(join(root, path), "utf8");
const manifest = JSON.parse(readProjectFile("package.json")) as {
  dependencies: Record<string, string | undefined>;
};

describe("compatibilité Expo Go", () => {
  it("cible le SDK actuellement supporté par Expo Go", () => {
    expect(manifest.dependencies.expo).toMatch(/^~57\./);
    expect(manifest.dependencies["expo-router"]).toMatch(/^~57\./);
    expect(manifest.dependencies["react-native"]).toBe("0.86.3");
  });

  it("utilise les entrées Expo Router de SDK 56+ au lieu de React Navigation direct", () => {
    for (const packageName of [
      "@react-navigation/bottom-tabs",
      "@react-navigation/elements",
      "@react-navigation/native",
    ]) {
      expect(manifest.dependencies[packageName]).toBeUndefined();
    }

    const hapticTab = readProjectFile("components/haptic-tab.tsx");
    expect(hapticTab).toContain('from "expo-router/react-navigation"');
    expect(hapticTab).not.toContain("@react-navigation/");
  });

  it("n’emploie plus les options et styles retirés par React Native 0.86", () => {
    const appConfig = readProjectFile("app.config.ts");
    const map = readProjectFile("components/pharmagarde/PharmaMap.tsx");
    const appShell = readProjectFile("components/pharmagarde/app-shell.tsx");

    expect(appConfig).not.toContain("newArchEnabled");
    expect(appConfig).not.toContain("edgeToEdgeEnabled");
    expect(map).toContain("map: StyleSheet.absoluteFill");
    expect(appShell).toContain("overlay: StyleSheet.absoluteFill");
  });

  it("affiche la carte avec MapLibre via un composant DOM, sans module natif ni Google Maps", () => {
    const map = readProjectFile("components/pharmagarde/PharmaMap.tsx");
    const mapView = readProjectFile("components/pharmagarde/maplibre-view.tsx");

    expect(manifest.dependencies["react-native-maps"]).toBeUndefined();
    expect(manifest.dependencies["maplibre-gl"]).toMatch(/^\^5\./);
    expect(mapView.startsWith('"use dom";')).toBe(true);
    expect(mapView).toContain('from "maplibre-gl"');
    expect(map).toContain("<MapLibreView");
    expect(`${map}\n${mapView}`).not.toMatch(/google\.maps|maps\.googleapis|react-native-maps/);
  });

  it("affiche la carte via react-native-webview (présent dans Expo Go) et l'isole en cas d'échec", () => {
    const map = readProjectFile("components/pharmagarde/PharmaMap.tsx");

    // « Can't find ViewManager 'ExpoDomWebViewModule' » : la WebView Expo par défaut n'est pas
    // dans le binaire. La version de react-native-webview doit être celle attendue par le SDK.
    expect(manifest.dependencies["react-native-webview"]).toBe("13.16.1");
    expect(map).toContain("useExpoDOMWebView: false");
    expect(map).toContain("<MapErrorBoundary");
  });
});
