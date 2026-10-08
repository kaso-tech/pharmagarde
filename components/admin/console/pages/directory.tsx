import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { LocationPicker } from "@/components/pharmagarde/location-picker";
import { WeeklyHoursEditor, cloneHours } from "@/components/pharmagarde/weekly-hours-editor";
import { getKnownCityCoordinates } from "@/lib/pharmagarde/city-utils";
import { INSURERS, formatInsurers, isInsurerId, normalizeInsurerIds, type InsurerId } from "@/lib/pharmagarde/insurances";
import { DEFAULT_WEEKLY_HOURS, formatWeeklyHours, validateWeeklyHours, type WeeklyHours } from "@/lib/pharmagarde/opening-hours";
import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";

import { AdminPage } from "../shell";
import { PAGE_SIZE, numberOrNull, useDebouncedValue, usePage } from "../shared";
import { font, radius, useAdminLayout, useAdminTheme } from "../theme";
import { Alert, Badge, Button, Card, CellStack, CellText, Chip, ConfirmDialog, DataState, DataTable, Dialog, Field, FieldLabel, Hint, IconButton, Pagination, SearchInput, Segmented, Select, Toolbar, isHovered, type Column } from "../ui";

type DirectoryKind = "pharmacy" | "healthcare";
type DutyGroupFilter = "all" | "none" | "1" | "2" | "3" | "4";

type DirectoryForm = {
  id?: string;
  kind: DirectoryKind;
  name: string;
  city: string;
  phone: string;
  address: string;
  latitude: string;
  longitude: string;
  dutyGroup: string;
  establishmentType: string;
  /** « city » : horaires de la ville ; « custom » : horaires propres à l'établissement. */
  hoursMode: "city" | "custom";
  openingHours: WeeklyHours;
  /** Assurances acceptées (identifiants de lib/pharmagarde/insurances.ts). */
  insurances: InsurerId[];
};

const OTHER_CITY = "__autre__";

const EMPTY_FORM: DirectoryForm = {
  kind: "pharmacy",
  name: "",
  city: "Ouagadougou",
  phone: "",
  address: "",
  latitude: "",
  longitude: "",
  dutyGroup: "",
  establishmentType: "Centre de santé",
  hoursMode: "city",
  openingHours: DEFAULT_WEEKLY_HOURS,
  insurances: [],
};

const DUTY_GROUP_OPTIONS = [
  { value: "", label: "Aucun" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
] as const;

const DUTY_GROUP_FILTERS: readonly { value: DutyGroupFilter; label: string }[] = [
  { value: "all", label: "Tous les groupes" },
  { value: "1", label: "Groupe 1" },
  { value: "2", label: "Groupe 2" },
  { value: "3", label: "Groupe 3" },
  { value: "4", label: "Groupe 4" },
  { value: "none", label: "Sans groupe" },
];

const KIND_OPTIONS = [
  { value: "all", label: "Tous" },
  { value: "pharmacy", label: "Pharmacies" },
  { value: "healthcare", label: "Structures de santé" },
];

const COLUMNS: readonly Column[] = [
  { key: "name", label: "Établissement", flex: 2.6 },
  { key: "city", label: "Ville", flex: 1.1 },
  { key: "group", label: "Garde / type", flex: 1.1 },
  { key: "phone", label: "Téléphone", flex: 1.3 },
  { key: "insurances", label: "Assurances", flex: 1.3 },
  { key: "source", label: "Source", width: 112 },
  { key: "actions", label: "", width: 92, align: "right" },
];

function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  return (
    <View style={[styles.formSection, desktop && styles.formSectionDesktop, { borderBottomColor: theme.border }]}>
      <View style={desktop ? styles.formSectionAside : undefined}>
        <Text style={[styles.formSectionTitle, { color: theme.text }]}>{title}</Text>
        {description ? <Text style={[styles.formSectionText, { color: theme.textMuted }]}>{description}</Text> : null}
      </View>
      <View style={[styles.flex, styles.formSectionBody]}>{children}</View>
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  const { desktop } = useAdminLayout();
  return <View style={desktop ? styles.fieldRow : styles.fieldColumn}>{children}</View>;
}

function DirectoryFormFields({ form, cityNames, cityHoursFor, onChange }: { form: DirectoryForm; cityNames: readonly string[]; cityHoursFor: (city: string) => WeeklyHours; onChange: <K extends keyof DirectoryForm>(key: K, value: DirectoryForm[K]) => void }) {
  const [otherCity, setOtherCity] = useState(false);
  const showOtherCity = otherCity || (!!form.city && !cityNames.includes(form.city));
  const cityOptions = [...cityNames.map((name) => ({ value: name, label: name })), { value: OTHER_CITY, label: "Autre ville…" }];
  const cityHours = cityHoursFor(form.city);
  const latitude = numberOrNull(form.latitude);
  const longitude = numberOrNull(form.longitude);
  const location = latitude !== null && longitude !== null ? { latitude, longitude } : null;
  const required = form.kind === "pharmacy" ? " *" : "";
  return (
    <View>
      <FormSection title="Informations" description="Nom et coordonnées affichés dans l’application.">
        <Segmented value={form.kind} onChange={(value) => onChange("kind", value as DirectoryKind)} options={[{ value: "pharmacy", label: "Pharmacie" }, { value: "healthcare", label: "Structure de santé" }]} />
        <Row>
          <Field style={styles.flex} label="Nom *" value={form.name} onChangeText={(value) => onChange("name", value)} placeholder={form.kind === "pharmacy" ? "Ex. Pharmacie Wend-Panga" : "Ex. CSPS de Tanghin"} />
          {form.kind === "healthcare" ? <Field style={styles.flex} label="Type d’établissement" value={form.establishmentType} onChangeText={(value) => onChange("establishmentType", value)} placeholder="CSPS, CMA, Clinique…" /> : null}
        </Row>
        <Row>
          <View style={[styles.flex, styles.field]}>
            <FieldLabel>Ville *</FieldLabel>
            <Select
              label="Ville"
              value={showOtherCity ? OTHER_CITY : form.city}
              options={cityOptions}
              onChange={(value) => {
                setOtherCity(value === OTHER_CITY);
                onChange("city", value === OTHER_CITY ? "" : value);
              }}
            />
          </View>
          <Field style={styles.flex} label="Téléphone" value={form.phone} onChangeText={(value) => onChange("phone", value)} placeholder="+226 70 00 00 00" keyboardType="phone-pad" />
        </Row>
        {showOtherCity ? <Field label="Nom de la nouvelle ville" value={form.city} onChangeText={(value) => onChange("city", value)} placeholder="Ex. Koudougou" /> : null}
        <Field label="Adresse" value={form.address} onChangeText={(value) => onChange("address", value)} placeholder="Quartier, repère…" multiline />
      </FormSection>

      <FormSection title="Emplacement" description={form.kind === "pharmacy" ? "Obligatoire pour une pharmacie, pour l’afficher sur la carte." : "Facultatif."}>
        <LocationPicker
          value={location}
          center={getKnownCityCoordinates(form.city)}
          height={260}
          onChange={(picked) => {
            onChange("latitude", picked ? String(picked.latitude) : "");
            onChange("longitude", picked ? String(picked.longitude) : "");
          }}
        />
        <Row>
          <Field style={styles.flex} label={`Latitude${required}`} value={form.latitude} onChangeText={(value) => onChange("latitude", value)} keyboardType="numeric" />
          <Field style={styles.flex} label={`Longitude${required}`} value={form.longitude} onChangeText={(value) => onChange("longitude", value)} keyboardType="numeric" />
        </Row>
      </FormSection>

      <FormSection title={form.kind === "pharmacy" ? "Garde et assurances" : "Assurances"} description="Assurances acceptées par l’établissement.">
        {form.kind === "pharmacy" ? (
          <View style={styles.field}>
            <FieldLabel>Groupe de garde</FieldLabel>
            <Segmented value={form.dutyGroup} onChange={(value) => onChange("dutyGroup", value)} options={DUTY_GROUP_OPTIONS} />
            <Hint>En garde, la pharmacie est ouverte 24 h/24.</Hint>
          </View>
        ) : null}
        <View style={styles.field}>
          <FieldLabel>Assurances acceptées</FieldLabel>
          <View style={styles.chips}>
            {INSURERS.map((insurer) => {
              const selected = form.insurances.includes(insurer.id);
              return <Chip key={insurer.id} label={insurer.label} selected={selected} onPress={() => onChange("insurances", selected ? form.insurances.filter((id) => id !== insurer.id) : [...form.insurances, insurer.id])} />;
            })}
          </View>
          <Hint>{form.insurances.length ? `${form.insurances.length} sélectionnée${form.insurances.length > 1 ? "s" : ""} : ${formatInsurers(form.insurances)}` : "Aucune assurance renseignée."}</Hint>
        </View>
      </FormSection>

      <FormSection title="Horaires de service" description="Par défaut, ceux de la ville (fixés par l’ONPBF).">
        <Segmented
          value={form.hoursMode}
          onChange={(value) => {
            onChange("hoursMode", value as DirectoryForm["hoursMode"]);
            if (value === "custom" && form.hoursMode === "city") onChange("openingHours", cloneHours(cityHours));
          }}
          options={[{ value: "city", label: "Horaires de la ville" }, { value: "custom", label: "Horaires propres" }]}
        />
        {form.hoursMode === "city" ? <Hint>{form.city ? `${form.city} : ` : ""}{formatWeeklyHours(cityHours)}</Hint> : <WeeklyHoursEditor value={form.openingHours} onChange={(value) => onChange("openingHours", value)} />}
      </FormSection>
    </View>
  );
}

export function DirectoryPage() {
  const utils = trpc.useUtils();
  const theme = useAdminTheme();
  const { desktop, large } = useAdminLayout();
  const [kind, setKind] = useState<"all" | DirectoryKind>("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [city, setCity] = useState("");
  const [dutyGroup, setDutyGroup] = useState<DutyGroupFilter>("all");
  const [insurance, setInsurance] = useState("");
  const [form, setForm] = useState<DirectoryForm>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; kind: DirectoryKind; name: string } | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim());
  const effectiveGroup = kind === "healthcare" ? "all" : dutyGroup;
  const [page, setPage] = usePage([kind, debouncedSearch, status, city, effectiveGroup, insurance].join("|"));
  const directory = trpc.admin.directory.list.useQuery(
    { kind, search: debouncedSearch || undefined, status, city: city || undefined, dutyGroup: effectiveGroup, insurance: isInsurerId(insurance) ? insurance : undefined, page, limit: PAGE_SIZE },
    { retry: 1, placeholderData: (previous) => previous },
  );
  const hours = trpc.admin.hours.cities.useQuery(undefined, { retry: 1 });
  const refresh = () => Promise.all([utils.admin.directory.list.invalidate(), utils.admin.dashboard.invalidate()]);
  const upsert = trpc.admin.directory.upsert.useMutation({
    onSuccess: async () => {
      haptic.success();
      setForm(EMPTY_FORM);
      setShowForm(false);
      await refresh();
    },
  });
  const archive = trpc.admin.directory.archive.useMutation({
    onSuccess: async () => {
      haptic.success();
      setArchiveTarget(null);
      await refresh();
    },
  });
  const restore = trpc.admin.directory.restore.useMutation({ onSuccess: refresh });

  type DirectoryItem = NonNullable<typeof directory.data>["items"][number];

  const updateField = <K extends keyof DirectoryForm>(key: K, value: DirectoryForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const closeForm = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
    upsert.reset();
  };
  const openNew = () => {
    upsert.reset();
    setForm(EMPTY_FORM);
    setShowForm(true);
  };
  const openEdit = (item: DirectoryItem) => {
    upsert.reset();
    setForm({ id: item.id, kind: item.kind, name: item.name, city: item.city, phone: item.phone ?? "", address: item.address ?? "", latitude: item.latitude?.toString() ?? "", longitude: item.longitude?.toString() ?? "", dutyGroup: item.dutyGroup?.toString() ?? "", establishmentType: item.establishmentType ?? "Centre de santé", hoursMode: item.openingHours ? "custom" : "city", openingHours: item.openingHours ?? DEFAULT_WEEKLY_HOURS, insurances: normalizeInsurerIds(item.insurances) });
    setShowForm(true);
  };
  const submit = () => {
    upsert.mutate({
      id: form.id,
      kind: form.kind,
      name: form.name,
      city: form.city,
      phone: form.phone || null,
      address: form.address || null,
      latitude: numberOrNull(form.latitude),
      longitude: numberOrNull(form.longitude),
      dutyGroup: form.kind === "pharmacy" && form.dutyGroup ? Number(form.dutyGroup) : null,
      establishmentType: form.kind === "healthcare" ? form.establishmentType || null : null,
      openingHours: form.hoursMode === "custom" ? form.openingHours : null,
      insurances: form.insurances,
    });
  };

  const cityHoursFor = (name: string) => hours.data?.find((entry) => entry.city.localeCompare(name, "fr", { sensitivity: "base" }) === 0)?.hours ?? DEFAULT_WEEKLY_HOURS;
  const cities = directory.data?.cities ?? [];
  const rows = directory.data?.items ?? [];
  const total = directory.data?.total ?? 0;
  const archivedView = status === "archived";
  const groupLabel = (item: DirectoryItem) => (item.kind === "pharmacy" ? (item.dutyGroup ? `Groupe ${item.dutyGroup}` : "Sans groupe") : item.establishmentType ?? "Établissement");
  const missingCoordinates = form.kind === "pharmacy" && (numberOrNull(form.latitude) === null || numberOrNull(form.longitude) === null);
  const invalidHours = form.hoursMode === "custom" && !!validateWeeklyHours(form.openingHours);
  const cannotSave = !form.name.trim() || !form.city.trim() || missingCoordinates || invalidHours;
  const kindIcon = (item: DirectoryItem) => (
    <View style={[styles.kindIcon, { backgroundColor: item.kind === "pharmacy" ? theme.brandSoft : theme.infoSoft }]}>
      <MaterialIcons name={item.kind === "pharmacy" ? "local-pharmacy" : "local-hospital"} size={16} color={item.kind === "pharmacy" ? theme.brandText : theme.info} />
    </View>
  );
  const sourceBadge = (item: DirectoryItem) => (item.status === "archived" ? <Badge label="Archivé" tone="danger" /> : <Badge label={item.managed ? "Administré" : "Annuaire"} tone={item.managed ? "brand" : "neutral"} />);
  const actions = (item: DirectoryItem) =>
    archivedView ? (
      <IconButton icon="unarchive" label={`Restaurer ${item.name}`} tone="brand" disabled={restore.isPending} onPress={() => restore.mutate({ id: item.id })} />
    ) : (
      <View style={styles.actions}>
        <IconButton icon="edit" label={`Modifier ${item.name}`} onPress={() => openEdit(item)} />
        <IconButton icon="archive" label={`Archiver ${item.name}`} tone="danger" onPress={() => setArchiveTarget({ id: item.id, kind: item.kind, name: item.name })} />
      </View>
    );

  return (
    <AdminPage section="directory" actions={<Button label="Ajouter un établissement" icon="add" variant="primary" onPress={openNew} />}>
      {restore.error ? <Alert tone="danger">{restore.error.message}</Alert> : null}
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Rechercher un nom, une ville, un téléphone" style={desktop ? styles.search : undefined} />
          <Segmented value={kind} onChange={(value) => setKind(value as "all" | DirectoryKind)} options={KIND_OPTIONS} />
          <Select label="Ville" style={desktop ? styles.filter : undefined} value={city} options={[{ value: "", label: "Toutes les villes" }, ...cities.filter((entry) => entry.count > 0).map((entry) => ({ value: entry.name, label: `${entry.name} (${entry.count})` }))]} onChange={setCity} />
          {kind !== "healthcare" ? <Select label="Groupe de garde" style={desktop ? styles.filter : undefined} value={dutyGroup} options={DUTY_GROUP_FILTERS} onChange={(value) => setDutyGroup(value as DutyGroupFilter)} /> : null}
          <Select label="Assurance" style={desktop ? styles.filter : undefined} value={insurance} options={[{ value: "", label: "Toutes les assurances" }, ...INSURERS.map((insurer) => ({ value: insurer.id, label: insurer.label }))]} onChange={setInsurance} />
          <Segmented value={status} onChange={(value) => setStatus(value as "active" | "archived")} options={[{ value: "active", label: "Publiées" }, { value: "archived", label: "Archivées" }]} />
        </Toolbar>
        <DataState loading={directory.isLoading} error={directory.error} onRetry={() => directory.refetch()} empty={!rows.length} emptyTitle="Aucun établissement" emptyMessage="Aucun établissement ne correspond à ces filtres.">
          {desktop ? (
            <DataTable
              columns={large ? COLUMNS : COLUMNS.filter((column) => column.key !== "insurances")}
              minWidth={760}
              rows={rows}
              rowKey={(item) => item.id}
              onRowPress={archivedView ? undefined : openEdit}
              renderCell={(item, key) => {
                switch (key) {
                  case "name":
                    return <CellStack leading={kindIcon(item)} title={item.name} subtitle={item.address} />;
                  case "city":
                    return <CellText>{item.city}</CellText>;
                  case "group":
                    return item.kind === "pharmacy" && item.dutyGroup ? <Badge label={groupLabel(item)} tone="brand" /> : <CellText muted>{groupLabel(item)}</CellText>;
                  case "phone":
                    return <CellText mono>{item.phone ?? "—"}</CellText>;
                  case "insurances":
                    return <CellText muted={!item.insurances?.length}>{item.insurances?.length ? formatInsurers(item.insurances) : "—"}</CellText>;
                  case "source":
                    return sourceBadge(item);
                  case "actions":
                    return actions(item);
                  default:
                    return null;
                }
              }}
            />
          ) : (
            rows.map((item, index) => (
              <Pressable key={item.id} accessibilityRole="button" disabled={archivedView} onPress={() => openEdit(item)} style={(state) => [styles.mobileRow, index < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }, isHovered(state) && { backgroundColor: theme.surfaceHover }]}>
                {kindIcon(item)}
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={[styles.mobileTitle, { color: theme.text }]}>{item.name}</Text>
                  <Text numberOfLines={1} style={[styles.mobileMeta, { color: theme.textMuted }]}>{item.city} · {groupLabel(item)}{item.phone ? ` · ${item.phone}` : ""}</Text>
                </View>
                {actions(item)}
              </Pressable>
            ))
          )}
          <View style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
            <Pagination page={page} limit={PAGE_SIZE} total={total} onChange={setPage} />
          </View>
        </DataState>
      </Card>

      <Dialog
        visible={showForm}
        title={form.id ? "Modifier l’établissement" : "Nouvel établissement"}
        description={form.id ? form.name : "Ajouté à l’annuaire publié dans l’application."}
        onClose={closeForm}
        width={920}
        footer={
          <>
            {missingCoordinates ? <Text style={[styles.footerHint, { color: theme.textMuted }]}>Placez la pharmacie sur la carte pour l’enregistrer.</Text> : null}
            <Button label="Annuler" onPress={closeForm} disabled={upsert.isPending} />
            <Button label="Enregistrer" variant="primary" icon="check" loading={upsert.isPending} disabled={cannotSave} onPress={submit} />
          </>
        }
      >
        {upsert.error ? <Alert tone="danger">{upsert.error.message}</Alert> : null}
        <DirectoryFormFields key={form.id ?? "nouveau"} form={form} cityNames={cities.map((entry) => entry.name)} cityHoursFor={cityHoursFor} onChange={updateField} />
      </Dialog>

      <ConfirmDialog
        visible={!!archiveTarget}
        title="Archiver l’établissement"
        message={`« ${archiveTarget?.name ?? ""} » ne sera plus publié dans l’annuaire. Vous pourrez le restaurer depuis l’onglet Archivées. Cette action sera journalisée.`}
        confirmLabel="Archiver"
        loading={archive.isPending}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => archiveTarget && archive.mutate({ id: archiveTarget.id, kind: archiveTarget.kind, confirmArchive: true })}
      />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  field: { gap: 6 },
  search: { flexGrow: 1, flexBasis: 280, minWidth: 240 },
  filter: { minWidth: 180 },
  actions: { flexDirection: "row", gap: 6 },
  kindIcon: { width: 32, height: 32, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  mobileRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  mobileTitle: { fontSize: font.md, fontWeight: "600" },
  mobileMeta: { fontSize: font.xs, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  fieldRow: { flexDirection: "row", gap: 16 },
  fieldColumn: { gap: 16 },
  formSection: { gap: 14, paddingBottom: 22, marginBottom: 22, borderBottomWidth: 1 },
  formSectionDesktop: { flexDirection: "row", gap: 28 },
  formSectionAside: { width: 200 },
  formSectionTitle: { fontSize: font.md, fontWeight: "600" },
  formSectionText: { fontSize: font.sm, lineHeight: 19, marginTop: 4 },
  formSectionBody: { gap: 14 },
  footerHint: { flex: 1, fontSize: font.sm, alignSelf: "center" },
});
