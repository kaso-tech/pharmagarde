import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { initializePharmaGardeCache, registerPharmaGardeCacheRoutes, startPharmaGardeSchedulers } from "../pharmagarde-cache";
import { handleLigdiCashWebhook, handlePremiumPaymentReturn, initPremiumPayment } from "../premium";
import { clientIpKey, corsMiddleware, createRateLimiter, parseTrustProxy } from "./security";

const paymentInitRateLimit = createRateLimiter({
  name: "payment-init",
  windowMs: 15 * 60 * 1000,
  max: 20,
  key: clientIpKey,
  message: "Trop de tentatives de paiement. Réessayez dans quelques minutes.",
});

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));
  const server = createServer(app);

  // Register public REST routes immediately so /pharmacies and /healthcare cannot be masked by API middleware.
  registerPharmaGardeCacheRoutes(app);

  // CORS limité aux origines autorisées (CORS_ALLOWED_ORIGINS) ; voir server/_core/security.ts.
  app.use(corsMiddleware);

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  await initializePharmaGardeCache();
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post("/payment/init", paymentInitRateLimit, initPremiumPayment);
  app.get("/pharmagarde/abonnement", handlePremiumPaymentReturn);
  app.post("/payment/callback", handleLigdiCashWebhook);
  app.post("/payment/webhook", handleLigdiCashWebhook);
  startPharmaGardeSchedulers();

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
