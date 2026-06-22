/**
 * Schedule the 12 hand-built tire reels into the 6 PM ET publish-later queue.
 *
 * Inserts 12 rows into `scheduled_posts` (one per day, 6:00 PM America/New_York),
 * via the SAME drizzle client the `runScheduledPosts` cron reads with — so the
 * scheduledAt round-trip is self-consistent (no UTC/ET off-by-one). This is the
 * 6 PM track; it is fully INDEPENDENT of the 9 AM dailyReelPost campaign
 * (different mechanism: scheduled_posts table vs shop_settings KV, and different
 * reel numbers: 32-43 here vs 5-30 there).
 *
 * SAFETY:
 *  - DRY-RUN by default. Prints the 12 rows + HEAD-checks each video URL. Writes
 *    NOTHING. Pass `--commit` to actually insert.
 *  - Nothing posts to live IG until BOTH Railway arms are on at fire time:
 *    META_IG_USER_ID (set) + REEL_PUBLISH_ENABLED=true. If a row fires while the
 *    arm is off, runScheduledPosts marks it `failed` PERMANENTLY (no retry), so
 *    only --commit AFTER the arm is confirmed.
 *
 * Run from apps/nickstire:
 *   pnpm exec tsx scratch/schedule-6pm-reels.ts            # dry-run (default)
 *   pnpm exec tsx scratch/schedule-6pm-reels.ts --commit   # insert the rows
 *   pnpm exec tsx scratch/schedule-6pm-reels.ts --start 2026-06-19   # override day 1
 */
import { resolve } from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const HF = "https://huggingface.co/datasets/nourdean22/nt-reels/resolve/main";
const CAPTIONS = "C:/Users/nourd/reel-factory-out/captions.json";
const TZ = "America/New_York";
const POST_HOUR = 18; // 6 PM ET

// slug -> HF reel number. 32-43 are the first free numbers (4-31 already hosted;
// the 9 AM campaign owns 5-30). Order = posting order, one per consecutive day.
const PLAN: { slug: string; reel: number }[] = [
  { slug: "01-tire-pressure", reel: 32 },
  { slug: "02-tread-depth", reel: 33 },
  { slug: "03-brake-pads", reel: 34 },
  { slug: "04-alignment", reel: 35 },
  { slug: "05-winter-battery", reel: 36 },
  { slug: "06-oil-sludge", reel: 37 },
  { slug: "07-wiper-blades", reel: 38 },
  { slug: "08-tire-age", reel: 39 },
  { slug: "09-tpms-cold", reel: 40 },
  { slug: "10-pothole-rim", reel: 41 },
  { slug: "11-rotation", reel: 42 },
  { slug: "12-curb-alignment", reel: 43 },
];

/** Exact UTC instant of a wall-clock time in a named tz (DST-correct). */
function zonedToUtc(y: number, mo: number, d: number, hour: number, tz: string): Date {
  const asUtc = Date.UTC(y, mo, d, hour, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric", hour12: false,
  }).formatToParts(new Date(asUtc)).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
  const tzAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return new Date(asUtc + (asUtc - tzAsUtc));
}

function etLabel(d: Date): string {
  return d.toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const skip = Number(arg("--skip") ?? 0); // skip the first N of PLAN (e.g. one posted immediately)
  const plan = PLAN.slice(skip);
  const captions: Record<string, { caption: string; claimSafe: boolean }> = JSON.parse(fs.readFileSync(CAPTIONS, "utf8"));

  // Day 1 = tomorrow ET by default (today's 6 PM has passed), or --start YYYY-MM-DD.
  let startY: number, startMo: number, startD: number;
  const override = arg("--start");
  if (override) {
    const [y, m, d] = override.split("-").map(Number);
    startY = y; startMo = m - 1; startD = d;
  } else {
    const nowEt = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
    const t = new Date(nowEt); t.setDate(t.getDate() + 1);
    startY = t.getFullYear(); startMo = t.getMonth(); startD = t.getDate();
  }

  const rows = plan.map((p, i) => {
    const scheduledAt = zonedToUtc(startY, startMo, startD + i, POST_HOUR, TZ);
    const cap = captions[p.slug];
    return {
      slug: p.slug, reel: p.reel,
      videoUrl: `${HF}/reel${p.reel}.mp4`,
      caption: cap?.caption ?? "",
      claimSafe: cap?.claimSafe ?? false,
      scheduledAt,
    };
  });

  console.log(`\n${commit ? "COMMIT" : "DRY-RUN"} — ${rows.length} reels @ ${POST_HOUR === 18 ? "6 PM" : POST_HOUR} ET, one per day\n`);
  let allHosted = true, allSafe = true;
  for (const r of rows) {
    const head = await fetch(r.videoUrl, { method: "HEAD" }).catch(() => null);
    const hosted = !!head?.ok;
    if (!hosted) allHosted = false;
    if (!r.claimSafe) allSafe = false;
    console.log(`  reel${r.reel}  ${etLabel(r.scheduledAt)}  [${hosted ? "HOSTED" : "MISSING"}|${r.claimSafe ? "safe" : "UNSAFE"}]  ${r.slug}`);
    console.log(`         ${r.caption.split("\n")[0].slice(0, 80)}`);
  }
  const N = rows.length;
  console.log(`\n  hosted: ${allHosted ? `ALL ${N} ✓` : "SOME MISSING — upload reel32-43 first"}   claim-safe: ${allSafe ? `ALL ${N} ✓` : "REVIEW"}`);
  console.log(`  scheduledAt(UTC) day1: ${rows[0].scheduledAt.toISOString()}  day${N}: ${rows[N - 1].scheduledAt.toISOString()}\n`);

  if (!commit) {
    console.log("DRY-RUN — nothing written. Re-run with --commit to insert (only after REEL_PUBLISH_ENABLED is armed on Railway).\n");
    return;
  }

  if (!allHosted) {
    console.error("ABORT --commit: not all videos are hosted. Upload reel32-43 to HF first (a row that fires on a missing video is wasted).");
    process.exit(1);
  }

  const { getDb } = await import("../server/db");
  const { scheduledPosts } = await import("../drizzle/schema");
  const db = await getDb();
  if (!db) { console.error("ABORT: no DB (check DATABASE_URL)."); process.exit(1); }

  let inserted = 0;
  for (const r of rows) {
    await db.insert(scheduledPosts).values({
      platforms: ["instagram"],
      caption: r.caption,
      videoUrl: r.videoUrl,
      scheduledAt: r.scheduledAt,
      status: "pending",
    });
    inserted++;
    console.log(`  inserted reel${r.reel} → ${etLabel(r.scheduledAt)}`);
  }
  console.log(`\nDONE — ${inserted} rows inserted (status=pending). They post at 6 PM ET each day IF the Railway arms are on.\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
