import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "./auth";

export type AuthApiUser = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  phone?: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  lastSignedIn: string;
};

export type AuthApiResponse = {
  token: string;
  user: AuthApiUser;
};

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

export async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  const authHeaders = await Auth.getAuthorizationHeader();
  Object.assign(headers, authHeaders);
  console.log("[API] apiCall:", {
    endpoint,
    hasToken: Boolean(authHeaders.Authorization),
    method: options.method || "GET",
  });

  const baseUrl = getApiBaseUrl();
  // Ensure no double slashes between baseUrl and endpoint
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = baseUrl ? `${cleanBaseUrl}${cleanEndpoint}` : endpoint;
  console.log("[API] Full URL:", url);

  try {
    console.log("[API] Making request...");
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    console.log("[API] Response status:", response.status, response.statusText);
    const responseHeaders = Object.fromEntries(response.headers.entries());
    console.log("[API] Response headers:", responseHeaders);

    // Check if Set-Cookie header is present (cookies are automatically handled in React Native)
    const setCookie = response.headers.get("Set-Cookie");
    if (setCookie) {
      console.log("[API] Set-Cookie header received:", setCookie);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[API] Error response:", errorText);
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorText;
      } catch {
        // Not JSON, use text as is
      }
      throw new Error(errorMessage || `API call failed: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const data = await response.json();
      console.log("[API] JSON response received");
      return data as T;
    }

    const text = await response.text();
    console.log("[API] Text response received");
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    console.error("[API] Request failed:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Unknown error occurred");
  }
}

// Envoie par SMS le code qui prouve la possession du numéro avant l'inscription.
export async function requestRegisterCode(phone: string): Promise<{ success: true }> {
  return apiCall<{ success: true }>("/api/auth/register/request-code", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export async function requestPasswordReset(phone: string): Promise<{ success: true }> {
  return apiCall<{ success: true }>("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export async function confirmPasswordReset(payload: { phone: string; code: string; password: string; confirmPassword: string }): Promise<{ success: true }> {
  return apiCall<{ success: true }>("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function register(payload: { phone: string; email?: string | null; password: string; confirmPassword?: string; code: string }): Promise<AuthApiResponse> {
  const body = {
    phone: payload.phone,
    password: payload.password,
    code: payload.code,
    ...(payload.email ? { email: payload.email } : {}),
  };

  return apiCall<AuthApiResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function login(payload: { identifier: string; password: string }): Promise<AuthApiResponse> {
  return apiCall<AuthApiResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Logout
export async function logout(): Promise<void> {
  await apiCall<void>("/api/auth/logout", {
    method: "POST",
  });
}

// Déconnecte tous les appareils du compte (révocation côté serveur).
export async function logoutAllDevices(): Promise<void> {
  await apiCall<void>("/api/auth/logout-all", {
    method: "POST",
  });
}

// Supprime définitivement le compte connecté (mot de passe exigé pour les comptes locaux).
export async function deleteAccount(password: string): Promise<{ success: true }> {
  return apiCall<{ success: true }>("/api/auth/delete-account", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

// Get current authenticated user (web uses cookie-based auth)
export async function getMe(): Promise<{
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  phone?: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  lastSignedIn: string;
} | null> {
  try {
    const result = await apiCall<{ user: any }>("/api/auth/me");
    return result.user || null;
  } catch (error) {
    console.error("[API] getMe failed:", error);
    return null;
  }
}

// Establish session cookie on the backend (3000-xxx domain)
// Called after receiving token via postMessage to get a proper Set-Cookie from the backend
export async function establishSession(token: string): Promise<boolean> {
  try {
    console.log("[API] establishSession: setting cookie on backend...");
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/auth/session`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include", // Important: allows Set-Cookie to be stored
    });

    if (!response.ok) {
      console.error("[API] establishSession failed:", response.status);
      return false;
    }

    console.log("[API] establishSession: cookie set successfully");
    return true;
  } catch (error) {
    console.error("[API] establishSession error:", error);
    return false;
  }
}
