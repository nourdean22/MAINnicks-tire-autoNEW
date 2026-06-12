/**
 * GSC ERRORS — pulls sitemap-level warnings/errors + per-URL inspection
 * for any pages flagged. Returns a punchlist of what to fix.
 *
 * Two data sources:
 *   1. webmasters/v3/sites/{site}/sitemaps/list — submitted vs indexed
 *      counts per sitemap + warnings + errors fields
 *   2. searchconsole/v1/urlInspection/index:inspect — per-URL coverage
 *      state (INDEXED / DISCOVERED_NOT_INDEXED / CRAWLED_NOT_INDEXED /
 *      etc) plus last-crawl + indexing verdict
 *
 * Sitemap data is fast (1 call per sitemap). URL inspection is rate-
 * limited (~50/day per property), so we sample the v1.5 pages we
 * changed most recently rather than the whole site.
 *
 * Run from repo root so dotenv finds .env:
 *   DOTENV_CONFIG_PATH=.env node \
 *     node_modules/.pnpm/tsx@4.22.1/node_modules/tsx/dist/cli.mjs \
 *     apps/nickstire/scripts/gsc-errors.ts
 */
import "dotenv/config";

const GSC_SITE_URL = "https://nickstire.org/";
const SITEMAPS = [
  "https://nickstire.org/sitemap.xml",
  "https://nickstire.org/sitemap-services.xml",
  "https://nickstire.org/sitemap-locations.xml",
  "https://nickstire.org/sitemap-images.xml",
];

// Pages we touched in the last few waves — worth inspecting individually
// to see if Google's actually re-crawled them post wave-181.29/38.
const URLS_TO_INSPECT = [
  "https://nickstire.org/",
  "https://nickstire.org/tires",
  "https://nickstire.org/services",
  "https://nickstire.org/reviews",  // wave-181.38 merge
  "https://nickstire.org/review",   // should now redirect
  "https://nickstire.org/specials",
  "https://nickstire.org/contact",
];

async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_* env");

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(
    JSON.stringify({
      iss: email,
      // webmasters.readonly is enough for both sitemaps/list AND urlInspection.
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
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

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Token: ${res.status} ${await res.text()}`);
  const json = await res.json() as { access_token: string };
  return json.access_token;
}

interface SitemapInfo {
  path: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  type?: string;
  warnings?: string;  // numeric string per Google API
  errors?: string;
  contents?: Array<{ type: string; submitted: string; indexed: string }>;
}

interface SitemapsListResponse {
  sitemap?: SitemapInfo[];
}

interface InspectResponse {
  inspectionResult?: {
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      googleCanonical?: string;
      userCanonical?: string;
      referringUrls?: string[];
      crawledAs?: string;
    };
    mobileUsabilityResult?: { verdict?: string; issues?: Array<{ issueType?: string; message?: string }> };
    richResultsResult?: { verdict?: string; detectedItems?: Array<{ richResultType?: string }> };
  };
}

async function fetchSitemapErrors(token: string): Promise<{ totalWarnings: number; totalErrors: number; sitemaps: SitemapInfo[] }> {
  // First: list all sitemaps for the property
  const listUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/sitemaps`;
  const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sitemaps/list: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as SitemapsListResponse;
  const sitemaps = json.sitemap ?? [];

  let totalWarnings = 0;
  let totalErrors = 0;
  for (const sm of sitemaps) {
    totalWarnings += parseInt(sm.warnings ?? "0", 10) || 0;
    totalErrors += parseInt(sm.errors ?? "0", 10) || 0;
  }
  return { totalWarnings, totalErrors, sitemaps };
}

async function inspectUrl(token: string, urlToInspect: string): Promise<InspectResponse> {
  const res = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inspectionUrl: urlToInspect, siteUrl: GSC_SITE_URL }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`urlInspection ${urlToInspect}: ${res.status} ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as InspectResponse;
}

async function main(): Promise<void> {
  console.log("═══ GSC ERRORS — nickstire.org ═══\n");

  const token = await getAccessToken();
  console.log("✓ Auth OK (readonly)\n");

  // ─── 1) Sitemap-level errors/warnings + indexed counts ───
  console.log("─── SITEMAPS (errors · warnings · submitted vs indexed) ─────────────────────");
  const { totalWarnings, totalErrors, sitemaps } = await fetchSitemapErrors(token);
  console.log(`Sitemaps tracked: ${sitemaps.length} · totalErrors: ${totalErrors} · totalWarnings: ${totalWarnings}\n`);

  for (const sm of sitemaps) {
    const last = sm.lastDownloaded ? new Date(sm.lastDownloaded).toISOString().slice(0, 16) + "Z" : "never";
    const path = sm.path?.replace("https://nickstire.org/", "/") || "?";
    const errs = parseInt(sm.errors ?? "0", 10);
    const warns = parseInt(sm.warnings ?? "0", 10);
    const status = errs > 0 ? "❌" : warns > 0 ? "⚠️ " : "✅";

    console.log(`${status} ${path.padEnd(35)} err=${errs} warn=${warns} · downloaded ${last} · pending=${sm.isPending ?? false}`);
    if (sm.contents) {
      for (const c of sm.contents) {
        const sub = parseInt(c.submitted, 10) || 0;
        const idx = parseInt(c.indexed, 10) || 0;
        const pct = sub > 0 ? Math.round((idx / sub) * 100) : 0;
        const flag = pct < 60 ? "⚠️ low index rate" : pct < 90 ? "○" : "✓";
        console.log(`     ${c.type.padEnd(8)} submitted=${sub.toString().padStart(4)}  indexed=${idx.toString().padStart(4)}  (${pct}%) ${flag}`);
      }
    }
  }

  // ─── 2) Per-URL inspection on recently-changed pages ───
  console.log("\n\n─── URL INSPECTION — pages we touched recently ──────────────────────────────");
  for (const u of URLS_TO_INSPECT) {
    try {
      const r = await inspectUrl(token, u);
      const idx = r.inspectionResult?.indexStatusResult ?? {};
      const verdict = idx.verdict ?? "?";
      const coverage = idx.coverageState ?? "?";
      const lastCrawl = idx.lastCrawlTime ? new Date(idx.lastCrawlTime).toISOString().slice(0, 10) : "never";
      const fetchState = idx.pageFetchState ?? "?";
      const robots = idx.robotsTxtState ?? "?";

      const flag = verdict === "PASS" ? "✅" : verdict === "PARTIAL" ? "⚠️ " : "❌";
      console.log(`${flag} ${u.replace("https://nickstire.org", "").padEnd(15)}  verdict=${verdict.padEnd(7)}  coverage="${coverage}"  fetch=${fetchState}  crawled=${lastCrawl}  robots=${robots}`);

      // Surface any non-canonical issues that suggest a problem
      const gCanon = idx.googleCanonical;
      const uCanon = idx.userCanonical;
      if (gCanon && uCanon && gCanon !== uCanon) {
        console.log(`     ⚠️ canonical mismatch — user=${uCanon} vs google=${gCanon}`);
      }

      // Mobile usability issues
      const mu = r.inspectionResult?.mobileUsabilityResult;
      if (mu?.verdict && mu.verdict !== "PASS") {
        console.log(`     📱 mobile=${mu.verdict}  issues=${(mu.issues ?? []).map((i) => i.issueType).join(", ") || "none-listed"}`);
      }
    } catch (e) {
      console.log(`❌ ${u}  → ${(e as Error).message.slice(0, 80)}`);
    }
    // Rate-limit politeness — GSC URL inspection quotas are tight.
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n═══ DONE ═══");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
