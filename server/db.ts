import { eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { randomBytes } from "node:crypto";

import { InsertUser, transactions, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "phone", "passwordHash", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.subscriptionEnd !== undefined) {
      values.subscriptionEnd = user.subscriptionEnd;
      updateSet.subscriptionEnd = user.subscriptionEnd;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByPhone(phone: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user by phone: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user by email: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByPhoneOrEmail(identifier: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user by phone/email: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(or(eq(users.phone, identifier), eq(users.email, identifier)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createLocalAuthUser(user: InsertUser) {
  if (!user.openId || !user.phone || !user.passwordHash) {
    throw new Error("Local auth user requires openId, phone and passwordHash");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("DATABASE_UNAVAILABLE");
  }

  await db.insert(users).values(user);
  return getUserByOpenId(user.openId);
}

/**
 * Supprime un compte à la demande de l'utilisateur. Les données personnelles (téléphone, e-mail,
 * nom, mot de passe, identifiant de connexion) sont effacées ; la ligne est conservée sous un
 * identifiant anonyme pour que les paiements restent rattachés à une pièce comptable (obligation
 * de conservation), sans plus pointer vers une personne. Les sessions existantes deviennent
 * invalides car leur openId n'existe plus.
 */
export async function deleteUserAccount(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        openId: `deleted:${userId}:${randomBytes(8).toString("hex")}`,
        name: null,
        email: null,
        phone: null,
        passwordHash: null,
        loginMethod: "deleted",
        role: "user",
        subscriptionEnd: null,
      })
      .where(eq(users.id, userId));
    // La réponse brute du prestataire peut contenir des coordonnées du payeur : on ne garde que
    // les champs comptables (offre, montant, statut, références).
    await tx.update(transactions).set({ rawProviderPayload: null, paymentUrl: null }).where(eq(transactions.userId, userId));
  });
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}
