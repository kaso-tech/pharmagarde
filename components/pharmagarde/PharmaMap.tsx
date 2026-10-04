import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import { Coordinates, HealthPlace, MapPreference } from "@/lib/pharmagarde/types";

function positionFor(place: HealthPlace, index: number, total: number) {
  if (place.latitude === undefined || place.longitude === undefined) {
    const angle = (index / Math.max(total, 1)) * Math.PI * 2;
    return { left: 50 + Math.cos(angle) * 32, top: 50 + Math.sin(angle) * 28 };
  }
  const lat = Math.abs(place.latitude % 1);
  const lng = Math.abs(place.longitude % 1);
  return { left: 14 + lng * 72, top: 14 + (1 - lat) * 72 };
}

type PharmaMapProps = {
  places: HealthPlace[];
  userLocation?: Coordinates;
  mapType?: MapPreference;
  selectedPlaceId?: string;
  onSelectPlace?: (place: HealthPlace) => void;
};

export function PharmaMap({ places, userLocation, mapType = "Standard", selectedPlaceId, onSelectPlace }: PharmaMapProps) {
  const palette = usePremiumPalette();

  return (
    <View style={[styles.wrapper, { backgroundColor: palette.mapLand }]}> 
      {mapType === "Satellite" ? <View style={[styles.satelliteOverlay, { backgroundColor: palette.dark ? "rgba(5, 24, 12, 0.3)" : "rgba(17, 64, 38, 0.16)" }]} /> : null}
      <View style={[styles.road, styles.roadOne, { backgroundColor: palette.mapRoad }]} />
      <View style={[styles.road, styles.roadTwo, { backgroundColor: palette.mapRoad }]} />
      <View style={[styles.road, styles.roadThree, { backgroundColor: palette.mapRoad }]} />
      {userLocation ? (
        <View style={[styles.userDot, { backgroundColor: palette.text }]}> 
          <Text style={[styles.userDotText, { color: palette.background }]}>Vous</Text>
        </View>
      ) : null}
      {places.map((place, index) => {
        const key = `${place.type}-${place.id}`;
        const active = selectedPlaceId === key;
        const pos = positionFor(place, index, places.length);
        const accent = place.type === "pharmacy" ? palette.brand : palette.clinic;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`Sélectionner ${place.name}`}
            style={({ pressed }) => [
              styles.pinWrap,
              { left: `${pos.left}%`, top: `${pos.top}%`, transform: [{ scale: active ? 1.15 : pressed ? 0.96 : 1 }] },
            ]}
            onPress={() => {
              haptic.selection();
              onSelectPlace?.(place);
            }}
          >
            <View style={[styles.pin, { backgroundColor: active ? accent : palette.card, borderColor: accent }]}> 
              <MaterialIcons name={place.type === "pharmacy" ? "local-pharmacy" : "local-hospital"} size={active ? 20 : 18} color={active ? "#FFFFFF" : accent} />
            </View>
          </Pressable>
        );
      })}
      <View style={[styles.brandPill, { backgroundColor: palette.glass, borderColor: palette.border }]}> 
        <MaterialIcons name="map" size={16} color={palette.brand} />
        <Text style={[styles.brandPillText, { color: palette.text }]}>Carte interactive</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, minHeight: 420, overflow: "hidden" },
  satelliteOverlay: StyleSheet.absoluteFill,
  road: { position: "absolute", borderRadius: 999, opacity: 0.88 },
  roadOne: { width: "120%", height: 18, left: "-10%", top: "36%", transform: [{ rotate: "-18deg" }] },
  roadTwo: { width: 18, height: "120%", left: "52%", top: "-10%", transform: [{ rotate: "12deg" }] },
  roadThree: { width: "92%", height: 12, left: "5%", bottom: "24%", transform: [{ rotate: "8deg" }] },
  pinWrap: { position: "absolute", width: 42, height: 42, marginLeft: -21, marginTop: -21, alignItems: "center", justifyContent: "center" },
  pin: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 2, shadowColor: "#102016", shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 7 },
  userDot: { position: "absolute", left: "46%", top: "47%", paddingHorizontal: 11, paddingVertical: 7, borderRadius: 16 },
  userDotText: { fontWeight: "900", fontSize: 12, lineHeight: 15 },
  brandPill: { position: "absolute", left: 16, top: 16, minHeight: 34, borderRadius: 17, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  brandPillText: { fontSize: 12, lineHeight: 15, fontWeight: "900" },
});
