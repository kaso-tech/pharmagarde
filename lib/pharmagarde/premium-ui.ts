import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/use-colors";
import { useThemeContext } from "@/lib/theme-provider";

export const BRAND_GREEN = "#008000";
export const CLINIC_BLUE = "#0B74DE";

export const premiumSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

export const premiumRadius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
};

export function usePremiumPalette() {
  const colors = useColors();
  const { colorScheme } = useThemeContext();
  const dark = colorScheme === "dark";

  return {
    dark,
    brand: BRAND_GREEN,
    clinic: CLINIC_BLUE,
    background: colors.background,
    surface: colors.surface,
    elevated: dark ? "#202922" : "#FFFFFF",
    card: dark ? "#1A211D" : "#FFFFFF",
    cardMuted: dark ? "#233028" : "#F5FBF7",
    text: colors.text,
    muted: colors.muted,
    border: colors.border,
    danger: colors.error,
    success: colors.success,
    warning: colors.warning,
    overlay: dark ? "rgba(4, 8, 6, 0.62)" : "rgba(8, 24, 13, 0.32)",
    glass: dark ? "rgba(26, 33, 29, 0.86)" : "rgba(255, 255, 255, 0.9)",
    softGreen: dark ? "rgba(35, 216, 103, 0.14)" : "rgba(0, 128, 0, 0.11)",
    mapLand: dark ? "#162019" : "#E7F4EC",
    mapRoad: dark ? "#2A352F" : "#FFFFFF",
  };
}

export const haptic = {
  light: () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  medium: () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
  success: () => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  error: () => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  },
  selection: () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
  },
};
