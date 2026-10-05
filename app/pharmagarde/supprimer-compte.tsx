import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { SUPPORT_EMAIL } from "@/app-identity";
import { AppChrome } from "@/components/pharmagarde/app-ui";
import { useAuth } from "@/hooks/use-auth";
import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";

const DELETED_DATA = [
  "Numéro de téléphone, adresse e-mail et mot de passe",
  "Accès à votre compte depuis tous vos appareils",
  "Abonnement Premium en cours, sans remboursement",
];

export default function DeleteAccountScreen() {
  const router = useRouter();
  const palette = usePremiumPalette();
  const { user, isAuthenticated, deleteAccount } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const needsPassword = user?.loginMethod === "phone_password";
  const canSubmit = confirmed && (!needsPassword || password.trim().length > 0) && !loading;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      await deleteAccount(password);
      haptic.success();
      setDone(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Impossible de supprimer le compte.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AppChrome subtitle="Compte">
        <View style={[styles.page, styles.center, { backgroundColor: palette.background }]}>
          <MaterialIcons name="check-circle" size={48} color={palette.brand} />
          <Text style={[styles.title, styles.centerText, { color: palette.text }]}>Compte supprimé</Text>
          <Text style={[styles.body, styles.centerText, { color: palette.muted }]}>Vos données de compte ont été effacées. Vous pouvez continuer à utiliser l’application sans compte.</Text>
          <Pressable onPress={() => router.replace("/(tabs)" as never)} style={({ pressed }) => [styles.primaryButton, { backgroundColor: palette.brand, opacity: pressed ? 0.86 : 1 }]}>
            <Text style={styles.primaryButtonText}>Retour à l’accueil</Text>
          </Pressable>
        </View>
      </AppChrome>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppChrome subtitle="Compte">
        <View style={[styles.page, styles.center, { backgroundColor: palette.background }]}>
          <Text style={[styles.body, styles.centerText, { color: palette.muted }]}>Connectez-vous pour supprimer votre compte, ou écrivez à {SUPPORT_EMAIL}.</Text>
          <Pressable onPress={() => router.push("/auth/login")} style={({ pressed }) => [styles.primaryButton, { backgroundColor: palette.brand, opacity: pressed ? 0.86 : 1 }]}>
            <Text style={styles.primaryButtonText}>Se connecter</Text>
          </Pressable>
        </View>
      </AppChrome>
    );
  }

  return (
    <AppChrome subtitle="Compte">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView style={[styles.page, { backgroundColor: palette.background }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: palette.text }]}>Supprimer mon compte</Text>
          <Text style={[styles.body, { color: palette.muted }]}>La suppression est immédiate et définitive. Compte concerné : {user?.phone ?? user?.email ?? "compte connecté"}.</Text>

          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[styles.cardTitle, { color: palette.text }]}>Seront supprimés</Text>
            {DELETED_DATA.map((item) => (
              <View key={item} style={styles.row}>
                <MaterialIcons name="remove-circle-outline" size={18} color={palette.danger} />
                <Text style={[styles.rowText, { color: palette.text }]}>{item}</Text>
              </View>
            ))}
            <Text style={[styles.note, { color: palette.muted }]}>Les enregistrements de paiement sont conservés sans lien avec votre identité, pour la durée légale de conservation des pièces comptables. Vos favoris restent sur cet appareil.</Text>
          </View>

          {needsPassword ? (
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: palette.text }]}>Mot de passe</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Confirmez avec votre mot de passe"
                placeholderTextColor={palette.muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { backgroundColor: palette.surface, borderColor: palette.border, color: palette.text }]}
              />
            </View>
          ) : null}

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: confirmed }}
            onPress={() => setConfirmed((value) => !value)}
            style={styles.row}
          >
            <MaterialIcons name={confirmed ? "check-box" : "check-box-outline-blank"} size={22} color={confirmed ? palette.danger : palette.muted} />
            <Text style={[styles.rowText, { color: palette.text }]}>Je comprends que cette action est définitive.</Text>
          </Pressable>

          {errorMessage ? <Text style={[styles.error, { color: palette.danger }]}>{errorMessage}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={({ pressed }) => [styles.primaryButton, { backgroundColor: canSubmit ? palette.danger : palette.border, opacity: pressed ? 0.86 : 1 }]}
          >
            {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Supprimer définitivement</Text>}
          </Pressable>

          <Text style={[styles.note, { color: palette.muted }]}>Un problème ? Écrivez à {SUPPORT_EMAIL}.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 16 },
  center: { alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  centerText: { textAlign: "center" },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "900" },
  body: { fontSize: 15, lineHeight: 22 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 15, lineHeight: 20, fontWeight: "900" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  note: { fontSize: 13, lineHeight: 19 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 14, fontWeight: "800" },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 15 },
  error: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  primaryButton: { minHeight: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 22, alignSelf: "stretch" },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
});
