import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { BlurView } from "expo-blur";
import { usePathname, useRouter } from "expo-router";
import { PropsWithChildren, ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Animated, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FavoriteBorderIcon, MenuIcon } from "@/components/pharmagarde/header-icons";
import { MenuContent } from "@/components/pharmagarde/menu-content";
import { ScreenContainer } from "@/components/screen-container";
import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";

const FOOTER_ITEMS = [
  { key: "index", href: "/", label: "Accueil", icon: "home" },
  { key: "cliniques", href: "/cliniques", label: "Cliniques", icon: "local-hospital" },
  { key: "medicaments", href: "/medicaments", label: "Médicaments", icon: "medication" },
  { key: "carte", href: "/carte", label: "Carte", icon: "map" },
] as const;

type FooterItem = (typeof FOOTER_ITEMS)[number];

type ShellProps = PropsWithChildren<{
  subtitle?: string;
  showFooter?: boolean;
  rightAccessory?: ReactNode;
  hideHeaderSearch?: boolean;
}>;

function titleForPath(pathname: string, subtitle?: string) {
  if (subtitle) return subtitle;
  if (pathname.includes("cliniques")) return "Cliniques";
  if (pathname.includes("medicaments")) return "Médicaments";
  if (pathname.includes("carte")) return "Carte";
  if (pathname.includes("favoris")) return "Favoris";
  if (pathname.includes("search")) return "Recherche";
  if (pathname.includes("abonnement")) return "Abonnement";
  if (pathname.includes("contribution")) return "Contribution";
  if (pathname.includes("info")) return "Informations";
  if (pathname.includes("ville")) return "Ville";
  if (pathname === "/" || pathname.endsWith("/index")) return "Accueil";
  return "PharmaGarde BF";
}

function isFooterActive(item: FooterItem, pathname: string) {
  if (item.key === "index") return pathname === "/" || pathname.endsWith("/(tabs)") || pathname.endsWith("/index");
  return pathname.includes(item.key);
}

function AppHeader({ title, onOpenMenu, rightAccessory, hideSearch = false }: { title: string; onOpenMenu: () => void; rightAccessory?: ReactNode; hideSearch?: boolean }) {
  const router = useRouter();
  const { loading, searchQuery } = usePharmaGarde();
  const palette = usePremiumPalette();

  const openSearch = () => {
    haptic.selection();
    router.push("/pharmagarde/search" as never);
  };

  return (
    <View style={[styles.header, { backgroundColor: palette.brand, borderBottomColor: palette.brand }]}> 
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ouvrir le menu"
        android_ripple={{ color: "rgba(0, 128, 0, 0.16)", borderless: false }}
        style={({ pressed }) => [styles.headerButton, styles.headerButtonOnGreen, pressed ? styles.pressedScale : undefined]}
        onPress={() => {
          haptic.light();
          onOpenMenu();
        }}
      >
        <MenuIcon size={24} color={palette.brand} />
      </Pressable>

      {hideSearch ? (
        <View style={styles.headerTitleOnly}>
          <Text style={styles.headerTitleText} numberOfLines={1}>{title}</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Ouvrir la recherche"
          android_ripple={{ color: "rgba(0, 128, 0, 0.12)" }}
          style={({ pressed }) => [styles.searchPill, styles.searchPillOnGreen, pressed ? styles.pressedScale : undefined]}
          onPress={openSearch}
        >
          <MaterialIcons name="search" size={20} color={palette.brand} />
          <View style={styles.searchTextWrap}>
            <Text style={[styles.searchLabel, styles.searchLabelOnGreen]} numberOfLines={1}>{searchQuery || "Rechercher pharmacies, cliniques"}</Text>
            <Text style={[styles.searchHint, styles.searchHintOnGreen]} numberOfLines={1}>{title === "Carte" ? "Autour de vous" : title}</Text>
          </View>
          {loading ? <ActivityIndicator color={palette.brand} size="small" /> : null}
        </Pressable>
      )}

      <View style={styles.headerActions}>
        {rightAccessory ?? null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ouvrir les favoris"
          android_ripple={{ color: "rgba(0, 128, 0, 0.16)", borderless: false }}
          style={({ pressed }) => [styles.headerButton, styles.headerButtonOnGreen, pressed ? styles.pressedScale : undefined]}
          onPress={() => {
            haptic.selection();
            router.push("/pharmagarde/favoris" as never);
          }}
        >
          <FavoriteBorderIcon size={23} color={palette.brand} />
        </Pressable>
      </View>
    </View>
  );
}

function AppFooter() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const palette = usePremiumPalette();
  const { isPremium } = usePharmaGarde();
  const bottomPadding = Platform.OS === "web" ? 10 : Math.max(insets.bottom, 8);

  return (
    <View style={[styles.footer, { paddingBottom: bottomPadding, backgroundColor: palette.glass, borderTopColor: palette.border }]}> 
      {FOOTER_ITEMS.map((item) => {
        const active = isFooterActive(item, pathname);
        const locked = item.key === "medicaments" && !isPremium;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            android_ripple={{ color: palette.softGreen, borderless: false }}
            style={({ pressed }) => [styles.footerItem, active ? { backgroundColor: palette.softGreen } : undefined, pressed ? styles.footerItemPressed : undefined]}
            onPress={() => {
              haptic.light();
              router.replace((locked ? "/pharmagarde/abonnement" : item.href) as never);
            }}
          >
            <View style={styles.footerIconWrap}>
              <MaterialIcons name={item.icon} size={23} color={active ? palette.brand : palette.muted} />
              {locked ? <MaterialIcons name="lock" size={11} color={palette.muted} style={styles.footerLock} /> : null}
            </View>
            <Text style={[styles.footerLabel, { color: active ? palette.brand : palette.muted }, active ? styles.footerLabelActive : undefined]} numberOfLines={1}>{locked ? "Médicaments+" : item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DrawerBackdrop({ dark }: { dark: boolean }) {
  if (Platform.OS === "android") {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: dark ? "rgba(8, 12, 10, 0.52)" : "rgba(16, 32, 22, 0.28)" }]} />;
  }

  return <BlurView pointerEvents="none" intensity={dark ? 24 : 18} tint={dark ? "dark" : "light"} style={StyleSheet.absoluteFill} />;
}

function DrawerOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const palette = usePremiumPalette();
  const [progress] = useState(() => new Animated.Value(0));
  const [mounted, setMounted] = useState(visible);
  const drawerWidth = Math.min(Math.max(width * 0.82, 320), width * 0.88, 420);
  // Monte le tiroir dès qu'il devient visible (ajustement d'état pendant le rendu, sans effet).
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      Animated.timing(progress, { toValue: 1, duration: 260, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(progress, { toValue: 0, duration: 220, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [progress, visible]);

  const overlayOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth - 18, 0] });

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}> 
        <DrawerBackdrop dark={palette.dark} />
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu" style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.drawerPanel, { width: drawerWidth, backgroundColor: palette.background, borderColor: palette.border, transform: [{ translateX }] }]}> 
        <MenuContent onClose={onClose} />
      </Animated.View>
    </View>
  );
}

/** Vrai à l'intérieur des onglets : le cadre (en-tête, pied de page) y est déjà affiché par TabsShell. */
const TabsShellContext = createContext(false);

function AppShellFrame({ children, subtitle, showFooter = true, rightAccessory, hideHeaderSearch = false }: ShellProps) {
  const pathname = usePathname();
  const palette = usePremiumPalette();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const title = useMemo(() => titleForPath(pathname, subtitle), [pathname, subtitle]);

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]} className="" containerClassName="">
      <View style={[styles.shell, { backgroundColor: palette.background }]}> 
        <AppHeader title={title} onOpenMenu={() => setDrawerVisible(true)} rightAccessory={rightAccessory} hideSearch={hideHeaderSearch} />
        <View style={[styles.content, { backgroundColor: palette.background }]}>{children}</View>
        {showFooter ? <AppFooter /> : null}
        <DrawerOverlay visible={drawerVisible} onClose={() => setDrawerVisible(false)} />
      </View>
    </ScreenContainer>
  );
}

/**
 * Cadre commun aux onglets du pied de page, monté une seule fois : changer d'onglet ne remplace que
 * le contenu, sans recréer l'en-tête ni le pied de page (ce qui faisait sauter l'écran à la première
 * ouverture de chaque onglet).
 */
export function TabsShell({ children }: PropsWithChildren) {
  return (
    <TabsShellContext.Provider value>
      <AppShellFrame>{children}</AppShellFrame>
    </TabsShellContext.Provider>
  );
}

export function GlobalAppShell(props: ShellProps) {
  const insideTabs = useContext(TabsShellContext);
  if (insideTabs) return <>{props.children}</>;
  return <AppShellFrame {...props} />;
}

export function AppChrome({ children, subtitle, hideHeaderSearch }: PropsWithChildren<{ subtitle?: string; hideHeaderSearch?: boolean }>) {
  return <GlobalAppShell subtitle={subtitle} hideHeaderSearch={hideHeaderSearch}>{children}</GlobalAppShell>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, overflow: "hidden" },
  header: {
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    gap: 10,
  },
  headerButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#092A13",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    overflow: "hidden",
  },
  headerButtonOnGreen: { backgroundColor: "#DDFBE8", borderColor: "#B7F3CE" },
  pressedScale: { opacity: 0.88, transform: [{ scale: 0.97 }] },
  searchPill: {
    flex: 1,
    minHeight: 50,
    borderRadius: 25,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#092A13",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },
  searchPillOnGreen: { backgroundColor: "#DDFBE8", borderColor: "#B7F3CE" },
  headerTitleOnly: { flex: 1, minHeight: 50, justifyContent: "center", paddingHorizontal: 8 },
  headerTitleText: { color: "#FFFFFF", fontSize: 18, lineHeight: 23, fontWeight: "900", textAlign: "center" },
  searchTextWrap: { flex: 1 },
  searchLabel: { fontSize: 14, lineHeight: 18, fontWeight: "900" },
  searchLabelOnGreen: { color: "#0D2F19" },
  searchHint: { fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 1 },
  searchHintOnGreen: { color: "rgba(13, 47, 25, 0.68)" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  content: { flex: 1 },
  footer: {
    minHeight: 66,
    paddingTop: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    shadowColor: "#092A13",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -5 },
    elevation: 12,
  },
  footerItem: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  footerItemPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  footerIconWrap: { minHeight: 24, minWidth: 28, alignItems: "center", justifyContent: "center" },
  footerLock: { position: "absolute", right: 0, top: -1 },
  footerLabel: { fontSize: 11, lineHeight: 14, fontWeight: "800" },
  footerLabelActive: { fontWeight: "900" },
  overlay: StyleSheet.absoluteFill,
  drawerPanel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: 1,
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
    shadowColor: "#020604",
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 8, height: 0 },
    elevation: 18,
  },
});
