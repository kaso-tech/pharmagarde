import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StyleSheet, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";

import { ExportButton } from "../export-button";
import { datedFileName, downloadFile } from "../files";
import { AdminPage } from "../shell";
import { formatCount, formatDate, formatRelative } from "../shared";
import { font, toneColors, useAdminTheme } from "../theme";
import { Alert, Badge, Button, Card, DataState, Grid } from "../ui";

function StatusRow({ ok, label, detail, warn = false }: { ok: boolean; label: string; detail: string; warn?: boolean }) {
  const theme = useAdminTheme();
  const tone = ok ? "success" : warn ? "warning" : "danger";
  const { fg, bg } = toneColors(theme, tone);
  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <View style={[styles.icon, { backgroundColor: bg }]}>
        <MaterialIcons name={ok ? "check-circle" : warn ? "warning-amber" : "error-outline"} size={18} color={fg} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.detail, { color: theme.textMuted }]}>{detail}</Text>
      </View>
    </View>
  );
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days} j ${hours} h` : hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

export function SystemPage() {
  const theme = useAdminTheme();
  const utils = trpc.useUtils();
  const status = trpc.admin.system.status.useQuery(undefined, { retry: 1, refetchInterval: 60_000 });
  const refresh = trpc.admin.system.refreshData.useMutation({ onSuccess: () => utils.admin.system.status.invalidate() });
  const data = status.data;
  const pending = data?.migrations.pending ?? null;

  return (
    <AdminPage
      section="system"
      actions={
        <>
          <ExportButton
            label="Sauvegarde des données (JSON)"
            run={async () => {
              const backup = await utils.admin.system.backup.fetch();
              downloadFile(datedFileName("sauvegarde-console", "json"), JSON.stringify(backup, null, 2), "application/json");
            }}
          />
          <Button label="Actualiser" icon="refresh" onPress={() => status.refetch()} />
        </>
      }
    >
      <DataState loading={status.isLoading} error={status.error} onRetry={() => status.refetch()}>
        {data ? (
          <>
            {pending?.length ? (
              <Alert tone="danger" title={`${pending.length} migration${pending.length > 1 ? "s" : ""} de base de données à appliquer`}>
                {`${pending.join(", ")}. Tant qu’elles ne sont pas appliquées, les fonctions qui en dépendent (contributions, gardes saisies dans la console, suspension des comptes…) ne fonctionnent pas. Commande : pnpm db:push.`}
              </Alert>
            ) : null}
            <Grid columns={2}>
              <Card title="Base de données" padded={false}>
                <StatusRow ok={data.database.ok} label={data.database.ok ? "Connectée" : "Injoignable"} detail={data.database.ok ? `Temps de réponse : ${data.database.latencyMs} ms` : data.database.error ?? "Erreur inconnue"} />
                <StatusRow
                  ok={!!pending && pending.length === 0}
                  warn={pending === null}
                  label="Migrations"
                  detail={pending === null ? "Impossible de comparer les migrations appliquées au journal." : `${data.migrations.applied} appliquée(s) sur ${data.migrations.expected} · dernière attendue : ${data.migrations.latest}`}
                />
              </Card>
              <Card title="Services" padded={false}>
                {data.services.map((service) => (
                  <StatusRow key={service.key} ok={service.ok} warn={service.key === "cors" || service.key === "admin-token" || service.key === "second-factor"} label={service.label} detail={service.detail} />
                ))}
              </Card>
            </Grid>
            <Card title="Données publiées" description="Les pharmacies viennent de l’annuaire versionné (et des fiches de la console) ; les structures de santé, d’OpenStreetMap." padded={false}>
              <StatusRow ok={!!data.data.pharmacyDirectory} label={`Annuaire des pharmacies : ${formatCount(data.data.pharmacyDirectory?.count ?? 0)} pharmacies`} detail={data.data.pharmacyDirectory ? `Fichier importé le ${formatDate(data.data.pharmacyDirectory.updatedAt)}` : "Fichier de l’annuaire illisible"} />
              <StatusRow ok={!!data.data.medicines} label={`Catalogue des médicaments : ${formatCount(data.data.medicines?.count ?? 0)} produits`} detail={data.data.medicines?.updatedAt ? `Importé le ${formatDate(data.data.medicines.updatedAt)}` : "Catalogue illisible"} />
              <View style={[styles.row, { borderBottomColor: "transparent" }]}>
                <View style={styles.flex}>
                  <Text style={[styles.label, { color: theme.text }]}>Structures de santé (OpenStreetMap) : {formatCount(data.data.healthcareCache.items)}</Text>
                  <Text style={[styles.detail, { color: theme.textMuted }]}>
                    {data.data.healthcareCache.updatedAt ? `Mises à jour ${formatRelative(data.data.healthcareCache.updatedAt)} · prochaine mise à jour automatique après le ${formatDate(data.data.healthcareCache.expiresAt)}` : "Jamais mises à jour"}
                    {data.data.healthcareCache.lastError ? ` · dernière erreur : ${data.data.healthcareCache.lastError}` : ""}
                  </Text>
                </View>
                <Button label="Mettre à jour maintenant" icon="sync" size="sm" loading={refresh.isPending && refresh.variables?.kind === "healthcare"} onPress={() => refresh.mutate({ kind: "healthcare" })} />
              </View>
              {refresh.data ? <View style={styles.result}><Alert tone={refresh.data.ok ? "success" : "danger"}>{refresh.data.ok ? "Mise à jour terminée." : "La mise à jour a échoué : les données précédentes restent en service."}</Alert></View> : null}
              {refresh.error ? <View style={styles.result}><Alert tone="danger">{refresh.error.message}</Alert></View> : null}
            </Card>
            <Card title="Exécution">
              <View style={styles.facts}>
                <Badge label={data.runtime.environment === "production" ? "Production" : data.runtime.environment} tone={data.runtime.environment === "production" ? "success" : "warning"} />
                <Text style={[styles.detail, { color: theme.textSecondary }]}>Node {data.runtime.node} · en service depuis {formatUptime(data.runtime.uptimeSeconds)} · mémoire {data.runtime.memoryMb} Mo · heure du serveur {formatDate(data.serverTime)}</Text>
              </View>
            </Card>
          </>
        ) : null}
      </DataState>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  label: { fontSize: font.md, fontWeight: "600" },
  detail: { fontSize: font.sm, lineHeight: 19, marginTop: 2 },
  result: { paddingHorizontal: 20, paddingBottom: 16 },
  facts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
});
