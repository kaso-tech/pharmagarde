import { scryptSync, timingSafeEqual, randomBytes } from "crypto";

const PHONE_PATTERN = /^\+226[0-9]{8}$/;
const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/i;
const SCRYPT_KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 8;

type RegisterValidationResult =
  | { ok: true; phone: string; email: string | null; password: string }
  | { ok: false; errors: Record<string, string> };

type LoginValidationResult =
  | { ok: true; identifier: string; password: string; identifierType: "phone" | "email" }
  | { ok: false; errors: Record<string, string> };

function stripDangerousCharacters(value: string) {
  return value.replace(/[<>"'`{}[\]\\]/g, "").trim();
}

export function normalizePhone(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  const trimmed = stripDangerousCharacters(raw);
  const digits = trimmed.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+226")) return `+226${digits.slice(4).replace(/\D/g, "").slice(0, 8)}`;
  const localDigits = digits.replace(/\D/g, "");
  if (localDigits.startsWith("226") && localDigits.length >= 11) return `+${localDigits.slice(0, 11)}`;
  if (localDigits.length === 8) return `+226${localDigits}`;
  return digits;
}

export function normalizeEmail(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  const email = stripDangerousCharacters(raw).toLowerCase();
  return email.length > 0 ? email : null;
}

export function isValidPhone(phone: string) {
  return PHONE_PATTERN.test(phone);
}

export function isValidEmail(email: string) {
  return EMAIL_PATTERN.test(email);
}

export function validateRegisterPayload(payload: unknown): RegisterValidationResult {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password.trim() : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword.trim() : password;
  const errors: Record<string, string> = {};

  if (!phone) errors.phone = "Le téléphone est obligatoire.";
  else if (!isValidPhone(phone)) errors.phone = "Le téléphone doit être au format Burkina Faso, par exemple +22670123456.";

  if (email && !isValidEmail(email)) errors.email = "Adresse email invalide.";

  if (!password) errors.password = "Le mot de passe est obligatoire.";
  else if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;

  if (!confirmPassword) errors.confirmPassword = "La confirmation du mot de passe est obligatoire.";
  else if (password !== confirmPassword) errors.confirmPassword = "La confirmation doit correspondre au mot de passe.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, phone, email, password };
}

export function validateLoginPayload(payload: unknown): LoginValidationResult {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rawIdentifier = typeof body.identifier === "string" ? body.identifier : typeof body.emailOrPhone === "string" ? body.emailOrPhone : typeof body.phone === "string" ? body.phone : typeof body.email === "string" ? body.email : "";
  const trimmedIdentifier = stripDangerousCharacters(rawIdentifier);
  const password = typeof body.password === "string" ? body.password.trim() : "";
  const errors: Record<string, string> = {};
  let identifier = trimmedIdentifier;
  let identifierType: "phone" | "email" = "phone";

  if (!trimmedIdentifier) {
    errors.identifier = "Téléphone ou email obligatoire.";
  } else if (trimmedIdentifier.includes("@")) {
    identifierType = "email";
    identifier = normalizeEmail(trimmedIdentifier) ?? "";
    if (!identifier || !isValidEmail(identifier)) errors.identifier = "Adresse email invalide.";
  } else {
    identifierType = "phone";
    identifier = normalizePhone(trimmedIdentifier);
    if (!isValidPhone(identifier)) errors.identifier = "Téléphone invalide.";
  }

  if (!password) errors.password = "Le mot de passe est obligatoire.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, identifier, password, identifierType };
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) return false;
  const [algorithm, salt, hash] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const stored = Buffer.from(hash, "hex");
  const derived = scryptSync(password, salt, stored.length);
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}

export function buildLocalOpenId(phone: string) {
  return `local:${phone}`;
}
