import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { createContext, useContext, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/hooks/use-auth";
import { haptic } from "@/lib/pharmagarde/premium-ui";
import { trpc } from "@/lib/trpc";
import { ADMIN_AREAS, ADMIN_ROLE_LABELS, type AdminAccess, type AdminArea, type AdminRole } from "@/shared/admin-roles";

import type { AdminSection } from "./shared";
import { font, radius, useAdminTheme } from "./theme";
import { Alert, Button, Field, Hint } from "./ui";

export type ConsoleAccess = { role: AdminRole; permissions: Record<AdminArea, AdminAccess> };

const FULL_ACCESS: ConsoleAccess = { role: "super_admin", permissions: Object.fromEntries(ADMIN_AREAS.map((area) => [area, "write"])) as Record<AdminArea, AdminAccess> };

export const ConsoleAccessContext = createContext<ConsoleAccess>(FULL_ACCESS);

export function useConsoleAccess() {
  return useContext(ConsoleAccessContext);
}

/** Zone de droits d'une page (« Mon compte » n'en a pas : toujours accessible). */
export function sectionArea(section: AdminSection): AdminArea | null {
  return section === "account" ? null : section;
}

export function canReadSection(access: ConsoleAccess, section: AdminSection) {
  const area = sectionArea(section);
  return !area || access.permissions[area] !== "none";
}

export function useCanWrite(section: AdminSection) {
  const access = useConsoleAccess();
  const area = sectionArea(section);
  return !area || access.permissions[area] === "write";
}

export function useCanRead(area: AdminArea) {
  return useConsoleAccess().permissions[area] !== "none";
}

export function roleLabel(role: AdminRole) {
  return ADMIN_ROLE_LABELS[role];
}

/** Écran du code SMS demandé à l'ouverture de la console sur un nouvel appareil (et toutes les 12 h). */
export function SecondFactorScreen({ phone, onVerified }: { phone: string | null; onVerified: () => void }) {
  const theme = useAdminTheme();
  const { logout } = useAuth({ autoFetch: false });
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const request = trpc.admin.secondFactor.request.useMutation({ onSuccess: (result) => setSentTo(result.phone ?? phone) });
  const verify = trpc.admin.secondFactor.verify.useMutation({
    onSuccess: () => {
      haptic.success();
      onVerified();
    },
  });
  const error = request.error?.message ?? verify.error?.message;
  return (
    <View style={[styles.center, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[styles.icon, { backgroundColor: theme.brandSoft }]}>
          <MaterialIcons name="verified-user" size={26} color={theme.brandText} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Vérification de connexion</Text>
        <Text style={[styles.text, { color: theme.textMuted }]}>
          {sentTo ? `Saisissez le code à 6 chiffres envoyé par SMS au ${sentTo}.` : `Pour ouvrir la console sur cet appareil, un code va être envoyé par SMS${phone ? ` au ${phone}` : ""}. L’accès reste ouvert 12 heures.`}
        </Text>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {sentTo ? (
          <>
            <Field label="Code reçu par SMS" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} keyboardType="numeric" placeholder="123456" />
            <Button label="Valider" variant="primary" icon="check" loading={verify.isPending} disabled={code.length !== 6} onPress={() => verify.mutate({ code })} />
            <Button label="Renvoyer un code" variant="ghost" icon="refresh" loading={request.isPending} onPress={() => request.mutate()} />
          </>
        ) : (
          <Button label="Recevoir le code" variant="primary" icon="sms" loading={request.isPending} disabled={!phone} onPress={() => request.mutate()} />
        )}
        {!phone ? <Hint tone="danger">Ce compte n’a pas de numéro de téléphone : demandez à un super-admin d’en ajouter un.</Hint> : null}
        <Button label="Se déconnecter" variant="ghost" icon="logout" onPress={() => void logout()} />
      </View>
    </View>
  );
}

/** Page interdite au rôle du compte. */
export function ForbiddenSection({ role }: { role: AdminRole }) {
  const theme = useAdminTheme();
  return (
    <View style={[styles.center, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[styles.icon, { backgroundColor: theme.dangerSoft }]}>
          <MaterialIcons name="lock-outline" size={26} color={theme.danger} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Page non accessible</Text>
        <Text style={[styles.text, { color: theme.textMuted }]}>Votre rôle ({roleLabel(role)}) ne donne pas accès à cette page. Un super-admin peut modifier votre rôle.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: radius.lg, padding: 28, gap: 14 },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { fontSize: font.lg, fontWeight: "700", textAlign: "center" },
  text: { fontSize: font.sm, lineHeight: 20, textAlign: "center" },
});
