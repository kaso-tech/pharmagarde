"use dom";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl from "maplibre-gl";
import type { DOMProps } from "expo/dom";
import { useEffect, useRef } from "react";

// Carte de vérification d'un établissement : position retenue (repère déplaçable, un clic la
// déplace) et positions de référence (point publié, OpenStreetMap, signalements, voisins).

export type MapReference = { key: string; label: string; latitude: number; longitude: number; color: string; title: string };

type VerificationMapViewProps = {
  value: { latitude: number; longitude: number } | null;
  references: MapReference[];
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
  element.style.cssText = "width:44px;height:44px;cursor:grab;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));";
  element.innerHTML = `<svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><path d="${PIN_PATH}" fill="${color}" stroke="#FFFFFF" stroke-width="1.4"/></svg>`;
  return element;
}

function createReference(reference: MapReference) {
  const element = document.createElement("div");
  element.title = reference.title;
  element.style.cssText = `width:24px;height:24px;border-radius:12px;background:${reference.color};color:#fff;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);font:700 12px/20px system-ui,sans-serif;text-align:center;`;
  element.textContent = reference.label;
  return element;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

export default function VerificationMapView({ value, references, center, styleUrl, fallbackStyleUrl, attribution, color, onPick }: VerificationMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const referenceMarkers = useRef<maplibregl.Marker[]>([]);
  const onPickRef = useRef(onPick);
  const initialRef = useRef({ value, references, center, fallbackStyleUrl, attribution, color });
  const styleRef = useRef(styleUrl);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initial = initialRef.current;
    const start = initial.value ?? initial.center;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleRef.current,
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
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    const marker = new maplibregl.Marker({ element: createPin(initial.color), anchor: "bottom", draggable: true });
    const pick = (lngLat: maplibregl.LngLat) => void onPickRef.current(round(lngLat.lat), round(lngLat.lng));
    marker.on("dragend", () => pick(marker.getLngLat()));
    map.on("click", (event) => {
      marker.setLngLat(event.lngLat);
      if (!marker.getElement().isConnected) marker.addTo(map);
      pick(event.lngLat);
    });
    if (initial.value) marker.setLngLat([initial.value.longitude, initial.value.latitude]).addTo(map);

    // Cadrage sur la position et toutes les références.
    const points = [...(initial.value ? [initial.value] : []), ...initial.references];
    if (points.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      for (const point of points) bounds.extend([point.longitude, point.latitude]);
      map.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 0 });
    }

    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Fond de carte changé (plan / satellite).
  useEffect(() => {
    if (!mapRef.current || styleRef.current === styleUrl) return;
    styleRef.current = styleUrl;
    mapRef.current.setStyle(styleUrl);
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of referenceMarkers.current) marker.remove();
    referenceMarkers.current = references.map((reference) => new maplibregl.Marker({ element: createReference(reference) }).setLngLat([reference.longitude, reference.latitude]).addTo(map));
  }, [references]);

  // Position choisie ailleurs (source sélectionnée, saisie) : déplacer le repère.
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
    map.easeTo({ center: [value.longitude, value.latitude], duration: 300 });
  }, [value]);

  return (
    <>
      <style>{"html,body,#root{height:100%;margin:0;}"}</style>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </>
  );
}
