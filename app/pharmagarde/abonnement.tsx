import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as WebBrowser from "expo-web-browser";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppChrome } from "@/components/pharmagarde/app-ui";
import { useAuth } from "@/hooks/use-auth";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { type PremiumPlanId } from "@/lib/pharmagarde/premium";

const BRAND_GREEN = "#008000";
const DARK_GREEN = "#102016";

const BENEFITS = [
  "Résultats complets pour pharmacies et centres de santé",
  "Accès au catalogue médicaments essentiels",
  "Navigation sans publicité dans l’expérience premium",
  "Contrôle d’accès validé côté serveur pour votre compte",
];

function formatAmount(amount: number) {
  return `${amount.toLocaleString("fr-FR")} FCFA`;
}

function formatSubscriptionEnd(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { initSubscription, isPremium, premiumLoading, premiumPlans, refreshPremiumStatus, subscriptionEnd } = usePharmaGarde();
  const [selectedPlan, setSelectedPlan] = useState<PremiumPlanId | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const formattedEnd = formatSubscriptionEnd(subscriptionEnd);

  // Statut relu à chaque ouverture de l'écran (paiement confirmé ou Premium offert entre-temps).
  useFocusEffect(useCallback(() => {
    void refreshPremiumStatus();
  }, [refreshPremiumStatus]));

  const handleSubscribe = async (planId: PremiumPlanId) => {
    if (!isAuthenticated) {
      setErrorMessage("Connectez-vous avant de souscrire à PharmaGarde Plus.");
      router.push("/auth/login");
      return;
    }

    setSelectedPlan(planId);
    setErrorMessage(null);
    try {
      const payment = await initSubscription(planId);
      await WebBrowser.openBrowserAsync(payment.paymentUrl);
      await refreshPremiumStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible d’initialiser le paiement Ligdi Cash.";
      setErrorMessage(message);
    } finally {
      setSelectedPlan(null);
    }
  };

  return (
    <AppChrome subtitle="Services">
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.badge}>
            <MaterialIcons name="workspace-premium" size={30} color="#FFFFFF" />
          </View>
          <Text style={styles.title}>PharmaGarde Plus</Text>
          <Text style={styles.description}>Débloquez les résultats complets, le référentiel médicaments et une expérience sans publicité. Le statut premium est vérifié par le backend à chaque accès sensible.</Text>
          <View style={[styles.statusPill, isPremium ? styles.statusActive : styles.statusInactive]}>
            <MaterialIcons name={isPremium ? "verified" : "lock-open"} size={17} color={isPremium ? "#FFFFFF" : DARK_GREEN} />
            <Text style={[styles.statusText, isPremium ? styles.statusTextActive : styles.statusTextInactive]}>{premiumLoading ? "Vérification du statut…" : isPremium ? `Actif${formattedEnd ? ` jusqu’au ${formattedEnd}` : ""}` : "Compte gratuit"}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Inclus avec l’abonnement</Text>
          {BENEFITS.map((benefit) => (
            <View key={benefit} style={styles.benefitRow}>
              <MaterialIcons name="check-circle" size={21} color={BRAND_GREEN} />
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        <View style={styles.plansSection}>
          <Text style={styles.sectionTitle}>Choisissez une durée</Text>
          <Text style={styles.sectionDescription}>Les paiements sont initialisés via Ligdi Cash. L’abonnement est activé automatiquement après confirmation du webhook de paiement.</Text>
          {premiumPlans.map((plan) => {
            const loading = selectedPlan === plan.id;
            return (
              <View key={plan.id} style={styles.planCard}>
                <View style={styles.planHeader}>
                  <View>
                    <Text style={styles.planLabel}>{plan.label}</Text>
                    <Text style={styles.planDuration}>{plan.durationDays} jours d’accès premium</Text>
                  </View>
                  <Text style={styles.planPrice}>{formatAmount(plan.amount)}</Text>
                </View>
                <Pressable accessibilityRole="button" disabled={authLoading || loading || selectedPlan !== null} onPress={() => handleSubscribe(plan.id)} style={({ pressed }) => [styles.button, (pressed || loading) && styles.pressed, selectedPlan !== null && !loading && styles.disabledButton]}>
                  <MaterialIcons name={isAuthenticated ? "payments" : "login"} size={19} color="#FFFFFF" />
                  <Text style={styles.buttonText}>{authLoading ? "Vérification du compte…" : loading ? "Ouverture Ligdi Cash…" : isAuthenticated ? "Souscrire" : "Se connecter pour souscrire"}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        {errorMessage ? (
          <View style={styles.errorCard}>
            <MaterialIcons name="error-outline" size={20} color="#B42318" />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <Text style={styles.note}>Après paiement, revenez dans l’application puis relancez la vérification du statut si nécessaire. Les restrictions restent appliquées côté serveur tant que le paiement n’est pas confirmé.</Text>
      </ScrollView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F6FBF8" },
  content: { padding: 16, paddingBottom: 30 },
  heroCard: { borderRadius: 18, padding: 18, backgroundColor: DARK_GREEN, overflow: "hidden", shadowColor: "#092A13", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  badge: { width: 60, height: 60, borderRadius: 30, backgroundColor: BRAND_GREEN, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  title: { color: "#FFFFFF", fontSize: 27, lineHeight: 34, fontWeight: "900" },
  description: { color: "rgba(255,255,255,0.78)", fontSize: 15, lineHeight: 23, marginTop: 8 },
  statusPill: { marginTop: 14, alignSelf: "flex-start", minHeight: 34, borderRadius: 17, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  statusActive: { backgroundColor: BRAND_GREEN },
  statusInactive: { backgroundColor: "#E9F7EE" },
  statusText: { fontSize: 13, lineHeight: 18, fontWeight: "900" },
  statusTextActive: { color: "#FFFFFF" },
  statusTextInactive: { color: DARK_GREEN },
  card: { marginTop: 16, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D6EBDD", padding: 16, gap: 12, shadowColor: "#092A13", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  sectionTitle: { color: DARK_GREEN, fontSize: 18, lineHeight: 24, fontWeight: "900" },
  sectionDescription: { color: "#667085", fontSize: 14, lineHeight: 21, marginTop: 5, marginBottom: 10 },
  benefitRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  benefitText: { flex: 1, color: DARK_GREEN, fontSize: 14, lineHeight: 21, fontWeight: "700" },
  plansSection: { marginTop: 18 },
  planCard: { borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D6EBDD", padding: 15, marginTop: 12, shadowColor: "#092A13", shadowOpacity: 0.04, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  planHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 },
  planLabel: { color: DARK_GREEN, fontSize: 17, lineHeight: 23, fontWeight: "900" },
  planDuration: { color: "#667085", fontSize: 13, lineHeight: 19, marginTop: 2 },
  planPrice: { color: BRAND_GREEN, fontSize: 18, lineHeight: 24, fontWeight: "900" },
  button: { minHeight: 48, borderRadius: 12, backgroundColor: BRAND_GREEN, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  disabledButton: { opacity: 0.55 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  buttonText: { color: "#FFFFFF", fontSize: 15, lineHeight: 21, fontWeight: "900" },
  errorCard: { marginTop: 14, borderRadius: 12, padding: 12, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FDA29B", flexDirection: "row", gap: 8, alignItems: "flex-start" },
  errorText: { flex: 1, color: "#B42318", fontSize: 13, lineHeight: 19, fontWeight: "700" },
  note: { color: "#667085", fontSize: 12, lineHeight: 18, marginTop: 14, textAlign: "center" },
});
