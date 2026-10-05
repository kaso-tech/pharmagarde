import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AppChrome, EmptyState, MedicalDisclaimer, MedicineCard } from "@/components/pharmagarde/app-ui";
import { useAuth } from "@/hooks/use-auth";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { Medicine } from "@/lib/pharmagarde/types";

const BRAND_GREEN = "#008000";

export default function MedicinesScreen() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { isPremium, medicines, premiumLoading } = usePharmaGarde();

  if (!isPremium) {
    return (
      <AppChrome subtitle="Médicaments">
        <View style={styles.paywallPage}>
          <View style={styles.paywallCard}>
            <View style={styles.lockBadge}>
              <MaterialIcons name="lock" size={30} color="#FFFFFF" />
            </View>
            <Text style={styles.paywallKicker}>{isAuthenticated ? "Réservé Premium" : "Connexion requise"}</Text>
            <Text style={styles.paywallTitle}>{isAuthenticated ? "Accès réservé aux abonnés" : "Connectez-vous pour continuer"}</Text>
            <Text style={styles.paywallDescription}>Le catalogue des médicaments essentiels est protégé afin de garantir un accès contrôlé côté serveur. {isAuthenticated ? "Passez à PharmaGarde Plus pour consulter les médicaments, formes, catégories et prix indicatifs." : "Un compte est nécessaire avant de souscrire ou de consulter cette fonctionnalité premium."}</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push(isAuthenticated ? "/pharmagarde/abonnement" : "/auth/login")} style={({ pressed }) => [styles.subscribeButton, pressed && styles.pressed]}>
              <MaterialIcons name={isAuthenticated ? "workspace-premium" : "login"} size={20} color="#FFFFFF" />
              <Text style={styles.subscribeButtonText}>{authLoading || premiumLoading ? "Vérification…" : isAuthenticated ? "S’abonner" : "Se connecter"}</Text>
            </Pressable>
            <Text style={styles.securityNote}>Les données médicaments restent aussi protégées par le backend pour éviter tout contournement côté application.</Text>
          </View>
        </View>
      </AppChrome>
    );
  }

  const header = (
    <View>
      <View style={styles.headerCard}>
        <Text style={styles.kicker}>Référentiel Burkina Faso</Text>
        <Text style={styles.title}>Médicaments essentiels</Text>
        <Text style={styles.description}>Catalogue indicatif de médicaments courants avec catégorie, forme pharmaceutique et prix approximatif en FCFA. Les prix peuvent varier selon la ville et la disponibilité.</Text>
        <MedicalDisclaimer />
      </View>
    </View>
  );

  return (
    <AppChrome subtitle="Médicaments">
      <FlatList<Medicine>
        data={medicines}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MedicineCard medicine={item} />}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="Aucun médicament disponible" message="La liste locale n’a pas pu être chargée. Veuillez réouvrir l’application ou réessayer plus tard." />}
        contentContainerStyle={styles.listContent}
      />
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 28 },
  headerCard: { margin: 16, padding: 18, borderRadius: 12, backgroundColor: "#F1F8F3", borderWidth: 1, borderColor: "#D6EBDD", shadowColor: "#092A13", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  kicker: { color: "#03A63F", fontSize: 12, lineHeight: 17, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6 },
  title: { color: "#102016", fontSize: 22, lineHeight: 28, fontWeight: "900", marginTop: 6 },
  description: { color: "#667085", fontSize: 14, lineHeight: 21, marginTop: 8 },
  paywallPage: { flex: 1, backgroundColor: "#F6FBF8", padding: 16, justifyContent: "center" },
  paywallCard: { borderRadius: 18, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D6EBDD", padding: 20, alignItems: "center", shadowColor: "#092A13", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  lockBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#102016", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  paywallKicker: { color: BRAND_GREEN, fontSize: 12, lineHeight: 17, fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase" },
  paywallTitle: { color: "#102016", fontSize: 24, lineHeight: 30, fontWeight: "900", textAlign: "center", marginTop: 6 },
  paywallDescription: { color: "#667085", fontSize: 15, lineHeight: 23, textAlign: "center", marginTop: 10 },
  subscribeButton: { minHeight: 52, borderRadius: 12, backgroundColor: BRAND_GREEN, alignSelf: "stretch", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginTop: 18 },
  subscribeButtonText: { color: "#FFFFFF", fontSize: 16, lineHeight: 22, fontWeight: "900" },
  securityNote: { color: "#667085", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 12 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
});
