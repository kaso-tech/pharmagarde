import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform } from "react-native";
import { installExpoAssetUriFix, preloadLocalIconAssets } from "@/lib/pharmagarde/expo-assets";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider, useThemeContext } from "@/lib/theme-provider";
import { PharmaGardeProvider } from "@/lib/pharmagarde/app-state";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";

installExpoAssetUriFix();

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

function AppStatusBar() {
  const { colorScheme } = useThemeContext();
  return <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />;
}

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
  }, []);

  // Preload the bundled Material Icons font through a normalized local Expo asset URL.
  // This avoids malformed development URLs such as http://8081 while keeping icons available.
  useEffect(() => {
    preloadLocalIconAssets().catch((error) => {
      console.warn("Unable to preload local icon assets", error);
    });
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
          {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
          {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
          <PharmaGardeProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="pharmagarde/menu" options={{ presentation: "modal" }} />
              <Stack.Screen name="pharmagarde/ville" options={{ presentation: "modal" }} />
              <Stack.Screen name="pharmagarde/contribution/nouvelle-pharmacie" options={{ presentation: "modal" }} />
              <Stack.Screen name="pharmagarde/contribution/signaler-probleme" options={{ presentation: "modal" }} />
              <Stack.Screen name="pharmagarde/info/[id]/index" options={{ presentation: "modal" }} />
              <Stack.Screen name="pharmagarde/abonnement" options={{ presentation: "modal" }} />
              <Stack.Screen name="pharmagarde/supprimer-compte" options={{ presentation: "modal" }} />
              <Stack.Screen name="pharmagarde/search" options={{ presentation: "modal" }} />
              <Stack.Screen name="pharmagarde/favoris" options={{ presentation: "modal" }} />
              <Stack.Screen name="auth/login" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="auth/register" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="auth/mot-de-passe-oublie" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="auth/loading" options={{ presentation: "fullScreenModal" }} />
            </Stack>
            <AppStatusBar />
          </PharmaGardeProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>{content}</SafeAreaProvider>
    </ThemeProvider>
  );
}
