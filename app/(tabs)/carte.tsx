import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useMemo, useState } from "react";
import { Animated, FlatList, Linking, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { AppChrome, localPlaceTypeLabel, PlaceStatusBadge } from "@/components/pharmagarde/app-ui";
import { PharmaMap } from "@/components/pharmagarde/PharmaMap";
import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import { sortPlacesByOpenThenDistance } from "@/lib/pharmagarde/place-ordering";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { FavoriteItem, HealthPlace, favoriteKey } from "@/lib/pharmagarde/types";

type FilterMode = "all" | "pharmacy" | "clinic";

function keyFor(place: HealthPlace) {
  return `${place.type}-${place.id}`;
}

function favoriteFromPlace(place: HealthPlace): FavoriteItem {
  return {
    id: place.id,
    entityType: place.type,
    title: place.name,
    subtitle: place.address ?? place.city,
    metadata: place.distanceLabel ?? (place.onDuty === true ? "Garde" : place.isOpen === true ? "Ouvert" : undefined),
    phone: place.phone,
    rating: place.rating,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

async function openDirections(place: HealthPlace) {
  if (place.latitude === undefined || place.longitude === undefined) return;
  const destination = `${place.latitude},${place.longitude}`;
  await WebBrowser.openBrowserAsync(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`);
}

async function callPhone(phone?: string) {
  if (!phone) return;
  await Linking.openURL(`tel:${phone.replace(/\s+/g, "")}`);
}

function SkeletonCard() {
  const palette = usePremiumPalette();
  return (
    <View style={[styles.skeletonCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
      <View style={[styles.skeletonCircle, { backgroundColor: palette.cardMuted }]} />
      <View style={styles.skeletonBody}>
        <View style={[styles.skeletonLine, { width: "72%", backgroundColor: palette.cardMuted }]} />
        <View style={[styles.skeletonLine, { width: "52%", backgroundColor: palette.cardMuted }]} />
        <View style={[styles.skeletonLineSmall, { width: "42%", backgroundColor: palette.cardMuted }]} />
      </View>
    </View>
  );
}

function MapPlaceCard({ place, active, favorite, isExpanded, onSelect, onToggle, onToggleFavorite }: { place: HealthPlace; active: boolean; favorite: boolean; isExpanded: boolean; onSelect: () => void; onToggle: () => void; onToggleFavorite: () => void }) {
  const palette = usePremiumPalette();
  const accent = place.type === "pharmacy" ? palette.brand : palette.clinic;
  const canCall = !!place.phone;
  const canNavigate = place.latitude !== undefined && place.longitude !== undefined;
  const ratingLabel = place.rating !== undefined ? `${place.rating.toFixed(1)}/5` : "Note inconnue";
  const phoneLabel = place.phone ?? "Téléphone indisponible";
  const typeLabel = localPlaceTypeLabel(place);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${place.name}. Appuyer pour ${isExpanded ? "masquer" : "afficher"} les actions.`}
      style={({ pressed }) => [styles.placeCard, { backgroundColor: palette.card, borderColor: active ? accent : palette.border, borderWidth: active ? 2 : 1 }, pressed ? styles.pressedCard : undefined]}
      onPress={() => {
        haptic.selection();
        onSelect();
        onToggle();
      }}
    >
      <View style={styles.placeHeader}>
        <View style={[styles.placeIcon, { backgroundColor: accent }]}> 
          <MaterialIcons name={place.type === "pharmacy" ? "local-pharmacy" : "local-hospital"} size={21} color="#FFFFFF" />
        </View>
        <View style={styles.placeTitleArea}>
          <View style={styles.placeTitleRow}>
            <Text style={[styles.placeTitle, { color: palette.text }]} numberOfLines={1}>{place.name}</Text>
            <PlaceStatusBadge place={place} />
          </View>
          <Text style={[styles.placeSubtitle, { color: palette.muted }]} numberOfLines={1}>{place.address ?? place.city ?? "Adresse non renseignée"}</Text>
        </View>
        <View style={styles.placeHeaderMeta}>
          <View style={[styles.metaPill, { backgroundColor: palette.cardMuted }]}> 
            <Text style={[styles.metaText, { color: palette.text }]}>{place.distanceLabel ?? (place.distanceKm !== undefined ? `${place.distanceKm.toFixed(1)} km` : "Distance indisponible")}</Text>
          </View>
        </View>
      </View>

      {isExpanded ? (
        <View style={styles.placeExpandableContent}>
          <View style={styles.placeInfoRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
              hitSlop={10}
              style={({ pressed }) => [styles.favoriteButton, pressed ? styles.pressedScale : undefined]}
              onPress={(event) => {
                event.stopPropagation();
                haptic.light();
                onToggleFavorite();
              }}
            >
              <MaterialIcons name={favorite ? "favorite" : "favorite-border"} size={23} color={favorite ? palette.danger : palette.muted} />
            </Pressable>
            <View style={[styles.compactInfoPill, styles.typeInfoPill, { backgroundColor: palette.cardMuted }]}> 
              <MaterialIcons name={place.type === "pharmacy" ? "local-pharmacy" : "local-hospital"} size={15} color={accent} />
              <Text numberOfLines={1} style={[styles.compactInfoText, { color: palette.text }]}>{typeLabel}</Text>
            </View>
            <View style={[styles.compactInfoPill, { backgroundColor: palette.cardMuted }]}> 
              <MaterialIcons name="star" size={15} color={place.rating !== undefined ? "#F59E0B" : palette.muted} />
              <Text style={[styles.compactInfoText, { color: palette.text }]}>{ratingLabel}</Text>
            </View>
            <View style={[styles.compactInfoPill, styles.phoneInfoPill, { backgroundColor: palette.cardMuted }]}> 
              <MaterialIcons name="phone" size={15} color={canCall ? accent : palette.muted} />
              <Text numberOfLines={1} style={[styles.compactInfoText, { color: canCall ? palette.text : palette.muted }]}>{phoneLabel}</Text>
            </View>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={!canCall}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: palette.cardMuted, opacity: canCall ? 1 : 0.46 }, pressed && canCall ? styles.pressedScale : undefined]}
              onPress={(event) => {
                event.stopPropagation();
                haptic.light();
                callPhone(place.phone);
              }}
            >
              <MaterialIcons name="call" size={18} color={canCall ? accent : palette.muted} />
              <Text style={[styles.actionText, { color: canCall ? palette.text : palette.muted }]}>Appel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!canNavigate}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: palette.cardMuted, opacity: canNavigate ? 1 : 0.46 }, pressed && canNavigate ? styles.pressedScale : undefined]}
              onPress={(event) => {
                event.stopPropagation();
                haptic.medium();
                openDirections(place);
              }}
            >
              <MaterialIcons name="directions" size={18} color={canNavigate ? accent : palette.muted} />
              <Text style={[styles.actionText, { color: canNavigate ? palette.text : palette.muted }]}>Itinéraire</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function CarteScreen() {
  const { height } = useWindowDimensions();
  const palette = usePremiumPalette();
  const { pharmacies, clinics, userLocation, preferences, loading, errors, refreshingLocation, favoriteKeys, toggleFavorite, refreshData, requestLocation } = usePharmaGarde();
  const [filter, setFilter] = useState<FilterMode>("all");
  const allPlaces = useMemo(() => sortPlacesByOpenThenDistance([...pharmacies, ...clinics]), [clinics, pharmacies]);
  const visiblePlaces = useMemo(() => filter === "all" ? allPlaces : allPlaces.filter((place) => place.type === filter), [allPlaces, filter]);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => visiblePlaces[0] ? keyFor(visiblePlaces[0]) : undefined);
  const [expandedPlaceId, setExpandedPlaceId] = useState<string | undefined>();
  const sheetHeight = Math.min(Math.max(height * 0.66, 440), 640);
  const snap = useMemo(() => ({ full: 0, mid: sheetHeight * 0.42, min: sheetHeight - 104 }), [sheetHeight]);
  const [translateY] = useState(() => new Animated.Value(snap.mid));
  // Position de départ du geste, lue et écrite uniquement dans les callbacks du PanResponder.
  const [dragStart] = useState(() => ({ current: snap.mid }));

  const selectedPlace = visiblePlaces.find((place) => keyFor(place) === selectedId) ?? visiblePlaces[0];

  const animateTo = useCallback((toValue: number) => {
    Animated.timing(translateY, { toValue, duration: 240, useNativeDriver: true }).start();
  }, [translateY]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8,
    onPanResponderGrant: () => {
      translateY.stopAnimation((value) => {
        dragStart.current = value;
      });
    },
    onPanResponderMove: (_, gesture) => {
      const next = Math.min(Math.max(dragStart.current + gesture.dy, snap.full), snap.min);
      translateY.setValue(next);
    },
    onPanResponderRelease: (_, gesture) => {
      const projected = Math.min(Math.max(dragStart.current + gesture.dy + gesture.vy * 70, snap.full), snap.min);
      const points = [snap.full, snap.mid, snap.min];
      const nearest = points.reduce((closest, point) => Math.abs(point - projected) < Math.abs(closest - projected) ? point : closest, snap.mid);
      haptic.light();
      animateTo(nearest);
    },
  }), [animateTo, dragStart, snap.full, snap.mid, snap.min, translateY]);

  const selectPlace = (place: HealthPlace) => {
    setSelectedId(keyFor(place));
    animateTo(snap.mid);
  };

  const filterItems: { key: FilterMode; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
    { key: "all", label: "Tout", icon: "layers" },
    { key: "pharmacy", label: "Pharmacies", icon: "local-pharmacy" },
    { key: "clinic", label: "Cliniques", icon: "local-hospital" },
  ];

  return (
    <AppChrome subtitle="Carte">
      <View style={[styles.page, { backgroundColor: palette.background }]}> 
        <PharmaMap places={visiblePlaces} userLocation={userLocation} mapType={preferences.mapType} selectedPlaceId={selectedPlace ? keyFor(selectedPlace) : selectedId} onSelectPlace={selectPlace} />

        <View style={styles.topOverlay} pointerEvents="box-none">
          <View style={styles.filterRow}>
            {filterItems.map((item) => {
              const active = filter === item.key;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [styles.filterChip, { backgroundColor: active ? palette.brand : palette.glass, borderColor: active ? palette.brand : palette.border }, pressed ? styles.pressedScale : undefined]}
                  onPress={() => {
                    haptic.selection();
                    setFilter(item.key);
                  }}
                >
                  <MaterialIcons name={item.icon} size={16} color={active ? "#FFFFFF" : palette.brand} />
                  <Text style={[styles.filterText, { color: active ? "#FFFFFF" : palette.text }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.statusOverlay, { backgroundColor: palette.glass, borderColor: palette.border }]}> 
          <View style={[styles.statusDot, { backgroundColor: errors.pharmacies || errors.clinics ? palette.warning : palette.brand }]} />
          <Text style={[styles.statusText, { color: palette.text }]} numberOfLines={1}>{loading ? "Synchronisation en cours…" : `${visiblePlaces.length} lieux disponibles près de ${preferences.city}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Actualiser" hitSlop={10} onPress={() => { haptic.light(); refreshData(); }}>
            <MaterialIcons name="refresh" size={18} color={palette.brand} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ma position"
          style={({ pressed }) => [styles.locationButton, { backgroundColor: palette.glass, borderColor: palette.border }, pressed ? styles.pressedScale : undefined]}
          onPress={() => {
            haptic.medium();
            requestLocation();
          }}
        >
          <MaterialIcons name={refreshingLocation ? "sync" : "my-location"} size={18} color={palette.brand} />
          <Text style={[styles.locationButtonText, { color: palette.text }]}>{refreshingLocation ? "Localisation…" : "Ma position"}</Text>
        </Pressable>

        <Animated.View style={[styles.sheet, { height: sheetHeight, backgroundColor: palette.background, borderColor: palette.border, transform: [{ translateY }] }]}> 
          <View {...panResponder.panHandlers} style={styles.sheetHandleArea}>
            <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={[styles.sheetTitle, { color: palette.text }]}>À proximité</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.muted }]}>{selectedPlace ? selectedPlace.name : "Pharmacies et structures de santé"}</Text>
              </View>
              <Pressable style={({ pressed }) => [styles.expandButton, { backgroundColor: palette.cardMuted }, pressed ? styles.pressedScale : undefined]} onPress={() => { haptic.selection(); animateTo(snap.full); }}>
                <MaterialIcons name="keyboard-arrow-up" size={24} color={palette.brand} />
              </Pressable>
            </View>
          </View>

          {loading && visiblePlaces.length === 0 ? (
            <View style={styles.skeletonList}>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : (
            <FlatList
              data={visiblePlaces}
              keyExtractor={keyFor}
              renderItem={({ item }) => {
                const favorite = favoriteKeys.has(favoriteKey(item.type, item.id));
                const itemKey = keyFor(item);
                return (
                  <MapPlaceCard
                    place={item}
                    active={itemKey === selectedId}
                    favorite={favorite}
                    isExpanded={expandedPlaceId === itemKey}
                    onSelect={() => selectPlace(item)}
                    onToggle={() => setExpandedPlaceId((current) => current === itemKey ? undefined : itemKey)}
                    onToggleFavorite={() => toggleFavorite(favoriteFromPlace(item))}
                  />
                );
              }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetList}
              ListEmptyComponent={<Text style={[styles.emptyText, { color: palette.muted }]}>Aucune donnée disponible. Vérifiez la connexion API ou relancez la synchronisation.</Text>}
            />
          )}
        </Animated.View>
      </View>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, overflow: "hidden" },
  topOverlay: { position: "absolute", top: 14, left: 0, right: 0 },
  filterRow: { paddingHorizontal: 14, flexDirection: "row", gap: 9 },
  filterChip: { minHeight: 38, borderRadius: 19, borderWidth: 1, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 7, shadowColor: "#092A13", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  filterText: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  statusOverlay: { position: "absolute", left: 14, right: 14, top: 62, minHeight: 42, borderRadius: 21, borderWidth: 1, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9, shadowColor: "#092A13", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  locationButton: { position: "absolute", right: 14, top: 112, minHeight: 40, borderRadius: 20, borderWidth: 1, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 7, shadowColor: "#092A13", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  locationButtonText: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderBottomWidth: 0, shadowColor: "#041207", shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: -7 }, elevation: 22, overflow: "hidden" },
  sheetHandleArea: { paddingTop: 10, paddingHorizontal: 18, paddingBottom: 8 },
  sheetHandle: { width: 48, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: 12 },
  sheetHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 20, lineHeight: 25, fontWeight: "900" },
  sheetSubtitle: { marginTop: 2, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  expandButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  sheetList: { paddingHorizontal: 14, paddingBottom: 34, gap: 12 },
  placeCard: { borderRadius: 22, padding: 14, marginBottom: 12, shadowColor: "#092A13", shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  pressedCard: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  pressedScale: { opacity: 0.86, transform: [{ scale: 0.97 }] },
  placeHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  placeIcon: { width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  placeTitleArea: { flex: 1 },
  placeTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  placeHeaderMeta: { alignItems: "flex-end", gap: 6, maxWidth: 132 },
  placeTitle: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "900" },
  placeSubtitle: { fontSize: 12, lineHeight: 17, fontWeight: "700", marginTop: 2 },
  favoriteButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 12 },
  metaPill: { minHeight: 30, borderRadius: 15, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 12, lineHeight: 15, fontWeight: "900" },
  placeExpandableContent: { marginTop: 2 },
  placeInfoRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 9 },
  compactInfoPill: { minHeight: 26, borderRadius: 13, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  typeInfoPill: { flexShrink: 1, maxWidth: 108 },
  phoneInfoPill: { flex: 1, minWidth: 82, justifyContent: "flex-start" },
  compactInfoText: { fontSize: 10, lineHeight: 12, fontWeight: "900" },
  actionRow: { flexDirection: "row", gap: 9, marginTop: 12 },
  actionButton: { flex: 1, minHeight: 42, borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  actionText: { fontSize: 13, lineHeight: 16, fontWeight: "900" },
  skeletonList: { paddingHorizontal: 14, gap: 12 },
  skeletonCard: { borderWidth: 1, borderRadius: 22, padding: 14, flexDirection: "row", gap: 12, alignItems: "center" },
  skeletonCircle: { width: 46, height: 46, borderRadius: 18 },
  skeletonBody: { flex: 1, gap: 9 },
  skeletonLine: { height: 12, borderRadius: 6 },
  skeletonLineSmall: { height: 10, borderRadius: 5 },
  emptyText: { paddingHorizontal: 18, paddingTop: 24, fontSize: 14, lineHeight: 20, fontWeight: "700", textAlign: "center" },
});
