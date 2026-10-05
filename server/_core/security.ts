import type { NextFunction, Request, Response } from "express";

// --- CORS -------------------------------------------------------------------------------------
// Seules les origines listées dans CORS_ALLOWED_ORIGINS (séparées par des virgules) reçoivent les
// en-têtes CORS avec credentials. Hors production, les origines localhost restent autorisées pour
// le développement Expo web. Les applications natives n'envoient pas d'en-tête Origin : elles ne
// sont pas concernées.

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env) {
  return (env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
}

export function isOriginAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (getAllowedOrigins(env).includes(normalized)) return true;
  return env.NODE_ENV !== "production" && LOCAL_ORIGIN_PATTERN.test(normalized);
}

export function applyCorsHeaders(req: Request, res: Response) {
  res.setHeader("Vary", "Origin");
  const origin = typeof req.headers?.origin === "string" ? req.headers.origin : undefined;
  if (!isOriginAllowed(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin as string);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  return true;
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const allowed = applyCorsHeaders(req, res);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  }

  if (req.method === "OPTIONS") {
    res.sendStatus(allowed ? 204 : 403);
    return;
  }
  next();
}

// --- Limitation de débit -----------------------------------------------------------------------
// Compteur en mémoire à fenêtre fixe : suffisant pour une instance unique. À remplacer par un
// stockage partagé (Redis) si le serveur passe à plusieurs instances.

type RateLimitOptions = {
  name: string;
  windowMs: number;
  max: number;
  /** Clé de comptage ; `undefined` désactive la limite pour la requête. */
  key: (req: Request) => string | undefined;
  message: string;
};

export function createRateLimiter({ name, windowMs, max, key, message }: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweepAt = Date.now();

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const rawKey = key(req);
    if (!rawKey) {
      next();
      return;
    }

    const now = Date.now();
    // Purge régulière des compteurs expirés : les IP ne restent pas en mémoire au-delà de la fenêtre.
    if (now - lastSweepAt > 60_000 || hits.size > 10_000) {
      for (const [entryKey, entry] of hits) if (entry.resetAt <= now) hits.delete(entryKey);
      lastSweepAt = now;
    }

    const entryKey = `${name}:${rawKey}`;
    const entry = hits.get(entryKey);
    const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + windowMs };
    current.count += 1;
    hits.set(entryKey, current);

    if (current.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: message, retryAfterSeconds });
      return;
    }
    next();
  };
}

export function clientIpKey(req: Request) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Valeur de `trust proxy` d'Express lue depuis TRUST_PROXY : nombre de proxys de confiance
 * (ex. "1"), "true", ou liste d'adresses. Absent : aucun proxy n'est cru, pour qu'un client ne
 * puisse pas choisir son IP via X-Forwarded-For et contourner la limitation de débit.
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "false") return false;
  if (trimmed === "true") return true;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

// --- URLs publiques ----------------------------------------------------------------------------
// Les URLs de retour et de callback de paiement ne doivent jamais être déduites de l'en-tête Host,
// que le client contrôle.

function readAbsoluteUrl(name: string, env: NodeJS.ProcessEnv) {
  const raw = env[name]?.trim();
  if (!raw) throw new Error(`${name} n'est pas configurée.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} n'est pas une URL valide.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} doit utiliser http ou https.`);
  if (env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error(`${name} doit utiliser https en production.`);
  return url.toString().replace(/\/+$/, "");
}

export function getPublicPaymentUrls(env: NodeJS.ProcessEnv = process.env) {
  return {
    appUrl: readAbsoluteUrl("PUBLIC_APP_URL", env),
    apiUrl: readAbsoluteUrl("PUBLIC_API_URL", env),
  };
}

// --- En-têtes de sécurité HTTP (S13) -----------------------------------------------------------
// Équivalent minimal de helmet, sans dépendance. L'API ne sert que du JSON et quelques pages HTML
// statiques (pages légales, retour de paiement) à styles intégrés : une politique stricte suffit.

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}
