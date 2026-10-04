import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";

import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import { Coordinates, HealthPlace, MapPreference } from "@/lib/pharmagarde/types";

const DEFAULT_REGION: Region = {
  latitude: 12.3714,
  longitude: -1.5197,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

type PharmaMapProps = {
  places: HealthPlace[];
  userLocation?: Coordinates;
  mapType?: MapPreference;
  selectedPlaceId?: string;
  onSelectPlace?: (place: HealthPlace) => void;
};

function regionFromPlace(place: HealthPlace): Region | undefined {
  if (place.latitude === undefined || place.longitude === undefined) return undefined;
  return { latitude: place.latitude, longitude: place.longitude, latitudeDelta: 0.035, longitudeDelta: 0.035 };
}

export function PharmaMap({ places, userLocation, mapType = "Standard", selectedPlaceId, onSelectPlace }: PharmaMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const palette = usePremiumPalette();
  const visiblePlaces = useMemo(() => places.filter((place) => place.latitude !== undefined && place.longitude !== undefined), [places]);
  const selectedPlace = visiblePlaces.find((place) => `${place.type}-${place.id}` === selectedPlaceId);
  const firstPlace = visiblePlaces[0];
  const initialRegion = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }
    : regionFromPlace(firstPlace) ?? DEFAULT_REGION;

  useEffect(() => {
    const region = selectedPlace ? regionFromPlace(selectedPlace) : undefined;
    if (region) mapRef.current?.animateToRegion(region, 320);
  }, [selectedPlace]);

  return (
    <View style={styles.wrapper}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={initialRegion}
        mapType={mapType === "Satellite" ? "satellite" : "standard"}
        showsUserLocation={!!userLocation}
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {visiblePlaces.map((place) => {
          const key = `${place.type}-${place.id}`;
          const active = selectedPlaceId === key;
          const accent = place.type === "pharmacy" ? palette.brand : palette.clinic;
          return (
            <Marker
              key={key}
              coordinate={{ latitude: place.latitude as number, longitude: place.longitude as number }}
              title={place.name}
              description={place.address ?? place.city ?? undefined}
              tracksViewChanges={active}
              zIndex={active ? 10 : 1}
              onPress={() => {
                haptic.selection();
                onSelectPlace?.(place);
              }}
            >
              <View style={[styles.markerShadow, active ? styles.markerShadowActive : undefined, { transform: [{ scale: active ? 1.12 : 1 }] }]}> 
                <MaterialIcons name="place" size={active ? 43 : 38} color={accent} />
              </View>
            </Marker>
          );
        })}
      </MapView>
      {visiblePlaces.length === 0 ? (
        <View style={[styles.overlay, { backgroundColor: palette.glass, borderColor: palette.border }]}> 
          <Text style={[styles.overlayTitle, { color: palette.text }]}>Aucun point à afficher</Text>
          <Text style={[styles.overlayText, { color: palette.muted }]}>Configurez l’API puis rechargez les données.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, overflow: "hidden" },
  map: StyleSheet.absoluteFill,
  markerShadow: { alignItems: "center", justifyContent: "center" },
  markerShadowActive: {
    shadowColor: "#031308",
    shadowOpacity: 0.26,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 10,
  },

  overlay: { position: "absolute", left: 20, right: 20, bottom: 120, borderRadius: 18, padding: 16, borderWidth: 1 },
  overlayTitle: { fontWeight: "900", fontSize: 15, lineHeight: 20 },
  overlayText: { marginTop: 4, fontSize: 13, lineHeight: 18 },
});
