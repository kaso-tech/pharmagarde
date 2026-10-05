import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import * as Api from "@/lib/_core/api";
import { formatBurkinaPhone, normalizeEmail, normalizePhone, validateRegisterForm } from "@/lib/pharmagarde/auth-validation";
import { usePremiumPalette } from "@/lib/pharmagarde/premium-ui";

export default function RegisterScreen() {
  const router = useRouter();
  const palette = usePremiumPalette();
  const { register } = useAuth({ autoFetch: false });
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // L5 : un code SMS prouve la possession du numéro avant la création du compte.
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const errors = useMemo(() => validateRegisterForm({ phone, email, password, confirmPassword }), [phone, email, password, confirmPassword]);
  const isValid = !errors.phone && !errors.email && !errors.password && !errors.confirmPassword;

  const normalizedPhone = normalizePhone(phone);
  const codeStep = codeSentTo !== null && codeSentTo === normalizedPhone;
  const codeValid = /^\d{6}$/.test(code.replace(/\s+/g, ""));

  const requestCode = async () => {
    if (!isValid || loading) return;
    setLoading(true);
    setSubmitError(null);
    setSuccess(null);
    try {
      await Api.requestRegisterCode(normalizedPhone);
      setCodeSentTo(normalizedPhone);
      setCode("");
      setSuccess(`Code envoyé par SMS au ${formatBurkinaPhone(phone)}.`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Envoi du code impossible.");
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!isValid || !codeValid || loading) return;
    setLoading(true);
    setSubmitError(null);
    setSuccess(null);
    try {
      await register({ phone: normalizedPhone, email: normalizeEmail(email), password, confirmPassword, code, rememberMe });
      setSuccess("Compte créé avec succès. Redirection en cours…");
      setTimeout(() => router.replace("/(tabs)"), 650);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Inscription impossible.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} className="px-5 py-4">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={[styles.kicker, { color: palette.brand }]}>Compte sécurisé</Text>
            <Text style={[styles.title, { color: palette.text }]}>Créer un compte</Text>
            <Text style={[styles.subtitle, { color: palette.muted }]}>Un compte est requis pour les fonctions premium et les paiements d’abonnement.</Text>
          </View>

          <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
            <Field label="Téléphone" value={phone} onChangeText={setPhone} placeholder="70 12 34 56" keyboardType="phone-pad" error={phone ? errors.phone : undefined} helper={phone ? `Stocké comme ${normalizePhone(phone)} · Affiché ${formatBurkinaPhone(phone)}` : "Format Burkina Faso, indicatif +226 automatique."} />
            <Field label="Email optionnel" value={email} onChangeText={setEmail} placeholder="nom@email.com" keyboardType="email-address" error={email ? errors.email : undefined} />
            <PasswordField label="Mot de passe" value={password} onChangeText={setPassword} showPassword={showPassword} onTogglePassword={() => setShowPassword((value) => !value)} error={password ? errors.password : undefined} />
            <PasswordField label="Confirmation" value={confirmPassword} onChangeText={setConfirmPassword} showPassword={showPassword} onTogglePassword={() => setShowPassword((value) => !value)} error={confirmPassword ? errors.confirmPassword : undefined} />

            <View style={styles.rememberRow}>
              <View style={styles.rememberCopy}>
                <Text style={[styles.rememberTitle, { color: palette.text }]}>Se souvenir de moi</Text>
                <Text style={[styles.rememberHint, { color: palette.muted }]}>Garde votre session active au prochain lancement.</Text>
              </View>
              <Switch value={rememberMe} onValueChange={setRememberMe} trackColor={{ false: palette.border, true: palette.softGreen }} thumbColor={rememberMe ? palette.brand : "#f4f4f5"} />
            </View>

            {codeStep ? (
              <Field label="Code reçu par SMS" value={code} onChangeText={setCode} placeholder="6 chiffres" keyboardType="phone-pad" helper="Le code expire après 10 minutes." />
            ) : null}

            {submitError ? <Text style={styles.errorBanner}>{submitError}</Text> : null}
            {success ? <Text style={styles.successBanner}>{success}</Text> : null}

            {codeStep ? (
              <>
                <Pressable onPress={submit} disabled={!isValid || !codeValid || loading} style={({ pressed }) => [styles.primaryButton, { backgroundColor: isValid && codeValid ? palette.brand : palette.border, opacity: pressed ? 0.86 : 1 }]}>
                  {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Créer mon compte</Text>}
                </Pressable>
                <Pressable onPress={requestCode} disabled={loading} style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.72 : 1 }]}>
                  <Text style={[styles.secondaryButtonText, { color: palette.brand }]}>Renvoyer le code</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={requestCode} disabled={!isValid || loading} style={({ pressed }) => [styles.primaryButton, { backgroundColor: isValid ? palette.brand : palette.border, opacity: pressed ? 0.86 : 1 }]}>
                {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Recevoir le code par SMS</Text>}
              </Pressable>
            )}

            <Pressable onPress={() => router.push("/auth/login")} style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.72 : 1 }]}> 
              <Text style={[styles.secondaryButtonText, { color: palette.brand }]}>J’ai déjà un compte</Text>
            </Pressable>
          </View>
        </ScrollView>
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
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.muted} keyboardType={keyboardType} autoCapitalize="none" autoCorrect={false} returnKeyType="next" style={[styles.input, { backgroundColor: palette.surface, borderColor: error ? palette.danger : palette.border, color: palette.text }]} />
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
        <TextInput value={value} onChangeText={onChangeText} placeholder="••••••••" placeholderTextColor={palette.muted} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} returnKeyType="done" style={[styles.passwordInput, { color: palette.text }]} />
        <Pressable onPress={onTogglePassword} style={({ pressed }) => [styles.showButton, { opacity: pressed ? 0.7 : 1 }]}> 
          <Text style={[styles.showText, { color: palette.brand }]}>{showPassword ? "Masquer" : "Afficher"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingVertical: 8 },
  header: { marginBottom: 22 },
  kicker: { fontSize: 13, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  title: { fontSize: 33, lineHeight: 40, fontWeight: "900", marginTop: 8 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 10 },
  card: { borderWidth: 1, borderRadius: 28, padding: 18, gap: 15, shadowColor: "#0f172a", shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 12 } },
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
  successBanner: { backgroundColor: "#DCFCE7", color: "#166534", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: "800" },
  primaryButton: { minHeight: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  secondaryButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { fontSize: 15, fontWeight: "800" },
});
