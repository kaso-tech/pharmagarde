// Envoi de SMS via un webhook HTTP générique, pour brancher n'importe quel fournisseur (Africa's
// Talking, Orange, Twilio, passerelle maison…) sans changer le code de l'application.
//
// Requête envoyée : POST SMS_WEBHOOK_URL
//   Content-Type: application/json
//   Authorization: Bearer SMS_WEBHOOK_TOKEN   (si défini)
//   { "to": "+22670123456", "message": "…", "sender": "PharmaGarde" }
// Toute réponse 2xx vaut succès.

export class SmsUnavailableError extends Error {
  constructor(message = "Envoi de SMS indisponible.") {
    super(message);
    this.name = "SmsUnavailableError";
  }
}

export type SmsMessage = { to: string; message: string };

const SMS_TIMEOUT_MS = 10_000;

export async function sendSms({ to, message }: SmsMessage, env: NodeJS.ProcessEnv = process.env) {
  const url = env.SMS_WEBHOOK_URL?.trim();
  if (!url) {
    if (env.NODE_ENV === "production") throw new SmsUnavailableError("SMS_WEBHOOK_URL n'est pas configurée.");
    // Développement : pas de fournisseur, le message est affiché dans la console du serveur.
    console.info(`[SMS dev] à ${to} : ${message}`);
    return;
  }

  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  const token = env.SMS_WEBHOOK_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ to, message, sender: env.SMS_SENDER_NAME?.trim() || "PharmaGarde" }),
      signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SmsUnavailableError(`Webhook SMS injoignable : ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new SmsUnavailableError(`Webhook SMS a répondu ${response.status}.`);
  }
}
