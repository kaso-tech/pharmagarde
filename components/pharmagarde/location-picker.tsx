import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Location from "expo-location";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { MapErrorBoundary } from "@/components/pharmagarde/map-error-boundary";
import LocationPickerView from "@/components/pharmagarde/location-picker-view";
import { MAP_ATTRIBUTION, MAP_FALLBACK_STYLE_URL, MAP_STYLE_URL } from "@/lib/pharmagarde/map-config";
import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import type { Coordinates } from "@/lib/pharmagarde/types";

type LocationPickerProps = {
  value: Coordinates | null;
  onChange: (value: Coordinates | null) => void;
  /** Centre de la carte tant qu'aucun point n'est choisi. */
  center: Coordinates;
  height?: number;
};

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Choix d'un emplacement sur la carte : toucher pour placer le repère, le déplacer pour ajuster. */
export function LocationPicker({ value, onChange, center, height = 260 }: LocationPickerProps) {
  const palette = usePremiumPalette();
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const locateMe = async () => {
    setLocating(true);
    setMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setMessage("Autorisez la localisation, ou touchez la carte pour placer l’établissement.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      haptic.selection();
      onChange({ latitude: round(position.coords.latitude), longitude: round(position.coords.longitude) });
    } catch {
      setMessage("Position indisponible : touchez la carte pour placer l’établissement.");
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.mapFrame, { height, borderColor: palette.border, backgroundColor: palette.mapLand }]}>
        <MapErrorBoundary
          fallback={
            <View style={styles.fallback}>
              <Text style={[styles.hint, { color: palette.muted }]}>La carte ne peut pas s’afficher sur cet appareil. Utilisez « Ma position ».</Text>
            </View>
          }
        >
          <LocationPickerView
            value={value}
            center={center}
            styleUrl={MAP_STYLE_URL}
            fallbackStyleUrl={MAP_FALLBACK_STYLE_URL}
            attribution={MAP_ATTRIBUTION}
            color={palette.brand}
            onPick={(latitude, longitude) => {
              haptic.selection();
              onChange({ latitude, longitude });
            }}
            // Même WebView que la carte principale (voir PharmaMap.tsx).
            dom={{ style: StyleSheet.absoluteFill, scrollEnabled: false, useExpoDOMWebView: false }}
          />
        </MapErrorBoundary>
      </View>
      <View style={styles.row}>
        <MaterialIcons name={value ? "place" : "touch-app"} size={18} color={value ? palette.brand : palette.muted} />
        <Text style={[styles.coordinates, { color: value ? palette.text : palette.muted }]}>
          {value ? `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}` : "Touchez la carte pour placer l’établissement"}
        </Text>
        {value ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Effacer l’emplacement" hitSlop={8} onPress={() => onChange(null)}>
            <MaterialIcons name="close" size={18} color={palette.muted} />
          </Pressable>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" disabled={locating} style={({ pressed }) => [styles.locate, { borderColor: palette.border, backgroundColor: palette.card }, pressed && styles.pressed]} onPress={() => void locateMe()}>
        {locating ? <ActivityIndicator color={palette.brand} /> : <MaterialIcons name="my-location" size={18} color={palette.brand} />}
        <Text style={[styles.locateText, { color: palette.brand }]}>Utiliser ma position actuelle</Text>
      </Pressable>
      {message ? <Text style={[styles.hint, { color: palette.muted }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  mapFrame: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  coordinates: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  locate: { minHeight: 42, borderRadius: 10, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  locateText: { fontSize: 13, fontWeight: "900" },
  hint: { fontSize: 12, lineHeight: 17, fontWeight: "600" },
  pressed: { opacity: 0.8 },
});
