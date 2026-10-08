import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";

import { ExportButton } from "../export-button";
import { datedFileName, downloadFile, toCsv } from "../files";
import { AdminPage } from "../shell";
import { PAGE_SIZE, PLAN_LABELS, TRANSACTION_STATUS, displayIdentity, formatCount, formatDate, formatDay, formatXof, usePage } from "../shared";
import { font, useAdminLayout, useAdminTheme } from "../theme";
import { Alert, Badge, Button, Card, CellStack, CellText, DataState, DataTable, Dialog, Field, Grid, Hint, KpiCard, Pagination, Segmented, Toolbar, type Column } from "../ui";

type StatusFilter = "all" | "success" | "pending" | "failed" | "cancelled";

const COLUMNS: readonly Column[] = [
  { key: "user", label: "Utilisateur", flex: 2 },
  { key: "plan", label: "Formule", flex: 1.1 },
  { key: "amount", label: "Montant", flex: 1, align: "right" },
  { key: "status", label: "Statut", width: 130 },
  { key: "date", label: "Date", flex: 1.3 },
  { key: "subscriptionEnd", label: "Fin d’abonnement", flex: 1.1 },
  { key: "reference", label: "Référence", flex: 1.6 },
  { key: "actions", label: "", width: 104, align: "right" },
];

type SettleTarget = { id: number; amount: number; planId: string; status: string; provider: string; user: string; reference: string };

/** Règle une transaction non payée : nouvelle vérification auprès de Ligdi Cash ou décision manuelle motivée. */
function SettleDialog({ target, onClose }: { target: SettleTarget | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const refresh = () => Promise.all([utils.admin.premium.transactions.invalidate(), utils.admin.dashboard.invalidate(), utils.admin.users.list.invalidate()]);
  const close = () => {
    setNote("");
    setResult(null);
    recheck.reset();
    resolve.reset();
    onClose();
  };
  const recheck = trpc.admin.premium.recheck.useMutation({
    onSuccess: async (data) => {
      await refresh();
      setResult(data.status === "success" ? "Paiement confirmé par Ligdi Cash : l’abonnement a été prolongé." : data.status === "failed" ? "Ligdi Cash indique un paiement échoué." : "Ligdi Cash n’a toujours pas confirmé ce paiement.");
    },
  });
  const resolve = trpc.admin.premium.resolve.useMutation({ onSuccess: async () => { await refresh(); close(); } });
  const pending = recheck.isPending || resolve.isPending;
  const error = recheck.error?.message ?? resolve.error?.message;
  const noteOk = note.trim().length >= 3;
  return (
    <Dialog
      visible={!!target}
      title="Régler le paiement"
      description={target ? `${target.user} · ${formatXof(target.amount)} · ${PLAN_LABELS[target.planId] ?? target.planId}` : undefined}
      onClose={close}
      width={600}
      footer={
        <>
          <Button label="Marquer échoué" variant="ghost" disabled={!noteOk || pending} onPress={() => target && resolve.mutate({ id: target.id, status: "failed", note: note.trim() })} />
          <Button label="Annuler la transaction" variant="ghost" disabled={!noteOk || pending} onPress={() => target && resolve.mutate({ id: target.id, status: "cancelled", note: note.trim() })} />
          <Button label="Marquer payé" variant="primary" icon="check" disabled={!noteOk || pending} loading={resolve.isPending && resolve.variables?.status === "success"} onPress={() => target && resolve.mutate({ id: target.id, status: "success", note: note.trim() })} />
        </>
      }
    >
      {target ? (
        <>
          <Card title="1. Revérifier auprès de Ligdi Cash" description="À essayer d’abord : le paiement a pu aboutir sans que la confirmation nous parvienne.">
            <Button label="Revérifier maintenant" icon="sync" loading={recheck.isPending} disabled={pending} onPress={() => recheck.mutate({ id: target.id })} />
            {result ? <Alert tone="info">{result}</Alert> : null}
          </Card>
          <Card title="2. Ou décider à la main" description="« Marquer payé » prolonge l’abonnement de la durée de la formule.">
            <Field label="Motif (obligatoire)" value={note} onChangeText={setNote} placeholder="Ex. reçu Orange Money n° 123 transmis par le client" multiline />
            <Hint>Référence {target.reference}. Le motif est enregistré dans le journal d’audit.</Hint>
          </Card>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </>
      ) : null}
    </Dialog>
  );
}

export function PremiumPage() {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = usePage(status);
  const summary = trpc.admin.dashboard.useQuery(undefined, { retry: 1 });
  const transactions = trpc.admin.premium.transactions.useQuery({ status, page, limit: PAGE_SIZE }, { retry: 1, placeholderData: (previous) => previous });
  const rows = transactions.data?.items ?? [];
  const pageUtils = trpc.useUtils();
  const [settle, setSettle] = useState<SettleTarget | null>(null);
  const settleTarget = (transaction: (typeof rows)[number]): SettleTarget => ({ id: transaction.id, amount: transaction.amount, planId: transaction.planId, status: transaction.status, provider: transaction.provider, reference: transaction.merchantReference, user: displayIdentity({ name: transaction.userName, phone: transaction.userPhone, email: transaction.userEmail, id: transaction.userId }) });
  const statusOf = (value: string) => TRANSACTION_STATUS[value] ?? { label: value, tone: "neutral" as const };
  const planBadge = (planId: string) => (planId === "offered" ? <Badge label="Offert" tone="info" icon="card-giftcard" /> : <CellText>{PLAN_LABELS[planId] ?? planId}</CellText>);

  return (
    <AdminPage
      section="premium"
      actions={
        <ExportButton
          label="Export comptable (CSV)"
          run={async () => {
            const rows = await pageUtils.admin.premium.exportTransactions.fetch({ status });
            downloadFile(
              datedFileName("transactions"),
              toCsv(rows, [
                { label: "Date", value: (row) => row.createdAt },
                { label: "Référence", value: (row) => row.merchantReference },
                { label: "Prestataire", value: (row) => (row.provider === "admin" ? "Offert (console)" : row.provider) },
                { label: "Formule", value: (row) => PLAN_LABELS[row.planId] ?? row.planId },
                { label: "Montant", value: (row) => row.amount },
                { label: "Devise", value: (row) => row.currency },
                { label: "Statut", value: (row) => TRANSACTION_STATUS[row.status]?.label ?? row.status },
                { label: "Utilisateur", value: (row) => row.userName ?? row.userPhone ?? `#${row.userId}` },
              ]),
            );
          }}
        />
      }
    >
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
              minWidth={1080}
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
                  case "actions":
                    return transaction.status === "success" ? null : <Button size="sm" label="Régler" onPress={() => setSettle(settleTarget(transaction))} />;
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
                  {transaction.status === "success" ? null : <Button size="sm" label="Régler" onPress={() => setSettle(settleTarget(transaction))} />}
                </View>
              </View>
            ))
          )}
          <View style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
            <Pagination page={page} limit={PAGE_SIZE} total={transactions.data?.total ?? 0} onChange={setPage} />
          </View>
        </DataState>
      </Card>
      <SettleDialog target={settle} onClose={() => setSettle(null)} />
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
