import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

import { ExportButton } from "../export-button";
import { datedFileName, downloadFile, toCsv } from "../files";
import { ResponsiveTable } from "../list";
import { AdminPage } from "../shell";
import { PAGE_SIZE, formatCount, formatXof, numberOrNull, useDebouncedValue, usePage } from "../shared";
import { font, useAdminLayout, useAdminTheme } from "../theme";
import { Alert, Badge, Button, Card, CellStack, CellText, ConfirmDialog, DataState, Dialog, Field, FieldLabel, Grid, Hint, IconButton, KpiCard, Pagination, SearchInput, Segmented, Select, SelectField, Toolbar, type Column } from "../ui";
import { MedicinesImportDialog } from "./medicines-import";

type Outputs = inferRouterOutputs<AppRouter>;
export type AdminMedicine = Outputs["admin"]["medicines"]["list"]["items"][number];
type ProductType = Outputs["admin"]["medicines"]["list"]["productTypes"][number];
type Status = "all" | "visible" | "hidden" | "modified" | "added";

const COLUMNS: readonly Column[] = [
  { key: "name", label: "Produit", flex: 2.4 },
  { key: "category", label: "Catégorie", flex: 2 },
  { key: "price", label: "Prix", flex: 1.4 },
  { key: "state", label: "État", width: 130 },
  { key: "actions", label: "", width: 96, align: "right" },
];

const AGE_OPTIONS = [
  { value: "", label: "Non précisé" },
  { value: "Enfant", label: "Enfant" },
  { value: "Adulte", label: "Adulte" },
  { value: "Tous", label: "Tous âges" },
];

export function medicinePrice(item: { priceApprox?: number; priceMax?: number; priceUnit?: string }) {
  if (item.priceApprox === undefined) return "Prix non renseigné";
  const range = item.priceMax ? `${formatCount(item.priceApprox)} – ${formatXof(item.priceMax)}` : formatXof(item.priceApprox);
  return item.priceUnit ? `${range} ${item.priceUnit}` : range;
}

function stateBadge(item: AdminMedicine) {
  if (item.hidden) return <Badge label="Masqué" tone="danger" icon="visibility-off" />;
  if (item.source === "added") return <Badge label="Ajouté" tone="info" />;
  if (item.source === "modified") return <Badge label="Modifié" tone="brand" />;
  return <Badge label="Catalogue" tone="neutral" />;
}

type FormState = {
  id?: string;
  source?: AdminMedicine["source"];
  name: string;
  productType: string;
  category: string;
  subcategory: string;
  ageCategory: string;
  pharmaceuticalType: string;
  dosage: string;
  priceApprox: string;
  priceMax: string;
  priceUnit: string;
  priceOfficial: boolean;
};

function formFrom(item: AdminMedicine | null, productTypes: readonly ProductType[]): FormState {
  return {
    id: item?.id,
    source: item?.source,
    name: item?.name ?? "",
    productType: item?.productType ?? productTypes[1] ?? "",
    category: item?.category ?? "",
    subcategory: item?.subcategory ?? "",
    ageCategory: item?.ageCategory ?? "",
    pharmaceuticalType: item?.pharmaceuticalType ?? "",
    dosage: item?.dosage ?? "",
    priceApprox: item?.priceApprox?.toString() ?? "",
    priceMax: item?.priceMax?.toString() ?? "",
    priceUnit: item?.priceUnit ?? "",
    priceOfficial: item?.priceOfficial ?? false,
  };
}

function MedicineDialog({ form, setForm, productTypes, onClose }: { form: FormState | null; setForm: (next: FormState) => void; productTypes: readonly ProductType[]; onClose: () => void }) {
  const { desktop } = useAdminLayout();
  const utils = trpc.useUtils();
  const categories = trpc.admin.medicines.categories.useQuery(undefined, { enabled: !!form, staleTime: 60_000 });
  const done = async () => {
    haptic.success();
    await utils.admin.medicines.invalidate();
    onClose();
  };
  const save = trpc.admin.medicines.save.useMutation({ onSuccess: done });
  const reset = trpc.admin.medicines.reset.useMutation({ onSuccess: done });
  if (!form) return null;
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  const priceApprox = numberOrNull(form.priceApprox);
  const priceMax = numberOrNull(form.priceMax);
  const priceError = form.priceApprox && (priceApprox === null || priceApprox <= 0) ? "Prix invalide." : form.priceMax && (priceMax === null || !priceApprox || priceMax <= priceApprox) ? "Le maximum doit dépasser le prix de base." : null;
  const categoryOptions = (categories.data ?? []).filter((category) => !category.productTypes.length || category.productTypes.includes(form.productType)).map((category) => ({ value: category.label, label: category.label }));
  const subcategoryOptions = (categories.data ?? []).find((category) => category.label === form.category)?.subcategories.map((sub) => ({ value: sub.label, label: sub.label })) ?? [];
  const submit = () =>
    save.mutate({
      id: form.id,
      name: form.name.trim(),
      productType: form.productType as ProductType,
      category: form.category || null,
      subcategory: form.subcategory || null,
      ageCategory: (form.ageCategory || null) as "Enfant" | "Adulte" | "Tous" | null,
      pharmaceuticalType: form.pharmaceuticalType || null,
      dosage: form.dosage || null,
      priceApprox: priceApprox ? Math.round(priceApprox) : null,
      priceMax: priceMax ? Math.round(priceMax) : null,
      priceUnit: form.priceUnit || null,
      priceOfficial: form.priceOfficial,
    });
  const row = desktop ? styles.row : undefined;

  return (
    <Dialog
      visible
      title={form.id ? form.name || "Produit" : "Ajouter un produit"}
      description={form.id ? (form.source === "added" ? "Produit ajouté depuis la console." : "Produit de la Liste nationale : vos modifications remplacent les valeurs d’origine.") : "Le produit est publié dans le catalogue des abonnés dès l’enregistrement."}
      onClose={onClose}
      width={720}
      footer={
        <>
          {form.id && form.source !== "catalog" ? (
            <Button
              label={form.source === "added" ? "Supprimer le produit" : "Revenir à la version d’origine"}
              variant="ghost"
              icon={form.source === "added" ? "delete-outline" : "restart-alt"}
              loading={reset.isPending}
              onPress={() => reset.mutate({ id: form.id! })}
              style={styles.left}
            />
          ) : null}
          <Button label="Annuler" onPress={onClose} />
          <Button label="Enregistrer" variant="primary" icon="check" loading={save.isPending} disabled={form.name.trim().length < 2 || !form.productType || !!priceError} onPress={submit} />
        </>
      }
    >
      {save.error ? <Alert tone="danger">{save.error.message}</Alert> : null}
      {reset.error ? <Alert tone="danger">{reset.error.message}</Alert> : null}
      <Field label="Nom du produit" value={form.name} onChangeText={(name) => set({ name })} placeholder="Ex. Paracétamol" />
      <View style={row}>
        <SelectField style={styles.flex} label="Type de produit" value={form.productType} options={productTypes.map((type) => ({ value: type, label: type }))} onChange={(productType) => set({ productType })} />
        <SelectField style={styles.flex} label="Âge" value={form.ageCategory} options={AGE_OPTIONS} onChange={(ageCategory) => set({ ageCategory })} />
      </View>
      <View style={row}>
        <SelectField style={styles.flex} label="Catégorie" placeholder="Choisir une catégorie" value={form.category} options={[{ value: "", label: "Sans catégorie" }, ...categoryOptions]} onChange={(category) => set({ category, subcategory: "" })} />
        <SelectField style={styles.flex} label="Sous-catégorie" placeholder="Choisir une sous-catégorie" value={form.subcategory} options={[{ value: "", label: "Sans sous-catégorie" }, ...subcategoryOptions]} onChange={(subcategory) => set({ subcategory })} />
      </View>
      <View style={row}>
        <Field style={styles.flex} label="Forme" value={form.pharmaceuticalType} onChangeText={(pharmaceuticalType) => set({ pharmaceuticalType })} placeholder="Comprimé, sirop, injectable…" />
        <Field style={styles.flex} label="Dosage" value={form.dosage} onChangeText={(dosage) => set({ dosage })} placeholder="Ex. 500 mg" />
      </View>
      <View style={row}>
        <Field style={styles.flex} label="Prix (F CFA)" keyboardType="numeric" value={form.priceApprox} onChangeText={(priceApprox) => set({ priceApprox })} placeholder="Ex. 250" error={priceError} />
        <Field style={styles.flex} label="Prix maximum (fourchette, facultatif)" keyboardType="numeric" value={form.priceMax} onChangeText={(priceMax) => set({ priceMax })} placeholder="Ex. 400" />
      </View>
      <View style={row}>
        <Field style={styles.flex} label="Unité du prix" value={form.priceUnit} onChangeText={(priceUnit) => set({ priceUnit })} placeholder="par comprimé, par flacon…" />
        <View style={[styles.flex, styles.segmentField]}>
          <FieldLabel>Source du prix</FieldLabel>
          <Segmented value={form.priceOfficial ? "official" : "estimate"} onChange={(value) => set({ priceOfficial: value === "official" })} options={[{ value: "estimate", label: "Estimation" }, { value: "official", label: "Prix officiel (arrêté)" }]} />
        </View>
      </View>
    </Dialog>
  );
}

function CategoriesDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useAdminTheme();
  const utils = trpc.useUtils();
  const categories = trpc.admin.medicines.categories.useQuery(undefined, { enabled: visible });
  const [editing, setEditing] = useState<{ level: "category" | "subcategory"; original: string; label: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const rename = trpc.admin.medicines.renameCategory.useMutation({
    onSuccess: async () => {
      haptic.success();
      setEditing(null);
      await Promise.all([utils.admin.medicines.categories.invalidate(), utils.admin.medicines.list.invalidate()]);
    },
  });
  const line = (level: "category" | "subcategory", item: { original: string; label: string; count: number }, extra?: React.ReactNode) =>
    editing?.level === level && editing.original === item.original ? (
      <View style={[styles.renameRow, level === "subcategory" && styles.sub]}>
        <Field style={styles.flex} label={`Nouvel intitulé (d’origine : ${item.original})`} value={editing.label} onChangeText={(label) => setEditing({ ...editing, label })} />
        <View style={styles.renameActions}>
          <Button size="sm" label="Annuler" onPress={() => setEditing(null)} />
          <Button size="sm" label="Renommer" variant="primary" loading={rename.isPending} disabled={editing.label.trim().length < 2} onPress={() => rename.mutate({ level, original: item.original, label: editing.label.trim() })} />
        </View>
      </View>
    ) : (
      <View style={[styles.categoryRow, level === "subcategory" && styles.sub, { borderBottomColor: theme.border }]}>
        <View style={styles.flex}>
          <Text style={[level === "category" ? styles.categoryTitle : styles.subTitle, { color: theme.text }]}>{item.label}</Text>
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            {formatCount(item.count)} produit{item.count > 1 ? "s" : ""}
            {item.label !== item.original ? ` · intitulé d’origine : ${item.original}` : ""}
          </Text>
        </View>
        {extra}
        <IconButton icon="edit" label="Renommer" onPress={() => setEditing({ level, original: item.original, label: item.label })} />
      </View>
    );

  return (
    <Dialog visible={visible} title="Catégories du catalogue" description="Renommer une catégorie change l’intitulé de tous ses produits. Les noms d’origine de la Liste nationale restent la référence pour les imports." onClose={onClose} width={760}>
      {rename.error ? <Alert tone="danger">{rename.error.message}</Alert> : null}
      <DataState loading={categories.isLoading} error={categories.error} onRetry={() => categories.refetch()} empty={!categories.data?.length} emptyTitle="Aucune catégorie">
        <View>
          {(categories.data ?? []).map((category) => (
            <View key={category.original}>
              {line("category", category, category.subcategories.length ? <Button size="sm" variant="ghost" label={`${category.subcategories.length} sous-catégorie${category.subcategories.length > 1 ? "s" : ""}`} icon={open === category.original ? "expand-less" : "expand-more"} onPress={() => setOpen(open === category.original ? null : category.original)} /> : null)}
              {open === category.original ? category.subcategories.map((sub) => <View key={sub.original}>{line("subcategory", sub)}</View>) : null}
            </View>
          ))}
        </View>
      </DataState>
    </Dialog>
  );
}

export function MedicinesPage() {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [productType, setProductType] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [page, setPage] = usePage(`${debouncedSearch}|${productType}|${category}|${status}`);
  const [form, setForm] = useState<FormState | null>(null);
  const [hideTarget, setHideTarget] = useState<AdminMedicine | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const filters = { search: debouncedSearch || undefined, productType: (productType || undefined) as ProductType | undefined, category: category || undefined, status };
  const list = trpc.admin.medicines.list.useQuery({ ...filters, page, limit: PAGE_SIZE }, { retry: 1, placeholderData: (previous) => previous });
  const setHidden = trpc.admin.medicines.setHidden.useMutation({
    onSuccess: async () => {
      haptic.success();
      setHideTarget(null);
      await utils.admin.medicines.list.invalidate();
    },
  });
  const rows = list.data?.items ?? [];
  const counts = list.data?.counts;
  const productTypes = list.data?.productTypes ?? [];
  const toggle = (item: AdminMedicine) => (item.hidden ? setHidden.mutate({ id: item.id, hidden: false }) : setHideTarget(item));
  const actions = (item: AdminMedicine) => (
    <View style={styles.actions}>
      <IconButton icon="edit" label="Modifier" onPress={() => setForm(formFrom(item, productTypes))} />
      <IconButton icon={item.hidden ? "visibility" : "visibility-off"} label={item.hidden ? "Republier" : "Masquer"} tone={item.hidden ? "brand" : "danger"} onPress={() => toggle(item)} />
    </View>
  );

  return (
    <AdminPage
      section="medicines"
      actions={
        <>
          <Button label="Catégories" icon="category" onPress={() => setShowCategories(true)} />
          <Button label="Importer (Excel)" icon="upload-file" onPress={() => setShowImport(true)} />
          <ExportButton
            run={async () => {
              const items = await utils.admin.medicines.export.fetch(filters);
              downloadFile(
                datedFileName("medicaments"),
                toCsv(items, [
                  { label: "Identifiant", value: (item) => item.id },
                  { label: "Produit", value: (item) => item.name },
                  { label: "Type", value: (item) => item.productType },
                  { label: "Catégorie", value: (item) => item.category },
                  { label: "Sous-catégorie", value: (item) => item.subcategory },
                  { label: "Forme", value: (item) => item.pharmaceuticalType },
                  { label: "Dosage", value: (item) => item.dosage },
                  { label: "Prix (F CFA)", value: (item) => item.priceApprox },
                  { label: "Prix maximum", value: (item) => item.priceMax },
                  { label: "Unité", value: (item) => item.priceUnit },
                  { label: "Prix officiel", value: (item) => (item.priceApprox === undefined ? "" : item.priceOfficial ? "oui" : "non") },
                  { label: "Masqué", value: (item) => (item.hidden ? "oui" : "non") },
                ]),
              );
            }}
          />
          <Button label="Ajouter" icon="add" variant="primary" onPress={() => setForm(formFrom(null, productTypes))} />
        </>
      }
    >
      {counts ? (
        <Grid columns={desktop ? 5 : 2}>
          <KpiCard label="Produits" value={formatCount(counts.total)} icon="medication" onPress={() => setStatus("all")} />
          <KpiCard label="Modifiés" value={formatCount(counts.modified)} icon="edit" tone="info" onPress={() => setStatus("modified")} />
          <KpiCard label="Ajoutés" value={formatCount(counts.added)} icon="add-circle-outline" tone="success" onPress={() => setStatus("added")} />
          <KpiCard label="Masqués" value={formatCount(counts.hidden)} icon="visibility-off" tone="danger" onPress={() => setStatus("hidden")} />
          <KpiCard label="Sans prix" value={formatCount(counts.withoutPrice)} icon="money-off" tone="warning" hint="Produits publiés" />
        </Grid>
      ) : null}
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Rechercher un produit, une forme, un dosage" style={desktop ? styles.search : undefined} />
          <Select label="Type" style={desktop ? styles.filter : undefined} value={productType} onChange={(value) => { setProductType(value); setCategory(""); }} options={[{ value: "", label: "Tous les types" }, ...productTypes.map((type) => ({ value: type, label: type }))]} />
          <Select label="Catégorie" style={desktop ? styles.filterWide : undefined} value={category} onChange={setCategory} options={[{ value: "", label: "Toutes les catégories" }, ...(list.data?.categories ?? []).map((value) => ({ value, label: value }))]} />
          <Select label="État" style={desktop ? styles.filter : undefined} value={status} onChange={(value) => setStatus(value as Status)} options={[{ value: "all", label: "Tous" }, { value: "visible", label: "Publiés" }, { value: "hidden", label: "Masqués" }, { value: "modified", label: "Modifiés" }, { value: "added", label: "Ajoutés" }]} />
        </Toolbar>
        <DataState loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={!rows.length} emptyTitle="Aucun produit" emptyMessage="Aucun produit ne correspond à ces filtres.">
          <ResponsiveTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(item) => item.id}
            minWidth={900}
            onRowPress={(item) => setForm(formFrom(item, productTypes))}
            renderCell={(item, key) => {
              switch (key) {
                case "name":
                  return <CellStack title={item.name} subtitle={[item.pharmaceuticalType, item.dosage].filter(Boolean).join(" · ") || null} />;
                case "category":
                  return <CellStack title={item.category ?? "Sans catégorie"} subtitle={item.subcategory ?? item.productType ?? null} />;
                case "price":
                  return <CellText muted={item.priceApprox === undefined}>{medicinePrice(item)}</CellText>;
                case "state":
                  return stateBadge(item);
                case "actions":
                  return actions(item);
                default:
                  return null;
              }
            }}
            mobileRow={(item) => ({
              title: item.name,
              subtitle: [item.pharmaceuticalType, item.dosage].filter(Boolean).join(" · ") || null,
              meta: `${item.category ?? "Sans catégorie"} · ${medicinePrice(item)}`,
              badges: stateBadge(item),
              actions: actions(item),
            })}
          />
          <View style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
            <Pagination page={page} limit={PAGE_SIZE} total={list.data?.total ?? 0} onChange={setPage} />
          </View>
        </DataState>
      </Card>
      <Hint>Les abonnés Premium voient les changements à leur prochaine ouverture du catalogue. Un produit masqué n’est plus proposé, sans être supprimé.</Hint>
      <MedicineDialog form={form} setForm={setForm} productTypes={productTypes} onClose={() => setForm(null)} />
      <CategoriesDialog visible={showCategories} onClose={() => setShowCategories(false)} />
      <MedicinesImportDialog visible={showImport} onClose={() => setShowImport(false)} />
      <ConfirmDialog
        visible={!!hideTarget}
        title="Masquer ce produit ?"
        message={`« ${hideTarget?.name ?? ""} » ne sera plus proposé dans le catalogue des abonnés. Vous pourrez le republier à tout moment.`}
        confirmLabel="Masquer"
        loading={setHidden.isPending}
        onConfirm={() => hideTarget && setHidden.mutate({ id: hideTarget.id, hidden: true })}
        onClose={() => setHideTarget(null)}
      />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  left: { marginRight: "auto" },
  segmentField: { gap: 6 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 4 },
  search: { flexGrow: 1, flexBasis: 280, minWidth: 240 },
  filter: { minWidth: 170 },
  filterWide: { minWidth: 240, maxWidth: 320 },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1 },
  renameRow: { gap: 8, paddingVertical: 10 },
  renameActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  sub: { paddingLeft: 24 },
  categoryTitle: { fontSize: font.md, fontWeight: "600" },
  subTitle: { fontSize: font.sm, fontWeight: "500" },
  meta: { fontSize: font.xs, marginTop: 2 },
});
