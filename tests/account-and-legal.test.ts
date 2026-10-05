import { readFileSync } from "node:fs";

import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashPassword } from "../server/_core/local-auth";

const authenticateRequest = vi.fn();
const deleteUserAccount = vi.fn();

vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: (req: Request) => authenticateRequest(req) } }));
vi.mock("../server/db", () => ({ deleteUserAccount: (id: number) => deleteUserAccount(id) }));

const { registerAccountRoutes, renderLegalPage } = await import("../server/account");

type Handler = (req: Request, res: Response, next: () => void) => unknown;

function collectRoutes() {
  const routes: Record<string, Handler[]> = {};
  const app = {
    get: (path: string, ...handlers: Handler[]) => (routes[`GET ${path}`] = handlers),
    post: (path: string, ...handlers: Handler[]) => (routes[`POST ${path}`] = handlers),
  };
  registerAccountRoutes(app as never);
  return routes;
}

class FakeResponse {
  statusCode = 200;
  body: unknown = null;
  contentType = "";
  cleared: string[] = [];
  headers: Record<string, string> = {};
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(payload: unknown) {
    this.body = payload;
    return this;
  }
  type(value: string) {
    this.contentType = value;
    return this;
  }
  send(payload: unknown) {
    this.body = payload;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  clearCookie(name: string) {
    this.cleared.push(name);
    return this;
  }
}

async function call(handlers: Handler[], body: unknown) {
  const req = { body, headers: {}, ip: `198.51.100.${Math.floor(Math.random() * 200)}`, hostname: "localhost", protocol: "https" } as unknown as Request;
  const res = new FakeResponse();
  for (const handler of handlers) {
    let nextCalled = false;
    await handler(req, res as unknown as Response, () => {
      nextCalled = true;
    });
    if (!nextCalled) break;
  }
  return res;
}

describe("C3 · suppression de compte", () => {
  const routes = collectRoutes();
  const deleteRoute = routes["POST /api/auth/delete-account"];

  beforeEach(() => {
    authenticateRequest.mockReset();
    deleteUserAccount.mockReset();
  });

  it("refuse sans session", async () => {
    authenticateRequest.mockRejectedValue(new Error("Invalid session cookie"));
    const res = await call(deleteRoute, { password: "secret123" });
    expect(res.statusCode).toBe(401);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it("exige le bon mot de passe pour un compte local", async () => {
    authenticateRequest.mockResolvedValue({ id: 42, passwordHash: hashPassword("secret123") });
    const res = await call(deleteRoute, { password: "mauvais-mot" });
    expect(res.statusCode).toBe(403);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it("supprime le compte et efface le cookie de session", async () => {
    authenticateRequest.mockResolvedValue({ id: 42, passwordHash: hashPassword("secret123") });
    const res = await call(deleteRoute, { password: "secret123" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(deleteUserAccount).toHaveBeenCalledWith(42);
    expect(res.cleared).toContain("app_session_id");
  });

  it("anonymise l'utilisateur et purge les données du prestataire dans une transaction SQL", () => {
    const db = readFileSync("server/db.ts", "utf8");
    const fn = db.slice(db.indexOf("export async function deleteUserAccount"));
    expect(fn).toContain("db.transaction");
    for (const field of ["name: null", "email: null", "phone: null", "passwordHash: null", "subscriptionEnd: null", "rawProviderPayload: null"]) {
      expect(fn).toContain(field);
    }
    expect(fn).toContain("openId: `deleted:");
  });

  it("l'app propose la suppression dans le menu Compte", () => {
    const menu = readFileSync("components/pharmagarde/menu-content.tsx", "utf8");
    expect(menu).toContain('navigate("/pharmagarde/supprimer-compte")');
  });
});

describe("C2 · politique de confidentialité", () => {
  const routes = collectRoutes();

  it("sert la politique publique sur /confidentialite avec les données réellement collectées", async () => {
    const res = await call(routes["GET /confidentialite"], undefined);
    const html = String(res.body);
    expect(res.contentType).toBe("html");
    for (const expected of ["numéro de téléphone", "Ligdi Cash", "position", "OpenStreetMap", "support@pharmagarde.com", "Supprimer mon compte"]) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain("Aucune donnée de paiement");
  });

  it("sert la page publique de demande de suppression sur /compte/suppression", async () => {
    const res = await call(routes["GET /compte/suppression"], undefined);
    expect(String(res.body)).toContain("support@pharmagarde.com");
  });

  it("échappe le HTML des contenus", () => {
    const html = renderLegalPage("<script>", "a & b", [{ title: "t", paragraphs: ['"x"'] }]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
  });

  it("l'écran in-app utilise le même texte que la page web", () => {
    const screen = readFileSync("app/pharmagarde/info/[id]/index.tsx", "utf8");
    expect(screen).toContain("sections: PRIVACY_POLICY_SECTIONS");
    expect(screen).not.toContain("Aucune donnée de paiement ou donnée médicale sensible n’est collectée");
  });
});

describe("C8 · identité définitive de l'app", () => {
  it("n'utilise plus les identifiants générés par Manus", async () => {
    const identity = await import("../app-identity");
    expect(identity.APP_BUNDLE_ID).toBe("com.pharmagarde.app");
    expect(identity.APP_SCHEME).toBe("pharmagarde");

    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { name: string };
    expect(manifest.name).toBe("pharmagarde-bf");
    for (const file of ["app.config.ts", "constants/oauth.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/space\.manus|manus\$\{timestamp\}|t20260501015223/);
    }
  });
});
