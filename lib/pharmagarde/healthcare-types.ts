// Types de structures de santé (hors pharmacies), communs au serveur, à la console et à l'application.

export const HEALTHCARE_TYPES = [
  "CHU",
  "CHR",
  "CMA",
  "CSPS",
  "Clinique",
  "Hôpital",
  "Centre de santé",
  "Cabinet médical",
  "Cabinet de soins infirmiers",
  "Cabinet dentaire",
  "Ophtalmologie",
  "Laboratoire et imagerie",
  "Opticien",
] as const;

export type HealthcareType = (typeof HEALTHCARE_TYPES)[number];

export function isHealthcareType(value: unknown): value is HealthcareType {
  return HEALTHCARE_TYPES.includes(value as HealthcareType);
}

/** Familles proposées en filtre dans l'onglet des structures de santé. */
export const HEALTHCARE_FAMILIES = [
  { key: "hospital", label: "Hôpitaux", types: ["CHU", "CHR", "CMA", "Hôpital"] },
  { key: "clinic", label: "Cliniques", types: ["Clinique"] },
  { key: "centre", label: "CSPS et centres", types: ["CSPS", "Centre de santé"] },
  { key: "office", label: "Cabinets", types: ["Cabinet médical", "Cabinet de soins infirmiers", "Cabinet dentaire"] },
  { key: "eyes", label: "Yeux et optique", types: ["Ophtalmologie", "Opticien"] },
  { key: "lab", label: "Laboratoires", types: ["Laboratoire et imagerie"] },
] as const satisfies readonly { key: string; label: string; types: readonly HealthcareType[] }[];

export type HealthcareFamily = (typeof HEALTHCARE_FAMILIES)[number]["key"];

export function healthcareFamilyOf(type: string | undefined): HealthcareFamily {
  return HEALTHCARE_FAMILIES.find((family) => (family.types as readonly string[]).includes(type ?? ""))?.key ?? "centre";
}
