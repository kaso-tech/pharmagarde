import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

import { ResponsiveTable } from "../list";
import { AdminPage } from "../shell";
import { formatCount } from "../shared";
import { Alert, Badge, Button, Card, CellStack, CellText, ConfirmDialog, DataState, Dialog, Field, Hint, IconButton, Segmented, type Column } from "../ui";

type Insurer = inferRouterOutputs<AppRouter>["admin"]["insurers"]["list"][number];

const COLUMNS: readonly Column[] = [
  { key: "label", label: "Assureur", flex: 2 },
  { key: "establishments", label: "Établissements", flex: 1.2 },
  { key: "state", label: "État", flex: 1 },
  { key: "actions", label: "", width: 140, align: "right" },
];

function sourceLabel(insurer: Insurer) {
  return insurer.source === "added" ? "Ajouté depuis la console" : insurer.source === "modified" ? "Liste de référence (modifié)" : "Liste de référence";
}

function InsurerDialog({ target, onClose }: { target: { insurer: Insurer | null } | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const insurer = target?.insurer ?? null;
  const [label, setLabel] = useState(insurer?.label ?? "");
  const [active, setActive] = useState(insurer?.active ?? true);
  const save = trpc.admin.insurers.save.useMutation({
    onSuccess: async () => {
      haptic.success();
      await utils.admin.insurers.list.invalidate();
      onClose();
    },
  });
  return (
    <Dialog
      visible={!!target}
      title={insurer ? `Modifier ${insurer.label}` : "Ajouter un assureur"}
      description={insurer ? `Identifiant : ${insurer.id}. Il reste le même si vous changez le nom.` : "L’assureur pourra être coché sur les fiches des établissements."}
      onClose={onClose}
      footer={
        <>
          <Button label="Annuler" onPress={onClose} />
          <Button label="Enregistrer" variant="primary" icon="check" loading={save.isPending} disabled={label.trim().length < 2} onPress={() => save.mutate({ id: insurer?.id, label: label.trim(), active })} />
        </>
      }
    >
      {save.error ? <Alert tone="danger">{save.error.message}</Alert> : null}
      <Field label="Nom affiché" value={label} onChangeText={setLabel} placeholder="Ex. Allianz" />
      <Segmented value={active ? "on" : "off"} onChange={(value) => setActive(value === "on")} options={[{ value: "on", label: "Actif" }, { value: "off", label: "Désactivé" }]} />
      <Hint>Un assureur désactivé n’est plus affiché dans l’application ni proposé sur les fiches ; les établissements qui l’avaient coché le gardent en mémoire s’il est réactivé.</Hint>
    </Dialog>
  );
}

export function InsurersPage() {
  const utils = trpc.useUtils();
  const list = trpc.admin.insurers.list.useQuery(undefined, { retry: 1 });
  const [editing, setEditing] = useState<{ insurer: Insurer | null } | null>(null);
  const [resetTarget, setResetTarget] = useState<Insurer | null>(null);
  const reset = trpc.admin.insurers.reset.useMutation({
    onSuccess: async () => {
      haptic.success();
      setResetTarget(null);
      await utils.admin.insurers.list.invalidate();
    },
  });
  const toggle = trpc.admin.insurers.save.useMutation({ onSuccess: () => utils.admin.insurers.list.invalidate() });
  const rows = list.data ?? [];
  const actions = (insurer: Insurer) => (
    <View style={styles.actions}>
      <IconButton icon="edit" label="Modifier" onPress={() => setEditing({ insurer })} />
      <IconButton icon={insurer.active ? "toggle-on" : "toggle-off"} label={insurer.active ? "Désactiver" : "Activer"} tone={insurer.active ? "brand" : "neutral"} onPress={() => toggle.mutate({ id: insurer.id, label: insurer.label, active: !insurer.active })} />
      {insurer.source !== "default" ? <IconButton icon={insurer.source === "added" ? "delete-outline" : "restart-alt"} label={insurer.source === "added" ? "Supprimer" : "Rétablir"} tone="danger" onPress={() => setResetTarget(insurer)} /> : null}
    </View>
  );
  const state = (insurer: Insurer) => (insurer.active ? <Badge label="Actif" tone="success" dot /> : <Badge label="Désactivé" tone="neutral" dot />);

  return (
    <AdminPage section="insurers" actions={<Button label="Ajouter un assureur" icon="add" variant="primary" onPress={() => setEditing({ insurer: null })} />}>
      {toggle.error ? <Alert tone="danger">{toggle.error.message}</Alert> : null}
      <Card padded={false}>
        <DataState loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={!rows.length} emptyTitle="Aucun assureur">
          <ResponsiveTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(insurer) => insurer.id}
            minWidth={640}
            onRowPress={(insurer) => setEditing({ insurer })}
            renderCell={(insurer, key) => {
              switch (key) {
                case "label":
                  return <CellStack title={insurer.label} subtitle={sourceLabel(insurer)} />;
                case "establishments":
                  return <CellText muted={!insurer.establishments}>{insurer.establishments ? `${formatCount(insurer.establishments)} établissement${insurer.establishments > 1 ? "s" : ""}` : "Aucun"}</CellText>;
                case "state":
                  return state(insurer);
                case "actions":
                  return actions(insurer);
                default:
                  return null;
              }
            }}
            mobileRow={(insurer) => ({ title: insurer.label, subtitle: sourceLabel(insurer), meta: `${formatCount(insurer.establishments)} établissement(s)`, badges: state(insurer), actions: actions(insurer) })}
          />
        </DataState>
      </Card>
      {editing ? <InsurerDialog key={editing.insurer?.id ?? "new"} target={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        visible={!!resetTarget}
        title={resetTarget?.source === "added" ? "Supprimer cet assureur ?" : "Rétablir cet assureur ?"}
        message={resetTarget?.source === "added" ? `« ${resetTarget?.label ?? ""} » sera retiré de la liste. Impossible s’il est encore coché sur des fiches.` : `« ${resetTarget?.label ?? ""} » reprend son nom d’origine et redevient actif.`}
        confirmLabel={resetTarget?.source === "added" ? "Supprimer" : "Rétablir"}
        loading={reset.isPending}
        onConfirm={() => resetTarget && reset.mutate({ id: resetTarget.id })}
        onClose={() => {
          reset.reset();
          setResetTarget(null);
        }}
      />
      {reset.error ? <Alert tone="danger">{reset.error.message}</Alert> : null}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 4 },
});
