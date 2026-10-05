/**
 * Identité définitive de l'application, partagée par app.config.ts, l'app et le serveur.
 * Le bundle ID iOS et le package Android ne peuvent plus changer une fois l'app publiée
 * sur l'App Store ou Google Play.
 */
const appIdentity = {
  APP_NAME: "PharmaGarde BF",
  APP_SLUG: "pharmagarde-bf",
  APP_BUNDLE_ID: "com.pharmagarde.app",
  /** Schéma des liens profonds : pharmagarde://… */
  APP_SCHEME: "pharmagarde",
  /** Contact du responsable du traitement (confidentialité, suppression de compte, support). */
  SUPPORT_EMAIL: "support@pharmagarde.com",
};

module.exports = appIdentity;
