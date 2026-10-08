import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { PropsWithChildren, ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SignOutConfirmationModal } from "@/components/pharmagarde/sign-out-confirmation";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

import { NAV_GROUPS, SECTION_SUBTITLES, SECTION_TITLES, displayIdentity, type AdminSection } from "./shared";
import { AdminLayoutContext, DESKTOP_BREAKPOINT, LARGE_BREAKPOINT, font, radius, useAdminLayout, useAdminTheme, useViewportWidth } from "./theme";
import { Avatar, Button, PageHeader, isHovered } from "./ui";

type Identity = { name: string; detail: string };

/** Sous cette largeur, le menu latéral fixe n'affiche que les icônes (le libellé apparaît au survol). */
const COMPACT_SIDEBAR_BELOW = 1200;

function NavItem({ label, icon, active, onPress, compact }: { label: string; icon: keyof typeof MaterialIcons.glyphMap; active: boolean; onPress: () => void; compact?: boolean }) {
  const theme = useAdminTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      {...({ title: compact ? label : undefined } as object)}
      style={(state) => [styles.navItem, compact && styles.navItemCompact, active ? { backgroundColor: theme.brandSoft } : isHovered(state) && { backgroundColor: theme.surfaceMuted }]}
    >
      {active ? <View style={[styles.navIndicator, { backgroundColor: theme.brand }]} /> : null}
      <MaterialIcons name={icon} size={20} color={active ? theme.brandText : theme.textMuted} />
      {compact ? null : <Text numberOfLines={1} style={[styles.navLabel, { color: active ? theme.brandText : theme.textSecondary }, active && styles.navLabelActive]}>{label}</Text>}
    </Pressable>
  );
}

/** Menu de navigation : fixe sur bureau, dans un tiroir sur mobile. */
function Sidebar({ section, identity, onNavigate, onClose, compact = false }: { section: AdminSection; identity: Identity; onNavigate?: () => void; onClose?: () => void; compact?: boolean }) {
  const theme = useAdminTheme();
  const router = useRouter();
  const { logout } = useAuth({ autoFetch: false });
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const go = (href: string, target: AdminSection) => {
    onNavigate?.();
    if (target !== section) router.replace(href as never);
  };
  const signOut = async () => {
    setLogoutPending(true);
    try {
      await logout();
      onNavigate?.();
      router.replace("/auth/login" as never);
    } finally {
      setLogoutPending(false);
      setConfirmLogout(false);
    }
  };
  return (
    <View style={[styles.sidebar, { backgroundColor: theme.surface }]}>
      <View style={[styles.brand, compact && styles.brandCompact]}>
        <View style={[styles.brandMark, { backgroundColor: theme.brand }]}><MaterialIcons name="local-pharmacy" size={20} color="#FFFFFF" /></View>
        {compact ? null : (
          <View style={styles.flex}>
            <Text style={[styles.brandName, { color: theme.text }]}>PharmaGarde BF</Text>
            <Text style={[styles.brandSub, { color: theme.textMuted }]}>Administration</Text>
          </View>
        )}
        {onClose ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu" onPress={onClose} style={styles.closeButton}>
            <MaterialIcons name="close" size={22} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={[styles.navScroll, compact && styles.navScrollCompact]} showsVerticalScrollIndicator={false}>
        {NAV_GROUPS.map((group) => (
          <View key={group.label} style={styles.navGroup}>
            {compact ? <View style={[styles.navGroupDivider, { backgroundColor: theme.border }]} /> : <Text style={[styles.navGroupLabel, { color: theme.textMuted }]}>{group.label}</Text>}
            {group.items.map((item) => <NavItem key={item.section} compact={compact} label={item.label} icon={item.icon} active={item.section === section} onPress={() => go(item.href, item.section)} />)}
          </View>
        ))}
      </ScrollView>
      <View style={[styles.sidebarFooter, compact && styles.sidebarFooterCompact, { borderTopColor: theme.border }]}>
        <Pressable accessibilityRole="link" accessibilityLabel="Mon compte" {...({ title: compact ? "Mon compte" : undefined } as object)} onPress={() => go("/admin/compte", "account")} style={(state) => [styles.userCard, compact && styles.navItemCompact, (section === "account" || isHovered(state)) && { backgroundColor: section === "account" ? theme.brandSoft : theme.surfaceMuted }]}>
          <Avatar label={identity.name} size={36} />
          {compact ? null : (
            <>
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[styles.userName, { color: theme.text }]}>{identity.name}</Text>
                <Text numberOfLines={1} style={[styles.userDetail, { color: theme.textMuted }]}>{identity.detail}</Text>
              </View>
              <MaterialIcons name="settings" size={18} color={theme.textMuted} />
            </>
          )}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Se déconnecter" {...({ title: compact ? "Se déconnecter" : undefined } as object)} onPress={() => setConfirmLogout(true)} style={(state) => [styles.navItem, compact && styles.navItemCompact, isHovered(state) && { backgroundColor: theme.dangerSoft }]}>
          <MaterialIcons name="logout" size={20} color={theme.danger} />
          {compact ? null : <Text style={[styles.navLabel, { color: theme.danger }]}>Se déconnecter</Text>}
        </Pressable>
      </View>
      <SignOutConfirmationModal visible={confirmLogout} pending={logoutPending} onClose={() => setConfirmLogout(false)} onConfirm={() => void signOut()} />
    </View>
  );
}

function MobileDrawer({ visible, section, identity, onClose }: { visible: boolean; section: AdminSection; identity: Identity; onClose: () => void }) {
  const theme = useAdminTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu d’administration" style={[styles.drawerBackdrop, { backgroundColor: theme.overlay }]} onPress={onClose} />
        <View style={[styles.drawer, { borderRightColor: theme.border }]}>
          <Sidebar section={section} identity={identity} onNavigate={onClose} onClose={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function todayLabel() {
  const label = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return label.charAt(0).toLocaleUpperCase("fr") + label.slice(1);
}

function Topbar({ section, identity }: { section: AdminSection; identity: Identity }) {
  const theme = useAdminTheme();
  const router = useRouter();
  return (
    <View style={[styles.topbar, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
      <View style={styles.breadcrumb}>
        <Text style={[styles.breadcrumbText, { color: theme.textMuted }]}>Administration</Text>
        <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
        <Text style={[styles.breadcrumbText, styles.breadcrumbCurrent, { color: theme.text }]}>{SECTION_TITLES[section]}</Text>
      </View>
      <View style={styles.topbarRight}>
        <View style={styles.topbarDate}>
          <MaterialIcons name="calendar-today" size={16} color={theme.textMuted} />
          <Text style={[styles.breadcrumbText, { color: theme.textMuted }]}>{todayLabel()}</Text>
        </View>
        <View style={[styles.topbarDivider, { backgroundColor: theme.border }]} />
        <Pressable accessibilityRole="link" accessibilityLabel="Mon compte" onPress={() => router.replace("/admin/compte" as never)} style={(state) => [styles.topbarUser, isHovered(state) && { backgroundColor: theme.surfaceMuted }]}>
          <Avatar label={identity.name} size={32} />
          <Text numberOfLines={1} style={[styles.topbarUserName, { color: theme.text }]}>{identity.name}</Text>
          <MaterialIcons name="expand-more" size={18} color={theme.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function MobileHeader({ section, onMenu }: { section: AdminSection; onMenu: () => void }) {
  const theme = useAdminTheme();
  return (
    <View style={[styles.mobileHeader, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Ouvrir le menu d’administration" onPress={onMenu} style={[styles.menuButton, { borderColor: theme.border }]}>
        <MaterialIcons name="menu" size={22} color={theme.text} />
      </Pressable>
      <Text numberOfLines={1} accessibilityRole="header" style={[styles.mobileTitle, { color: theme.text }]}>{SECTION_TITLES[section]}</Text>
      <View style={[styles.brandMarkSmall, { backgroundColor: theme.brand }]}><MaterialIcons name="local-pharmacy" size={16} color="#FFFFFF" /></View>
    </View>
  );
}

export function AdminShell({ section, children }: PropsWithChildren<{ section: AdminSection }>) {
  const theme = useAdminTheme();
  const width = useViewportWidth();
  const layout = { desktop: width >= DESKTOP_BREAKPOINT, large: width >= LARGE_BREAKPOINT, width };
  const compactSidebar = width < COMPACT_SIDEBAR_BELOW;
  const [drawerVisible, setDrawerVisible] = useState(false);
  const access = trpc.admin.access.useQuery(undefined, { retry: false, refetchOnWindowFocus: true });
  const activity = trpc.admin.activity.useMutation();
  const router = useRouter();

  useEffect(() => {
    if (access.isSuccess) activity.mutate({ area: section });
    // Une seule trace par affichage de section ; les erreurs d’audit ne doivent pas masquer l’interface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.isSuccess, section]);

  if (access.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]} accessibilityLabel="Chargement des données administratives">
        <ActivityIndicator size="large" color={theme.brand} />
        <Text style={[styles.centerText, { color: theme.textMuted }]}>Chargement…</Text>
      </View>
    );
  }
  if (access.error || !access.data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <View style={[styles.denied, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.deniedIcon, { backgroundColor: theme.dangerSoft }]}><MaterialIcons name="lock-outline" size={26} color={theme.danger} /></View>
          <Text style={[styles.deniedTitle, { color: theme.text }]}>Accès administrateur refusé</Text>
          <Text style={[styles.centerText, { color: theme.textMuted }]}>Connectez-vous avec un compte administrateur pour accéder à la console.</Text>
          <Button label="Se connecter" variant="primary" icon="login" onPress={() => router.replace("/auth/login" as never)} />
        </View>
      </View>
    );
  }

  const identity: Identity = {
    name: displayIdentity({ name: access.data.name, phone: access.data.phone, email: access.data.email, id: access.data.id }),
    detail: access.data.name ? access.data.phone ?? access.data.email ?? "Administrateur" : "Administrateur",
  };

  return (
    <AdminLayoutContext.Provider value={layout}>
      {layout.desktop ? (
        <View style={[styles.desktopShell, { backgroundColor: theme.background }]}>
          <View style={[styles.sidebarFrame, compactSidebar && styles.sidebarFrameCompact, { borderRightColor: theme.border }]}>
            <Sidebar section={section} identity={identity} compact={compactSidebar} />
          </View>
          <View style={styles.flex}>
            <Topbar section={section} identity={identity} />
            {children}
          </View>
        </View>
      ) : (
        <View style={[styles.flex, { backgroundColor: theme.background }]}>
          <MobileHeader section={section} onMenu={() => setDrawerVisible(true)} />
          {children}
          <MobileDrawer visible={drawerVisible} section={section} identity={identity} onClose={() => setDrawerVisible(false)} />
        </View>
      )}
    </AdminLayoutContext.Provider>
  );
}

/** Contenu d'une page : en-tête (titre, description, actions) puis sections, dans une zone défilante. */
export function AdminPage({ section, actions, children }: PropsWithChildren<{ section: AdminSection; actions?: ReactNode }>) {
  const { desktop } = useAdminLayout();
  return (
    <ScrollView style={styles.flex} contentContainerStyle={[styles.page, desktop && styles.pageDesktop]} keyboardShouldPersistTaps="handled">
      <PageHeader title={SECTION_TITLES[section]} description={SECTION_SUBTITLES[section]} actions={actions} />
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  desktopShell: { flex: 1, flexDirection: "row" },
  sidebarFrame: { width: 260, borderRightWidth: 1 },
  sidebarFrameCompact: { width: 76 },
  brandCompact: { justifyContent: "center", paddingHorizontal: 0 },
  navScrollCompact: { paddingHorizontal: 10, alignItems: "stretch" },
  navItemCompact: { justifyContent: "center", paddingHorizontal: 0 },
  navGroupDivider: { height: 1, marginHorizontal: 8, marginBottom: 8 },
  sidebarFooterCompact: { paddingHorizontal: 10 },
  sidebar: { flex: 1 },
  brand: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, height: 64 },
  brandMark: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  brandMarkSmall: { width: 32, height: 32, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  brandName: { fontSize: 15, fontWeight: "700" },
  brandSub: { fontSize: font.xs },
  closeButton: { padding: 6 },
  navScroll: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 16, gap: 18 },
  navGroup: { gap: 2 },
  navGroupLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 12, marginBottom: 4 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40, paddingHorizontal: 12, borderRadius: radius.md },
  navIndicator: { position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2 },
  navLabel: { fontSize: font.md, fontWeight: "500", flex: 1 },
  navLabelActive: { fontWeight: "600" },
  sidebarFooter: { borderTopWidth: 1, padding: 12, gap: 4 },
  userCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: radius.md },
  userName: { fontSize: font.sm, fontWeight: "600" },
  userDetail: { fontSize: font.xs },

  topbar: { height: 64, borderBottomWidth: 1, paddingHorizontal: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  breadcrumb: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  breadcrumbText: { fontSize: font.sm },
  breadcrumbCurrent: { fontWeight: "600" },
  topbarRight: { flexDirection: "row", alignItems: "center", gap: 16 },
  topbarDate: { flexDirection: "row", alignItems: "center", gap: 6 },
  topbarDivider: { width: 1, height: 24 },
  topbarUser: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.md, maxWidth: 260 },
  topbarUserName: { fontSize: font.sm, fontWeight: "600", flexShrink: 1 },

  mobileHeader: { height: 56, borderBottomWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  menuButton: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  mobileTitle: { flex: 1, fontSize: 17, fontWeight: "700" },
  drawerRoot: { flex: 1 },
  drawerBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  drawer: { position: "absolute", top: 0, bottom: 0, left: 0, width: 300, maxWidth: "86%", borderRightWidth: 1 },

  page: { padding: 16, paddingBottom: 40, gap: 16 },
  pageDesktop: { paddingHorizontal: 32, paddingTop: 28, paddingBottom: 48, gap: 24, width: "100%", maxWidth: 1480, alignSelf: "center" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  centerText: { fontSize: font.md, lineHeight: 21, textAlign: "center" },
  denied: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: radius.xl, padding: 28, alignItems: "center", gap: 12 },
  deniedIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  deniedTitle: { fontSize: 20, fontWeight: "700", textAlign: "center" },
});
