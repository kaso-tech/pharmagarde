import { double, index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
    purpose: mysqlEnum("purpose", ["register", "password_reset"]).notNull(),
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
