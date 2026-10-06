import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ui = readFileSync("components/admin/admin-console.tsx", "utf8");
const router = readFileSync("server/admin.ts", "utf8");

describe("console admin · contrat UI/API", () => {
  it("expose les cinq espaces et leurs états de chargement, erreur et refus", () => {
    for (const label of ["Tableau de bord", "Annuaire", "Utilisateurs", "Premium", "Journal d’audit", "Chargement…", "Accès administrateur refusé"]) {
      expect(ui).toContain(label);
    }
  });

  it("conserve un tiroir gauche mobile sans retour vers l’application et une déconnexion dédiée", () => {
    expect(ui).toContain("left: 0");
    expect(ui).toContain("Se déconnecter");
    expect(ui).not.toContain("Retour à l’app");
  });

  it("protège les procédures côté serveur et ne révèle pas la charge brute de paiement", () => {
    expect(router).toContain("adminProcedure");
    expect(router).toContain("directoryArchiveSchema");
    expect(router).toContain("directory.archived");
    expect(router).toContain("auditLogs");
    expect(router).not.toContain("rawProviderPayload");
    expect(router).not.toContain("paymentUrl:");
    expect(router).not.toContain("providerTransactionId:");
  });

  it("requiert une confirmation contrôlée avant archivage", () => {
    expect(ui).toContain("Archiver l’établissement");
    expect(ui).toContain("Cette action sera journalisée");
    expect(ui).toContain("directory.archive.useMutation");
    expect(ui).toContain("confirmArchive: true");
    expect(router).toContain('code: "NOT_FOUND"');
  });

  it("réutilise la confirmation de déconnexion et affiche la date de vérification", () => {
    expect(ui).toContain("SignOutConfirmationModal");
    expect(ui).toContain("Vérification :");
  });
});
