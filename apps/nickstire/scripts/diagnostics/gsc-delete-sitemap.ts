/**
 * GSC Sitemap Deletion — unregisters sitemaps from Search Console.
 *
 * Use when sitemap files are retired (deleted from public/) but still
 * registered in GSC. Google keeps fetching them, gets HTML back
 * (SPA fallback), flags as errors. Deleting from GSC stops the retry.
 *
 * Requires the FULL `webmasters` scope (not readonly) — same scope as
 * gsc-submit-sitemap.ts.
 *
 * Run from repo root so dotenv picks up the root .env:
 *   DOTENV_CONFIG_PATH=.env node \
 *     node_modules/.pnpm/tsx@4.22.1/node_modules/tsx/dist/cli.mjs \
 *     apps/nickstire/scripts/gsc-delete-sitemap.ts
 */
import "dotenv/config";

const GSC_SITE_URL = "https://nickstire.org/";

// wave-181.40: these 2 sitemaps were retired May 5 (commit e3f419b0)
// but stayed registered in GSC. Each fetch returns HTML (SPA fallback)
// which Google flags as a sitemap error. Deleting clears the errors.
const SITEMAPS_TO_DELETE = [
  "https://nickstire.org/sitemap-vehicle-services.xml",
  "https://nickstire.org/sitemap-tires.xml",
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
      // Full webmasters scope needed for sitemaps.delete (vs readonly).
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
  const json = await res.json() as { access_token: string };
  return json.access_token;
}

async function deleteSitemap(token: string, sitemapUrl: string): Promise<{ ok: boolean; detail: string }> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) return { ok: true, detail: `HTTP ${res.status}` };
  const body = await res.text();
  return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
}

async function main(): Promise<void> {
  console.log("═══ GSC DELETE SITEMAP — nickstire.org ═══\n");

  const token = await getAccessToken();
  console.log("✓ Auth OK (full webmasters scope)\n");

  for (const sm of SITEMAPS_TO_DELETE) {
    process.stdout.write(`→ DELETE ${sm}  …  `);
    const { ok, detail } = await deleteSitemap(token, sm);
    console.log(ok ? `✅ ${detail}` : `❌ ${detail}`);
  }

  console.log("\nDone. Re-run gsc-errors.ts in a few minutes to confirm the errors clear.");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
