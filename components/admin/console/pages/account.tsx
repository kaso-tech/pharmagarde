import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { setSessionToken } from "@/lib/_core/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/pharmagarde/auth-validation";
import { trpc } from "@/lib/trpc";

import { ADMIN_ROLE_DESCRIPTIONS, ADMIN_ROLE_LABELS } from "@/shared/admin-roles";

import { AdminPage } from "../shell";
import { displayIdentity, formatDate, formatRelative } from "../shared";
import { font, useAdminLayout, useAdminTheme } from "../theme";
import { Alert, Avatar, Badge, Button, Card, DataState, Field, Hint, IconButton } from "../ui";

function Fact({ label, value }: { label: string; value: string }) {
  const theme = useAdminTheme();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.factValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

/** « Chrome · Windows » à partir de l'en-tête User-Agent. */
export function describeDevice(userAgent: string | null) {
  if (!userAgent) return "Appareil inconnu";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : /okhttp|Expo|CFNetwork/i.test(userAgent) ? "Application" : "Navigateur";
  const system = /Android/.test(userAgent) ? "Android" : /iPhone|iPad|iOS/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X|Macintosh/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : null;
  return system ? `${browser} · ${system}` : browser;
}

function ConsoleSessions() {
  const theme = useAdminTheme();
  const utils = trpc.useUtils();
  const sessions = trpc.admin.account.sessions.useQuery(undefined, { retry: 1 });
  const refresh = () => utils.admin.account.sessions.invalidate();
  const revoke = trpc.admin.account.revokeSession.useMutation({ onSuccess: refresh });
  const revokeOthers = trpc.admin.account.revokeOtherSessions.useMutation({ onSuccess: refresh });
  const rows = sessions.data ?? [];
  const others = rows.filter((row) => row.active && !row.current).length;
  return (
    <Card
      title="Accès à la console"
      description="Appareils sur lesquels le code SMS a été saisi. Un accès dure 12 heures ; fermez ceux que vous ne reconnaissez pas."
      padded={false}
      actions={others ? <Button size="sm" label="Fermer les autres accès" icon="logout" loading={revokeOthers.isPending} onPress={() => revokeOthers.mutate()} /> : undefined}
    >
      {revoke.error || revokeOthers.error ? <View style={styles.cardAlert}><Alert tone="danger">{revoke.error?.message ?? revokeOthers.error?.message}</Alert></View> : null}
      <DataState loading={sessions.isLoading} error={sessions.error} onRetry={() => sessions.refetch()} empty={!rows.length} emptyTitle="Aucun accès enregistré" emptyMessage="Le double facteur n’est pas actif sur ce serveur, ou la migration 0012 n’est pas appliquée.">
        {rows.map((row, index) => (
          <View key={row.id} style={[styles.session, index < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
            <View style={styles.flex}>
              <View style={styles.sessionTitle}>
                <Text style={[styles.factValue, { color: theme.text }]}>{describeDevice(row.userAgent)}</Text>
                {row.current ? <Badge label="Cet appareil" tone="brand" /> : row.active ? <Badge label="Actif" tone="success" dot /> : <Badge label="Fermé" tone="neutral" dot />}
              </View>
              <Text style={[styles.factLabel, { color: theme.textMuted }]}>
                {row.ip ? `${row.ip} · ` : ""}ouvert le {formatDate(row.createdAt)} · vu {formatRelative(row.lastSeenAt)}
              </Text>
            </View>
            {row.active && !row.current ? <IconButton icon="logout" label="Fermer cet accès" tone="danger" onPress={() => revoke.mutate({ id: row.id })} /> : null}
          </View>
        ))}
      </DataState>
    </Card>
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
      await Promise.all([utils.admin.account.get.invalidate(), utils.admin.account.sessions.invalidate()]);
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
                <Badge label={data.adminRole ? ADMIN_ROLE_LABELS[data.adminRole] : "Administrateur"} tone="brand" icon="verified-user" />
              </View>
              {data.adminRole ? <Hint>{ADMIN_ROLE_DESCRIPTIONS[data.adminRole]}</Hint> : null}
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

              <ConsoleSessions />
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
  session: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  sessionTitle: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  cardAlert: { padding: 16 },
});
