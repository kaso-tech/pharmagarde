import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { WEEK_DAYS, WEEK_DAY_LABELS, formatWeeklyHours, validateWeeklyHours, type WeekDay, type WeeklyHours } from "@/lib/pharmagarde/opening-hours";
import { usePremiumPalette } from "@/lib/pharmagarde/premium-ui";

export function cloneHours(hours: WeeklyHours): WeeklyHours {
  return Object.fromEntries(WEEK_DAYS.map((day) => [day, hours[day].map((range) => ({ ...range }))])) as WeeklyHours;
}

function SmallIconButton({ icon, label, color, onPress }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; color: string; onPress: () => void }) {
  const palette = usePremiumPalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.iconButton, { borderColor: palette.border }, pressed && styles.pressed]} onPress={onPress}>
      <MaterialIcons name={icon} size={18} color={color} />
    </Pressable>
  );
}

/**
 * Éditeur d'une semaine d'horaires : pour chaque jour, des plages ouverture–fermeture (aucune = fermé).
 * Partagé par la console d'administration et le formulaire de contribution de l'application.
 */
export function WeeklyHoursEditor({ value, onChange }: { value: WeeklyHours; onChange: (value: WeeklyHours) => void }) {
  const palette = usePremiumPalette();
  const update = (day: WeekDay, ranges: WeeklyHours[WeekDay]) => onChange({ ...cloneHours(value), [day]: ranges });
  const error = validateWeeklyHours(value);
  return (
    <View style={styles.editor}>
      {WEEK_DAYS.map((day) => {
        const ranges = value[day];
        return (
          <View key={day} style={[styles.day, { borderBottomColor: palette.border }]}>
            <Text style={[styles.dayLabel, { color: palette.text }]}>{WEEK_DAY_LABELS[day]}</Text>
            <View style={styles.ranges}>
              {ranges.length === 0 ? <Text style={[styles.meta, { color: palette.muted }]}>Fermé</Text> : null}
              {ranges.map((range, index) => (
                <View key={index} style={styles.range}>
                  <TextInput accessibilityLabel={`${WEEK_DAY_LABELS[day]}, ouverture`} value={range.open} onChangeText={(open) => update(day, ranges.map((item, position) => (position === index ? { ...item, open } : item)))} placeholder="08:00" placeholderTextColor={palette.muted} keyboardType="numbers-and-punctuation" style={[styles.timeInput, { color: palette.text, borderColor: palette.border, backgroundColor: palette.card }]} />
                  <Text style={[styles.meta, { color: palette.muted }]}>à</Text>
                  <TextInput accessibilityLabel={`${WEEK_DAY_LABELS[day]}, fermeture`} value={range.close} onChangeText={(close) => update(day, ranges.map((item, position) => (position === index ? { ...item, close } : item)))} placeholder="20:00" placeholderTextColor={palette.muted} keyboardType="numbers-and-punctuation" style={[styles.timeInput, { color: palette.text, borderColor: palette.border, backgroundColor: palette.card }]} />
                  <SmallIconButton icon="close" label={`Retirer la plage du ${WEEK_DAY_LABELS[day].toLowerCase()}`} color={palette.muted} onPress={() => update(day, ranges.filter((_, position) => position !== index))} />
                </View>
              ))}
            </View>
            {ranges.length < 4 ? <SmallIconButton icon="add" label={`Ajouter une plage le ${WEEK_DAY_LABELS[day].toLowerCase()}`} color={palette.brand} onPress={() => update(day, [...ranges, ranges.length ? { open: "15:00", close: "19:00" } : { open: "08:00", close: "20:00" }])} /> : null}
          </View>
        );
      })}
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : <Text style={[styles.meta, { color: palette.muted }]}>{formatWeeklyHours(value)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: 4 },
  day: { minHeight: 52, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1 },
  dayLabel: { width: 78, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  ranges: { flex: 1, gap: 6 },
  range: { flexDirection: "row", alignItems: "center", gap: 6 },
  timeInput: { width: 66, minHeight: 36, borderRadius: 9, borderWidth: 1, paddingHorizontal: 8, fontSize: 13, fontWeight: "700", textAlign: "center" },
  iconButton: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  meta: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  error: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  pressed: { opacity: 0.8 },
});
