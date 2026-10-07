"use dom";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl from "maplibre-gl";
import type { DOMProps } from "expo/dom";
import { useEffect, useRef } from "react";

// Carte de sélection d'un emplacement : un toucher place le repère, qui peut ensuite être déplacé.
// Même rendu que la carte principale (MapLibre dans une WebView sur iOS/Android).

type LocationPickerViewProps = {
  value?: { latitude: number; longitude: number } | null;
  /** Centre initial quand aucun point n'est choisi (ville de l'utilisateur ou sa position). */
  center: { latitude: number; longitude: number };
  styleUrl: string;
  fallbackStyleUrl?: string;
  attribution?: string;
  color: string;
  onPick: (latitude: number, longitude: number) => void | Promise<void>;
  dom?: DOMProps;
};

const PIN_PATH = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z";

function createPin(color: string) {
  const element = document.createElement("div");
  element.style.cssText = "width:44px;height:44px;cursor:grab;";
  element.innerHTML = `<svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><path d="${PIN_PATH}" fill="${color}" stroke="#FFFFFF" stroke-width="1.4"/></svg>`;
  return element;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

export default function LocationPickerView({ value, center, styleUrl, fallbackStyleUrl, attribution, color, onPick }: LocationPickerViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const initialRef = useRef({ value, center, styleUrl, fallbackStyleUrl, attribution, color });

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initial = initialRef.current;
    const start = initial.value ?? initial.center;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initial.styleUrl,
      center: [start.longitude, start.latitude],
      zoom: initial.value ? 16 : 13,
      attributionControl: { compact: true, customAttribution: initial.attribution },
    });
    let styleLoaded = false;
    let usedFallback = false;
    map.on("style.load", () => {
      styleLoaded = true;
    });
    map.on("error", () => {
      if (styleLoaded || usedFallback || !initial.fallbackStyleUrl) return;
      usedFallback = true;
      map.setStyle(initial.fallbackStyleUrl);
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    const marker = new maplibregl.Marker({ element: createPin(initial.color), anchor: "bottom", draggable: true });
    const pick = (lngLat: maplibregl.LngLat) => void onPickRef.current(round(lngLat.lat), round(lngLat.lng));
    marker.on("dragend", () => pick(marker.getLngLat()));
    map.on("click", (event) => {
      marker.setLngLat(event.lngLat);
      if (!marker.getElement().isConnected) marker.addTo(map);
      pick(event.lngLat);
    });
    if (initial.value) marker.setLngLat([initial.value.longitude, initial.value.latitude]).addTo(map);

    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Point choisi ailleurs (saisie manuelle, « Ma position ») : déplacer le repère et la vue.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (!value) {
      marker.remove();
      return;
    }
    const current = marker.getElement().isConnected ? marker.getLngLat() : null;
    if (current && round(current.lat) === round(value.latitude) && round(current.lng) === round(value.longitude)) return;
    marker.setLngLat([value.longitude, value.latitude]);
    if (!marker.getElement().isConnected) marker.addTo(map);
    map.flyTo({ center: [value.longitude, value.latitude], zoom: Math.max(map.getZoom(), 16), duration: 300 });
  }, [value]);

  useEffect(() => {
    if (value || !mapRef.current) return;
    mapRef.current.jumpTo({ center: [center.longitude, center.latitude] });
    // Recentrer seulement quand la ville change, pas à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.latitude, center.longitude]);

  return (
    <>
      <style>{"html,body,#root{height:100%;margin:0;}"}</style>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </>
  );
}
