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
    const nativeMap = readProjectFile("components/pharmagarde/PharmaMap.native.tsx");
    const webMap = readProjectFile("components/pharmagarde/PharmaMap.tsx");
    const appShell = readProjectFile("components/pharmagarde/app-shell.tsx");

    expect(appConfig).not.toContain("newArchEnabled");
    expect(appConfig).not.toContain("edgeToEdgeEnabled");
    expect(nativeMap).toContain("map: StyleSheet.absoluteFill");
    expect(webMap).toContain("satelliteOverlay: StyleSheet.absoluteFill");
    expect(appShell).toContain("overlay: StyleSheet.absoluteFill");
  });
});
