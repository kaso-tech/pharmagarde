import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { premiumRadius, usePremiumPalette } from "@/lib/pharmagarde/premium-ui";

type SignOutConfirmationModalProps = {
  visible: boolean;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/** Dialogue unique pour toutes les entrées de déconnexion de l’application. */
export function SignOutConfirmationModal({ visible, pending = false, onClose, onConfirm }: SignOutConfirmationModalProps) {
  const palette = usePremiumPalette();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={pending ? undefined : onClose}>
      <View style={[styles.root, { backgroundColor: palette.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer la confirmation de déconnexion"
          disabled={pending}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={[styles.icon, { backgroundColor: "rgba(217,45,32,0.10)" }]}>
            <MaterialIcons name="logout" size={25} color={palette.danger} />
          </View>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>Se déconnecter</Text>
          <Text style={[styles.description, { color: palette.muted }]}>Vous serez redirigé vers la page de connexion.</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              style={({ pressed }) => [styles.cancelButton, { borderColor: palette.border }, pressed && !pending ? styles.pressed : undefined]}
              onPress={onClose}
            >
              <Text style={[styles.cancelText, { color: palette.text }]}>Annuler</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              style={({ pressed }) => [styles.confirmButton, { backgroundColor: palette.danger }, pressed && !pending ? styles.pressed : undefined]}
              onPress={onConfirm}
            >
              <Text style={styles.confirmText}>{pending ? "Déconnexion…" : "Se déconnecter"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 420, borderRadius: premiumRadius.lg, borderWidth: 1, alignItems: "center", padding: 22, gap: 12 },
  icon: { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "900", textAlign: "center" },
  description: { fontSize: 14, lineHeight: 21, fontWeight: "600", textAlign: "center" },
  actions: { width: "100%", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 },
  cancelButton: { minHeight: 44, borderRadius: 11, borderWidth: 1, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 14, fontWeight: "900" },
  confirmButton: { minHeight: 44, borderRadius: 11, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  confirmText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
});
