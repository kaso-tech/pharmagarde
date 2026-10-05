import type { Express, Request, Response } from "express";

import { hashPassword, isValidPhone, MIN_PASSWORD_LENGTH, normalizePhone } from "./_core/local-auth";
import { clientIpKey, createRateLimiter } from "./_core/security";
import { SmsUnavailableError } from "./_core/sms";
import { getUserByPhone, revokeUserSessions, updateUserPassword } from "./db";
import { issueVerificationCode, VERIFY_ERROR_MESSAGES, verifyCode } from "./verification-codes";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

// Chaque SMS coûte de l'argent et peut servir à harceler un numéro : limites par IP et par numéro.
const smsIpRateLimit = createRateLimiter({
  name: "sms-ip",
  windowMs: 60 * 60 * 1000,
  max: 10,
  key: clientIpKey,
  message: "Trop de demandes de code depuis cette connexion. Réessayez plus tard.",
});

const smsPhoneRateLimit = createRateLimiter({
  name: "sms-phone",
  windowMs: FIFTEEN_MINUTES_MS,
  max: 3,
  key: (req) => {
    const phone = normalizePhone(req.body?.phone);
    return isValidPhone(phone) ? phone : undefined;
  },
  message: "Trop de codes envoyés à ce numéro. Réessayez dans quelques minutes.",
});

const resetConfirmRateLimit = createRateLimiter({
  name: "password-reset-confirm",
  windowMs: FIFTEEN_MINUTES_MS,
  max: 20,
  key: clientIpKey,
  message: "Trop de tentatives. Réessayez dans quelques minutes.",
});

function readPhone(req: Request) {
  const phone = normalizePhone(req.body?.phone);
  return isValidPhone(phone) ? phone : undefined;
}

function sendFailure(res: Response, error: unknown, context: string) {
  console.error(`[PhoneAuth] ${context}`, error instanceof Error ? error.message : error);
  if (error instanceof SmsUnavailableError) {
    res.status(503).json({ error: "Envoi du SMS impossible pour le moment. Réessayez plus tard." });
    return;
  }
  const unavailable = error instanceof Error && error.message === "DATABASE_UNAVAILABLE";
  res.status(unavailable ? 503 : 500).json({ error: unavailable ? "Base de données indisponible." : "Une erreur est survenue." });
}

/** L5 : envoie le code de vérification du numéro avant l'inscription. */
async function handleRegisterRequestCode(req: Request, res: Response) {
  const phone = readPhone(req);
  if (!phone) {
    res.status(400).json({ error: "Le téléphone doit être au format Burkina Faso, par exemple +22670123456.", field: "phone" });
    return;
  }
  try {
    if (await getUserByPhone(phone)) {
      res.status(409).json({ error: "Ce téléphone est déjà utilisé.", field: "phone" });
      return;
    }
    await issueVerificationCode(phone, "register");
    res.json({ success: true });
  } catch (error) {
    sendFailure(res, error, "Envoi du code d'inscription impossible");
  }
}

/**
 * L4 : demande de réinitialisation. La réponse est identique que le numéro ait un compte ou non,
 * pour ne pas révéler quels numéros sont inscrits.
 */
async function handlePasswordResetRequest(req: Request, res: Response) {
  const phone = readPhone(req);
  if (!phone) {
    res.status(400).json({ error: "Téléphone invalide.", field: "phone" });
    return;
  }
  try {
    const user = await getUserByPhone(phone);
    if (user?.passwordHash) await issueVerificationCode(phone, "password_reset");
    res.json({ success: true });
  } catch (error) {
    sendFailure(res, error, "Envoi du code de réinitialisation impossible");
  }
}

async function handlePasswordResetConfirm(req: Request, res: Response) {
  const phone = readPhone(req);
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const password = typeof req.body?.password === "string" ? req.body.password.trim() : "";
  const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword.trim() : password;

  if (!phone) {
    res.status(400).json({ error: "Téléphone invalide.", field: "phone" });
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`, field: "password" });
    return;
  }
  if (password !== confirmPassword) {
    res.status(400).json({ error: "La confirmation doit correspondre au mot de passe.", field: "confirmPassword" });
    return;
  }

  try {
    const verification = await verifyCode(phone, "password_reset", code);
    if (verification !== "ok") {
      res.status(400).json({ error: VERIFY_ERROR_MESSAGES[verification], field: "code" });
      return;
    }
    const user = await getUserByPhone(phone);
    if (!user) {
      res.status(400).json({ error: VERIFY_ERROR_MESSAGES.invalid, field: "code" });
      return;
    }
    await updateUserPassword(user.id, hashPassword(password));
    // Un mot de passe réinitialisé ferme toutes les sessions ouvertes, y compris celles d'un tiers.
    await revokeUserSessions(user.id);
    res.json({ success: true });
  } catch (error) {
    sendFailure(res, error, "Réinitialisation du mot de passe impossible");
  }
}

export function registerPhoneAuthRoutes(app: Express, paths: string[] = ["/auth", "/api/auth"]) {
  for (const path of paths) {
    app.post(`${path}/register/request-code`, smsIpRateLimit, smsPhoneRateLimit, handleRegisterRequestCode);
    app.post(`${path}/password-reset/request`, smsIpRateLimit, smsPhoneRateLimit, handlePasswordResetRequest);
    app.post(`${path}/password-reset/confirm`, resetConfirmRateLimit, handlePasswordResetConfirm);
  }
}
