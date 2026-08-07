/**
 * READ-ONLY preview of the weekly revenue digest.
 *
 * Computes the digest against the live invoice mirror and prints both the raw
 * data and the exact Telegram text — WITHOUT sending anything. It deliberately
 * calls computeWeeklyRevenueDigest + buildWeeklyRevenueDigestText rather than
 * runWeeklyRevenueDigest, so there is no Monday gate and no send path at all.
 *
 * Every query it triggers is a SELECT. It writes nothing.
 *
 *   pnpm exec tsx scripts/preview-weekly-digest.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(): void {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../apps/nickstire/.env")]) {
    try {
      for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      return;
    } catch { /* try next */ }
  }
}
loadEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing — inject it from the primary checkout's apps/nickstire/.env");
  process.exit(1);
}

const { computeWeeklyRevenueDigest, buildWeeklyRevenueDigestText, isShopMonday } =
  await import("../server/cron/jobs/weeklyRevenueDigest.js");

const now = new Date();
console.log(`now: ${now.toISOString()}  ·  isShopMonday=${isShopMonday(now)}`);

const t0 = Date.now();
const data = await computeWeeklyRevenueDigest(now);
const ms = Date.now() - t0;

console.log(`\n─── RAW DATA (${ms}ms) ───`);
console.log(JSON.stringify(data, null, 2));

console.log("\n─── RENDERED TELEGRAM MESSAGE ───");
console.log(buildWeeklyRevenueDigestText(data));
console.log("─── END (nothing was sent) ───");

process.exit(0);
