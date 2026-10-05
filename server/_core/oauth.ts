import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const.js";
import type { Express, Request, Response } from "express";
import { createLocalAuthUser, getUserByEmail, getUserByOpenId, getUserByPhone, getUserByPhoneOrEmail, upsertUser } from "../db";
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

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

async function syncUser(userInfo: {
  openId?: string | null;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  platform?: string | null;
}) {
  if (!userInfo.openId) {
    throw new Error("openId missing from user info");
  }

  const lastSignedIn = new Date();
  await upsertUser({
    openId: userInfo.openId,
    name: userInfo.name || null,
    email: userInfo.email ?? null,
    loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
    lastSignedIn,
  });
  const saved = await getUserByOpenId(userInfo.openId);
  return (
    saved ?? {
      openId: userInfo.openId,
      name: userInfo.name,
      email: userInfo.email,
      loginMethod: userInfo.loginMethod ?? null,
      lastSignedIn,
    }
  );
}

function buildUserResponse(
  user:
    | Awaited<ReturnType<typeof getUserByOpenId>>
    | {
        openId: string;
        name?: string | null;
        email?: string | null;
        loginMethod?: string | null;
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

        const token = await sdk.createSessionToken(openId, { name: validation.phone, expiresInMs: ONE_YEAR_MS });
        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
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

        await upsertUser({ openId: user.openId, lastSignedIn: new Date() });
        const refreshedUser = (await getUserByOpenId(user.openId)) ?? user;
        const token = await sdk.createSessionToken(user.openId, { name: user.phone ?? user.email ?? user.openId, expiresInMs: ONE_YEAR_MS });
        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        res.json({ token, user: buildUserResponse(refreshedUser) });
      } catch (error) {
        console.error("[Auth] login failed", error);
        res.status(500).json({ error: "Impossible de connecter cet utilisateur." });
      }
    });
  };

  registerLocalAuthRoutes("/auth");
  registerLocalAuthRoutes("/api/auth");
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      const user = await syncUser(userInfo);
      const sessionToken = await sdk.createSessionToken(userInfo.openId!, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Redirect to the frontend callback route with the session token so the app can
      // persist it and attach Authorization: Bearer <token> to every protected tRPC call.
      // The cookie remains set as a compatibility fallback for browser-based sessions.
      const frontendUrl =
        process.env.EXPO_WEB_PREVIEW_URL ||
        process.env.EXPO_PACKAGER_PROXY_URL ||
        "http://localhost:8081";
      const callbackUrl = new URL("/oauth/callback", frontendUrl);
      callbackUrl.searchParams.set("sessionToken", sessionToken);
      callbackUrl.searchParams.set(
        "user",
        Buffer.from(JSON.stringify(buildUserResponse(user)), "utf-8").toString("base64"),
      );
      res.redirect(302, callbackUrl.toString());
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  app.get("/api/oauth/mobile", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      const user = await syncUser(userInfo);

      const sessionToken = await sdk.createSessionToken(userInfo.openId!, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({
        app_session_id: sessionToken,
        user: buildUserResponse(user),
      });
    } catch (error) {
      console.error("[OAuth] Mobile exchange failed", error);
      res.status(500).json({ error: "OAuth mobile exchange failed" });
    }
  });

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
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Auth] /api/auth/session failed:", error);
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
