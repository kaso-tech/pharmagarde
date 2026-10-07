import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { AppChrome } from "@/components/pharmagarde/app-ui";
import { LocationPicker } from "@/components/pharmagarde/location-picker";
import { WeeklyHoursEditor, cloneHours } from "@/components/pharmagarde/weekly-hours-editor";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { getKnownCityCoordinates } from "@/lib/pharmagarde/city-utils";
import { DEFAULT_WEEKLY_HOURS, validateWeeklyHours, type WeeklyHours } from "@/lib/pharmagarde/opening-hours";
import { usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import type { Coordinates } from "@/lib/pharmagarde/types";

type EstablishmentType = "pharmacy" | "healthcare";

type EstablishmentForm = {
  type: EstablishmentType;
  name: string;
  district: string;
  phone: string;
  location: Coordinates | null;
  /** Horaires de service facultatifs : absents, l'établissement suit les horaires de sa ville. */
  withHours: boolean;
  hours: WeeklyHours;
  notes: string;
};

const INITIAL_FORM: EstablishmentForm = {
  type: "pharmacy",
  name: "",
  district: "",
  phone: "",
  location: null,
  withHours: false,
  hours: DEFAULT_WEEKLY_HOURS,
  notes: "",
};

const TYPE_OPTIONS: readonly { value: EstablishmentType; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { value: "pharmacy", label: "Pharmacie", icon: "local-pharmacy" },
  { value: "healthcare", label: "Centre de santé", icon: "local-hospital" },
];

export default function NewEstablishmentScreen() {
  const palette = usePremiumPalette();
  const { preferences, userLocation } = usePharmaGarde();
  const [form, setForm] = useState<EstablishmentForm>(INITIAL_FORM);
  const [submitted, setSubmitted] = useState(false);
  const center = useMemo(() => userLocation ?? getKnownCityCoordinates(preferences.city), [preferences.city, userLocation]);

  const hoursError = form.withHours ? validateWeeklyHours(form.hours) : null;
  const isValid = form.name.trim().length >= 3 && form.district.trim().length >= 2 && !!form.location && !hoursError;
  const isPharmacy = form.type === "pharmacy";

  const updateField = <K extends keyof EstablishmentForm>(field: K, value: EstablishmentForm[K]) => {
    setSubmitted(false);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = () => {
    if (!isValid) return;
    setSubmitted(true);
    setForm({ ...INITIAL_FORM, hours: cloneHours(DEFAULT_WEEKLY_HOURS) });
  };

  return (
    <AppChrome subtitle="Contribution">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView style={[styles.page, { backgroundColor: palette.background }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>Nouvel établissement</Text>
          <Text style={[styles.description, { color: palette.muted }]}>Proposez une pharmacie ou un centre de santé à vérifier pour {preferences.city}. Les données restent locales dans cette version et préparent une intégration serveur ultérieure.</Text>

          <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: palette.text }]}>Type d’établissement</Text>
              <View style={styles.typeRow}>
                {TYPE_OPTIONS.map((option) => {
                  const active = form.type === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      style={({ pressed }) => [styles.typeOption, { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.softGreen : palette.card }, pressed && styles.pressed]}
                      onPress={() => updateField("type", option.value)}
                    >
                      <MaterialIcons name={option.icon} size={20} color={active ? palette.brand : palette.muted} />
                      <Text style={[styles.typeLabel, { color: active ? palette.brand : palette.text }]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Field label={isPharmacy ? "Nom de la pharmacie" : "Nom du centre de santé"} value={form.name} onChangeText={(value) => updateField("name", value)} placeholder={isPharmacy ? "Ex. Pharmacie Wend-Panga" : "Ex. CSPS de Tanghin"} icon={isPharmacy ? "local-pharmacy" : "local-hospital"} />
            <Field label="Quartier / adresse" value={form.district} onChangeText={(value) => updateField("district", value)} placeholder="Ex. Zone du Bois" icon="place" />
            <Field label="Téléphone" value={form.phone} onChangeText={(value) => updateField("phone", value)} placeholder="Ex. +226 XX XX XX XX" icon="phone" keyboardType="phone-pad" />

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: palette.text }]}>Emplacement sur la carte</Text>
              <Text style={[styles.help, { color: palette.muted }]}>Touchez la carte à l’entrée de l’établissement. Vous pouvez ensuite déplacer le repère pour l’ajuster.</Text>
              <LocationPicker value={form.location} onChange={(location) => updateField("location", location)} center={center} />
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.switchRow}>
                <View style={styles.flex}>
                  <Text style={[styles.label, { color: palette.text }]}>Horaires de service (facultatif)</Text>
                  <Text style={[styles.help, { color: palette.muted }]}>Sans horaires, l’établissement prend ceux de sa ville.</Text>
                </View>
                <Switch
                  accessibilityLabel="Ajouter les horaires de service"
                  value={form.withHours}
                  onValueChange={(value) => updateField("withHours", value)}
                  trackColor={{ true: palette.brand, false: palette.border }}
                  thumbColor="#FFFFFF"
                />
              </View>
              {form.withHours ? <WeeklyHoursEditor value={form.hours} onChange={(hours) => updateField("hours", hours)} /> : null}
            </View>

            <Field label="Notes utiles" value={form.notes} onChangeText={(value) => updateField("notes", value)} placeholder="Repères, informations complémentaires..." icon="notes" multiline />

            {submitted ? (
              <View style={[styles.successBox, { backgroundColor: palette.softGreen, borderColor: palette.border }]}>
                <MaterialIcons name="check-circle" size={20} color={palette.brand} />
                <Text style={[styles.successText, { color: palette.text }]}>Proposition enregistrée localement. Elle pourra être envoyée lorsque la synchronisation sera activée.</Text>
              </View>
            ) : null}

            {!form.location ? <Text style={[styles.help, { color: palette.muted }]}>Placez l’établissement sur la carte pour pouvoir envoyer la proposition.</Text> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !isValid }}
              android_ripple={{ color: "rgba(255,255,255,0.25)", borderless: false }}
              style={({ pressed }) => [styles.button, { backgroundColor: palette.brand }, !isValid && styles.disabled, pressed && isValid && styles.pressed]}
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
  const palette = usePremiumPalette();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <View style={[styles.inputWrap, props.multiline && styles.multilineWrap, { borderColor: palette.border, backgroundColor: palette.card }]}>
        <MaterialIcons name={icon} size={20} color={palette.brand} />
        <TextInput placeholderTextColor={palette.muted} returnKeyType="done" style={[styles.input, props.multiline && styles.multilineInput, { color: palette.text }]} {...props} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1 },
  content: { padding: 16, paddingBottom: 28 },
  title: { fontSize: 25, lineHeight: 32, fontWeight: "900" },
  description: { fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 16 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 16, shadowColor: "#092A13", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  fieldGroup: { gap: 7 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "900" },
  help: { fontSize: 12, lineHeight: 17, fontWeight: "600" },
  typeRow: { flexDirection: "row", gap: 10 },
  typeOption: { flex: 1, minHeight: 50, borderRadius: 10, borderWidth: 1.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 8 },
  typeLabel: { fontSize: 14, fontWeight: "900" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  inputWrap: { minHeight: 50, borderRadius: 10, borderWidth: 1, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  multilineWrap: { minHeight: 96, alignItems: "flex-start", paddingTop: 13 },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  multilineInput: { minHeight: 72, textAlignVertical: "top" },
  successBox: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderRadius: 10, padding: 12, borderWidth: 1 },
  successText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  button: { minHeight: 50, borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9 },
  disabled: { opacity: 0.46 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
});
