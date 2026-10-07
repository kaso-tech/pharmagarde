import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readProjectFile = (path: string) => readFileSync(join(root, path), "utf8");

describe("drawer PharmaGarde", () => {
  it("présente les quatre sections demandées et les actions principales", () => {
    const menu = readProjectFile("components/pharmagarde/menu-content.tsx");

    for (const section of ["Références", "Contribution", "Informations", "Services"]) {
      expect(menu).toContain(`title=\"${section}\"`);
    }

    for (const label of ["Mode sombre", "Langue", "Type de carte", "Ville", "Nouvel établissement", "Signaler un problème", "Abonnement"]) {
      expect(menu).toContain(label);
    }

    expect(menu).toContain("DrawerSwitchRow");
    expect(menu).toContain("DrawerSelectionModal");
  });

  it("utilise un thème interne persistant et des modals centrés animés", () => {
    const drawerUi = readProjectFile("components/pharmagarde/drawer-ui.tsx");
    const themeProvider = readProjectFile("lib/theme-provider.tsx");
    const webSchemeHook = readProjectFile("hooks/use-color-scheme.web.ts");

    expect(drawerUi).toContain("justifyContent: \"center\"");
    expect(drawerUi).toContain("transform: [{ scale: modalScale }]");
    expect(drawerUi).toContain("StyleSheet.absoluteFill");
    expect(themeProvider).not.toContain("Appearance.setColorScheme");
    expect(webSchemeHook).toContain("useThemeContext().colorScheme");
  });

  it("relie le drawer aux écrans et préférences nécessaires", () => {
    const menu = readProjectFile("components/pharmagarde/menu-content.tsx");
    const mapScreen = readProjectFile("app/(tabs)/carte.tsx");

    expect(menu).toContain("updatePreference(\"mode\"");
    expect(menu).toContain("updatePreference(\"language\"");
    expect(menu).toContain("updatePreference(\"mapType\"");
    expect(menu).toContain("updatePreference(\"city\"");
    expect(menu).not.toContain("/pharmagarde/ville");
    expect(menu).toContain("/pharmagarde/contribution/nouvel-etablissement");
    expect(menu).toContain("/pharmagarde/contribution/signaler-probleme");
    expect(menu).toContain("/pharmagarde/info/");
    expect(menu).toContain("/pharmagarde/abonnement");
    expect(mapScreen).toContain("mapType={preferences.mapType}");
  });
});
