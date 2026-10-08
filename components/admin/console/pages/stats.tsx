import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";

import { ResponsiveTable } from "../list";
import { AdminPage } from "../shell";
import { formatCount } from "../shared";
import { font, useAdminLayout, useAdminTheme, type Tone } from "../theme";
import { Card, CellText, DataState, Grid, Hint, KpiCard, Segmented, type Column, type IconName } from "../ui";

type EventKey = "app_open" | "search" | "place_view" | "call" | "directions";

const EVENTS: { key: EventKey; label: string; icon: IconName; tone: Tone }[] = [
  { key: "app_open", label: "Ouvertures", icon: "smartphone", tone: "brand" },
  { key: "search", label: "Recherches", icon: "search", tone: "info" },
  { key: "place_view", label: "Fiches consultées", icon: "visibility", tone: "neutral" },
  { key: "call", label: "Appels lancés", icon: "call", tone: "success" },
  { key: "directions", label: "Itinéraires", icon: "directions", tone: "warning" },
];

const COLUMNS: readonly Column[] = [
  { key: "city", label: "Ville", flex: 1.6 },
  ...EVENTS.map((event) => ({ key: event.key, label: event.label, flex: 1, align: "right" as const })),
];

function shortDay(day: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** Barres quotidiennes d'un indicateur (sans bibliothèque de graphiques). */
function DailyChart({ daily, event }: { daily: ({ day: string } & Record<EventKey, number>)[]; event: EventKey }) {
  const theme = useAdminTheme();
  const max = Math.max(1, ...daily.map((day) => day[event]));
  const step = Math.max(1, Math.ceil(daily.length / 6));
  const ticks = daily.filter((_, index) => index % step === 0);
  return (
    <View>
      <View style={styles.chart}>
        {daily.map((day) => (
          <View key={day.day} style={styles.barSlot} accessibilityLabel={`${shortDay(day.day)} : ${day[event]}`} {...({ title: `${shortDay(day.day)} : ${formatCount(day[event])}` } as object)}>
            <View style={[styles.bar, { height: `${Math.max(day[event] ? 4 : 0, (day[event] / max) * 100)}%`, backgroundColor: theme.brand }]} />
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        {ticks.map((day) => (
          <Text key={day.day} style={[styles.axisLabel, { color: theme.textMuted }]}>
            {shortDay(day.day)}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function StatsPage() {
  const { desktop } = useAdminLayout();
  const [days, setDays] = useState("30");
  const [event, setEvent] = useState<EventKey>("app_open");
  const stats = trpc.admin.stats.useQuery({ days: Number(days) }, { retry: 1, placeholderData: (previous) => previous });
  const data = stats.data;
  return (
    <AdminPage section="stats" actions={<Segmented value={days} onChange={setDays} options={[{ value: "7", label: "7 jours" }, { value: "30", label: "30 jours" }, { value: "90", label: "90 jours" }]} />}>
      <DataState loading={stats.isLoading} error={stats.error} onRetry={() => stats.refetch()}>
        {data ? (
          <>
            <Grid columns={desktop ? 5 : 2}>
              {EVENTS.map((item) => (
                <KpiCard key={item.key} label={item.label} value={formatCount(data.totals[item.key])} icon={item.icon} tone={item.tone} onPress={() => setEvent(item.key)} hint={event === item.key ? "Affiché ci-dessous" : undefined} />
              ))}
            </Grid>
            <Card title={`${EVENTS.find((item) => item.key === event)?.label} par jour`} actions={desktop ? <Segmented value={event} onChange={(value) => setEvent(value as EventKey)} options={EVENTS.map((item) => ({ value: item.key, label: item.label }))} /> : undefined}>
              <DailyChart daily={data.daily} event={event} />
            </Card>
            <Card title="Par ville" description="Ville choisie dans l’application au moment de l’action." padded={false}>
              <DataState empty={!data.cities.length} emptyTitle="Aucune donnée sur la période" emptyMessage="Les compteurs apparaissent dès que l’application mise à jour est utilisée.">
                <ResponsiveTable
                  columns={COLUMNS}
                  rows={data.cities}
                  rowKey={(row) => row.city ?? "—"}
                  minWidth={760}
                  renderCell={(row, key) => (key === "city" ? <CellText strong>{row.city ?? "Ville non renseignée"}</CellText> : <CellText muted={!row[key as EventKey]}>{formatCount(row[key as EventKey])}</CellText>)}
                  mobileRow={(row) => ({ title: row.city ?? "Ville non renseignée", meta: EVENTS.map((item) => `${item.label} : ${formatCount(row[item.key])}`).join(" · ") })}
                />
              </DataState>
            </Card>
          </>
        ) : null}
      </DataState>
      <Hint>Compteurs anonymes : l’application n’envoie ni identité, ni position, ni texte recherché. Les jours sont comptés en heure du Burkina Faso.</Hint>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: "row", alignItems: "flex-end", height: 180, gap: 3 },
  barSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 0 },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  axisLabel: { fontSize: font.xs },
});
