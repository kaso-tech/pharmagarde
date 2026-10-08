import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { setSessionToken } from "@/lib/_core/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/pharmagarde/auth-validation";
import { trpc } from "@/lib/trpc";

import { AdminPage } from "../shell";
import { displayIdentity, formatDate } from "../shared";
import { font, useAdminLayout, useAdminTheme } from "../theme";
import { Alert, Avatar, Badge, Button, Card, DataState, Field } from "../ui";

function Fact({ label, value }: { label: string; value: string }) {
  const theme = useAdminTheme();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.factValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

export function AccountPage() {
  const utils = trpc.useUtils();
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const account = trpc.admin.account.get.useQuery(undefined, { retry: 1 });
  const [profile, setProfile] = useState<{ name: string; email: string } | null>(null);
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [notice, setNotice] = useState<{ area: "profile" | "password"; text: string } | null>(null);

  const data = account.data;
  const form = profile ?? { name: data?.name ?? "", email: data?.email ?? "" };
  const update = trpc.admin.account.update.useMutation({
    onSuccess: async () => {
      setProfile(null);
      setNotice({ area: "profile", text: "Profil enregistré." });
      await Promise.all([utils.admin.account.get.invalidate(), utils.admin.access.invalidate()]);
    },
  });
  const changePassword = trpc.admin.account.changePassword.useMutation({
    onSuccess: async ({ token }) => {
      // Les autres sessions sont révoquées : la session en cours continue avec le nouveau jeton.
      await setSessionToken(token);
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setNotice({ area: "password", text: "Mot de passe modifié. Vos autres appareils ont été déconnectés." });
      await utils.admin.account.get.invalidate();
    },
  });

  const profileChanged = !!data && (form.name.trim() !== (data.name ?? "") || form.email.trim().toLowerCase() !== (data.email ?? ""));
  const profileInvalid = form.name.trim().length < 2;
  const tooShort = passwords.newPassword.length > 0 && passwords.newPassword.trim().length < MIN_PASSWORD_LENGTH;
  const mismatch = passwords.confirmPassword.length > 0 && passwords.newPassword !== passwords.confirmPassword;
  const passwordIncomplete = (data?.hasPassword && !passwords.currentPassword) || !passwords.newPassword || !passwords.confirmPassword || tooShort || mismatch;
  const editProfile = (key: "name" | "email", value: string) => {
    setNotice(null);
    setProfile({ ...form, [key]: value });
  };
  const editPassword = (key: keyof typeof passwords, value: string) => {
    setNotice(null);
    setPasswords((current) => ({ ...current, [key]: value }));
  };

  return (
    <AdminPage section="account">
      <DataState loading={account.isLoading} error={account.error} onRetry={() => account.refetch()}>
        {data ? (
          <View style={[styles.layout, desktop && styles.layoutDesktop]}>
            <Card style={desktop ? styles.aside : undefined}>
              <View style={styles.identity}>
                <Avatar label={displayIdentity(data)} size={64} />
                <Text style={[styles.identityName, { color: theme.text }]}>{displayIdentity(data)}</Text>
                <Badge label={data.role === "admin" ? "Administrateur" : "Utilisateur"} tone="brand" icon="verified-user" />
              </View>
              <Fact label="Téléphone (identifiant de connexion)" value={data.phone ?? "—"} />
              <Fact label="Vérification du téléphone" value={data.phoneVerifiedAt ? `Vérifié le ${formatDate(data.phoneVerifiedAt)}` : "Non vérifié"} />
              <Fact label="Compte créé le" value={formatDate(data.createdAt)} />
              <Fact label="Dernière connexion" value={formatDate(data.lastSignedIn)} />
            </Card>

            <View style={[styles.main, desktop && styles.flex]}>
              <Card
                title="Profil"
                description="Nom et adresse e-mail du compte. Le téléphone sert d’identifiant et ne se modifie pas ici."
                footer={
                  <View style={styles.footer}>
                    {notice?.area === "profile" ? <Text style={[styles.notice, { color: theme.success }]}>{notice.text}</Text> : <View style={styles.flex} />}
                    <Button label="Annuler" disabled={!profileChanged || update.isPending} onPress={() => setProfile(null)} />
                    <Button label="Enregistrer" variant="primary" loading={update.isPending} disabled={!profileChanged || profileInvalid} onPress={() => update.mutate({ name: form.name.trim(), email: form.email.trim() })} />
                  </View>
                }
              >
                <View style={desktop ? styles.row : styles.column}>
                  <Field style={styles.flex} label="Nom" value={form.name} onChangeText={(value) => editProfile("name", value)} autoComplete="name" error={profileInvalid && profile ? "Au moins 2 caractères." : null} />
                  <Field style={styles.flex} label="Adresse e-mail" value={form.email} onChangeText={(value) => editProfile("email", value)} placeholder="Facultatif" keyboardType="email-address" autoComplete="email" />
                </View>
                {update.error ? <Alert tone="danger">{update.error.message}</Alert> : null}
              </Card>

              <Card
                title="Mot de passe"
                description={`Au moins ${MIN_PASSWORD_LENGTH} caractères. Après le changement, vos autres appareils sont déconnectés.`}
                footer={
                  <View style={styles.footer}>
                    {notice?.area === "password" ? <Text style={[styles.notice, { color: theme.success }]}>{notice.text}</Text> : <View style={styles.flex} />}
                    <Button label="Changer le mot de passe" variant="primary" icon="lock-reset" loading={changePassword.isPending} disabled={!!passwordIncomplete} onPress={() => changePassword.mutate(passwords)} />
                  </View>
                }
              >
                {data.hasPassword ? <Field label="Mot de passe actuel" value={passwords.currentPassword} onChangeText={(value) => editPassword("currentPassword", value)} secure autoComplete="current-password" /> : <Alert tone="info">Ce compte n’a pas encore de mot de passe : définissez-en un.</Alert>}
                <View style={desktop ? styles.row : styles.column}>
                  <Field style={styles.flex} label="Nouveau mot de passe" value={passwords.newPassword} onChangeText={(value) => editPassword("newPassword", value)} secure autoComplete="new-password" error={tooShort ? `Au moins ${MIN_PASSWORD_LENGTH} caractères.` : null} />
                  <Field style={styles.flex} label="Confirmer le nouveau mot de passe" value={passwords.confirmPassword} onChangeText={(value) => editPassword("confirmPassword", value)} secure autoComplete="new-password" error={mismatch ? "Les deux mots de passe ne correspondent pas." : null} />
                </View>
                {changePassword.error ? <Alert tone="danger">{changePassword.error.message}</Alert> : null}
              </Card>
            </View>
          </View>
        ) : null}
      </DataState>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  layout: { gap: 24 },
  layoutDesktop: { flexDirection: "row", alignItems: "flex-start" },
  aside: { width: 320 },
  main: { gap: 24 },
  identity: { alignItems: "center", gap: 8, paddingBottom: 8 },
  identityName: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  fact: { gap: 2 },
  factLabel: { fontSize: font.xs },
  factValue: { fontSize: font.md, fontWeight: "500" },
  row: { flexDirection: "row", gap: 16 },
  column: { gap: 16 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  notice: { flex: 1, fontSize: font.sm, fontWeight: "500" },
});
