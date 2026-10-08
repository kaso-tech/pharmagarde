import { useEffect, useState } from "react";

import type { IconName } from "./ui";
import type { Tone } from "./theme";

export type AdminSection = "dashboard" | "directory" | "contributions" | "duty" | "hours" | "users" | "premium" | "medicines" | "insurers" | "cities" | "announcements" | "plans" | "audit" | "system" | "account";

export const PAGE_SIZE = 50;

export const NAV_GROUPS: readonly { label: string; items: readonly { section: AdminSection; href: string; label: string; icon: IconName }[] }[] = [
  { label: "Pilotage", items: [{ section: "dashboard", href: "/admin", label: "Tableau de bord", icon: "space-dashboard" }] },
  {
    label: "Annuaire",
    items: [
      { section: "directory", href: "/admin/annuaire", label: "Établissements", icon: "local-pharmacy" },
      { section: "contributions", href: "/admin/contributions", label: "Contributions", icon: "inbox" },
      { section: "duty", href: "/admin/gardes", label: "Gardes", icon: "event-available" },
      { section: "hours", href: "/admin/horaires", label: "Horaires", icon: "schedule" },
    ],
  },
  {
    label: "Contenus",
    items: [
      { section: "medicines", href: "/admin/medicaments", label: "Médicaments", icon: "medication" },
      { section: "insurers", href: "/admin/assurances", label: "Assurances", icon: "health-and-safety" },
      { section: "cities", href: "/admin/villes", label: "Villes", icon: "location-city" },
      { section: "announcements", href: "/admin/annonces", label: "Annonces", icon: "campaign" },
    ],
  },
  {
    label: "Comptes",
    items: [
      { section: "users", href: "/admin/utilisateurs", label: "Utilisateurs", icon: "group" },
      { section: "premium", href: "/admin/abonnements", label: "Premium", icon: "workspace-premium" },
      { section: "plans", href: "/admin/formules", label: "Formules et prix", icon: "sell" },
    ],
  },
  { label: "Système", items: [{ section: "audit", href: "/admin/journal", label: "Journal d’audit", icon: "history" }, { section: "system", href: "/admin/systeme", label: "Système", icon: "dns" }] },
];

export const SECTION_TITLES: Record<AdminSection, string> = {
  dashboard: "Tableau de bord",
  directory: "Annuaire",
  contributions: "Contributions",
  duty: "Gardes",
  hours: "Horaires",
  users: "Utilisateurs",
  premium: "Premium",
  medicines: "Médicaments",
  insurers: "Assurances",
  cities: "Villes",
  announcements: "Annonces",
  plans: "Formules et prix",
  audit: "Journal d’audit",
  system: "Système",
  account: "Mon compte",
};

export const SECTION_SUBTITLES: Record<AdminSection, string> = {
  dashboard: "Vue d’ensemble des comptes, des paiements et de l’annuaire.",
  directory: "Pharmacies et structures de santé publiées dans l’application.",
  contributions: "Établissements proposés et erreurs signalées depuis l’application, à vérifier avant publication.",
  duty: "Groupe de garde de chaque ville. La garde change chaque samedi à 8 h.",
  hours: "Horaires de service par ville, fixés par l’ONPBF. Une pharmacie de garde est ouverte 24 h/24.",
  users: "Comptes inscrits, vérification du téléphone et abonnement.",
  premium: "Paiements Ligdi Cash, Premium offerts et abonnements associés.",
  medicines: "Catalogue des médicaments et produits essentiels consulté par les abonnés : prix, unités, catégories, produits masqués.",
  insurers: "Assurances santé que les établissements peuvent accepter (tiers payant).",
  cities: "Villes proposées dans l’application : centre utilisé pour la carte et la recherche, publication.",
  announcements: "Bandeaux d’information affichés en haut de l’accueil de l’application, pour toutes les villes ou une seule.",
  plans: "Durées, prix et formules Premium proposés dans l’application.",
  audit: "Actions réalisées dans la console d’administration.",
  system: "État du serveur, de la base de données, des services et des données publiées.",
  account: "Vos informations de connexion et votre mot de passe.",
};

export const PLAN_LABELS: Record<string, string> = {
  week: "1 semaine",
  month: "1 mois",
  quarter: "3 mois",
  semester: "6 mois",
  offered: "Offert (console)",
};

export const TRANSACTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  success: { label: "Payé", tone: "success" },
  pending: { label: "En attente", tone: "warning" },
  failed: { label: "Échoué", tone: "danger" },
  cancelled: { label: "Annulé", tone: "neutral" },
};

export const AUDIT_ACTIONS: Record<string, string> = {
  "directory.upserted": "Fiche enregistrée",
  "directory.archived": "Fiche archivée",
  "directory.restored": "Fiche restaurée",
  "admin.dashboard.viewed": "Consultation du tableau de bord",
  "admin.directory.viewed": "Consultation de l’annuaire",
  "admin.duty.viewed": "Consultation des gardes",
  "admin.hours.viewed": "Consultation des horaires",
  "city_hours.updated": "Horaires de ville modifiés",
  "city_hours.reset": "Horaires de ville rétablis",
  "admin.users.viewed": "Consultation des utilisateurs",
  "admin.premium.viewed": "Consultation des paiements",
  "admin.audit.viewed": "Consultation du journal",
  "admin.system.viewed": "Consultation de l’état du système",
  "admin.account.viewed": "Consultation de mon compte",
  "account.updated": "Profil modifié",
  "account.password_changed": "Mot de passe modifié",
  "users.premium_granted": "Premium offert",
  "users.premium_revoked": "Premium retiré",
  "admin.contributions.viewed": "Consultation des contributions",
  "contribution.accepted": "Proposition publiée",
  "contribution.rejected": "Contribution refusée",
  "contribution.resolved": "Signalement résolu",
  "users.suspended": "Compte suspendu",
  "users.reactivated": "Compte réactivé",
  "users.sessions_revoked": "Appareils déconnectés",
  "users.role_changed": "Rôle modifié",
  "users.deleted": "Compte supprimé",
  "premium.rechecked": "Paiement revérifié",
  "premium.resolved": "Paiement réglé à la main",
  "duty.rotation_saved": "Programmation des gardes modifiée",
  "duty.rotation_reset": "Programmation des gardes rétablie",
  "duty.exception_added": "Exception de garde ajoutée",
  "duty.exception_removed": "Exception de garde supprimée",
  "directory.imported": "Import Excel de l’annuaire",
  "data.refreshed": "Données mises à jour",
  "admin.medicines.viewed": "Consultation des médicaments",
  "admin.insurers.viewed": "Consultation des assurances",
  "admin.cities.viewed": "Consultation des villes",
  "admin.announcements.viewed": "Consultation des annonces",
  "admin.plans.viewed": "Consultation des formules",
  "medicines.updated": "Produit modifié",
  "medicines.added": "Produit ajouté",
  "medicines.hidden": "Produit masqué",
  "medicines.shown": "Produit republié",
  "medicines.reset": "Produit rétabli",
  "medicines.deleted": "Produit supprimé",
  "medicines.category_renamed": "Catégorie renommée",
  "medicines.imported": "Import Excel des médicaments",
  "insurers.added": "Assureur ajouté",
  "insurers.updated": "Assureur modifié",
  "insurers.reset": "Assureur rétabli",
  "insurers.deleted": "Assureur supprimé",
  "cities.added": "Ville ajoutée",
  "cities.updated": "Ville modifiée",
  "cities.reset": "Ville rétablie",
  "cities.deleted": "Ville retirée",
  "announcements.created": "Annonce créée",
  "announcements.updated": "Annonce modifiée",
  "announcements.deleted": "Annonce supprimée",
  "plans.updated": "Formule modifiée",
  "plans.reset": "Formule rétablie",
};

export const AUDIT_TARGETS: Record<string, string> = {
  pharmacy: "Pharmacie",
  healthcare: "Structure de santé",
  admin_console: "Console",
  city: "Ville",
  user: "Utilisateur",
  contribution: "Contribution",
  transaction: "Transaction",
  medicine: "Médicament",
  medicine_category: "Catégorie",
  insurer: "Assureur",
  announcement: "Annonce",
  plan: "Formule",
};

export function auditActionLabel(action: string) {
  return AUDIT_ACTIONS[action] ?? action;
}

export function auditTone(action: string): Tone {
  if (action.includes("archived") || action.includes("revoked") || action.includes("suspended") || action.includes("deleted") || action.includes("rejected") || action.includes("hidden")) return "danger";
  if (action.includes("viewed")) return "neutral";
  if (action.includes("premium")) return "info";
  return "brand";
}

export function auditIcon(action: string): IconName {
  if (action.includes("archived")) return "archive";
  if (action.includes("restored")) return "unarchive";
  if (action.includes("viewed")) return "visibility";
  if (action.includes("password")) return "lock";
  if (action.includes("premium")) return "workspace-premium";
  if (action.includes("hours")) return "schedule";
  if (action.includes("hidden")) return "visibility-off";
  if (action.includes("imported")) return "upload-file";
  if (action.startsWith("medicines")) return "medication";
  if (action.startsWith("announcements")) return "campaign";
  if (action.startsWith("plans")) return "sell";
  return "edit";
}

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatDate(value: string | null | undefined) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date) : "—";
}

export function formatDay(value: string | null | undefined) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(date) : "—";
}

/** Date et heure de relève, en heure du Burkina Faso (UTC+0). */
export function formatDutyDate(value: string) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date) : "—";
}

export function formatDutyDay(value: string) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(date) : "—";
}

/** Durée relative courte : « il y a 5 min », « il y a 3 j ». */
export function formatRelative(value: string | null | undefined, now = Date.now()) {
  const date = toDate(value);
  if (!date) return "—";
  const minutes = Math.round((now - date.getTime()) / 60_000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `il y a ${days} j` : formatDay(value);
}

export function formatXof(value: number) {
  return `${value.toLocaleString("fr-FR")} F CFA`;
}

export function formatCount(value: number) {
  return value.toLocaleString("fr-FR");
}

export function displayIdentity(input: { name?: string | null; phone?: string | null; email?: string | null; id?: number | null }) {
  return input.name || input.phone || input.email || (input.id ? `Utilisateur #${input.id}` : "Utilisateur inconnu");
}

export function isActiveSubscription(value: string | null | undefined, now = Date.now()) {
  return !!value && new Date(value).getTime() > now;
}

/** Valeur mise à jour après une pause de saisie, pour ne pas interroger le serveur à chaque frappe. */
export function useDebouncedValue<T>(value: T, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Numéro de page remis à 1 dès que les filtres changent. */
export function usePage(filtersKey: string) {
  const [state, setState] = useState({ key: filtersKey, page: 1 });
  const page = state.key === filtersKey ? state.page : 1;
  return [page, (next: number) => setState({ key: filtersKey, page: next })] as const;
}

export function numberOrNull(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}
