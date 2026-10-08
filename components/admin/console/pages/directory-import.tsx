import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { getApiBaseUrl } from "@/constants/oauth";
import { getAuthorizationHeader } from "@/lib/_core/auth";
import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";

import { pickFile } from "../files";
import { font, useAdminTheme } from "../theme";
import { Alert, Badge, Button, Card, CellText, DataTable, Dialog, Grid, Hint, KpiCard } from "../ui";

type ImportReport = {
  applied: boolean;
  total: number;
  cities: string[];
  adds: { id: string; name: string; city: string; dutyGroup: number | null }[];
  updates: { id: string; name: string; city: string; changes: string[] }[];
  unchanged: number;
  skipped: { line: number; city: string; name: string; reason: string }[];
  warnings: string[];
};

async function sendWorkbook(file: File, apply: boolean): Promise<ImportReport> {
  const response = await fetch(`${getApiBaseUrl()}/api/admin/import/pharmacies${apply ? "?apply=1" : ""}`, {
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
 * Import du tableur de l'annuaire (mêmes colonnes que `pnpm import:pharmacies`) : un aperçu d'abord,
 * puis l'application des ajouts et modifications, qui deviennent des fiches administrées.
 */
export function DirectoryImportDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useAdminTheme();
  const utils = trpc.useUtils();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setReport(null);
    setError(null);
    setPending(null);
  };
  const close = () => {
    reset();
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
      setReport(await sendWorkbook(picked, false));
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
      const applied = await sendWorkbook(file, true);
      haptic.success();
      setReport(applied);
      await Promise.all([utils.admin.directory.list.invalidate(), utils.admin.duty.overview.invalidate(), utils.admin.dashboard.invalidate()]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import impossible.");
    } finally {
      setPending(null);
    }
  };
  const changes = report ? report.adds.length + report.updates.length : 0;

  return (
    <Dialog
      visible={visible}
      title="Importer un fichier Excel"
      description="Colonnes lues : Ville, Pharmacie, Téléphone, Groupe, Situation géographique, Latitude, Longitude."
      onClose={close}
      width={860}
      footer={
        report?.applied ? (
          <Button label="Terminer" variant="primary" onPress={close} />
        ) : (
          <>
            <Button label="Annuler" onPress={close} disabled={!!pending} />
            {report ? <Button label="Choisir un autre fichier" icon="upload-file" onPress={choose} disabled={!!pending} /> : null}
            <Button
              label={report ? `Appliquer ${changes} changement${changes > 1 ? "s" : ""}` : "Choisir le fichier (.xlsx)"}
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
          {"Les pharmacies du fichier sont comparées à l’annuaire publié. Vous voyez d’abord les ajouts, les modifications et les lignes rejetées ; rien n’est enregistré avant « Appliquer ». Les horaires propres et les assurances déjà saisis sont conservés."}
        </Alert>
      ) : null}
      {pending === "preview" ? <Hint>Lecture de « {file?.name} »…</Hint> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {report ? (
        <>
          {report.applied ? <Alert tone="success" title="Import appliqué">{`${report.adds.length} fiche(s) ajoutée(s) et ${report.updates.length} modifiée(s), publiées immédiatement dans l’application.`}</Alert> : null}
          <Text style={[styles.file, { color: theme.textSecondary }]}>{file?.name} · {report.total} pharmacies lues · {report.cities.join(", ")}</Text>
          <Grid columns={4}>
            <KpiCard label="À ajouter" value={String(report.adds.length)} icon="add-circle-outline" tone="success" />
            <KpiCard label="À modifier" value={String(report.updates.length)} icon="edit" tone="info" />
            <KpiCard label="Inchangées" value={String(report.unchanged)} icon="check" tone="neutral" />
            <KpiCard label="Lignes rejetées" value={String(report.skipped.length)} icon="block" tone={report.skipped.length ? "danger" : "neutral"} />
          </Grid>
          {report.adds.length || report.updates.length ? (
            <Card title="Changements" padded={false}>
              <DataTable
                columns={[
                  { key: "type", label: "", width: 110 },
                  { key: "name", label: "Pharmacie", flex: 2 },
                  { key: "city", label: "Ville", flex: 1 },
                  { key: "detail", label: "Détail", flex: 2 },
                ]}
                rows={[...report.adds.map((row) => ({ ...row, type: "add" as const, detail: row.dutyGroup ? `Groupe ${row.dutyGroup}` : "Sans groupe" })), ...report.updates.map((row) => ({ ...row, type: "update" as const, detail: row.changes.join(", ") }))]}
                rowKey={(row) => `${row.type}-${row.id}`}
                minWidth={620}
                renderCell={(row, key) => {
                  if (key === "type") return <Badge label={row.type === "add" ? "Ajout" : "Modification"} tone={row.type === "add" ? "success" : "info"} />;
                  if (key === "name") return <CellText strong>{row.name}</CellText>;
                  if (key === "city") return <CellText>{row.city}</CellText>;
                  return <CellText muted>{row.detail}</CellText>;
                }}
              />
            </Card>
          ) : null}
          {report.skipped.length ? (
            <Card title="Lignes rejetées" description="Corrigez ces lignes dans le fichier puis importez-le de nouveau." padded={false}>
              <DataTable
                columns={[
                  { key: "line", label: "Ligne", width: 80 },
                  { key: "name", label: "Pharmacie", flex: 2 },
                  { key: "city", label: "Ville", flex: 1 },
                  { key: "reason", label: "Motif", flex: 2 },
                ]}
                rows={report.skipped}
                rowKey={(row) => String(row.line)}
                minWidth={620}
                renderCell={(row, key) => {
                  if (key === "line") return <CellText mono>{row.line}</CellText>;
                  if (key === "name") return <CellText strong>{row.name || "—"}</CellText>;
                  if (key === "city") return <CellText>{row.city || "—"}</CellText>;
                  return <CellText muted>{row.reason}</CellText>;
                }}
              />
            </Card>
          ) : null}
          {report.warnings.length ? (
            <View style={styles.warnings}>
              <Text style={[styles.warningTitle, { color: theme.text }]}>Avertissements ({report.warnings.length})</Text>
              {report.warnings.slice(0, 12).map((warning) => <Hint key={warning}>{warning}</Hint>)}
              {report.warnings.length > 12 ? <Hint>… et {report.warnings.length - 12} autres.</Hint> : null}
            </View>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  file: { fontSize: font.sm },
  warnings: { gap: 4 },
  warningTitle: { fontSize: font.sm, fontWeight: "600" },
});
