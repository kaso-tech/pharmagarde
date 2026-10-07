import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppChrome, EmptyState, MedicalDisclaimer, MedicineCard, SearchField } from "@/components/pharmagarde/app-ui";
import { useAuth } from "@/hooks/use-auth";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { facetOptions, filterMedicines, type FacetOption } from "@/lib/pharmagarde/medicines";
import { usePremiumPalette } from "@/lib/pharmagarde/premium-ui";
import { Medicine, MedicineProductType } from "@/lib/pharmagarde/types";

const BRAND_GREEN = "#008000";

export default function MedicinesScreen() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { isPremium, medicines, premiumLoading } = usePharmaGarde();
  const [query, setQuery] = useState("");
  const [productType, setProductType] = useState<MedicineProductType | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState<string | null>(null);

  // Type → catégorie → sous-catégorie : chaque niveau ne propose que les valeurs du niveau choisi au-dessus.
  const typeOptions = useMemo(() => facetOptions(medicines, "productType"), [medicines]);
  const ofType = useMemo(() => (productType ? medicines.filter((medicine) => medicine.productType === productType) : []), [medicines, productType]);
  const categoryOptions = useMemo(() => facetOptions(ofType, "category"), [ofType]);
  const subcategoryOptions = useMemo(() => (category ? facetOptions(ofType.filter((medicine) => medicine.category === category), "subcategory") : []), [category, ofType]);
  const visible = useMemo(() => filterMedicines(medicines, { query, productType, category, subcategory }), [category, medicines, productType, query, subcategory]);

  const selectType = (value: string | null) => {
    setProductType(value as MedicineProductType | null);
    setCategory(null);
    setSubcategory(null);
  };
  const selectCategory = (value: string | null) => {
    setCategory(value);
    setSubcategory(null);
  };

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
        <Text style={styles.title}>Médicaments et produits essentiels</Text>
        <Text style={styles.description}>Liste nationale des médicaments et autres produits essentiels de santé (édition 2023) : type, catégorie, forme, dosage et prix approximatif en FCFA. Les prix peuvent varier selon la ville et la disponibilité.</Text>
        <MedicalDisclaimer />
      </View>
      <View style={styles.filters}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Nom, forme, dosage, catégorie…" />
        <FilterChips label="Type" options={typeOptions} value={productType} onChange={selectType} />
        {productType && categoryOptions.length > 0 ? <FilterChips label="Catégorie" options={categoryOptions} value={category} onChange={selectCategory} /> : null}
        {category && subcategoryOptions.length > 0 ? <FilterChips label="Sous-catégorie" options={subcategoryOptions} value={subcategory} onChange={setSubcategory} /> : null}
        <Text style={styles.resultCount}>{visible.length.toLocaleString("fr-FR")} produit{visible.length > 1 ? "s" : ""} sur {medicines.length.toLocaleString("fr-FR")}</Text>
      </View>
    </View>
  );

  return (
    <AppChrome subtitle="Médicaments">
      <FlatList<Medicine>
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MedicineCard medicine={item} />}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        ListEmptyComponent={
          medicines.length > 0
            ? <EmptyState title="Aucun produit trouvé" message="Aucun produit ne correspond à cette recherche. Modifiez les filtres ou le texte recherché." />
            : <EmptyState title="Aucun médicament disponible" message="Le catalogue n’a pas pu être chargé. Veuillez réouvrir l’application ou réessayer plus tard." />
        }
        contentContainerStyle={styles.listContent}
      />
    </AppChrome>
  );
}

function FilterChips({ label, options, value, onChange }: { label: string; options: FacetOption[]; value: string | null; onChange: (value: string | null) => void }) {
  const palette = usePremiumPalette();
  const chip = (key: string, text: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.softGreen : palette.card }, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} style={[styles.chipText, { color: active ? palette.brand : palette.text }]}>{text}</Text>
    </Pressable>
  );
  return (
    <View>
      <Text style={[styles.filterLabel, { color: palette.muted }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        {chip("all", "Tous", value === null, () => onChange(null))}
        {options.map((option) => chip(option.value, `${option.value} (${option.count})`, value === option.value, () => onChange(value === option.value ? null : option.value)))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 28 },
  filters: { marginHorizontal: 16, marginBottom: 8, gap: 10 },
  filterLabel: { fontSize: 11, lineHeight: 15, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  chipRow: { gap: 8, paddingRight: 16 },
  chip: { minHeight: 34, maxWidth: 320, borderRadius: 17, borderWidth: 1, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 13, lineHeight: 17, fontWeight: "800" },
  resultCount: { color: "#667085", fontSize: 12, lineHeight: 17, fontWeight: "700" },
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
