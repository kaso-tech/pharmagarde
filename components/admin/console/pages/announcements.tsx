import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

import { AdminPage } from "../shell";
import { formatDutyDate } from "../shared";
import { font, radius, toneColors, useAdminLayout, useAdminTheme, type Tone } from "../theme";
import { Alert, Badge, Button, Card, ConfirmDialog, DataState, Dialog, Field, FieldLabel, Hint, IconButton, Segmented, SelectField } from "../ui";

type Announcement = inferRouterOutputs<AppRouter>["admin"]["announcements"]["list"][number];

const STATUS: Record<Announcement["status"], { label: string; tone: Tone }> = {
  live: { label: "En ligne", tone: "success" },
  scheduled: { label: "Programmée", tone: "info" },
  disabled: { label: "Désactivée", tone: "neutral" },
  ended: { label: "Terminée", tone: "neutral" },
};

const TONES: { value: Announcement["tone"]; label: string; tone: Tone; icon: "campaign" | "warning-amber" | "report" }[] = [
  { value: "info", label: "Information", tone: "info", icon: "campaign" },
  { value: "warning", label: "Attention", tone: "warning", icon: "warning-amber" },
  { value: "danger", label: "Urgent", tone: "danger", icon: "report" },
];

/** « 2026-10-08 14:30 » (heure du Burkina Faso, UTC) → ISO. */
export function parseConsoleDateTime(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0"] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  return Number.isFinite(date.getTime()) && date.getUTCDate() === Number(day) ? date : null;
}

function formatConsoleDateTime(value: string | Date | null) {
  if (!value) return "";
  const iso = new Date(value).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

type FormState = { id?: number; city: string; title: string; body: string; tone: Announcement["tone"]; startsAt: string; endsAt: string; active: boolean };

function formFrom(announcement: Announcement | null): FormState {
  return {
    id: announcement?.id,
    city: announcement?.city ?? "",
    title: announcement?.title ?? "",
    body: announcement?.body ?? "",
    tone: announcement?.tone ?? "info",
    startsAt: formatConsoleDateTime(announcement?.startsAt ?? new Date()),
    endsAt: formatConsoleDateTime(announcement?.endsAt ?? null),
    active: announcement?.active ?? true,
  };
}

function Preview({ form }: { form: FormState }) {
  const theme = useAdminTheme();
  const tone = TONES.find((item) => item.value === form.tone) ?? TONES[0];
  const { fg } = toneColors(theme, tone.tone);
  return (
    <View style={[styles.preview, { borderColor: fg, backgroundColor: theme.surface }]}>
      <MaterialIcons name={tone.icon} size={18} color={fg} />
      <View style={styles.flex}>
        <Text style={[styles.previewTitle, { color: theme.text }]}>{form.title || "Titre de l’annonce"}</Text>
        <Text style={[styles.previewBody, { color: theme.textMuted }]}>{form.body || "Texte affiché sous le titre, en haut de l’accueil de l’application."}</Text>
      </View>
    </View>
  );
}

function AnnouncementDialog({ form, setForm, cities, onClose }: { form: FormState | null; setForm: (next: FormState) => void; cities: string[]; onClose: () => void }) {
  const { desktop } = useAdminLayout();
  const utils = trpc.useUtils();
  const save = trpc.admin.announcements.save.useMutation({
    onSuccess: async () => {
      haptic.success();
      await utils.admin.announcements.list.invalidate();
      onClose();
    },
  });
  if (!form) return null;
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  const startsAt = parseConsoleDateTime(form.startsAt);
  const endsAt = form.endsAt.trim() ? parseConsoleDateTime(form.endsAt) : null;
  const startError = !startsAt ? "Format attendu : AAAA-MM-JJ HH:MM" : null;
  const endError = form.endsAt.trim() && !endsAt ? "Format attendu : AAAA-MM-JJ HH:MM" : endsAt && startsAt && endsAt <= startsAt ? "La fin doit suivre le début." : null;
  const valid = form.title.trim().length >= 3 && form.body.trim().length >= 3 && !startError && !endError;
  return (
    <Dialog
      visible
      title={form.id ? "Modifier l’annonce" : "Nouvelle annonce"}
      description="Affichée en haut de l’accueil de l’application, pendant la période choisie. Chaque utilisateur peut la fermer."
      onClose={onClose}
      width={680}
      footer={
        <>
          <Button label="Annuler" onPress={onClose} />
          <Button
            label={form.id ? "Enregistrer" : "Publier"}
            variant="primary"
            icon="check"
            loading={save.isPending}
            disabled={!valid}
            onPress={() => save.mutate({ id: form.id, city: form.city || null, title: form.title.trim(), body: form.body.trim(), tone: form.tone, startsAt: startsAt!, endsAt, active: form.active })}
          />
        </>
      }
    >
      {save.error ? <Alert tone="danger">{save.error.message}</Alert> : null}
      <View style={desktop ? styles.row : undefined}>
        <SelectField style={styles.flex} label="Ville" value={form.city} options={[{ value: "", label: "Toutes les villes" }, ...cities.map((city) => ({ value: city, label: city }))]} onChange={(city) => set({ city })} />
        <View style={[styles.flex, styles.field]}>
          <FieldLabel>Type</FieldLabel>
          <Segmented value={form.tone} onChange={(tone) => set({ tone: tone as FormState["tone"] })} options={TONES.map(({ value, label }) => ({ value, label }))} />
        </View>
      </View>
      <Field label="Titre" value={form.title} onChangeText={(title) => set({ title })} placeholder="Ex. Rupture d’insuline à Bobo-Dioulasso" />
      <Field label="Texte" value={form.body} onChangeText={(body) => set({ body })} multiline placeholder="Informations utiles, où s’adresser, jusqu’à quand…" hint={`${form.body.length}/600 caractères`} error={form.body.length > 600 ? "600 caractères au maximum." : null} />
      <View style={desktop ? styles.row : undefined}>
        <Field style={styles.flex} label="Début (heure du Burkina)" value={form.startsAt} onChangeText={(value) => set({ startsAt: value })} placeholder="2026-10-08 08:00" error={startError} />
        <Field style={styles.flex} label="Fin (facultatif)" value={form.endsAt} onChangeText={(value) => set({ endsAt: value })} placeholder="2026-10-15 20:00" error={endError} hint={endError ? undefined : "Sans fin, l’annonce reste affichée jusqu’à sa désactivation."} />
      </View>
      <Segmented value={form.active ? "on" : "off"} onChange={(value) => set({ active: value === "on" })} options={[{ value: "on", label: "Active" }, { value: "off", label: "Désactivée" }]} />
      <View style={styles.field}>
        <FieldLabel>Aperçu</FieldLabel>
        <Preview form={form} />
      </View>
    </Dialog>
  );
}

export function AnnouncementsPage() {
  const theme = useAdminTheme();
  const utils = trpc.useUtils();
  const list = trpc.admin.announcements.list.useQuery(undefined, { retry: 1 });
  const cities = trpc.admin.cities.list.useQuery(undefined, { retry: 1, staleTime: 5 * 60_000 });
  const [form, setForm] = useState<FormState | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Announcement | null>(null);
  const remove = trpc.admin.announcements.remove.useMutation({
    onSuccess: async () => {
      haptic.success();
      setRemoveTarget(null);
      await utils.admin.announcements.list.invalidate();
    },
  });
  const rows = list.data ?? [];
  const cityNames = (cities.data?.cities ?? []).filter((city) => city.published).map((city) => city.name);

  return (
    <AdminPage section="announcements" actions={<Button label="Nouvelle annonce" icon="add" variant="primary" onPress={() => setForm(formFrom(null))} />}>
      <Card padded={false}>
        <DataState loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={!rows.length} emptyTitle="Aucune annonce" emptyMessage="Publiez un bandeau pour signaler une pénurie, une campagne de vaccination ou une panne.">
          {rows.map((announcement, index) => {
            const tone = TONES.find((item) => item.value === announcement.tone) ?? TONES[0];
            const { fg, bg } = toneColors(theme, tone.tone);
            return (
              <View key={announcement.id} style={[styles.item, index < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                <View style={[styles.icon, { backgroundColor: bg }]}>
                  <MaterialIcons name={tone.icon} size={18} color={fg} />
                </View>
                <View style={styles.flex}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, { color: theme.text }]}>{announcement.title}</Text>
                    <Badge label={STATUS[announcement.status].label} tone={STATUS[announcement.status].tone} dot />
                  </View>
                  <Text style={[styles.body, { color: theme.textSecondary }]} numberOfLines={2}>{announcement.body}</Text>
                  <Text style={[styles.meta, { color: theme.textMuted }]}>
                    {announcement.city ?? "Toutes les villes"} · du {formatDutyDate(announcement.startsAt)}
                    {announcement.endsAt ? ` au ${formatDutyDate(announcement.endsAt)}` : ", sans date de fin"}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <IconButton icon="edit" label="Modifier" onPress={() => setForm(formFrom(announcement))} />
                  <IconButton icon="delete-outline" label="Supprimer" tone="danger" onPress={() => setRemoveTarget(announcement)} />
                </View>
              </View>
            );
          })}
        </DataState>
      </Card>
      <Hint>Les dates sont à l’heure du Burkina Faso. L’application relit les annonces à l’ouverture et toutes les 30 minutes.</Hint>
      <AnnouncementDialog form={form} setForm={setForm} cities={cityNames} onClose={() => setForm(null)} />
      <ConfirmDialog
        visible={!!removeTarget}
        title="Supprimer cette annonce ?"
        message={`« ${removeTarget?.title ?? ""} » disparaîtra de l’application. Pour la retirer temporairement, désactivez-la plutôt.`}
        confirmLabel="Supprimer"
        loading={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate({ id: removeTarget.id })}
        onClose={() => setRemoveTarget(null)}
      />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  field: { gap: 6 },
  item: { flexDirection: "row", gap: 12, padding: 16, alignItems: "flex-start" },
  icon: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  title: { fontSize: font.md, fontWeight: "600" },
  body: { fontSize: font.sm, lineHeight: 20, marginTop: 4 },
  meta: { fontSize: font.xs, marginTop: 6 },
  actions: { flexDirection: "row", gap: 4 },
  preview: { flexDirection: "row", gap: 9, borderWidth: 1, borderRadius: 18, padding: 12, alignItems: "flex-start" },
  previewTitle: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  previewBody: { fontSize: 13, lineHeight: 19 },
});
