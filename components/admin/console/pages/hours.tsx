import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { WeeklyHoursEditor, cloneHours } from "@/components/pharmagarde/weekly-hours-editor";
import { WEEK_DAYS, WEEK_DAY_LABELS, validateWeeklyHours, type WeeklyHours } from "@/lib/pharmagarde/opening-hours";
import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";

import { AdminPage } from "../shell";
import { Alert, Badge, Button, Card, CellText, DataState, DataTable, Dialog, IconButton, type Column } from "../ui";

const COLUMNS: readonly Column[] = [
  { key: "city", label: "Ville", width: 170 },
  ...WEEK_DAYS.map((day) => ({ key: day, label: WEEK_DAY_LABELS[day].slice(0, 3), flex: 1 })),
  { key: "status", label: "Statut", width: 130 },
  { key: "actions", label: "", width: 92, align: "right" as const },
];

export function HoursPage() {
  const utils = trpc.useUtils();
  const cities = trpc.admin.hours.cities.useQuery(undefined, { retry: 1 });
  const [editing, setEditing] = useState<{ city: string; hours: WeeklyHours } | null>(null);
  const refresh = async () => {
    haptic.success();
    setEditing(null);
    await utils.admin.hours.cities.invalidate();
  };
  const setCity = trpc.admin.hours.setCity.useMutation({ onSuccess: refresh });
  const resetCity = trpc.admin.hours.resetCity.useMutation({ onSuccess: refresh });
  const rows = cities.data ?? [];
  const invalid = editing ? validateWeeklyHours(editing.hours) : null;

  return (
    <AdminPage section="hours">
      <Alert tone="info">Une pharmacie suit les horaires de sa ville, sauf si sa fiche a des horaires propres. En garde, elle est ouverte 24 h/24.</Alert>
      {resetCity.error ? <Alert tone="danger">{resetCity.error.message}</Alert> : null}
      <Card title="Horaires par ville" padded={false}>
        <DataState loading={cities.isLoading} error={cities.error} onRetry={() => cities.refetch()} empty={!rows.length}>
          <DataTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(entry) => entry.city}
            minWidth={1080}
            onRowPress={(entry) => { setCity.reset(); setEditing({ city: entry.city, hours: cloneHours(entry.hours) }); }}
            renderCell={(entry, key) => {
              if (key === "city") return <CellText strong>{entry.city}</CellText>;
              if (key === "status") return <Badge label={entry.custom ? "Personnalisés" : "Par défaut"} tone={entry.custom ? "brand" : "neutral"} />;
              if (key === "actions") {
                return (
                  <View style={styles.actions}>
                    <IconButton icon="edit" label={`Modifier les horaires de ${entry.city}`} onPress={() => { setCity.reset(); setEditing({ city: entry.city, hours: cloneHours(entry.hours) }); }} />
                    {entry.custom ? <IconButton icon="restart-alt" label={`Rétablir les horaires par défaut de ${entry.city}`} disabled={resetCity.isPending} onPress={() => resetCity.mutate({ city: entry.city })} /> : null}
                  </View>
                );
              }
              const ranges = entry.hours[key as keyof WeeklyHours];
              return ranges.length ? <CellText>{ranges.map((range) => `${range.open}–${range.close}`).join(", ")}</CellText> : <CellText muted>Fermé</CellText>;
            }}
          />
        </DataState>
      </Card>

      <Dialog
        visible={!!editing}
        title={`Horaires de ${editing?.city ?? ""}`}
        description="Horaires de service des pharmacies de la ville, hors garde."
        onClose={() => setEditing(null)}
        width={640}
        footer={
          <>
            <Button label="Annuler" onPress={() => setEditing(null)} disabled={setCity.isPending} />
            <Button label="Enregistrer" variant="primary" icon="check" loading={setCity.isPending} disabled={!!invalid} onPress={() => editing && setCity.mutate({ city: editing.city, openingHours: editing.hours })} />
          </>
        }
      >
        {setCity.error ? <Alert tone="danger">{setCity.error.message}</Alert> : null}
        {invalid ? <Alert tone="warning">{invalid}</Alert> : null}
        {editing ? <WeeklyHoursEditor value={editing.hours} onChange={(value) => setEditing({ ...editing, hours: value })} /> : null}
      </Dialog>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: 6 },
});
