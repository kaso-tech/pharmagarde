import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppChrome } from "@/components/pharmagarde/app-ui";

const BRAND_GREEN = "#008000";

type InfoPage = {
  title: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  intro: string;
  points: string[];
};

const INFO_PAGES: Record<string, InfoPage> = {
  "politique-confidentialite": {
    title: "Politique de confidentialité",
    icon: "privacy-tip",
    intro: "PharmaGarde BF privilégie une approche sobre : les préférences du drawer, la ville et les paramètres de carte sont conservés localement sur l’appareil dans cette version.",
    points: [
      "Les préférences servent uniquement à personnaliser l’expérience mobile.",
      "Aucune donnée de paiement ou donnée médicale sensible n’est collectée dans les écrans actuels.",
      "Les futures contributions pourront être synchronisées après ajout d’un backend de validation.",
    ],
  },
  "conditions-utilisation": {
    title: "Conditions d’utilisation",
    icon: "gavel",
    intro: "Les informations affichées sont destinées à orienter les utilisateurs et doivent être vérifiées auprès des établissements avant toute décision importante.",
    points: [
      "Les prix de médicaments sont approximatifs et peuvent varier selon les officines.",
      "Les horaires et positions doivent être confirmés auprès des pharmacies ou cliniques concernées.",
      "Les contributions utilisateur doivent rester exactes, respectueuses et vérifiables.",
    ],
  },
  "aide-assistance": {
    title: "Aide et assistance",
    icon: "support-agent",
    intro: "Cette page rassemble les repères pratiques pour utiliser rapidement les principales fonctions de PharmaGarde BF.",
    points: [
      "Utilisez la carte pour repérer les pharmacies et centres de soins proches.",
      "Changez la ville depuis le menu latéral pour adapter les suggestions locales.",
      "Signalez une donnée incorrecte depuis la section Contribution afin de préparer sa correction.",
    ],
  },
  "contactez-nous": {
    title: "Contactez-nous",
    icon: "alternate-email",
    intro: "L’écran de contact prépare les canaux de communication officiels de l’équipe PharmaGarde BF.",
    points: [
      "Email support prévu : contact@pharmagarde.bf.",
      "Les demandes urgentes doivent toujours passer par les services de santé compétents.",
      "Les retours sur l’application peuvent être transmis via Signaler un problème.",
    ],
  },
  "a-propos": {
    title: "À propos de nous",
    icon: "info",
    intro: "PharmaGarde BF vise à faciliter l’accès à l’information de proximité sur les pharmacies, cliniques et médicaments essentiels au Burkina Faso.",
    points: [
      "L’expérience mobile est pensée pour une utilisation simple, rapide et à une main.",
      "La couleur #008000 représente la santé, la disponibilité et la confiance.",
      "Le modèle est prêt pour une évolution vers des données communautaires validées.",
    ],
  },
};

export default function InfoScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const page = INFO_PAGES[params.id ?? ""] ?? INFO_PAGES["aide-assistance"];

  return (
    <AppChrome subtitle="Informations">
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <View style={styles.heroIcon}>
          <MaterialIcons name={page.icon} size={30} color="#FFFFFF" />
        </View>
        <Text style={styles.title}>{page.title}</Text>
        <Text style={styles.intro}>{page.intro}</Text>

        <View style={styles.card}>
          {page.points.map((point, index) => (
            <View key={point} style={styles.pointRow}>
              <View style={styles.pointBullet}>
                <Text style={styles.pointNumber}>{index + 1}</Text>
              </View>
              <Text style={styles.pointText}>{point}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F6FBF8" },
  content: { padding: 16, paddingBottom: 28 },
  heroIcon: { width: 62, height: 62, borderRadius: 31, backgroundColor: BRAND_GREEN, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  title: { color: "#102016", fontSize: 25, lineHeight: 32, fontWeight: "900" },
  intro: { color: "#475467", fontSize: 15, lineHeight: 23, marginTop: 8 },
  card: { marginTop: 18, borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D6EBDD", padding: 16, gap: 14, shadowColor: "#092A13", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  pointRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  pointBullet: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#EAF8EF", alignItems: "center", justifyContent: "center" },
  pointNumber: { color: BRAND_GREEN, fontSize: 13, fontWeight: "900" },
  pointText: { flex: 1, color: "#102016", fontSize: 14, lineHeight: 21, fontWeight: "700" },
});
