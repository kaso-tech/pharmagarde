/**
 * Vérification des établissements dans la console : problèmes détectés sur une fiche et état de
 * la vérification. Partagé par le serveur (analyse) et la console (libellés, filtres).
 */

export const VERIFICATION_ISSUES = ["reported", "position_gap", "duplicate", "approximate", "no_position", "no_phone"] as const;
export type VerificationIssue = (typeof VERIFICATION_ISSUES)[number];

export const VERIFICATION_ISSUE_LABELS: Record<VerificationIssue, string> = {
  reported: "Signalée par un utilisateur",
  position_gap: "Écart avec OpenStreetMap",
  duplicate: "Doublon possible",
  approximate: "Position approximative",
  no_position: "Sans position",
  no_phone: "Sans téléphone",
};

export const VERIFICATION_ISSUE_HINTS: Record<VerificationIssue, string> = {
  reported: "Un utilisateur a signalé une erreur sur cette fiche depuis l’application.",
  position_gap: "Un lieu OpenStreetMap au nom proche est à plus de 300 m du point publié.",
  duplicate: "Un autre établissement est publié au même endroit (moins de 40 m) ou avec le même numéro.",
  approximate: "Position d’une source unique non recoupée : l’application la signale comme approximative.",
  no_position: "Pas de position : l’établissement n’apparaît ni sur la carte ni dans le tri par distance.",
  no_phone: "Pas de numéro : impossible d’appeler depuis l’application.",
};

export const VERIFICATION_STATUSES = ["todo", "needs_visit", "verified"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  todo: "À vérifier",
  needs_visit: "À vérifier sur place",
  verified: "Vérifiée",
};

/** Au-delà de cette distance, un lieu OpenStreetMap de même nom contredit la position publiée. */
export const POSITION_GAP_METERS = 300;
/** En deçà, deux établissements publiés partagent le même point. */
export const DUPLICATE_DISTANCE_METERS = 40;
