import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "../shared/const.js";
import { adminRouter } from "./admin";
import { contributionsRouter } from "./contributions";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { activePremiumPlans, getPremiumStatus, getRecentTransactions, requirePremium } from "./premium";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  admin: adminRouter,
  contributions: contributionsRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  premium: router({
    plans: publicProcedure.query(() => activePremiumPlans()),
    status: protectedProcedure.query(async ({ ctx }) => getPremiumStatus(ctx.user.openId)),
    transactions: protectedProcedure.query(async ({ ctx }) => getRecentTransactions(ctx.user.openId)),
    assertAccess: protectedProcedure.query(async ({ ctx }) => {
      try {
        return await requirePremium(ctx.user.openId);
      } catch (error) {
        throw new TRPCError({ code: "FORBIDDEN", message: error instanceof Error ? error.message : "Abonnement Premium requis." });
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
