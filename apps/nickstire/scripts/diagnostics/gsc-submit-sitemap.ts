/**
 * GSC Sitemap Submission — pings Google to re-crawl our sitemap.xml.
 *
 * Use after major title/description changes or new page additions
 * (like our v1.5 conversion overhaul + v1.6 SEO/pricing tune) to
 * accelerate Google's discovery vs waiting for the natural crawl
 * cycle (24–72 hours).
 *
 * Requires the service account to have FULL siteOwner permissions
 * (not just readonly). Per server/pipelines/gsc-data.ts, the
 * teezy-491218 service account is registered as siteOwner on the
 * URL-prefix property `https://nickstire.org/`.
 *
 * Run: pnpm tsx scripts/gsc-submit-sitemap.ts
 */
import "dotenv/config";

const GSC_SITE_URL = "https://nickstire.org/";
const SITEMAPS_TO_SUBMIT = [
  "https://nickstire.org/sitemap.xml",
  "https://nickstire.org/sitemap-services.xml",
  "https://nickstire.org/sitemap-locations.xml",
  // 2026-05-06 visual wave 5 · image sitemap surfaces 21 real shop
  // photos across home + service pages for Google Image Search.
  "https://nickstire.org/sitemap-images.xml",
];

async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_* env");

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

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Token: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function submitSitemap(token: string, sitemapUrl: string): Promise<void> {
  // PUT https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Submit failed (${res.status}): ${errText}`);
  }
  // Successful submit returns 200/204 with empty body
}

async function getSitemapStatus(token: string, sitemapUrl: string) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    path?: string;
    lastSubmitted?: string;
    isPending?: boolean;
    isSitemapsIndex?: boolean;
    type?: string;
    lastDownloaded?: string;
    warnings?: string;
    errors?: string;
    contents?: Array<{ type: string; submitted: string; indexed: string }>;
  };
}

async function main() {
  console.log("\n═══ GSC SITEMAP SUBMISSION ═══\n");

  const token = await getAccessToken();
  console.log("✓ Auth OK (full webmasters scope)\n");

  for (const sitemap of SITEMAPS_TO_SUBMIT) {
    console.log(`→ Submitting: ${sitemap}`);
    try {
      await submitSitemap(token, sitemap);
      console.log("  ✓ Submitted");

      // Pull status
      const status = await getSitemapStatus(token, sitemap);
      if (status) {
        if (status.lastSubmitted) console.log(`  Last submitted: ${status.lastSubmitted}`);
        if (status.lastDownloaded) console.log(`  Last downloaded: ${status.lastDownloaded}`);
        if (status.isPending) console.log("  Status: PENDING (Google is processing)");
        if (status.warnings && Number(status.warnings) > 0) {
          console.log(`  ⚠ Warnings: ${status.warnings}`);
        }
        if (status.errors && Number(status.errors) > 0) {
          console.log(`  ✗ Errors: ${status.errors}`);
        }
        if (status.contents) {
          for (const c of status.contents) {
            console.log(`  ${c.type}: ${c.submitted} submitted · ${c.indexed} indexed`);
          }
        }
      }
    } catch (e) {
      console.log(`  ✗ FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log("");
  }

  console.log("═══ DONE ═══");
  console.log("Google will re-crawl over the next 24–72 hours.");
  console.log("Check progress in GSC: https://search.google.com/search-console/sitemaps?resource_id=" + encodeURIComponent(GSC_SITE_URL));
  console.log("");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
