import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { normalizeEmail, normalizeIdentifier, normalizePhone } from "@/lib/pharmagarde/auth-validation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

type UseAuthOptions = {
  autoFetch?: boolean;
};

export function useAuth(options?: UseAuthOptions) {
  const { autoFetch = true } = options ?? {};
  const [user, setUser] = useState<Auth.User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchUser = useCallback(async () => {
    console.log("[useAuth] fetchUser called");
    try {
      setLoading(true);
      setError(null);

      // Web platform: use cookie-based auth, fetch user from API
      if (Platform.OS === "web") {
        console.log("[useAuth] Web platform: fetching user from API...");
        const apiUser = await Api.getMe();
        console.log("[useAuth] API user response:", apiUser);

        if (apiUser) {
          const userInfo = normalizeAuthUser(apiUser);
          setUser(userInfo);
          // Cache user info in localStorage for faster subsequent loads
          await Auth.setUserInfo(userInfo);
          console.log("[useAuth] Web user set from API:", userInfo);
        } else {
          console.log("[useAuth] Web: No authenticated user from API");
          setUser(null);
          await Auth.clearUserInfo();
        }
        return;
      }

      // Native platform: use token-based auth
      console.log("[useAuth] Native platform: checking for session token...");
      const sessionToken = await Auth.getSessionToken();
      console.log(
        "[useAuth] Session token:",
        sessionToken ? `present (${sessionToken.substring(0, 20)}...)` : "missing",
      );
      if (!sessionToken) {
        console.log("[useAuth] No session token, setting user to null");
        setUser(null);
        return;
      }

      // Use cached user info for native (token validates the session)
      const cachedUser = await Auth.getUserInfo();
      console.log("[useAuth] Cached user:", cachedUser);
      if (cachedUser) {
        console.log("[useAuth] Using cached user info");
        setUser(cachedUser);
      } else {
        console.log("[useAuth] No cached user, setting user to null");
        setUser(null);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to fetch user");
      console.error("[useAuth] fetchUser error:", error);
      setError(error);
      setUser(null);
    } finally {
      setLoading(false);
      console.log("[useAuth] fetchUser completed, loading:", false);
    }
  }, []);

  const login = useCallback(async (payload: { identifier: string; password: string; rememberMe?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const result = await Api.login({
        identifier: normalizeIdentifier(payload.identifier),
        password: payload.password.trim(),
      });
      const userInfo = normalizeAuthUser(result.user);
      await Auth.setSessionToken(result.token, { rememberMe: payload.rememberMe ?? true });
      await Auth.setUserInfo(userInfo);
      setUser(userInfo);
      return userInfo;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Connexion impossible");
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (payload: { phone: string; email?: string; password: string; confirmPassword: string; code: string; rememberMe?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const result = await Api.register({
        phone: normalizePhone(payload.phone),
        email: payload.email ? normalizeEmail(payload.email) : null,
        password: payload.password.trim(),
        confirmPassword: payload.confirmPassword.trim(),
        code: payload.code.trim(),
      });
      const userInfo = normalizeAuthUser(result.user);
      await Auth.setSessionToken(result.token, { rememberMe: payload.rememberMe ?? true });
      await Auth.setUserInfo(userInfo);
      setUser(userInfo);
      return userInfo;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Inscription impossible");
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await Api.logout();
    } catch (err) {
      console.error("[Auth] Logout API call failed:", err);
      // Continue with logout even if API call fails
    } finally {
      await Auth.removeSessionToken();
      await Auth.clearUserInfo();
      setUser(null);
      setError(null);
    }
  }, []);

  const logoutAllDevices = useCallback(async () => {
    try {
      await Api.logoutAllDevices();
    } finally {
      await Auth.removeSessionToken();
      await Auth.clearUserInfo();
      setUser(null);
      setError(null);
    }
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    await Api.deleteAccount(password);
    // Le serveur a invalidé le compte : on efface la session locale comme pour une déconnexion.
    await Auth.removeSessionToken();
    await Auth.clearUserInfo();
    setUser(null);
    setError(null);
  }, []);

  const isAuthenticated = useMemo(() => Boolean(user), [user]);

  useEffect(() => {
    console.log("[useAuth] useEffect triggered, autoFetch:", autoFetch, "platform:", Platform.OS);
    if (autoFetch) {
      if (Platform.OS === "web") {
        // Web: fetch user from API directly (user will login manually if needed)
        console.log("[useAuth] Web: fetching user from API...");
        fetchUser();
      } else {
        // Native: check for cached user info first for faster initial load
        Auth.getUserInfo().then((cachedUser) => {
          console.log("[useAuth] Native cached user check:", cachedUser);
          if (cachedUser) {
            console.log("[useAuth] Native: setting cached user immediately");
            setUser(cachedUser);
            setLoading(false);
          } else {
            // No cached user, check session token
            fetchUser();
          }
        });
      }
    } else {
      console.log("[useAuth] autoFetch disabled, setting loading to false");
      setLoading(false);
    }
  }, [autoFetch, fetchUser]);

  useEffect(() => {
    console.log("[useAuth] State updated:", {
      hasUser: !!user,
      loading,
      isAuthenticated,
      error: error?.message,
    });
  }, [user, loading, isAuthenticated, error]);

  return {
    user,
    loading,
    error,
    isAuthenticated,
    refresh: fetchUser,
    login,
    register,
    logout,
    logoutAllDevices,
    deleteAccount,
  };
}

function normalizeAuthUser(user: Api.AuthApiUser): Auth.User {
  return {
    id: user.id,
    openId: user.openId,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    loginMethod: user.loginMethod,
    lastSignedIn: new Date(user.lastSignedIn || Date.now()),
  };
}
