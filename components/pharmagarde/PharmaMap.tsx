import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { MapErrorBoundary } from "@/components/pharmagarde/map-error-boundary";
import MapLibreView, { type MapLibrePlace } from "@/components/pharmagarde/maplibre-view";
import { effectiveMapPreference, MAP_ATTRIBUTION, MAP_FALLBACK_STYLE_URL, MAP_SATELLITE_STYLE_URL, MAP_STYLE_URL } from "@/lib/pharmagarde/map-config";
import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import { Coordinates, HealthPlace, MapPreference } from "@/lib/pharmagarde/types";


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
      <MapErrorBoundary
        fallback={
          <View style={[styles.overlay, styles.errorOverlay, { backgroundColor: palette.glass, borderColor: palette.border }]}>
            <Text style={[styles.overlayTitle, { color: palette.text }]}>Carte indisponible</Text>
            <Text style={[styles.overlayText, { color: palette.muted }]}>La carte ne peut pas s’afficher sur cet appareil. La liste ci-dessous reste disponible.</Text>
          </View>
        }
      >
        <MapLibreView
          places={mapPlaces}
          userLocation={mapUserLocation}
          satellite={effectiveMapPreference(mapType) === "Satellite"}
          styleUrl={MAP_STYLE_URL}
          fallbackStyleUrl={MAP_FALLBACK_STYLE_URL}
          satelliteStyleUrl={MAP_SATELLITE_STYLE_URL}
          attribution={MAP_ATTRIBUTION}
          selectedKey={selectedPlaceId ?? null}
          pharmacyColor={palette.brand}
          clinicColor={palette.clinic}
          onSelectPlace={handleSelect}
          // La WebView Expo par défaut (@expo/dom-webview, vue native « ExpoDomWebViewModule ») manquait
          // dans le binaire installé et faisait planter l'écran (« Can't find ViewManager »). On utilise
          // react-native-webview, présent dans Expo Go et lié automatiquement dans les builds EAS.
          dom={{ style: styles.map, scrollEnabled: false, useExpoDOMWebView: false }}
        />
      </MapErrorBoundary>
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
  errorOverlay: { top: 140, bottom: undefined },
  overlayTitle: { fontWeight: "900", fontSize: 15, lineHeight: 20 },
  overlayText: { marginTop: 4, fontSize: 13, lineHeight: 18 },
});
