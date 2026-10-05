import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendSms, SmsUnavailableError } from "../server/_core/sms";
import { CODE_TTL_MS, issueVerificationCode, MAX_CODE_ATTEMPTS, verifyCode, type VerificationStore } from "../server/verification-codes";

type Row = { id: number; phone: string; purpose: "register" | "password_reset"; codeHash: string; attempts: number; expiresAt: Date; consumedAt: Date | null };

function memoryStore() {
  const rows: Row[] = [];
  const store: VerificationStore = {
    async invalidate(phone, purpose, now) {
      rows.filter((row) => row.phone === phone && row.purpose === purpose && !row.consumedAt).forEach((row) => (row.consumedAt = now));
    },
    async insert(row) {
      rows.push({ ...row, id: rows.length + 1, attempts: 0, consumedAt: null });
    },
    async findActive(phone, purpose) {
      return [...rows].reverse().find((row) => row.phone === phone && row.purpose === purpose && !row.consumedAt);
    },
    async incrementAttempts(id) {
      const row = rows.find((item) => item.id === id);
      if (row) row.attempts += 1;
    },
    async consume(id, now) {
      const row = rows.find((item) => item.id === id);
      if (row) row.consumedAt = now;
    },
  };
  return { rows, store };
}

async function issue(store: VerificationStore, phone = "+22670123456", purpose: "register" | "password_reset" = "register", now = new Date()) {
  const send = vi.fn(async (_message: { to: string; message: string }) => undefined);
  await issueVerificationCode(phone, purpose, store, send, now);
  const code = /(\d{6})/.exec(send.mock.calls[0]?.[0].message ?? "")?.[1] ?? "";
  return { code, send };
}

describe("codes de vérification SMS (L4, L5)", () => {
  it("envoie un code à 6 chiffres et n'en stocke qu'un HMAC", async () => {
    const { rows, store } = memoryStore();
    const { code, send } = await issue(store);

    expect(code).toMatch(/^\d{6}$/);
    expect(send.mock.calls[0]?.[0].to).toBe("+22670123456");
    expect(rows[0]?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.codeHash).not.toContain(code);
  });

  it("accepte le bon code une seule fois", async () => {
    const { store } = memoryStore();
    const { code } = await issue(store);
    expect(await verifyCode("+22670123456", "register", code, store)).toBe("ok");
    expect(await verifyCode("+22670123456", "register", code, store)).toBe("invalid");
  });

  it("ne mélange pas les usages ni les numéros", async () => {
    const { store } = memoryStore();
    const { code } = await issue(store, "+22670123456", "register");
    expect(await verifyCode("+22670123456", "password_reset", code, store)).toBe("invalid");
    expect(await verifyCode("+22670999999", "register", code, store)).toBe("invalid");
  });

  it("refuse un code expiré", async () => {
    const { store } = memoryStore();
    const issuedAt = new Date("2026-10-05T10:00:00Z");
    const { code } = await issue(store, "+22670123456", "register", issuedAt);
    expect(await verifyCode("+22670123456", "register", code, store, new Date(issuedAt.getTime() + CODE_TTL_MS + 1))).toBe("expired");
  });

  it("bloque le code après trop d'essais, même si le bon code arrive ensuite", async () => {
    const { store } = memoryStore();
    const { code } = await issue(store);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      expect(await verifyCode("+22670123456", "register", wrong, store)).toBe("invalid");
    }
    expect(await verifyCode("+22670123456", "register", code, store)).toBe("too_many_attempts");
  });

  it("invalide l'ancien code quand un nouveau est demandé", async () => {
    const { store } = memoryStore();
    const first = await issue(store);
    const second = await issue(store);
    if (first.code !== second.code) {
      expect(await verifyCode("+22670123456", "register", first.code, store)).toBe("invalid");
    }
    expect(await verifyCode("+22670123456", "register", second.code, store)).toBe("ok");
  });
});

describe("webhook SMS générique", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POST le message en JSON avec le jeton Bearer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await sendSms({ to: "+22670123456", message: "Code 123456" }, { SMS_WEBHOOK_URL: "https://sms.example/send", SMS_WEBHOOK_TOKEN: "tok" } as unknown as NodeJS.ProcessEnv);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://sms.example/send");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init?.body))).toMatchObject({ to: "+22670123456", message: "Code 123456", sender: "PharmaGarde" });
  });

  it("échoue clairement si le webhook répond une erreur ou s'il manque en production", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(sendSms({ to: "+22670123456", message: "x" }, { SMS_WEBHOOK_URL: "https://sms.example/send" } as unknown as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(SmsUnavailableError);
    await expect(sendSms({ to: "+22670123456", message: "x" }, { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(SmsUnavailableError);
  });
});

// --- Routes HTTP ---------------------------------------------------------------------------------

const getUserByPhone = vi.fn();
const updateUserPassword = vi.fn();
const issueVerificationCodeMock = vi.fn();
const verifyCodeMock = vi.fn();

vi.mock("../server/db", () => ({
  getUserByPhone: (phone: string) => getUserByPhone(phone),
  updateUserPassword: (id: number, hash: string) => updateUserPassword(id, hash),
}));
// Les routes appellent issueVerificationCode/verifyCode sans store (arguments par défaut) : ces
// appels-là sont simulés. Les tests unitaires ci-dessus passent un store explicite et gardent
// l'implémentation réelle.
vi.mock("../server/verification-codes", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/verification-codes")>();
  return {
    ...original,
    issueVerificationCode: (...args: unknown[]) => (args.length > 2 ? original.issueVerificationCode(...(args as Parameters<typeof original.issueVerificationCode>)) : issueVerificationCodeMock(...args)),
    verifyCode: (...args: unknown[]) => (args.length > 3 ? original.verifyCode(...(args as Parameters<typeof original.verifyCode>)) : verifyCodeMock(...args)),
  };
});

type Handler = (req: Request, res: Response, next: () => void) => unknown;

class FakeResponse {
  statusCode = 200;
  body: unknown = null;
  headers: Record<string, string> = {};
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(payload: unknown) {
    this.body = payload;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
}

let ipCounter = 0;
async function call(handlers: Handler[], body: unknown) {
  ipCounter += 1;
  const req = { body, headers: {}, ip: `203.0.113.${ipCounter}` } as unknown as Request;
  const res = new FakeResponse();
  for (const handler of handlers) {
    let nextCalled = false;
    await handler(req, res as unknown as Response, () => {
      nextCalled = true;
    });
    if (!nextCalled) break;
  }
  return res;
}

describe("routes SMS (L4, L5)", async () => {
  const { registerPhoneAuthRoutes } = await import("../server/phone-auth");
  const routes: Record<string, Handler[]> = {};
  registerPhoneAuthRoutes({ post: (path: string, ...handlers: Handler[]) => (routes[path] = handlers) } as never, ["/api/auth"]);

  beforeEach(() => {
    getUserByPhone.mockReset();
    updateUserPassword.mockReset();
    issueVerificationCodeMock.mockReset();
    verifyCodeMock.mockReset();
  });

  it("L5 : envoie le code d'inscription à un numéro libre et refuse un numéro déjà inscrit", async () => {
    getUserByPhone.mockResolvedValueOnce(undefined);
    const ok = await call(routes["/api/auth/register/request-code"], { phone: "70 12 34 56" });
    expect(ok.statusCode).toBe(200);
    expect(issueVerificationCodeMock).toHaveBeenCalledWith("+22670123456", "register");

    getUserByPhone.mockResolvedValueOnce({ id: 1 });
    const taken = await call(routes["/api/auth/register/request-code"], { phone: "+22670123456" });
    expect(taken.statusCode).toBe(409);
  });

  it("L4 : répond pareil que le numéro ait un compte ou non (pas d'énumération)", async () => {
    getUserByPhone.mockResolvedValueOnce(undefined);
    const unknown = await call(routes["/api/auth/password-reset/request"], { phone: "+22670000001" });
    getUserByPhone.mockResolvedValueOnce({ id: 3, passwordHash: "scrypt:a:b" });
    const known = await call(routes["/api/auth/password-reset/request"], { phone: "+22670000002" });

    expect(unknown.statusCode).toBe(200);
    expect(known.statusCode).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(issueVerificationCodeMock).toHaveBeenCalledTimes(1);
    expect(issueVerificationCodeMock).toHaveBeenCalledWith("+22670000002", "password_reset");
  });

  it("L4 : change le mot de passe seulement avec un code valide", async () => {
    verifyCodeMock.mockResolvedValueOnce("invalid");
    const refused = await call(routes["/api/auth/password-reset/confirm"], { phone: "+22670123456", code: "000000", password: "nouveau-mdp", confirmPassword: "nouveau-mdp" });
    expect(refused.statusCode).toBe(400);
    expect(updateUserPassword).not.toHaveBeenCalled();

    verifyCodeMock.mockResolvedValueOnce("ok");
    getUserByPhone.mockResolvedValueOnce({ id: 9 });
    const accepted = await call(routes["/api/auth/password-reset/confirm"], { phone: "+22670123456", code: "123456", password: "nouveau-mdp", confirmPassword: "nouveau-mdp" });
    expect(accepted.statusCode).toBe(200);
    expect(updateUserPassword).toHaveBeenCalledWith(9, expect.stringMatching(/^scrypt:/));
  });

  it("L4 : refuse un nouveau mot de passe trop court avant de consommer le code", async () => {
    const res = await call(routes["/api/auth/password-reset/confirm"], { phone: "+22670123456", code: "123456", password: "court", confirmPassword: "court" });
    expect(res.statusCode).toBe(400);
    expect(verifyCodeMock).not.toHaveBeenCalled();
  });

  it("limite à 3 SMS par numéro sur 15 minutes", async () => {
    getUserByPhone.mockResolvedValue(undefined);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await call(routes["/api/auth/register/request-code"], { phone: "+22671111111" })).statusCode);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("L5 : l'inscription exige un code vérifié et marque le numéro comme vérifié", async () => {
    const { readFileSync } = await import("node:fs");
    const oauth = readFileSync("server/_core/oauth.ts", "utf8");
    const register = oauth.slice(oauth.indexOf("/register`"), oauth.indexOf("/login`"));
    expect(register).toContain('verifyCode(validation.phone, "register", code)');
    expect(register.indexOf("verifyCode(")).toBeLessThan(register.indexOf("createLocalAuthUser("));
    expect(register).toContain("phoneVerifiedAt: new Date()");
  });
});
