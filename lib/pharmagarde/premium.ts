import { apiCall } from "../_core/api";
import { getAuthorizationHeader, hasSessionToken } from "../_core/auth";

import type { PremiumPlan, PremiumPlanId } from "./premium-plans";

export { PREMIUM_PLANS, type PremiumPlan, type PremiumPlanId } from "./premium-plans";

export type PremiumStatus = {
  isPremium: boolean;
  subscriptionEnd: string | null;
  serverTime: string;
};

export type PaymentInitResponse = {
  reference: string;
  paymentUrl: string;
  plan: PremiumPlan;
  status: "pending";
};

export const PREMIUM_RESULT_LIMIT = 3;

/**
 * Lit la réponse de la route tRPC premium.status. Appelée en mode groupé (`batch=1`) avec superjson,
 * elle a la forme `[{ result: { data: { json: { isPremium, … } } } }]` ; les formes non groupées ou
 * sans superjson sont aussi acceptées.
 */
export function parsePremiumStatusResponse(response: unknown): PremiumStatus {
  let data: unknown = Array.isArray(response) ? response[0] : response;
  const unwrap = (value: unknown, key: string) => (value && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : value);
  data = unwrap(unwrap(unwrap(data, "result"), "data"), "json");
  const record = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return {
    isPremium: record.isPremium === true,
    subscriptionEnd: typeof record.subscriptionEnd === "string" ? record.subscriptionEnd : null,
    serverTime: typeof record.serverTime === "string" ? record.serverTime : new Date().toISOString(),
  };
}

export async function fetchPremiumStatus() {
  const tokenAvailable = await hasSessionToken();
  if (!tokenAvailable) {
    return {
      isPremium: false,
      subscriptionEnd: null,
      serverTime: new Date().toISOString(),
    } satisfies PremiumStatus;
  }

  return parsePremiumStatusResponse(await apiCall<unknown>("/api/trpc/premium.status?batch=1&input=%7B%7D"));
}

export async function initPremiumPayment(planId: PremiumPlanId) {
  const authHeaders = await getAuthorizationHeader();
  if (!authHeaders.Authorization) {
    throw new Error("Connexion requise avant d’initialiser le paiement premium.");
  }

  return apiCall<PaymentInitResponse>("/payment/init", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ planId }),
  });
}

export function limitFreeResults<T>(items: T[], isPremium: boolean) {
  return isPremium ? items : items.slice(0, PREMIUM_RESULT_LIMIT);
}
