import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { getApiBaseUrl } from "@/constants/oauth";
import { getAuthorizationHeader } from "@/lib/_core/auth";
import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";

import { pickFile } from "../files";
import { formatCount } from "../shared";
import { font, useAdminTheme } from "../theme";
import { Alert, Badge, Button, Card, CellText, DataTable, Dialog, Grid, Hint, KpiCard, Segmented } from "../ui";

type Row = { id: string; name: string; productType: string | null; dosage: string | null };
type ImportReport = {
  applied: boolean;
  hideMissing: boolean;
  total: number;
  counts: { adds: number; updates: number; unchanged: number; missing: number };
  adds: Row[];
  updates: (Row & { changes: string[] })[];
  missing: Row[];
  warnings: string[];
  warningCount: number;
};

async function sendWorkbook(file: File, options: { apply: boolean; hideMissing: boolean }): Promise<ImportReport> {
  const query = options.apply ? `?apply=1${options.hideMissing ? "&hideMissing=1" : ""}` : "";
  const response = await fetch(`${getApiBaseUrl()}/api/admin/import/medicines${query}`, {
    method: "POST",
    body: file,
    credentials: "include",
    headers: { ...(await getAuthorizationHeader()), "Content-Type": file.type || "application/octet-stream" },
  });
  const body = (await response.json().catch(() => ({}))) as Partial<ImportReport> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Import impossible (erreur ${response.status}).`);
  return body as ImportReport;
}

/**
 * Import du tableur de la Liste nationale (même fichier que `pnpm import:medicines`) : aperçu des
 * ajouts, modifications et produits absents du fichier, puis application dans la base.
 */
export function MedicinesImportDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useAdminTheme();
  const utils = trpc.useUtils();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [hideMissing, setHideMissing] = useState(false);
  const [pending, setPending] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setFile(null);
    setReport(null);
    setError(null);
    setPending(null);
    setHideMissing(false);
    onClose();
  };
  const choose = async () => {
    const picked = await pickFile(".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    if (!picked) return;
    setFile(picked);
    setReport(null);
    setError(null);
    setPending("preview");
    try {
      setReport(await sendWorkbook(picked, { apply: false, hideMissing: false }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import impossible.");
    } finally {
      setPending(null);
    }
  };
  const apply = async () => {
    if (!file) return;
    setPending("apply");
    setError(null);
    try {
      const applied = await sendWorkbook(file, { apply: true, hideMissing });
      haptic.success();
      setReport(applied);
      await utils.admin.medicines.invalidate();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import impossible.");
    } finally {
      setPending(null);
    }
  };
  const changes = report ? report.counts.adds + report.counts.updates + (hideMissing ? report.counts.missing : 0) : 0;
  const rows = report
    ? [
        ...report.adds.map((row) => ({ ...row, type: "add" as const, detail: row.dosage ?? "" })),
        ...report.updates.map((row) => ({ ...row, type: "update" as const, detail: row.changes.join(", ") })),
        ...(hideMissing ? report.missing.map((row) => ({ ...row, type: "hide" as const, detail: "Absent du fichier" })) : []),
      ]
    : [];
  const shown = rows.length;
  const total = changes;

  return (
    <Dialog
      visible={visible}
      title="Importer le catalogue des médicaments"
      description="Tableur de la Liste nationale, feuille « Tous les produits avec prix »."
      onClose={close}
      width={900}
      footer={
        report?.applied ? (
          <Button label="Terminer" variant="primary" onPress={close} />
        ) : (
          <>
            <Button label="Annuler" onPress={close} disabled={!!pending} />
            {report ? <Button label="Choisir un autre fichier" icon="upload-file" onPress={choose} disabled={!!pending} /> : null}
            <Button
              label={report ? `Appliquer ${formatCount(changes)} changement${changes > 1 ? "s" : ""}` : "Choisir le fichier (.xlsx)"}
              variant="primary"
              icon={report ? "check" : "upload-file"}
              loading={!!pending}
              disabled={!!report && changes === 0}
              onPress={report ? apply : choose}
            />
          </>
        )
      }
    >
      {!report && !pending ? (
        <Alert tone="info" title="Comment ça marche">
          {"Le fichier est comparé au catalogue publié : vous voyez les produits ajoutés, ceux dont le prix ou la description change, et ceux qui n’y figurent plus. Rien n’est enregistré avant « Appliquer ». Les produits masqués le restent."}
        </Alert>
      ) : null}
      {pending === "preview" ? <Hint>Lecture de « {file?.name} »…</Hint> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {report ? (
        <>
          {report.applied ? <Alert tone="success" title="Import appliqué">{`${formatCount(report.counts.adds)} produit(s) ajouté(s), ${formatCount(report.counts.updates)} modifié(s)${report.hideMissing ? ` et ${formatCount(report.counts.missing)} masqué(s)` : ""}. Le catalogue des abonnés est à jour.`}</Alert> : null}
          <Text style={[styles.file, { color: theme.textSecondary }]}>{file?.name} · {formatCount(report.total)} produits lus</Text>
          <Grid columns={4}>
            <KpiCard label="À ajouter" value={formatCount(report.counts.adds)} icon="add-circle-outline" tone="success" />
            <KpiCard label="À modifier" value={formatCount(report.counts.updates)} icon="edit" tone="info" />
            <KpiCard label="Inchangés" value={formatCount(report.counts.unchanged)} icon="check" tone="neutral" />
            <KpiCard label="Absents du fichier" value={formatCount(report.counts.missing)} icon="help-outline" tone={report.counts.missing ? "warning" : "neutral"} />
          </Grid>
          {report.counts.missing && !report.applied ? (
            <View style={styles.option}>
              <Text style={[styles.optionLabel, { color: theme.text }]}>Produits absents du fichier</Text>
              <Segmented value={hideMissing ? "hide" : "keep"} onChange={(value) => setHideMissing(value === "hide")} options={[{ value: "keep", label: "Les garder publiés" }, { value: "hide", label: "Les masquer" }]} />
            </View>
          ) : null}
          {rows.length ? (
            <Card title="Changements" description={total > shown ? `${formatCount(shown)} premières lignes sur ${formatCount(total)}.` : undefined} padded={false}>
              <DataTable
                columns={[
                  { key: "type", label: "", width: 120 },
                  { key: "name", label: "Produit", flex: 2 },
                  { key: "productType", label: "Type", flex: 1.2 },
                  { key: "detail", label: "Détail", flex: 2 },
                ]}
                rows={rows}
                rowKey={(row) => `${row.type}-${row.id}`}
                minWidth={680}
                renderCell={(row, key) => {
                  if (key === "type") return <Badge label={row.type === "add" ? "Ajout" : row.type === "update" ? "Modification" : "Masqué"} tone={row.type === "add" ? "success" : row.type === "update" ? "info" : "danger"} />;
                  if (key === "name") return <CellText strong>{row.name}</CellText>;
                  if (key === "productType") return <CellText muted>{row.productType ?? "—"}</CellText>;
                  return <CellText muted>{row.detail || "—"}</CellText>;
                }}
              />
            </Card>
          ) : null}
          {report.warningCount ? (
            <View style={styles.warnings}>
              <Text style={[styles.optionLabel, { color: theme.text }]}>Avertissements ({formatCount(report.warningCount)})</Text>
              {report.warnings.slice(0, 12).map((warning) => <Hint key={warning}>{warning}</Hint>)}
              {report.warningCount > 12 ? <Hint>… et {formatCount(report.warningCount - 12)} autres.</Hint> : null}
            </View>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  file: { fontSize: font.sm },
  option: { gap: 8 },
  optionLabel: { fontSize: font.sm, fontWeight: "600" },
  warnings: { gap: 4 },
});
