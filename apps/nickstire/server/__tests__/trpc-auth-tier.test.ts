import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
} from "../_core/trpc";

/**
 * Auth-tier coverage contract.
 *
 * Every base procedure in _core/trpc.ts stamps `.meta({ authTier })`. This test
 * walks every procedure registered on appRouter and enforces two invariants:
 *
 *   1. Every procedure carries a tier — a procedure built from raw `t.procedure`
 *      (bypassing the exported bases) has no tier and fails here.
 *   2. The set of PUBLIC procedures equals the committed allowlist below. A new
 *      public procedure fails until deliberately added; a procedure that gains a
 *      guard must be removed from the list, so the allowlist cannot rot.
 *
 * Why: authentication without per-procedure authorization is the
 * Langfuse CVE-2025-59305 failure class. nickstire's adminProcedure chain does
 * authn -> MFA -> per-path role permission correctly; the residual risk is a
 * procedure that should be guarded being registered on publicProcedure. That
 * mis-assignment is invisible at runtime and is exactly what this sweep pins.
 *
 * The canaries pin the MECHANISM itself: if `.meta()` ever stops propagating
 * through builder chaining, they fail loudly instead of letting the sweep pass
 * vacuously with an empty public set.
 */

const PUBLIC_ALLOWLIST: readonly string[] = [
  // session bootstrap — the client must be able to ask "who am I" while logged out
  "auth.logout",
  "auth.me",
  // public booking + status flow
  "booking.addUpsellInterest",
  "booking.create",
  "booking.statusByPhone",
  "booking.statusByRef",
  "booking.uploadPhoto",
  // public lead/contact/referral forms
  "callback.submit",
  "emergency.submit",
  "lead.submit",
  "referrals.submit",
  // public-site analytics + social-proof ingestion/reads
  "activity.recent",
  "callTracking.logCall",
  "conversion.liveSessions",
  "conversion.recentActivity",
  "conversion.shopCapacity",
  "customerEvents.log",
  "reviewRequests.trackClick",
  "shareCards.get",
  "shareCards.trackShare",
  // published content, reviews, media
  "content.activeNotifications",
  "content.articleBySlug",
  "content.currentSeason",
  "content.publishedArticles",
  "gallery.list",
  "instagram.account",
  "instagram.posts",
  "reviews.google",
  "serviceReviews.forCity",
  "serviceReviews.forService",
  // public estimators, search, and NickGPT surface
  "chat.message",
  "costEstimator.estimate",
  "diagnose.analyze",
  "estimates.generate",
  "laborEstimate.generate",
  "pricing.allServices",
  "pricing.estimate",
  "qa.ask",
  "qa.published",
  "search.ai",
  "search.instant",
  "serviceMatcher.match",
  // tire store + checkout (customer-facing commerce)
  "gatewayTire.checkOrder",
  "gatewayTire.confirmCheckout",
  "gatewayTire.createCheckout",
  "gatewayTire.getPackage",
  "gatewayTire.placeOrder",
  "gatewayTire.popularSizes",
  "gatewayTire.publicSearch",
  "gatewayTire.publicStats",
  // payments (Stripe public flow) + financing + memberships
  "financing.providers",
  "financing.trackApplication",
  "memberships.startCheckout",
  "payments.config",
  "payments.confirmPayment",
  "payments.createPaymentIntent",
  "payments.lookupInvoice",
  // customer self-service, authorized by token/code INSIDE the handler
  "dispatch.track",
  "inspection.byToken",
  "inspection.decideItem",
  "inspection.recordView",
  "portal.myData",
  "portal.requestCode",
  "portal.verifyCode",
  // shop status, specials, misc public reads
  "coupons.active",
  "loyalty.rewards",
  "shopStatus.getLineOfCars",
  "shopStatus.getStatus",
  "specials.getActive",
  "system.health",
  "technicians.list",
  "weather.current",
  // statenour bridge lane riding the public tier. REVIEWED 2026-08-09: the
  // handler requires STATENOUR_SYNC_KEY via timingSafeEqual and throws
  // UNAUTHORIZED when the env var is unset, so it is gated below the tier
  // annotation, fail-closed. Correctly public. (The nourOsQuote.* entries that
  // sat here were deleted with their router — the lane was 500ing in prod.)
  "statenourMetrics.gscExecutiveSummary",
  // VAPI voice-agent READS (writes are authTier "internal")
  "voiceAgent.capacityCheck",
  "voiceAgent.quoteRange",
  "voiceAgent.shopInfo",
  "voiceAgent.tireSizeFromVehicle",
];

type ProcedureLike = { _def?: { meta?: { authTier?: string } } };

const tierOf = (proc: unknown): string | undefined =>
  (proc as ProcedureLike)._def?.meta?.authTier;

const procedures = Object.entries(
  (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })
    ._def.procedures,
);

describe("tRPC auth-tier coverage", () => {
  it("canary: authTier meta is present on the base procedures", () => {
    expect(tierOf(publicProcedure)).toBe("public");
    expect(tierOf(protectedProcedure)).toBe("protected");
    expect(tierOf(adminProcedure)).toBe("admin");
  });

  it("canary: the registry is non-trivial and meta survives router registration", () => {
    expect(procedures.length).toBeGreaterThan(100);
    const tiers = new Set(procedures.map(([, p]) => tierOf(p)));
    expect(tiers).toContain("admin");
  });

  it("every registered procedure declares an authTier", () => {
    const untagged = procedures
      .filter(([, p]) => tierOf(p) === undefined)
      .map(([path]) => path)
      .sort();
    expect(untagged).toEqual([]);
  });

  it("public procedures are exactly the committed allowlist", () => {
    const publicPaths = procedures
      .filter(([, p]) => tierOf(p) === "public")
      .map(([path]) => path)
      .sort();
    expect(publicPaths).toEqual([...PUBLIC_ALLOWLIST].sort());
  });
});
