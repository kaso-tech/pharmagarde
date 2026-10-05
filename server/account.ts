import type { Express, Request, Response } from "express";

import { APP_NAME, SUPPORT_EMAIL } from "../app-identity";
import { COOKIE_NAME } from "../shared/const.js";
import { PRIVACY_POLICY_INTRO, PRIVACY_POLICY_SECTIONS, PRIVACY_POLICY_UPDATED_AT, type LegalSection } from "../shared/privacy-policy";
import { getSessionCookieOptions } from "./_core/cookies";
import { verifyPassword } from "./_core/local-auth";
import { sdk } from "./_core/sdk";
import { clientIpKey, createRateLimiter } from "./_core/security";
import { deleteUserAccount } from "./db";

const deleteAccountRateLimit = createRateLimiter({
  name: "delete-account",
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: clientIpKey,
  message: "Trop de tentatives. Réessayez dans quelques minutes.",
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export function renderLegalPage(title: string, intro: string, sections: LegalSection[], updatedAt?: string) {
  const body = sections
    .map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</section>`)
    .join("\n");
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · ${escapeHtml(APP_NAME)}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4fbf7; color: #102016; line-height: 1.6; }
    main { max-width: 760px; margin: 0 auto; padding: 32px 20px 48px; }
    h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; }
    .updated { color: #667085; font-size: 14px; margin: 0 0 16px; }
    section { background: #fff; border: 1px solid #d6ebdd; border-radius: 12px; padding: 16px 20px; margin-top: 16px; }
    h2 { font-size: 18px; margin: 0 0 8px; color: #006400; }
    p { margin: 0 0 8px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${updatedAt ? `<p class="updated">Dernière mise à jour : ${escapeHtml(updatedAt)}</p>` : ""}
    <p>${escapeHtml(intro)}</p>
    ${body}
  </main>
</body>
</html>`;
}

const ACCOUNT_DELETION_SECTIONS: LegalSection[] = [
  {
    title: "Depuis l'application",
    paragraphs: [
      "Ouvrez le menu, section Compte, puis « Supprimer mon compte ». Confirmez avec votre mot de passe : la suppression est immédiate et définitive.",
    ],
  },
  {
    title: "Sans l'application",
    paragraphs: [
      `Écrivez à ${SUPPORT_EMAIL} depuis l'adresse e-mail de votre compte, ou en indiquant le numéro de téléphone du compte. Nous confirmons la suppression sous 30 jours au plus.`,
    ],
  },
  {
    title: "Données supprimées et conservées",
    paragraphs: [
      "Sont supprimés : numéro de téléphone, adresse e-mail, mot de passe et identifiants de connexion. Vos sessions ouvertes sont invalidées et un éventuel abonnement Premium en cours prend fin sans remboursement.",
      "Sont conservés, sans lien avec votre identité : les enregistrements de paiement (offre, montant, date, statut, références), pendant la durée légale de conservation des pièces comptables.",
      "Vos favoris et préférences sont stockés uniquement sur votre appareil : désinstallez l'application pour les effacer.",
    ],
  },
];

async function handleDeleteAccount(req: Request, res: Response) {
  let user: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    res.status(401).json({ error: "Connexion requise pour supprimer le compte." });
    return;
  }

  // Les comptes locaux confirment avec leur mot de passe, pour qu'un téléphone déverrouillé ou un
  // jeton volé ne suffise pas à supprimer le compte.
  if (user.passwordHash) {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password || !verifyPassword(password.trim(), user.passwordHash)) {
      res.status(403).json({ error: "Mot de passe incorrect.", field: "password" });
      return;
    }
  }

  try {
    await deleteUserAccount(user.id);
  } catch (error) {
    console.error("[Account] Suppression impossible", error instanceof Error ? error.message : error);
    const unavailable = error instanceof Error && error.message === "DATABASE_UNAVAILABLE";
    res.status(unavailable ? 503 : 500).json({ error: unavailable ? "Base de données indisponible." : "Impossible de supprimer le compte." });
    return;
  }

  const cookieOptions = getSessionCookieOptions(req);
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
  res.json({ success: true });
}

export function registerAccountRoutes(app: Express) {
  app.post("/api/auth/delete-account", deleteAccountRateLimit, handleDeleteAccount);

  // Pages publiques exigées par l'App Store et Google Play (URL de politique de confidentialité et
  // de demande de suppression de compte).
  app.get("/confidentialite", (_req, res) => {
    res.type("html").send(renderLegalPage("Politique de confidentialité", PRIVACY_POLICY_INTRO, PRIVACY_POLICY_SECTIONS, PRIVACY_POLICY_UPDATED_AT));
  });
  app.get("/compte/suppression", (_req, res) => {
    res
      .type("html")
      .send(renderLegalPage("Supprimer votre compte", `Vous pouvez supprimer votre compte ${APP_NAME} et les données associées à tout moment.`, ACCOUNT_DELETION_SECTIONS));
  });
}
