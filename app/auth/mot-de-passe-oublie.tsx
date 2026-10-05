import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import * as Api from "@/lib/_core/api";
import { formatBurkinaPhone, isValidPhone, MIN_PASSWORD_LENGTH, normalizePhone } from "@/lib/pharmagarde/auth-validation";
import { usePremiumPalette } from "@/lib/pharmagarde/premium-ui";

// L4 : réinitialisation du mot de passe par code SMS, en deux étapes (numéro, puis code + nouveau
// mot de passe).
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const palette = usePremiumPalette();
  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const normalizedPhone = normalizePhone(phone);
  const phoneValid = isValidPhone(normalizedPhone);
  const codeValid = /^\d{6}$/.test(code.replace(/\s+/g, ""));
  const passwordError = password && password.trim().length < MIN_PASSWORD_LENGTH ? `Au moins ${MIN_PASSWORD_LENGTH} caractères.` : null;
  const confirmError = confirmPassword && password.trim() !== confirmPassword.trim() ? "Les deux mots de passe diffèrent." : null;
  const canConfirm = codeValid && password.trim().length >= MIN_PASSWORD_LENGTH && password.trim() === confirmPassword.trim() && !loading;

  const requestCode = async () => {
    if (!phoneValid || loading) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      await Api.requestPasswordReset(normalizedPhone);
      setCodeSent(true);
      // Message volontairement neutre : le serveur ne révèle pas si le numéro a un compte.
      setInfo(`Si un compte existe pour le ${formatBurkinaPhone(phone)}, un code vient d’être envoyé par SMS.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Envoi du code impossible.");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!canConfirm) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      await Api.confirmPasswordReset({ phone: normalizedPhone, code, password, confirmPassword });
      setDone(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Réinitialisation impossible.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} className="px-5 py-4">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={[styles.kicker, { color: palette.brand }]}>Compte</Text>
            <Text style={[styles.title, { color: palette.text }]}>Mot de passe oublié</Text>
            <Text style={[styles.subtitle, { color: palette.muted }]}>Recevez un code par SMS pour choisir un nouveau mot de passe.</Text>
          </View>

          <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
            {done ? (
              <>
                <Text style={styles.successBanner}>Mot de passe modifié. Vous pouvez vous connecter.</Text>
                <Pressable onPress={() => router.replace("/auth/login")} style={({ pressed }) => [styles.primaryButton, { backgroundColor: palette.brand, opacity: pressed ? 0.86 : 1 }]}>
                  <Text style={styles.primaryButtonText}>Se connecter</Text>
                </Pressable>
              </>
            ) : (
              <>
                <LabeledInput label="Téléphone" value={phone} onChangeText={setPhone} placeholder="70 12 34 56" keyboardType="phone-pad" editable={!codeSent} />
                {codeSent ? (
                  <>
                    <LabeledInput label="Code reçu par SMS" value={code} onChangeText={setCode} placeholder="6 chiffres" keyboardType="phone-pad" />
                    <LabeledInput label="Nouveau mot de passe" value={password} onChangeText={setPassword} placeholder="••••••••" secure error={passwordError} />
                    <LabeledInput label="Confirmation" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="••••••••" secure error={confirmError} />
                  </>
                ) : null}

                {info ? <Text style={[styles.info, { color: palette.muted }]}>{info}</Text> : null}
                {errorMessage ? <Text style={styles.errorBanner}>{errorMessage}</Text> : null}

                {codeSent ? (
                  <>
                    <Pressable onPress={confirm} disabled={!canConfirm} style={({ pressed }) => [styles.primaryButton, { backgroundColor: canConfirm ? palette.brand : palette.border, opacity: pressed ? 0.86 : 1 }]}>
                      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Changer le mot de passe</Text>}
                    </Pressable>
                    <Pressable onPress={requestCode} disabled={loading} style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.72 : 1 }]}>
                      <Text style={[styles.secondaryButtonText, { color: palette.brand }]}>Renvoyer le code</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={requestCode} disabled={!phoneValid || loading} style={({ pressed }) => [styles.primaryButton, { backgroundColor: phoneValid ? palette.brand : palette.border, opacity: pressed ? 0.86 : 1 }]}>
                    {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Recevoir le code</Text>}
                  </Pressable>
                )}

                <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.72 : 1 }]}>
                  <Text style={[styles.secondaryButtonText, { color: palette.muted }]}>Retour à la connexion</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

type LabeledInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "phone-pad";
  secure?: boolean;
  editable?: boolean;
  error?: string | null;
};

function LabeledInput({ label, value, onChangeText, placeholder, keyboardType = "default", secure = false, editable = true, error }: LabeledInputProps) {
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
        secureTextEntry={secure}
        editable={editable}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { backgroundColor: palette.surface, borderColor: error ? palette.danger : palette.border, color: palette.text, opacity: editable ? 1 : 0.6 }]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: "center" },
  scroll: { flexGrow: 1, justifyContent: "center", paddingVertical: 12 },
  header: { marginBottom: 22 },
  kicker: { fontSize: 13, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  title: { fontSize: 32, lineHeight: 38, fontWeight: "900", marginTop: 8 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 10 },
  card: { borderWidth: 1, borderRadius: 28, padding: 18, gap: 16 },
  fieldGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: "800" },
  input: { borderWidth: 1, borderRadius: 18, minHeight: 54, paddingHorizontal: 16, fontSize: 16 },
  fieldError: { color: "#DC2626", fontSize: 12, fontWeight: "700" },
  info: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
  errorBanner: { backgroundColor: "#FEE2E2", color: "#991B1B", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: "700" },
  successBanner: { backgroundColor: "#DCFCE7", color: "#166534", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: "700" },
  primaryButton: { minHeight: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  secondaryButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { fontSize: 15, fontWeight: "800" },
});
