import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";

import { AdminPage } from "../shell";
import { formatDutyDate, formatDutyDay } from "../shared";
import { font, useAdminTheme } from "../theme";
import { Alert, Badge, Card, CellStack, CellText, DataState, DataTable, Select, type Column } from "../ui";

const WEEKS = 8;

export function DutyPage() {
  const theme = useAdminTheme();
  const overview = trpc.admin.duty.overview.useQuery({ weeks: WEEKS }, { retry: 1 });
  const cities = overview.data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const city = cities.find((entry) => entry.city === selected) ?? cities[0];
  const weeks = cities[0]?.weeks ?? [];
  const withoutGroup = cities.filter((entry) => entry.withoutGroup.length > 0);

  const columns: Column[] = [
    { key: "city", label: "Ville", width: 190 },
    ...weeks.map((week, index) => ({ key: `w${index}`, label: index === 0 ? "Cette semaine" : formatDutyDay(week.start), flex: index === 0 ? 1.5 : 1, align: "center" as const })),
  ];

  return (
    <AdminPage section="duty">
      <DataState loading={overview.isLoading} error={overview.error} onRetry={() => overview.refetch()} empty={!cities.length} emptyTitle="Aucune ville programmée">
        {withoutGroup.length ? (
          <Alert tone="warning" title="Pharmacies sans groupe de garde">
            {withoutGroup.map((entry) => `${entry.city} : ${entry.withoutGroup.map((pharmacy) => pharmacy.name).join(", ")}`).join(" · ")}. Elles ne sont jamais affichées de garde : renseignez leur groupe dans l’annuaire.
          </Alert>
        ) : null}

        <Card title="Calendrier des gardes" description={`Groupe de garde par semaine, sur ${WEEKS} semaines. La relève a lieu chaque samedi à 8 h.`} padded={false}>
          <DataTable
            columns={columns}
            rows={cities}
            rowKey={(entry) => entry.city}
            minWidth={1080}
            onRowPress={(entry) => setSelected(entry.city)}
            selectedKey={city?.city ?? null}
            renderCell={(entry, key) => {
              if (key === "city") return <CellStack title={entry.city} subtitle={`${entry.pharmacyCount} pharmacies`} />;
              const index = Number(key.slice(1));
              const week = entry.weeks[index];
              if (!week) return null;
              return index === 0 ? (
                <View style={styles.center}>
                  <Badge label={week.label} tone="brand" />
                  <Text style={[styles.count, { color: theme.textMuted }]}>{week.pharmacyCount} pharm.</Text>
                </View>
              ) : (
                <CellText muted>{week.label}</CellText>
              );
            }}
          />
        </Card>

        {city ? (
          <Card
            title={`De garde maintenant à ${city.city}`}
            description={city.weeks[0] ? `${city.weeks[0].label}, du ${formatDutyDate(city.weeks[0].start)} au ${formatDutyDate(city.weeks[0].end)}.` : undefined}
            actions={<Select label="Ville" value={city.city} options={cities.map((entry) => ({ value: entry.city, label: entry.city }))} onChange={setSelected} style={styles.citySelect} />}
            padded={false}
          >
            <DataState empty={!city.onDutyNow.length} emptyTitle="Aucune pharmacie de garde" emptyMessage="Aucune pharmacie de l’annuaire n’appartient au groupe de garde de cette semaine.">
              <DataTable
                columns={[
                  { key: "name", label: "Pharmacie", flex: 2 },
                  { key: "phone", label: "Téléphone", flex: 1 },
                  { key: "address", label: "Adresse", flex: 2 },
                ]}
                rows={city.onDutyNow}
                rowKey={(pharmacy) => pharmacy.id}
                minWidth={640}
                renderCell={(pharmacy, key) => {
                  if (key === "name") return <CellText strong>{pharmacy.name}</CellText>;
                  if (key === "phone") return <CellText mono>{pharmacy.phone ?? "—"}</CellText>;
                  return <CellText muted>{pharmacy.address ?? "—"}</CellText>;
                }}
              />
            </DataState>
          </Card>
        ) : null}
      </DataState>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: 2 },
  count: { fontSize: font.xs },
  citySelect: { minWidth: 200 },
});
