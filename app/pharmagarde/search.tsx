import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AppChrome, EmptyState, MedicineCard, PlaceCard, SearchField } from "@/components/pharmagarde/app-ui";
import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { medicineSearchText } from "@/lib/pharmagarde/medicines";
import { HealthPlace, Medicine } from "@/lib/pharmagarde/types";

type SearchListItem =
  | { key: string; kind: "place"; place: HealthPlace }
  | { key: string; kind: "medicine"; medicine: Medicine };

function normalizeSearchText(value?: string) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function placeSearchText(place: HealthPlace) {
  return normalizeSearchText([place.name, place.address, place.city, place.type === "pharmacy" ? "Pharmacie" : "Clinique"].filter(Boolean).join(" "));
}

export default function SearchScreen() {
  const router = useRouter();
  const palette = usePremiumPalette();
  const { searchQuery, setSearchQuery, pharmacies, clinics, medicines } = usePharmaGarde();
  const inputRef = useRef<TextInput | null>(null);
  const [expandedPlaceId, setExpandedPlaceId] = useState<string | undefined>();

  useEffect(() => {
    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, 120);

    return () => clearTimeout(focusTimer);
  }, []);

  const searchResults = useMemo<SearchListItem[]>(() => {
    const normalizedQuery = normalizeSearchText(searchQuery.trim());
    const places = [...pharmacies, ...clinics]
      .filter((place) => !normalizedQuery || placeSearchText(place).includes(normalizedQuery))
      .map((place) => ({ key: `${place.type}-${place.id}`, kind: "place" as const, place }));
    const medicineResults = medicines
      .filter((medicine) => !normalizedQuery || medicineSearchText(medicine).includes(normalizedQuery))
      .map((medicine) => ({ key: `medicine-${medicine.id}`, kind: "medicine" as const, medicine }));

    return [...places, ...medicineResults];
  }, [clinics, medicines, pharmacies, searchQuery]);

  const header = (
    <View>
      <View style={styles.topRow}>
        <View style={styles.titleArea}>
          <Text style={[styles.kicker, { color: palette.brand }]}>Recherche intelligente</Text>
          <Text style={[styles.title, { color: palette.text }]}>Trouver un service</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer la recherche"
          style={({ pressed }) => [styles.closeButton, { backgroundColor: palette.card, borderColor: palette.border }, pressed ? styles.pressedScale : undefined]}
          onPress={() => {
            haptic.light();
            router.back();
          }}
        >
          <MaterialIcons name="close" size={20} color={palette.brand} />
          <Text style={[styles.closeText, { color: palette.brand }]}>Fermer</Text>
        </Pressable>
      </View>
      <SearchField inputRef={inputRef} autoFocus value={searchQuery} onChangeText={setSearchQuery} placeholder="Nom, quartier, catégorie..." />
      <View style={[styles.countPill, { backgroundColor: palette.glass, borderColor: palette.border }]}> 
        <MaterialIcons name="manage-search" size={16} color={palette.brand} />
        <Text style={[styles.count, { color: palette.muted }]}>{searchResults.length} résultat(s) synchronisé(s)</Text>
      </View>
    </View>
  );

  return (
    <AppChrome subtitle="Recherche" hideHeaderSearch>
      <FlatList<SearchListItem>
        style={[styles.page, { backgroundColor: palette.background }]}
        data={searchResults}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => {
          if (item.kind === "medicine") return <MedicineCard medicine={item.medicine} />;
          return (
            <PlaceCard
              place={item.place}
              isExpanded={expandedPlaceId === item.key}
              onToggle={() => setExpandedPlaceId((current) => current === item.key ? undefined : item.key)}
            />
          );
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="Aucun résultat" message="Vérifiez le terme recherché ou choisissez une autre ville si l’établissement n’apparaît pas encore." />}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { paddingBottom: 28 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, gap: 14 },
  titleArea: { flex: 1 },
  kicker: { fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  title: { fontSize: 25, lineHeight: 31, fontWeight: "900", marginTop: 2 },
  closeButton: { minHeight: 42, paddingHorizontal: 13, borderRadius: 21, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, shadowColor: "#092A13", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  closeText: { fontWeight: "900", fontSize: 13, lineHeight: 17 },
  countPill: { alignSelf: "flex-start", marginHorizontal: 16, marginTop: 2, marginBottom: 6, minHeight: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  count: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  pressedScale: { opacity: 0.86, transform: [{ scale: 0.97 }] },
});
