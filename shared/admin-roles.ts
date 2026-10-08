/**
 * Rôles de la console d'administration et droits par page. Partagé par le serveur (contrôle de
 * chaque requête) et la console (menu, mode lecture seule).
 *
 * Un compte `role = "admin"` sans rôle détaillé (comptes créés avant les rôles) est super-admin.
 */
export const ADMIN_ROLES = ["super_admin", "editor", "support", "viewer"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super-admin",
  editor: "Éditeur d’annuaire",
  support: "Support",
  viewer: "Lecture seule",
};

export const ADMIN_ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  super_admin: "Toutes les pages, y compris les rôles, les formules et la page Système.",
  editor: "Établissements, contributions, gardes, horaires, médicaments, assurances, villes et annonces.",
  support: "Utilisateurs, Premium et paiements, signalements des utilisateurs ; annuaire en lecture.",
  viewer: "Consultation de toutes les pages, sans aucune modification.",
};

/** Zones de droits : une par page de la console. */
export const ADMIN_AREAS = [
  "dashboard",
  "stats",
  "directory",
  "contributions",
  "duty",
  "hours",
  "medicines",
  "insurers",
  "cities",
  "announcements",
  "users",
  "premium",
  "plans",
  "audit",
  "system",
] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];

export type AdminAccess = "write" | "read" | "none";

const EDITOR_AREAS: readonly AdminArea[] = ["directory", "contributions", "duty", "hours", "medicines", "insurers", "cities", "announcements"];
const SUPPORT_AREAS: readonly AdminArea[] = ["users", "premium", "contributions"];

export function adminAccess(role: AdminRole, area: AdminArea): AdminAccess {
  switch (role) {
    case "super_admin":
      return "write";
    case "viewer":
      return "read";
    case "editor":
      if (EDITOR_AREAS.includes(area)) return "write";
      return area === "dashboard" || area === "stats" || area === "audit" ? "read" : "none";
    case "support":
      if (SUPPORT_AREAS.includes(area)) return "write";
      return area === "dashboard" || area === "stats" || area === "directory" || area === "plans" || area === "audit" ? "read" : "none";
  }
}

export function canRead(role: AdminRole, area: AdminArea) {
  return adminAccess(role, area) !== "none";
}

export function canWrite(role: AdminRole, area: AdminArea) {
  return adminAccess(role, area) === "write";
}

/** Rôle effectif d'un compte de la console (null pour un compte utilisateur). */
export function effectiveAdminRole(user: { role: string; adminRole?: string | null }): AdminRole | null {
  if (user.role !== "admin") return null;
  return ADMIN_ROLES.find((role) => role === user.adminRole) ?? "super_admin";
}

/** Droits de chaque zone, envoyés à la console. */
export function adminPermissions(role: AdminRole): Record<AdminArea, AdminAccess> {
  return Object.fromEntries(ADMIN_AREAS.map((area) => [area, adminAccess(role, area)])) as Record<AdminArea, AdminAccess>;
}
