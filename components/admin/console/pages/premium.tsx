import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";

import { AdminPage } from "../shell";
import { PAGE_SIZE, PLAN_LABELS, TRANSACTION_STATUS, displayIdentity, formatCount, formatDate, formatDay, formatXof, usePage } from "../shared";
import { font, useAdminLayout, useAdminTheme } from "../theme";
import { Badge, Card, CellStack, CellText, DataState, DataTable, Grid, KpiCard, Pagination, Segmented, Toolbar, type Column } from "../ui";

type StatusFilter = "all" | "success" | "pending" | "failed" | "cancelled";

const COLUMNS: readonly Column[] = [
  { key: "user", label: "Utilisateur", flex: 2 },
  { key: "plan", label: "Formule", flex: 1.1 },
  { key: "amount", label: "Montant", flex: 1, align: "right" },
  { key: "status", label: "Statut", width: 130 },
  { key: "date", label: "Date", flex: 1.3 },
  { key: "subscriptionEnd", label: "Fin d’abonnement", flex: 1.1 },
  { key: "reference", label: "Référence", flex: 1.6 },
];

export function PremiumPage() {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = usePage(status);
  const summary = trpc.admin.dashboard.useQuery(undefined, { retry: 1 });
  const transactions = trpc.admin.premium.transactions.useQuery({ status, page, limit: PAGE_SIZE }, { retry: 1, placeholderData: (previous) => previous });
  const rows = transactions.data?.items ?? [];
  const statusOf = (value: string) => TRANSACTION_STATUS[value] ?? { label: value, tone: "neutral" as const };
  const planBadge = (planId: string) => (planId === "offered" ? <Badge label="Offert" tone="info" icon="card-giftcard" /> : <CellText>{PLAN_LABELS[planId] ?? planId}</CellText>);

  return (
    <AdminPage section="premium">
      {summary.data ? (
        <Grid columns={4}>
          <KpiCard label="Abonnés actifs" value={formatCount(summary.data.premiumUsers)} icon="workspace-premium" tone="info" />
          <KpiCard label="Revenus du mois" value={formatXof(summary.data.revenueThisMonth)} icon="payments" tone="success" />
          <KpiCard label="Total encaissé" value={formatXof(summary.data.revenueTotal)} icon="account-balance-wallet" tone="brand" />
          <KpiCard label="Paiements en attente" value={formatCount(summary.data.pendingTransactions)} icon="pending-actions" tone="warning" />
        </Grid>
      ) : null}
      <Card padded={false}>
        <Toolbar>
          <Segmented
            value={status}
            onChange={(value) => setStatus(value as StatusFilter)}
            options={[
              { value: "all", label: "Toutes" },
              { value: "success", label: "Payées" },
              { value: "pending", label: "En attente" },
              { value: "failed", label: "Échouées" },
              { value: "cancelled", label: "Annulées" },
            ]}
          />
        </Toolbar>
        <DataState loading={transactions.isLoading} error={transactions.error} onRetry={() => transactions.refetch()} empty={!rows.length} emptyTitle="Aucune transaction">
          {desktop ? (
            <DataTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(transaction) => String(transaction.id)}
              minWidth={1000}
              renderCell={(transaction, key) => {
                switch (key) {
                  case "user":
                    return <CellStack title={displayIdentity({ name: transaction.userName, phone: transaction.userPhone, email: transaction.userEmail, id: transaction.userId })} subtitle={transaction.userName ? transaction.userPhone ?? transaction.userEmail : null} />;
                  case "plan":
                    return planBadge(transaction.planId);
                  case "amount":
                    return <CellText strong mono>{formatXof(transaction.amount)}</CellText>;
                  case "status":
                    return <Badge {...statusOf(transaction.status)} dot />;
                  case "date":
                    return <CellText muted>{formatDate(transaction.createdAt)}</CellText>;
                  case "subscriptionEnd":
                    return <CellText muted>{formatDay(transaction.subscriptionEnd)}</CellText>;
                  case "reference":
                    return <CellText muted small mono>{transaction.merchantReference}</CellText>;
                  default:
                    return null;
                }
              }}
            />
          ) : (
            rows.map((transaction, index) => (
              <View key={transaction.id} style={[styles.mobileRow, index < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={[styles.mobileTitle, { color: theme.text }]}>{displayIdentity({ name: transaction.userName, phone: transaction.userPhone, email: transaction.userEmail, id: transaction.userId })}</Text>
                  <Text numberOfLines={1} style={[styles.mobileMeta, { color: theme.textMuted }]}>{PLAN_LABELS[transaction.planId] ?? transaction.planId} · {formatDate(transaction.createdAt)}</Text>
                </View>
                <View style={styles.mobileRight}>
                  <Text style={[styles.mobileTitle, { color: theme.text }]}>{formatXof(transaction.amount)}</Text>
                  <Badge {...statusOf(transaction.status)} dot />
                </View>
              </View>
            ))
          )}
          <View style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
            <Pagination page={page} limit={PAGE_SIZE} total={transactions.data?.total ?? 0} onChange={setPage} />
          </View>
        </DataState>
      </Card>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  mobileRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  mobileRight: { alignItems: "flex-end", gap: 4 },
  mobileTitle: { fontSize: font.md, fontWeight: "600" },
  mobileMeta: { fontSize: font.xs, marginTop: 2 },
});
