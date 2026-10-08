import { createContext, useContext, useEffect, useState } from "react";
import { Dimensions, Platform } from "react-native";

import { useThemeContext } from "@/lib/theme-provider";

/** Palette de la console d'administration (application web de gestion), claire et sombre. */
export function useAdminTheme() {
  const { colorScheme } = useThemeContext();
  const dark = colorScheme === "dark";
  return dark
    ? {
        dark,
        background: "#0E1411",
        surface: "#151C18",
        surfaceMuted: "#1B2420",
        surfaceHover: "#202B25",
        border: "#27332C",
        borderStrong: "#34433A",
        text: "#F2F5F3",
        textSecondary: "#C4CEC8",
        textMuted: "#8D9A93",
        brand: "#2BB24C",
        brandStrong: "#22A042",
        brandSoft: "rgba(43, 178, 76, 0.14)",
        brandText: "#5FD07A",
        onBrand: "#FFFFFF",
        info: "#53A2FF",
        infoSoft: "rgba(83, 162, 255, 0.14)",
        success: "#3CCB7F",
        successSoft: "rgba(60, 203, 127, 0.14)",
        warning: "#F5A524",
        warningSoft: "rgba(245, 165, 36, 0.14)",
        danger: "#F97066",
        dangerSoft: "rgba(249, 112, 102, 0.14)",
        overlay: "rgba(0, 0, 0, 0.6)",
        shadow: "#000000",
      }
    : {
        dark,
        background: "#F4F6F5",
        surface: "#FFFFFF",
        surfaceMuted: "#F9FAFB",
        surfaceHover: "#F2F7F3",
        border: "#E4E7EC",
        borderStrong: "#D0D5DD",
        text: "#101828",
        textSecondary: "#344054",
        textMuted: "#667085",
        brand: "#008000",
        brandStrong: "#006B00",
        brandSoft: "#E9F6EC",
        brandText: "#067A1F",
        onBrand: "#FFFFFF",
        info: "#1570EF",
        infoSoft: "#EFF8FF",
        success: "#079455",
        successSoft: "#ECFDF3",
        warning: "#DC6803",
        warningSoft: "#FFFAEB",
        danger: "#D92D20",
        dangerSoft: "#FEF3F2",
        overlay: "rgba(16, 24, 40, 0.45)",
        shadow: "#101828",
      };
}

export type AdminTheme = ReturnType<typeof useAdminTheme>;
export type Tone = "brand" | "success" | "warning" | "danger" | "info" | "neutral";

export function toneColors(theme: AdminTheme, tone: Tone) {
  switch (tone) {
    case "brand":
      return { fg: theme.brandText, bg: theme.brandSoft };
    case "success":
      return { fg: theme.success, bg: theme.successSoft };
    case "warning":
      return { fg: theme.warning, bg: theme.warningSoft };
    case "danger":
      return { fg: theme.danger, bg: theme.dangerSoft };
    case "info":
      return { fg: theme.info, bg: theme.infoSoft };
    default:
      return { fg: theme.textSecondary, bg: theme.surfaceMuted };
  }
}

/** Mise en page bureau (menu latéral fixe, tableaux) à partir de cette largeur. */
export const DESKTOP_BREAKPOINT = 768;
/** Grand écran : panneaux de détail à côté du contenu, grilles plus larges. */
export const LARGE_BREAKPOINT = 1280;

/**
 * Largeur de la page en pixels CSS. Sur le web, on lit la largeur de mise en page
 * (`documentElement.clientWidth`) : react-native-web mesure la zone visible zoomée, qui vaut ~400 px
 * sur un téléphone en mode « version pour ordinateur » alors que la page est rendue sur ~980 px.
 */
export function useViewportWidth() {
  const read = () => (Platform.OS === "web" && typeof document !== "undefined" ? document.documentElement.clientWidth || window.innerWidth : Dimensions.get("window").width);
  const [width, setWidth] = useState(read);
  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const update = () => setWidth(read());
      window.addEventListener("resize", update);
      update();
      return () => window.removeEventListener("resize", update);
    }
    const subscription = Dimensions.addEventListener("change", ({ window }) => setWidth(window.width));
    return () => subscription.remove();
  }, []);
  return width;
}

export type AdminLayout = { desktop: boolean; large: boolean; width: number };

export const AdminLayoutContext = createContext<AdminLayout>({ desktop: false, large: false, width: 0 });

export function useAdminLayout() {
  return useContext(AdminLayoutContext);
}

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 };
export const font = { xs: 12, sm: 13, md: 14, lg: 16, xl: 20, xxl: 26 };
