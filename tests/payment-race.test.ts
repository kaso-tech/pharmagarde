import { describe, expect, it } from "vitest";

import { transactions, users } from "../drizzle/schema";
import { recordPaymentOutcome } from "../server/premium";

// Base factice qui reproduit la sémantique MySQL utile ici : les transactions SQL sont
// sérialisées, et l'UPDATE conditionnel sur `transactions` ne touche la ligne que si son statut
// n'est pas déjà « success » (affectedRows = 0 sinon).
function fakeDatabase() {
  const state = {
    transaction: { id: 1, userId: 7, planId: "month", status: "pending" as string },
    user: { id: 7, subscriptionEnd: null as Date | null },
    extensions: 0,
  };
  let queue = Promise.resolve();

  const tx = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            async where() {
              if (table === transactions) {
                if (state.transaction.status === "success") return [{ affectedRows: 0 }];
                state.transaction.status = String(values.status);
                return [{ affectedRows: 1 }];
              }
              if (table === users) {
                state.user.subscriptionEnd = values.subscriptionEnd as Date;
                state.extensions += 1;
              }
              return [{ affectedRows: 1 }];
            },
          };
        },
      };
    },
    select() {
      return { from: () => ({ where: () => ({ limit: () => ({ for: async () => [state.user] }) }) }) };
    },
  };

  const db = {
    transaction<T>(fn: (t: typeof tx) => Promise<T>): Promise<T> {
      const run = queue.then(() => fn(tx));
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { db: db as never, state };
}

const fields = { providerTransactionId: "tok", rawProviderPayload: "{}" };

describe("S10 · activation Premium idempotente", () => {
  it("deux webhooks simultanés ne prolongent l'abonnement qu'une fois", async () => {
    const { db, state } = fakeDatabase();
    const results = await Promise.all([
      recordPaymentOutcome(db, state.transaction, "success", fields),
      recordPaymentOutcome(db, state.transaction, "success", fields),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(state.extensions).toBe(1);
    const days = ((state.user.subscriptionEnd?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it("un webhook tardif en échec ne rétrograde pas un paiement réussi", async () => {
    const { db, state } = fakeDatabase();
    await recordPaymentOutcome(db, state.transaction, "success", fields);
    const activated = await recordPaymentOutcome(db, state.transaction, "failed", fields);

    expect(activated).toBe(false);
    expect(state.transaction.status).toBe("success");
    expect(state.extensions).toBe(1);
  });

  it("un paiement non confirmé ne prolonge rien", async () => {
    const { db, state } = fakeDatabase();
    expect(await recordPaymentOutcome(db, state.transaction, "pending", fields)).toBe(false);
    expect(state.extensions).toBe(0);
  });
});
