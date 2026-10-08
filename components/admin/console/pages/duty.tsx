import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

import { AdminPage } from "../shell";
import { formatDutyDate, formatDutyDay } from "../shared";
import { font, useAdminLayout, useAdminTheme } from "../theme";
import { Alert, Badge, Button, Card, CellStack, CellText, ConfirmDialog, DataState, DataTable, Dialog, Field, FieldLabel, Hint, IconButton, Segmented, Select, type Column } from "../ui";

const WEEKS = 8;

type Overview = inferRouterOutputs<AppRouter>["admin"]["duty"]["overview"];
type CityDuty = Overview["cities"][number];
type PharmacyRef = { id: string; name: string; dutyGroup: number | null; phone: string | null };

/** Samedi qui ouvre la semaine de garde en cours (relève le samedi à 8 h, heure du Burkina = UTC). */
function currentWeekStart(now = new Date()) {
  const shifted = new Date(now.getTime() - 8 * 3600 * 1000);
  const back = (shifted.getUTCDay() + 1) % 7;
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - back)).toISOString().slice(0, 10);
}

type EditorState = {
  city: string;
  mode: "groups" | "lists" | "off";
  groupCount: number;
  referenceStart: string;
  referenceTurn: number;
  listLabels: string[];
  /** Liste de chaque pharmacie (index), absente = dans aucune liste. */
  assignment: Record<string, number>;
};

function editorFor(city: string, pharmacies: readonly PharmacyRef[], current?: CityDuty): EditorState {
  if (current) {
    const lists = current.mode === "lists";
    const assignment: Record<string, number> = {};
    if (lists) current.turns.forEach((turn, index) => turn.pharmacyIds?.forEach((id) => (assignment[id] = index)));
    return {
      city,
      mode: current.mode,
      groupCount: current.groupCount ?? 4,
      referenceStart: current.referenceStart,
      referenceTurn: current.referenceTurn,
      listLabels: lists ? current.turns.map((turn) => turn.label) : ["Liste 1", "Liste 2"],
      assignment,
    };
  }
  const groups = Math.max(...pharmacies.map((pharmacy) => pharmacy.dutyGroup ?? 0), 0);
  return { city, mode: groups >= 2 ? "groups" : "lists", groupCount: groups >= 2 ? groups : 4, referenceStart: currentWeekStart(), referenceTurn: 1, listLabels: ["Liste 1", "Liste 2"], assignment: {} };
}

function RotationEditor({ state, pharmacies, onChange, onClose, source }: { state: EditorState | null; pharmacies: readonly PharmacyRef[]; onChange: (state: EditorState) => void; onClose: () => void; source?: "default" | "console" }) {
  const theme = useAdminTheme();
  const utils = trpc.useUtils();
  const done = async () => {
    haptic.success();
    await Promise.all([utils.admin.duty.overview.invalidate(), utils.admin.audit.list.invalidate()]);
    onClose();
  };
  const save = trpc.admin.duty.saveRotation.useMutation({ onSuccess: done });
  const reset = trpc.admin.duty.resetRotation.useMutation({ onSuccess: done });
  if (!state) return null;
  const turnCount = state.mode === "groups" ? state.groupCount : state.listLabels.length;
  const set = (patch: Partial<EditorState>) => onChange({ ...state, ...patch });
  const lists = state.listLabels.map((label, index) => ({ label: label.trim() || `Liste ${index + 1}`, pharmacyIds: pharmacies.filter((pharmacy) => state.assignment[pharmacy.id] === index).map((pharmacy) => pharmacy.id) }));
  const emptyList = state.mode === "lists" && lists.some((list) => !list.pharmacyIds.length);
  const submit = () => {
    if (state.mode === "off") save.mutate({ city: state.city, mode: "off" });
    else if (state.mode === "groups") save.mutate({ city: state.city, mode: "groups", groupCount: state.groupCount, referenceStart: state.referenceStart, referenceTurn: Math.min(state.referenceTurn, turnCount) });
    else save.mutate({ city: state.city, mode: "lists", turns: lists, referenceStart: state.referenceStart, referenceTurn: Math.min(state.referenceTurn, turnCount) });
  };
  const error = save.error?.message ?? reset.error?.message;

  return (
    <Dialog
      visible
      title={`Programmation des gardes · ${state.city}`}
      description="La garde change chaque samedi à 8 h et suit les tours dans l’ordre, puis recommence."
      onClose={onClose}
      width={760}
      footer={
        <>
          {source === "console" ? <Button label="Revenir à la programmation par défaut" variant="ghost" icon="restart-alt" loading={reset.isPending} onPress={() => reset.mutate({ city: state.city })} /> : null}
          <Button label="Annuler" onPress={onClose} />
          <Button label="Enregistrer" variant="primary" icon="check" loading={save.isPending} disabled={emptyList} onPress={submit} />
        </>
      }
    >
      <View style={styles.field}>
        <FieldLabel>Mode</FieldLabel>
        <Segmented value={state.mode} onChange={(value) => set({ mode: value as EditorState["mode"] })} options={[{ value: "groups", label: "Par groupes" }, { value: "lists", label: "Par listes" }, { value: "off", label: "Pas de garde" }]} />
        <Hint>{state.mode === "groups" ? "Chaque pharmacie a un groupe dans sa fiche ; le groupe de garde change chaque semaine." : state.mode === "lists" ? "Vous composez ici chaque liste de pharmacies ; les listes se succèdent chaque semaine." : "Aucune pharmacie de cette ville n’est affichée de garde."}</Hint>
      </View>

      {state.mode === "groups" ? (
        <View style={styles.field}>
          <FieldLabel>Nombre de groupes</FieldLabel>
          <Segmented value={String(state.groupCount)} onChange={(value) => set({ groupCount: Number(value) })} options={[2, 3, 4, 5, 6].map((count) => ({ value: String(count), label: String(count) }))} />
        </View>
      ) : null}

      {state.mode !== "off" ? (
        <View style={styles.row}>
          <Field style={styles.flex} label="Semaine de référence (samedi, AAAA-MM-JJ)" value={state.referenceStart} onChangeText={(value) => set({ referenceStart: value.trim() })} hint={`Semaine en cours : ${currentWeekStart()}`} />
          <View style={[styles.flex, styles.field]}>
            <FieldLabel>De garde cette semaine-là</FieldLabel>
            <Select label="Tour de garde" value={String(Math.min(state.referenceTurn, turnCount))} onChange={(value) => set({ referenceTurn: Number(value) })} options={Array.from({ length: turnCount }, (_, index) => ({ value: String(index + 1), label: state.mode === "groups" ? `Groupe ${index + 1}` : lists[index]?.label ?? `Liste ${index + 1}` }))} />
          </View>
        </View>
      ) : null}

      {state.mode === "lists" ? (
        <Card title="Composition des listes" description={`${pharmacies.length} pharmacies dans la ville. Choisissez la liste de chacune.`} padded={false}>
          <View style={styles.listHeader}>
            {state.listLabels.map((label, index) => (
              <View key={index} style={styles.listLabel}>
                <Field label={`Liste ${index + 1} (${lists[index]?.pharmacyIds.length ?? 0})`} value={label} onChangeText={(value) => set({ listLabels: state.listLabels.map((current, position) => (position === index ? value : current)) })} />
              </View>
            ))}
            <View style={styles.listButtons}>
              <Button size="sm" label="Ajouter une liste" icon="add" disabled={state.listLabels.length >= 12} onPress={() => set({ listLabels: [...state.listLabels, `Liste ${state.listLabels.length + 1}`] })} />
              <Button
                size="sm"
                label="Retirer la dernière"
                disabled={state.listLabels.length <= 2}
                onPress={() => {
                  const last = state.listLabels.length - 1;
                  set({ listLabels: state.listLabels.slice(0, last), assignment: Object.fromEntries(Object.entries(state.assignment).filter(([, index]) => index !== last)) });
                }}
              />
            </View>
          </View>
          {pharmacies.map((pharmacy, index) => (
            <View key={pharmacy.id} style={[styles.assignRow, index < pharmacies.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
              <Text numberOfLines={1} style={[styles.flex, styles.assignName, { color: theme.text }]}>{pharmacy.name}</Text>
              <Segmented
                value={state.assignment[pharmacy.id] === undefined ? "none" : String(state.assignment[pharmacy.id])}
                onChange={(value) => {
                  const assignment = { ...state.assignment };
                  if (value === "none") delete assignment[pharmacy.id];
                  else assignment[pharmacy.id] = Number(value);
                  set({ assignment });
                }}
                options={[...state.listLabels.map((_, position) => ({ value: String(position), label: String(position + 1) })), { value: "none", label: "—" }]}
              />
            </View>
          ))}
        </Card>
      ) : null}
      {emptyList ? <Alert tone="warning">Chaque liste doit contenir au moins une pharmacie.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </Dialog>
  );
}

function ExceptionForm({ city }: { city: CityDuty }) {
  const utils = trpc.useUtils();
  const [weekStart, setWeekStart] = useState(city.weeks[0]?.weekStart ?? "");
  const [pharmacyId, setPharmacyId] = useState("");
  const [action, setAction] = useState<"add" | "remove">("remove");
  const [note, setNote] = useState("");
  const add = trpc.admin.duty.addException.useMutation({
    onSuccess: async () => {
      haptic.success();
      setPharmacyId("");
      setNote("");
      await utils.admin.duty.overview.invalidate();
    },
  });
  return (
    <View style={styles.form}>
      <Segmented value={action} onChange={(value) => setAction(value as "add" | "remove")} options={[{ value: "remove", label: "Retirer de la garde (fermeture)" }, { value: "add", label: "Ajouter à la garde (remplaçante)" }]} />
      <View style={styles.row}>
        <View style={[styles.flex, styles.field]}>
          <FieldLabel>Semaine</FieldLabel>
          <Select label="Semaine" value={weekStart} onChange={setWeekStart} options={city.weeks.map((week, index) => ({ value: week.weekStart, label: `${index === 0 ? "Cette semaine" : "Semaine"} du ${formatDutyDay(week.start)} (${week.label})` }))} />
        </View>
        <View style={[styles.flex, styles.field]}>
          <FieldLabel>Pharmacie</FieldLabel>
          <Select label="Pharmacie" placeholder="Choisir une pharmacie" value={pharmacyId} onChange={setPharmacyId} options={city.pharmacies.map((pharmacy) => ({ value: pharmacy.id, label: pharmacy.dutyGroup ? `${pharmacy.name} (groupe ${pharmacy.dutyGroup})` : pharmacy.name }))} />
        </View>
      </View>
      <Field label="Motif (facultatif)" value={note} onChangeText={setNote} placeholder="Ex. fermeture pour travaux, échange avec la pharmacie…" />
      {add.error ? <Alert tone="danger">{add.error.message}</Alert> : null}
      <View style={styles.formActions}>
        <Button label="Ajouter l’exception" variant="primary" icon="add" disabled={!pharmacyId || !weekStart} loading={add.isPending} onPress={() => add.mutate({ city: city.city, weekStart, pharmacyId, action, note: note.trim() || undefined })} />
      </View>
    </View>
  );
}

export function DutyPage() {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const utils = trpc.useUtils();
  const overview = trpc.admin.duty.overview.useQuery({ weeks: WEEKS }, { retry: 1 });
  const cities = overview.data?.cities ?? [];
  const unprogrammed = overview.data?.unprogrammed ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"now" | "exceptions" | "settings">("now");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [newCity, setNewCity] = useState("");
  const [removeId, setRemoveId] = useState<number | null>(null);
  const removeException = trpc.admin.duty.removeException.useMutation({ onSuccess: async () => { setRemoveId(null); await utils.admin.duty.overview.invalidate(); } });
  const city = cities.find((entry) => entry.city === selected) ?? cities[0];
  const weeks = cities[0]?.weeks ?? [];
  const withoutGroup = cities.filter((entry) => entry.withoutGroup.length > 0);
  const editorPharmacies: readonly PharmacyRef[] = editor ? cities.find((entry) => entry.city === editor.city)?.pharmacies ?? unprogrammed.find((entry) => entry.city === editor.city)?.pharmacies ?? [] : [];
  const editorSource = editor ? cities.find((entry) => entry.city === editor.city)?.source ?? (unprogrammed.find((entry) => entry.city === editor.city)?.disabled ? "console" : undefined) : undefined;

  const columns: Column[] = [
    { key: "city", label: "Ville", width: 200 },
    ...weeks.map((week, index) => ({ key: `w${index}`, label: index === 0 ? "Cette semaine" : formatDutyDay(week.start), flex: index === 0 ? 1.5 : 1, align: "center" as const })),
  ];

  return (
    <AdminPage
      section="duty"
      actions={
        unprogrammed.length ? (
          <View style={styles.headerActions}>
            <Select label="Ville à programmer" placeholder="Ville sans garde…" value={newCity} onChange={setNewCity} options={unprogrammed.map((entry) => ({ value: entry.city, label: `${entry.city} (${entry.pharmacies.length})${entry.disabled ? " · désactivée" : ""}` }))} style={styles.citySelect} />
            <Button label="Programmer" icon="event-available" variant="primary" disabled={!newCity} onPress={() => { const entry = unprogrammed.find((item) => item.city === newCity); if (entry) setEditor(editorFor(entry.city, entry.pharmacies)); }} />
          </View>
        ) : undefined
      }
    >
      <DataState loading={overview.isLoading} error={overview.error} onRetry={() => overview.refetch()} empty={!cities.length && !unprogrammed.length} emptyTitle="Aucune ville programmée">
        {withoutGroup.length ? (
          <Alert tone="warning" title="Pharmacies sans groupe de garde">
            {withoutGroup.map((entry) => `${entry.city} : ${entry.withoutGroup.map((pharmacy) => pharmacy.name).join(", ")}`).join(" · ")}. Elles ne sont jamais affichées de garde : renseignez leur groupe dans l’annuaire.
          </Alert>
        ) : null}
        {unprogrammed.length ? <Alert tone="info" title={`${unprogrammed.length} ville${unprogrammed.length > 1 ? "s" : ""} sans programmation`}>{`${unprogrammed.map((entry) => entry.city).join(", ")}. Choisissez une ville en haut à droite pour la programmer par groupes ou par listes.`}</Alert> : null}

        <Card title="Calendrier des gardes" description={`Tour de garde par semaine, sur ${WEEKS} semaines. Cliquez sur une ville pour la gérer ; un point signale une exception.`} padded={false}>
          <DataTable
            columns={columns}
            rows={cities}
            rowKey={(entry) => entry.city}
            minWidth={1080}
            onRowPress={(entry) => setSelected(entry.city)}
            selectedKey={city?.city ?? null}
            renderCell={(entry, key) => {
              if (key === "city") return <CellStack title={entry.city} subtitle={`${entry.pharmacyCount} pharmacies · ${entry.mode === "lists" ? "listes" : "groupes"}${entry.source === "console" ? " · console" : ""}`} />;
              const index = Number(key.slice(1));
              const week = entry.weeks[index];
              if (!week) return null;
              const marker = week.exceptionCount ? <Text style={[styles.marker, { color: theme.warning }]}>● {week.exceptionCount}</Text> : null;
              return index === 0 ? (
                <View style={styles.center}>
                  <Badge label={week.label} tone="brand" />
                  <Text style={[styles.count, { color: theme.textMuted }]}>{week.pharmacyCount} pharm.</Text>
                  {marker}
                </View>
              ) : (
                <View style={styles.center}>
                  <CellText muted>{week.label}</CellText>
                  {marker}
                </View>
              );
            }}
          />
        </Card>

        {city ? (
          <Card
            title={city.city}
            description={city.weeks[0] ? `${city.weeks[0].label} de garde, du ${formatDutyDate(city.weeks[0].start)} au ${formatDutyDate(city.weeks[0].end)}.` : undefined}
            actions={
              <View style={styles.cardActions}>
                <Select label="Ville" value={city.city} options={cities.map((entry) => ({ value: entry.city, label: entry.city }))} onChange={setSelected} style={styles.citySelect} />
                <Button label="Modifier la programmation" icon="tune" onPress={() => setEditor(editorFor(city.city, city.pharmacies, city))} />
              </View>
            }
            padded={false}
          >
            <View style={[styles.tabs, { borderBottomColor: theme.border }]}>
              <Segmented value={tab} onChange={(value) => setTab(value as typeof tab)} options={[{ value: "now", label: `De garde maintenant (${city.onDutyNow.length})` }, { value: "exceptions", label: `Exceptions (${city.exceptions.length})` }, { value: "settings", label: "Programmation" }]} />
            </View>
            {tab === "now" ? (
              <DataState empty={!city.onDutyNow.length} emptyTitle="Aucune pharmacie de garde" emptyMessage="Aucune pharmacie de l’annuaire n’est de garde cette semaine.">
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
            ) : null}
            {tab === "exceptions" ? (
              <View>
                <ExceptionForm key={city.city} city={city} />
                <DataState empty={!city.exceptions.length} emptyTitle="Aucune exception à venir">
                  <DataTable
                    columns={[
                      { key: "week", label: "Semaine", flex: 1 },
                      { key: "pharmacy", label: "Pharmacie", flex: 2 },
                      { key: "action", label: "Exception", flex: 1.2 },
                      { key: "note", label: "Motif", flex: 2 },
                      { key: "remove", label: "", width: 60, align: "right" },
                    ]}
                    rows={city.exceptions}
                    rowKey={(row) => String(row.id)}
                    minWidth={720}
                    renderCell={(row, key) => {
                      if (key === "week") return <CellText>Sam. {formatDutyDay(`${row.weekStart}T08:00:00Z`)}</CellText>;
                      if (key === "pharmacy") return <CellText strong>{row.pharmacyName}</CellText>;
                      if (key === "action") return <Badge label={row.action === "add" ? "Ajoutée à la garde" : "Retirée de la garde"} tone={row.action === "add" ? "success" : "danger"} />;
                      if (key === "note") return <CellText muted>{row.note ?? "—"}</CellText>;
                      return <IconButton icon="delete-outline" label="Supprimer l’exception" tone="danger" onPress={() => setRemoveId(row.id)} />;
                    }}
                  />
                </DataState>
              </View>
            ) : null}
            {tab === "settings" ? (
              <View style={[styles.settings, desktop && styles.settingsDesktop]}>
                <Setting label="Origine" value={city.source === "console" ? "Saisie dans la console" : "Programmation par défaut"} />
                <Setting label="Mode" value={city.mode === "lists" ? `Par listes (${city.turns.length})` : `Par groupes (${city.groupCount})`} />
                <Setting label="Semaine de référence" value={`Samedi ${formatDutyDay(`${city.referenceStart}T08:00:00Z`)} · ${city.turns[city.referenceTurn - 1]?.label ?? ""}`} />
                <Setting label="Ordre des tours" value={city.turns.map((turn) => turn.label).join(" → ")} />
              </View>
            ) : null}
          </Card>
        ) : null}
      </DataState>

      <RotationEditor state={editor} pharmacies={editorPharmacies} source={editorSource} onChange={setEditor} onClose={() => setEditor(null)} />
      <ConfirmDialog visible={removeId !== null} title="Supprimer l’exception" message="La garde de cette semaine reviendra à la programmation normale." confirmLabel="Supprimer" loading={removeException.isPending} onClose={() => setRemoveId(null)} onConfirm={() => removeId !== null && removeException.mutate({ id: removeId })} />
    </AdminPage>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  const theme = useAdminTheme();
  return (
    <View style={styles.setting}>
      <Text style={[styles.settingLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.settingValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  field: { gap: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  center: { alignItems: "center", gap: 2 },
  count: { fontSize: font.xs },
  marker: { fontSize: font.xs, fontWeight: "700" },
  citySelect: { minWidth: 220 },
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  cardActions: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  tabs: { padding: 16, borderBottomWidth: 1 },
  form: { padding: 16, gap: 12 },
  formActions: { flexDirection: "row", justifyContent: "flex-end" },
  settings: { padding: 20, gap: 16 },
  settingsDesktop: { flexDirection: "row", flexWrap: "wrap", columnGap: 32 },
  setting: { gap: 2, minWidth: 220 },
  settingLabel: { fontSize: font.xs },
  settingValue: { fontSize: font.md, fontWeight: "500" },
  listHeader: { padding: 16, gap: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" },
  listLabel: { width: 180 },
  listButtons: { flexDirection: "row", gap: 8 },
  assignRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  assignName: { fontSize: font.sm, fontWeight: "500" },
});
