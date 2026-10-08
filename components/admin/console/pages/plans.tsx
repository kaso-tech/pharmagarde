import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

import { AdminPage } from "../shell";
import { formatCount, formatXof, numberOrNull } from "../shared";
import { font, useAdminLayout, useAdminTheme } from "../theme";
import { Alert, Badge, Button, Card, DataState, Dialog, Field, Grid, Hint, Segmented } from "../ui";

type Plan = inferRouterOutputs<AppRouter>["admin"]["plans"]["list"][number];

function PlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { desktop } = useAdminLayout();
  const utils = trpc.useUtils();
  const [label, setLabel] = useState(plan.label);
  const [amount, setAmount] = useState(String(plan.amount));
  const [duration, setDuration] = useState(String(plan.durationDays));
  const [active, setActive] = useState(plan.active);
  const done = async () => {
    haptic.success();
    await utils.admin.plans.list.invalidate();
    onClose();
  };
  const save = trpc.admin.plans.save.useMutation({ onSuccess: done });
  const reset = trpc.admin.plans.reset.useMutation({ onSuccess: done });
  const amountValue = numberOrNull(amount);
  const durationValue = numberOrNull(duration);
  const amountError = amountValue === null || amountValue < 100 || !Number.isInteger(amountValue) ? "Montant entier d’au moins 100 F CFA." : null;
  const durationError = durationValue === null || durationValue < 1 || durationValue > 730 || !Number.isInteger(durationValue) ? "Durée entière entre 1 et 730 jours." : null;
  return (
    <Dialog
      visible
      title={`Formule « ${plan.label} »`}
      description="Les nouveaux paiements utilisent ces valeurs ; les abonnements déjà payés ne changent pas."
      onClose={onClose}
      footer={
        <>
          {plan.custom ? <Button label="Valeurs d’origine" variant="ghost" icon="restart-alt" loading={reset.isPending} onPress={() => reset.mutate({ id: plan.id })} style={styles.left} /> : null}
          <Button label="Annuler" onPress={onClose} />
          <Button label="Enregistrer" variant="primary" icon="check" loading={save.isPending} disabled={label.trim().length < 2 || !!amountError || !!durationError} onPress={() => save.mutate({ id: plan.id, label: label.trim(), amount: amountValue!, durationDays: durationValue!, active })} />
        </>
      }
    >
      {save.error ? <Alert tone="danger">{save.error.message}</Alert> : null}
      {reset.error ? <Alert tone="danger">{reset.error.message}</Alert> : null}
      <Field label="Libellé affiché" value={label} onChangeText={setLabel} placeholder="Ex. 1 mois" />
      <View style={desktop ? styles.row : undefined}>
        <Field style={styles.flex} label="Prix (F CFA)" keyboardType="numeric" value={amount} onChangeText={setAmount} error={amount ? amountError : null} />
        <Field style={styles.flex} label="Durée (jours)" keyboardType="numeric" value={duration} onChangeText={setDuration} error={duration ? durationError : null} />
      </View>
      <Segmented value={active ? "on" : "off"} onChange={(value) => setActive(value === "on")} options={[{ value: "on", label: "Proposée dans l’application" }, { value: "off", label: "Masquée" }]} />
    </Dialog>
  );
}

export function PlansPage() {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const list = trpc.admin.plans.list.useQuery(undefined, { retry: 1 });
  const [editing, setEditing] = useState<Plan | null>(null);
  const plans = list.data ?? [];
  return (
    <AdminPage section="plans">
      <DataState loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={!plans.length} emptyTitle="Aucune formule">
        <Grid columns={desktop ? 4 : 1}>
          {plans.map((plan) => (
            <Card key={plan.id} title={plan.label} actions={<Badge label={plan.active ? "Proposée" : "Masquée"} tone={plan.active ? "success" : "neutral"} dot />}>
              <Text style={[styles.price, { color: theme.text }]}>{formatXof(plan.amount)}</Text>
              <Text style={[styles.meta, { color: theme.textMuted }]}>{plan.durationDays} jours · {formatXof(Math.round((plan.amount / plan.durationDays) * 30))} par mois</Text>
              <View style={[styles.stats, { borderTopColor: theme.border }]}>
                <Text style={[styles.meta, { color: theme.textSecondary }]}>{formatCount(plan.sales)} paiement{plan.sales > 1 ? "s" : ""} réussi{plan.sales > 1 ? "s" : ""}</Text>
                <Text style={[styles.meta, { color: theme.textSecondary }]}>{formatXof(plan.revenue)} encaissés</Text>
              </View>
              <Hint>{plan.custom ? "Modifiée depuis la console." : "Valeurs d’origine."}</Hint>
              <Button label="Modifier" icon="edit" onPress={() => setEditing(plan)} />
            </Card>
          ))}
        </Grid>
      </DataState>
      <Hint>Une formule masquée n’est plus proposée ; un paiement déjà commencé avec elle reste valable. Au moins une formule doit rester proposée.</Hint>
      {editing ? <PlanDialog key={editing.id} plan={editing} onClose={() => setEditing(null)} /> : null}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  left: { marginRight: "auto" },
  price: { fontSize: 26, fontWeight: "700" },
  meta: { fontSize: font.sm },
  stats: { borderTopWidth: 1, paddingTop: 12, marginTop: 4, gap: 4 },
});
