/**
 * GSC top-pages pull for nickstire.org — ad-factory Phase 0.
 * Mirrors the JWT service-account pattern from server/sheets-sync.ts,
 * scope swapped to Search Console read-only. Tries both property
 * formats (sc-domain: and URL-prefix). Run from apps/nickstire so
 * googleapis resolves:  pnpm exec tsx <this file>
 */
import path from "node:path";
import fs from "node:fs";

const NICKSTIRE_DIR = "C:/Users/nourd/NOURCITY/apps/nickstire";

// Minimal .env parse — dotenv isn't resolvable from outside the app tree.
// Handles multi-line quoted values (the service-account PEM key spans
// many lines in the local .env).
const envText = fs.readFileSync(path.join(NICKSTIRE_DIR, ".env"), "utf8");
const env: Record<string, string> = {};
{
  const lines = envText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let value = m[2];
    const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
    if (quote && !(value.length > 1 && value.endsWith(quote))) {
      // Multi-line quoted value: consume until the closing quote line.
      const parts = [value.slice(1)];
      while (++i < lines.length) {
        if (lines[i].endsWith(quote)) {
          parts.push(lines[i].slice(0, -1));
          break;
        }
        parts.push(lines[i]);
      }
      value = parts.join("\n");
    } else if (quote) {
      value = value.slice(1, -1);
    }
    env[m[1]] = value;
  }
}

const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const rawKey = env.GOOGLE_SERVICE_ACCOUNT_KEY;
if (!email || !rawKey) {
  console.error("MISSING_SERVICE_ACCOUNT_ENV");
  process.exit(2);
}
const privateKey = rawKey.replace(/\\n/g, "\n");

const { google } = await import("googleapis");
const auth = new google.auth.JWT({
  email,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
});
const sc = google.searchconsole({ version: "v1", auth });

const CANDIDATE_PROPERTIES = [
  "sc-domain:nickstire.org",
  "https://nickstire.org/",
  "https://www.nickstire.org/",
];

const end = new Date();
const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

let lastErr = "";
for (const siteUrl of CANDIDATE_PROPERTIES) {
  try {
    const res = await sc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: fmt(start),
        endDate: fmt(end),
        dimensions: ["page"],
        rowLimit: 25,
      },
    });
    const rows = (res.data.rows ?? []).map((r) => ({
      page: r.keys?.[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Number(((r.ctr ?? 0) * 100).toFixed(2)),
      position: Number((r.position ?? 0).toFixed(1)),
    }));
    const out = { property: siteUrl, range: { from: fmt(start), to: fmt(end) }, rows };
    fs.writeFileSync(
      "C:/Users/nourd/NOURCITY/ad-factory/2026-07-04/gsc-top-pages.json",
      JSON.stringify(out, null, 2),
    );
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  } catch (e: any) {
    lastErr = `${siteUrl} -> ${e?.response?.status ?? ""} ${e?.message ?? e}`;
    console.error("TRY_FAILED:", lastErr);
  }
}
console.error("ALL_PROPERTIES_FAILED");
process.exit(1);
