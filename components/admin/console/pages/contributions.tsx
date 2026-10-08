import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { DEFAULT_WEEKLY_HOURS, parseWeeklyHours } from "@/lib/pharmagarde/opening-hours";
import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

import { AdminPage } from "../shell";
import { PAGE_SIZE, displayIdentity, formatDate, formatRelative, usePage } from "../shared";
import { font, useAdminLayout, useAdminTheme, type Tone } from "../theme";
import { Alert, Badge, Button, Card, CellStack, CellText, DataState, DataTable, Dialog, Field, Pagination, Segmented, Toolbar, type Column } from "../ui";
import { DirectoryFormFields, EMPTY_FORM, formState, toUpsertInput, useCityHoursLookup, type DirectoryForm } from "./directory";

type Kind = "new_place" | "problem";
type StatusFilter = "new" | "accepted" | "rejected" | "resolved" | "all";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: "À traiter", tone: "warning" },
  accepted: { label: "Publiée", tone: "success" },
  resolved: { label: "Résolu", tone: "success" },
  rejected: { label: "Refusée", tone: "neutral" },
};

const PLACE_COLUMNS: readonly Column[] = [
  { key: "name", label: "Établissement proposé", flex: 2.4 },
  { key: "city", label: "Ville", flex: 1 },
  { key: "type", label: "Type", flex: 1 },
  { key: "author", label: "Proposé par", flex: 1.3 },
  { key: "date", label: "Reçu", flex: 1 },
  { key: "status", label: "Statut", width: 120 },
  { key: "actions", label: "", width: 120, align: "right" },
];

const PROBLEM_COLUMNS: readonly Column[] = [
  { key: "subject", label: "Signalement", flex: 2.6 },
  { key: "category", label: "Catégorie", flex: 1.2 },
  { key: "place", label: "Établissement", flex: 1.5 },
  { key: "author", label: "Auteur", flex: 1.2 },
  { key: "date", label: "Reçu", flex: 1 },
  { key: "status", label: "Statut", width: 120 },
  { key: "actions", label: "", width: 120, align: "right" },
];

type Contribution = inferRouterOutputs<AppRouter>["admin"]["contributions"]["list"]["items"][number];

function author(item: Contribution) {
  return item.userId ? displayIdentity({ name: item.authorName, phone: item.authorPhone, id: item.userId }) : "Anonyme";
}

function formFromProposal(item: Contribution): DirectoryForm {
  const hours = parseWeeklyHours(item.openingHours);
  return {
    ...EMPTY_FORM,
    kind: item.placeKind === "healthcare" ? "healthcare" : "pharmacy",
    name: item.name ?? "",
    city: item.city ?? "",
    phone: item.phone ?? "",
    address: item.address ?? "",
    latitude: item.latitude?.toString() ?? "",
    longitude: item.longitude?.toString() ?? "",
    hoursMode: hours ? "custom" : "city",
    openingHours: hours ?? DEFAULT_WEEKLY_HOURS,
  };
}

function ReviewDialog({ item, onClose }: { item: Contribution | null; onClose: () => void }) {
  const theme = useAdminTheme();
  const router = useRouter();
  const utils = trpc.useUtils();
  const cityHoursFor = useCityHoursLookup();
  const [form, setForm] = useState<DirectoryForm>(EMPTY_FORM);
  const [formFor, setFormFor] = useState<number | null>(null);
  const [note, setNote] = useState("");
  if (item && formFor !== item.id) {
    setFormFor(item.id);
    setForm(formFromProposal(item));
    setNote("");
  }
  const refresh = () => Promise.all([utils.admin.contributions.list.invalidate(), utils.admin.contributions.counts.invalidate(), utils.admin.directory.list.invalidate()]);
  const done = async () => {
    haptic.success();
    await refresh();
    onClose();
  };
  const accept = trpc.admin.contributions.acceptPlace.useMutation({ onSuccess: done });
  const close = trpc.admin.contributions.close.useMutation({ onSuccess: done });
  const pending = accept.isPending || close.isPending;
  const error = accept.error?.message ?? close.error?.message;
  const open = item?.status === "new";
  const isPlace = item?.kind === "new_place";
  const { missingCoordinates, cannotSave } = formState(form);
  const cities = trpc.admin.directory.list.useQuery({ page: 1, limit: 1 }, { enabled: !!item && isPlace, retry: 1 });

  const footer = !item ? null : !open ? (
    <Button label="Fermer" onPress={onClose} />
  ) : isPlace ? (
    <>
      <Button label="Refuser" variant="ghost" icon="block" disabled={pending} loading={close.isPending} onPress={() => close.mutate({ id: item.id, status: "rejected", note: note.trim() || undefined })} />
      <Button label="Annuler" onPress={onClose} disabled={pending} />
      <Button label="Publier dans l’annuaire" variant="primary" icon="check" disabled={cannotSave} loading={accept.isPending} onPress={() => accept.mutate({ id: item.id, entry: toUpsertInput(form) })} />
    </>
  ) : (
    <>
      <Button label="Rejeter" variant="ghost" icon="block" disabled={pending} loading={close.isPending && close.variables?.status === "rejected"} onPress={() => close.mutate({ id: item.id, status: "rejected", note: note.trim() || undefined })} />
      <Button label="Annuler" onPress={onClose} disabled={pending} />
      <Button label="Marquer comme résolu" variant="primary" icon="task-alt" loading={close.isPending && close.variables?.status === "resolved"} disabled={pending} onPress={() => close.mutate({ id: item.id, status: "resolved", note: note.trim() || undefined })} />
    </>
  );

  return (
    <Dialog
      visible={!!item}
      title={isPlace ? "Proposition d’établissement" : "Signalement"}
      description={item ? `${author(item)} · ${formatDate(item.createdAt)}` : undefined}
      onClose={onClose}
      width={isPlace && open ? 920 : 620}
      footer={footer}
    >
      {item ? (
        <>
          {!open ? (
            <Alert tone={item.status === "rejected" ? "neutral" : "success"} title={`${STATUS[item.status]?.label ?? item.status} le ${formatDate(item.handledAt)}`}>
              {item.adminNote || "Aucune note."}
            </Alert>
          ) : null}
          {isPlace ? (
            <>
              {item.message ? <Alert tone="info" title="Note du contributeur">{item.message}</Alert> : null}
              {open ? (
                <>
                  <Text style={[styles.lead, { color: theme.textSecondary }]}>Vérifiez et complétez la fiche (groupe de garde, assurances) avant de la publier.</Text>
                  <DirectoryFormFields key={item.id} form={form} cityNames={(cities.data?.cities ?? []).map((entry) => entry.name)} cityHoursFor={cityHoursFor} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} />
                  {missingCoordinates ? <Alert tone="warning">Placez la pharmacie sur la carte pour la publier.</Alert> : null}
                </>
              ) : (
                <View style={styles.facts}>
                  <Fact label="Nom" value={item.name} />
                  <Fact label="Ville" value={item.city} />
                  <Fact label="Adresse" value={item.address} />
                  <Fact label="Téléphone" value={item.phone} />
                  {item.placeId ? <Button label="Voir la fiche publiée" icon="open-in-new" onPress={() => { onClose(); router.replace({ pathname: "/admin/annuaire", params: { q: item.name ?? "" } } as never); }} /> : null}
                </View>
              )}
            </>
          ) : (
            <View style={styles.facts}>
              <Fact label="Catégorie" value={item.category} />
              <Fact label="Sujet" value={item.subject} />
              <Fact label="Description" value={item.message} />
              <Fact label="Établissement" value={item.name ? `${item.name}${item.city ? ` · ${item.city}` : ""}` : item.city ? `Ville : ${item.city}` : "Non précisé"} />
              {item.name ? <Button label="Ouvrir la fiche dans l’annuaire" icon="open-in-new" onPress={() => { onClose(); router.replace({ pathname: "/admin/annuaire", params: { q: item.name ?? "" } } as never); }} /> : null}
            </View>
          )}
          {open ? <Field label="Note interne (facultative)" value={note} onChangeText={setNote} placeholder={isPlace ? "Motif du refus, vérifications faites…" : "Correction apportée, motif du rejet…"} hint="Enregistrée dans le journal d’audit." multiline /> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </>
      ) : null}
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  const theme = useAdminTheme();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.factValue, { color: value ? theme.text : theme.textMuted }]}>{value || "—"}</Text>
    </View>
  );
}

export function ContributionsPage() {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const [kind, setKind] = useState<Kind>("new_place");
  const [status, setStatus] = useState<StatusFilter>("new");
  const [page, setPage] = usePage(`${kind}|${status}`);
  const [selected, setSelected] = useState<Contribution | null>(null);
  const counts = trpc.admin.contributions.counts.useQuery(undefined, { retry: 1 });
  const list = trpc.admin.contributions.list.useQuery({ kind, status, page, limit: PAGE_SIZE }, { retry: 1, placeholderData: (previous) => previous });
  const rows = list.data?.items ?? [];
  const isPlace = kind === "new_place";
  const badge = (item: Contribution) => <Badge {...(STATUS[item.status] ?? { label: item.status, tone: "neutral" as const })} dot />;
  const action = (item: Contribution) => <Button size="sm" label={item.status === "new" ? (isPlace ? "Examiner" : "Traiter") : "Détails"} variant={item.status === "new" ? "primary" : "secondary"} onPress={() => setSelected(item)} />;
  const placeCount = counts.data?.newPlaces ?? 0;
  const problemCount = counts.data?.newProblems ?? 0;

  return (
    <AdminPage section="contributions">
      <Card padded={false}>
        <Toolbar>
          <Segmented
            value={kind}
            onChange={(value) => setKind(value as Kind)}
            options={[
              { value: "new_place", label: `Nouveaux établissements${placeCount ? ` (${placeCount})` : ""}` },
              { value: "problem", label: `Signalements${problemCount ? ` (${problemCount})` : ""}` },
            ]}
          />
          <Segmented
            value={status}
            onChange={(value) => setStatus(value as StatusFilter)}
            options={[
              { value: "new", label: "À traiter" },
              { value: isPlace ? "accepted" : "resolved", label: isPlace ? "Publiées" : "Résolus" },
              { value: "rejected", label: isPlace ? "Refusées" : "Rejetés" },
              { value: "all", label: "Toutes" },
            ]}
          />
        </Toolbar>
        <DataState
          loading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          empty={!rows.length}
          emptyTitle={status === "new" ? "Rien à traiter" : "Aucune contribution"}
          emptyMessage={status === "new" ? (isPlace ? "Les établissements proposés depuis l’application apparaîtront ici." : "Les erreurs signalées depuis l’application apparaîtront ici.") : undefined}
        >
          {desktop ? (
            <DataTable
              columns={isPlace ? PLACE_COLUMNS : PROBLEM_COLUMNS}
              rows={rows}
              rowKey={(item) => String(item.id)}
              minWidth={900}
              onRowPress={setSelected}
              renderCell={(item, key) => {
                switch (key) {
                  case "name":
                    return <CellStack title={item.name ?? "Sans nom"} subtitle={item.address} />;
                  case "city":
                    return <CellText>{item.city ?? "—"}</CellText>;
                  case "type":
                    return <CellText>{item.placeKind === "healthcare" ? "Structure de santé" : "Pharmacie"}</CellText>;
                  case "subject":
                    return <CellStack title={item.subject ?? "Sans sujet"} subtitle={item.message} />;
                  case "category":
                    return <Badge label={item.category ?? "Autre"} tone="info" />;
                  case "place":
                    return <CellStack title={item.name ?? "Non précisé"} subtitle={item.city} />;
                  case "author":
                    return <CellText muted={!item.userId}>{author(item)}</CellText>;
                  case "date":
                    return <CellText muted>{formatRelative(item.createdAt)}</CellText>;
                  case "status":
                    return badge(item);
                  case "actions":
                    return action(item);
                  default:
                    return null;
                }
              }}
            />
          ) : (
            rows.map((item, index) => (
              <View key={item.id} style={[styles.mobileRow, index < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                <View style={styles.mobileTop}>
                  <View style={styles.flex}>
                    <Text numberOfLines={1} style={[styles.mobileTitle, { color: theme.text }]}>{isPlace ? item.name : item.subject}</Text>
                    <Text numberOfLines={2} style={[styles.mobileMeta, { color: theme.textMuted }]}>{isPlace ? `${item.city ?? ""} · ${item.address ?? ""}` : `${item.category ?? ""} · ${item.name ?? item.city ?? ""}`}</Text>
                    <Text style={[styles.mobileMeta, { color: theme.textMuted }]}>{author(item)} · {formatRelative(item.createdAt)}</Text>
                  </View>
                  {badge(item)}
                </View>
                {action(item)}
              </View>
            ))
          )}
          <View style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
            <Pagination page={page} limit={PAGE_SIZE} total={list.data?.total ?? 0} onChange={setPage} />
          </View>
        </DataState>
      </Card>
      <ReviewDialog item={selected} onClose={() => setSelected(null)} />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  lead: { fontSize: font.sm, lineHeight: 20 },
  facts: { gap: 14 },
  fact: { gap: 2 },
  factLabel: { fontSize: font.xs },
  factValue: { fontSize: font.md, lineHeight: 21 },
  mobileRow: { padding: 16, gap: 10 },
  mobileTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  mobileTitle: { fontSize: font.md, fontWeight: "600" },
  mobileMeta: { fontSize: font.xs, lineHeight: 18, marginTop: 2 },
});
