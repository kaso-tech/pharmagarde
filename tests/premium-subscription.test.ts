import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { calculateSubscriptionEnd, getPremiumStatusForUser, isSubscriptionActive, PREMIUM_PLANS } from "../server/premium";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("abonnement premium backend", () => {
  it("déclare les quatre offres Ligdi Cash demandées avec montants XOF et durées attendues", () => {
    expect(PREMIUM_PLANS).toMatchObject({
      week: { label: "1 semaine", amount: 200, durationDays: 7 },
      month: { label: "1 mois", amount: 400, durationDays: 30 },
      quarter: { label: "3 mois", amount: 1000, durationDays: 90 },
      semester: { label: "6 mois", amount: 2000, durationDays: 180 },
    });
  });

  it("calcule l’expiration depuis maintenant ou prolonge un abonnement actif existant", () => {
    const now = new Date("2026-05-01T00:00:00.000Z");
    expect(calculateSubscriptionEnd(null, "week", now).toISOString()).toBe("2026-05-08T00:00:00.000Z");
    expect(calculateSubscriptionEnd("2026-05-10T00:00:00.000Z", "month", now).toISOString()).toBe("2026-06-09T00:00:00.000Z");
    expect(calculateSubscriptionEnd("2026-04-01T00:00:00.000Z", "quarter", now).toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("considère premium uniquement une date subscriptionEnd future validée côté serveur", () => {
    const now = new Date("2026-05-01T12:00:00.000Z");
    expect(isSubscriptionActive("2026-05-01T12:00:01.000Z", now)).toBe(true);
    expect(isSubscriptionActive("2026-05-01T12:00:00.000Z", now)).toBe(false);
    expect(getPremiumStatusForUser({ subscriptionEnd: new Date("2026-04-30T00:00:00.000Z") }, now)).toMatchObject({
      isPremium: false,
      serverTime: "2026-05-01T12:00:00.000Z",
    });
  });

  it("expose les routes /payment/init, /payment/webhook et le statut premium côté serveur", () => {
    const entry = read("server/_core/index.ts");
    const routers = read("server/routers.ts");
    expect(entry).toContain('app.post("/payment/init", paymentInitRateLimit, initPremiumPayment)');
    expect(entry).toContain('app.get("/pharmagarde/abonnement", handlePremiumPaymentReturn)');
    expect(entry).toContain('app.post("/payment/callback", handleLigdiCashWebhook)');
    expect(entry).toContain('app.post("/payment/webhook", handleLigdiCashWebhook)');
    expect(routers).toContain("premium: router");
    expect(routers).toContain("status: protectedProcedure");
    expect(routers).toContain("assertAccess: protectedProcedure");
  });

  it("persiste users.subscriptionEnd et une table transactions complète pour ne pas dépendre du frontend", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("subscriptionEnd: timestamp(\"subscriptionEnd\")");
    expect(schema).toContain("export const transactions = mysqlTable(\"transactions\"");
    expect(schema).toContain("userId: int(\"userId\")");
    expect(schema).toContain("providerTransactionId: varchar(\"providerTransactionId\"");
    expect(schema).toContain("planId: varchar(\"planId\"");
    expect(schema).toContain("provider: varchar(\"provider\"");
    expect(schema).toContain("merchantReference: varchar(\"merchantReference\"");
    expect(schema).toContain("status: mysqlEnum(\"status\", [\"pending\", \"success\", \"failed\", \"cancelled\"])");
    expect(schema).not.toContain("userld");
  });

  it("migre transactions avec les mêmes noms de colonnes camelCase que le code d’insertion", () => {
    const migration = read("drizzle/0003_last_nightcrawler.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `transactions`");
    expect(migration).toContain("`userId` int NOT NULL");
    expect(migration).toContain("`planId` varchar(32) NOT NULL");
    expect(migration).toContain("`providerTransactionId` varchar(128)");
    expect(migration).not.toContain("`userld`");
    expect(migration).not.toContain("ADD `phone`");
    expect(migration).not.toContain("ADD `passwordHash`");
    expect(migration).not.toContain("ADD `subscriptionEnd`");
  });

  it("valide /payment/init avec le header Authorization Bearer avant de refuser l’abonnement", () => {
    const premium = read("server/premium.ts");
    expect(premium).toContain("req.headers?.authorization");
    expect(premium).toContain("extractBearerToken(req)");
    expect(premium).toContain("sdk.authenticateRequest(req)");
    expect(premium).toContain("[PremiumAuth] Token reçu sur route protégée");
    expect(premium).toContain("hasBearerToken");
  });

  it("gère le retour GET /pharmagarde/abonnement sans route inexistante", () => {
    const premium = read("server/premium.ts");
    expect(premium).toContain("export async function handlePremiumPaymentReturn");
    expect(premium).toContain("req.query.paymentReference");
    expect(premium).toContain("req.query.reference");
    expect(premium).toContain("req.query.mode");
    expect(premium).toContain("[PremiumPaymentReturn] Retour paiement reçu");
    expect(premium).toContain("PHARMAGARDE_PAYMENT_RETURN_DEEP_LINK");
    expect(premium).toContain("Retour de paiement reçu");
  });

  it("supprime le mode mock et exige les variables Ligdi Cash réelles", () => {
    const premium = read("server/premium.ts");
    expect(premium).toContain("process.env.LIGDI_BASE_URL");
    expect(premium).toContain("process.env.LIGDI_API_TOKEN");
    expect(premium).toContain("Configuration Ligdi Cash incomplète");
    expect(premium).not.toContain("mode: \"mock\"");
    expect(premium).not.toContain("ligdicash-mock");
    expect(premium).not.toContain("LIGDICASH_AUTH_TOKEN");
    expect(premium).not.toContain("LIGDICASH_API_URL");
  });

  it("crée une facture Ligdi Cash réelle avec callback_url et return_url", () => {
    const premium = read("server/premium.ts");
    expect(premium).toContain("/checkout-invoice/create");
    expect(premium).toContain("callback_url: input.callbackUrl");
    expect(premium).toContain("return_url: input.returnUrl");
    expect(premium).toContain("custom_data: { reference: input.reference, transaction_id: input.reference }");
    expect(premium).toContain("const callbackUrl = `${publicUrls.apiUrl}/payment/callback`");
  });

  it("vérifie le statut auprès de Ligdi Cash avant toute activation d’abonnement", () => {
    const premium = read("server/premium.ts");
    expect(premium).toContain("async function verifyLigdiCashPayment");
    expect(premium).toContain("/checkout-invoice/confirm/");
    expect(premium).toContain("invoiceToken=${encodeURIComponent(input.invoiceToken)}");
    expect(premium).toContain("const verification = await verifyLigdiCashPayment");
    expect(premium).toContain('const status: TransactionStatus = verification.confirmed ? "success"');
    expect(premium).toContain('if (status === "success" && transaction.status !== "success")');
    expect(premium).not.toContain("isSuccessfulLigdiCashStatus(payload)");
  });
});
