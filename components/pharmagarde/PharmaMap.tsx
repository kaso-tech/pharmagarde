import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import MapLibreView, { type MapLibrePlace } from "@/components/pharmagarde/maplibre-view";
import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import { Coordinates, HealthPlace, MapPreference } from "@/lib/pharmagarde/types";

// Style vectoriel OpenFreeMap (gratuit, sans clé). Remplaçable par n'importe quel style MapLibre.
const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAPLIBRE_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";

type PharmaMapProps = {
  places: HealthPlace[];
  userLocation?: Coordinates;
  mapType?: MapPreference;
  selectedPlaceId?: string;
  onSelectPlace?: (place: HealthPlace) => void;
};

const keyFor = (place: HealthPlace) => `${place.type}-${place.id}`;

export function PharmaMap({ places, userLocation, mapType = "Standard", selectedPlaceId, onSelectPlace }: PharmaMapProps) {
  const palette = usePremiumPalette();
  const visiblePlaces = useMemo(() => places.filter((place) => place.latitude !== undefined && place.longitude !== undefined), [places]);
  const mapPlaces = useMemo<MapLibrePlace[]>(
    () =>
      visiblePlaces.map((place) => ({
        key: keyFor(place),
        kind: place.type,
        name: place.name,
        subtitle: place.address ?? place.city ?? "Burkina Faso",
        latitude: place.latitude as number,
        longitude: place.longitude as number,
      })),
    [visiblePlaces],
  );
  const mapUserLocation = useMemo(
    () => (userLocation ? { latitude: userLocation.latitude, longitude: userLocation.longitude } : null),
    [userLocation],
  );

  const handleSelect = (key: string) => {
    const place = visiblePlaces.find((item) => keyFor(item) === key);
    if (!place) return;
    haptic.selection();
    onSelectPlace?.(place);
  };

  return (
    <View style={[styles.wrapper, { backgroundColor: palette.mapLand }]}>
      <MapLibreView
        places={mapPlaces}
        userLocation={mapUserLocation}
        satellite={mapType === "Satellite"}
        styleUrl={MAP_STYLE_URL}
        selectedKey={selectedPlaceId ?? null}
        pharmacyColor={palette.brand}
        clinicColor={palette.clinic}
        onSelectPlace={handleSelect}
        dom={{ style: styles.map, scrollEnabled: false }}
      />
      {visiblePlaces.length === 0 ? (
        <View style={[styles.overlay, { backgroundColor: palette.glass, borderColor: palette.border }]} pointerEvents="none">
          <Text style={[styles.overlayTitle, { color: palette.text }]}>Aucun point à afficher</Text>
          <Text style={[styles.overlayText, { color: palette.muted }]}>Configurez l’API puis rechargez les données.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, minHeight: 420, overflow: "hidden" },
  map: StyleSheet.absoluteFill,
  overlay: { position: "absolute", left: 20, right: 20, bottom: 120, borderRadius: 18, padding: 16, borderWidth: 1 },
  overlayTitle: { fontWeight: "900", fontSize: 15, lineHeight: 20 },
  overlayText: { marginTop: 4, fontSize: 13, lineHeight: 18 },
});
