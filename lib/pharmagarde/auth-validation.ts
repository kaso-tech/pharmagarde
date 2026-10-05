export type RegisterForm = {
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export type LoginForm = {
  identifier: string;
  password: string;
};

export type RegisterErrors = Partial<Record<keyof RegisterForm, string>>;
export type LoginErrors = Partial<Record<keyof LoginForm, string>>;

const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/i;
const PHONE_PATTERN = /^\+226[0-9]{8}$/;
export const MIN_PASSWORD_LENGTH = 8;

export function sanitizeInput(value: string) {
  return value.replace(/[<>"'`{}[\]\\]/g, "").trim();
}

export function normalizePhone(value: string) {
  const cleaned = sanitizeInput(value);
  const digits = cleaned.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+226")) return `+226${digits.slice(4).replace(/\D/g, "").slice(0, 8)}`;
  const localDigits = digits.replace(/\D/g, "");
  if (localDigits.startsWith("226") && localDigits.length >= 11) return `+${localDigits.slice(0, 11)}`;
  if (localDigits.length === 8) return `+226${localDigits}`;
  return digits;
}

export function formatBurkinaPhone(value: string) {
  const normalized = normalizePhone(value);
  const local = normalized.startsWith("+226") ? normalized.slice(4) : normalized.replace(/\D/g, "");
  return local.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

export function normalizeEmail(value: string) {
  const email = sanitizeInput(value).toLowerCase();
  return email.length > 0 ? email : "";
}

export function normalizeIdentifier(value: string) {
  const cleaned = sanitizeInput(value);
  return cleaned.includes("@") ? normalizeEmail(cleaned) : normalizePhone(cleaned);
}

export function isValidPhone(phone: string) {
  return PHONE_PATTERN.test(phone);
}

export function isValidEmail(email: string) {
  return EMAIL_PATTERN.test(email);
}

export function validateRegisterForm(form: RegisterForm): RegisterErrors {
  const phone = normalizePhone(form.phone);
  const email = normalizeEmail(form.email);
  const password = form.password.trim();
  const confirmPassword = form.confirmPassword.trim();
  const errors: RegisterErrors = {};

  if (!phone) errors.phone = "Téléphone obligatoire.";
  else if (!isValidPhone(phone)) errors.phone = "Numéro burkinabè invalide. Exemple : 70 12 34 56.";

  if (email && !isValidEmail(email)) errors.email = "Adresse email invalide.";

  if (!password) errors.password = "Mot de passe obligatoire.";
  else if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;

  if (!confirmPassword) errors.confirmPassword = "Confirmation obligatoire.";
  else if (password !== confirmPassword) errors.confirmPassword = "La confirmation doit correspondre au mot de passe.";

  return errors;
}

export function validateLoginForm(form: LoginForm): LoginErrors {
  const identifier = sanitizeInput(form.identifier);
  const password = form.password.trim();
  const errors: LoginErrors = {};

  if (!identifier) errors.identifier = "Téléphone ou email obligatoire.";
  else if (identifier.includes("@")) {
    if (!isValidEmail(normalizeEmail(identifier))) errors.identifier = "Adresse email invalide.";
  } else if (!isValidPhone(normalizePhone(identifier))) {
    errors.identifier = "Téléphone invalide.";
  }

  if (!password) errors.password = "Mot de passe obligatoire.";

  return errors;
}

export function hasNoErrors(errors: Record<string, string | undefined>) {
  return Object.values(errors).every((value) => !value);
}
