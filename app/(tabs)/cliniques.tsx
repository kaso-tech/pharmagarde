import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppChrome, EmptyState, PlaceCard, StatusNotice } from "@/components/pharmagarde/app-ui";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { HEALTHCARE_FAMILIES, healthcareFamilyOf, type HealthcareFamily } from "@/lib/pharmagarde/healthcare-types";
import { haptic, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import { HealthPlace } from "@/lib/pharmagarde/types";

export default function ClinicsScreen() {
  const { clinics, errors, isApiConfigured, loading, preferences, refreshData } = usePharmaGarde();
  const palette = usePremiumPalette();
  const [expandedPlaceId, setExpandedPlaceId] = useState<string | undefined>();
  const [family, setFamily] = useState<HealthcareFamily | "all">("all");
  const selectedCity = preferences.city;
  // Seules les familles présentes dans la ville sont proposées en filtre.
  const families = useMemo(() => HEALTHCARE_FAMILIES.filter((item) => clinics.some((place) => healthcareFamilyOf(place.establishmentType) === item.key)), [clinics]);
  const activeFamily = families.some((item) => item.key === family) ? family : "all";
  const visibleClinics = activeFamily === "all" ? clinics : clinics.filter((place) => healthcareFamilyOf(place.establishmentType) === activeFamily);
  const emptyTitle = loading ? "Chargement des cliniques" : errors.clinics ? "Chargement impossible" : `Aucune clinique trouvée à ${selectedCity}`;
  const emptyMessage = loading
    ? `Recherche des structures de santé de ${selectedCity}…`
    : errors.clinics ?? (isApiConfigured
      ? `Le backend n’a retourné aucune structure de santé pour ${selectedCity}. Essayez d’actualiser ou choisissez une autre ville.`
      : "Le backend n’est pas disponible dans cet environnement de test.");

  const header = (
    <View style={styles.headerNotice}>
      <StatusNotice message={errors.clinics} tone="error" />
      {families.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {[{ key: "all" as const, label: "Tout" }, ...families].map((item) => {
            const active = activeFamily === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.filterChip, { backgroundColor: active ? palette.clinic : palette.card, borderColor: active ? palette.clinic : palette.border }]}
                onPress={() => {
                  haptic.selection();
                  setFamily(item.key);
                }}
              >
                <Text style={[styles.filterText, { color: active ? "#FFFFFF" : palette.text }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  return (
    <AppChrome subtitle="Cliniques">
      <FlatList<HealthPlace>
        data={visibleClinics}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const itemKey = `${item.type}-${item.id}`;
          return (
            <PlaceCard
              place={item}
              isExpanded={expandedPlaceId === itemKey}
              onToggle={() => setExpandedPlaceId((current) => current === itemKey ? undefined : itemKey)}
            />
          );
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title={emptyTitle} message={emptyMessage} actionLabel={errors.clinics ? "Réessayer" : undefined} onAction={errors.clinics ? refreshData : undefined} />}
        contentContainerStyle={styles.listContent}
      />
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 28 },
  headerNotice: { marginTop: 8 },
  filterRow: { paddingHorizontal: 16, paddingBottom: 6, gap: 8 },
  filterChip: { minHeight: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, justifyContent: "center" },
  filterText: { fontSize: 13, lineHeight: 17, fontWeight: "800" },
});
