import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { PropsWithChildren, ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";

import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { DEFAULT_WEEKLY_HOURS, WEEK_DAYS, WEEK_DAY_LABELS, formatWeeklyHours, validateWeeklyHours, type WeeklyHours } from "@/lib/pharmagarde/opening-hours";
import { LocationPicker } from "@/components/pharmagarde/location-picker";
import { WeeklyHoursEditor, cloneHours } from "@/components/pharmagarde/weekly-hours-editor";
import { getKnownCityCoordinates } from "@/lib/pharmagarde/city-utils";
import { SignOutConfirmationModal } from "@/components/pharmagarde/sign-out-confirmation";
import { haptic, premiumRadius, premiumSpacing, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";

type AdminSection = "dashboard" | "directory" | "duty" | "hours" | "users" | "premium" | "audit";
type DirectoryKind = "pharmacy" | "healthcare";
type Tone = "brand" | "success" | "warning" | "danger" | "muted" | "clinic";

type DirectoryForm = {
  id?: string;
  kind: DirectoryKind;
  name: string;
  city: string;
  phone: string;
  address: string;
  latitude: string;
  longitude: string;
  dutyGroup: string;
  establishmentType: string;
  /** « city » : horaires de la ville ; « custom » : horaires propres à l'établissement. */
  hoursMode: "city" | "custom";
  openingHours: WeeklyHours;
};

/** Largeur à partir de laquelle la console passe en mise en page bureau : menu latéral fixe et tableaux. */
const WIDE_BREAKPOINT = 1024;
const PAGE_SIZE = 50;
const OTHER_CITY = "__autre__";

const ADMIN_NAV: ReadonlyArray<{ section: AdminSection; href: string; label: string; icon: keyof typeof MaterialIcons.glyphMap }> = [
  { section: "dashboard", href: "/admin", label: "Tableau de bord", icon: "dashboard" },
  { section: "directory", href: "/admin/annuaire", label: "Annuaire", icon: "local-pharmacy" },
  { section: "duty", href: "/admin/gardes", label: "Gardes", icon: "event" },
  { section: "hours", href: "/admin/horaires", label: "Horaires", icon: "schedule" },
  { section: "users", href: "/admin/utilisateurs", label: "Utilisateurs", icon: "group" },
  { section: "premium", href: "/admin/abonnements", label: "Premium", icon: "workspace-premium" },
  { section: "audit", href: "/admin/journal", label: "Journal", icon: "receipt-long" },
];

const SECTION_TITLES: Record<AdminSection, string> = {
  dashboard: "Tableau de bord",
  directory: "Annuaire",
  duty: "Gardes",
  hours: "Horaires",
  users: "Utilisateurs",
  premium: "Premium",
  audit: "Journal d’audit",
};

const SECTION_SUBTITLES: Record<AdminSection, string> = {
  dashboard: "Vue d’ensemble des comptes, des paiements et de l’annuaire.",
  directory: "Pharmacies et structures de santé publiées dans l’application.",
  duty: "Groupe de garde de chaque ville. La garde change chaque samedi à 8 h.",
  hours: "Horaires de service par ville, fixés par l’ONPBF. Une pharmacie de garde est ouverte 24 h/24.",
  users: "Comptes inscrits, vérification du téléphone et abonnement.",
  premium: "Paiements Ligdi Cash et abonnements associés.",
  audit: "Actions réalisées dans la console d’administration.",
};

const PLAN_LABELS: Record<string, string> = {
  week: "1 semaine",
  month: "1 mois",
  quarter: "3 mois",
  semester: "6 mois",
};

const TRANSACTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  success: { label: "Payé", tone: "success" },
  pending: { label: "En attente", tone: "warning" },
  failed: { label: "Échoué", tone: "danger" },
  cancelled: { label: "Annulé", tone: "muted" },
};

const AUDIT_ACTIONS: Record<string, string> = {
  "directory.upserted": "Fiche enregistrée",
  "directory.archived": "Fiche archivée",
  "directory.restored": "Fiche restaurée",
  "admin.dashboard.viewed": "Consultation du tableau de bord",
  "admin.directory.viewed": "Consultation de l’annuaire",
  "admin.duty.viewed": "Consultation des gardes",
  "admin.hours.viewed": "Consultation des horaires",
  "city_hours.updated": "Horaires de ville modifiés",
  "city_hours.reset": "Horaires de ville rétablis",
  "admin.users.viewed": "Consultation des utilisateurs",
  "admin.premium.viewed": "Consultation des paiements",
  "admin.audit.viewed": "Consultation du journal",
};

const AUDIT_TARGETS: Record<string, string> = {
  pharmacy: "Pharmacie",
  healthcare: "Structure de santé",
  admin_console: "Console",
  city: "Ville",
};

const DUTY_GROUP_OPTIONS = [
  { value: "", label: "Aucun" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
] as const;

type DutyGroupFilter = "all" | "none" | "1" | "2" | "3" | "4";

const DUTY_GROUP_FILTER_OPTIONS: readonly { value: DutyGroupFilter; label: string }[] = [
  { value: "all", label: "Tous les groupes" },
  { value: "1", label: "Groupe 1" },
  { value: "2", label: "Groupe 2" },
  { value: "3", label: "Groupe 3" },
  { value: "4", label: "Groupe 4" },
  { value: "none", label: "Sans groupe" },
];

const EMPTY_DIRECTORY_FORM: DirectoryForm = {
  kind: "pharmacy",
  name: "",
  city: "Ouagadougou",
  phone: "",
  address: "",
  latitude: "",
  longitude: "",
  dutyGroup: "",
  establishmentType: "Centre de santé",
  hoursMode: "city",
  openingHours: DEFAULT_WEEKLY_HOURS,
};

const WideLayoutContext = createContext(false);

function useWideLayout() {
  return useContext(WideLayoutContext);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fr-BF", { dateStyle: "medium", timeStyle: "short" }).format(date) : "—";
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fr-BF", { dateStyle: "short", timeStyle: "short" }).format(date) : "—";
}

/** Date et heure de relève, en heure du Burkina Faso (UTC+0). */
function formatDutyDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fr-BF", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date) : "—";
}

function formatDutyDay(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fr-BF", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date) : "—";
}

function formatXof(value: number) {
  return new Intl.NumberFormat("fr-BF", { style: "currency", currency: "XOF", maximumFractionDigits: 0 }).format(value);
}

function numberOrNull(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function displayIdentity(input: { name?: string | null; phone?: string | null; email?: string | null; id?: number | null }) {
  return input.name || input.phone || input.email || (input.id ? `Utilisateur #${input.id}` : "Utilisateur inconnu");
}

function auditActionLabel(action: string) {
  return AUDIT_ACTIONS[action] ?? action;
}

/** Valeur mise à jour après une pause de saisie, pour ne pas interroger le serveur à chaque frappe. */
function useDebouncedValue<T>(value: T, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Numéro de page remis à 1 dès que les filtres changent. */
function usePage(filtersKey: string) {
  const [state, setState] = useState({ key: filtersKey, page: 1 });
  const page = state.key === filtersKey ? state.page : 1;
  return [page, (next: number) => setState({ key: filtersKey, page: next })] as const;
}

function useToneColor() {
  const palette = usePremiumPalette();
  return (tone: Tone) => ({ brand: palette.brand, success: palette.success, warning: palette.warning, danger: palette.danger, muted: palette.muted, clinic: palette.clinic })[tone];
}

function PageState({ loading, error, onRetry, empty, children }: PropsWithChildren<{ loading?: boolean; error?: { message?: string } | null; onRetry?: () => void; empty?: boolean }>) {
  const palette = usePremiumPalette();
  if (loading) {
    return (
      <View style={styles.state} accessibilityLabel="Chargement des données administratives">
        <ActivityIndicator size="large" color={palette.brand} />
        <Text style={[styles.stateText, { color: palette.muted }]}>Chargement…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.state, styles.errorState, { backgroundColor: palette.card, borderColor: palette.danger }]}>
        <MaterialIcons name="error-outline" size={28} color={palette.danger} />
        <Text style={[styles.stateText, { color: palette.text }]}>{error.message || "Impossible de charger les données."}</Text>
        {onRetry ? <Pressable accessibilityRole="button" style={[styles.retryButton, { backgroundColor: palette.brand }]} onPress={onRetry}><Text style={styles.retryText}>Réessayer</Text></Pressable> : null}
      </View>
    );
  }
  if (empty) {
    return (
      <View style={[styles.state, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <MaterialIcons name="inbox" size={28} color={palette.muted} />
        <Text style={[styles.stateText, { color: palette.muted }]}>Aucune donnée à afficher.</Text>
      </View>
    );
  }
  return <>{children}</>;
}

/** Page de la console. Sur mobile le titre est porté par la barre verte ; sur bureau, par la page elle-même. */
function AdminPage({ section, children }: PropsWithChildren<{ section: AdminSection }>) {
  const palette = usePremiumPalette();
  const wide = useWideLayout();
  return (
    <ScrollView style={[styles.page, { backgroundColor: palette.background }]} contentContainerStyle={[styles.pageContent, wide && styles.pageContentWide]} showsVerticalScrollIndicator={wide}>
      {wide ? (
        <View style={styles.pageHeader}>
          <Text accessibilityRole="header" style={[styles.pageTitle, { color: palette.text }]}>{SECTION_TITLES[section]}</Text>
          <Text style={[styles.pageSubtitle, { color: palette.muted }]}>{SECTION_SUBTITLES[section]}</Text>
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

/** Contenu de navigation partagé par le menu latéral fixe (bureau) et le tiroir (mobile). */
function AdminNav({ section, identity, onNavigate, onClose }: { section: AdminSection; identity: string; onNavigate?: () => void; onClose?: () => void }) {
  const router = useRouter();
  const palette = usePremiumPalette();
  const { logout } = useAuth({ autoFetch: false });
  const [logoutConfirmationVisible, setLogoutConfirmationVisible] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);

  const signOut = async () => {
    setLogoutPending(true);
    try {
      await logout();
      onNavigate?.();
      router.replace("/auth/login" as never);
    } finally {
      setLogoutPending(false);
      setLogoutConfirmationVisible(false);
    }
  };

  return (
    <View style={styles.nav}>
      <View style={[styles.navBrand, { borderBottomColor: palette.border }]}>
        <View style={[styles.navMark, { backgroundColor: palette.brand }]}><MaterialIcons name="admin-panel-settings" size={22} color="#FFFFFF" /></View>
        <View style={styles.navBrandText}>
          <Text style={[styles.navKicker, { color: palette.muted }]}>PHARMAGARDE BF</Text>
          <Text style={[styles.navTitle, { color: palette.text }]}>Administration</Text>
        </View>
        {onClose ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu" style={[styles.iconButton, { borderColor: palette.border }]} onPress={onClose}>
            <MaterialIcons name="close" size={20} color={palette.text} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={styles.navScroll} contentContainerStyle={styles.navList} showsVerticalScrollIndicator={false}>
        {ADMIN_NAV.map((item) => {
          const active = item.section === section;
          return (
            <Pressable
              key={item.section}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [styles.navItem, active && { backgroundColor: palette.softGreen }, pressed && styles.pressed]}
              onPress={() => {
                haptic.selection();
                onNavigate?.();
                if (!active) router.replace(item.href as never);
              }}
            >
              <MaterialIcons name={item.icon} size={20} color={active ? palette.brand : palette.muted} />
              <Text style={[styles.navItemText, { color: active ? palette.brand : palette.text }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={[styles.navFooter, { borderTopColor: palette.border }]}>
        <View style={styles.navIdentity}>
          <MaterialIcons name="verified-user" size={17} color={palette.brand} />
          <Text numberOfLines={1} style={[styles.navIdentityText, { color: palette.muted }]}>{identity}</Text>
        </View>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.navItem, pressed && styles.pressed]} onPress={() => setLogoutConfirmationVisible(true)}>
          <MaterialIcons name="logout" size={20} color={palette.danger} />
          <Text style={[styles.navItemText, { color: palette.danger }]}>Se déconnecter</Text>
        </Pressable>
      </View>
      <SignOutConfirmationModal
        visible={logoutConfirmationVisible}
        pending={logoutPending}
        onClose={() => setLogoutConfirmationVisible(false)}
        onConfirm={() => void signOut()}
      />
    </View>
  );
}

function AdminDrawer({ visible, section, identity, onClose }: { visible: boolean; section: AdminSection; identity: string; onClose: () => void }) {
  const palette = usePremiumPalette();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(Math.max(width * 0.82, 280), 340);

  if (!visible) return null;

  return (
    <View style={styles.drawerRoot} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu d’administration" style={[styles.drawerBackdrop, { backgroundColor: palette.overlay }]} onPress={onClose} />
      <View style={[styles.drawer, { width: drawerWidth, backgroundColor: palette.card, borderRightColor: palette.border }]}>
        <AdminNav section={section} identity={identity} onNavigate={onClose} onClose={onClose} />
      </View>
    </View>
  );
}

function AdminShell({ section, children }: PropsWithChildren<{ section: AdminSection }>) {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const palette = usePremiumPalette();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const access = trpc.admin.access.useQuery(undefined, { retry: false, refetchOnWindowFocus: true });
  const activity = trpc.admin.activity.useMutation();
  const router = useRouter();

  useEffect(() => {
    if (access.isSuccess) activity.mutate({ area: section });
    // Une seule trace par affichage de section ; les erreurs d’audit ne doivent pas masquer l’interface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.isSuccess, section]);

  if (access.isLoading) return <PageState loading />;
  if (access.error || !access.data) {
    return (
      <View style={[styles.deniedRoot, { backgroundColor: palette.background }]}>
        <View style={[styles.deniedCard, { backgroundColor: palette.card, borderColor: palette.danger }]}>
          <MaterialIcons name="lock-outline" size={34} color={palette.danger} />
          <Text style={[styles.deniedTitle, { color: palette.text }]}>Accès administrateur refusé</Text>
          <Pressable accessibilityRole="button" style={[styles.retryButton, { backgroundColor: palette.brand }]} onPress={() => router.replace("/auth/login" as never)}><Text style={styles.retryText}>Se connecter</Text></Pressable>
        </View>
      </View>
    );
  }

  const identity = displayIdentity({ phone: access.data.phone, email: access.data.email, id: access.data.id });

  if (wide) {
    return (
      <WideLayoutContext.Provider value>
        <View style={[styles.wideShell, { backgroundColor: palette.background }]}>
          <View style={[styles.sidebar, { backgroundColor: palette.card, borderRightColor: palette.border }]}>
            <AdminNav section={section} identity={identity} />
          </View>
          <View style={styles.shellContent}>{children}</View>
        </View>
      </WideLayoutContext.Provider>
    );
  }

  return (
    <WideLayoutContext.Provider value={false}>
      <View style={[styles.shell, { backgroundColor: palette.background }]}>
        <View style={[styles.header, { backgroundColor: palette.brand }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Ouvrir le menu d’administration" style={styles.headerButton} onPress={() => setDrawerVisible(true)}>
            <MaterialIcons name="menu" size={24} color={palette.brand} />
          </Pressable>
          <Text numberOfLines={1} accessibilityRole="header" style={styles.headerTitle}>{SECTION_TITLES[section]}</Text>
          <View style={styles.headerSecurity}><MaterialIcons name="verified-user" size={21} color="#FFFFFF" /></View>
        </View>
        <View style={styles.shellContent}>{children}</View>
        <AdminDrawer visible={drawerVisible} section={section} identity={identity} onClose={() => setDrawerVisible(false)} />
      </View>
    </WideLayoutContext.Provider>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  const toneColor = useToneColor();
  const color = toneColor(tone);
  return <Text numberOfLines={1} style={[styles.statusPill, { color, borderColor: color }]}>{label}</Text>;
}

type Column = { key: string; label: string; flex?: number; width?: number; align?: "left" | "right" };

function columnStyle(column: Column) {
  return [column.width ? { width: column.width } : { flex: column.flex ?? 1 }, column.align === "right" ? styles.cellRight : undefined];
}

/** Tableau dense pour la mise en page bureau. */
function DataTable<T>({ columns, rows, rowKey, renderCell, onRowPress, selectedKey }: { columns: readonly Column[]; rows: readonly T[]; rowKey: (row: T) => string; renderCell: (row: T, key: string) => ReactNode; onRowPress?: (row: T) => void; selectedKey?: string | null }) {
  const palette = usePremiumPalette();
  return (
    <View style={[styles.table, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={[styles.tableHead, { backgroundColor: palette.cardMuted, borderBottomColor: palette.border }]}>
        {columns.map((column) => (
          <View key={column.key} style={[styles.cell, ...columnStyle(column)]}>
            <Text numberOfLines={1} style={[styles.th, { color: palette.muted }]}>{column.label}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, index) => {
        const key = rowKey(row);
        const rowStyle = [styles.tr, { borderTopColor: palette.border }, index === 0 && styles.trFirst, key === selectedKey && { backgroundColor: palette.softGreen }];
        const cells = columns.map((column) => <View key={column.key} style={[styles.cell, ...columnStyle(column)]}>{renderCell(row, column.key)}</View>);
        return onRowPress ? (
          <Pressable key={key} accessibilityRole="button" style={({ pressed }) => [...rowStyle, pressed && styles.pressed]} onPress={() => onRowPress(row)}>{cells}</Pressable>
        ) : (
          <View key={key} style={rowStyle}>{cells}</View>
        );
      })}
    </View>
  );
}

function CellText({ children, strong = false, muted = false, small = false }: PropsWithChildren<{ strong?: boolean; muted?: boolean; small?: boolean }>) {
  const palette = usePremiumPalette();
  return <Text numberOfLines={1} style={[styles.td, strong && styles.tdStrong, small && styles.tdSmall, { color: muted ? palette.muted : palette.text }]}>{children}</Text>;
}

function Pagination({ page, limit, total, onChange }: { page: number; limit: number; total: number; onChange: (page: number) => void }) {
  const palette = usePremiumPalette();
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(page * limit, total);
  return (
    <View style={styles.pagination}>
      <Text style={[styles.resultCount, { color: palette.muted }]}>{total ? `${from}–${to} sur ${total.toLocaleString("fr-FR")}` : "Aucun résultat"}</Text>
      {pages > 1 ? (
        <View style={styles.paginationButtons}>
          <IconAction icon="chevron-left" label="Page précédente" color={palette.text} disabled={page <= 1} onPress={() => onChange(page - 1)} />
          <Text style={[styles.resultCount, { color: palette.text }]}>Page {page} / {pages}</Text>
          <IconAction icon="chevron-right" label="Page suivante" color={palette.text} disabled={page >= pages} onPress={() => onChange(page + 1)} />
        </View>
      ) : null}
    </View>
  );
}

/** Liste de choix : un bouton qui ouvre la liste des options dans une fenêtre. */
function SelectField({ label, value, options, onChange, style }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void; style?: object }) {
  const palette = usePremiumPalette();
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} : ${current?.label ?? "non renseigné"}`} style={({ pressed }) => [styles.select, { backgroundColor: palette.card, borderColor: palette.border }, style, pressed && styles.pressed]} onPress={() => setOpen(true)}>
        <Text numberOfLines={1} style={[styles.selectText, { color: current ? palette.text : palette.muted }]}>{current?.label ?? label}</Text>
        <MaterialIcons name="expand-more" size={20} color={palette.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Fermer la liste" style={[styles.modalRoot, { backgroundColor: palette.overlay }]} onPress={() => setOpen(false)}>
          <Pressable style={[styles.selectSheet, { backgroundColor: palette.card, borderColor: palette.border }]} onPress={() => undefined}>
            <Text style={[styles.cardHeading, styles.selectTitle, { color: palette.text }]}>{label}</Text>
            <ScrollView style={styles.selectList}>
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: active }} style={({ pressed }) => [styles.selectOption, active && { backgroundColor: palette.softGreen }, pressed && styles.pressed]} onPress={() => { onChange(option.value); setOpen(false); }}>
                    <Text style={[styles.selectOptionText, { color: active ? palette.brand : palette.text }]}>{option.label}</Text>
                    {active ? <MaterialIcons name="check" size={18} color={palette.brand} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Dashboard() {
  const summary = trpc.admin.dashboard.useQuery(undefined, { retry: 1 });
  const palette = usePremiumPalette();
  const wide = useWideLayout();
  const router = useRouter();
  const metrics = useMemo(
    () => summary.data ? [
      { label: "Utilisateurs", value: summary.data.users, icon: "group" as const, color: palette.brand, href: "/admin/utilisateurs" },
      { label: "Vérifiés", value: summary.data.verifiedUsers, icon: "verified" as const, color: palette.success, href: "/admin/utilisateurs" },
      { label: "Premium actifs", value: summary.data.premiumUsers, icon: "workspace-premium" as const, color: palette.clinic, href: "/admin/abonnements" },
      { label: "Transactions", value: summary.data.transactions, icon: "receipt-long" as const, color: palette.brand, href: "/admin/abonnements" },
      { label: "En attente", value: summary.data.pendingTransactions, icon: "pending-actions" as const, color: palette.warning, href: "/admin/abonnements" },
      { label: "Établissements", value: summary.data.directoryEntries, icon: "local-hospital" as const, color: palette.clinic, href: "/admin/annuaire" },
    ] : [],
    [palette.brand, palette.clinic, palette.success, palette.warning, summary.data],
  );

  return (
    <AdminPage section="dashboard">
      <PageState loading={summary.isLoading} error={summary.error} onRetry={() => summary.refetch()}>
        <View style={styles.metricGrid}>
          {metrics.map((metric) => (
            <Pressable
              key={metric.label}
              accessibilityRole="button"
              accessibilityLabel={`${metric.label} : ${metric.value}`}
              style={({ pressed }) => [styles.metricCard, wide && styles.metricCardWide, { backgroundColor: palette.card, borderColor: palette.border }, pressed && styles.pressed]}
              onPress={() => router.replace(metric.href as never)}
            >
              <View style={styles.metricTop}>
                <View style={[styles.metricIcon, { backgroundColor: `${metric.color}18` }]}><MaterialIcons name={metric.icon} size={20} color={metric.color} /></View>
                <MaterialIcons name="chevron-right" size={20} color={palette.muted} />
              </View>
              <Text style={[styles.metricValue, { color: palette.text }]}>{metric.value.toLocaleString("fr-FR")}</Text>
              <Text style={[styles.metricLabel, { color: palette.muted }]}>{metric.label}</Text>
            </Pressable>
          ))}
        </View>
      </PageState>
    </AdminPage>
  );
}

function SegmentControl({ value, onChange, options, style }: { value: string; onChange: (value: string) => void; options: ReadonlyArray<{ value: string; label: string }>; style?: object }) {
  const palette = usePremiumPalette();
  return (
    <View style={[styles.segment, { backgroundColor: palette.cardMuted, borderColor: palette.border }, style]}>
      {options.map((option) => {
        const active = option.value === value;
        return <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.segmentOption, active ? { backgroundColor: palette.brand } : undefined]} onPress={() => onChange(option.value)}><Text style={[styles.segmentText, { color: active ? "#FFFFFF" : palette.muted }]}>{option.label}</Text></Pressable>;
      })}
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = "default", multiline = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; keyboardType?: "default" | "phone-pad" | "numeric"; multiline?: boolean }) {
  const palette = usePremiumPalette();
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: palette.text }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.fieldInput, multiline ? styles.fieldMultiline : undefined, { color: palette.text, backgroundColor: palette.card, borderColor: palette.border }]}
      />
    </View>
  );
}

function SearchInput({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) {
  const palette = usePremiumPalette();
  return (
    <View style={[styles.searchWrap, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <MaterialIcons name="search" size={19} color={palette.muted} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.muted} style={[styles.searchInput, { color: palette.text }]} />
    </View>
  );
}

function ConfirmationModal({ itemName, visible, loading, onClose, onConfirm }: { itemName: string; visible: boolean; loading: boolean; onClose: () => void; onConfirm: () => void }) {
  const palette = usePremiumPalette();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: palette.overlay }]}>
        <View style={[styles.confirmCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <MaterialIcons name="archive" size={30} color={palette.danger} />
          <Text style={[styles.confirmTitle, { color: palette.text }]}>Archiver l’établissement</Text>
          <Text style={[styles.confirmText, { color: palette.muted }]}>« {itemName} » ne sera plus publié dans l’annuaire. Cette action sera journalisée.</Text>
          <View style={styles.confirmActions}>
            <Pressable accessibilityRole="button" style={[styles.secondaryButton, { borderColor: palette.border }]} disabled={loading} onPress={onClose}><Text style={[styles.secondaryText, { color: palette.text }]}>Annuler</Text></Pressable>
            <Pressable accessibilityRole="button" style={[styles.dangerButton, { backgroundColor: palette.danger }]} disabled={loading} onPress={onConfirm}>{loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.retryText}>Archiver</Text>}</Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DirectoryFormFields({ form, cityNames, cityHoursFor, onChange, error, pending, onCancel, onSubmit }: { form: DirectoryForm; cityNames: readonly string[]; cityHoursFor: (city: string) => WeeklyHours; onChange: <K extends keyof DirectoryForm>(key: K, value: DirectoryForm[K]) => void; error?: string | null; pending: boolean; onCancel: () => void; onSubmit: () => void }) {
  const palette = usePremiumPalette();
  const [otherCity, setOtherCity] = useState(false);
  const showOtherCity = otherCity || (!!form.city && !cityNames.includes(form.city));
  const cityOptions = [...cityNames.map((name) => ({ value: name, label: name })), { value: OTHER_CITY, label: "Autre ville…" }];
  const missingCoordinates = form.kind === "pharmacy" && (numberOrNull(form.latitude) === null || numberOrNull(form.longitude) === null);
  const invalidHours = form.hoursMode === "custom" && !!validateWeeklyHours(form.openingHours);
  const cannotSave = pending || !form.name.trim() || !form.city.trim() || missingCoordinates || invalidHours;
  const cityHours = cityHoursFor(form.city);
  const pickedLatitude = numberOrNull(form.latitude);
  const pickedLongitude = numberOrNull(form.longitude);
  const pickedLocation = pickedLatitude !== null && pickedLongitude !== null ? { latitude: pickedLatitude, longitude: pickedLongitude } : null;
  const coordinateSuffix = form.kind === "pharmacy" ? " *" : "";
  return (
    <View style={styles.formFields}>
      <SegmentControl value={form.kind} onChange={(value) => onChange("kind", value as DirectoryKind)} options={[{ value: "pharmacy", label: "Pharmacie" }, { value: "healthcare", label: "Soins" }]} />
      <Field label="Nom" value={form.name} onChangeText={(value) => onChange("name", value)} />
      <View style={styles.fieldWrap}>
        <Text style={[styles.fieldLabel, { color: palette.text }]}>Ville</Text>
        <SelectField
          label="Ville"
          value={showOtherCity ? OTHER_CITY : form.city}
          options={cityOptions}
          onChange={(value) => {
            setOtherCity(value === OTHER_CITY);
            onChange("city", value === OTHER_CITY ? "" : value);
          }}
        />
      </View>
      {showOtherCity ? <Field label="Nom de la nouvelle ville" value={form.city} onChangeText={(value) => onChange("city", value)} placeholder="Ex. Koudougou" /> : null}
      <Field label="Téléphone" value={form.phone} onChangeText={(value) => onChange("phone", value)} placeholder="+226 70 00 00 00" keyboardType="phone-pad" />
      <Field label="Adresse" value={form.address} onChangeText={(value) => onChange("address", value)} multiline />
      <View style={styles.fieldWrap}>
        <Text style={[styles.fieldLabel, { color: palette.text }]}>Emplacement</Text>
        <LocationPicker
          value={pickedLocation}
          center={getKnownCityCoordinates(form.city)}
          height={240}
          onChange={(location) => {
            onChange("latitude", location ? String(location.latitude) : "");
            onChange("longitude", location ? String(location.longitude) : "");
          }}
        />
      </View>
      <View style={styles.fieldRow}><View style={styles.fieldHalf}><Field label={`Latitude${coordinateSuffix}`} value={form.latitude} onChangeText={(value) => onChange("latitude", value)} keyboardType="numeric" /></View><View style={styles.fieldHalf}><Field label={`Longitude${coordinateSuffix}`} value={form.longitude} onChangeText={(value) => onChange("longitude", value)} keyboardType="numeric" /></View></View>
      {form.kind === "pharmacy" ? (
        <View style={styles.fieldWrap}>
          <Text style={[styles.fieldLabel, { color: palette.text }]}>Groupe de garde</Text>
          <SegmentControl value={form.dutyGroup} onChange={(value) => onChange("dutyGroup", value)} options={DUTY_GROUP_OPTIONS} />
        </View>
      ) : (
        <Field label="Type d’établissement" value={form.establishmentType} onChangeText={(value) => onChange("establishmentType", value)} />
      )}
      <View style={styles.fieldWrap}>
        <Text style={[styles.fieldLabel, { color: palette.text }]}>Horaires de service</Text>
        <SegmentControl
          value={form.hoursMode}
          onChange={(value) => {
            onChange("hoursMode", value as DirectoryForm["hoursMode"]);
            if (value === "custom" && form.hoursMode === "city") onChange("openingHours", cloneHours(cityHours));
          }}
          options={[{ value: "city", label: "Horaires de la ville" }, { value: "custom", label: "Horaires propres" }]}
        />
        {form.hoursMode === "city" ? (
          <Text style={[styles.fieldHint, { color: palette.muted }]}>{form.city ? `${form.city} : ` : ""}{formatWeeklyHours(cityHours)}</Text>
        ) : (
          <WeeklyHoursEditor value={form.openingHours} onChange={(value) => onChange("openingHours", value)} />
        )}
        {form.kind === "pharmacy" ? <Text style={[styles.fieldHint, { color: palette.muted }]}>En garde, la pharmacie est ouverte 24 h/24.</Text> : null}
      </View>
      {missingCoordinates ? <Text style={[styles.fieldHint, { color: palette.muted }]}>* Coordonnées obligatoires pour une pharmacie, pour l’afficher sur la carte.</Text> : null}
      {error ? <Text style={[styles.inlineError, { color: palette.danger }]}>{error}</Text> : null}
      <View style={styles.formActions}>
        <Pressable accessibilityRole="button" style={[styles.secondaryButton, { borderColor: palette.border }]} disabled={pending} onPress={onCancel}><Text style={[styles.secondaryText, { color: palette.text }]}>Annuler</Text></Pressable>
        <Pressable accessibilityRole="button" style={[styles.primaryButton, { backgroundColor: palette.brand }, cannotSave && styles.disabled]} disabled={cannotSave} onPress={onSubmit}>{pending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.retryText}>Enregistrer</Text>}</Pressable>
      </View>
    </View>
  );
}

function IconAction({ icon, label, color, onPress, disabled = false }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; color: string; onPress: () => void; disabled?: boolean }) {
  const palette = usePremiumPalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} style={({ pressed }) => [styles.iconButton, { borderColor: palette.border }, disabled && styles.disabled, pressed && styles.pressed]} onPress={onPress}>
      <MaterialIcons name={icon} size={18} color={color} />
    </Pressable>
  );
}

function SourceBadge({ item }: { item: { status: string; managed: boolean } }) {
  if (item.status === "archived") return <StatusBadge label="Archivé" tone="danger" />;
  return <StatusBadge label={item.managed ? "Administré" : "Annuaire"} tone={item.managed ? "brand" : "muted"} />;
}

const DIRECTORY_COLUMNS: readonly Column[] = [
  { key: "name", label: "Établissement", flex: 2.6 },
  { key: "city", label: "Ville", flex: 1.2 },
  { key: "group", label: "Groupe / type", flex: 1.2 },
  { key: "phone", label: "Téléphone", flex: 1.3 },
  { key: "source", label: "Source", flex: 1 },
  { key: "actions", label: "", width: 92, align: "right" },
];

function Directory() {
  const utils = trpc.useUtils();
  const palette = usePremiumPalette();
  const wide = useWideLayout();
  const [kind, setKind] = useState<"all" | DirectoryKind>("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [city, setCity] = useState("");
  const [dutyGroup, setDutyGroup] = useState<DutyGroupFilter>("all");
  const [form, setForm] = useState<DirectoryForm>(EMPTY_DIRECTORY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; kind: DirectoryKind; name: string } | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim());
  const effectiveGroup = kind === "healthcare" ? "all" : dutyGroup;
  const [page, setPage] = usePage([kind, debouncedSearch, status, city, effectiveGroup].join("|"));
  const directory = trpc.admin.directory.list.useQuery(
    { kind, search: debouncedSearch || undefined, status, city: city || undefined, dutyGroup: effectiveGroup, page, limit: PAGE_SIZE },
    { retry: 1, placeholderData: (previous) => previous },
  );
  const upsert = trpc.admin.directory.upsert.useMutation({
    onSuccess: async () => {
      haptic.success();
      setForm(EMPTY_DIRECTORY_FORM);
      setShowForm(false);
      await Promise.all([utils.admin.directory.list.invalidate(), utils.admin.dashboard.invalidate()]);
    },
  });
  const archive = trpc.admin.directory.archive.useMutation({
    onSuccess: async () => {
      haptic.success();
      setArchiveTarget(null);
      await Promise.all([utils.admin.directory.list.invalidate(), utils.admin.dashboard.invalidate()]);
    },
  });
  const restore = trpc.admin.directory.restore.useMutation({
    onSuccess: async () => {
      haptic.success();
      await Promise.all([utils.admin.directory.list.invalidate(), utils.admin.dashboard.invalidate()]);
    },
  });

  type DirectoryItem = NonNullable<typeof directory.data>["items"][number];

  const updateField = <K extends keyof DirectoryForm>(key: K, value: DirectoryForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const closeForm = () => {
    setShowForm(false);
    setForm(EMPTY_DIRECTORY_FORM);
    upsert.reset();
  };
  const openNew = () => {
    upsert.reset();
    setForm(EMPTY_DIRECTORY_FORM);
    setShowForm(true);
  };
  const openEdit = (item: DirectoryItem) => {
    upsert.reset();
    setForm({ id: item.id, kind: item.kind, name: item.name, city: item.city, phone: item.phone ?? "", address: item.address ?? "", latitude: item.latitude?.toString() ?? "", longitude: item.longitude?.toString() ?? "", dutyGroup: item.dutyGroup?.toString() ?? "", establishmentType: item.establishmentType ?? "Centre de santé", hoursMode: item.openingHours ? "custom" : "city", openingHours: item.openingHours ?? DEFAULT_WEEKLY_HOURS });
    setShowForm(true);
  };
  const submit = () => {
    upsert.mutate({
      id: form.id,
      kind: form.kind,
      name: form.name,
      city: form.city,
      phone: form.phone || null,
      address: form.address || null,
      latitude: numberOrNull(form.latitude),
      longitude: numberOrNull(form.longitude),
      dutyGroup: form.kind === "pharmacy" && form.dutyGroup ? Number(form.dutyGroup) : null,
      establishmentType: form.kind === "healthcare" ? form.establishmentType || null : null,
      openingHours: form.hoursMode === "custom" ? form.openingHours : null,
    });
  };

  const groupLabel = (item: DirectoryItem) => item.kind === "pharmacy" ? (item.dutyGroup ? `Groupe ${item.dutyGroup}` : "Sans groupe") : item.establishmentType ?? "Établissement";
  const formTitle = form.id ? "Modifier l’établissement" : "Nouvel établissement";
  const hours = trpc.admin.hours.cities.useQuery(undefined, { retry: 1 });
  const cityHoursFor = (name: string) => hours.data?.find((entry) => entry.city.localeCompare(name, "fr", { sensitivity: "base" }) === 0)?.hours ?? DEFAULT_WEEKLY_HOURS;
  const cities = directory.data?.cities ?? [];
  const cityNames = cities.map((entry) => entry.name);
  const formFields = <DirectoryFormFields key={form.id ?? "nouveau"} form={form} cityNames={cityNames} cityHoursFor={cityHoursFor} onChange={updateField} error={upsert.error?.message} pending={upsert.isPending} onCancel={closeForm} onSubmit={submit} />;
  const rows = directory.data?.items ?? [];
  const total = directory.data?.total ?? 0;
  const archivedView = status === "archived";
  const cityFilterOptions = [{ value: "", label: "Toutes les villes" }, ...cities.filter((entry) => entry.count > 0).map((entry) => ({ value: entry.name, label: `${entry.name} (${entry.count})` }))];
  const restoreItem = (item: DirectoryItem) => restore.mutate({ id: item.id });
  const pagination = <Pagination page={page} limit={PAGE_SIZE} total={total} onChange={setPage} />;

  return (
    <View style={[styles.splitRoot, wide && styles.splitRootWide]}>
      <AdminPage section="directory">
        <View style={[styles.toolbar, wide && styles.toolbarWide]}>
          <View style={styles.toolbarSearch}><SearchInput value={search} onChangeText={setSearch} placeholder="Rechercher un nom, une ville, un téléphone" /></View>
          {wide ? <SegmentControl style={styles.toolbarSegment} value={kind} onChange={(value) => setKind(value as "all" | DirectoryKind)} options={[{ value: "all", label: "Tous" }, { value: "pharmacy", label: "Pharmacies" }, { value: "healthcare", label: "Soins" }]} /> : null}
          <Pressable accessibilityRole="button" style={[styles.addButton, { backgroundColor: palette.brand }]} onPress={openNew}><MaterialIcons name="add" size={20} color="#FFFFFF" /><Text style={styles.addButtonText}>Ajouter</Text></Pressable>
        </View>
        {!wide ? <SegmentControl value={kind} onChange={(value) => setKind(value as "all" | DirectoryKind)} options={[{ value: "all", label: "Tous" }, { value: "pharmacy", label: "Pharmacies" }, { value: "healthcare", label: "Soins" }]} /> : null}
        <View style={[styles.filterRow, wide && styles.filterRowWide]}>
          <SelectField label="Ville" style={styles.filterSelect} value={city} options={cityFilterOptions} onChange={setCity} />
          {kind !== "healthcare" ? <SelectField label="Groupe de garde" style={styles.filterSelect} value={dutyGroup} options={DUTY_GROUP_FILTER_OPTIONS} onChange={(value) => setDutyGroup(value as DutyGroupFilter)} /> : null}
          <SegmentControl style={wide ? styles.statusSegment : undefined} value={status} onChange={(value) => setStatus(value as "active" | "archived")} options={[{ value: "active", label: "Publiées" }, { value: "archived", label: "Archivées" }]} />
        </View>
        {restore.error ? <Text style={[styles.inlineError, { color: palette.danger }]}>{restore.error.message}</Text> : null}
        <PageState loading={directory.isLoading} error={directory.error} onRetry={() => directory.refetch()} empty={!rows.length}>
          {pagination}
          {wide ? (
            <DataTable
              columns={DIRECTORY_COLUMNS}
              rows={rows}
              rowKey={(item) => item.id}
              selectedKey={showForm ? form.id ?? null : null}
              onRowPress={archivedView ? undefined : openEdit}
              renderCell={(item, key) => {
                switch (key) {
                  case "name":
                    return (
                      <View style={styles.cellIdentity}>
                        <MaterialIcons name={item.kind === "pharmacy" ? "local-pharmacy" : "local-hospital"} size={18} color={item.kind === "pharmacy" ? palette.brand : palette.clinic} />
                        <View style={styles.cellStack}>
                          <CellText strong>{item.name}</CellText>
                          {item.address ? <CellText muted small>{item.address}</CellText> : null}
                        </View>
                      </View>
                    );
                  case "city":
                    return <CellText>{item.city}</CellText>;
                  case "group":
                    return <CellText muted={item.kind === "pharmacy" && !item.dutyGroup}>{groupLabel(item)}</CellText>;
                  case "phone":
                    return <CellText>{item.phone ?? "—"}</CellText>;
                  case "source":
                    return <SourceBadge item={item} />;
                  case "actions":
                    return archivedView ? (
                      <View style={styles.cellActions}>
                        <IconAction icon="unarchive" label={`Restaurer ${item.name}`} color={palette.brand} disabled={restore.isPending} onPress={() => restoreItem(item)} />
                      </View>
                    ) : (
                      <View style={styles.cellActions}>
                        <IconAction icon="edit" label={`Modifier ${item.name}`} color={palette.brand} onPress={() => openEdit(item)} />
                        <IconAction icon="archive" label={`Archiver ${item.name}`} color={palette.muted} onPress={() => setArchiveTarget({ id: item.id, kind: item.kind, name: item.name })} />
                      </View>
                    );
                  default:
                    return null;
                }
              }}
            />
          ) : (
            <View style={styles.list}>
              {rows.map((item) => (
                <View key={item.id} style={[styles.listCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                  <View style={styles.listCardTop}><View style={[styles.typeIcon, { backgroundColor: item.kind === "pharmacy" ? palette.softGreen : `${palette.clinic}18` }]}><MaterialIcons name={item.kind === "pharmacy" ? "local-pharmacy" : "local-hospital"} size={20} color={item.kind === "pharmacy" ? palette.brand : palette.clinic} /></View><View style={styles.listMain}><Text style={[styles.listTitle, { color: palette.text }]}>{item.name}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>{item.city} · {groupLabel(item)}</Text></View></View>
                  <View style={styles.tagRow}><SourceBadge item={item} />{item.phone ? <Text style={[styles.listMeta, { color: palette.muted }]}>{item.phone}</Text> : null}</View>
                  {archivedView ? (
                    <View style={styles.rowActions}>
                      <Pressable accessibilityRole="button" disabled={restore.isPending} style={[styles.compactAction, { borderColor: palette.border }]} onPress={() => restoreItem(item)}><MaterialIcons name="unarchive" size={17} color={palette.brand} /><Text style={[styles.compactActionText, { color: palette.brand }]}>Restaurer</Text></Pressable>
                    </View>
                  ) : (
                    <View style={styles.rowActions}>
                      <Pressable accessibilityRole="button" style={[styles.compactAction, { borderColor: palette.border }]} onPress={() => openEdit(item)}><MaterialIcons name="edit" size={17} color={palette.brand} /><Text style={[styles.compactActionText, { color: palette.brand }]}>Modifier</Text></Pressable>
                      <IconAction icon="archive" label={`Archiver ${item.name}`} color={palette.danger} onPress={() => setArchiveTarget({ id: item.id, kind: item.kind, name: item.name })} />
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
          {pagination}
        </PageState>
      </AdminPage>
      {wide && showForm ? (
        <View style={[styles.sidePanel, { backgroundColor: palette.card, borderLeftColor: palette.border }]}>
          <View style={[styles.panelHeader, { borderBottomColor: palette.border }]}>
            <Text accessibilityRole="header" style={[styles.cardHeading, { color: palette.text }]}>{formTitle}</Text>
            <IconAction icon="close" label="Fermer le formulaire" color={palette.text} onPress={closeForm} />
          </View>
          <ScrollView contentContainerStyle={styles.panelContent}>{formFields}</ScrollView>
        </View>
      ) : null}
      {!wide ? (
        <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeForm}>
          <View style={[styles.sheet, { backgroundColor: palette.background }]}>
            <View style={[styles.panelHeader, { borderBottomColor: palette.border, backgroundColor: palette.card }]}>
              <Text accessibilityRole="header" style={[styles.cardHeading, { color: palette.text }]}>{formTitle}</Text>
              <IconAction icon="close" label="Fermer le formulaire" color={palette.text} onPress={closeForm} />
            </View>
            <ScrollView contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">{formFields}</ScrollView>
          </View>
        </Modal>
      ) : null}
      <ConfirmationModal itemName={archiveTarget?.name ?? ""} visible={!!archiveTarget} loading={archive.isPending} onClose={() => setArchiveTarget(null)} onConfirm={() => archiveTarget && archive.mutate({ id: archiveTarget.id, kind: archiveTarget.kind, confirmArchive: true })} />
    </View>
  );
}

const USER_COLUMNS: readonly Column[] = [
  { key: "user", label: "Utilisateur", flex: 2.2 },
  { key: "verification", label: "Téléphone", flex: 1 },
  { key: "role", label: "Rôle", flex: 1 },
  { key: "premium", label: "Premium jusqu’au", flex: 1.3 },
  { key: "created", label: "Inscription", flex: 1.2 },
  { key: "lastSignedIn", label: "Dernière connexion", flex: 1.2 },
];

function Users() {
  const palette = usePremiumPalette();
  const wide = useWideLayout();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [page, setPage] = usePage(debouncedSearch);
  const users = trpc.admin.users.list.useQuery({ search: debouncedSearch || undefined, page, limit: PAGE_SIZE }, { retry: 1, placeholderData: (previous) => previous });
  const rows = users.data?.items ?? [];
  const pagination = <Pagination page={page} limit={PAGE_SIZE} total={users.data?.total ?? 0} onChange={setPage} />;
  return (
    <AdminPage section="users">
      <View style={[styles.toolbar, wide && styles.toolbarWide]}>
        <View style={styles.toolbarSearch}><SearchInput value={search} onChangeText={setSearch} placeholder="Rechercher par nom, téléphone ou e-mail" /></View>
      </View>
      <PageState loading={users.isLoading} error={users.error} onRetry={() => users.refetch()} empty={!rows.length}>
        {pagination}
        {wide ? (
          <DataTable
            columns={USER_COLUMNS}
            rows={rows}
            rowKey={(user) => String(user.id)}
            renderCell={(user, key) => {
              switch (key) {
                case "user":
                  return (
                    <View style={styles.cellIdentity}>
                      <View style={[styles.avatarSmall, { backgroundColor: palette.softGreen }]}><Text style={[styles.avatarSmallText, { color: palette.brand }]}>{displayIdentity(user).slice(0, 1).toLocaleUpperCase("fr")}</Text></View>
                      <View style={styles.cellStack}>
                        <CellText strong>{displayIdentity(user)}</CellText>
                        <CellText muted small>{user.name ? user.phone ?? user.email ?? "Coordonnée absente" : user.email ?? `Compte #${user.id}`}</CellText>
                      </View>
                    </View>
                  );
                case "verification":
                  return <StatusBadge label={user.verificationStatus === "verified" ? "Vérifié" : "À vérifier"} tone={user.verificationStatus === "verified" ? "success" : "warning"} />;
                case "role":
                  return <CellText muted={user.role !== "admin"}>{user.role === "admin" ? "Administrateur" : "Utilisateur"}</CellText>;
                case "premium":
                  return <CellText muted={!user.subscriptionEnd}>{user.subscriptionEnd ? formatShortDate(user.subscriptionEnd) : "Non actif"}</CellText>;
                case "created":
                  return <CellText muted>{formatShortDate(user.createdAt)}</CellText>;
                case "lastSignedIn":
                  return <CellText muted>{formatShortDate(user.lastSignedIn)}</CellText>;
                default:
                  return null;
              }
            }}
          />
        ) : (
          <View style={styles.list}>{rows.map((user) => <View key={user.id} style={[styles.listCard, { backgroundColor: palette.card, borderColor: palette.border }]}><View style={styles.userTop}><View style={[styles.avatar, { backgroundColor: palette.softGreen }]}><Text style={[styles.avatarText, { color: palette.brand }]}>{displayIdentity(user).slice(0, 1).toLocaleUpperCase("fr")}</Text></View><View style={styles.listMain}><Text style={[styles.listTitle, { color: palette.text }]}>{displayIdentity(user)}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>{user.phone ?? user.email ?? "Coordonnée absente"}</Text></View><StatusBadge label={user.verificationStatus === "verified" ? "Vérifié" : "À vérifier"} tone={user.verificationStatus === "verified" ? "success" : "warning"} /></View><View style={styles.detailRow}><Text style={[styles.listMeta, { color: palette.muted }]}>Vérification : {user.phoneVerifiedAt ? formatDate(user.phoneVerifiedAt) : "Non vérifié"}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>Rôle : {user.role === "admin" ? "Administrateur" : "Utilisateur"}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>Premium : {user.subscriptionEnd ? formatDate(user.subscriptionEnd) : "Non actif"}</Text></View></View>)}</View>
        )}
        {pagination}
      </PageState>
    </AdminPage>
  );
}

const PREMIUM_COLUMNS: readonly Column[] = [
  { key: "user", label: "Utilisateur", flex: 2 },
  { key: "plan", label: "Formule", flex: 1 },
  { key: "amount", label: "Montant", flex: 1, align: "right" },
  { key: "status", label: "Statut", flex: 1 },
  { key: "date", label: "Date", flex: 1.2 },
  { key: "subscriptionEnd", label: "Fin d’abonnement", flex: 1.2 },
  { key: "reference", label: "Référence", flex: 2 },
];

function Premium() {
  const palette = usePremiumPalette();
  const wide = useWideLayout();
  const [page, setPage] = usePage("transactions");
  const transactions = trpc.admin.premium.transactions.useQuery({ page, limit: PAGE_SIZE }, { retry: 1, placeholderData: (previous) => previous });
  const rows = transactions.data?.items ?? [];
  const pagination = <Pagination page={page} limit={PAGE_SIZE} total={transactions.data?.total ?? 0} onChange={setPage} />;
  const status = (value: string) => TRANSACTION_STATUS[value] ?? { label: value, tone: "muted" as const };
  return (
    <AdminPage section="premium">
      <PageState loading={transactions.isLoading} error={transactions.error} onRetry={() => transactions.refetch()} empty={!rows.length}>
        {pagination}
        {wide ? (
          <DataTable
            columns={PREMIUM_COLUMNS}
            rows={rows}
            rowKey={(transaction) => String(transaction.id)}
            renderCell={(transaction, key) => {
              switch (key) {
                case "user":
                  return <CellText strong>{displayIdentity({ name: transaction.userName, phone: transaction.userPhone, email: transaction.userEmail, id: transaction.userId })}</CellText>;
                case "plan":
                  return <CellText>{PLAN_LABELS[transaction.planId] ?? transaction.planId}</CellText>;
                case "amount":
                  return <CellText strong>{formatXof(transaction.amount)}</CellText>;
                case "status":
                  return <StatusBadge {...status(transaction.status)} />;
                case "date":
                  return <CellText muted>{formatShortDate(transaction.createdAt)}</CellText>;
                case "subscriptionEnd":
                  return <CellText muted>{formatShortDate(transaction.subscriptionEnd)}</CellText>;
                case "reference":
                  return <CellText muted small>{transaction.merchantReference}</CellText>;
                default:
                  return null;
              }
            }}
          />
        ) : (
          <View style={styles.list}>{rows.map((transaction) => <View key={transaction.id} style={[styles.listCard, { backgroundColor: palette.card, borderColor: palette.border }]}><View style={styles.userTop}><View style={[styles.typeIcon, { backgroundColor: `${palette.clinic}18` }]}><MaterialIcons name="workspace-premium" size={20} color={palette.clinic} /></View><View style={styles.listMain}><Text style={[styles.listTitle, { color: palette.text }]}>{displayIdentity({ name: transaction.userName, phone: transaction.userPhone, email: transaction.userEmail, id: transaction.userId })}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>{PLAN_LABELS[transaction.planId] ?? transaction.planId} · {formatDate(transaction.createdAt)}</Text></View><StatusBadge {...status(transaction.status)} /></View><View style={styles.detailRow}><Text style={[styles.amount, { color: palette.text }]}>{formatXof(transaction.amount)}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>Abonnement : {formatDate(transaction.subscriptionEnd)}</Text></View><Text numberOfLines={1} style={[styles.reference, { color: palette.muted }]}>Réf. {transaction.merchantReference}</Text></View>)}</View>
        )}
        {pagination}
      </PageState>
    </AdminPage>
  );
}

const AUDIT_COLUMNS: readonly Column[] = [
  { key: "action", label: "Action", flex: 2 },
  { key: "target", label: "Cible", flex: 2.2 },
  { key: "actor", label: "Auteur", flex: 1.4 },
  { key: "date", label: "Date", flex: 1.1 },
];

function Audit() {
  const palette = usePremiumPalette();
  const wide = useWideLayout();
  const [showViews, setShowViews] = useState(false);
  const [page, setPage] = usePage(String(showViews));
  // Les consultations de pages restent journalisées, mais masquées par défaut pour laisser voir les vraies actions.
  const events = trpc.admin.audit.list.useQuery({ includeViews: showViews, page, limit: PAGE_SIZE }, { retry: 1, placeholderData: (previous) => previous });
  const rows = events.data?.items ?? [];
  const pagination = <Pagination page={page} limit={PAGE_SIZE} total={events.data?.total ?? 0} onChange={setPage} />;
  const iconFor = (action: string) => action.includes("archived") ? "archive" as const : action.includes("restored") ? "unarchive" as const : action.includes("viewed") ? "visibility" as const : "edit" as const;
  const colorFor = (action: string) => action.includes("archived") ? palette.danger : action.includes("viewed") ? palette.muted : palette.brand;
  const targetLabel = (event: { targetType: string; targetId: string | null }) => `${AUDIT_TARGETS[event.targetType] ?? event.targetType}${event.targetId ? ` · ${event.targetId}` : ""}`;
  return (
    <AdminPage section="audit">
      <SegmentControl style={wide ? styles.toolbarSegment : undefined} value={showViews ? "all" : "actions"} onChange={(value) => setShowViews(value === "all")} options={[{ value: "actions", label: "Modifications" }, { value: "all", label: "Tout, consultations comprises" }]} />
      <PageState loading={events.isLoading} error={events.error} onRetry={() => events.refetch()} empty={!rows.length}>
        {pagination}
        {wide ? (
          <DataTable
            columns={AUDIT_COLUMNS}
            rows={rows}
            rowKey={(event) => String(event.id)}
            renderCell={(event, key) => {
              switch (key) {
                case "action":
                  return (
                    <View style={styles.cellIdentity}>
                      <MaterialIcons name={iconFor(event.action)} size={18} color={colorFor(event.action)} />
                      <CellText strong>{auditActionLabel(event.action)}</CellText>
                    </View>
                  );
                case "target":
                  return <CellText muted>{targetLabel(event)}</CellText>;
                case "actor":
                  return <CellText>{displayIdentity({ name: event.actorName, phone: event.actorPhone, email: event.actorEmail, id: event.actorUserId })}</CellText>;
                case "date":
                  return <CellText muted>{formatShortDate(event.createdAt)}</CellText>;
                default:
                  return null;
              }
            }}
          />
        ) : (
          <View style={styles.list}>{rows.map((event) => <View key={event.id} style={[styles.auditCard, { backgroundColor: palette.card, borderColor: palette.border }]}><View style={[styles.auditIcon, { backgroundColor: palette.softGreen }]}><MaterialIcons name={iconFor(event.action)} size={19} color={colorFor(event.action)} /></View><View style={styles.listMain}><Text style={[styles.listTitle, { color: palette.text }]}>{auditActionLabel(event.action)}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>{displayIdentity({ name: event.actorName, phone: event.actorPhone, email: event.actorEmail, id: event.actorUserId })} · {formatDate(event.createdAt)}</Text><Text style={[styles.reference, { color: palette.muted }]}>{targetLabel(event)}</Text></View></View>)}</View>
        )}
        {pagination}
      </PageState>
    </AdminPage>
  );
}

const DUTY_COLUMNS: readonly Column[] = [
  { key: "period", label: "Semaine (relève à 8 h)", flex: 2.4 },
  { key: "group", label: "Garde", flex: 1 },
  { key: "count", label: "Pharmacies", flex: 1, align: "right" },
];

function Duty() {
  const palette = usePremiumPalette();
  const wide = useWideLayout();
  const overview = trpc.admin.duty.overview.useQuery({ weeks: 8 }, { retry: 1 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const cities = overview.data ?? [];
  return (
    <AdminPage section="duty">
      <PageState loading={overview.isLoading} error={overview.error} onRetry={() => overview.refetch()} empty={!cities.length}>
        <View style={[styles.dutyGrid, wide && styles.dutyGridWide]}>
          {cities.map((city) => {
            const current = city.weeks[0];
            const open = expanded === city.city;
            type DutyWeekRow = (typeof city.weeks)[number];
            return (
              <View key={city.city} style={[styles.dutyCard, wide && styles.dutyCardWide, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <View style={styles.dutyHeader}>
                  <View style={styles.listMain}>
                    <Text style={[styles.dutyCity, { color: palette.text }]}>{city.city}</Text>
                    <Text style={[styles.listMeta, { color: palette.muted }]}>{city.pharmacyCount} pharmacies dans l’annuaire</Text>
                  </View>
                </View>
                {current ? (
                  <View style={[styles.dutyNow, { backgroundColor: palette.softGreen }]}>
                    <MaterialIcons name="event-available" size={20} color={palette.brand} />
                    <Text style={[styles.dutyNowText, { color: palette.text }]}>
                      {current.label} · {current.pharmacyCount} pharmacies, du {formatDutyDate(current.start)} au {formatDutyDate(current.end)}
                    </Text>
                  </View>
                ) : null}
                {city.withoutGroup.length ? (
                  <Text style={[styles.fieldHint, { color: palette.warning }]}>
                    Sans groupe de garde, jamais affichée de garde : {city.withoutGroup.map((pharmacy) => pharmacy.name).join(", ")}
                  </Text>
                ) : null}
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} style={({ pressed }) => [styles.dutyToggle, pressed && styles.pressed]} onPress={() => setExpanded(open ? null : city.city)}>
                  <Text style={[styles.compactActionText, { color: palette.brand }]}>{open ? "Masquer" : "Voir"} les pharmacies de garde cette semaine</Text>
                  <MaterialIcons name={open ? "expand-less" : "expand-more"} size={20} color={palette.brand} />
                </Pressable>
                {open ? (
                  <View style={styles.dutyPharmacies}>
                    {city.onDutyNow.map((pharmacy) => (
                      <View key={pharmacy.id} style={[styles.dutyPharmacy, { borderBottomColor: palette.border }]}>
                        <Text numberOfLines={1} style={[styles.td, styles.tdStrong, { color: palette.text, flex: 1 }]}>{pharmacy.name}</Text>
                        <Text numberOfLines={1} style={[styles.td, { color: palette.muted }]}>{pharmacy.phone ?? "—"}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <Text style={[styles.fieldLabel, { color: palette.text }]}>Semaines à venir</Text>
                <DataTable<DutyWeekRow>
                  columns={DUTY_COLUMNS}
                  rows={city.weeks}
                  rowKey={(week) => week.start}
                  selectedKey={current?.start ?? null}
                  renderCell={(week, key) => {
                    switch (key) {
                      case "period":
                        return <CellText>{formatDutyDay(week.start)} → {formatDutyDay(week.end)}</CellText>;
                      case "group":
                        return <CellText strong>{week.label}</CellText>;
                      case "count":
                        return <CellText muted>{week.pharmacyCount}</CellText>;
                      default:
                        return null;
                    }
                  }}
                />
              </View>
            );
          })}
        </View>
      </PageState>
    </AdminPage>
  );
}

function HoursPage() {
  const palette = usePremiumPalette();
  const wide = useWideLayout();
  const utils = trpc.useUtils();
  const cities = trpc.admin.hours.cities.useQuery(undefined, { retry: 1 });
  const [editing, setEditing] = useState<{ city: string; hours: WeeklyHours } | null>(null);
  const refresh = async () => {
    haptic.success();
    setEditing(null);
    await utils.admin.hours.cities.invalidate();
  };
  const setCity = trpc.admin.hours.setCity.useMutation({ onSuccess: refresh });
  const resetCity = trpc.admin.hours.resetCity.useMutation({ onSuccess: refresh });
  const rows = cities.data ?? [];
  const invalid = editing ? !!validateWeeklyHours(editing.hours) : false;
  return (
    <AdminPage section="hours">
      {resetCity.error ? <Text style={[styles.inlineError, { color: palette.danger }]}>{resetCity.error.message}</Text> : null}
      <PageState loading={cities.isLoading} error={cities.error} onRetry={() => cities.refetch()} empty={!rows.length}>
        <View style={[styles.dutyGrid, wide && styles.dutyGridWide]}>
          {rows.map((entry) => (
            <View key={entry.city} style={[styles.dutyCard, wide && styles.hoursCardWide, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.dutyHeader}>
                <Text style={[styles.dutyCity, styles.listMain, { color: palette.text }]}>{entry.city}</Text>
                <StatusBadge label={entry.custom ? "Personnalisés" : "Par défaut"} tone={entry.custom ? "brand" : "muted"} />
              </View>
              {WEEK_DAYS.map((day) => (
                <View key={day} style={styles.hoursSummaryRow}>
                  <Text style={[styles.listMeta, { color: palette.muted, width: 86 }]}>{WEEK_DAY_LABELS[day]}</Text>
                  <Text style={[styles.listMeta, { color: entry.hours[day].length ? palette.text : palette.muted }]}>{entry.hours[day].length ? entry.hours[day].map((range) => `${range.open} – ${range.close}`).join(", ") : "Fermé"}</Text>
                </View>
              ))}
              <View style={styles.rowActions}>
                <Pressable accessibilityRole="button" style={[styles.compactAction, { borderColor: palette.border }]} onPress={() => { setCity.reset(); setEditing({ city: entry.city, hours: cloneHours(entry.hours) }); }}><MaterialIcons name="edit" size={17} color={palette.brand} /><Text style={[styles.compactActionText, { color: palette.brand }]}>Modifier</Text></Pressable>
                {entry.custom ? <Pressable accessibilityRole="button" disabled={resetCity.isPending} style={[styles.compactAction, { borderColor: palette.border }]} onPress={() => resetCity.mutate({ city: entry.city })}><MaterialIcons name="restart-alt" size={17} color={palette.muted} /><Text style={[styles.compactActionText, { color: palette.muted }]}>Rétablir par défaut</Text></Pressable> : null}
              </View>
            </View>
          ))}
        </View>
      </PageState>
      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={[styles.modalRoot, { backgroundColor: palette.overlay }]}>
          <View style={[styles.hoursModal, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={[styles.panelHeader, { borderBottomColor: palette.border }]}>
              <Text accessibilityRole="header" style={[styles.cardHeading, { color: palette.text }]}>Horaires de {editing?.city}</Text>
              <IconAction icon="close" label="Fermer" color={palette.text} onPress={() => setEditing(null)} />
            </View>
            <ScrollView contentContainerStyle={styles.panelContent}>
              {editing ? <WeeklyHoursEditor value={editing.hours} onChange={(value) => setEditing({ ...editing, hours: value })} /> : null}
              {setCity.error ? <Text style={[styles.inlineError, { color: palette.danger }]}>{setCity.error.message}</Text> : null}
              <View style={styles.formActions}>
                <Pressable accessibilityRole="button" style={[styles.secondaryButton, { borderColor: palette.border }]} onPress={() => setEditing(null)}><Text style={[styles.secondaryText, { color: palette.text }]}>Annuler</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={setCity.isPending || invalid} style={[styles.primaryButton, { backgroundColor: palette.brand }, (setCity.isPending || invalid) && styles.disabled]} onPress={() => editing && setCity.mutate({ city: editing.city, openingHours: editing.hours })}>{setCity.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.retryText}>Enregistrer</Text>}</Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AdminPage>
  );
}

export function AdminConsoleScreen({ section }: { section: AdminSection }) {
  return (
    <AdminShell section={section}>
      {section === "dashboard" ? <Dashboard /> : null}
      {section === "directory" ? <Directory /> : null}
      {section === "duty" ? <Duty /> : null}
      {section === "hours" ? <HoursPage /> : null}
      {section === "users" ? <Users /> : null}
      {section === "premium" ? <Premium /> : null}
      {section === "audit" ? <Audit /> : null}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  wideShell: { flex: 1, flexDirection: "row" },
  sidebar: { width: 248, borderRightWidth: 1 },
  shellContent: { flex: 1 },
  header: { minHeight: 68, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  headerButton: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#DDFBE8" },
  headerTitle: { flex: 1, color: "#FFFFFF", fontSize: 18, lineHeight: 24, fontWeight: "900", textAlign: "center" },
  headerSecurity: { width: 44, alignItems: "center" },
  page: { flex: 1 },
  pageContent: { padding: premiumSpacing.lg, paddingBottom: 38, gap: premiumSpacing.md },
  pageContentWide: { paddingHorizontal: 32, paddingTop: 28, width: "100%", maxWidth: 1440, alignSelf: "center" },
  pageHeader: { gap: 4, marginBottom: 4 },
  pageTitle: { fontSize: 26, lineHeight: 32, fontWeight: "900" },
  pageSubtitle: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  state: { minHeight: 172, borderRadius: premiumRadius.lg, alignItems: "center", justifyContent: "center", gap: 12, padding: 22, borderWidth: 1 },
  errorState: { borderWidth: 1 },
  stateText: { fontSize: 14, lineHeight: 21, fontWeight: "700", textAlign: "center" },
  retryButton: { minHeight: 42, paddingHorizontal: 18, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  retryText: { color: "#FFFFFF", fontWeight: "900", fontSize: 14 },
  deniedRoot: { flex: 1, padding: 22, justifyContent: "center", alignItems: "center" },
  deniedCard: { width: "100%", maxWidth: 440, borderRadius: premiumRadius.lg, borderWidth: 1, alignItems: "center", padding: 26, gap: 16 },
  deniedTitle: { fontSize: 20, lineHeight: 26, fontWeight: "900", textAlign: "center" },
  nav: { flex: 1 },
  navBrand: { minHeight: 72, paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1 },
  navMark: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  navBrandText: { flex: 1 },
  navKicker: { fontSize: 10, lineHeight: 14, letterSpacing: 0.8, fontWeight: "900" },
  navTitle: { fontSize: 17, lineHeight: 22, fontWeight: "900" },
  navScroll: { flex: 1 },
  navList: { padding: 10, gap: 2 },
  navItem: { minHeight: 42, borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  navItemText: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: "800" },
  navFooter: { padding: 10, gap: 4, borderTopWidth: 1 },
  navIdentity: { minHeight: 34, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  navIdentityText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  drawerRoot: { ...StyleSheet.absoluteFill, zIndex: 20 },
  drawerBackdrop: { ...StyleSheet.absoluteFill },
  drawer: { position: "absolute", left: 0, top: 0, bottom: 0, borderRightWidth: 1, shadowColor: "#07140C", shadowOpacity: 0.24, shadowRadius: 22, shadowOffset: { width: 8, height: 0 }, elevation: 18 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metricCard: { width: "47.8%", flexGrow: 1, minHeight: 128, borderRadius: premiumRadius.md, borderWidth: 1, padding: 14, justifyContent: "space-between" },
  metricCardWide: { width: "31%", minHeight: 116, padding: 18 },
  metricTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metricIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  metricValue: { fontSize: 28, lineHeight: 34, fontWeight: "900", marginTop: 10 },
  metricLabel: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  toolbar: { flexDirection: "row", gap: 9, alignItems: "center" },
  toolbarWide: { gap: 12, flexWrap: "wrap" },
  toolbarSearch: { flex: 1, minWidth: 260 },
  toolbarSegment: { width: 380 },
  searchWrap: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, minHeight: 42, fontSize: 14, fontWeight: "600" },
  addButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  addButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  segment: { minHeight: 44, padding: 4, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 4 },
  segmentOption: { flex: 1, minHeight: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segmentText: { fontSize: 12, lineHeight: 16, fontWeight: "900", textAlign: "center" },
  resultCount: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  pagination: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  paginationButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  filterRow: { gap: 9 },
  filterRowWide: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  filterSelect: { minWidth: 200 },
  statusSegment: { width: 260 },
  select: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  selectText: { flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  selectSheet: { width: "100%", maxWidth: 380, maxHeight: "80%", borderRadius: premiumRadius.lg, borderWidth: 1, paddingVertical: 12 },
  selectTitle: { flex: 0, paddingHorizontal: 16, paddingBottom: 8 },
  selectList: { flexGrow: 0 },
  selectOption: { minHeight: 44, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  selectOptionText: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
  fieldHint: { fontSize: 12, lineHeight: 17, fontWeight: "600" },
  dutyGrid: { gap: 14 },
  hoursCardWide: { flexBasis: 320, flexGrow: 1, maxWidth: 460 },
  hoursSummaryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hoursModal: { width: "100%", maxWidth: 560, maxHeight: "90%", borderRadius: premiumRadius.lg, borderWidth: 1, overflow: "hidden" },
  dutyGridWide: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  dutyCard: { borderRadius: premiumRadius.md, borderWidth: 1, padding: 16, gap: 12 },
  dutyCardWide: { flexBasis: 480, flexGrow: 1 },
  dutyHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  dutyCity: { fontSize: 19, lineHeight: 25, fontWeight: "900" },
  dutyNow: { borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  dutyNowText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  dutyToggle: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4 },
  dutyPharmacies: { gap: 0 },
  dutyPharmacy: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1 },
  splitRoot: { flex: 1 },
  splitRootWide: { flexDirection: "row" },
  sidePanel: { width: 420, borderLeftWidth: 1 },
  sheet: { flex: 1 },
  panelHeader: { minHeight: 64, paddingHorizontal: 18, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomWidth: 1 },
  panelContent: { padding: 18, paddingBottom: 40 },
  formFields: { gap: 12 },
  cardHeading: { flex: 1, fontSize: 17, lineHeight: 23, fontWeight: "900" },
  fieldWrap: { gap: 5 },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  fieldInput: { minHeight: 44, borderRadius: 11, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 19, fontWeight: "600" },
  fieldMultiline: { minHeight: 72, textAlignVertical: "top" },
  fieldRow: { flexDirection: "row", gap: 10 },
  fieldHalf: { flex: 1 },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 },
  secondaryButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 14, fontWeight: "900" },
  primaryButton: { minHeight: 42, borderRadius: 11, minWidth: 116, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  inlineError: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  iconButton: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  table: { borderRadius: premiumRadius.md, borderWidth: 1, overflow: "hidden" },
  tableHead: { minHeight: 40, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", borderBottomWidth: 1 },
  th: { fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
  tr: { minHeight: 52, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", borderTopWidth: 1 },
  trFirst: { borderTopWidth: 0 },
  cell: { paddingHorizontal: 8, paddingVertical: 8, justifyContent: "center", alignItems: "flex-start", minWidth: 0 },
  cellRight: { alignItems: "flex-end" },
  cellIdentity: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0, alignSelf: "stretch" },
  cellStack: { flex: 1, minWidth: 0, gap: 1 },
  cellActions: { flexDirection: "row", gap: 6 },
  td: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  tdStrong: { fontWeight: "800" },
  tdSmall: { fontSize: 12, lineHeight: 16 },
  list: { gap: 10 },
  listCard: { borderRadius: premiumRadius.md, borderWidth: 1, padding: 13, gap: 10 },
  listCardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  userTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  typeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  listMain: { flex: 1, gap: 2 },
  listTitle: { fontSize: 15, lineHeight: 20, fontWeight: "900" },
  listMeta: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  tagRow: { flexDirection: "row", gap: 9, alignItems: "center" },
  rowActions: { flexDirection: "row", gap: 8 },
  compactAction: { flex: 1, minHeight: 36, borderRadius: 10, borderWidth: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5 },
  compactActionText: { fontSize: 12, fontWeight: "900" },
  modalRoot: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  confirmCard: { width: "100%", maxWidth: 420, borderRadius: premiumRadius.lg, borderWidth: 1, padding: 20, alignItems: "center", gap: 12 },
  confirmTitle: { fontSize: 19, lineHeight: 25, fontWeight: "900", textAlign: "center" },
  confirmText: { fontSize: 14, lineHeight: 21, fontWeight: "600", textAlign: "center" },
  confirmActions: { width: "100%", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 5 },
  dangerButton: { minHeight: 42, minWidth: 108, borderRadius: 11, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 17, lineHeight: 21, fontWeight: "900" },
  avatarSmall: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarSmallText: { fontSize: 13, lineHeight: 17, fontWeight: "900" },
  statusPill: { maxWidth: 120, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, lineHeight: 15, fontWeight: "900", textAlign: "center", overflow: "hidden" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  amount: { fontSize: 15, lineHeight: 20, fontWeight: "900" },
  reference: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  auditCard: { borderRadius: premiumRadius.md, borderWidth: 1, padding: 13, flexDirection: "row", gap: 10 },
  auditIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
