import { index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
export type VerificationCode = typeof verificationCodes.$inferSelect;
