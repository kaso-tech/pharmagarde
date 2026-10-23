import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { inferRouterOutputs } from "@trpc/server";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { MapErrorBoundary } from "@/components/pharmagarde/map-error-boundary";
import { getKnownCityCoordinates } from "@/lib/pharmagarde/city-utils";
import { HEALTHCARE_TYPES } from "@/lib/pharmagarde/healthcare-types";
import { MAP_ATTRIBUTION, MAP_FALLBACK_STYLE_URL, MAP_SATELLITE_STYLE_URL, MAP_STYLE_URL } from "@/lib/pharmagarde/map-config";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";
import { VERIFICATION_ISSUE_HINTS, VERIFICATION_ISSUE_LABELS, VERIFICATION_ISSUES, VERIFICATION_STATUS_LABELS, type VerificationIssue, type VerificationStatus } from "@/shared/place-verification";

import { useCanWrite } from "../access";
import { AUDIT_ACTIONS, useDebouncedValue } from "../shared";
import { AdminPage } from "../shell";
import { font, radius, useAdminLayout, useAdminTheme, type Tone } from "../theme";
import { Alert, Badge, Button, Card, Chip, DataState, Field, FieldLabel, Hint, IconButton, SearchInput, Segmented, Select, SelectField } from "../ui";
import VerificationMapView, { type MapReference } from "../verification-map-view";

const ISSUE_TONES: Record<VerificationIssue, Tone> = { reported: "danger", position_gap: "danger", duplicate: "warning", approximate: "warning", no_position: "danger", no_phone: "neutral" };
const ISSUE_ICONS: Record<VerificationIssue, keyof typeof MaterialIcons.glyphMap> = { reported: "flag", position_gap: "compare-arrows", duplicate: "content-copy", approximate: "not-listed-location", no_position: "location-off", no_phone: "phone-disabled" };
const STATUS_TONES: Record<VerificationStatus, Tone> = { todo: "neutral", needs_visit: "warning", verified: "success" };
const REFERENCE_COLORS = { published: "#667085", osm: "#1570EF", report: "#D92D20", neighbour: "#DC6803" };

type Position = { latitude: number; longitude: number };
type Draft = { name: string; phone: string; establishmentType: string; address: string; position: Position | null; positionConfirmed: boolean; note: string };

const isWeb = Platform.OS === "web";

function formatDistance(meters: number | null) {
  if (meters === null) return "—";
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

function samePosition(a: Position | null, b: Position | null) {
  return (!a && !b) || (!!a && !!b && Math.abs(a.latitude - b.latitude) < 1e-7 && Math.abs(a.longitude - b.longitude) < 1e-7);
}

/** Lien externe vers un point, pour comparer avec une autre carte ou une image satellite. */
function openExternal(kind: "osm" | "google", position: Position) {
  const { latitude, longitude } = position;
  const url = kind === "osm" ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=19/${latitude}/${longitude}` : `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  void Linking.openURL(url);
}

export function VerificationPage() {
  const theme = useAdminTheme();
  const { desktop, large } = useAdminLayout();
  const canWrite = useCanWrite("verification");
  const params = useLocalSearchParams<{ id?: string }>();
  const [status, setStatus] = useState<VerificationStatus | "all">("todo");
  const [issue, setIssue] = useState<VerificationIssue | "">("");
  const [kind, setKind] = useState<"all" | "pharmacy" | "healthcare">("all");
  const [city, setCity] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [chosenId, setSelectedId] = useState<string | null>(params.id ?? null);

  const queue = trpc.admin.verification.queue.useQuery({ status, issue: issue || undefined, kind, city: city || undefined, search: debouncedSearch || undefined }, { placeholderData: (previous) => previous });
  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  // Sur grand écran, la première fiche de la file s'ouvre d'office.
  const selectedId = chosenId ?? (desktop ? items[0]?.id ?? null : null);
  const index = items.findIndex((item) => item.id === selectedId);

  const total = queue.data?.total ?? 0;
  const verified = queue.data?.byStatus.verified ?? 0;
  const progress = total ? Math.round((verified / total) * 100) : 0;

  const goTo = (offset: number) => {
    if (!items.length) return;
    const next = items[(Math.max(index, 0) + offset + items.length) % items.length];
    if (next) setSelectedId(next.id);
  };
  /** Après une décision, fiche suivante de la file (la fiche traitée peut en sortir). */
  const advanceFrom = (id: string) => {
    const position = items.findIndex((item) => item.id === id);
    const next = items[position + 1] ?? items[position - 1];
    setSelectedId(next && next.id !== id ? next.id : null);
  };

  const filters = (
    <Card padded={false}>
      <View style={styles.filters}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Nom, téléphone, identifiant" />
        <Select label="État" value={status} onChange={(value) => setStatus(value as VerificationStatus | "all")} options={[{ value: "todo", label: `À vérifier (${queue.data?.byStatus.todo ?? 0})` }, { value: "needs_visit", label: `À vérifier sur place (${queue.data?.byStatus.needs_visit ?? 0})` }, { value: "verified", label: `Vérifiées (${verified})` }, { value: "all", label: `Toutes (${total})` }]} />
        <View style={styles.filterRow}>
          <Select label="Type" style={styles.flex} value={kind} options={[{ value: "all", label: "Pharmacies et structures" }, { value: "pharmacy", label: "Pharmacies" }, { value: "healthcare", label: "Structures de santé" }]} onChange={(value) => setKind(value as typeof kind)} />
          <Select label="Ville" style={styles.flex} value={city} options={[{ value: "", label: "Toutes les villes" }, ...(queue.data?.cities ?? []).map((name) => ({ value: name, label: name }))]} onChange={setCity} />
        </View>
        <View style={styles.chips}>
          {VERIFICATION_ISSUES.map((key) => (
            <Chip key={key} icon={ISSUE_ICONS[key]} label={`${VERIFICATION_ISSUE_LABELS[key]} (${queue.data?.byIssue[key] ?? 0})`} selected={issue === key} onPress={() => setIssue(issue === key ? "" : key)} />
          ))}
        </View>
      </View>
    </Card>
  );

  const list = (
    <Card padded={false} title={`${items.length} fiche${items.length > 1 ? "s" : ""}`} description="Les plus urgentes d’abord : signalements, écarts de position, doublons.">
      <DataState loading={queue.isLoading} error={queue.error} onRetry={() => queue.refetch()} empty={!items.length} emptyTitle="Rien à vérifier" emptyMessage="Aucune fiche ne correspond à ces filtres.">
        <ScrollView style={desktop ? styles.listScroll : undefined} nestedScrollEnabled>
          {items.map((item) => {
            const active = item.id === selectedId;
            return (
              <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setSelectedId(item.id)} style={[styles.listRow, { borderBottomColor: theme.border }, active && { backgroundColor: theme.brandSoft }]}>
                <View style={[styles.kindIcon, { backgroundColor: item.kind === "pharmacy" ? theme.brandSoft : theme.infoSoft }]}>
                  <MaterialIcons name={item.kind === "pharmacy" ? "local-pharmacy" : "local-hospital"} size={16} color={item.kind === "pharmacy" ? theme.brandText : theme.info} />
                </View>
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={[styles.listTitle, { color: theme.text }]}>{item.name}</Text>
                  <Text numberOfLines={1} style={[styles.listMeta, { color: theme.textMuted }]}>{item.city} · {item.establishmentType ?? "Pharmacie"}</Text>
                  <View style={styles.issueIcons}>
                    {item.issues.map((key) => <MaterialIcons key={key} name={ISSUE_ICONS[key]} size={14} color={ISSUE_TONES[key] === "danger" ? theme.danger : ISSUE_TONES[key] === "warning" ? theme.warning : theme.textMuted} accessibilityLabel={VERIFICATION_ISSUE_LABELS[key]} />)}
                    {item.status !== "todo" ? <Badge label={VERIFICATION_STATUS_LABELS[item.status]} tone={STATUS_TONES[item.status]} /> : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </DataState>
    </Card>
  );

  const detail = selectedId ? (
    <VerificationDetail
      key={selectedId}
      id={selectedId}
      position={index >= 0 ? `${index + 1} / ${items.length}` : null}
      canWrite={canWrite}
      onPrevious={() => goTo(-1)}
      onNext={() => goTo(1)}
      onOpen={setSelectedId}
      onDone={(id) => {
        advanceFrom(id);
        void queue.refetch();
      }}
      onClose={desktop ? undefined : () => setSelectedId(null)}
    />
  ) : (
    <Card>
      <Hint>Choisissez une fiche dans la file pour la vérifier.</Hint>
    </Card>
  );

  return (
    <AdminPage section="verification">
      <Card>
        <View style={styles.progressHeader}>
          <View style={styles.flex}>
            <Text style={[styles.progressValue, { color: theme.text }]}>{verified} / {total} fiches vérifiées</Text>
            <Text style={[styles.progressHint, { color: theme.textMuted }]}>{queue.data?.byStatus.needs_visit ?? 0} à vérifier sur place · {queue.data?.byStatus.todo ?? 0} à vérifier{isWeb && desktop ? " · Raccourcis : ← → fiche précédente / suivante, V valider, P passer" : ""}</Text>
          </View>
          <Text style={[styles.progressPercent, { color: theme.brandText }]}>{progress} %</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.surfaceMuted }]}>
          <View style={[styles.progressBar, { width: `${progress}%`, backgroundColor: theme.brand }]} />
        </View>
      </Card>
      {desktop ? (
        <View style={styles.columns}>
          <View style={[styles.sideColumn, large && styles.sideColumnLarge]}>
            {filters}
            {list}
          </View>
          <View style={styles.flex}>{detail}</View>
        </View>
      ) : selectedId ? (
        detail
      ) : (
        <>
          {filters}
          {list}
        </>
      )}
    </AdminPage>
  );
}

type DetailProps = { id: string; position: string | null; canWrite: boolean; onPrevious: () => void; onNext: () => void; onOpen: (id: string) => void; onDone: (id: string) => void; onClose?: () => void };
type DetailData = inferRouterOutputs<AppRouter>["admin"]["verification"]["detail"];

function initialDraft({ item, entry }: DetailData): Draft {
  return {
    name: item.name,
    phone: item.phone ?? "",
    establishmentType: item.establishmentType ?? "",
    address: item.address ?? "",
    position: item.latitude !== null && item.longitude !== null ? { latitude: item.latitude, longitude: item.longitude } : null,
    // Une position sans problème connu est réputée bonne ; sinon elle doit être contrôlée.
    positionConfirmed: !entry.issues.some((key) => key === "approximate" || key === "position_gap" || key === "duplicate" || key === "no_position"),
    note: entry.note ?? "",
  };
}

function VerificationDetail(props: DetailProps) {
  const detail = trpc.admin.verification.detail.useQuery({ id: props.id });
  if (!detail.data) {
    return (
      <Card>
        <DataState loading={detail.isLoading} error={detail.error} onRetry={() => detail.refetch()}>
          <View />
        </DataState>
      </Card>
    );
  }
  return <VerificationEditor {...props} data={detail.data} onRefresh={() => void detail.refetch()} />;
}

function VerificationEditor({ id, position, canWrite, onPrevious, onNext, onOpen, onDone, onClose, data, onRefresh }: DetailProps & { data: DetailData; onRefresh: () => void }) {
  const theme = useAdminTheme();
  // Carte et références côte à côte seulement sur très grand écran (la file occupe déjà 380 px).
  const { desktop, width } = useAdminLayout();
  const large = width >= 1680;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(data));
  const [satellite, setSatellite] = useState(false);
  const validate = trpc.admin.verification.validate.useMutation({ onSuccess: () => onDone(id) });
  const flag = trpc.admin.verification.flag.useMutation({ onSuccess: () => onDone(id) });
  const reopen = trpc.admin.verification.reopen.useMutation({ onSuccess: onRefresh });

  const pending = validate.isPending || flag.isPending;
  const submit = () => {
    if (pending || !canWrite) return;
    validate.mutate({
      id,
      name: draft.name,
      phone: draft.phone.trim() || null,
      establishmentType: data.item.kind === "healthcare" ? draft.establishmentType || null : null,
      address: draft.address.trim() || null,
      latitude: draft.position?.latitude ?? null,
      longitude: draft.position?.longitude ?? null,
      positionConfirmed: draft.positionConfirmed,
      note: draft.note,
    });
  };
  const sendToVisit = () => {
    if (pending || !canWrite) return;
    flag.mutate({ id, note: draft.note });
  };

  // Raccourcis clavier (web) : ← → pour naviguer, V pour valider, P pour passer.
  const shortcuts = useRef({ submit, onPrevious, onNext });
  useEffect(() => {
    shortcuts.current = { submit, onPrevious, onNext };
  });
  useEffect(() => {
    if (!isWeb || typeof window === "undefined") return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft") shortcuts.current.onPrevious();
      else if (event.key === "ArrowRight" || event.key.toLowerCase() === "p") shortcuts.current.onNext();
      else if (event.key.toLowerCase() === "v") shortcuts.current.submit();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const references = useMemo<(MapReference & { distance: number | null; source: string; position: Position })[]>(() => {
    const list: (MapReference & { distance: number | null; source: string; position: Position })[] = [];
    const { item } = data;
    if (item.latitude !== null && item.longitude !== null) list.push({ key: "published", label: "P", title: "Position publiée", color: REFERENCE_COLORS.published, latitude: item.latitude, longitude: item.longitude, distance: 0, source: item.approximateLocation ? "Position publiée (approximative)" : "Position publiée", position: { latitude: item.latitude, longitude: item.longitude } });
    data.osm.forEach((candidate, rank) => list.push({ key: `osm-${candidate.id}`, label: String.fromCharCode(65 + rank), title: `OpenStreetMap : ${candidate.name}`, color: REFERENCE_COLORS.osm, latitude: candidate.latitude, longitude: candidate.longitude, distance: candidate.distanceMeters, source: `OpenStreetMap · ${candidate.name} (${candidate.type}, nom ${Math.round(candidate.similarity * 100)} %)`, position: { latitude: candidate.latitude, longitude: candidate.longitude } }));
    data.reports.forEach((report, rank) => {
      if (report.latitude !== null && report.longitude !== null) list.push({ key: `report-${report.id}`, label: `S${rank + 1}`, title: "Position proposée par un utilisateur", color: REFERENCE_COLORS.report, latitude: report.latitude, longitude: report.longitude, distance: null, source: "Signalement d’un utilisateur", position: { latitude: report.latitude, longitude: report.longitude } });
    });
    data.neighbours.forEach((other, rank) => {
      if (other.latitude !== null && other.longitude !== null) list.push({ key: `near-${other.id}`, label: `${rank + 1}`, title: `Voisin : ${other.name}`, color: REFERENCE_COLORS.neighbour, latitude: other.latitude, longitude: other.longitude, distance: other.distanceMeters, source: `Voisin · ${other.name}`, position: { latitude: other.latitude, longitude: other.longitude } });
    });
    return list;
  }, [data]);

  const { item, entry } = data;
  const published = item.latitude !== null && item.longitude !== null ? { latitude: item.latitude, longitude: item.longitude } : null;
  const moved = !samePosition(draft.position, published);
  const mapReferences = references.filter((reference) => reference.key !== "published" || moved).map(({ key, label, title, color, latitude, longitude }) => ({ key, label, title, color, latitude, longitude }));
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const choosePosition = (value: Position) => setDraft((current) => ({ ...current, position: value, positionConfirmed: true }));
  const center = getKnownCityCoordinates(item.city);
  const styleUrl = satellite && MAP_SATELLITE_STYLE_URL ? MAP_SATELLITE_STYLE_URL : MAP_STYLE_URL;
  const cannotValidate = !canWrite || pending || draft.name.trim().length < 2 || (item.kind === "pharmacy" && !draft.position);

  return (
    <Card
      title={item.name}
      description={`${item.city} · ${item.kind === "pharmacy" ? "Pharmacie" : item.establishmentType ?? "Structure de santé"} · ${item.id}`}
      actions={
        <View style={styles.headerActions}>
          {onClose ? <IconButton icon="list" label="Revenir à la file" onPress={onClose} /> : null}
          <IconButton icon="chevron-left" label="Fiche précédente" onPress={onPrevious} />
          {position ? <Text style={[styles.counter, { color: theme.textMuted }]}>{position}</Text> : null}
          <IconButton icon="chevron-right" label="Fiche suivante" onPress={onNext} />
        </View>
      }
      footer={
        canWrite ? (
          <View style={styles.footer}>
            {entry.status !== "todo" ? <Button label="Rouvrir" icon="undo" loading={reopen.isPending} onPress={() => reopen.mutate({ id })} /> : null}
            <View style={styles.flex} />
            <Button label="Passer" icon="skip-next" onPress={onNext} disabled={pending} />
            <Button label="À vérifier sur place" icon="directions-walk" loading={flag.isPending} disabled={pending} onPress={sendToVisit} />
            <Button label={moved || draft.phone !== (item.phone ?? "") ? "Enregistrer et valider" : "Valider"} icon="verified" variant="primary" loading={validate.isPending} disabled={cannotValidate} onPress={submit} />
          </View>
        ) : undefined
      }
    >
      <View style={styles.detailBody}>
        {validate.error ? <Alert tone="danger">{validate.error.message}</Alert> : null}
        {flag.error ? <Alert tone="danger">{flag.error.message}</Alert> : null}
        <View style={styles.badges}>
          <Badge label={VERIFICATION_STATUS_LABELS[entry.status]} tone={STATUS_TONES[entry.status]} dot />
          {entry.issues.map((key) => <Badge key={key} label={VERIFICATION_ISSUE_LABELS[key]} tone={ISSUE_TONES[key]} icon={ISSUE_ICONS[key]} />)}
        </View>
        {entry.issues.length ? <Hint>{entry.issues.map((key) => VERIFICATION_ISSUE_HINTS[key]).join(" ")}</Hint> : null}
        {entry.checkedAt ? <Hint>{`${VERIFICATION_STATUS_LABELS[entry.status]} le ${new Date(entry.checkedAt).toLocaleString("fr-FR")}${data.checkedByName ? ` par ${data.checkedByName}` : ""}${entry.note ? ` — « ${entry.note} »` : ""}`}</Hint> : null}

        <View style={[styles.split, large && styles.splitLarge]}>
          <View style={[styles.mapColumn, large && styles.flex]}>
            <View style={[styles.mapFrame, { borderColor: theme.border }]}>
              <MapErrorBoundary fallback={<View style={styles.mapFallback}><Hint>La carte ne peut pas s’afficher. Saisissez les coordonnées.</Hint></View>}>
                <VerificationMapView
                  key={item.id}
                  value={draft.position}
                  references={mapReferences}
                  center={center}
                  styleUrl={styleUrl}
                  fallbackStyleUrl={MAP_FALLBACK_STYLE_URL}
                  attribution={MAP_ATTRIBUTION}
                  color={theme.brand}
                  onPick={(latitude, longitude) => choosePosition({ latitude, longitude })}
                  dom={{ style: StyleSheet.absoluteFill, scrollEnabled: false, useExpoDOMWebView: false }}
                />
              </MapErrorBoundary>
            </View>
            <View style={styles.mapToolbar}>
              <MaterialIcons name="place" size={16} color={draft.position ? theme.brand : theme.textMuted} />
              <Text style={[styles.coordinates, { color: theme.text }]}>{draft.position ? `${draft.position.latitude.toFixed(6)}, ${draft.position.longitude.toFixed(6)}` : "Aucune position : cliquez sur la carte"}</Text>
              {moved && published ? <Text style={[styles.movedText, { color: theme.warning }]}>déplacée de {formatDistance(Math.round(distanceMeters(published, draft.position!)))}</Text> : null}
              <View style={styles.flex} />
              {MAP_SATELLITE_STYLE_URL ? <Segmented value={satellite ? "satellite" : "plan"} onChange={(value) => setSatellite(value === "satellite")} options={[{ value: "plan", label: "Plan" }, { value: "satellite", label: "Satellite" }]} /> : null}
              {draft.position ? <Button size="sm" label="OpenStreetMap" icon="open-in-new" onPress={() => openExternal("osm", draft.position!)} /> : null}
              {draft.position ? <Button size="sm" label="Google Maps" icon="open-in-new" onPress={() => openExternal("google", draft.position!)} /> : null}
            </View>
            <Hint>{`Cliquez sur la carte ou déplacez le repère vert pour corriger la position. Les pastilles sont les positions de référence listées ${large ? "à côté" : "ci-dessous"}.`}</Hint>
          </View>

          <View style={[styles.sideDetail, large && styles.sideDetailLarge]}>
            <FieldLabel>Positions de référence</FieldLabel>
            {references.length ? (
              references.map((reference) => {
                const current = samePosition(draft.position, reference.position);
                return (
                  <View key={reference.key} style={[styles.reference, { borderColor: current ? theme.brand : theme.border, backgroundColor: current ? theme.brandSoft : theme.surface }]}>
                    <View style={[styles.referenceDot, { backgroundColor: reference.color }]}><Text style={styles.referenceLabel}>{reference.label}</Text></View>
                    <View style={styles.flex}>
                      <Text numberOfLines={2} style={[styles.referenceTitle, { color: theme.text }]}>{reference.source}</Text>
                      <Text style={[styles.referenceMeta, { color: theme.textMuted }]}>{reference.key === "published" ? "point actuel de l’application" : `à ${formatDistance(reference.distance ?? (published ? Math.round(distanceMeters(published, reference.position)) : null))} du point publié`}</Text>
                    </View>
                    {canWrite && !current && !reference.key.startsWith("near-") ? <Button size="sm" label="Utiliser" onPress={() => choosePosition(reference.position)} /> : null}
                    {reference.key.startsWith("near-") ? <Button size="sm" label="Ouvrir" onPress={() => onOpen(reference.key.slice(5))} /> : null}
                  </View>
                );
              })
            ) : (
              <Hint>Aucune autre source pour cet établissement.</Hint>
            )}
            {data.samePhone.length ? <Alert tone="warning" icon="content-copy" title="Même numéro">{data.samePhone.map((other) => other.name).join(", ")}</Alert> : null}
            <Chip label="J’ai contrôlé la position (carte, image ou visite)" selected={draft.positionConfirmed} onPress={() => update("positionConfirmed", !draft.positionConfirmed)} />
            {entry.approximate ? <Hint tone="warning">Une fois la position contrôlée et validée, la mention « position approximative » disparaît de l’application.</Hint> : null}
          </View>
        </View>

        <View style={[styles.fields, desktop && styles.fieldsLarge]}>
          <Field style={styles.flex} label="Nom" value={draft.name} onChangeText={(value) => update("name", value)} editable={canWrite} />
          <Field style={styles.flex} label="Téléphone" value={draft.phone} onChangeText={(value) => update("phone", value)} placeholder="Ex. 70 12 34 56" keyboardType="phone-pad" editable={canWrite} />
          {item.kind === "healthcare" ? <SelectField style={styles.flex} label="Type" value={draft.establishmentType} options={HEALTHCARE_TYPES.map((type) => ({ value: type, label: type }))} onChange={(value) => update("establishmentType", value)} /> : null}
        </View>
        <View style={[styles.fields, desktop && styles.fieldsLarge]}>
          <Field style={styles.flex} label="Adresse / repère" value={draft.address} onChangeText={(value) => update("address", value)} placeholder="Quartier, repère…" editable={canWrite} />
          <Field style={styles.flex} label="Note de vérification" value={draft.note} onChangeText={(value) => update("note", value)} placeholder="Ex. appelé le 24/10, position confirmée par le gérant" editable={canWrite} />
        </View>

        {data.reports.length ? (
          <View style={styles.section}>
            <FieldLabel>Signalements en attente</FieldLabel>
            {data.reports.map((report) => (
              <View key={report.id} style={[styles.report, { borderColor: theme.border }]}>
                <Text style={[styles.referenceTitle, { color: theme.text }]}>{report.subject ?? report.category ?? "Signalement"}</Text>
                {report.message ? <Text style={[styles.referenceMeta, { color: theme.textSecondary }]}>{report.message}</Text> : null}
                <Text style={[styles.referenceMeta, { color: theme.textMuted }]}>{new Date(report.createdAt).toLocaleString("fr-FR")}{report.phone ? ` · numéro proposé : ${report.phone}` : ""}</Text>
              </View>
            ))}
            <Hint>Les signalements se clôturent dans la page Contributions.</Hint>
          </View>
        ) : null}

        {data.history.length ? (
          <View style={styles.section}>
            <FieldLabel>Historique</FieldLabel>
            {data.history.map((row) => (
              <Text key={row.id} style={[styles.referenceMeta, { color: theme.textMuted }]}>
                {new Date(row.createdAt).toLocaleString("fr-FR")} · {AUDIT_ACTIONS[row.action] ?? row.action}{row.actorName ? ` · ${row.actorName}` : ""}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function distanceMeters(a: Position, b: Position) {
  const rad = Math.PI / 180;
  const x = (b.longitude - a.longitude) * rad * Math.cos(((a.latitude + b.latitude) / 2) * rad);
  const y = (b.latitude - a.latitude) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  progressHeader: { flexDirection: "row", alignItems: "flex-end", gap: 16 },
  progressValue: { fontSize: 18, fontWeight: "700" },
  progressHint: { fontSize: font.sm, marginTop: 4 },
  progressPercent: { fontSize: 28, fontWeight: "800" },
  progressTrack: { height: 8, borderRadius: 4, marginTop: 14, overflow: "hidden" },
  progressBar: { height: 8, borderRadius: 4 },
  columns: { flexDirection: "row", gap: 20, alignItems: "flex-start" },
  sideColumn: { width: 340, gap: 16 },
  sideColumnLarge: { width: 380 },
  filters: { padding: 14, gap: 10 },
  filterRow: { flexDirection: "row", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  listScroll: { maxHeight: 720 },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  kindIcon: { width: 30, height: 30, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: 2 },
  listTitle: { fontSize: font.md, fontWeight: "600" },
  listMeta: { fontSize: font.xs, marginTop: 2 },
  issueIcons: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 6 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  counter: { fontSize: font.sm, minWidth: 64, textAlign: "center" },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  detailBody: { gap: 14 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  split: { gap: 16 },
  splitLarge: { flexDirection: "row", alignItems: "flex-start" },
  mapColumn: { gap: 8 },
  mapFrame: { height: 440, borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  mapFallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  mapToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  coordinates: { fontSize: font.sm, fontWeight: "600" },
  movedText: { fontSize: font.sm, fontWeight: "600" },
  sideDetail: { gap: 8 },
  sideDetailLarge: { width: 340 },
  reference: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 10 },
  referenceDot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  referenceLabel: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  referenceTitle: { fontSize: font.sm, fontWeight: "600" },
  referenceMeta: { fontSize: font.xs, marginTop: 2, lineHeight: 17 },
  fields: { gap: 12 },
  fieldsLarge: { flexDirection: "row" },
  section: { gap: 8 },
  report: { borderWidth: 1, borderRadius: radius.md, padding: 10 },
});
