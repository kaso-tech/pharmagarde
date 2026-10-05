import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AppChrome } from "@/components/pharmagarde/app-ui";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { PHARMAGARDE_CITIES } from "@/lib/pharmagarde/city-utils";

const BRAND_GREEN = "#008000";


export default function CitySelectionScreen() {
  const router = useRouter();
  const { preferences, updatePreference, requestLocation, refreshingLocation, isManualCitySelection } = usePharmaGarde();

  const selectCity = async (city: string) => {
    await updatePreference("city", city);
    router.back();
  };

  return (
    <AppChrome subtitle="Ville">
      <View style={styles.content}>
        <Text style={styles.title}>Changer de ville</Text>
        <Text style={styles.description}>Choisissez la ville pour filtrer les résultats locaux. Les distances restent calculées depuis votre position GPS quand elle est disponible.</Text>
        <Pressable
          accessibilityRole="button"
          disabled={refreshingLocation}
          android_ripple={{ color: "rgba(0,128,0,0.12)", borderless: false }}
          style={({ pressed }) => [styles.currentLocationButton, pressed && styles.pressed, refreshingLocation && styles.disabledButton]}
          onPress={requestLocation}
        >
          <MaterialIcons name="my-location" size={20} color={BRAND_GREEN} />
          <Text style={styles.currentLocationText}>{refreshingLocation ? "Recherche de la position…" : "Utiliser ma position actuelle"}</Text>
          {!isManualCitySelection ? <MaterialIcons name="check-circle" size={20} color={BRAND_GREEN} /> : null}
        </Pressable>
        <FlatList
          data={PHARMAGARDE_CITIES}
          keyExtractor={(item) => item}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const selected = item === preferences.city;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                android_ripple={{ color: "rgba(0,128,0,0.12)", borderless: false }}
                style={({ pressed }) => [styles.cityRow, selected && styles.selectedRow, pressed && styles.pressed]}
                onPress={() => selectCity(item)}
              >
                <View style={[styles.icon, selected && styles.selectedIcon]}>
                  <MaterialIcons name="location-city" size={21} color={selected ? "#FFFFFF" : BRAND_GREEN} />
                </View>
                <Text style={[styles.cityText, selected && styles.selectedText]}>{item}</Text>
                {selected ? <MaterialIcons name="check-circle" size={22} color={BRAND_GREEN} /> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingTop: 18 },
  title: { color: "#102016", fontSize: 25, lineHeight: 32, fontWeight: "900", marginHorizontal: 16 },
  description: { color: "#667085", fontSize: 14, lineHeight: 21, marginHorizontal: 16, marginTop: 6, marginBottom: 14 },
  list: { paddingHorizontal: 16, paddingBottom: 28 },
  currentLocationButton: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: "#BFEBD0", backgroundColor: "#F7FFF9", paddingHorizontal: 14, marginHorizontal: 16, marginBottom: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  currentLocationText: { flex: 1, color: "#102016", fontSize: 15, lineHeight: 21, fontWeight: "900" },
  disabledButton: { opacity: 0.58 },
  cityRow: { minHeight: 66, borderRadius: 12, borderWidth: 1, borderColor: "#D6EBDD", backgroundColor: "#FFFFFF", paddingHorizontal: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#092A13", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  selectedRow: { backgroundColor: "#F0FFF5", borderColor: BRAND_GREEN },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  icon: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#EAF8EF", alignItems: "center", justifyContent: "center" },
  selectedIcon: { backgroundColor: BRAND_GREEN },
  cityText: { flex: 1, color: "#102016", fontSize: 16, lineHeight: 22, fontWeight: "900" },
  selectedText: { color: "#006400" },
});
