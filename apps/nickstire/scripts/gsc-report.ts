/**
 * One-command GSC report — `pnpm gsc:report`.
 *
 * Pulls a 90-day Google Search Console performance report (totals +
 * top queries + top pages) live from the Search Console API and prints
 * it. Read-only — no DB writes — safe to run anytime.
 *
 * Auth: the teezy-491218 service account (GOOGLE_SERVICE_ACCOUNT_EMAIL
 * / GOOGLE_SERVICE_ACCOUNT_KEY in .env), already registered as
 * siteOwner on the https://nickstire.org/ property. Same credentials
 * the GSC pipeline + sitemap-submit script use.
 *
 * Run: pnpm gsc:report   (or: pnpm tsx scripts/gsc-report.ts)
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { getGscReport } from "../server/pipelines/gsc-data";

// The populated .env lives at the monorepo root, not apps/nickstire/
// (which has no .env) — same resolution the inspect-vapi-* scripts use.
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pos = (n: number) => n.toFixed(1);

async function main(): Promise<void> {
  // GSC data lags ~2 days; end the window there and span 90 days back.
  const end = new Date(Date.now() - 2 * 86400000);
  const start = new Date(end.getTime() - 90 * 86400000);
  const range = {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };

  const r = await getGscReport(range);

  console.log(
    `\n=== GSC · nickstire.org · ${range.startDate} -> ${range.endDate} (90 days) ===\n`,
  );
  console.log(
    `Clicks ${r.summary.clicks}  ·  Impressions ${r.summary.impressions}  ·  ` +
      `CTR ${pct(r.summary.ctr)}  ·  Avg position ${pos(r.summary.position)}\n`,
  );

  console.log(`Top queries (${r.topQueries.length}):`);
  for (const q of r.topQueries) {
    console.log(
      `  ${String(q.clicks).padStart(4)}c ${String(q.impressions).padStart(7)}i  ` +
        `${pct(q.ctr).padStart(6)}  pos ${pos(q.position).padStart(5)}  ${q.key}`,
    );
  }

  console.log(`\nTop pages (${r.topPages.length}):`);
  for (const p of r.topPages) {
    console.log(
      `  ${String(p.clicks).padStart(4)}c ${String(p.impressions).padStart(7)}i  ` +
        `${pct(p.ctr).padStart(6)}  pos ${pos(p.position).padStart(5)}  ${p.key}`,
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
