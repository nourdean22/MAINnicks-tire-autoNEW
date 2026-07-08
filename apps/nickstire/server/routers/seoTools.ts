/**
 * SEO Tools Router — admin actions for accelerating Google indexing.
 *
 * Wraps the existing scripts/gsc-submit-sitemap.ts logic as tRPC
 * mutations so Nour can submit sitemaps from the admin UI without
 * SSH-ing into Railway. Same JWT-signed service-account flow, same
 * full-webmasters-scope token.
 *
 * Available routes:
 *   - submitSitemaps: triggers re-crawl of all 4 site sitemaps
 *   - sitemapStatus: pulls current GSC status (last submitted,
 *     submitted/indexed counts, warnings, errors) for each
 *
 * Auth: adminProcedure on every route. The Google service-account
 * credentials live in env (GOOGLE_SERVICE_ACCOUNT_EMAIL +
 * GOOGLE_SERVICE_ACCOUNT_KEY) — same ones GSC reporting already uses.
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:seoTools");

const GSC_SITE_URL = "https://nickstire.org/";
const SITEMAPS_TO_SUBMIT = [
  "https://nickstire.org/sitemap.xml",
  "https://nickstire.org/sitemap-services.xml",
  "https://nickstire.org/sitemap-locations.xml",
  "https://nickstire.org/sitemap-images.xml",
] as const;

interface SitemapStatus {
  path?: string;
  lastSubmitted?: string;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  type?: string;
  lastDownloaded?: string;
  warnings?: string;
  errors?: string;
  contents?: Array<{ type: string; submitted: string; indexed: string }>;
}

async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY missing in env");
  }
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  // FULL webmasters scope — required for sitemaps.submit (vs readonly).
  const claims = Buffer.from(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/webmasters",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");

  const crypto = await import("crypto");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(privateKey, "base64url");
  const jwt = `${header}.${claims}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenRes.ok) {
    throw new Error(`GSC token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const json = (await tokenRes.json()) as { access_token: string };
  return json.access_token;
}

async function submitOne(token: string, sitemapUrl: string): Promise<void> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Submit failed (${res.status}): ${await res.text()}`);
  }
}

async function statusOne(token: string, sitemapUrl: string): Promise<SitemapStatus | null> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  return (await res.json()) as SitemapStatus;
}

export const seoToolsRouter = router({
  /** Submit all 4 sitemaps to Google for re-crawl. Returns per-sitemap
   *  outcome so the admin UI can show success/error for each. */
  submitSitemaps: adminProcedure
    .input(z.object({
      // Optional override — submit a single sitemap by URL. When
      // omitted, submits all 4. Useful when only one sitemap changed
      // (e.g. only sitemap-images.xml after a content audit).
      onlyUrl: z.string().url().optional(),
    }).optional())
    .mutation(async ({ input }) => {
      const targets = input?.onlyUrl
        ? [input.onlyUrl]
        : [...SITEMAPS_TO_SUBMIT];

      let token: string;
      try {
        token = await getAccessToken();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown auth error";
        log.error("[SeoTools] GSC auth failed", { err: message });
        return {
          ok: false,
          authError: message,
          results: [] as Array<{ sitemap: string; ok: boolean; error?: string }>,
        };
      }

      const results: Array<{ sitemap: string; ok: boolean; error?: string }> = [];
      for (const sitemap of targets) {
        try {
          await submitOne(token, sitemap);
          results.push({ sitemap, ok: true });
        } catch (err) {
          results.push({
            sitemap,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
          log.error("[SeoTools] Submit failed", { sitemap, err });
        }
      }
      return {
        ok: results.every((r) => r.ok),
        authError: null,
        results,
      };
    }),

  /** Weekly GSC audit — pulls top queries, CTR opportunities, ranking
   *  drops, and cannibalization clusters from the search_performance
   *  table that gets populated nightly by the gsc-pipeline cron job.
   *
   *  Surfaces what the gsc-audit.ts CLI script outputs, but in admin
   *  UI form so Nour doesn't have to SSH into Railway weekly. */
  weeklyAudit: adminProcedure
    .input(z.object({
      days: z.number().min(7).max(90).default(28),
    }).optional())
    .query(async ({ input }) => {
      const days = input?.days ?? 28;
      try {
        const { findCtrOpportunities, detectRankingChanges, detectCannibalization, getTopQueries, getPagePerformance } =
          await import("../pipelines/gsc-data");

        // Compute startDate string for the window — gsc-data fns use
        // it directly rather than a numeric `days` arg.
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
          .toISOString().split("T")[0];

        const [opportunities, rankingChanges, cannibalization, topQueries, topPages] = await Promise.all([
          findCtrOpportunities({ startDate, minImpressions: 100, limit: 20 }).catch(() => []),
          detectRankingChanges({ minDelta: 3, limit: 40 }).catch(() => []),
          detectCannibalization({ startDate, limit: 10 }).catch(() => []),
          getTopQueries({ startDate, limit: 25 }).catch(() => []),
          getPagePerformance({ startDate, limit: 25 }).catch(() => []),
        ]);

        return {
          ok: true,
          days,
          ctrOpportunities: opportunities.slice(0, 20),
          rankingDrops: rankingChanges.filter((c: { direction: string; delta: number }) =>
            c.direction === "dropped" && Math.abs(c.delta) >= 3,
          ).slice(0, 20),
          rankingGains: rankingChanges.filter((c: { direction: string; delta: number }) =>
            c.direction === "improved" && Math.abs(c.delta) >= 3,
          ).slice(0, 20),
          cannibalization: cannibalization.slice(0, 10),
          topQueries: topQueries.slice(0, 20),
          topPages: topPages.slice(0, 20),
        };
      } catch (err) {
        log.error("[SeoTools] weeklyAudit failed", { err });
        return {
          ok: false,
          authError: err instanceof Error ? err.message : "Unknown error",
          days,
          ctrOpportunities: [],
          rankingDrops: [],
          rankingGains: [],
          cannibalization: [],
          topQueries: [],
          topPages: [],
        };
      }
    }),

  /** SEO fix drafts (phase 4 · GSC Act — "draft + surface"). The AI drafts an
   *  improved title + meta for the top buried service pages; a human applies the
   *  shared/services.ts edit. Read-only to the live site — nothing is written. */
  seoFixDrafts: adminProcedure.query(async () => {
    const { getSeoFixDrafts } = await import("../services/seoFixDrafts");
    return getSeoFixDrafts();
  }),
  generateSeoFixDrafts: adminProcedure.mutation(async () => {
    const { generateSeoFixDrafts } = await import("../services/seoFixDrafts");
    return generateSeoFixDrafts();
  }),

  /** Pull current GSC status for each sitemap — last submitted, last
   *  downloaded, error count, indexed-vs-submitted counts. */
  sitemapStatus: adminProcedure.query(async () => {
    let token: string;
    try {
      token = await getAccessToken();
    } catch (err) {
      return {
        ok: false,
        authError: err instanceof Error ? err.message : "Unknown auth error",
        sitemaps: [] as Array<{ url: string; status: SitemapStatus | null }>,
      };
    }

    const sitemaps: Array<{ url: string; status: SitemapStatus | null }> = [];
    for (const sitemap of SITEMAPS_TO_SUBMIT) {
      try {
        const s = await statusOne(token, sitemap);
        sitemaps.push({ url: sitemap, status: s });
      } catch (err) {
        log.error("[SeoTools] Status fetch failed", { sitemap, err });
        sitemaps.push({ url: sitemap, status: null });
      }
    }
    return { ok: true, authError: null, sitemaps };
  }),
});
