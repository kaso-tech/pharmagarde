import { Tabs } from "expo-router";

import { TabsShell } from "@/components/pharmagarde/app-shell";

export default function TabLayout() {
  return (
    // En-tête et pied de page communs aux onglets, montés une seule fois (voir TabsShell).
    <TabsShell>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: "none" },
          animation: "none",
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Accueil" }} />
        <Tabs.Screen name="cliniques" options={{ title: "Cliniques" }} />
        <Tabs.Screen name="medicaments" options={{ title: "Médicaments" }} />
        <Tabs.Screen name="carte" options={{ title: "Carte" }} />
      </Tabs>
    </TabsShell>
  );
}
