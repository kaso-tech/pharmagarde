export type PremiumPlanId = "week" | "month" | "quarter" | "semester";

export type PremiumPlan = {
  id: PremiumPlanId;
  label: string;
  amount: number;
  durationDays: number;
};

/** Formules de référence, remplacées par celles publiées par le serveur (`/app-config`). */
export const PREMIUM_PLANS: PremiumPlan[] = [
  { id: "week", label: "1 semaine", amount: 200, durationDays: 7 },
  { id: "month", label: "1 mois", amount: 400, durationDays: 30 },
  { id: "quarter", label: "3 mois", amount: 1000, durationDays: 90 },
  { id: "semester", label: "6 mois", amount: 2000, durationDays: 180 },
];
