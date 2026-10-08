import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  },
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
}));

vi.mock("@/constants/oauth", () => ({
  SESSION_TOKEN_KEY: "session-token",
  USER_INFO_KEY: "user-info",
  getApiBaseUrl: () => "https://api.pharmagarde.test",
}));

describe("auth token headers", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("persiste le token utilisateur dans AsyncStorage et construit Authorization: Bearer TOKEN", async () => {
    const Auth = await import("../lib/_core/auth");

    await Auth.setSessionToken("session-token-123");

    await expect(Auth.getSessionToken()).resolves.toBe("session-token-123");
    await expect(Auth.getAuthorizationHeader()).resolves.toEqual({
      Authorization: "Bearer session-token-123",
    });
  });

  it("ajoute automatiquement le Bearer token aux appels API protégés", async () => {
    const Auth = await import("../lib/_core/auth");
    const { apiCall } = await import("../lib/_core/api");
    await Auth.setSessionToken("api-token-456");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ success: true }),
    } as Response);

    await apiCall("/api/trpc/premium.status", { method: "GET" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer api-token-456",
    });
  });

  it("le client tRPC utilise le helper Authorization centralisé pour toutes ses requêtes", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("lib/trpc.ts", "utf-8"));

    expect(source).toContain("async headers() {");
    expect(source).toContain("return Auth.getAuthorizationHeader();");
    expect(source).not.toContain("Platform.OS !== \"web\"");
  });

  it("n’appelle pas la route tRPC premium.status tant qu’aucun Bearer token n’est disponible", async () => {
    const { fetchPremiumStatus } = await import("../lib/pharmagarde/premium");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch should not be called without a token"));

    await expect(fetchPremiumStatus()).resolves.toMatchObject({
      isPremium: false,
      subscriptionEnd: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("statut Premium lu depuis la route tRPC", () => {
  it("lit la réponse groupée superjson renvoyée par le serveur", async () => {
    const { parsePremiumStatusResponse } = await import("../lib/pharmagarde/premium");
    const batched = [{ result: { data: { json: { isPremium: true, subscriptionEnd: "2026-12-01T00:00:00.000Z", serverTime: "2026-10-08T06:29:55.858Z" } } } }];
    expect(parsePremiumStatusResponse(batched)).toEqual({ isPremium: true, subscriptionEnd: "2026-12-01T00:00:00.000Z", serverTime: "2026-10-08T06:29:55.858Z" });
    expect(parsePremiumStatusResponse({ result: { data: { isPremium: true, subscriptionEnd: null } } })).toMatchObject({ isPremium: true });
    expect(parsePremiumStatusResponse({ isPremium: false })).toMatchObject({ isPremium: false });
    expect(parsePremiumStatusResponse(null)).toMatchObject({ isPremium: false, subscriptionEnd: null });
  });
});
