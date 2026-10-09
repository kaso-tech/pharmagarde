import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

import { ExportButton } from "../export-button";
import { datedFileName, downloadFile, toCsv } from "../files";
import { AdminPage } from "../shell";
import { AUDIT_TARGETS, PAGE_SIZE, auditActionLabel, auditIcon, auditTone, displayIdentity, formatDate, formatRelative, useDebouncedValue, usePage } from "../shared";
import { font, radius, toneColors, useAdminLayout, useAdminTheme } from "../theme";
import { Button, Card, CellStack, CellText, DataState, DataTable, Dialog, Pagination, SearchInput, Segmented, Select, Toolbar, type Column } from "../ui";

type AuditEvent = inferRouterOutputs<AppRouter>["admin"]["audit"]["list"]["items"][number];
type Change = { before: unknown; after: unknown };

const COLUMNS: readonly Column[] = [
  { key: "action", label: "Action", flex: 2 },
  { key: "target", label: "Cible", flex: 2 },
  { key: "actor", label: "Auteur", flex: 1.5 },
  { key: "date", label: "Date", flex: 1.3 },
];

const CATEGORIES = [
  { value: "", label: "Toutes les actions" },
  { value: "directory", label: "Établissements" },
  { value: "contribution", label: "Contributions" },
  { value: "duty", label: "Gardes" },
  { value: "city_hours", label: "Horaires" },
  { value: "medicines", label: "Médicaments" },
  { value: "insurers", label: "Assurances" },
  { value: "cities", label: "Villes" },
  { value: "announcements", label: "Annonces" },
  { value: "users", label: "Utilisateurs" },
  { value: "premium", label: "Paiements" },
  { value: "plans", label: "Formules" },
  { value: "account", label: "Mon compte et connexions" },
  { value: "data", label: "Données" },
];

const PERIODS = [
  { value: "7", label: "7 derniers jours" },
  { value: "30", label: "30 derniers jours" },
  { value: "90", label: "90 derniers jours" },
  { value: "all", label: "Depuis le début" },
];

function periodStart(value: string, now = new Date()) {
  if (value === "all") return undefined;
  return new Date(now.getTime() - (Number(value) - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function showValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDate(value);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function changesOf(event: AuditEvent) {
  const raw = event.metadata?.changes;
  return raw && typeof raw === "object" ? Object.entries(raw as Record<string, Change>) : [];
}

function AuditDetail({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  const theme = useAdminTheme();
  if (!event) return null;
  const changes = changesOf(event);
  const details = Object.entries(event.metadata ?? {}).filter(([key]) => key !== "changes");
  return (
    <Dialog visible title={auditActionLabel(event.action)} description={`${displayIdentity({ name: event.actorName, phone: event.actorPhone, email: event.actorEmail, id: event.actorUserId })} · ${formatDate(event.createdAt)}`} onClose={onClose} width={760} footer={<Button label="Fermer" onPress={onClose} />}>
      <View style={styles.facts}>
        <Text style={[styles.fact, { color: theme.textSecondary }]}>
          Cible : {AUDIT_TARGETS[event.targetType] ?? event.targetType}
          {event.targetId ? ` · ${event.targetId}` : ""}
        </Text>
        <Text style={[styles.fact, { color: theme.textMuted }]}>Code : {event.action}</Text>
        {details.map(([key, value]) => (
          <Text key={key} style={[styles.fact, { color: theme.textSecondary }]}>
            {key} : {showValue(value)}
          </Text>
        ))}
      </View>
      {changes.length ? (
        <Card title="Modifications" description="Valeurs avant et après l’action." padded={false}>
          <DataTable
            columns={[
              { key: "field", label: "Champ", flex: 1 },
              { key: "before", label: "Avant", flex: 2 },
              { key: "after", label: "Après", flex: 2 },
            ]}
            rows={changes}
            rowKey={([field]) => field}
            minWidth={560}
            renderCell={([field, change], key) => {
              if (key === "field") return <CellText strong>{field}</CellText>;
              if (key === "before") return <Text style={[styles.value, { color: theme.danger }]}>{showValue(change.before)}</Text>;
              return <Text style={[styles.value, { color: theme.success }]}>{showValue(change.after)}</Text>;
            }}
          />
        </Card>
      ) : (
        <Text style={[styles.fact, { color: theme.textMuted }]}>Pas de détail avant/après pour cette action.</Text>
      )}
    </Dialog>
  );
}

export function AuditPage() {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const [showViews, setShowViews] = useState(false);
  const [category, setCategory] = useState("");
  const [actor, setActor] = useState("");
  const [period, setPeriod] = useState("30");
  const [target, setTarget] = useState("");
  const debouncedTarget = useDebouncedValue(target.trim());
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const utils = trpc.useUtils();
  const filters = { includeViews: showViews, category: category || undefined, actorUserId: actor ? Number(actor) : undefined, from: periodStart(period), target: debouncedTarget || undefined };
  const [page, setPage] = usePage(JSON.stringify(filters));
  // Les consultations de pages restent journalisées, mais masquées par défaut pour laisser voir les vraies actions.
  const events = trpc.admin.audit.list.useQuery({ ...filters, page, limit: PAGE_SIZE }, { retry: 1, placeholderData: (previous) => previous });
  const actors = trpc.admin.audit.actors.useQuery(undefined, { retry: 1, staleTime: 5 * 60_000 });
  const rows = events.data?.items ?? [];
  const targetLabel = (event: { targetType: string; targetId: string | null }) => `${AUDIT_TARGETS[event.targetType] ?? event.targetType}${event.targetId ? ` · ${event.targetId}` : ""}`;
  const icon = (action: string) => {
    const { fg, bg } = toneColors(theme, auditTone(action));
    return <View style={[styles.icon, { backgroundColor: bg }]}><MaterialIcons name={auditIcon(action)} size={16} color={fg} /></View>;
  };
  const changeCount = (event: AuditEvent) => changesOf(event).length;

  return (
    <AdminPage
      section="audit"
      actions={
        <ExportButton
          run={async () => {
            const rows = await utils.admin.audit.export.fetch(filters);
            downloadFile(
              datedFileName("journal"),
              toCsv(rows, [
                { label: "Date", value: (row) => row.createdAt },
                { label: "Action", value: (row) => auditActionLabel(row.action) },
                { label: "Code", value: (row) => row.action },
                { label: "Cible", value: (row) => `${AUDIT_TARGETS[row.targetType] ?? row.targetType}${row.targetId ? ` ${row.targetId}` : ""}` },
                { label: "Auteur", value: (row) => row.actorName ?? row.actorPhone },
                { label: "Détails", value: (row) => row.metadata },
              ]),
            );
          }}
        />
      }
    >
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={target} onChangeText={setTarget} placeholder="Cible : fiche, ville, n° d’utilisateur…" style={desktop ? styles.search : undefined} />
          <Select label="Actions" style={desktop ? styles.filter : undefined} value={category} options={CATEGORIES} onChange={setCategory} />
          <Select label="Auteur" style={desktop ? styles.filter : undefined} value={actor} options={[{ value: "", label: "Tous les auteurs" }, ...(actors.data ?? []).map((item) => ({ value: String(item.id), label: displayIdentity(item) }))]} onChange={setActor} />
          <Select label="Période" style={desktop ? styles.filter : undefined} value={period} options={PERIODS} onChange={setPeriod} />
          <Segmented value={showViews ? "all" : "actions"} onChange={(value) => setShowViews(value === "all")} options={[{ value: "actions", label: "Modifications" }, { value: "all", label: "Avec consultations" }]} />
        </Toolbar>
        <DataState loading={events.isLoading} error={events.error} onRetry={() => events.refetch()} empty={!rows.length} emptyTitle="Aucune action enregistrée" emptyMessage="Aucune action ne correspond à ces filtres.">
          {desktop ? (
            <DataTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(event) => String(event.id)}
              onRowPress={setSelected}
              renderCell={(event, key) => {
                switch (key) {
                  case "action":
                    return <CellStack leading={icon(event.action)} title={auditActionLabel(event.action)} subtitle={changeCount(event) ? `${changeCount(event)} champ${changeCount(event) > 1 ? "s" : ""} modifié${changeCount(event) > 1 ? "s" : ""}` : null} />;
                  case "target":
                    return <CellText muted>{targetLabel(event)}</CellText>;
                  case "actor":
                    return <CellText>{displayIdentity({ name: event.actorName, phone: event.actorPhone, email: event.actorEmail, id: event.actorUserId })}</CellText>;
                  case "date":
                    return <CellStack title={formatRelative(event.createdAt)} subtitle={formatDate(event.createdAt)} />;
                  default:
                    return null;
                }
              }}
            />
          ) : (
            rows.map((event, index) => (
              <View key={event.id} style={[styles.mobileRow, index < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                {icon(event.action)}
                <View style={styles.flex}>
                  <Text style={[styles.mobileTitle, { color: theme.text }]} onPress={() => setSelected(event)}>{auditActionLabel(event.action)}</Text>
                  <Text style={[styles.mobileMeta, { color: theme.textMuted }]}>{displayIdentity({ name: event.actorName, phone: event.actorPhone, email: event.actorEmail, id: event.actorUserId })} · {formatDate(event.createdAt)}</Text>
                  <Text numberOfLines={1} style={[styles.mobileMeta, { color: theme.textMuted }]}>{targetLabel(event)}</Text>
                </View>
              </View>
            ))
          )}
          <View style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
            <Pagination page={page} limit={PAGE_SIZE} total={events.data?.total ?? 0} onChange={setPage} />
          </View>
        </DataState>
      </Card>
      <AuditDetail event={selected} onClose={() => setSelected(null)} />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  icon: { width: 32, height: 32, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  mobileRow: { flexDirection: "row", gap: 12, padding: 16 },
  mobileTitle: { fontSize: font.md, fontWeight: "600" },
  mobileMeta: { fontSize: font.xs, marginTop: 2 },
  search: { flexGrow: 1, flexBasis: 240, minWidth: 220 },
  filter: { minWidth: 170 },
  facts: { gap: 4 },
  fact: { fontSize: font.sm, lineHeight: 20 },
  value: { fontSize: font.sm, lineHeight: 19 },
});
