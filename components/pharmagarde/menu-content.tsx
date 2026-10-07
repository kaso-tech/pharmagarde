import { usePathname, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { DrawerActionRow, DrawerFooter, DrawerHero, DrawerSection, DrawerSelectRow, DrawerSelectionModal, DrawerSwitchRow } from "@/components/pharmagarde/drawer-ui";
import { SignOutConfirmationModal } from "@/components/pharmagarde/sign-out-confirmation";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { usePharmaGarde } from "@/lib/pharmagarde/app-state";
import { PHARMAGARDE_CITIES } from "@/lib/pharmagarde/city-utils";
import { availableMapPreferences, effectiveMapPreference } from "@/lib/pharmagarde/map-config";
import { AppLanguage, MapPreference } from "@/lib/pharmagarde/types";

const LANGUAGE_OPTIONS: readonly AppLanguage[] = ["FR", "EN"];
// Le mode satellite n'est proposé que si un fournisseur d'imagerie sous licence est configuré.
const MAP_OPTIONS: readonly MapPreference[] = availableMapPreferences();
const CITY_OPTIONS = PHARMAGARDE_CITIES;

type SelectorKey = "city" | "language" | "mapType";

const INFORMATION_ITEMS = [
  {
    id: "politique-confidentialite",
    icon: "privacy-tip" as const,
    title: "Politique de confidentialité",
  },
  {
    id: "conditions-utilisation",
    icon: "gavel" as const,
    title: "Conditions d’utilisation",
  },
  {
    id: "aide-assistance",
    icon: "support-agent" as const,
    title: "Aide et assistance",
  },
  {
    id: "contactez-nous",
    icon: "alternate-email" as const,
    title: "Contactez-nous",
  },
  {
    id: "a-propos",
    icon: "info" as const,
    title: "À propos de nous",
  },
];

type MenuContentProps = {
  onClose: () => void;
};

export function MenuContent({ onClose }: MenuContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { preferences, updatePreference } = usePharmaGarde();
  const { user, isAuthenticated, logout, logoutAllDevices } = useAuth();
  const colors = useColors();
  const [selector, setSelector] = useState<SelectorKey | null>(null);
  const [logoutConfirmationVisible, setLogoutConfirmationVisible] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);

  const navigate = (href: string) => {
    onClose();
    router.push(href as never);
  };

  const closeSelector = () => setSelector(null);

  const handleLogout = async () => {
    setLogoutPending(true);
    try {
      await logout();
      onClose();
      router.replace("/auth/login" as never);
    } finally {
      setLogoutPending(false);
      setLogoutConfirmationVisible(false);
    }
  };

  const handleLogoutAllDevices = async () => {
    await logoutAllDevices().catch(() => undefined);
    onClose();
    router.replace("/auth/login" as never);
  };

  return (
    <>
      <ScrollView style={[styles.page, { backgroundColor: colors.background }]} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <DrawerHero onClose={onClose} />

        <DrawerSection title="Références">
          <DrawerSwitchRow
            icon="dark-mode"
            title="Mode sombre"
            value={preferences.mode === "Sombre"}
            onValueChange={(enabled) => updatePreference("mode", enabled ? "Sombre" : "Clair")}
          />
          <DrawerSelectRow icon="translate" title="Langue" value={preferences.language} onPress={() => setSelector("language")} />
          <DrawerSelectRow icon="map" title="Type de carte" value={effectiveMapPreference(preferences.mapType)} onPress={() => setSelector("mapType")} />
          <DrawerSelectRow icon="location-city" title="Ville" value={preferences.city} onPress={() => setSelector("city")} />
        </DrawerSection>

        <DrawerSection title="Contribution">
          <DrawerActionRow
            icon="add-business"
            title="Nouvel établissement"
            active={pathname.includes("nouvel-etablissement")}
            onPress={() => navigate("/pharmagarde/contribution/nouvel-etablissement")}
          />
          <DrawerActionRow
            icon="report-problem"
            title="Signaler un problème"
            active={pathname.includes("signaler-probleme")}
            onPress={() => navigate("/pharmagarde/contribution/signaler-probleme")}
          />
        </DrawerSection>

        <DrawerSection title="Informations">
          {INFORMATION_ITEMS.map((item) => (
            <DrawerActionRow
              key={item.id}
              icon={item.icon}
              title={item.title}
              active={pathname.includes(`/pharmagarde/info/${item.id}`)}
              onPress={() => navigate(`/pharmagarde/info/${item.id}`)}
            />
          ))}
        </DrawerSection>

        <DrawerSection title="Compte">
          {isAuthenticated ? (
            <>
              <DrawerActionRow
                icon="verified-user"
                title={user?.phone ?? user?.email ?? "Compte connecté"}
                active={false}
                onPress={() => undefined}
              />
              <DrawerActionRow
                icon="logout"
                title="Se déconnecter"
                active={false}
                onPress={() => setLogoutConfirmationVisible(true)}
              />
              <DrawerActionRow
                icon="devices"
                title="Déconnecter tous mes appareils"
                active={false}
                onPress={handleLogoutAllDevices}
              />
              <DrawerActionRow
                icon="person-remove"
                title="Supprimer mon compte"
                active={pathname.includes("/pharmagarde/supprimer-compte")}
                onPress={() => navigate("/pharmagarde/supprimer-compte")}
              />
            </>
          ) : (
            <>
              <DrawerActionRow
                icon="login"
                title="Connexion"
                active={pathname.includes("/auth/login")}
                onPress={() => navigate("/auth/login")}
              />
              <DrawerActionRow
                icon="person-add"
                title="Inscription"
                active={pathname.includes("/auth/register")}
                onPress={() => navigate("/auth/register")}
              />
            </>
          )}
        </DrawerSection>

        <DrawerSection title="Services">
          <DrawerActionRow
            icon="workspace-premium"
            title="Abonnement"
            active={pathname.includes("/pharmagarde/abonnement")}
            onPress={() => navigate("/pharmagarde/abonnement")}
          />
        </DrawerSection>

        <DrawerFooter />
      </ScrollView>

      <DrawerSelectionModal
        visible={selector === "language"}
        title="Choisir la langue"
        options={LANGUAGE_OPTIONS}
        value={preferences.language}
        onClose={closeSelector}
        onSelect={(next) => {
          updatePreference("language", next);
          closeSelector();
        }}
      />
      <DrawerSelectionModal
        visible={selector === "mapType"}
        title="Choisir le type de carte"
        options={MAP_OPTIONS}
        value={effectiveMapPreference(preferences.mapType)}
        onClose={closeSelector}
        onSelect={(next) => {
          updatePreference("mapType", next);
          closeSelector();
        }}
      />
      <DrawerSelectionModal
        visible={selector === "city"}
        title="Choisir la ville"
        options={CITY_OPTIONS}
        value={preferences.city as (typeof CITY_OPTIONS)[number]}
        onClose={closeSelector}
        onSelect={(next) => {
          updatePreference("city", next);
          closeSelector();
        }}
      />
      <SignOutConfirmationModal
        visible={logoutConfirmationVisible}
        pending={logoutPending}
        onClose={() => setLogoutConfirmationVisible(false)}
        onConfirm={() => void handleLogout()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { paddingBottom: 28 },
});
