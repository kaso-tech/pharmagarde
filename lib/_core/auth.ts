import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { SESSION_TOKEN_KEY, USER_INFO_KEY } from "@/constants/oauth";

export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  phone?: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  lastSignedIn: Date;
};

export const REMEMBER_ME_KEY = "pharmagarde:remember-me:v1";

type SessionTokenListener = (token: string | null) => void;

let cachedSessionToken: string | null | undefined;
let sessionTokenHydrationPromise: Promise<string | null> | null = null;
const sessionTokenListeners = new Set<SessionTokenListener>();

function notifySessionTokenListeners(token: string | null) {
  for (const listener of sessionTokenListeners) {
    try {
      listener(token);
    } catch (error) {
      console.error("[Auth] Session token listener failed:", error);
    }
  }
}

export function subscribeSessionTokenChanges(listener: SessionTokenListener): () => void {
  sessionTokenListeners.add(listener);
  return () => {
    sessionTokenListeners.delete(listener);
  };
}

async function getSecureStoreToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;

  try {
    return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  } catch (error) {
    console.error("[Auth] Failed to read session token from SecureStore:", error);
    return null;
  }
}

async function setSecureStoreToken(token: string): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  } catch (error) {
    console.error("[Auth] Failed to mirror session token in SecureStore:", error);
  }
}

async function removeSecureStoreToken(): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  } catch (error) {
    console.error("[Auth] Failed to remove session token from SecureStore:", error);
  }
}

async function hydrateSessionTokenFromStorage(): Promise<string | null> {
  try {
    console.log("[Auth] Hydrating session token...");

    const rememberMe = await AsyncStorage.getItem(REMEMBER_ME_KEY);
    if (rememberMe === "false") {
      console.log("[Auth] Remember me disabled; clearing persisted session token");
      await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
    await AsyncStorage.removeItem(REMEMBER_ME_KEY);
      await removeSecureStoreToken();
      cachedSessionToken = null;
      return null;
    }

    const asyncStorageToken = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
    if (asyncStorageToken) {
      console.log("[Auth] Session token retrieved from AsyncStorage");
      cachedSessionToken = asyncStorageToken;
      return asyncStorageToken;
    }

    const secureStoreToken = await getSecureStoreToken();
    if (secureStoreToken) {
      console.log("[Auth] Session token recovered from SecureStore and mirrored to AsyncStorage");
      await AsyncStorage.setItem(SESSION_TOKEN_KEY, secureStoreToken);
      cachedSessionToken = secureStoreToken;
      return secureStoreToken;
    }

    console.log("[Auth] No session token found");
    cachedSessionToken = null;
    return null;
  } catch (error) {
    console.error("[Auth] Failed to hydrate session token:", error);
    cachedSessionToken = null;
    return null;
  }
}

export async function getSessionToken(): Promise<string | null> {
  if (cachedSessionToken !== undefined) {
    return cachedSessionToken;
  }

  if (!sessionTokenHydrationPromise) {
    sessionTokenHydrationPromise = hydrateSessionTokenFromStorage().finally(() => {
      sessionTokenHydrationPromise = null;
    });
  }

  return sessionTokenHydrationPromise;
}

export async function hasSessionToken(): Promise<boolean> {
  return Boolean(await getSessionToken());
}

export async function setSessionToken(token: string, options: { rememberMe?: boolean } = {}): Promise<void> {
  try {
    const normalizedToken = token.trim();
    if (!normalizedToken) throw new Error("Session token is required");

    console.log("[Auth] Setting session token...");
    cachedSessionToken = normalizedToken;
    if (typeof options.rememberMe === "boolean") {
      await AsyncStorage.setItem(REMEMBER_ME_KEY, String(options.rememberMe));
    }
    await AsyncStorage.setItem(SESSION_TOKEN_KEY, normalizedToken);
    await setSecureStoreToken(normalizedToken);
    notifySessionTokenListeners(normalizedToken);
    console.log("[Auth] Session token stored successfully");
  } catch (error) {
    console.error("[Auth] Failed to set session token:", error);
    throw error;
  }
}

export async function removeSessionToken(): Promise<void> {
  try {
    console.log("[Auth] Removing session token...");
    cachedSessionToken = null;
    await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
    await AsyncStorage.removeItem(REMEMBER_ME_KEY);
    await removeSecureStoreToken();
    notifySessionTokenListeners(null);
    console.log("[Auth] Session token removed successfully");
  } catch (error) {
    console.error("[Auth] Failed to remove session token:", error);
  }
}

export async function getAuthorizationHeader(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getUserInfo(): Promise<User | null> {
  try {
    console.log("[Auth] Getting user info...");

    let info: string | null = null;
    if (Platform.OS === "web") {
      info = await AsyncStorage.getItem(USER_INFO_KEY);
    } else {
      info = await SecureStore.getItemAsync(USER_INFO_KEY);
    }

    if (!info) {
      console.log("[Auth] No user info found");
      return null;
    }
    const user = JSON.parse(info);
    console.log("[Auth] User info retrieved:", user);
    return user;
  } catch (error) {
    console.error("[Auth] Failed to get user info:", error);
    return null;
  }
}

export async function setUserInfo(user: User): Promise<void> {
  try {
    console.log("[Auth] Setting user info...", user);

    if (Platform.OS === "web") {
      await AsyncStorage.setItem(USER_INFO_KEY, JSON.stringify(user));
      console.log("[Auth] User info stored in AsyncStorage successfully");
      return;
    }

    await SecureStore.setItemAsync(USER_INFO_KEY, JSON.stringify(user));
    console.log("[Auth] User info stored in SecureStore successfully");
  } catch (error) {
    console.error("[Auth] Failed to set user info:", error);
  }
}

export async function clearUserInfo(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      await AsyncStorage.removeItem(USER_INFO_KEY);
      return;
    }

    await SecureStore.deleteItemAsync(USER_INFO_KEY);
  } catch (error) {
    console.error("[Auth] Failed to clear user info:", error);
  }
}
