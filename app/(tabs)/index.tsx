import { useState } from "react";
import { FlatList, StyleSheet } from "react-native";

import { AnnouncementBanners, AppChrome, EmptyState, PlaceCard } from "@/components/pharmagarde/app-ui";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { HealthPlace } from "@/lib/pharmagarde/types";

export default function HomeScreen() {
  const { pharmacies, errors, isApiConfigured, loading, preferences, refreshData } = usePharmaGarde();
  const [expandedPlaceId, setExpandedPlaceId] = useState<string | undefined>();
  const selectedCity = preferences.city;
  const emptyTitle = loading ? "Chargement des pharmacies" : errors.pharmacies ? "Chargement impossible" : `Aucune pharmacie trouvée à ${selectedCity}`;
  const emptyMessage = loading
    ? `Recherche des pharmacies de ${selectedCity}…`
    : errors.pharmacies ?? (isApiConfigured
      ? `Le backend n’a retourné aucune pharmacie pour ${selectedCity}. Essayez d’actualiser ou choisissez une autre ville.`
      : "Le backend n’est pas disponible dans cet environnement de test.");

  return (
    <AppChrome subtitle="Accueil">
      <FlatList<HealthPlace>
        data={pharmacies}
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
        ListHeaderComponent={<AnnouncementBanners />}
        ListEmptyComponent={<EmptyState title={emptyTitle} message={emptyMessage} actionLabel={errors.pharmacies ? "Réessayer" : undefined} onAction={errors.pharmacies ? refreshData : undefined} />}
        contentContainerStyle={styles.listContent}
      />
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 28 },
});
