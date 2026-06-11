/**
 * Memberships Router — Nonstop Nick ($7.99/mo tire membership · chunk 5/5).
 *
 * Two surfaces:
 *   - PUBLIC `startCheckout` — the page's Join button calls this to get a Stripe
 *     hosted-checkout URL. Degrades honestly (returns null url + a call-us
 *     message) until STRIPE_NONSTOP_NICK_PRICE_ID is set.
 *   - ADMIN `lookupByPhone` — the counter verifies "is this phone an active
 *     member?" This is the operational make-or-break: without it, staff can't
 *     run the program day-to-day. Reads the memberships table directly (status
 *     mirrors Stripe via the webhook, so no live Stripe call needed).
 *   - ADMIN `bindVehicle` — one-vehicle binding at FIRST USE: the counter
 *     records the plate the first time the member pulls up.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, like, desc } from "drizzle-orm";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { memberships, type Membership } from "../../drizzle/schema";
import { db } from "../lib/db-helper";
import { sanitizePhone } from "../sanitize";
import { normalizeMembershipPhone, sortMembersActiveFirst } from "../lib/membership-guards";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:memberships");

export const membershipsRouter = router({
  /** Start a Nonstop Nick signup — returns a Stripe Checkout URL (public). */
  startCheckout: publicProcedure
    .input(z.object({
      phone: z.string().min(7).max(20),
      email: z.string().email().max(320).optional(),
      name: z.string().max(255).optional(),
      // Which tier: $7.99 base or $9.99+ (15% repair discount). Defaults to base.
      plan: z.enum(["nonstop-nick", "nonstop-nick-plus"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const phone = normalizeMembershipPhone(input.phone);
      if (!phone) {
        return { url: null as string | null, error: "Please enter a valid 10-digit phone number." };
      }
      const { createMembershipCheckout } = await import("../services/payments");
      const origin = process.env.SITE_URL || "https://nickstire.org";
      const result = await createMembershipCheckout({
        plan: input.plan,
        phone,
        customerEmail: input.email,
        customerName: input.name,
        successUrl: `${origin}/nonstop-nick?joined=1`,
        cancelUrl: `${origin}/nonstop-nick`,
      });
      if ("error" in result) {
        return { url: null as string | null, error: result.error };
      }
      return { url: result.url, error: null as string | null };
    }),

  /** Counter lookup — is this phone an active member? (admin) */
  lookupByPhone: adminProcedure
    .input(z.object({ phone: z.string().min(4).max(20) }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { found: false as const };
      const phone = sanitizePhone(input.phone).replace(/\D/g, "").slice(-10);
      // LIKE on the last digits so a partial entry at the counter still matches.
      const rows: Membership[] = await d.select().from(memberships)
        .where(like(memberships.phone, `%${phone}`))
        .orderBy(desc(memberships.createdAt))
        .limit(5);
      if (rows.length === 0) return { found: false as const };
      // Active members first — the counter's actual question is "are they
      // active?", so a canceled row must never bury the live one.
      return {
        found: true as const,
        members: sortMembersActiveFirst(rows).map((m: Membership) => ({
          id: m.id,
          name: m.name,
          phone: m.phone,
          plan: m.plan,
          // plus tier ($9.99) carries the 15%-off-repairs benefit — the counter
          // applies it manually, so surface it on the lookup card.
          repairDiscountPct: m.plan === "nonstop-nick-plus" ? 15 : 0,
          status: m.status,
          isActive: m.status === "active",
          vehiclePlate: m.vehiclePlate,
          vehicleDesc: m.vehicleDesc,
          currentPeriodEnd: m.currentPeriodEnd,
        })),
      };
    }),

  /** Bind the one covered vehicle at first use (admin). */
  bindVehicle: adminProcedure
    .input(z.object({
      membershipId: z.number().int(),
      vehiclePlate: z.string().min(1).max(16),
      vehicleDesc: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database unavailable");
      // Honest failure: binding a non-existent membership must error, not
      // report success after a 0-row UPDATE (launch-readiness audit).
      const [existing] = await d.select().from(memberships)
        .where(eq(memberships.id, input.membershipId)).limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No membership with that ID — look the member up again." });
      }
      await d.update(memberships)
        .set({ vehiclePlate: input.vehiclePlate.toUpperCase().trim(), vehicleDesc: input.vehicleDesc })
        .where(eq(memberships.id, input.membershipId));
      log.info(`Nonstop Nick membership ${input.membershipId} bound to ${input.vehiclePlate}`);
      return { success: true };
    }),
});
