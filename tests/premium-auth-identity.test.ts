import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const premiumSubscriber = {
  id: 7,
  openId: "local:+22670123456",
  subscriptionEnd: new Date("2099-01-01T00:00:00.000Z"),
};

const dbLookups = vi.fn();

// Base simulée : toute recherche d'utilisateur renverrait un abonné Premium actif.
vi.mock("../server/db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            dbLookups();
            return [premiumSubscriber];
          },
        }),
      }),
    }),
  }),
  getUserByOpenId: async () => {
    dbLookups();
    return premiumSubscriber;
  },
  upsertUser: async () => undefined,
}));

const { getAuthenticatedDbUser, getPremiumStatusForUser } = await import("../server/premium");

function fakeRequest(headers: Record<string, string>): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    headers: lower,
    header: (name: string) => lower[name.toLowerCase()],
  } as unknown as Request;
}

describe("identité sur les routes Premium", () => {
  beforeEach(() => {
    dbLookups.mockClear();
  });

  it("ignore l'en-tête x-user-open-id sans session : pas d'usurpation d'un abonné", async () => {
    const user = await getAuthenticatedDbUser(fakeRequest({ "x-user-open-id": premiumSubscriber.openId }));

    expect(user).toBeUndefined();
    expect(getPremiumStatusForUser(user ?? null).isPremium).toBe(false);
    expect(dbLookups).not.toHaveBeenCalled();
  });

  it("ignore aussi l'en-tête x-user-open-id quand le Bearer token est invalide", async () => {
    const user = await getAuthenticatedDbUser(
      fakeRequest({ authorization: "Bearer jeton-forge", "x-user-open-id": premiumSubscriber.openId }),
    );

    expect(user).toBeUndefined();
    expect(dbLookups).not.toHaveBeenCalled();
  });
});
