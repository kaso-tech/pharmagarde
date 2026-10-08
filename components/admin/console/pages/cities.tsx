import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

import { ResponsiveTable } from "../list";
import { AdminPage } from "../shell";
import { formatCount, numberOrNull } from "../shared";
import { useAdminLayout } from "../theme";
import { Alert, Badge, Button, Card, CellStack, CellText, ConfirmDialog, DataState, Dialog, Field, Hint, IconButton, Segmented, type Column } from "../ui";

type Outputs = inferRouterOutputs<AppRouter>["admin"]["cities"]["list"];
type City = Outputs["cities"][number];

const COLUMNS: readonly Column[] = [
  { key: "name", label: "Ville", flex: 1.6 },
  { key: "center", label: "Centre", flex: 1.4 },
  { key: "pharmacies", label: "Pharmacies", flex: 1 },
  { key: "healthcare", label: "Structures", flex: 1 },
  { key: "duty", label: "Gardes", flex: 1 },
  { key: "state", label: "Application", flex: 1 },
  { key: "actions", label: "", width: 96, align: "right" },
];

type FormState = { create: boolean; name: string; latitude: string; longitude: string; aliases: string; published: boolean; source?: City["source"] };

function formFrom(city: City | null, name = ""): FormState {
  return {
    create: !city,
    name: city?.name ?? name,
    latitude: city?.latitude.toString() ?? "",
    longitude: city?.longitude.toString() ?? "",
    aliases: (city?.aliases ?? []).filter((alias) => alias !== city?.name.toLowerCase()).join(", "),
    published: city?.published ?? true,
    source: city?.source,
  };
}

function CityDialog({ form, setForm, onClose }: { form: FormState | null; setForm: (next: FormState) => void; onClose: () => void }) {
  const { desktop } = useAdminLayout();
  const utils = trpc.useUtils();
  const done = async () => {
    haptic.success();
    await utils.admin.cities.list.invalidate();
    onClose();
  };
  const save = trpc.admin.cities.save.useMutation({ onSuccess: done });
  const reset = trpc.admin.cities.reset.useMutation({ onSuccess: done });
  if (!form) return null;
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  const latitude = numberOrNull(form.latitude);
  const longitude = numberOrNull(form.longitude);
  const latitudeError = form.latitude && (latitude === null || latitude < 9 || latitude > 15.5) ? "Latitude hors du Burkina Faso (9 à 15,5)." : null;
  const longitudeError = form.longitude && (longitude === null || longitude < -6 || longitude > 2.6) ? "Longitude hors du Burkina Faso (−6 à 2,6)." : null;
  const valid = form.name.trim().length >= 2 && latitude !== null && longitude !== null && !latitudeError && !longitudeError;
  return (
    <Dialog
      visible
      title={form.create ? "Ajouter une ville" : form.name}
      description={form.create ? "La ville sera proposée dans le choix de ville de l’application et ses structures de santé seront collectées à la prochaine mise à jour." : "Le centre sert de position de référence quand le GPS est indisponible."}
      onClose={onClose}
      footer={
        <>
          {!form.create && form.source && form.source !== "default" ? (
            <Button label={form.source === "added" ? "Retirer la ville" : "Valeurs d’origine"} variant="ghost" icon={form.source === "added" ? "delete-outline" : "restart-alt"} loading={reset.isPending} onPress={() => reset.mutate({ name: form.name })} style={styles.left} />
          ) : null}
          <Button label="Annuler" onPress={onClose} />
          <Button
            label="Enregistrer"
            variant="primary"
            icon="check"
            loading={save.isPending}
            disabled={!valid}
            onPress={() =>
              save.mutate({
                create: form.create,
                name: form.name.trim(),
                latitude: latitude!,
                longitude: longitude!,
                aliases: form.aliases.split(",").map((alias) => alias.trim()).filter((alias) => alias.length >= 2),
                published: form.published,
              })
            }
          />
        </>
      }
    >
      {save.error ? <Alert tone="danger">{save.error.message}</Alert> : null}
      {reset.error ? <Alert tone="danger">{reset.error.message}</Alert> : null}
      <Field label="Nom" value={form.name} onChangeText={(name) => set({ name })} editable={form.create} placeholder="Ex. Koupéla" hint={form.create ? "Écrivez-le comme dans l’annuaire pour que les établissements y soient rattachés." : "Le nom d’une ville existante ne se modifie pas."} />
      <View style={desktop ? styles.row : undefined}>
        <Field style={styles.flex} label="Latitude du centre" keyboardType="numeric" value={form.latitude} onChangeText={(value) => set({ latitude: value })} placeholder="12.2526" error={latitudeError} />
        <Field style={styles.flex} label="Longitude du centre" keyboardType="numeric" value={form.longitude} onChangeText={(value) => set({ longitude: value })} placeholder="-2.3627" error={longitudeError} />
      </View>
      <Field label="Autres noms reconnus (séparés par des virgules)" value={form.aliases} onChangeText={(aliases) => set({ aliases })} placeholder="Ex. nom de la province, abréviation" hint="Servent à rattacher une adresse ou une position à la ville." />
      <Segmented value={form.published ? "on" : "off"} onChange={(value) => set({ published: value === "on" })} options={[{ value: "on", label: "Publiée dans l’application" }, { value: "off", label: "Masquée" }]} />
    </Dialog>
  );
}

export function CitiesPage() {
  const list = trpc.admin.cities.list.useQuery(undefined, { retry: 1 });
  const [form, setForm] = useState<FormState | null>(null);
  const [unpublish, setUnpublish] = useState<City | null>(null);
  const utils = trpc.useUtils();
  const save = trpc.admin.cities.save.useMutation({
    onSuccess: async () => {
      setUnpublish(null);
      await utils.admin.cities.list.invalidate();
    },
  });
  const rows = list.data?.cities ?? [];
  const suggestions = list.data?.suggestions ?? [];
  const togglePublished = (city: City) => (city.published ? setUnpublish(city) : save.mutate({ name: city.name, latitude: city.latitude, longitude: city.longitude, aliases: city.aliases, published: true }));
  const actions = (city: City) => (
    <View style={styles.actions}>
      <IconButton icon="edit" label="Modifier" onPress={() => setForm(formFrom(city))} />
      <IconButton icon={city.published ? "visibility-off" : "visibility"} label={city.published ? "Masquer" : "Publier"} tone={city.published ? "danger" : "brand"} onPress={() => togglePublished(city)} />
    </View>
  );
  const state = (city: City) => (city.published ? <Badge label="Publiée" tone="success" dot /> : <Badge label="Masquée" tone="neutral" dot />);
  const duty = (city: City) => (city.dutyProgrammed ? <Badge label="Programmées" tone="brand" /> : <Badge label="Aucune" tone={city.pharmacies ? "warning" : "neutral"} />);

  return (
    <AdminPage section="cities" actions={<Button label="Ajouter une ville" icon="add" variant="primary" onPress={() => setForm(formFrom(null))} />}>
      {save.error ? <Alert tone="danger">{save.error.message}</Alert> : null}
      {suggestions.length ? (
        <Alert tone="info" title={`${suggestions.length} ville${suggestions.length > 1 ? "s" : ""} de l’annuaire absente${suggestions.length > 1 ? "s" : ""} de la liste`}>
          {`${suggestions.map((city) => `${city.name} (${city.establishments})`).join(", ")}. Ajoutez-les pour qu’elles soient proposées dans l’application.`}
        </Alert>
      ) : null}
      {suggestions.length ? (
        <View style={styles.suggestions}>
          {suggestions.slice(0, 8).map((city) => (
            <Button key={city.name} size="sm" icon="add" label={city.name} onPress={() => setForm(formFrom(null, city.name))} />
          ))}
        </View>
      ) : null}
      <Card padded={false}>
        <DataState loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={!rows.length} emptyTitle="Aucune ville">
          <ResponsiveTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(city) => city.name}
            minWidth={900}
            onRowPress={(city) => setForm(formFrom(city))}
            renderCell={(city, key) => {
              switch (key) {
                case "name":
                  return <CellStack title={city.name} subtitle={city.source === "added" ? "Ajoutée depuis la console" : city.source === "modified" ? "Modifiée" : null} />;
                case "center":
                  return <CellText mono small>{`${city.latitude.toFixed(4)}, ${city.longitude.toFixed(4)}`}</CellText>;
                case "pharmacies":
                  return <CellText muted={!city.pharmacies}>{formatCount(city.pharmacies)}</CellText>;
                case "healthcare":
                  return <CellText muted={!city.healthcare}>{formatCount(city.healthcare)}</CellText>;
                case "duty":
                  return duty(city);
                case "state":
                  return state(city);
                case "actions":
                  return actions(city);
                default:
                  return null;
              }
            }}
            mobileRow={(city) => ({
              title: city.name,
              subtitle: `${formatCount(city.pharmacies)} pharmacies · ${formatCount(city.healthcare)} structures de santé`,
              meta: `Centre : ${city.latitude.toFixed(4)}, ${city.longitude.toFixed(4)}`,
              badges: (
                <>
                  {state(city)}
                  {duty(city)}
                </>
              ),
              actions: actions(city),
            })}
          />
        </DataState>
      </Card>
      <Hint>Une ville masquée n’est plus proposée dans l’application ; ses établissements restent dans l’annuaire.</Hint>
      <CityDialog form={form} setForm={setForm} onClose={() => setForm(null)} />
      <ConfirmDialog
        visible={!!unpublish}
        title="Masquer cette ville ?"
        message={`${unpublish?.name ?? ""} ne sera plus proposée dans le choix de ville de l’application.`}
        confirmLabel="Masquer"
        loading={save.isPending}
        onConfirm={() => unpublish && save.mutate({ name: unpublish.name, latitude: unpublish.latitude, longitude: unpublish.longitude, aliases: unpublish.aliases, published: false })}
        onClose={() => setUnpublish(null)}
      />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  left: { marginRight: "auto" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 4 },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
