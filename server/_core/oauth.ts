import { COOKIE_NAME, SESSION_TTL_MS } from "../../shared/const.js";
import type { Express, Request, Response } from "express";
import { createLocalAuthUser, getUserByEmail, getUserByOpenId, getUserByPhone, getUserByPhoneOrEmail, revokeUserSessions, upsertUser } from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { buildLocalOpenId, hashPassword, validateLoginPayload, validateRegisterPayload, verifyPassword } from "./local-auth";
import { clientIpKey, createRateLimiter } from "./security";
import { VERIFY_ERROR_MESSAGES, verifyCode } from "../verification-codes";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

// Partagés entre /auth et /api/auth pour que les deux chemins consomment le même quota.
const loginIpRateLimit = createRateLimiter({
  name: "login-ip",
  windowMs: FIFTEEN_MINUTES_MS,
  max: 30,
  key: clientIpKey,
  message: "Trop de tentatives de connexion. Réessayez dans quelques minutes.",
});

// Limite par compte visé : bloque la force brute sur un numéro même si l'attaquant change d'IP.
const loginAccountRateLimit = createRateLimiter({
  name: "login-account",
  windowMs: FIFTEEN_MINUTES_MS,
  max: 10,
  key: (req) => {
    const validation = validateLoginPayload(req.body);
    return validation.ok ? validation.identifier : undefined;
  },
  message: "Trop de tentatives de connexion pour ce compte. Réessayez dans quelques minutes.",
});

const registerRateLimit = createRateLimiter({
  name: "register-ip",
  windowMs: 60 * 60 * 1000,
  max: 10,
  key: clientIpKey,
  message: "Trop de créations de compte depuis cette connexion. Réessayez plus tard.",
});

function buildUserResponse(
  user:
    | Awaited<ReturnType<typeof getUserByOpenId>>
    | {
        openId: string;
        name?: string | null;
        email?: string | null;
        loginMethod?: string | null;
        role?: "user" | "admin";
        lastSignedIn?: Date | null;
      },
) {
  return {
    id: (user as any)?.id ?? null,
    openId: user?.openId ?? null,
    name: user?.name ?? null,
    email: user?.email ?? null,
    phone: (user as any)?.phone ?? null,
    loginMethod: user?.loginMethod ?? null,
    role: (user as any)?.role === "admin" ? "admin" : "user",
    lastSignedIn: (user?.lastSignedIn ?? new Date()).toISOString(),
  };
}

export function registerOAuthRoutes(app: Express) {

  const registerLocalAuthRoutes = (path: string) => {
    app.post(`${path}/register`, registerRateLimit, async (req: Request, res: Response) => {
      const validation = validateRegisterPayload(req.body);
      if (!validation.ok) {
        res.status(400).json({ error: "Validation échouée", errors: validation.errors });
        return;
      }

      try {
        const existingPhone = await getUserByPhone(validation.phone);
        if (existingPhone) {
          res.status(409).json({ error: "Ce téléphone est déjà utilisé.", field: "phone" });
          return;
        }

        if (validation.email) {
          const existingEmail = await getUserByEmail(validation.email);
          if (existingEmail) {
            res.status(409).json({ error: "Cet email est déjà utilisé.", field: "email" });
            return;
          }
        }

        // L5 : le numéro doit être prouvé par le code SMS reçu (POST …/register/request-code).
        const code = typeof req.body?.code === "string" ? req.body.code : "";
        const verification = await verifyCode(validation.phone, "register", code);
        if (verification !== "ok") {
          res.status(400).json({ error: VERIFY_ERROR_MESSAGES[verification], field: "code" });
          return;
        }

        const openId = buildLocalOpenId(validation.phone);
        const user = await createLocalAuthUser({
          openId,
          phone: validation.phone,
          email: validation.email,
          passwordHash: hashPassword(validation.password),
          loginMethod: "phone_password",
          phoneVerifiedAt: new Date(),
          lastSignedIn: new Date(),
        });

        if (!user) {
          res.status(500).json({ error: "Compte créé mais utilisateur introuvable." });
          return;
        }

        const token = await sdk.createSessionToken(openId, { name: validation.phone, expiresInMs: SESSION_TTL_MS });
        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
        res.status(201).json({ token, user: buildUserResponse(user) });
      } catch (e) {
        console.error(e);
        console.error("[Auth] register failed", e);
        const message = e instanceof Error && e.message === "DATABASE_UNAVAILABLE" ? "Base de données indisponible." : "Impossible de créer le compte.";
        res.status(e instanceof Error && e.message === "DATABASE_UNAVAILABLE" ? 503 : 500).json({ error: message });
      }
    });

    app.post(`${path}/login`, loginIpRateLimit, loginAccountRateLimit, async (req: Request, res: Response) => {
      const validation = validateLoginPayload(req.body);
      if (!validation.ok) {
        res.status(400).json({ error: "Validation échouée", errors: validation.errors });
        return;
      }

      try {
        const user = await getUserByPhoneOrEmail(validation.identifier);
        if (!user || !verifyPassword(validation.password, (user as any).passwordHash)) {
          res.status(401).json({ error: "Téléphone/email ou mot de passe incorrect." });
          return;
        }
        if (user.suspendedAt) {
          res.status(403).json({ error: "Ce compte est suspendu. Contactez le support PharmaGarde." });
          return;
        }

        await upsertUser({ openId: user.openId, lastSignedIn: new Date() });
        const refreshedUser = (await getUserByOpenId(user.openId)) ?? user;
        const token = await sdk.createSessionToken(user.openId, { name: user.phone ?? user.email ?? user.openId, expiresInMs: SESSION_TTL_MS });
        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
        res.json({ token, user: buildUserResponse(refreshedUser) });
      } catch (error) {
        console.error("[Auth] login failed", error);
        res.status(500).json({ error: "Impossible de connecter cet utilisateur." });
      }
    });
  };

  registerLocalAuthRoutes("/auth");
  registerLocalAuthRoutes("/api/auth");
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    res.json({ success: true });
  });

  // Get current authenticated user - works with both cookie (web) and Bearer token (mobile)
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Auth] /api/auth/me failed:", error);
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });

  // Déconnecte tous les appareils : les jetons émis jusqu'ici sont refusés (S7).
  app.post("/api/auth/logout-all", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      await revokeUserSessions(user.id);
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] /api/auth/logout-all failed:", error instanceof Error ? error.message : error);
      res.status(401).json({ error: "Connexion requise." });
    }
  });

  // Establish session cookie from Bearer token
  // Used by iframe preview: frontend receives token via postMessage, then calls this endpoint
  // to get a proper Set-Cookie response from the backend (3000-xxx domain)
  app.post("/api/auth/session", async (req: Request, res: Response) => {
    try {
      // Authenticate using Bearer token from Authorization header
      const user = await sdk.authenticateRequest(req);

      // Get the token from the Authorization header to set as cookie
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();

      // Set cookie for this domain (3000-xxx)
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });

      res.json({ success: true, user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Auth] /api/auth/session failed:", error);
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
