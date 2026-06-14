/**
 * Local-growth read router — armed-state visibility + reviews/Place ID
 * health for the GBP growth surfaces.
 *
 * 2026-06-10 GBP growth wave. READ-ONLY: every endpoint returns booleans
 * and status strings, NEVER token or key values. Nothing here posts,
 * sends, scrapes, or mutates. Surfaces the "is the IG autoposter actually
 * armed?" question the forensic sweep flagged as confusing, and whether
 * the durable Meta token (the real disarm gotcha) is present.
 */
import { router, adminProcedure } from "../_core/trpc";

export const localGrowthRouter = router({
  /**
   * IG/GBP automation armed-state — booleans only. The sweep found two
   * traps: (1) live IG posting needs IG_AUTOPOST_DRYRUN === "false" AND a
   * token; (2) deleting META_PAGE_ACCESS_TOKEN from env does NOT disarm,
   * because metaSocial loads a durable token from the app_secret_kv DB
   * row on boot. This surfaces both so the operator knows the true state.
   */
  automationArmedState: adminProcedure.query(async () => {
    // Dry-run is ON unless explicitly disabled — matches igAutopost's own
    // default (anything !== "false" is dry-run).
    const igDryRun = process.env.IG_AUTOPOST_DRYRUN !== "false";
    const envTokenPresent = !!(process.env.META_PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN);
    const igUserIdPresent = !!process.env.META_IG_USER_ID;

    // The durable token: present in the app_secret_kv row even if env is unset.
    let durableTokenPresent = false;
    let expiresAt: string | null = process.env.META_PAGE_ACCESS_TOKEN_EXPIRES_AT || null;
    let warning: string | null = null;
    let tokenStatus: "expired" | "expiring_soon" | "valid" = "valid";

    try {
      const { db } = await import("../lib/db-helper");
      const d = await db();
      if (d) {
        const { appSecretKv } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        
        const rowsToken = await d.select().from(appSecretKv).where(eq(appSecretKv.k, "meta_page_access_token")).limit(1);
        durableTokenPresent = rowsToken.length > 0 && !!rowsToken[0]?.v;

        const rowsExpires = await d.select().from(appSecretKv).where(eq(appSecretKv.k, "meta_page_access_token_expires_at")).limit(1);
        if (rowsExpires.length > 0 && rowsExpires[0]?.v) {
          expiresAt = rowsExpires[0].v;
        }
      }
    } catch {
      // schema/table absent or read failed — leave false/null; never throw on a read surface
    }

    if (expiresAt) {
      const expDate = new Date(expiresAt);
      if (!isNaN(expDate.getTime())) {
        const diffMs = expDate.getTime() - Date.now();
        const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
        if (diffDays <= 0) {
          tokenStatus = "expired";
          warning = `❌ Meta Page Access Token is expired (expired on ${expDate.toLocaleDateString()}). Please renew the token to prevent automated posting failure.`;
        } else if (diffDays <= 14) {
          tokenStatus = "expiring_soon";
          warning = `⚠️ Meta Page Access Token is set to expire in ${diffDays} day${diffDays === 1 ? "" : "s"} (on ${expDate.toLocaleDateString()}). Please renew the token to prevent automated posting failure.`;
        }
      }
    }

    const igCouldPostLive = !igDryRun && (envTokenPresent || durableTokenPresent) && igUserIdPresent;

    return {
      ig: {
        dryRun: igDryRun,
        envTokenPresent,
        durableTokenPresent,
        igUserIdPresent,
        couldPostLiveNow: igCouldPostLive,
        tokenExpiresAt: expiresAt,
        tokenExpirationWarning: warning,
        tokenStatus,
      },
      // GBP posting can't go direct — the Posts API was deprecated 2024;
      // gbpAutoPost only generates copy-paste text via Telegram.
      gbp: { directPostingPossible: false, mode: "copy-paste-via-telegram" as const },
      // The honest disarm rule, surfaced so nobody trusts env removal alone.
      disarmNote:
        "To stop live IG posting you must BOTH set IG_AUTOPOST_DRYRUN back to its default AND clear the durable token (app_secret_kv 'meta_page_access_token' row). Removing the env var alone does NOT disarm — a durable token survives.",
    };
  }),

  /**
   * Google Reviews / Place ID health — booleans + status only, no keys.
   * Surfaces the audit's NOT_FOUND fallback concern: is the Maps key
   * present, and is the live-reviews path reachable, vs the curated
   * fallback the public pages silently fall back to.
   */
  reviewsHealth: adminProcedure.query(async () => {
    const mapsKeyPresent = !!process.env.GOOGLE_MAPS_API_KEY;
    const placesKeyPresent = !!process.env.GOOGLE_PLACES_API_KEY;
    let liveReachable = false;
    let status: "live" | "fallback" | "unconfigured" = "unconfigured";
    let reviewCount: number | null = null;
    if (mapsKeyPresent || placesKeyPresent) {
      try {
        const { getGoogleReviews } = await import("../google-reviews");
        const res = await getGoogleReviews();
        if (res && Array.isArray(res.reviews)) {
          liveReachable = res.reviews.length > 0;
          reviewCount = res.reviews.length;
          status = liveReachable ? "live" : "fallback";
        } else {
          status = "fallback";
        }
      } catch {
        status = "fallback";
      }
    }
    return {
      mapsKeyPresent,
      placesKeyPresent,
      liveReachable,
      status,
      liveReviewCount: reviewCount,
      fallbackNote:
        status !== "live"
          ? "Live Google reviews are NOT reachable — public pages fall back to curated/DB review stats. Check GOOGLE_MAPS_API_KEY and the Place ID. (No keys are shown here by design.)"
          : null,
    };
  }),
});
