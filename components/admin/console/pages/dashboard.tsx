import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";

import { AdminPage } from "../shell";
import { PLAN_LABELS, TRANSACTION_STATUS, auditActionLabel, auditIcon, auditTone, displayIdentity, formatCount, formatDutyDay, formatRelative, formatXof } from "../shared";
import { font, radius, toneColors, useAdminTheme } from "../theme";
import { Alert, Badge, Button, Card, DataState, Grid, KpiCard } from "../ui";

function percent(part: number, total: number) {
  return total ? `${Math.round((part / total) * 100)} %` : "0 %";
}

export function DashboardPage() {
  const theme = useAdminTheme();
  const router = useRouter();
  const summary = trpc.admin.dashboard.useQuery(undefined, { retry: 1 });
  const duty = trpc.admin.duty.overview.useQuery({ weeks: 1 }, { retry: 1 });
  const directory = trpc.admin.directory.list.useQuery({ page: 1, limit: 1 }, { retry: 1 });
  const payments = trpc.admin.premium.transactions.useQuery({ page: 1, limit: 6 }, { retry: 1 });
  const activity = trpc.admin.audit.list.useQuery({ page: 1, limit: 7 }, { retry: 1 });
  const contributionCounts = trpc.admin.contributions.counts.useQuery(undefined, { retry: 1 });
  const toReview = (contributionCounts.data?.newPlaces ?? 0) + (contributionCounts.data?.newProblems ?? 0);
  const go = (href: string) => router.replace(href as never);
  const data = summary.data;
  const cities = [...(directory.data?.cities ?? [])].filter((city) => city.count > 0).sort((a, b) => b.count - a.count);
  const topCities = cities.slice(0, 8);
  const maxCity = topCities[0]?.count ?? 1;

  return (
    <AdminPage section="dashboard" actions={<Button label="Actualiser" icon="refresh" onPress={() => { void summary.refetch(); void duty.refetch(); void payments.refetch(); void activity.refetch(); void directory.refetch(); }} />}>
      <DataState loading={summary.isLoading} error={summary.error} onRetry={() => summary.refetch()}>
        {data ? (
          <>
            {toReview > 0 ? (
              <Alert tone="info" icon="inbox" title={`${toReview} contribution${toReview > 1 ? "s" : ""} à traiter`}>
                {`${contributionCounts.data?.newPlaces ?? 0} établissement(s) proposé(s) et ${contributionCounts.data?.newProblems ?? 0} signalement(s) d’erreur envoyés depuis l’application. Ouvrez « Contributions » pour les examiner.`}
              </Alert>
            ) : null}
            {data.pendingTransactions > 0 ? (
              <Alert tone="warning" title={`${data.pendingTransactions} paiement${data.pendingTransactions > 1 ? "s" : ""} en attente de confirmation`}>
                Ligdi Cash n’a pas encore confirmé ces paiements. Ils apparaissent dans la page Premium.
              </Alert>
            ) : null}
            <Grid columns={4}>
              <KpiCard label="Utilisateurs" value={formatCount(data.users)} icon="group" tone="brand" hint={`+${formatCount(data.newUsersThisMonth)} ce mois · ${percent(data.verifiedUsers, data.users)} vérifiés`} onPress={() => go("/admin/utilisateurs")} />
              <KpiCard label="Abonnés Premium actifs" value={formatCount(data.premiumUsers)} icon="workspace-premium" tone="info" hint={`${percent(data.premiumUsers, data.users)} des comptes`} onPress={() => go("/admin/abonnements")} />
              <KpiCard label="Revenus du mois" value={formatXof(data.revenueThisMonth)} icon="payments" tone="success" hint={`Total encaissé : ${formatXof(data.revenueTotal)}`} onPress={() => go("/admin/abonnements")} />
              <KpiCard label="Établissements publiés" value={formatCount(data.directoryEntries)} icon="local-pharmacy" tone="warning" hint={`${cities.length} villes couvertes`} onPress={() => go("/admin/annuaire")} />
            </Grid>
          </>
        ) : null}
      </DataState>

      <Grid columns={2}>
        <Card title="Gardes de la semaine" description="Groupe de garde en cours dans chaque ville programmée." actions={<Button label="Voir les gardes" size="sm" onPress={() => go("/admin/gardes")} />} padded={false}>
          <DataState loading={duty.isLoading} error={duty.error} onRetry={() => duty.refetch()} empty={!duty.data?.cities.length} emptyTitle="Aucune ville programmée">
            {(duty.data?.cities ?? []).map((city, index, list) => {
              const week = city.weeks[0];
              return (
                <View key={city.city} style={[styles.row, index < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                  <View style={styles.flex}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{city.city}</Text>
                    <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{week ? `Jusqu’au ${formatDutyDay(week.end)} à 8 h` : "—"}</Text>
                  </View>
                  {week ? <Badge label={week.label} tone="brand" /> : null}
                  <Text style={[styles.rowValue, { color: theme.textSecondary }]}>{week ? `${week.pharmacyCount} pharmacies` : ""}</Text>
                </View>
              );
            })}
          </DataState>
        </Card>

        <Card title="Annuaire par ville" description="Établissements publiés dans l’application." actions={<Button label="Voir l’annuaire" size="sm" onPress={() => go("/admin/annuaire")} />}>
          <DataState loading={directory.isLoading} error={directory.error} onRetry={() => directory.refetch()} empty={!topCities.length}>
            <View style={styles.bars}>
              {topCities.map((city) => (
                <View key={city.name} style={styles.barRow}>
                  <Text numberOfLines={1} style={[styles.barLabel, { color: theme.textSecondary }]}>{city.name}</Text>
                  <View style={[styles.barTrack, { backgroundColor: theme.surfaceMuted }]}>
                    <View style={[styles.barFill, { width: `${Math.max(3, (city.count / maxCity) * 100)}%`, backgroundColor: theme.brand }]} />
                  </View>
                  <Text style={[styles.barValue, { color: theme.text }]}>{formatCount(city.count)}</Text>
                </View>
              ))}
            </View>
          </DataState>
        </Card>
      </Grid>

      <Grid columns={2}>
        <Card title="Derniers paiements" actions={<Button label="Tout voir" size="sm" onPress={() => go("/admin/abonnements")} />} padded={false}>
          <DataState loading={payments.isLoading} error={payments.error} onRetry={() => payments.refetch()} empty={!payments.data?.items.length} emptyTitle="Aucun paiement">
            {(payments.data?.items ?? []).map((payment, index, list) => {
              const status = TRANSACTION_STATUS[payment.status] ?? { label: payment.status, tone: "neutral" as const };
              return (
                <View key={payment.id} style={[styles.row, index < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                  <View style={styles.flex}>
                    <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.text }]}>{displayIdentity({ name: payment.userName, phone: payment.userPhone, email: payment.userEmail, id: payment.userId })}</Text>
                    <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{PLAN_LABELS[payment.planId] ?? payment.planId} · {formatRelative(payment.createdAt)}</Text>
                  </View>
                  <Text style={[styles.rowValue, styles.strong, { color: theme.text }]}>{formatXof(payment.amount)}</Text>
                  <Badge label={status.label} tone={status.tone} dot />
                </View>
              );
            })}
          </DataState>
        </Card>

        <Card title="Activité récente" actions={<Button label="Journal" size="sm" onPress={() => go("/admin/journal")} />} padded={false}>
          <DataState loading={activity.isLoading} error={activity.error} onRetry={() => activity.refetch()} empty={!activity.data?.items.length} emptyTitle="Aucune action enregistrée">
            {(activity.data?.items ?? []).map((event, index, list) => {
              const { fg, bg } = toneColors(theme, auditTone(event.action));
              return (
                <View key={event.id} style={[styles.row, index < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                  <View style={[styles.eventIcon, { backgroundColor: bg }]}><MaterialIcons name={auditIcon(event.action)} size={16} color={fg} /></View>
                  <View style={styles.flex}>
                    <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.text }]}>{auditActionLabel(event.action)}</Text>
                    <Text numberOfLines={1} style={[styles.rowMeta, { color: theme.textMuted }]}>{displayIdentity({ name: event.actorName, phone: event.actorPhone, email: event.actorEmail, id: event.actorUserId })}{event.targetId ? ` · ${event.targetId}` : ""}</Text>
                  </View>
                  <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{formatRelative(event.createdAt)}</Text>
                </View>
              );
            })}
          </DataState>
        </Card>
      </Grid>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12, minHeight: 60 },
  rowTitle: { fontSize: font.md, fontWeight: "600" },
  rowMeta: { fontSize: font.xs, marginTop: 2 },
  rowValue: { fontSize: font.sm, minWidth: 90, textAlign: "right" },
  strong: { fontWeight: "600" },
  eventIcon: { width: 32, height: 32, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  bars: { gap: 12 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  barLabel: { width: 120, fontSize: font.sm },
  barTrack: { flex: 1, height: 10, borderRadius: 5, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 5 },
  barValue: { width: 40, textAlign: "right", fontSize: font.sm, fontWeight: "600" },
});
