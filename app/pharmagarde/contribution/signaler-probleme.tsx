import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AppChrome } from "@/components/pharmagarde/app-ui";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { trpc } from "@/lib/trpc";

const BRAND_GREEN = "#008000";

const CATEGORIES = ["Information incorrecte", "Pharmacie fermée", "Position carte", "Prix médicament", "Autre"] as const;

type ProblemForm = {
  subject: string;
  category: (typeof CATEGORIES)[number];
  message: string;
};

const INITIAL_FORM: ProblemForm = { subject: "", category: CATEGORIES[0], message: "" };

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

export default function ReportProblemScreen() {
  // Ouvert depuis une fiche, le signalement est rattaché à l'établissement concerné.
  const params = useLocalSearchParams<{ placeId?: string; placeName?: string; placeKind?: string; city?: string }>();
  const placeId = param(params.placeId);
  const placeName = param(params.placeName);
  const placeKind = param(params.placeKind) === "healthcare" ? "healthcare" : placeId ? "pharmacy" : undefined;
  const { preferences } = usePharmaGarde();
  const [form, setForm] = useState<ProblemForm>(INITIAL_FORM);
  const [submitted, setSubmitted] = useState(false);
  const report = trpc.contributions.reportProblem.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setForm(INITIAL_FORM);
    },
  });
  const isValid = useMemo(() => form.subject.trim().length >= 3 && form.message.trim().length >= 8, [form.message, form.subject]);

  const updateField = <K extends keyof ProblemForm>(field: K, value: ProblemForm[K]) => {
    setSubmitted(false);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = () => {
    if (!isValid || report.isPending) return;
    report.mutate({ category: form.category, subject: form.subject.trim(), message: form.message.trim(), placeId, placeName, placeKind, city: param(params.city) ?? preferences.city });
  };

  return (
    <AppChrome subtitle="Contribution">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Signaler un problème</Text>
          <Text style={styles.description}>{placeName ? `Signalement concernant ${placeName}. ` : ""}Décrivez l’anomalie observée : l’équipe PharmaGarde la vérifiera et corrigera l’annuaire.</Text>

          <View style={styles.card}>
            <Field label="Sujet" value={form.subject} onChangeText={(value) => updateField("subject", value)} placeholder="Ex. Horaires incorrects" icon="report-problem" />

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Catégorie</Text>
              <View style={styles.chips}>
                {CATEGORIES.map((category) => {
                  const active = category === form.category;
                  return (
                    <Pressable key={category} style={({ pressed }) => [styles.chip, active && styles.activeChip, pressed && styles.pressed]} onPress={() => updateField("category", category)}>
                      <Text style={[styles.chipText, active && styles.activeChipText]}>{category}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Field label="Description" value={form.message} onChangeText={(value) => updateField("message", value)} placeholder="Expliquez brièvement le problème constaté..." icon="edit-note" multiline />

            {submitted ? (
              <View style={styles.successBox}>
                <MaterialIcons name="check-circle" size={20} color={BRAND_GREEN} />
                <Text style={styles.successText}>Merci ! Votre signalement a été envoyé à l’équipe PharmaGarde.</Text>
              </View>
            ) : null}
            {report.error ? <Text style={styles.errorText}>{report.error.message || "Envoi impossible. Vérifiez votre connexion et réessayez."}</Text> : null}

            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !isValid }} style={({ pressed }) => [styles.button, !isValid && styles.disabled, pressed && isValid && styles.pressed]} onPress={submit}>
              <MaterialIcons name="outgoing-mail" size={19} color="#FFFFFF" />
              <Text style={styles.buttonText}>{report.isPending ? "Envoi…" : "Envoyer le signalement"}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AppChrome>
  );
}

function Field({ label, icon, ...props }: { label: string; icon: keyof typeof MaterialIcons.glyphMap } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, props.multiline && styles.multilineWrap]}>
        <MaterialIcons name={icon} size={20} color={BRAND_GREEN} />
        <TextInput placeholderTextColor="#98A2B3" returnKeyType="done" style={[styles.input, props.multiline && styles.multilineInput]} {...props} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  errorText: { color: "#B42318", fontSize: 13, lineHeight: 19, fontWeight: "700" },
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: "#F6FBF8" },
  content: { padding: 16, paddingBottom: 28 },
  title: { color: "#102016", fontSize: 25, lineHeight: 32, fontWeight: "900" },
  description: { color: "#667085", fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 16 },
  card: { borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D6EBDD", padding: 16, gap: 14, shadowColor: "#092A13", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  fieldGroup: { gap: 7 },
  label: { color: "#102016", fontSize: 13, lineHeight: 18, fontWeight: "900" },
  inputWrap: { minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: "#D6EBDD", backgroundColor: "#FDFEFD", paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  multilineWrap: { minHeight: 110, alignItems: "flex-start", paddingTop: 13 },
  input: { flex: 1, color: "#102016", fontSize: 15, paddingVertical: 10 },
  multilineInput: { minHeight: 86, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 10, borderWidth: 1, borderColor: "#D6EBDD", backgroundColor: "#FFFFFF", paddingHorizontal: 12, paddingVertical: 8 },
  activeChip: { backgroundColor: "#EAF8EF", borderColor: BRAND_GREEN },
  chipText: { color: "#475467", fontSize: 13, fontWeight: "800" },
  activeChipText: { color: "#006400" },
  successBox: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderRadius: 10, padding: 12, backgroundColor: "#EAF8EF", borderWidth: 1, borderColor: "#CBE7D3" },
  successText: { flex: 1, color: "#102016", fontSize: 13, lineHeight: 19, fontWeight: "700" },
  button: { minHeight: 50, borderRadius: 10, backgroundColor: BRAND_GREEN, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9 },
  disabled: { opacity: 0.46 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
});
