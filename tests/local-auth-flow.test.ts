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

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return {
    ok: init.status ? init.status >= 200 && init.status < 300 : true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("authentification locale PharmaGarde", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("normalise et valide les champs d’inscription sans accepter les entrées vides ou dangereuses", async () => {
    const validation = await import("../lib/pharmagarde/auth-validation");

    expect(validation.sanitizeInput("  <script>70123456</script>  ")).toBe("script70123456/script");
    expect(validation.normalizePhone("70 12 34 56")).toBe("+22670123456");
    expect(validation.normalizeEmail("  USER@EXAMPLE.COM  ")).toBe("user@example.com");

    expect(validation.validateRegisterForm({
      phone: "70 12 34 56",
      email: "patient@example.com",
      password: "secret12",
      confirmPassword: "secret12",
    })).toEqual({});

    expect(validation.validateRegisterForm({
      phone: "",
      email: "email-invalide",
      password: "123",
      confirmPassword: "456",
    })).toMatchObject({
      phone: "Téléphone obligatoire.",
      email: "Adresse email invalide.",
      password: "Le mot de passe doit contenir au moins 8 caractères.",
      confirmPassword: "La confirmation doit correspondre au mot de passe.",
    });
  });

  it("valide la connexion par téléphone ou email et rejette les formulaires incomplets", async () => {
    const { validateLoginForm } = await import("../lib/pharmagarde/auth-validation");

    expect(validateLoginForm({ identifier: "70 12 34 56", password: "secret1" })).toEqual({});
    expect(validateLoginForm({ identifier: "patient@example.com", password: "secret1" })).toEqual({});
    expect(validateLoginForm({ identifier: "", password: "" })).toMatchObject({
      identifier: "Téléphone ou email obligatoire.",
      password: "Mot de passe obligatoire.",
    });
  });

  it("appelle POST /api/auth/register et POST /api/auth/login puis persiste le token reçu", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token: "register-token", user: { id: 12, phone: "+22670123456" } }))
      .mockResolvedValueOnce(jsonResponse({ token: "login-token", user: { id: 12, phone: "+22670123456" } }));

    const api = await import("../lib/_core/api");
    const Auth = await import("../lib/_core/auth");

    const registered = await api.register({ phone: "+22670123456", email: "patient@example.com", password: "secret1", confirmPassword: "secret1" });
    await Auth.setSessionToken(registered.token);
    expect(await Auth.getAuthorizationHeader()).toEqual({ Authorization: "Bearer register-token" });

    const loggedIn = await api.login({ identifier: "+22670123456", password: "secret1" });
    await Auth.setSessionToken(loggedIn.token);
    expect(await Auth.getAuthorizationHeader()).toEqual({ Authorization: "Bearer login-token" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.pharmagarde.test/api/auth/register");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe("POST");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://api.pharmagarde.test/api/auth/login");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.method).toBe("POST");
  });

  it("bloque l’initialisation du paiement premium tant qu’aucun token Bearer n’est présent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch should not be called without auth"));
    const { initPremiumPayment } = await import("../lib/pharmagarde/premium");

    await expect(initPremiumPayment("month")).rejects.toThrow("Connexion requise");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envoie Authorization: Bearer TOKEN sur l’initialisation du paiement premium quand l’utilisateur est connecté", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      reference: "PG-TEST",
      paymentUrl: "https://pay.test/PG-TEST",
      plan: { id: "month", label: "1 mois", amount: 400, durationDays: 30 },
      status: "pending",
    }));

    const Auth = await import("../lib/_core/auth");
    const { initPremiumPayment } = await import("../lib/pharmagarde/premium");
    await Auth.setSessionToken("premium-token");

    await expect(initPremiumPayment("month")).resolves.toMatchObject({ reference: "PG-TEST" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock).toHaveBeenCalledWith("https://api.pharmagarde.test/payment/init", expect.any(Object));
    expect(init?.headers).toMatchObject({ Authorization: "Bearer premium-token" });
  });
});
