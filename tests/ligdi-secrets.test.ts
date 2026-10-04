import { describe, expect, it } from "vitest";

function buildLigdiConfirmUrl(baseUrl: string, invoiceToken: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return `${normalizedBaseUrl}/checkout-invoice/confirm/?invoiceToken=${encodeURIComponent(invoiceToken)}`;
}

const ligdiBaseUrl = process.env.LIGDI_BASE_URL?.trim();
const ligdiApiToken = process.env.LIGDI_API_TOKEN?.trim();
const ligdiApiKey = process.env.LIGDI_API_KEY?.trim();
const describeWithLigdiCredentials = ligdiBaseUrl && ligdiApiToken && ligdiApiKey ? describe : describe.skip;

describeWithLigdiCredentials("ligdi cash secrets", () => {
  it("valide que les secrets Ligdi Cash permettent d’appeler l’API de confirmation sans erreur d’authentification", async () => {
    const response = await fetch(buildLigdiConfirmUrl(ligdiBaseUrl!, "manus-secret-validation"), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Apikey: ligdiApiKey!,
        Authorization: `Bearer ${ligdiApiToken}`,
      },
    });

    expect(response.status, "Le token Ligdi Cash ne doit pas être refusé par l’API").not.toBe(401);
    expect(response.status, "Le token Ligdi Cash ne doit pas être interdit par l’API").not.toBe(403);
  }, 15000);
});
