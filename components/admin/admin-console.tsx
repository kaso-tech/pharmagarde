import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";

import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { haptic, premiumRadius, premiumSpacing, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";

type AdminSection = "dashboard" | "directory" | "users" | "premium" | "audit";
type DirectoryKind = "pharmacy" | "healthcare";

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
};

const ADMIN_NAV: ReadonlyArray<{ section: AdminSection; href: string; label: string; icon: keyof typeof MaterialIcons.glyphMap }> = [
  { section: "dashboard", href: "/admin", label: "Tableau de bord", icon: "dashboard" },
  { section: "directory", href: "/admin/annuaire", label: "Annuaire", icon: "local-pharmacy" },
  { section: "users", href: "/admin/utilisateurs", label: "Utilisateurs", icon: "group" },
  { section: "premium", href: "/admin/abonnements", label: "Premium", icon: "workspace-premium" },
  { section: "audit", href: "/admin/journal", label: "Journal", icon: "receipt-long" },
];

const SECTION_TITLES: Record<AdminSection, string> = {
  dashboard: "Tableau de bord",
  directory: "Annuaire",
  users: "Utilisateurs",
  premium: "Premium",
  audit: "Journal d’audit",
};

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
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fr-BF", { dateStyle: "medium", timeStyle: "short" }).format(date) : "—";
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

function AdminPage({ title, children }: PropsWithChildren<{ title: string }>) {
  const palette = usePremiumPalette();
  return (
    <ScrollView style={[styles.page, { backgroundColor: palette.background }]} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
      <Text accessibilityRole="header" style={[styles.pageTitle, { color: palette.text }]}>{title}</Text>
      {children}
    </ScrollView>
  );
}

function AdminDrawer({ visible, section, onClose }: { visible: boolean; section: AdminSection; onClose: () => void }) {
  const router = useRouter();
  const palette = usePremiumPalette();
  const { width } = useWindowDimensions();
  const { logout } = useAuth({ autoFetch: false });
  const drawerWidth = Math.min(Math.max(width * 0.82, 300), 380);

  if (!visible) return null;

  const signOut = async () => {
    await logout();
    onClose();
    router.replace("/auth/login" as never);
  };

  return (
    <View style={styles.drawerRoot} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu d’administration" style={[styles.drawerBackdrop, { backgroundColor: palette.overlay }]} onPress={onClose} />
      <View style={[styles.drawer, { width: drawerWidth, backgroundColor: palette.background, borderRightColor: palette.border }]}>
        <View style={[styles.drawerHero, { backgroundColor: palette.brand }]}>
          <View style={styles.drawerMark}><MaterialIcons name="admin-panel-settings" size={25} color="#FFFFFF" /></View>
          <View style={styles.drawerHeroText}>
            <Text style={styles.drawerKicker}>PHARMAGARDE BF</Text>
            <Text style={styles.drawerTitle}>Administration</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu" style={styles.drawerClose} onPress={onClose}>
            <MaterialIcons name="close" size={21} color={palette.brand} />
          </Pressable>
        </View>
        <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerList} showsVerticalScrollIndicator={false}>
          {ADMIN_NAV.map((item) => {
            const active = item.section === section;
            return (
              <Pressable
                key={item.section}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.drawerItem, { backgroundColor: active ? palette.softGreen : palette.card, borderColor: active ? palette.brand : palette.border }, pressed && styles.pressed]}
                onPress={() => {
                  haptic.selection();
                  onClose();
                  router.replace(item.href as never);
                }}
              >
                <View style={[styles.drawerIcon, { backgroundColor: active ? palette.brand : palette.cardMuted }]}><MaterialIcons name={item.icon} size={21} color={active ? "#FFFFFF" : palette.brand} /></View>
                <Text style={[styles.drawerItemText, { color: active ? palette.brand : palette.text }]}>{item.label}</Text>
                <MaterialIcons name="chevron-right" size={21} color={active ? palette.brand : palette.muted} />
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable accessibilityRole="button" style={[styles.drawerLogout, { borderTopColor: palette.border, backgroundColor: palette.card }]} onPress={signOut}>
          <View style={[styles.drawerIcon, { backgroundColor: "rgba(217,45,32,0.10)" }]}><MaterialIcons name="logout" size={21} color={palette.danger} /></View>
          <Text style={[styles.drawerItemText, { color: palette.danger }]}>Se déconnecter</Text>
        </Pressable>
      </View>
    </View>
  );
}

function AdminShell({ section, children }: PropsWithChildren<{ section: AdminSection }>) {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const palette = usePremiumPalette();
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

  return (
    <View style={[styles.shell, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { backgroundColor: palette.brand }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Ouvrir le menu d’administration" style={styles.headerButton} onPress={() => setDrawerVisible(true)}>
          <MaterialIcons name="menu" size={24} color={palette.brand} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>{SECTION_TITLES[section]}</Text>
        <View style={styles.headerSecurity}><MaterialIcons name="verified-user" size={21} color="#FFFFFF" /></View>
      </View>
      <View style={styles.shellContent}>{children}</View>
      <AdminDrawer visible={drawerVisible} section={section} onClose={() => setDrawerVisible(false)} />
    </View>
  );
}

function Dashboard() {
  const summary = trpc.admin.dashboard.useQuery(undefined, { retry: 1 });
  const palette = usePremiumPalette();
  const metrics = useMemo(
    () => summary.data ? [
      { label: "Utilisateurs", value: summary.data.users, icon: "group" as const, color: palette.brand },
      { label: "Vérifiés", value: summary.data.verifiedUsers, icon: "verified" as const, color: palette.success },
      { label: "Premium actifs", value: summary.data.premiumUsers, icon: "workspace-premium" as const, color: palette.clinic },
      { label: "Transactions", value: summary.data.transactions, icon: "receipt-long" as const, color: palette.brand },
      { label: "En attente", value: summary.data.pendingTransactions, icon: "pending-actions" as const, color: palette.warning },
      { label: "Établissements", value: summary.data.directoryEntries, icon: "local-hospital" as const, color: palette.clinic },
    ] : [],
    [palette.brand, palette.clinic, palette.success, palette.warning, summary.data],
  );

  return (
    <AdminPage title="Tableau de bord">
      <PageState loading={summary.isLoading} error={summary.error} onRetry={() => summary.refetch()}>
        <View style={styles.metricGrid}>
          {metrics.map((metric) => (
            <View key={metric.label} style={[styles.metricCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={[styles.metricIcon, { backgroundColor: `${metric.color}18` }]}><MaterialIcons name={metric.icon} size={21} color={metric.color} /></View>
              <Text style={[styles.metricValue, { color: palette.text }]}>{metric.value}</Text>
              <Text style={[styles.metricLabel, { color: palette.muted }]}>{metric.label}</Text>
            </View>
          ))}
        </View>
      </PageState>
    </AdminPage>
  );
}

function SegmentControl({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: ReadonlyArray<{ value: string; label: string }> }) {
  const palette = usePremiumPalette();
  return (
    <View style={[styles.segment, { backgroundColor: palette.cardMuted, borderColor: palette.border }]}>
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

function Directory() {
  const utils = trpc.useUtils();
  const palette = usePremiumPalette();
  const [kind, setKind] = useState<"all" | DirectoryKind>("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<DirectoryForm>(EMPTY_DIRECTORY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; kind: DirectoryKind; name: string } | null>(null);
  const directory = trpc.admin.directory.list.useQuery({ kind, search: search || undefined, limit: 100 }, { retry: 1 });
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

  const updateField = <K extends keyof DirectoryForm>(key: K, value: DirectoryForm[K]) => setForm((current) => ({ ...current, [key]: value }));
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
    });
  };

  return (
    <AdminPage title="Annuaire">
      <View style={styles.toolbar}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Rechercher" placeholderTextColor={palette.muted} style={[styles.searchInput, { color: palette.text, backgroundColor: palette.card, borderColor: palette.border }]} />
        <Pressable accessibilityRole="button" style={[styles.addButton, { backgroundColor: palette.brand }]} onPress={() => { setForm(EMPTY_DIRECTORY_FORM); setShowForm((visible) => !visible); }}><MaterialIcons name="add" size={20} color="#FFFFFF" /><Text style={styles.addButtonText}>Ajouter</Text></Pressable>
      </View>
      <SegmentControl value={kind} onChange={(value) => setKind(value as "all" | DirectoryKind)} options={[{ value: "all", label: "Tous" }, { value: "pharmacy", label: "Pharmacies" }, { value: "healthcare", label: "Soins" }]} />
      {showForm ? (
        <View style={[styles.formCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.cardHeading, { color: palette.text }]}>{form.id ? "Modifier l’établissement" : "Nouvel établissement"}</Text>
          <SegmentControl value={form.kind} onChange={(value) => updateField("kind", value as DirectoryKind)} options={[{ value: "pharmacy", label: "Pharmacie" }, { value: "healthcare", label: "Soins" }]} />
          <Field label="Nom" value={form.name} onChangeText={(value) => updateField("name", value)} />
          <Field label="Ville" value={form.city} onChangeText={(value) => updateField("city", value)} />
          <Field label="Téléphone" value={form.phone} onChangeText={(value) => updateField("phone", value)} placeholder="+226 70 00 00 00" keyboardType="phone-pad" />
          <Field label="Adresse" value={form.address} onChangeText={(value) => updateField("address", value)} multiline />
          <View style={styles.fieldRow}><View style={styles.fieldHalf}><Field label="Latitude" value={form.latitude} onChangeText={(value) => updateField("latitude", value)} keyboardType="numeric" /></View><View style={styles.fieldHalf}><Field label="Longitude" value={form.longitude} onChangeText={(value) => updateField("longitude", value)} keyboardType="numeric" /></View></View>
          {form.kind === "pharmacy" ? <Field label="Groupe de garde (1–4)" value={form.dutyGroup} onChangeText={(value) => updateField("dutyGroup", value)} keyboardType="numeric" /> : <Field label="Type d’établissement" value={form.establishmentType} onChangeText={(value) => updateField("establishmentType", value)} />}
          {upsert.error ? <Text style={[styles.inlineError, { color: palette.danger }]}>{upsert.error.message}</Text> : null}
          <View style={styles.formActions}><Pressable accessibilityRole="button" style={[styles.secondaryButton, { borderColor: palette.border }]} disabled={upsert.isPending} onPress={() => { setShowForm(false); setForm(EMPTY_DIRECTORY_FORM); }}><Text style={[styles.secondaryText, { color: palette.text }]}>Annuler</Text></Pressable><Pressable accessibilityRole="button" style={[styles.primaryButton, { backgroundColor: palette.brand }]} disabled={upsert.isPending || !form.name.trim() || !form.city.trim()} onPress={submit}>{upsert.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.retryText}>Enregistrer</Text>}</Pressable></View>
        </View>
      ) : null}
      <PageState loading={directory.isLoading} error={directory.error} onRetry={() => directory.refetch()} empty={!directory.data?.length}>
        <View style={styles.list}>
          {directory.data?.map((item) => (
            <View key={item.id} style={[styles.listCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.listCardTop}><View style={[styles.typeIcon, { backgroundColor: item.kind === "pharmacy" ? palette.softGreen : `${palette.clinic}18` }]}><MaterialIcons name={item.kind === "pharmacy" ? "local-pharmacy" : "local-hospital"} size={20} color={item.kind === "pharmacy" ? palette.brand : palette.clinic} /></View><View style={styles.listMain}><Text style={[styles.listTitle, { color: palette.text }]}>{item.name}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>{item.city} · {item.establishmentType ?? "Établissement"}</Text></View></View>
              <View style={styles.tagRow}><Text style={[styles.sourceTag, { color: item.managed ? palette.brand : palette.muted, borderColor: item.managed ? palette.brand : palette.border }]}>{item.managed ? "Administré" : item.source}</Text>{item.phone ? <Text style={[styles.listMeta, { color: palette.muted }]}>{item.phone}</Text> : null}</View>
              <View style={styles.rowActions}><Pressable accessibilityRole="button" style={[styles.compactAction, { borderColor: palette.border }]} onPress={() => { setForm({ id: item.id, kind: item.kind, name: item.name, city: item.city, phone: item.phone ?? "", address: item.address ?? "", latitude: item.latitude?.toString() ?? "", longitude: item.longitude?.toString() ?? "", dutyGroup: item.dutyGroup?.toString() ?? "", establishmentType: item.establishmentType ?? "Centre de santé" }); setShowForm(true); }}><MaterialIcons name="edit" size={17} color={palette.brand} /><Text style={[styles.compactActionText, { color: palette.brand }]}>Modifier</Text></Pressable><Pressable accessibilityRole="button" style={[styles.compactAction, { borderColor: palette.danger }]} onPress={() => setArchiveTarget({ id: item.id, kind: item.kind, name: item.name })}><MaterialIcons name="archive" size={17} color={palette.danger} /><Text style={[styles.compactActionText, { color: palette.danger }]}>Archiver</Text></Pressable></View>
            </View>
          ))}
        </View>
      </PageState>
      <ConfirmationModal itemName={archiveTarget?.name ?? ""} visible={!!archiveTarget} loading={archive.isPending} onClose={() => setArchiveTarget(null)} onConfirm={() => archiveTarget && archive.mutate({ id: archiveTarget.id, kind: archiveTarget.kind })} />
    </AdminPage>
  );
}

function Users() {
  const palette = usePremiumPalette();
  const [search, setSearch] = useState("");
  const users = trpc.admin.users.list.useQuery({ search: search || undefined, limit: 100 }, { retry: 1 });
  return (
    <AdminPage title="Utilisateurs">
      <TextInput value={search} onChangeText={setSearch} placeholder="Rechercher par nom, téléphone ou e-mail" placeholderTextColor={palette.muted} style={[styles.searchInput, { color: palette.text, backgroundColor: palette.card, borderColor: palette.border }]} />
      <PageState loading={users.isLoading} error={users.error} onRetry={() => users.refetch()} empty={!users.data?.length}>
        <View style={styles.list}>{users.data?.map((user) => <View key={user.id} style={[styles.listCard, { backgroundColor: palette.card, borderColor: palette.border }]}><View style={styles.userTop}><View style={[styles.avatar, { backgroundColor: palette.softGreen }]}><Text style={[styles.avatarText, { color: palette.brand }]}>{displayIdentity(user).slice(0, 1).toLocaleUpperCase("fr")}</Text></View><View style={styles.listMain}><Text style={[styles.listTitle, { color: palette.text }]}>{displayIdentity(user)}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>{user.phone ?? user.email ?? "Coordonnée absente"}</Text></View><Text style={[styles.statusPill, { color: user.verificationStatus === "verified" ? palette.success : palette.warning, borderColor: user.verificationStatus === "verified" ? palette.success : palette.warning }]}>{user.verificationStatus === "verified" ? "Vérifié" : "À vérifier"}</Text></View><View style={styles.detailRow}><Text style={[styles.listMeta, { color: palette.muted }]}>Rôle : {user.role === "admin" ? "Administrateur" : "Utilisateur"}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>Premium : {user.subscriptionEnd ? formatDate(user.subscriptionEnd) : "Non actif"}</Text></View></View>)}</View>
      </PageState>
    </AdminPage>
  );
}

function Premium() {
  const palette = usePremiumPalette();
  const transactions = trpc.admin.premium.transactions.useQuery({ limit: 100 }, { retry: 1 });
  return (
    <AdminPage title="Premium">
      <PageState loading={transactions.isLoading} error={transactions.error} onRetry={() => transactions.refetch()} empty={!transactions.data?.length}>
        <View style={styles.list}>{transactions.data?.map((transaction) => <View key={transaction.id} style={[styles.listCard, { backgroundColor: palette.card, borderColor: palette.border }]}><View style={styles.userTop}><View style={[styles.typeIcon, { backgroundColor: `${palette.clinic}18` }]}><MaterialIcons name="workspace-premium" size={20} color={palette.clinic} /></View><View style={styles.listMain}><Text style={[styles.listTitle, { color: palette.text }]}>{displayIdentity({ name: transaction.userName, phone: transaction.userPhone, email: transaction.userEmail, id: transaction.userId })}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>{transaction.planId} · {formatDate(transaction.createdAt)}</Text></View><Text style={[styles.statusPill, { color: transaction.status === "success" ? palette.success : transaction.status === "pending" ? palette.warning : palette.danger, borderColor: transaction.status === "success" ? palette.success : transaction.status === "pending" ? palette.warning : palette.danger }]}>{transaction.status}</Text></View><View style={styles.detailRow}><Text style={[styles.amount, { color: palette.text }]}>{formatXof(transaction.amount)}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>Abonnement : {formatDate(transaction.subscriptionEnd)}</Text></View><Text numberOfLines={1} style={[styles.reference, { color: palette.muted }]}>Réf. {transaction.merchantReference}</Text></View>)}</View>
      </PageState>
    </AdminPage>
  );
}

function Audit() {
  const palette = usePremiumPalette();
  const events = trpc.admin.audit.list.useQuery({ limit: 100 }, { retry: 1 });
  return (
    <AdminPage title="Journal d’audit">
      <PageState loading={events.isLoading} error={events.error} onRetry={() => events.refetch()} empty={!events.data?.length}>
        <View style={styles.list}>{events.data?.map((event) => <View key={event.id} style={[styles.auditCard, { backgroundColor: palette.card, borderColor: palette.border }]}><View style={[styles.auditIcon, { backgroundColor: palette.softGreen }]}><MaterialIcons name={event.action.includes("archived") ? "archive" : event.action.includes("viewed") ? "visibility" : "edit"} size={19} color={event.action.includes("archived") ? palette.danger : palette.brand} /></View><View style={styles.listMain}><Text style={[styles.listTitle, { color: palette.text }]}>{event.action}</Text><Text style={[styles.listMeta, { color: palette.muted }]}>{displayIdentity({ name: event.actorName, phone: event.actorPhone, email: event.actorEmail, id: event.actorUserId })} · {formatDate(event.createdAt)}</Text><Text style={[styles.reference, { color: palette.muted }]}>{event.targetType}{event.targetId ? ` · ${event.targetId}` : ""}</Text></View></View>)}</View>
      </PageState>
    </AdminPage>
  );
}

export function AdminConsoleScreen({ section }: { section: AdminSection }) {
  return (
    <AdminShell section={section}>
      {section === "dashboard" ? <Dashboard /> : null}
      {section === "directory" ? <Directory /> : null}
      {section === "users" ? <Users /> : null}
      {section === "premium" ? <Premium /> : null}
      {section === "audit" ? <Audit /> : null}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  shellContent: { flex: 1 },
  header: { minHeight: 68, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  headerButton: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#DDFBE8" },
  headerTitle: { flex: 1, color: "#FFFFFF", fontSize: 18, lineHeight: 24, fontWeight: "900", textAlign: "center" },
  headerSecurity: { width: 44, alignItems: "center" },
  page: { flex: 1 },
  pageContent: { padding: premiumSpacing.lg, paddingBottom: 38, gap: premiumSpacing.md },
  pageTitle: { fontSize: 27, lineHeight: 34, fontWeight: "900", marginBottom: 2 },
  state: { minHeight: 172, borderRadius: premiumRadius.lg, alignItems: "center", justifyContent: "center", gap: 12, padding: 22, borderWidth: 1 },
  errorState: { borderWidth: 1 },
  stateText: { fontSize: 14, lineHeight: 21, fontWeight: "700", textAlign: "center" },
  retryButton: { minHeight: 42, paddingHorizontal: 18, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  retryText: { color: "#FFFFFF", fontWeight: "900", fontSize: 14 },
  deniedRoot: { flex: 1, padding: 22, justifyContent: "center" },
  deniedCard: { borderRadius: premiumRadius.lg, borderWidth: 1, alignItems: "center", padding: 26, gap: 16 },
  deniedTitle: { fontSize: 20, lineHeight: 26, fontWeight: "900", textAlign: "center" },
  drawerRoot: { ...StyleSheet.absoluteFill, zIndex: 20 },
  drawerBackdrop: { ...StyleSheet.absoluteFill },
  drawer: { position: "absolute", left: 0, top: 0, bottom: 0, borderRightWidth: 1, shadowColor: "#07140C", shadowOpacity: 0.24, shadowRadius: 22, shadowOffset: { width: 8, height: 0 }, elevation: 18 },
  drawerHero: { minHeight: 100, paddingHorizontal: 17, paddingVertical: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  drawerMark: { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.20)", borderWidth: 1, borderColor: "rgba(255,255,255,0.34)" },
  drawerHeroText: { flex: 1 },
  drawerKicker: { color: "#E8FFF0", fontSize: 10, lineHeight: 14, letterSpacing: 0.8, fontWeight: "900" },
  drawerTitle: { color: "#FFFFFF", fontSize: 22, lineHeight: 28, fontWeight: "900" },
  drawerClose: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  drawerScroll: { flex: 1 },
  drawerList: { padding: 14, gap: 8 },
  drawerItem: { minHeight: 58, borderRadius: 14, padding: 10, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1 },
  drawerIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  drawerItemText: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "900" },
  drawerLogout: { minHeight: 72, padding: 14, flexDirection: "row", alignItems: "center", gap: 11, borderTopWidth: 1 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metricCard: { width: "47.8%", flexGrow: 1, minHeight: 142, borderRadius: premiumRadius.md, borderWidth: 1, padding: 14, justifyContent: "space-between" },
  metricIcon: { width: 39, height: 39, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  metricValue: { fontSize: 28, lineHeight: 34, fontWeight: "900", marginTop: 12 },
  metricLabel: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  toolbar: { flexDirection: "row", gap: 9, alignItems: "center" },
  searchInput: { flex: 1, minHeight: 46, borderRadius: 13, borderWidth: 1, paddingHorizontal: 13, fontSize: 14, fontWeight: "700" },
  addButton: { minHeight: 46, borderRadius: 13, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  addButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  segment: { minHeight: 44, padding: 4, borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 4 },
  segmentOption: { flex: 1, minHeight: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segmentText: { fontSize: 12, lineHeight: 16, fontWeight: "900", textAlign: "center" },
  formCard: { borderRadius: premiumRadius.lg, borderWidth: 1, padding: 15, gap: 11 },
  cardHeading: { fontSize: 18, lineHeight: 24, fontWeight: "900" },
  fieldWrap: { gap: 5 },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  fieldInput: { minHeight: 44, borderRadius: 11, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 19, fontWeight: "600" },
  fieldMultiline: { minHeight: 72, textAlignVertical: "top" },
  fieldRow: { flexDirection: "row", gap: 10 },
  fieldHalf: { flex: 1 },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 3 },
  secondaryButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 14, fontWeight: "900" },
  primaryButton: { minHeight: 42, borderRadius: 11, minWidth: 116, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  inlineError: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  list: { gap: 10 },
  listCard: { borderRadius: premiumRadius.md, borderWidth: 1, padding: 13, gap: 10 },
  listCardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  userTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  typeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  listMain: { flex: 1, gap: 2 },
  listTitle: { fontSize: 15, lineHeight: 20, fontWeight: "900" },
  listMeta: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  tagRow: { flexDirection: "row", gap: 9, alignItems: "center" },
  sourceTag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, fontSize: 11, lineHeight: 15, fontWeight: "900", textTransform: "capitalize" },
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
  statusPill: { maxWidth: 105, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, lineHeight: 14, fontWeight: "900", textTransform: "capitalize", textAlign: "center" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  amount: { fontSize: 15, lineHeight: 20, fontWeight: "900" },
  reference: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  auditCard: { borderRadius: premiumRadius.md, borderWidth: 1, padding: 13, flexDirection: "row", gap: 10 },
  auditIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
