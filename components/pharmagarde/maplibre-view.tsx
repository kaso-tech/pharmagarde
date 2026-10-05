"use dom";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { DOMProps } from "expo/dom";
import { useEffect, useRef } from "react";

// Rendu MapLibre GL JS commun au web et au natif : sur iOS/Android, Expo l'exécute dans
// une WebView (@expo/dom-webview, incluse dans Expo Go), sans module natif supplémentaire.

export type MapLibrePlace = {
  key: string;
  kind: "pharmacy" | "clinic";
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
};

type MapLibreViewProps = {
  places: MapLibrePlace[];
  userLocation?: { latitude: number; longitude: number } | null;
  satellite: boolean;
  styleUrl: string;
  selectedKey?: string | null;
  pharmacyColor: string;
  clinicColor: string;
  onSelectPlace?: (key: string) => void | Promise<void>;
  dom?: DOMProps;
};

const DEFAULT_CENTER: [number, number] = [-1.5197, 12.3714];
const PIN_PATH = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z";

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagerie © Esri, Maxar, Earthstar Geographics · Lieux © contributeurs OpenStreetMap",
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "satellite" }],
};

function styleFor(satellite: boolean, styleUrl: string) {
  return satellite ? SATELLITE_STYLE : styleUrl;
}

function createPinElement(color: string) {
  const element = document.createElement("button");
  element.type = "button";
  element.style.cssText = "width:40px;height:40px;padding:0;border:0;background:none;cursor:pointer;transition:transform 120ms ease;transform-origin:50% 100%;";
  element.innerHTML = `<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="${PIN_PATH}" fill="${color}" stroke="#FFFFFF" stroke-width="1.4"/></svg>`;
  return element;
}

function createUserElement() {
  const element = document.createElement("div");
  element.textContent = "Vous";
  element.style.cssText = "padding:6px 10px;border-radius:16px;border:3px solid #FFFFFF;background:#102016;color:#FFFFFF;font:800 12px/15px system-ui,sans-serif;box-shadow:0 4px 10px rgba(16,32,22,0.25);";
  return element;
}

function createPopupContent(place: MapLibrePlace) {
  const container = document.createElement("div");
  container.style.cssText = "font:13px/18px system-ui,sans-serif;color:#102016;max-width:220px;";
  const title = document.createElement("strong");
  title.textContent = place.name;
  const subtitle = document.createElement("div");
  subtitle.textContent = place.subtitle;
  subtitle.style.color = "#667085";
  container.append(title, subtitle);
  return container;
}

export default function MapLibreView({ places, userLocation, satellite, styleUrl, selectedKey, pharmacyColor, clinicColor, onSelectPlace }: MapLibreViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef(new Map<string, { marker: maplibregl.Marker; element: HTMLButtonElement; place: MapLibrePlace }>());
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const onSelectRef = useRef(onSelectPlace);
  const appliedStyleRef = useRef({ satellite, styleUrl });

  useEffect(() => {
    onSelectRef.current = onSelectPlace;
  }, [onSelectPlace]);

  useEffect(() => {
    if (!containerRef.current) return;
    const { satellite: initialSatellite, styleUrl: initialStyleUrl } = appliedStyleRef.current;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(initialSatellite, initialStyleUrl),
      center: DEFAULT_CENTER,
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    const markers = markersRef.current;

    return () => {
      markers.clear();
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const applied = appliedStyleRef.current;
    if (applied.satellite === satellite && applied.styleUrl === styleUrl) return;
    appliedStyleRef.current = { satellite, styleUrl };
    mapRef.current?.setStyle(styleFor(satellite, styleUrl));
  }, [satellite, styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current.clear();

    places.forEach((place) => {
      const element = createPinElement(place.kind === "pharmacy" ? pharmacyColor : clinicColor);
      element.setAttribute("aria-label", `Sélectionner ${place.name}`);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        void onSelectRef.current?.(place.key);
      });
      const marker = new maplibregl.Marker({ element, anchor: "bottom" })
        .setLngLat([place.longitude, place.latitude])
        .setPopup(new maplibregl.Popup({ offset: 34, closeButton: false }).setDOMContent(createPopupContent(place)))
        .addTo(map);
      markersRef.current.set(place.key, { marker, element, place });
    });

    if (!userLocation && places.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      places.forEach((place) => bounds.extend([place.longitude, place.latitude]));
      map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 0 });
    }
  }, [places, pharmacyColor, clinicColor, userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (!userLocation) return;
    userMarkerRef.current = new maplibregl.Marker({ element: createUserElement() }).setLngLat([userLocation.longitude, userLocation.latitude]).addTo(map);
    map.jumpTo({ center: [userLocation.longitude, userLocation.latitude], zoom: 13 });
  }, [userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(({ marker, element, place }) => {
      const active = place.key === selectedKey;
      element.style.transform = active ? "scale(1.18)" : "scale(1)";
      element.style.zIndex = active ? "10" : "1";
      if (!active && marker.getPopup()?.isOpen()) marker.togglePopup();
    });
    const selected = selectedKey ? markersRef.current.get(selectedKey) : undefined;
    if (!selected) return;
    map.flyTo({ center: [selected.place.longitude, selected.place.latitude], zoom: Math.max(map.getZoom(), 14), duration: 320 });
    if (!selected.marker.getPopup()?.isOpen()) selected.marker.togglePopup();
  }, [selectedKey, places]);

  return (
    <>
      <style>{"html,body,#root{height:100%;margin:0;}"}</style>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </>
  );
}
