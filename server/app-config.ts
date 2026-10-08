import type { Express, Request, Response } from "express";

import { applyCorsHeaders } from "./_core/security";
import { currentAnnouncements, getContentConfig } from "./content-config";
import { activePremiumPlans } from "./premium";

/**
 * GET /app-config : réglages publics modifiés depuis la console, lus par l'application au démarrage
 * (villes publiées, assurances actives, formules proposées, annonces en cours).
 */
export async function readAppConfig(now = new Date()) {
  const config = await getContentConfig();
  return {
    cities: config.cities.filter((city) => city.published).map(({ name, latitude, longitude, aliases }) => ({ name, latitude, longitude, aliases })),
    insurers: config.insurers.filter((insurer) => insurer.active).map(({ id, label }) => ({ id, label })),
    plans: await activePremiumPlans(),
    announcements: currentAnnouncements(config, now).map((announcement) => ({
      id: announcement.id,
      city: announcement.city,
      title: announcement.title,
      body: announcement.body,
      tone: announcement.tone,
      startsAt: new Date(announcement.startsAt).toISOString(),
      endsAt: announcement.endsAt ? new Date(announcement.endsAt).toISOString() : null,
    })),
    updatedAt: now.toISOString(),
  };
}

export function registerAppConfigRoute(app: Express) {
  app.get("/app-config", async (req: Request, res: Response) => {
    applyCorsHeaders(req, res);
    res.setHeader("Cache-Control", "public, max-age=120");
    try {
      res.json(await readAppConfig());
    } catch (error) {
      console.error("[AppConfig] Lecture impossible :", error instanceof Error ? error.message : error);
      res.status(503).json({ error: "APP_CONFIG_UNAVAILABLE" });
    }
  });
}
