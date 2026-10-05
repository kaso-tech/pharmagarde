import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";
import { Animated, Easing, FlatList, Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

const BRAND_GREEN = "#008000";
const DARK_GREEN = "#006400";

type DrawerPalette = {
  brandGreen: string;
  darkGreen: string;
  background: string;
  foreground: string;
  muted: string;
  border: string;
  surface: string;
  softSurface: string;
  selectedSurface: string;
  overlay: string;
  elevatedShadow: string;
};

export type DrawerIconName = keyof typeof MaterialIcons.glyphMap;

function useDrawerPalette(): DrawerPalette {
  const colors = useColors();
  return useMemo(
    () => ({
      brandGreen: BRAND_GREEN,
      darkGreen: DARK_GREEN,
      background: colors.background,
      foreground: colors.foreground,
      muted: colors.muted,
      border: colors.border,
      surface: colors.surface,
      softSurface: colors.background,
      selectedSurface: colors.background === "#151718" ? "#12351F" : "#F0FFF5",
      overlay: colors.background === "#151718" ? "rgba(0, 0, 0, 0.66)" : "rgba(16, 32, 22, 0.42)",
      elevatedShadow: colors.background === "#151718" ? "#000000" : "#102016",
    }),
    [colors.background, colors.border, colors.foreground, colors.muted, colors.surface],
  );
}

export function DrawerHero({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroIcon}>
        <MaterialIcons name="local-pharmacy" size={25} color="#FFFFFF" />
      </View>
      <View style={styles.heroText}>
        <Text style={styles.kicker}>Menu</Text>
        <Text style={styles.heroTitle}>PharmaGarde BF</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fermer le menu"
        android_ripple={{ color: "rgba(0,128,0,0.16)", borderless: false }}
        style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        onPress={onClose}
      >
        <MaterialIcons name="close" size={22} color={BRAND_GREEN} />
      </Pressable>
    </View>
  );
}

export function DrawerSection({ title, children }: PropsWithChildren<{ title: string }>) {
  const palette = useDrawerPalette();
  return (
    <View style={styles.sectionWrap}>
      <Text style={[styles.sectionTitle, { color: palette.foreground }]}>{title}</Text>
      <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.elevatedShadow }]}>{children}</View>
    </View>
  );
}

export function DrawerActionRow({
  icon,
  title,
  value,
  active,
  onPress,
}: {
  icon: DrawerIconName;
  title: string;
  value?: string;
  active?: boolean;
  onPress: () => void;
}) {
  const palette = useDrawerPalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      android_ripple={{ color: "rgba(0,128,0,0.12)", borderless: false }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: active ? palette.selectedSurface : palette.surface, borderBottomColor: palette.border },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <View style={[styles.rowIcon, { backgroundColor: active ? BRAND_GREEN : palette.selectedSurface }]}>
        <MaterialIcons name={icon} size={21} color={active ? "#FFFFFF" : BRAND_GREEN} />
      </View>
      <Text style={[styles.rowTitle, { color: active ? DARK_GREEN : palette.foreground }]} numberOfLines={1}>{title}</Text>
      {value ? <Text style={[styles.rowValue, { color: DARK_GREEN }]} numberOfLines={1}>{value}</Text> : null}
      <MaterialIcons name="chevron-right" size={22} color={active ? BRAND_GREEN : palette.muted} />
    </Pressable>
  );
}

export function DrawerSelectRow({
  icon,
  title,
  value,
  onPress,
}: {
  icon: DrawerIconName;
  title: string;
  value: string;
  onPress: () => void;
}) {
  const palette = useDrawerPalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} : ${value}`}
      android_ripple={{ color: "rgba(0,128,0,0.12)", borderless: false }}
      style={({ pressed }) => [styles.row, { backgroundColor: palette.surface, borderBottomColor: palette.border }, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={[styles.rowIcon, { backgroundColor: palette.selectedSurface }]}>
        <MaterialIcons name={icon} size={21} color={BRAND_GREEN} />
      </View>
      <Text style={[styles.rowTitle, { color: palette.foreground }]} numberOfLines={1}>{title}</Text>
      <Text style={[styles.rowValue, { color: DARK_GREEN }]} numberOfLines={1}>{value}</Text>
      <MaterialIcons name="expand-more" size={22} color={palette.muted} />
    </Pressable>
  );
}

export function DrawerSwitchRow({
  icon,
  title,
  value,
  onValueChange,
}: {
  icon: DrawerIconName;
  title: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const palette = useDrawerPalette();
  return (
    <View style={[styles.row, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
      <View style={[styles.rowIcon, { backgroundColor: palette.selectedSurface }]}>
        <MaterialIcons name={icon} size={21} color={BRAND_GREEN} />
      </View>
      <Text style={[styles.rowTitle, { color: palette.foreground }]} numberOfLines={1}>{title}</Text>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel={title}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: palette.border, true: "rgba(0,128,0,0.36)" }}
        thumbColor={value ? BRAND_GREEN : palette.surface}
        ios_backgroundColor={palette.border}
      />
    </View>
  );
}

export function DrawerSelectionModal<T extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: readonly T[];
  value: T;
  onSelect: (next: T) => void;
  onClose: () => void;
}) {
  const palette = useDrawerPalette();
  const [mounted, setMounted] = useState(visible);
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));
  // Monte la modale dès qu'elle devient visible (ajustement d'état pendant le rendu, sans effet).
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      Animated.timing(progress, {
        toValue: 1,
        duration: 190,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: 150,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [progress, visible]);

  if (!mounted) return null;

  const modalScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.modalRoot, { backgroundColor: palette.overlay, opacity: progress }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer la sélection" style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            styles.dialog,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
              shadowColor: palette.elevatedShadow,
              transform: [{ scale: modalScale }],
            },
          ]}
        >
          <View style={[styles.dialogHeader, { borderBottomColor: palette.border }]}>
            <Text style={[styles.dialogTitle, { color: palette.foreground }]}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Fermer" style={({ pressed }) => [styles.dialogClose, { backgroundColor: palette.softSurface }, pressed && styles.pressed]} onPress={onClose}>
              <MaterialIcons name="close" size={20} color={palette.muted} />
            </Pressable>
          </View>
          <FlatList
            data={[...options]}
            keyExtractor={(item) => item}
            scrollEnabled={options.length > 6}
            contentContainerStyle={styles.dialogList}
            renderItem={({ item }) => {
              const selected = item === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  android_ripple={{ color: "rgba(0,128,0,0.12)", borderless: false }}
                  style={({ pressed }) => [
                    styles.optionRow,
                    { backgroundColor: palette.surface, borderColor: palette.border },
                    selected && { backgroundColor: palette.selectedSurface, borderColor: BRAND_GREEN },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => onSelect(item)}
                >
                  <Text style={[styles.optionText, { color: selected ? DARK_GREEN : palette.foreground }]}>{item}</Text>
                  {selected ? <MaterialIcons name="check-circle" size={22} color={BRAND_GREEN} /> : null}
                </Pressable>
              );
            }}
          />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export function DrawerFooter() {
  const palette = useDrawerPalette();
  return (
    <View style={[styles.footer, { backgroundColor: palette.selectedSurface, borderColor: palette.border }]}>
      <Text style={[styles.footerText, { color: palette.muted }]}>Version communautaire · Burkina Faso</Text>
      <View style={[styles.footerBadge, { backgroundColor: palette.surface }]}>
        <MaterialIcons name="verified" size={15} color={DARK_GREEN} />
        <Text style={styles.footerBadgeText}>#008000</Text>
      </View>
    </View>
  );
}

export const drawerColors = {
  brandGreen: BRAND_GREEN,
  darkGreen: DARK_GREEN,
  background: "#F6FBF8",
  foreground: "#102016",
  muted: "#667085",
  border: "#D6EBDD",
  surface: "#FFFFFF",
};

const styles = StyleSheet.create({
  hero: { width: "100%", minHeight: 92, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 16, backgroundColor: BRAND_GREEN, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#062F16", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  heroIcon: { width: 50, height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.2)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  heroText: { flex: 1, paddingRight: 48 },
  kicker: { color: "#E8FFF0", fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontSize: 23, lineHeight: 29, fontWeight: "900", marginTop: 2 },
  closeButton: { position: "absolute", top: 18, right: 16, width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  sectionWrap: { marginHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 14, lineHeight: 20, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8 },
  sectionCard: { borderRadius: 12, borderWidth: 1, overflow: "hidden", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  row: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  rowIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "900" },
  rowValue: { maxWidth: 120, fontSize: 12, lineHeight: 17, fontWeight: "900", textAlign: "right" },
  modalRoot: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 22, paddingVertical: 28 },
  dialog: { width: "100%", maxWidth: 420, maxHeight: "78%", borderRadius: 14, borderWidth: 1, overflow: "hidden", shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 18 },
  dialogHeader: { minHeight: 58, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  dialogTitle: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: "900", paddingRight: 12 },
  dialogClose: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dialogList: { padding: 12, gap: 8 },
  optionRow: { minHeight: 52, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  optionText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "800" },
  footer: { margin: 16, marginTop: 16, padding: 14, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  footerText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  footerBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  footerBadgeText: { color: DARK_GREEN, fontSize: 12, fontWeight: "900" },
});
