import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Coordinates, HealthPlace, MapPreference } from "@/lib/pharmagarde/types";

const GREEN = "#008000";
const BLUE = "#0B74DE";
const DEFAULT_CENTER = { latitude: 12.3714, longitude: -1.5197 };
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

declare global {
  interface Window {
    google?: any;
    __pharmaGoogleMapsPromise?: Promise<void>;
  }
}

function loadGoogleMaps() {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps Web requiert un navigateur."));
  if (window.google?.maps) return Promise.resolve();
  if (!GOOGLE_MAPS_API_KEY) return Promise.reject(new Error("Clé Google Maps non configurée."));
  if (window.__pharmaGoogleMapsPromise) return window.__pharmaGoogleMapsPromise;

  window.__pharmaGoogleMapsPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-pharmagarde-google-maps="true"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Chargement Google Maps impossible.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&v=weekly&loading=async`;
    script.async = true;
    script.defer = true;
    script.dataset.pharmagardeGoogleMaps = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Chargement Google Maps impossible.")), { once: true });
    document.head.appendChild(script);
  });

  return window.__pharmaGoogleMapsPromise;
}

function getCenter(places: HealthPlace[], userLocation?: Coordinates) {
  if (userLocation) return { lat: userLocation.latitude, lng: userLocation.longitude };
  const firstPlace = places.find((place) => place.latitude !== undefined && place.longitude !== undefined);
  if (firstPlace?.latitude !== undefined && firstPlace.longitude !== undefined) return { lat: firstPlace.latitude, lng: firstPlace.longitude };
  return { lat: DEFAULT_CENTER.latitude, lng: DEFAULT_CENTER.longitude };
}

const PLACE_PIN_PATH = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z";

export function PharmaMap({ places, userLocation, mapType = "Standard" }: { places: HealthPlace[]; userLocation?: Coordinates; mapType?: MapPreference }) {
  const mapContainerRef = useRef<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const center = useMemo(() => getCenter(places, userLocation), [places, userLocation]);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapContainerRef.current || !window.google?.maps) return;

        const map = new window.google.maps.Map(mapContainerRef.current, {
          center,
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: true,
          gestureHandling: "greedy",
          mapTypeId: mapType === "Satellite" ? window.google.maps.MapTypeId.SATELLITE : window.google.maps.MapTypeId.ROADMAP,
          styles: [
            { featureType: "poi.medical", stylers: [{ visibility: "on" }] },
            { featureType: "poi.business", stylers: [{ saturation: -20 }] },
            { featureType: "water", stylers: [{ color: "#CDEFFF" }] },
          ],
        });

        if (userLocation) {
          new window.google.maps.Marker({
            position: { lat: userLocation.latitude, lng: userLocation.longitude },
            map,
            title: "Votre position",
            label: { text: "Vous", color: "#FFFFFF", fontWeight: "800" },
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              fillColor: "#102016",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 3,
              scale: 10,
            },
          });
        }

        places.forEach((place) => {
          if (place.latitude === undefined || place.longitude === undefined) return;
          const marker = new window.google.maps.Marker({
            position: { lat: place.latitude, lng: place.longitude },
            map,
            title: place.name,
            icon: {
              path: PLACE_PIN_PATH,
              fillColor: place.type === "pharmacy" ? GREEN : BLUE,
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 2,
              scale: 1.65,
              anchor: new window.google.maps.Point(12, 22),
            },
          });

          const infoWindow = new window.google.maps.InfoWindow({
            content: `<strong>${place.name}</strong><br>${place.address ?? place.city ?? "Burkina Faso"}`,
          });
          marker.addListener("click", () => infoWindow.open({ map, anchor: marker }));
        });
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, [center, places, userLocation, mapType]);

  return (
    <View style={styles.wrapper}>
      <div ref={mapContainerRef} style={styles.webMap as React.CSSProperties} />
      {loadError ? (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Google Maps non disponible</Text>
          <Text style={styles.overlayText}>{loadError}</Text>
          <Text style={styles.overlayHelp}>Renseignez EXPO_PUBLIC_GOOGLE_MAPS_API_KEY avec Maps JavaScript API activée pour afficher la carte Google ici.</Text>
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { height: 380, margin: 16, borderRadius: 12, overflow: "hidden", backgroundColor: "#EAF8EF", borderWidth: 1, borderColor: "#CBE7D3", shadowColor: "#092A13", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  webMap: { width: "100%", height: "100%" },
  overlay: { position: "absolute", left: 18, right: 18, top: 18, borderRadius: 10, padding: 14, backgroundColor: "rgba(255,255,255,0.96)", borderWidth: 1, borderColor: "#D8EBDD" },
  overlayTitle: { color: "#102016", fontWeight: "900", fontSize: 15, lineHeight: 20 },
  overlayText: { color: "#B42318", marginTop: 5, fontWeight: "800", fontSize: 13, lineHeight: 18 },
  overlayHelp: { color: "#667085", marginTop: 6, fontSize: 12, lineHeight: 17 },

});
