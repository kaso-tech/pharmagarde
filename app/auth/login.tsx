import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { formatBurkinaPhone, normalizeIdentifier, validateLoginForm } from "@/lib/pharmagarde/auth-validation";
import { usePremiumPalette } from "@/lib/pharmagarde/premium-ui";

export default function LoginScreen() {
  const router = useRouter();
  const palette = usePremiumPalette();
  const { login } = useAuth({ autoFetch: false });
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const errors = useMemo(() => validateLoginForm({ identifier, password }), [identifier, password]);
  const isValid = !errors.identifier && !errors.password;

  const submit = async () => {
    if (!isValid || loading) return;
    setLoading(true);
    setSubmitError(null);
    try {
      await login({ identifier: normalizeIdentifier(identifier), password, rememberMe });
      router.replace("/(tabs)");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Identifiants incorrects.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} className="px-5 py-4">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={styles.header}>
          <Text style={[styles.kicker, { color: palette.brand }]}>PharmaGarde BF</Text>
          <Text style={[styles.title, { color: palette.text }]}>Connexion</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>Connectez-vous pour accéder aux médicaments premium et aux paiements sécurisés.</Text>
        </View>

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
          <Field
            label="Téléphone ou email"
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="70 12 34 56 ou nom@email.com"
            keyboardType="email-address"
            error={identifier ? errors.identifier : undefined}
            helper={!identifier.includes("@") && identifier ? `Format détecté : ${formatBurkinaPhone(identifier)}` : undefined}
          />
          <PasswordField
            label="Mot de passe"
            value={password}
            onChangeText={setPassword}
            showPassword={showPassword}
            onTogglePassword={() => setShowPassword((value) => !value)}
            error={password ? errors.password : undefined}
          />

          <View style={styles.rememberRow}>
            <View style={styles.rememberCopy}>
              <Text style={[styles.rememberTitle, { color: palette.text }]}>Se souvenir de moi</Text>
              <Text style={[styles.rememberHint, { color: palette.muted }]}>Restaure automatiquement la session au lancement.</Text>
            </View>
            <Switch value={rememberMe} onValueChange={setRememberMe} trackColor={{ false: palette.border, true: palette.softGreen }} thumbColor={rememberMe ? palette.brand : "#f4f4f5"} />
          </View>

          {submitError ? <Text style={styles.errorBanner}>{submitError}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={!isValid || loading}
            style={({ pressed }) => [styles.primaryButton, { backgroundColor: isValid ? palette.brand : palette.border, opacity: pressed ? 0.86 : 1 }]}
          >
            {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Se connecter</Text>}
          </Pressable>

          <Pressable onPress={() => router.push("/auth/mot-de-passe-oublie")} style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.72 : 1 }]}>
            <Text style={[styles.secondaryButtonText, { color: palette.muted }]}>Mot de passe oublié ?</Text>
          </Pressable>

          <Pressable onPress={() => router.push("/auth/register")} style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.72 : 1 }]}>
            <Text style={[styles.secondaryButtonText, { color: palette.brand }]}>Créer un compte</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
  error?: string;
  helper?: string;
};

function Field({ label, value, onChangeText, placeholder, keyboardType = "default", error, helper }: FieldProps) {
  const palette = usePremiumPalette();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        style={[styles.input, { backgroundColor: palette.surface, borderColor: error ? palette.danger : palette.border, color: palette.text }]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : helper ? <Text style={[styles.helper, { color: palette.muted }]}>{helper}</Text> : null}
    </View>
  );
}

function PasswordField({ label, value, onChangeText, showPassword, onTogglePassword, error }: Omit<FieldProps, "placeholder" | "keyboardType"> & { showPassword: boolean; onTogglePassword: () => void }) {
  const palette = usePremiumPalette();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <View style={[styles.passwordRow, { backgroundColor: palette.surface, borderColor: error ? palette.danger : palette.border }]}> 
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="••••••••"
          placeholderTextColor={palette.muted}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          style={[styles.passwordInput, { color: palette.text }]}
        />
        <Pressable onPress={onTogglePassword} style={({ pressed }) => [styles.showButton, { opacity: pressed ? 0.7 : 1 }]}> 
          <Text style={[styles.showText, { color: palette.brand }]}>{showPassword ? "Masquer" : "Afficher"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: "center" },
  header: { marginBottom: 22 },
  kicker: { fontSize: 13, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  title: { fontSize: 34, lineHeight: 40, fontWeight: "900", marginTop: 8 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 10 },
  card: { borderWidth: 1, borderRadius: 28, padding: 18, gap: 16, shadowColor: "#0f172a", shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 12 } },
  fieldGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: "800" },
  input: { borderWidth: 1, borderRadius: 18, minHeight: 54, paddingHorizontal: 16, fontSize: 16 },
  passwordRow: { minHeight: 54, borderWidth: 1, borderRadius: 18, flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, minHeight: 54, paddingHorizontal: 16, fontSize: 16 },
  showButton: { paddingHorizontal: 14, minHeight: 54, justifyContent: "center" },
  showText: { fontSize: 13, fontWeight: "800" },
  fieldError: { color: "#DC2626", fontSize: 12, fontWeight: "700" },
  helper: { fontSize: 12, fontWeight: "600" },
  rememberRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  rememberCopy: { flex: 1 },
  rememberTitle: { fontSize: 14, fontWeight: "800" },
  rememberHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  errorBanner: { backgroundColor: "#FEE2E2", color: "#991B1B", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: "700" },
  primaryButton: { minHeight: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  secondaryButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { fontSize: 15, fontWeight: "800" },
});
