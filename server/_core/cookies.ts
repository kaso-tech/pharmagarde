import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");

  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}

/**
 * Extract parent domain for cookie sharing across subdomains.
 * e.g., "3000-xxx.manuspre.computer" -> ".manuspre.computer"
 * This allows cookies set by 3000-xxx to be read by 8081-xxx
 */
function getParentDomain(hostname: string): string | undefined {
  // Don't set domain for localhost or IP addresses
  if (LOCAL_HOSTS.has(hostname) || isIpAddress(hostname)) {
    return undefined;
  }

  // Split hostname into parts
  const parts = hostname.split(".");

  // Need at least 3 parts for a subdomain (e.g., "3000-xxx.manuspre.computer")
  // For "manuspre.computer", we can't set a parent domain
  if (parts.length < 3) {
    return undefined;
  }

  // Return parent domain with leading dot (e.g., ".manuspre.computer")
  // This allows cookie to be shared across all subdomains
  return "." + parts.slice(-2).join(".");
}

export function getSessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const hostname = req.hostname;
  const domain = getParentDomain(hostname);

  const secure = isSecureRequest(req);
  // Lax par défaut : un site tiers ne peut pas faire envoyer le cookie de session. SameSite=None
  // n'est accepté qu'en HTTPS et sur demande explicite (SESSION_COOKIE_SAMESITE=none), par exemple
  // pour une prévisualisation dans une iframe cross-site.
  const sameSite = process.env.SESSION_COOKIE_SAMESITE?.trim().toLowerCase() === "none" && secure ? "none" : "lax";

  return {
    domain,
    httpOnly: true,
    path: "/",
    sameSite,
    secure,
  };
}
