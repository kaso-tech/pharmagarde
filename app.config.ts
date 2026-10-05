// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

import { APP_BUNDLE_ID, APP_NAME, APP_SCHEME, APP_SLUG } from "./app-identity";

const env = {
  // Identité définie dans app-identity.js
  appName: APP_NAME,
  appSlug: APP_SLUG,
  scheme: APP_SCHEME,
  iosBundleId: APP_BUNDLE_ID,
  androidPackage: APP_BUNDLE_ID,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false
      }
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F8EC",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    permissions: ["POST_NOTIFICATIONS"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-asset",
    "expo-font",
    "expo-image",
    "expo-secure-store",
    "expo-status-bar",
    "expo-web-browser",
    [
      "expo-audio",
      {
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission: "Autoriser $(PRODUCT_NAME) à utiliser votre position pour afficher les pharmacies et cliniques de votre ville.",
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#F6FBF8",
        dark: {
          backgroundColor: "#102016",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
    // La carte utilise MapLibre GL JS via un composant DOM Expo (components/pharmagarde/maplibre-view.tsx) :
    // aucun plugin natif ni clé Google Maps n'est requis, ce qui préserve la compatibilité Expo Go.
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
