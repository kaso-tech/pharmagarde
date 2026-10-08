import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";

import { AdminPage } from "../shell";
import { AUDIT_TARGETS, PAGE_SIZE, auditActionLabel, auditIcon, auditTone, displayIdentity, formatDate, formatRelative, usePage } from "../shared";
import { font, radius, toneColors, useAdminLayout, useAdminTheme } from "../theme";
import { Card, CellStack, CellText, DataState, DataTable, Pagination, Segmented, Toolbar, type Column } from "../ui";

const COLUMNS: readonly Column[] = [
  { key: "action", label: "Action", flex: 2 },
  { key: "target", label: "Cible", flex: 2 },
  { key: "actor", label: "Auteur", flex: 1.5 },
  { key: "date", label: "Date", flex: 1.3 },
];

export function AuditPage() {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const [showViews, setShowViews] = useState(false);
  const [page, setPage] = usePage(String(showViews));
  // Les consultations de pages restent journalisées, mais masquées par défaut pour laisser voir les vraies actions.
  const events = trpc.admin.audit.list.useQuery({ includeViews: showViews, page, limit: PAGE_SIZE }, { retry: 1, placeholderData: (previous) => previous });
  const rows = events.data?.items ?? [];
  const targetLabel = (event: { targetType: string; targetId: string | null }) => `${AUDIT_TARGETS[event.targetType] ?? event.targetType}${event.targetId ? ` · ${event.targetId}` : ""}`;
  const icon = (action: string) => {
    const { fg, bg } = toneColors(theme, auditTone(action));
    return <View style={[styles.icon, { backgroundColor: bg }]}><MaterialIcons name={auditIcon(action)} size={16} color={fg} /></View>;
  };

  return (
    <AdminPage section="audit">
      <Card padded={false}>
        <Toolbar>
          <Segmented value={showViews ? "all" : "actions"} onChange={(value) => setShowViews(value === "all")} options={[{ value: "actions", label: "Modifications" }, { value: "all", label: "Tout, consultations comprises" }]} />
        </Toolbar>
        <DataState loading={events.isLoading} error={events.error} onRetry={() => events.refetch()} empty={!rows.length} emptyTitle="Aucune action enregistrée">
          {desktop ? (
            <DataTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(event) => String(event.id)}
              renderCell={(event, key) => {
                switch (key) {
                  case "action":
                    return <CellStack leading={icon(event.action)} title={auditActionLabel(event.action)} />;
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
                  <Text style={[styles.mobileTitle, { color: theme.text }]}>{auditActionLabel(event.action)}</Text>
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
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  icon: { width: 32, height: 32, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  mobileRow: { flexDirection: "row", gap: 12, padding: 16 },
  mobileTitle: { fontSize: font.md, fontWeight: "600" },
  mobileMeta: { fontSize: font.xs, marginTop: 2 },
});
