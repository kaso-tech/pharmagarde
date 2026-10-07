import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as WebBrowser from "expo-web-browser";
import { PropsWithChildren, RefObject, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { GlobalAppShell } from "@/components/pharmagarde/app-shell";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { formatInsurers } from "@/lib/pharmagarde/insurances";
import { placeHoursLabel, placeStatusLabel } from "@/lib/pharmagarde/place-ordering";
import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import { CombinedSearchItem, FavoriteItem, HealthPlace, Medicine, favoriteKey } from "@/lib/pharmagarde/types";

function entityLabel(type: FavoriteItem["entityType"]) {
  if (type === "pharmacy") return "Pharmacie";
  if (type === "clinic") return "Clinique";
  return "Médicament";
}

export function localPlaceTypeLabel(place: HealthPlace) {
  return place.establishmentType ?? (place.type === "pharmacy" ? "Pharmacie" : "Centre de santé");
}

async function openDirections(item: { latitude?: number; longitude?: number; title: string }) {
  if (item.latitude === undefined || item.longitude === undefined) return;
  const destination = `${item.latitude},${item.longitude}`;
  await WebBrowser.openBrowserAsync(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`);
}

async function callPhone(phone?: string) {
  if (!phone) return;
  await Linking.openURL(`tel:${phone.replace(/\s+/g, "")}`);
}

/** Avertissement affiché sur chaque fiche médicament et en tête du catalogue. */
export const MEDICAL_DISCLAIMER = "Information indicative : ne remplace pas l’avis d’un médecin ou d’un pharmacien. Ne commencez, n’arrêtez ni ne modifiez un traitement sans avis professionnel. En cas d’urgence, contactez les secours ou rendez-vous au centre de santé le plus proche.";

export function MedicalDisclaimer({ compact = false }: { compact?: boolean }) {
  const palette = usePremiumPalette();
  return (
    <View accessibilityRole="text" style={[styles.disclaimer, { backgroundColor: palette.cardMuted, borderColor: palette.border }]}>
      <MaterialIcons name="health-and-safety" size={compact ? 16 : 18} color={palette.danger} />
      <Text style={[compact ? styles.disclaimerTextCompact : styles.disclaimerText, { color: palette.text }]}>{MEDICAL_DISCLAIMER}</Text>
    </View>
  );
}

export function formatMedicinePrice(priceApprox?: number) {
  return priceApprox !== undefined ? `${priceApprox.toLocaleString("fr-FR")} FCFA` : "Prix variable";
}

export function AppChrome({ children, subtitle, hideHeaderSearch }: PropsWithChildren<{ subtitle?: string; hideHeaderSearch?: boolean }>) {
  return <GlobalAppShell subtitle={subtitle} hideHeaderSearch={hideHeaderSearch}>{children}</GlobalAppShell>;
}

export function EmptyState({ title, message, actionLabel, onAction }: { title: string; message: string; actionLabel?: string; onAction?: () => void }) {
  const palette = usePremiumPalette();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.softGreen }]}> 
        <MaterialIcons name="local-pharmacy" size={30} color={palette.brand} />
      </View>
      <Text style={[styles.emptyTitle, { color: palette.text }]}>{title}</Text>
      <Text style={[styles.emptyMessage, { color: palette.muted }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.primaryButton, { backgroundColor: palette.brand }, pressed ? styles.pressedScale : undefined]} onPress={() => { haptic.light(); onAction(); }}>
          <Text style={styles.primaryButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function StatusNotice({ message, tone = "info" }: { message?: string; tone?: "info" | "error" | "success" }) {
  const palette = usePremiumPalette();
  if (!message) return null;
  const accent = tone === "error" ? palette.danger : tone === "success" ? palette.success : palette.clinic;
  return (
    <View style={[styles.notice, { backgroundColor: tone === "error" ? "rgba(225, 29, 72, 0.1)" : tone === "success" ? palette.softGreen : palette.card, borderColor: accent }]}> 
      <MaterialIcons name={tone === "error" ? "error-outline" : tone === "success" ? "verified" : "info-outline"} size={18} color={accent} />
      <Text style={[styles.noticeText, { color: tone === "error" ? palette.danger : palette.text }]}>{message}</Text>
    </View>
  );
}

export function SearchField({ value, onChangeText, placeholder = "Rechercher", inputRef, autoFocus = false }: { value: string; onChangeText: (value: string) => void; placeholder?: string; inputRef?: RefObject<TextInput | null>; autoFocus?: boolean }) {
  const palette = usePremiumPalette();
  return (
    <View style={[styles.searchBox, { backgroundColor: palette.card, borderColor: palette.border }]}> 
      <MaterialIcons name="search" size={21} color={palette.brand} />
      <TextInput
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        style={[styles.searchInput, { color: palette.text }]}
        returnKeyType="search"
      />
    </View>
  );
}

export function PlaceCard({ place, isExpanded, onToggle }: { place: HealthPlace; isExpanded: boolean; onToggle: () => void }) {
  const { favoriteKeys, toggleFavorite } = usePharmaGarde();
  const palette = usePremiumPalette();
  const favorite: FavoriteItem = {
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
  const active = favoriteKeys.has(favoriteKey(favorite.entityType, favorite.id));
  const accent = place.type === "pharmacy" ? palette.brand : palette.clinic;
  const ratingLabel = place.rating !== undefined ? `${place.rating.toFixed(1)}/5` : "Note inconnue";
  const phoneLabel = place.phone ?? "Téléphone indisponible";
  const hoursLabel = placeHoursLabel(place);
  const typeLabel = localPlaceTypeLabel(place);
  const canNavigate = place.latitude !== undefined && place.longitude !== undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${place.name}. Appuyer pour ${isExpanded ? "masquer" : "afficher"} les actions.`}
      style={({ pressed }) => [styles.card, { backgroundColor: palette.card, borderColor: palette.border }, pressed ? styles.pressedCard : undefined]}
      onPress={() => { haptic.selection(); onToggle(); }}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.markerBadge, { backgroundColor: accent }]}> 
          <MaterialIcons name={place.type === "pharmacy" ? "local-pharmacy" : "local-hospital"} size={20} color="#FFFFFF" />
        </View>
        <View style={styles.cardTitleArea}>
          <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={1}>{place.name}</Text>
          <Text style={[styles.cardSubtitle, { color: palette.muted }]} numberOfLines={2}>{place.address ?? place.city ?? "Adresse non renseignée"}</Text>
        </View>
        <View style={styles.placeHeaderMeta}>
          <View style={[styles.metaPill, { backgroundColor: palette.cardMuted }]}> 
            <Text style={[styles.metaText, { color: palette.text }]}>{place.distanceLabel ?? (place.distanceKm !== undefined ? `${place.distanceKm.toFixed(1)} km` : "Distance indisponible")}</Text>
          </View>
          <View style={[styles.metaPill, { backgroundColor: place.isOpen === false && place.onDuty !== true ? "rgba(225, 29, 72, 0.1)" : palette.softGreen }]}> 
            <Text style={[styles.metaText, { color: place.isOpen === false && place.onDuty !== true ? palette.danger : palette.success }]}>{placeStatusLabel(place)}</Text>
          </View>
        </View>
      </View>
      {isExpanded ? (
        <View style={styles.placeExpandableContent}>
          <View style={styles.placeInfoRow}>
            <Pressable accessibilityRole="button" hitSlop={10} style={({ pressed }) => [styles.favoriteButton, pressed ? styles.pressedScale : undefined]} onPress={(event) => { event.stopPropagation(); haptic.light(); toggleFavorite(favorite); }}>
              <MaterialIcons name={active ? "favorite" : "favorite-border"} size={23} color={active ? palette.danger : palette.muted} />
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
              <MaterialIcons name="phone" size={15} color={place.phone ? accent : palette.muted} />
              <Text numberOfLines={1} style={[styles.compactInfoText, { color: place.phone ? palette.text : palette.muted }]}>{phoneLabel}</Text>
            </View>
          </View>
          {hoursLabel ? (
            <View style={styles.hoursInfoRow}>
              <MaterialIcons name="schedule" size={15} color={accent} />
              <Text style={[styles.compactInfoText, styles.hoursInfoText, { color: palette.text }]}>{hoursLabel}</Text>
            </View>
          ) : null}
          {place.insurances?.length ? (
            <View style={styles.hoursInfoRow}>
              <MaterialIcons name="health-and-safety" size={15} color={accent} />
              <Text style={[styles.compactInfoText, styles.hoursInfoText, { color: palette.text }]}>Assurances : {formatInsurers(place.insurances)}</Text>
            </View>
          ) : null}
          <View style={styles.cardActions}>
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.secondaryButton, { backgroundColor: palette.cardMuted, opacity: place.phone ? 1 : 0.46 }, pressed && place.phone ? styles.pressedScale : undefined]} disabled={!place.phone} onPress={(event) => { event.stopPropagation(); haptic.light(); callPhone(place.phone); }}>
              <MaterialIcons name="call" size={18} color={place.phone ? accent : palette.muted} />
              <Text style={[styles.secondaryButtonText, { color: place.phone ? palette.text : palette.muted }]}>Appeler</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.secondaryButton, { backgroundColor: palette.cardMuted, opacity: canNavigate ? 1 : 0.46 }, pressed && canNavigate ? styles.pressedScale : undefined]} disabled={!canNavigate} onPress={(event) => { event.stopPropagation(); haptic.medium(); openDirections(favorite); }}>
              <MaterialIcons name="directions" size={18} color={canNavigate ? accent : palette.muted} />
              <Text style={[styles.secondaryButtonText, { color: canNavigate ? palette.text : palette.muted }]}>Itinéraire</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

export function MedicineCard({ medicine }: { medicine: Medicine }) {
  const { favoriteKeys, toggleFavorite } = usePharmaGarde();
  const palette = usePremiumPalette();
  const [expanded, setExpanded] = useState(false);
  const priceLabel = formatMedicinePrice(medicine.priceApprox);
  const favorite: FavoriteItem = {
    id: medicine.id,
    entityType: "medicine",
    title: medicine.name,
    subtitle: medicine.category,
    metadata: [medicine.ageCategory, medicine.pharmaceuticalType, priceLabel].filter(Boolean).join(" · "),
  };
  const active = favoriteKeys.has(favoriteKey("medicine", medicine.id));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${medicine.name}. Appuyer pour ${expanded ? "masquer" : "afficher"} les détails.`}
      style={({ pressed }) => [styles.card, { backgroundColor: palette.card, borderColor: palette.border }, pressed ? styles.pressedCard : undefined]}
      onPress={() => { haptic.selection(); setExpanded((current) => !current); }}
    >
      <View style={styles.cardHeader}>
        {medicine.imageUrl ? <Image source={{ uri: medicine.imageUrl }} style={styles.medicineImage} /> : <View style={[styles.medicineFallback, { backgroundColor: palette.softGreen }]}><MaterialIcons name="medication" size={23} color={palette.brand} /></View>}
        <View style={styles.cardTitleArea}>
          <Text style={[styles.cardTitle, { color: palette.text }]}>{medicine.name}</Text>
          <Text style={[styles.cardSubtitle, { color: palette.muted }]}>{medicine.category ?? "Catégorie non renseignée"}</Text>
        </View>
        <View style={[styles.pricePill, { backgroundColor: palette.softGreen }]}><Text numberOfLines={1} style={[styles.priceText, { color: palette.brand }]}>{priceLabel}</Text></View>
      </View>
      {expanded ? (
        <View style={styles.medicineDetails}>
          <View style={styles.metaRow}>
            <View style={[styles.metaPill, { backgroundColor: palette.cardMuted }]}><Text style={[styles.metaText, { color: palette.text }]}>{medicine.ageCategory ?? "Tous"}</Text></View>
            <View style={[styles.metaPill, { backgroundColor: palette.cardMuted }]}><Text style={[styles.metaText, { color: palette.text }]}>{medicine.pharmaceuticalType ?? "Type inconnu"}</Text></View>
            <Pressable accessibilityRole="button" hitSlop={10} style={({ pressed }) => [styles.favoriteButton, pressed ? styles.pressedScale : undefined]} onPress={() => { haptic.light(); toggleFavorite(favorite); }}>
              <MaterialIcons name={active ? "favorite" : "favorite-border"} size={23} color={active ? palette.danger : palette.muted} />
            </Pressable>
          </View>
          {medicine.description ? <Text style={[styles.description, { color: palette.muted }]}>{medicine.description}</Text> : null}
          <MedicalDisclaimer compact />
        </View>
      ) : null}
    </Pressable>
  );
}

export function SearchResultRow({ item }: { item: CombinedSearchItem }) {
  const { favoriteKeys, toggleFavorite } = usePharmaGarde();
  const palette = usePremiumPalette();
  const active = favoriteKeys.has(favoriteKey(item.entityType, item.id));
  return (
    <Pressable style={({ pressed }) => [styles.resultRow, { backgroundColor: palette.card, borderColor: palette.border }, pressed ? styles.pressedCard : undefined]}>
      <View style={[styles.resultIcon, { backgroundColor: palette.softGreen }]}> 
        <MaterialIcons name={item.entityType === "medicine" ? "medication" : item.entityType === "clinic" ? "local-hospital" : "local-pharmacy"} size={20} color={palette.brand} />
      </View>
      <View style={styles.resultText}>
        <Text style={[styles.resultTitle, { color: palette.text }]}>{item.title}</Text>
        <Text style={[styles.resultSubtitle, { color: palette.muted }]}>{item.sourceLabel}{item.subtitle ? ` · ${item.subtitle}` : ""}</Text>
      </View>
      <Pressable accessibilityRole="button" hitSlop={10} style={({ pressed }) => [styles.favoriteButton, pressed ? styles.pressedScale : undefined]} onPress={() => { haptic.light(); toggleFavorite(item); }}>
        <MaterialIcons name={active ? "favorite" : "favorite-border"} size={22} color={active ? palette.danger : palette.muted} />
      </Pressable>
    </Pressable>
  );
}

export function FavoriteRow({ item }: { item: FavoriteItem }) {
  const { toggleFavorite } = usePharmaGarde();
  const palette = usePremiumPalette();
  return (
    <Pressable style={({ pressed }) => [styles.resultRow, { backgroundColor: palette.card, borderColor: palette.border }, pressed ? styles.pressedCard : undefined]}>
      <View style={[styles.resultIcon, { backgroundColor: palette.softGreen }]}> 
        <MaterialIcons name={item.entityType === "medicine" ? "medication" : item.entityType === "clinic" ? "local-hospital" : "local-pharmacy"} size={20} color={palette.brand} />
      </View>
      <View style={styles.resultText}>
        <Text style={[styles.resultTitle, { color: palette.text }]}>{item.title}</Text>
        <Text style={[styles.resultSubtitle, { color: palette.muted }]}>{entityLabel(item.entityType)}{item.subtitle ? ` · ${item.subtitle}` : ""}</Text>
      </View>
      <Pressable accessibilityRole="button" hitSlop={10} style={({ pressed }) => [styles.favoriteButton, pressed ? styles.pressedScale : undefined]} onPress={() => { haptic.light(); toggleFavorite(item); }}>
        <MaterialIcons name="favorite" size={22} color={palette.danger} />
      </Pressable>
    </Pressable>
  );
}

export function MenuRow({ icon, title, description, onPress }: { icon: keyof typeof MaterialIcons.glyphMap; title: string; description: string; onPress?: () => void }) {
  const palette = usePremiumPalette();
  return (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.menuRow, { backgroundColor: palette.card, borderColor: palette.border }, pressed ? styles.pressedCard : undefined]} onPress={() => { haptic.light(); onPress?.(); }}>
      <View style={[styles.menuIcon, { backgroundColor: palette.softGreen }]}> 
        <MaterialIcons name={icon} size={21} color={palette.brand} />
      </View>
      <View style={styles.menuText}>
        <Text style={[styles.menuTitle, { color: palette.text }]}>{title}</Text>
        <Text style={[styles.menuDescription, { color: palette.muted }]}>{description}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={palette.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  emptyIcon: { width: 62, height: 62, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { fontSize: 19, lineHeight: 25, fontWeight: "900", textAlign: "center" },
  emptyMessage: { fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8, marginBottom: 18, fontWeight: "600" },
  primaryButton: { minHeight: 48, paddingHorizontal: 22, borderRadius: 17, alignItems: "center", justifyContent: "center", shadowColor: "#008000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15, lineHeight: 19 },
  notice: { marginHorizontal: 16, marginTop: 12, borderRadius: 18, padding: 12, borderWidth: 1, flexDirection: "row", alignItems: "flex-start", gap: 9 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  searchBox: { margin: 16, height: 52, borderRadius: 26, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10, shadowColor: "#092A13", shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  searchInput: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "700", paddingVertical: 0 },
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: 24, padding: 15, borderWidth: 1, shadowColor: "#092A13", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 4 },
  pressedCard: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  pressedScale: { opacity: 0.86, transform: [{ scale: 0.97 }] },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  markerBadge: { width: 46, height: 46, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  cardTitleArea: { flex: 1 },
  cardTitle: { fontSize: 16, lineHeight: 21, fontWeight: "900" },
  cardSubtitle: { fontSize: 12, lineHeight: 18, fontWeight: "700", marginTop: 2 },
  favoriteButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  placeHeaderMeta: { alignItems: "flex-end", gap: 6, flexShrink: 0 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 13 },
  metaPill: { minHeight: 30, borderRadius: 15, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  metaText: { fontSize: 12, lineHeight: 15, fontWeight: "900" },
  pricePill: { minHeight: 30, borderRadius: 15, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  medicineDetails: { marginTop: 2 },
  placeExpandableContent: { marginTop: 2 },
  hoursInfoRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  hoursInfoText: { flex: 1 },
  placeInfoRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 9 },
  compactInfoPill: { minHeight: 26, borderRadius: 13, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  typeInfoPill: { flexShrink: 1, maxWidth: 108 },
  phoneInfoPill: { flex: 1, minWidth: 82, justifyContent: "flex-start" },
  compactInfoText: { fontSize: 10, lineHeight: 12, fontWeight: "900" },
  priceText: { fontSize: 12, lineHeight: 15, fontWeight: "900" },
  cardActions: { flexDirection: "row", gap: 9, marginTop: 13 },
  secondaryButton: { flex: 1, minHeight: 43, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  secondaryButtonText: { fontSize: 13, lineHeight: 17, fontWeight: "900" },
  medicineImage: { width: 48, height: 48, borderRadius: 17 },
  medicineFallback: { width: 48, height: 48, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  description: { marginTop: 12, fontSize: 13, lineHeight: 20, fontWeight: "600" },
  disclaimer: { marginTop: 12, flexDirection: "row", gap: 8, alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 10 },
  disclaimerText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  disclaimerTextCompact: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  resultRow: { marginHorizontal: 16, marginTop: 10, borderRadius: 20, padding: 13, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#092A13", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  resultIcon: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  resultText: { flex: 1 },
  resultTitle: { fontSize: 14, lineHeight: 19, fontWeight: "900" },
  resultSubtitle: { fontSize: 12, lineHeight: 17, fontWeight: "700", marginTop: 2 },
  menuRow: { borderRadius: 20, padding: 13, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  menuIcon: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  menuText: { flex: 1 },
  menuTitle: { fontSize: 14, lineHeight: 18, fontWeight: "900" },
  menuDescription: { fontSize: 12, lineHeight: 17, fontWeight: "700", marginTop: 2 },
});
