import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AppChrome } from "@/components/pharmagarde/app-ui";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";

const BRAND_GREEN = "#008000";

type PharmacyForm = {
  name: string;
  district: string;
  phone: string;
  notes: string;
};

const INITIAL_FORM: PharmacyForm = { name: "", district: "", phone: "", notes: "" };

export default function NewPharmacyScreen() {
  const { preferences } = usePharmaGarde();
  const [form, setForm] = useState<PharmacyForm>(INITIAL_FORM);
  const [submitted, setSubmitted] = useState(false);

  const isValid = useMemo(() => form.name.trim().length >= 3 && form.district.trim().length >= 2, [form.district, form.name]);

  const updateField = (field: keyof PharmacyForm, value: string) => {
    setSubmitted(false);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = () => {
    if (!isValid) return;
    setSubmitted(true);
    setForm(INITIAL_FORM);
  };

  return (
    <AppChrome subtitle="Contribution">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Nouvelle Pharmacie</Text>
          <Text style={styles.description}>Proposez une officine à vérifier pour {preferences.city}. Les données restent locales dans cette version et préparent une intégration serveur ultérieure.</Text>

          <View style={styles.card}>
            <Field label="Nom de la pharmacie" value={form.name} onChangeText={(value) => updateField("name", value)} placeholder="Ex. Pharmacie Wend-Panga" icon="local-pharmacy" />
            <Field label="Quartier / adresse" value={form.district} onChangeText={(value) => updateField("district", value)} placeholder="Ex. Zone du Bois" icon="place" />
            <Field label="Téléphone" value={form.phone} onChangeText={(value) => updateField("phone", value)} placeholder="Ex. +226 XX XX XX XX" icon="phone" keyboardType="phone-pad" />
            <Field label="Notes utiles" value={form.notes} onChangeText={(value) => updateField("notes", value)} placeholder="Horaires, garde, repères..." icon="notes" multiline />

            {submitted ? (
              <View style={styles.successBox}>
                <MaterialIcons name="check-circle" size={20} color={BRAND_GREEN} />
                <Text style={styles.successText}>Proposition enregistrée localement. Elle pourra être envoyée lorsque la synchronisation sera activée.</Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !isValid }}
              android_ripple={{ color: "rgba(255,255,255,0.25)", borderless: false }}
              style={({ pressed }) => [styles.button, !isValid && styles.disabled, pressed && isValid && styles.pressed]}
              onPress={submit}
            >
              <MaterialIcons name="send" size={19} color="#FFFFFF" />
              <Text style={styles.buttonText}>Soumettre la proposition</Text>
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
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: "#F6FBF8" },
  content: { padding: 16, paddingBottom: 28 },
  title: { color: "#102016", fontSize: 25, lineHeight: 32, fontWeight: "900" },
  description: { color: "#667085", fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 16 },
  card: { borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D6EBDD", padding: 16, gap: 14, shadowColor: "#092A13", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  fieldGroup: { gap: 7 },
  label: { color: "#102016", fontSize: 13, lineHeight: 18, fontWeight: "900" },
  inputWrap: { minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: "#D6EBDD", backgroundColor: "#FDFEFD", paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  multilineWrap: { minHeight: 96, alignItems: "flex-start", paddingTop: 13 },
  input: { flex: 1, color: "#102016", fontSize: 15, paddingVertical: 10 },
  multilineInput: { minHeight: 72, textAlignVertical: "top" },
  successBox: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderRadius: 10, padding: 12, backgroundColor: "#EAF8EF", borderWidth: 1, borderColor: "#CBE7D3" },
  successText: { flex: 1, color: "#102016", fontSize: 13, lineHeight: 19, fontWeight: "700" },
  button: { minHeight: 50, borderRadius: 10, backgroundColor: BRAND_GREEN, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9 },
  disabled: { opacity: 0.46 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
});
