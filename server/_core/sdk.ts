import { COOKIE_NAME, SESSION_TTL_MS } from "../../shared/const.js";
import { ForbiddenError } from "../../shared/_core/errors.js";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

// Sessions applicatives : jeton JWT HS256 signé avec JWT_SECRET, transmis en Bearer (mobile) ou en
// cookie HttpOnly (web). Le jeton porte sa date d'émission (iat) pour pouvoir être révoqué : tout
// jeton émis avant users.sessionsValidAfter est refusé.

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

export type VerifiedSession = SessionPayload & { issuedAtMs: number };

/** Un jeton reste valide si aucune révocation n'est postérieure à son émission. */
export function isSessionStillValid(issuedAtMs: number, sessionsValidAfter: Date | string | null | undefined) {
  if (!sessionsValidAfter) return true;
  const revokedAt = new Date(sessionsValidAfter).getTime();
  // iat est en secondes : on compare à la seconde près pour ne pas rejeter un jeton émis dans la
  // même seconde que la révocation qui l'a précédé.
  return !Number.isFinite(revokedAt) || Math.floor(issuedAtMs / 1000) >= Math.floor(revokedAt / 1000);
}

class SessionService {
  private getSessionSecret() {
    return new TextEncoder().encode(ENV.cookieSecret);
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) return new Map<string, string>();
    return new Map(Object.entries(parseCookieHeader(cookieHeader)));
  }

  async createSessionToken(openId: string, options: { expiresInMs?: number; name?: string } = {}): Promise<string> {
    return this.signSession({ openId, appId: ENV.appId || "pharmagarde", name: options.name || "" }, options);
  }

  async signSession(payload: SessionPayload, options: { expiresInMs?: number } = {}): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? SESSION_TTL_MS;
    return new SignJWT({ openId: payload.openId, appId: payload.appId, name: payload.name })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(Math.floor(issuedAt / 1000))
      .setExpirationTime(Math.floor((issuedAt + expiresInMs) / 1000))
      .sign(this.getSessionSecret());
  }

  async verifySession(token: string | undefined | null): Promise<VerifiedSession | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.getSessionSecret(), { algorithms: ["HS256"] });
      const { openId, appId, name, iat } = payload as Record<string, unknown>;
      // Les jetons sans date d'émission (émis avant la révocation des sessions) ne sont plus acceptés.
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || typeof name !== "string" || typeof iat !== "number") {
        return null;
      }
      return { openId, appId, name, issuedAtMs: iat * 1000 };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : undefined;
    const session = await this.verifySession(bearer || this.parseCookies(req.headers.cookie).get(COOKIE_NAME));
    if (!session) throw ForbiddenError("Invalid session cookie");

    // Seuls les comptes existants en base sont acceptés : aucune création ni synchronisation à
    // partir du jeton, et aucun jeton n'est transmis à un service tiers.
    const user = await db.getUserByOpenId(session.openId);
    if (!user) throw ForbiddenError("User not found");
    if (!isSessionStillValid(session.issuedAtMs, user.sessionsValidAfter)) throw ForbiddenError("Session revoked");
    if (user.suspendedAt) throw ForbiddenError("Account suspended");
    return user;
  }
}

export const sdk = new SessionService();
