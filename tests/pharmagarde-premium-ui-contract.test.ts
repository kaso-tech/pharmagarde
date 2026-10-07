import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

describe("premium ui contract", () => {
  it("conserve une page Carte map-first avec bottom sheet, filtres et skeleton loading", () => {
    const carte = read("app/(tabs)/carte.tsx");

    expect(carte).toContain("<PharmaMap");
    expect(carte).toContain("PanResponder.create");
    expect(carte).toContain("snap.full");
    expect(carte).toContain("snap.mid");
    expect(carte).toContain("snap.min");
    expect(carte).toContain("SkeletonCard");
    expect(carte).toContain("local-pharmacy");
    expect(carte).toContain("local-hospital");
    expect(carte).toContain("directions");
    expect(carte).toContain("favorite");
  });

  it("applique un shell premium global avec drawer animé, blur et transitions", () => {
    const shell = read("components/pharmagarde/app-shell.tsx");

    expect(shell).toContain("BlurView");
    expect(shell).toContain("DrawerOverlay");
    expect(shell).toContain("DrawerBackdrop");
    expect(shell).toContain('Platform.OS === "android"');
    expect(shell).toContain("Animated.timing");
    // Plus de fondu du contenu à chaque changement d'écran : le cadre des onglets est monté une fois.
    expect(shell).not.toContain("contentOpacity");
    expect(shell).toContain("export function TabsShell");
    expect(shell).toContain("usePremiumPalette");
    expect(shell).toContain("haptic.light");
  });

  it("évite l’imbrication du shell global dans le layout des onglets", () => {
    const tabsLayout = read("app/(tabs)/_layout.tsx");
    const appUi = read("components/pharmagarde/app-ui.tsx");

    expect(tabsLayout).not.toContain("GlobalAppShell");
    expect(tabsLayout).toContain("<TabsShell>");
    expect(read("components/pharmagarde/app-shell.tsx")).toContain("if (insideTabs) return <>{props.children}</>;");
    expect(appUi).toContain("return <GlobalAppShell subtitle={subtitle} hideHeaderSearch={hideHeaderSearch}>{children}</GlobalAppShell>;");
  });

  it("centralise la palette et les haptics premium autour du vert PharmaGarde", () => {
    const premiumUi = read("lib/pharmagarde/premium-ui.ts");
    const theme = read("theme.config.js");

    expect(premiumUi).toContain("#008000");
    expect(premiumUi).toContain("usePremiumPalette");
    expect(premiumUi).toContain("ImpactFeedbackStyle.Light");
    expect(premiumUi).toContain("selectionAsync");
    expect(theme).toContain("#008000");
    expect(theme).toContain("#101512");
  });
});

describe("cartes médicaments", () => {
  it("force le format FCFA et masque les détails jusqu’au clic", () => {
    const appUi = read("components/pharmagarde/app-ui.tsx");

    expect(appUi).toContain("export function formatMedicinePrice");
    expect(appUi).toContain("toLocaleString(\"fr-FR\")} FCFA");
    expect(appUi).toContain("const [expanded, setExpanded] = useState(false)");
    expect(appUi).toContain("setExpanded((current) => !current)");
    expect(appUi).toContain("{expanded ? (");
    expect(appUi).toContain("styles.medicineDetails");
  });
});

describe("cartes pharmacies et cliniques", () => {
  it("place la distance en haut à droite et replie favori, note, téléphone et boutons jusqu’au clic", () => {
    const appUi = read("components/pharmagarde/app-ui.tsx");
    const carte = read("app/(tabs)/carte.tsx");
    const api = read("lib/pharmagarde/api.ts");
    const types = read("lib/pharmagarde/types.ts");
    const placeCard = appUi.slice(appUi.indexOf("export function PlaceCard"), appUi.indexOf("export function MedicineCard"));
    const mapPlaceCard = carte.slice(carte.indexOf("function MapPlaceCard"), carte.indexOf("export default function CarteScreen"));

    expect(placeCard).toContain("styles.placeHeaderMeta");
    expect(placeCard.indexOf("styles.placeHeaderMeta")).toBeLessThan(placeCard.indexOf("{isExpanded ? ("));
    expect(placeCard).toContain("isExpanded: boolean");
    expect(placeCard).toContain("onToggle: () => void");
    expect(placeCard).toContain("onPress={() => { haptic.selection(); onToggle(); }}");
    expect(placeCard).not.toContain("const [expanded, setExpanded] = useState(false)");
    expect(placeCard).toContain("styles.placeInfoRow");
    expect(placeCard).toContain("ratingLabel");
    expect(placeCard).toContain("phoneLabel");
    expect(placeCard).toContain("local-pharmacy");
    expect(placeCard).toContain("local-hospital");
    expect(placeCard.indexOf("favorite-border")).toBeGreaterThan(placeCard.indexOf("{isExpanded ? ("));
    expect(placeCard).toContain("localPlaceTypeLabel(place)");
    expect(placeCard).toContain("const typeLabel = localPlaceTypeLabel(place)");
    expect(appUi).toContain("return place.establishmentType ??");
    expect(appUi).not.toContain('return "Type local";');
    expect(placeCard.indexOf("{typeLabel}")).toBeGreaterThan(placeCard.indexOf("favorite-border"));
    expect(placeCard.indexOf("{typeLabel}")).toBeLessThan(placeCard.indexOf('name="star"'));
    expect(mapPlaceCard).toContain("styles.placeHeaderMeta");
    expect(mapPlaceCard.indexOf("styles.placeHeaderMeta")).toBeLessThan(mapPlaceCard.indexOf("{isExpanded ? ("));
    expect(mapPlaceCard).toContain("place.distanceLabel");
    expect(mapPlaceCard).toContain("Distance indisponible");
    expect(mapPlaceCard).not.toContain("Distance inconnue");
    expect(mapPlaceCard).not.toContain("Position à préciser");
    expect(placeCard).toContain("place.distanceLabel");
    expect(placeCard).toContain("Distance indisponible");
    expect(placeCard).not.toContain("Distance inconnue");
    expect(placeCard).not.toContain("Position à préciser");
    // Libellé commun (garde, ouvert, fermé, statut inconnu) : lib/pharmagarde/place-ordering.ts.
    expect(mapPlaceCard).toContain("placeStatusLabel(place)");
    expect(read("lib/pharmagarde/place-ordering.ts")).toContain("Statut inconnu");
    expect(mapPlaceCard).toContain("isExpanded: boolean");
    expect(mapPlaceCard).toContain("onToggle: () => void");
    expect(mapPlaceCard).not.toContain("const [expanded, setExpanded] = useState(false)");
    expect(mapPlaceCard).toContain("styles.placeInfoRow");
    expect(mapPlaceCard).toContain("ratingLabel");
    expect(mapPlaceCard).toContain("phoneLabel");
    expect(mapPlaceCard).toContain("localPlaceTypeLabel(place)");
    expect(mapPlaceCard).toContain("const typeLabel = localPlaceTypeLabel(place)");
    expect(mapPlaceCard).toContain("local-pharmacy");
    expect(mapPlaceCard).toContain("local-hospital");
    expect(mapPlaceCard.indexOf("{typeLabel}")).toBeGreaterThan(mapPlaceCard.indexOf("favorite-border"));
    expect(mapPlaceCard.indexOf("{typeLabel}")).toBeLessThan(mapPlaceCard.indexOf('name="star"'));
    expect(appUi).toContain("localPlaceTypeLabel(place: HealthPlace)");
    expect(api).toContain('establishmentType: getString(raw, ["establishmentType", "establishment_type", "typeEtablissement", "type_etablissement", "localType", "local_type", "type"])');
    expect(types).toContain("establishmentType?: string");
    expect(appUi).toContain("compactInfoText: { fontSize: 10, lineHeight: 12");
    expect(appUi).toContain("typeInfoPill: { flexShrink: 1, maxWidth: 108 }");
    expect(carte).toContain("compactInfoText: { fontSize: 10, lineHeight: 12");
    expect(carte).toContain("typeInfoPill: { flexShrink: 1, maxWidth: 108 }");
  });

  it("contrôle l’ouverture depuis le parent pour garantir un accordion exclusif", () => {
    const index = read("app/(tabs)/index.tsx");
    const clinics = read("app/(tabs)/cliniques.tsx");
    const carte = read("app/(tabs)/carte.tsx");

    for (const source of [index, clinics, carte]) {
      expect(source).toContain("const [expandedPlaceId, setExpandedPlaceId] = useState<string | undefined>();");
      expect(source).toContain("isExpanded={expandedPlaceId === itemKey}");
      expect(source).toContain("setExpandedPlaceId((current) => current === itemKey ? undefined : itemKey)");
    }
  });

  it("affiche toutes les pharmacies disponibles sur l’accueil sans limitation artificielle", () => {
    const index = read("app/(tabs)/index.tsx");

    expect(index).toContain("data={pharmacies}");
    expect(index).not.toContain("pharmacies.slice(");
  });

  it("calcule localement les distances depuis une referenceLocation valide et affiche un fallback explicite", () => {
    const appState = read("lib/pharmagarde/app-state.tsx");
    const referenceLocation = read("lib/pharmagarde/reference-location.ts");
    const cityCoordinates = read("lib/pharmagarde/city-coordinates.ts");
    const cityUtils = read("lib/pharmagarde/city-utils.ts");
    const types = read("lib/pharmagarde/types.ts");

    expect(appState).toContain("const referenceLocation = useMemo(() => resolveReferenceLocation");
    expect(appState).toContain("fetchPharmacies(apiBaseUrl, referenceLocation, activeCity, requestOptions)");
    expect(appState).toContain("fetchClinics(apiBaseUrl, referenceLocation, activeCity, requestOptions)");
    expect(appState).toContain("resolveReferenceLocation({ selectedCity, userLocation })");
    expect(appState).toContain("withLocalDistances(filterPlacesByCity(pharmacyResult.value, activeCity), referenceLocation)");
    expect(appState).toContain("distanceKm(origin");
    expect(appState).toContain("distanceLabel: `${roundedDistanceKm.toFixed(1)} km`");
    expect(appState).toContain("DISTANCE_UNAVAILABLE_LABEL");
    expect(appState).not.toContain("getDefaultLocationFallback(activeCity).location");
    expect(referenceLocation).toContain("export function resolveReferenceLocation");
    expect(referenceLocation).not.toContain("isManualCitySelection");
    expect(referenceLocation).toContain("if (hasValidReferenceCoordinates(userLocation))");
    expect(referenceLocation).toContain("getKnownCityCoordinates(selectedCity)");
    expect(referenceLocation).toContain("DISTANCE_UNAVAILABLE_LABEL = \"Distance indisponible\"");
    expect(cityCoordinates).toContain("Ouagadougou");
    expect(cityCoordinates).toContain("Bobo-Dioulasso");
    expect(cityCoordinates).toContain("Manga");
    expect(cityUtils).toContain("export function distanceKm");
    expect(types).toContain("distanceLabel?: string");
  });
});

describe("assets Expo et icônes locales", () => {
  it("normalise les URL d’assets invalides et précharge localement MaterialIcons", () => {
    const expoAssets = read("lib/pharmagarde/expo-assets.ts");
    const rootLayout = read("app/_layout.tsx");
    const metroConfig = read("metro.config.js");
    const packageJson = read("package.json");

    expect(expoAssets).toContain("normalizeExpoAssetUri");
    expect(expoAssets).toContain("parsed.hostname === \"8081\"");
    expect(expoAssets).toContain("Asset.prototype.downloadAsync");
    expect(expoAssets).toContain("Font.loadAsync(MaterialIcons.font)");
    expect(expoAssets).toContain("getBrowserOrigin");
    expect(rootLayout).toContain("preloadLocalIconAssets");
    expect(rootLayout).toContain("installExpoAssetUriFix");
    expect(metroConfig).toContain("config.resolver.assetExts");
    expect(metroConfig).toContain("\"ttf\"");
    expect(packageJson).toContain("dev:metro:clean");
  });
});

describe("page Recherche", () => {
  it("ouvre le champ actif, masque la recherche du header et réutilise les cartes de liste", () => {
    const search = read("app/pharmagarde/search.tsx");
    const appUi = read("components/pharmagarde/app-ui.tsx");
    const shell = read("components/pharmagarde/app-shell.tsx");

    expect(search).toContain("const inputRef = useRef<TextInput | null>(null)");
    expect(search).toContain("inputRef.current?.focus()");
    expect(search).toContain("<SearchField inputRef={inputRef} autoFocus");
    expect(search).toContain("<AppChrome subtitle=\"Recherche\" hideHeaderSearch>");
    expect(search).toContain("<PlaceCard");
    expect(search).toContain("<MedicineCard");
    expect(search).not.toContain("SearchResultRow");
    expect(appUi).toContain("autoFocus={autoFocus}");
    expect(appUi).toContain("ref={inputRef}");
    expect(shell).toContain("hideHeaderSearch?: boolean");
    expect(shell).toContain("hideSearch ? (");
    expect(shell).toContain("styles.headerTitleOnly");
  });
});
