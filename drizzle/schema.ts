import { boolean, datetime, double, index, int, mysqlEnum, mysqlTable, primaryKey, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }).unique(),
  passwordHash: text("passwordHash"),
  /** Date de vérification du numéro par code SMS ; null pour les comptes créés avant cette vérification. */
  phoneVerifiedAt: timestamp("phoneVerifiedAt"),
  /** Les jetons de session émis avant cette date sont refusés (déconnexion de tous les appareils). */
  sessionsValidAfter: timestamp("sessionsValidAfter"),
  /** Compte suspendu depuis la console : connexion et sessions refusées tant que la date est renseignée. */
  suspendedAt: timestamp("suspendedAt"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** Subscription end date. A user is premium only when this value is in the future. */
  subscriptionEnd: timestamp("subscriptionEnd"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const transactions = mysqlTable("transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  provider: varchar("provider", { length: 64 }).default("ligdicash").notNull(),
  providerTransactionId: varchar("providerTransactionId", { length: 128 }),
  merchantReference: varchar("merchantReference", { length: 128 }).notNull().unique(),
  planId: varchar("planId", { length: 32 }).notNull(),
  amount: int("amount").notNull(),
  currency: varchar("currency", { length: 8 }).default("XOF").notNull(),
  status: mysqlEnum("status", ["pending", "success", "failed", "cancelled"]).default("pending").notNull(),
  paymentUrl: text("paymentUrl"),
  rawProviderPayload: text("rawProviderPayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Surcharges administratives de l'annuaire versionné et du cache établissements.
 * Une ligne archived masque l'élément source sans effacer son historique.
 */
export const directoryEntries = mysqlTable(
  "directory_entries",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    kind: mysqlEnum("kind", ["pharmacy", "healthcare"]).notNull(),
    status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
    city: varchar("city", { length: 96 }),
    name: varchar("name", { length: 255 }),
    phone: varchar("phone", { length: 40 }),
    address: text("address"),
    latitude: double("latitude"),
    longitude: double("longitude"),
    dutyGroup: int("dutyGroup"),
    establishmentType: varchar("establishmentType", { length: 64 }),
    /** Horaires de service propres (JSON, voir lib/pharmagarde/opening-hours.ts) ; null = horaires de la ville. */
    openingHours: text("openingHours"),
    /** Assurances acceptées (JSON, identifiants de lib/pharmagarde/insurances.ts). */
    insurances: text("insurances"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("directory_entries_kind_city_idx").on(table.kind, table.city), index("directory_entries_status_idx").on(table.status)],
);

/** Journal des accès administratifs et des mutations sensibles, sans secret ni charge de paiement. */
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    actorUserId: int("actorUserId").notNull().references(() => users.id),
    action: varchar("action", { length: 96 }).notNull(),
    targetType: varchar("targetType", { length: 64 }).notNull(),
    targetId: varchar("targetId", { length: 128 }),
    metadata: text("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt), index("audit_logs_action_created_idx").on(table.action, table.createdAt)],
);

/**
 * Codes à usage unique envoyés par SMS (vérification du numéro à l'inscription, réinitialisation du
 * mot de passe). Seul un HMAC du code est stocké.
 */
export const verificationCodes = mysqlTable(
  "verification_codes",
  {
    id: int("id").autoincrement().primaryKey(),
    phone: varchar("phone", { length: 32 }).notNull(),
    purpose: mysqlEnum("purpose", ["register", "password_reset", "admin_login"]).notNull(),
    codeHash: varchar("codeHash", { length: 128 }).notNull(),
    attempts: int("attempts").default(0).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("verification_codes_phone_purpose_idx").on(table.phone, table.purpose)],
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;
export type DirectoryEntry = typeof directoryEntries.$inferSelect;
export type InsertDirectoryEntry = typeof directoryEntries.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type VerificationCode = typeof verificationCodes.$inferSelect;

/** Horaires de service d'une ville (fixés par l'ONPBF), modifiables depuis la console d'administration. */
export const cityHours = mysqlTable("city_hours", {
  /** Nom de la ville tel qu'il apparaît dans l'annuaire, ex. « Ouagadougou ». */
  city: varchar("city", { length: 96 }).primaryKey(),
  /** Horaires hebdomadaires (JSON, voir lib/pharmagarde/opening-hours.ts). */
  openingHours: text("openingHours").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CityHours = typeof cityHours.$inferSelect;

/**
 * Contributions envoyées depuis l'application : proposition d'un nouvel établissement ou
 * signalement d'une erreur, à traiter dans la console (file de modération).
 */
export const contributions = mysqlTable(
  "contributions",
  {
    id: int("id").autoincrement().primaryKey(),
    kind: mysqlEnum("kind", ["new_place", "problem"]).notNull(),
    status: mysqlEnum("status", ["new", "accepted", "rejected", "resolved"]).default("new").notNull(),
    /** Auteur connecté, s'il y en a un (les contributions anonymes sont acceptées). */
    userId: int("userId"),
    city: varchar("city", { length: 96 }),
    placeKind: mysqlEnum("placeKind", ["pharmacy", "healthcare"]),
    /** Établissement concerné par un signalement, ou fiche créée à l'acceptation d'une proposition. */
    placeId: varchar("placeId", { length: 128 }),
    name: varchar("name", { length: 255 }),
    phone: varchar("phone", { length: 40 }),
    address: text("address"),
    latitude: double("latitude"),
    longitude: double("longitude"),
    /** Horaires proposés (JSON, voir lib/pharmagarde/opening-hours.ts). */
    openingHours: text("openingHours"),
    category: varchar("category", { length: 96 }),
    subject: varchar("subject", { length: 255 }),
    message: text("message"),
    adminNote: text("adminNote"),
    handledBy: int("handledBy"),
    handledAt: timestamp("handledAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("contributions_status_kind_idx").on(table.status, table.kind, table.createdAt)],
);

export type Contribution = typeof contributions.$inferSelect;
export type InsertContribution = typeof contributions.$inferInsert;

/**
 * Programmation des gardes d'une ville saisie dans la console. Remplace la programmation par défaut
 * de server/duty-roster.ts pour cette ville ; « off » la désactive.
 */
export const dutyRotations = mysqlTable("duty_rotations", {
  city: varchar("city", { length: 96 }).primaryKey(),
  mode: mysqlEnum("mode", ["groups", "lists", "off"]).notNull(),
  /** Nombre de groupes (mode « groups »). */
  groupCount: int("groupCount"),
  /** Samedi de début d'une semaine connue (AAAA-MM-JJ). */
  referenceStart: varchar("referenceStart", { length: 10 }).notNull(),
  /** Tour de garde de cette semaine, à partir de 0. */
  referenceTurnIndex: int("referenceTurnIndex").notNull(),
  /** Listes de pharmacies par tour (mode « lists », JSON [{ label, pharmacyIds }]). */
  turns: text("turns"),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Exception ponctuelle à la garde d'une semaine : pharmacie ajoutée ou retirée (fermeture, échange). */
export const dutyExceptions = mysqlTable(
  "duty_exceptions",
  {
    id: int("id").autoincrement().primaryKey(),
    city: varchar("city", { length: 96 }).notNull(),
    /** Samedi de début de la semaine concernée (AAAA-MM-JJ). */
    weekStart: varchar("weekStart", { length: 10 }).notNull(),
    pharmacyId: varchar("pharmacyId", { length: 128 }).notNull(),
    action: mysqlEnum("action", ["add", "remove"]).notNull(),
    note: varchar("note", { length: 255 }),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("duty_exceptions_week_idx").on(table.weekStart, table.city)],
);

export type DutyRotationRow = typeof dutyRotations.$inferSelect;
export type DutyExceptionRow = typeof dutyExceptions.$inferSelect;

/**
 * Modification d'un produit du catalogue des médicaments (server/data/medicines.json) ou produit
 * ajouté depuis la console. `data` contient les champs modifiés (JSON partiel d'un Medicine).
 */
export const medicineOverrides = mysqlTable("medicine_overrides", {
  id: varchar("id", { length: 160 }).primaryKey(),
  data: text("data").notNull(),
  hidden: boolean("hidden").default(false).notNull(),
  /** Produit absent du catalogue versionné (ajouté depuis la console). */
  added: boolean("added").default(false).notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Intitulé corrigé d'une catégorie ou sous-catégorie du catalogue des médicaments. */
export const medicineCategoryLabels = mysqlTable(
  "medicine_category_labels",
  {
    id: int("id").autoincrement().primaryKey(),
    level: mysqlEnum("level", ["category", "subcategory"]).notNull(),
    original: varchar("original", { length: 255 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    updatedBy: int("updatedBy"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [uniqueIndex("medicine_category_labels_original_idx").on(table.level, table.original)],
);

/** Assureur ajouté, renommé ou désactivé depuis la console (complète la liste de référence). */
export const insurers = mysqlTable("insurers", {
  id: varchar("id", { length: 48 }).primaryKey(),
  label: varchar("label", { length: 96 }).notNull(),
  active: boolean("active").default(true).notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Ville couverte ajoutée ou modifiée depuis la console (centre, alias, publication). */
export const cities = mysqlTable("cities", {
  name: varchar("name", { length: 96 }).primaryKey(),
  latitude: double("latitude").notNull(),
  longitude: double("longitude").notNull(),
  /** Autres noms reconnus (JSON de chaînes). */
  aliases: text("aliases"),
  published: boolean("published").default(true).notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Bandeau d'information affiché dans l'application, pour toutes les villes ou une seule. */
export const announcements = mysqlTable("announcements", {
  id: int("id").autoincrement().primaryKey(),
  /** Ville ciblée ; null pour toutes les villes. */
  city: varchar("city", { length: 96 }),
  title: varchar("title", { length: 120 }).notNull(),
  body: varchar("body", { length: 600 }).notNull(),
  tone: mysqlEnum("tone", ["info", "warning", "danger"]).default("info").notNull(),
  startsAt: datetime("startsAt", { mode: "date" }).notNull(),
  endsAt: datetime("endsAt", { mode: "date" }),
  active: boolean("active").default(true).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Libellé, prix, durée et visibilité d'une formule Premium (remplace la valeur par défaut). */
export const premiumPlans = mysqlTable("premium_plans", {
  id: varchar("id", { length: 32 }).primaryKey(),
  label: varchar("label", { length: 64 }).notNull(),
  amount: int("amount").notNull(),
  durationDays: int("durationDays").notNull(),
  active: boolean("active").default(true).notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MedicineOverrideRow = typeof medicineOverrides.$inferSelect;
export type MedicineCategoryLabelRow = typeof medicineCategoryLabels.$inferSelect;
export type InsurerRow = typeof insurers.$inferSelect;
export type CityRow = typeof cities.$inferSelect;
export type AnnouncementRow = typeof announcements.$inferSelect;
export type PremiumPlanRow = typeof premiumPlans.$inferSelect;

/**
 * Rôle détaillé d'un compte « admin » dans la console. Sans ligne, le compte est super-admin
 * (comptes créés avant les rôles). Table séparée : la lecture des comptes ne dépend pas de cette
 * migration.
 */
export const adminRoles = mysqlTable("admin_roles", {
  userId: int("userId").primaryKey(),
  role: mysqlEnum("role", ["super_admin", "editor", "support", "viewer"]).notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Accès à la console d'un appareil, ouvert après le code SMS (double facteur). Lié au jeton de
 * session par son empreinte SHA-256 : le jeton lui-même n'est jamais enregistré.
 */
export const adminSessions = mysqlTable(
  "admin_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    userAgent: varchar("userAgent", { length: 255 }),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
  },
  (table) => [uniqueIndex("admin_sessions_token_idx").on(table.tokenHash), index("admin_sessions_user_idx").on(table.userId)],
);

/** Compteurs d'usage anonymes de l'application, agrégés par jour, ville et événement. */
export const usageDaily = mysqlTable(
  "usage_daily",
  {
    day: varchar("day", { length: 10 }).notNull(),
    city: varchar("city", { length: 96 }).notNull(),
    event: varchar("event", { length: 32 }).notNull(),
    count: int("count").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.city, table.event] })],
);

export type AdminRoleRow = typeof adminRoles.$inferSelect;
export type AdminSessionRow = typeof adminSessions.$inferSelect;
export type UsageDailyRow = typeof usageDaily.$inferSelect;
