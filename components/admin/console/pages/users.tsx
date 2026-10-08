import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";

import { AdminPage } from "../shell";
import { PAGE_SIZE, PLAN_LABELS, TRANSACTION_STATUS, auditActionLabel, displayIdentity, formatDate, formatDay, formatXof, isActiveSubscription, useDebouncedValue, usePage } from "../shared";
import { font, useAdminLayout, useAdminTheme } from "../theme";
import { Alert, Avatar, Badge, Button, Card, CellStack, CellText, Chip, ConfirmDialog, DataState, DataTable, Dialog, Field, FieldLabel, Hint, Pagination, SearchInput, Select, Toolbar, type Column } from "../ui";

const COLUMNS: readonly Column[] = [
  { key: "user", label: "Utilisateur", flex: 2.2 },
  { key: "verification", label: "Téléphone", flex: 1.1 },
  { key: "role", label: "Rôle", width: 130 },
  { key: "premium", label: "Premium jusqu’au", flex: 1.2 },
  { key: "created", label: "Inscription", flex: 1 },
  { key: "lastSignedIn", label: "Dernière connexion", flex: 1.2 },
  { key: "actions", label: "", width: 150, align: "right" },
];

const GIFT_DURATIONS = [
  { value: "7", label: "1 semaine" },
  { value: "30", label: "1 mois" },
  { value: "90", label: "3 mois" },
  { value: "180", label: "6 mois" },
  { value: "365", label: "1 an" },
  { value: "custom", label: "Autre durée" },
] as const;

type GiftTarget = { id: number; name: string | null; phone: string | null; email: string | null; subscriptionEnd: string | null };

/** Fin d'abonnement après l'offre : prolonge l'abonnement en cours, sinon part d'aujourd'hui. */
function giftEndPreview(subscriptionEnd: string | null, durationDays: number, now = Date.now()) {
  const start = isActiveSubscription(subscriptionEnd, now) ? new Date(subscriptionEnd!).getTime() : now;
  return new Date(start + durationDays * 24 * 60 * 60 * 1000).toISOString();
}

function PremiumGiftDialog({ target, onClose }: { target: GiftTarget | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const theme = useAdminTheme();
  const [duration, setDuration] = useState<string>("30");
  const [customDays, setCustomDays] = useState("");
  const [reason, setReason] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const refresh = () => Promise.all([utils.admin.users.list.invalidate(), utils.admin.premium.transactions.invalidate(), utils.admin.dashboard.invalidate()]);
  const grant = trpc.admin.users.grantPremium.useMutation({ onSuccess: async () => { await refresh(); close(); } });
  const revoke = trpc.admin.users.revokePremium.useMutation({ onSuccess: async () => { await refresh(); close(); } });
  function close() {
    setDuration("30");
    setCustomDays("");
    setReason("");
    setConfirmRevoke(false);
    grant.reset();
    revoke.reset();
    onClose();
  }

  const durationDays = duration === "custom" ? Number.parseInt(customDays, 10) : Number(duration);
  const validDuration = Number.isInteger(durationDays) && durationDays >= 1 && durationDays <= 366;
  const active = isActiveSubscription(target?.subscriptionEnd);
  const pending = grant.isPending || revoke.isPending;
  const error = grant.error?.message ?? revoke.error?.message;

  return (
    <Dialog
      visible={!!target}
      title="Offrir le Premium"
      description={target ? displayIdentity(target) : undefined}
      onClose={close}
      width={560}
      footer={
        confirmRevoke ? (
          <>
            <Text style={[styles.footerText, { color: theme.textSecondary }]}>Retirer le Premium immédiatement, sans remboursement ?</Text>
            <Button label="Non" onPress={() => setConfirmRevoke(false)} disabled={pending} />
            <Button label="Retirer" variant="danger" loading={revoke.isPending} onPress={() => target && revoke.mutate({ userId: target.id, reason: reason.trim() || undefined })} />
          </>
        ) : (
          <>
            {active ? <Button label="Retirer le Premium" variant="ghost" icon="block" onPress={() => setConfirmRevoke(true)} disabled={pending} style={styles.revoke} /> : null}
            <Button label="Annuler" onPress={close} disabled={pending} />
            <Button label="Offrir" variant="primary" icon="card-giftcard" loading={grant.isPending} disabled={!validDuration} onPress={() => target && grant.mutate({ userId: target.id, durationDays, reason: reason.trim() || undefined })} />
          </>
        )
      }
    >
      {target ? (
        <>
          <Alert tone={active ? "success" : "info"}>{active ? `Premium actif jusqu’au ${formatDate(target.subscriptionEnd)} : la durée offerte s’ajoute à l’abonnement en cours.` : "Aucun Premium actif : l’offre commence maintenant."}</Alert>
          <View style={styles.field}>
            <FieldLabel>Durée offerte</FieldLabel>
            <View style={styles.chips}>
              {GIFT_DURATIONS.map((option) => <Chip key={option.value} label={option.label} selected={duration === option.value} onPress={() => setDuration(option.value)} />)}
            </View>
          </View>
          {duration === "custom" ? <Field label="Nombre de jours" value={customDays} onChangeText={(value) => setCustomDays(value.replace(/\D/g, ""))} keyboardType="numeric" hint="Entre 1 et 366 jours." /> : null}
          <Field label="Motif (facultatif)" value={reason} onChangeText={setReason} placeholder="Ex. partenaire, geste commercial" hint="Enregistré dans le journal d’audit." />
          {validDuration ? <Hint>Premium jusqu’au <Text style={[styles.strong, { color: theme.text }]}>{formatDate(giftEndPreview(target.subscriptionEnd, durationDays))}</Text>. L’offre apparaît dans Premium (0 F CFA, formule « Offert »).</Hint> : <Hint tone="danger">Indiquez une durée entre 1 et 366 jours.</Hint>}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </>
      ) : null}
    </Dialog>
  );
}

type ConfirmAction = { kind: "suspend" | "reactivate" | "revoke" | "promote" | "demote" | "delete" };

const CONFIRM_TEXT: Record<ConfirmAction["kind"], { title: string; message: string; label: string; tone: "danger" | "brand" }> = {
  suspend: { title: "Suspendre le compte", message: "L’utilisateur est déconnecté de tous ses appareils et ne peut plus se connecter jusqu’à la réactivation. Son abonnement n’est pas modifié.", label: "Suspendre", tone: "danger" },
  reactivate: { title: "Réactiver le compte", message: "L’utilisateur pourra de nouveau se connecter.", label: "Réactiver", tone: "brand" },
  revoke: { title: "Déconnecter tous les appareils", message: "Toutes les sessions ouvertes de ce compte sont fermées ; l’utilisateur devra se reconnecter.", label: "Déconnecter", tone: "danger" },
  promote: { title: "Donner le rôle administrateur", message: "Ce compte aura accès à toute la console d’administration. Ses sessions sont fermées pour appliquer le nouveau rôle.", label: "Promouvoir", tone: "brand" },
  demote: { title: "Retirer le rôle administrateur", message: "Ce compte n’aura plus accès à la console. Ses sessions sont fermées.", label: "Retirer le rôle", tone: "danger" },
  delete: { title: "Supprimer le compte", message: "Téléphone, e-mail et mot de passe sont effacés définitivement ; l’abonnement prend fin. Les paiements sont conservés sans lien avec l’identité. Action irréversible.", label: "Supprimer définitivement", tone: "danger" },
};

function Fact({ label, value }: { label: string; value: string }) {
  const theme = useAdminTheme();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.factValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

/** Fiche détaillée d'un utilisateur : compte, abonnement, paiements, historique et actions. */
function UserDetailDialog({ userId, onClose, onGift }: { userId: number | null; onClose: () => void; onGift: (target: GiftTarget) => void }) {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const utils = trpc.useUtils();
  const detail = trpc.admin.users.get.useQuery({ userId: userId ?? 0 }, { enabled: !!userId, retry: 1 });
  const access = trpc.admin.access.useQuery(undefined, { retry: false });
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [reason, setReason] = useState("");
  const refresh = async () => {
    setConfirm(null);
    setReason("");
    await Promise.all([utils.admin.users.get.invalidate(), utils.admin.users.list.invalidate(), utils.admin.dashboard.invalidate()]);
  };
  const suspend = trpc.admin.users.setSuspended.useMutation({ onSuccess: refresh });
  const revoke = trpc.admin.users.revokeSessions.useMutation({ onSuccess: refresh });
  const setRole = trpc.admin.users.setRole.useMutation({ onSuccess: refresh });
  const remove = trpc.admin.users.remove.useMutation({ onSuccess: refresh });
  const pending = suspend.isPending || revoke.isPending || setRole.isPending || remove.isPending;
  const error = suspend.error?.message ?? revoke.error?.message ?? setRole.error?.message ?? remove.error?.message;
  const user = detail.data;
  const self = !!user && access.data?.id === user.id;

  const run = () => {
    if (!user || !confirm) return;
    const note = reason.trim() || undefined;
    if (confirm.kind === "suspend" || confirm.kind === "reactivate") suspend.mutate({ userId: user.id, suspended: confirm.kind === "suspend", reason: note });
    if (confirm.kind === "revoke") revoke.mutate({ userId: user.id });
    if (confirm.kind === "promote" || confirm.kind === "demote") setRole.mutate({ userId: user.id, role: confirm.kind === "promote" ? "admin" : "user" });
    if (confirm.kind === "delete") remove.mutate({ userId: user.id, confirm: true, reason: note });
  };
  const confirmText = confirm ? CONFIRM_TEXT[confirm.kind] : null;

  return (
    <Dialog visible={!!userId} title="Fiche utilisateur" description={user ? displayIdentity(user) : undefined} onClose={onClose} width={860} footer={<Button label="Fermer" onPress={onClose} />}>
      <DataState loading={detail.isLoading} error={detail.error} onRetry={() => detail.refetch()}>
        {user ? (
          <>
            <View style={styles.detailHead}>
              <Avatar label={displayIdentity(user)} size={52} tone="neutral" />
              <View style={styles.flex}>
                <Text style={[styles.detailName, { color: theme.text }]}>{displayIdentity(user)}</Text>
                <View style={styles.badges}>
                  <Badge label={user.role === "admin" ? "Administrateur" : "Utilisateur"} tone={user.role === "admin" ? "brand" : "neutral"} />
                  {user.deleted ? <Badge label="Compte supprimé" tone="danger" /> : user.suspendedAt ? <Badge label={`Suspendu le ${formatDay(user.suspendedAt)}`} tone="danger" icon="block" /> : <Badge label="Actif" tone="success" dot />}
                  {isActiveSubscription(user.subscriptionEnd) ? <Badge label={`Premium jusqu’au ${formatDay(user.subscriptionEnd)}`} tone="info" icon="workspace-premium" /> : null}
                </View>
              </View>
            </View>
            <View style={[styles.facts, desktop && styles.factsDesktop]}>
              <Fact label="Téléphone" value={user.phone ?? "—"} />
              <Fact label="Vérification" value={user.phoneVerifiedAt ? `Vérifié le ${formatDate(user.phoneVerifiedAt)}` : "Non vérifié"} />
              <Fact label="E-mail" value={user.email ?? "—"} />
              <Fact label="Inscription" value={formatDate(user.createdAt)} />
              <Fact label="Dernière connexion" value={formatDate(user.lastSignedIn)} />
              <Fact label="Contributions envoyées" value={String(user.contributions)} />
            </View>

            {!user.deleted ? (
              <Card title="Actions" padded>
                <View style={styles.actions}>
                  <Button label={isActiveSubscription(user.subscriptionEnd) ? "Gérer le Premium" : "Offrir le Premium"} icon="card-giftcard" onPress={() => onGift(user)} />
                  <Button label="Déconnecter les appareils" icon="phonelink-erase" disabled={pending} onPress={() => setConfirm({ kind: "revoke" })} />
                  {!self ? <Button label={user.role === "admin" ? "Retirer le rôle admin" : "Promouvoir administrateur"} icon="admin-panel-settings" disabled={pending} onPress={() => setConfirm({ kind: user.role === "admin" ? "demote" : "promote" })} /> : null}
                  {!self ? <Button label={user.suspendedAt ? "Réactiver le compte" : "Suspendre le compte"} icon={user.suspendedAt ? "lock-open" : "block"} disabled={pending} onPress={() => setConfirm({ kind: user.suspendedAt ? "reactivate" : "suspend" })} /> : null}
                  {!self ? <Button label="Supprimer le compte" variant="ghost" icon="delete-outline" disabled={pending} onPress={() => setConfirm({ kind: "delete" })} /> : null}
                </View>
                {self ? <Hint>Les actions sur votre propre compte se font dans « Mon compte ».</Hint> : null}
                {confirm && (confirm.kind === "suspend" || confirm.kind === "delete") ? <Field label="Motif (facultatif, enregistré dans le journal)" value={reason} onChangeText={setReason} /> : null}
                {error ? <Alert tone="danger">{error}</Alert> : null}
              </Card>
            ) : null}

            <Card title="Paiements et offres" padded={false}>
              <DataState empty={!user.payments.length} emptyTitle="Aucun paiement">
                <DataTable
                  columns={[
                    { key: "date", label: "Date", flex: 1.3 },
                    { key: "plan", label: "Formule", flex: 1 },
                    { key: "amount", label: "Montant", flex: 1, align: "right" },
                    { key: "status", label: "Statut", width: 120 },
                  ]}
                  rows={user.payments}
                  rowKey={(payment) => String(payment.id)}
                  minWidth={560}
                  renderCell={(payment, key) => {
                    if (key === "date") return <CellText muted>{formatDate(payment.createdAt)}</CellText>;
                    if (key === "plan") return <CellText>{PLAN_LABELS[payment.planId] ?? payment.planId}</CellText>;
                    if (key === "amount") return <CellText strong mono>{formatXof(payment.amount)}</CellText>;
                    const status = TRANSACTION_STATUS[payment.status] ?? { label: payment.status, tone: "neutral" as const };
                    return <Badge {...status} dot />;
                  }}
                />
              </DataState>
            </Card>

            <Card title="Historique des actions de la console" padded={false}>
              <DataState empty={!user.history.length} emptyTitle="Aucune action sur ce compte">
                {user.history.map((event, index) => (
                  <View key={event.id} style={[styles.historyRow, index < user.history.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                    <Text style={[styles.historyTitle, { color: theme.text }]}>{auditActionLabel(event.action)}</Text>
                    <Text style={[styles.historyMeta, { color: theme.textMuted }]}>{displayIdentity({ name: event.actorName, phone: event.actorPhone })} · {formatDate(event.createdAt)}{typeof event.metadata?.reason === "string" ? ` · ${event.metadata.reason}` : ""}</Text>
                  </View>
                ))}
              </DataState>
            </Card>
          </>
        ) : null}
      </DataState>
      {confirmText ? <ConfirmDialog visible title={confirmText.title} message={confirmText.message} confirmLabel={confirmText.label} tone={confirmText.tone} loading={pending} onClose={() => setConfirm(null)} onConfirm={run} /> : null}
    </Dialog>
  );
}

export function UsersPage() {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const [search, setSearch] = useState("");
  const [premium, setPremium] = useState<"all" | "active" | "inactive">("all");
  const [verified, setVerified] = useState<"all" | "verified" | "unverified">("all");
  const [role, setRole] = useState<"all" | "admin" | "user">("all");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [page, setPage] = usePage([debouncedSearch, premium, verified, role].join("|"));
  const users = trpc.admin.users.list.useQuery({ search: debouncedSearch || undefined, premium, verified, role, page, limit: PAGE_SIZE }, { retry: 1, placeholderData: (previous) => previous });
  const rows = users.data?.items ?? [];
  const [giftTarget, setGiftTarget] = useState<GiftTarget | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const giftButton = (user: GiftTarget) => <Button size="sm" icon="card-giftcard" label={isActiveSubscription(user.subscriptionEnd) ? "Gérer Premium" : "Offrir Premium"} accessibilityLabel={`Offrir le Premium à ${displayIdentity(user)}`} onPress={() => setGiftTarget(user)} />;
  const premiumBadge = (user: GiftTarget) => (isActiveSubscription(user.subscriptionEnd) ? <Badge label={formatDay(user.subscriptionEnd)} tone="info" icon="workspace-premium" /> : <CellText muted>Non actif</CellText>);

  return (
    <AdminPage section="users">
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Rechercher par nom, téléphone ou e-mail" style={desktop ? styles.search : undefined} />
          <Select label="Premium" style={desktop ? styles.filter : undefined} value={premium} onChange={(value) => setPremium(value as typeof premium)} options={[{ value: "all", label: "Tous les comptes" }, { value: "active", label: "Premium actif" }, { value: "inactive", label: "Sans Premium" }]} />
          <Select label="Téléphone" style={desktop ? styles.filter : undefined} value={verified} onChange={(value) => setVerified(value as typeof verified)} options={[{ value: "all", label: "Vérifiés ou non" }, { value: "verified", label: "Téléphone vérifié" }, { value: "unverified", label: "À vérifier" }]} />
          <Select label="Rôle" style={desktop ? styles.filter : undefined} value={role} onChange={(value) => setRole(value as typeof role)} options={[{ value: "all", label: "Tous les rôles" }, { value: "admin", label: "Administrateurs" }, { value: "user", label: "Utilisateurs" }]} />
        </Toolbar>
        <DataState loading={users.isLoading} error={users.error} onRetry={() => users.refetch()} empty={!rows.length} emptyTitle="Aucun utilisateur" emptyMessage="Aucun compte ne correspond à ces filtres.">
          {desktop ? (
            <DataTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(user) => String(user.id)}
              minWidth={980}
              onRowPress={(user) => setDetailId(user.id)}
              renderCell={(user, key) => {
                switch (key) {
                  case "user":
                    return <CellStack leading={<Avatar label={displayIdentity(user)} size={32} tone="neutral" />} title={displayIdentity(user)} subtitle={user.name ? user.phone ?? user.email : user.email ?? `Compte #${user.id}`} />;
                  case "verification":
                    if (user.suspendedAt) return <Badge label="Suspendu" tone="danger" icon="block" />;
                    return user.phoneVerifiedAt ? <Badge label="Vérifié" tone="success" dot /> : <Badge label="À vérifier" tone="warning" dot />;
                  case "role":
                    return <Badge label={user.role === "admin" ? "Administrateur" : "Utilisateur"} tone={user.role === "admin" ? "brand" : "neutral"} />;
                  case "premium":
                    return premiumBadge(user);
                  case "created":
                    return <CellText muted>{formatDay(user.createdAt)}</CellText>;
                  case "lastSignedIn":
                    return <CellText muted>{formatDate(user.lastSignedIn)}</CellText>;
                  case "actions":
                    return giftButton(user);
                  default:
                    return null;
                }
              }}
            />
          ) : (
            rows.map((user, index) => (
              <View key={user.id} style={[styles.mobileRow, index < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                <View style={styles.mobileTop}>
                  <Avatar label={displayIdentity(user)} size={36} tone="neutral" />
                  <View style={styles.flex}>
                    <Text numberOfLines={1} style={[styles.mobileTitle, { color: theme.text }]}>{displayIdentity(user)}</Text>
                    <Text numberOfLines={1} style={[styles.mobileMeta, { color: theme.textMuted }]}>{user.phone ?? user.email ?? "Coordonnée absente"} · {user.role === "admin" ? "Administrateur" : "Utilisateur"}</Text>
                  </View>
                </View>
                <Text style={[styles.mobileMeta, { color: theme.textMuted }]}>Vérification : {user.phoneVerifiedAt ? formatDate(user.phoneVerifiedAt) : "non vérifié"} · Premium : {isActiveSubscription(user.subscriptionEnd) ? `jusqu’au ${formatDay(user.subscriptionEnd)}` : "non actif"}</Text>
                <View style={styles.mobileActions}>
                  <Button size="sm" label="Fiche" icon="person" onPress={() => setDetailId(user.id)} />
                  {giftButton(user)}
                </View>
              </View>
            ))
          )}
          <View style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
            <Pagination page={page} limit={PAGE_SIZE} total={users.data?.total ?? 0} onChange={setPage} />
          </View>
        </DataState>
      </Card>
      <UserDetailDialog userId={detailId} onClose={() => setDetailId(null)} onGift={(target) => { setDetailId(null); setGiftTarget(target); }} />
      <PremiumGiftDialog target={giftTarget} onClose={() => setGiftTarget(null)} />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  detailHead: { flexDirection: "row", alignItems: "center", gap: 16 },
  detailName: { fontSize: 18, fontWeight: "700" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  facts: { gap: 14 },
  factsDesktop: { flexDirection: "row", flexWrap: "wrap", rowGap: 14, columnGap: 24 },
  fact: { gap: 2, minWidth: 220 },
  factLabel: { fontSize: font.xs },
  factValue: { fontSize: font.md, fontWeight: "500" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  historyRow: { paddingHorizontal: 20, paddingVertical: 12, gap: 2 },
  historyTitle: { fontSize: font.sm, fontWeight: "600" },
  historyMeta: { fontSize: font.xs },
  mobileActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  field: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  strong: { fontWeight: "600" },
  footerText: { flex: 1, fontSize: font.sm, alignSelf: "center" },
  revoke: { marginRight: "auto" },
  search: { flexGrow: 1, flexBasis: 300, minWidth: 260 },
  filter: { minWidth: 180 },
  mobileRow: { padding: 16, gap: 10 },
  mobileTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  mobileTitle: { fontSize: font.md, fontWeight: "600" },
  mobileMeta: { fontSize: font.xs, lineHeight: 18 },
});
