/**
 * Readout over the reel lane's shadow-judge corpus (2026-08-16).
 *
 * The reel lane has paid for an independent judge verdict on every
 * about-to-publish reel since 2026-08-13 (NT-001) and read it back exactly
 * never — `reel_shadow_judge_<jobId>` had two references in the whole repo,
 * both in the file that writes it, and the only read is a boolean dedupe
 * marker. This is its reader. A dataset nothing reads is the failure mode this
 * arc keeps rediscovering (see the same note atop ig-dual-judge-readout.ts).
 *
 * WHY THE CORPUS LIVES IN shop_settings. The image lane persists its verdicts
 * to `ig_autopost_log`, a queryable log table — which is why it could produce
 * the 5/25 readout that justified its 2026-08-07 gate flip. The reel lane wrote
 * the same measurement into the settings KV instead. That is the wrong
 * substrate, but it is LIKE-scannable, so this reads it where it is rather than
 * proposing a migration for data that already exists.
 *
 * THE DECISION THIS SERVES: should the reel shadow judge become a gate? The
 * image lane's answer came from a measured blind-spot rate, not from faith.
 * Flipping a gate on an unattended publisher is an operator decision — this
 * script only supplies the evidence.
 *
 * READ-ONLY. SELECTs only: no writes, no LLM calls, no publish path, no
 * external call. Note that this repo's only DATABASE_URL is production TiDB
 * (see .claude/skills/nickstire-verifier-reel-pipeline), so running it reads
 * prod. Reading is the entire contract; there is no flag that makes it write.
 *
 * Run:  pnpm exec tsx scripts/reel-shadow-judge-readout.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, inArray, like } from "drizzle-orm";

function loadEnvFromDotenv(): void {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* shell may already carry the vars */ }
}
loadEnvFromDotenv();

async function main(): Promise<void> {
  const { getDb } = await import("../server/db");
  const { shopSettings, reelJobs } = await import("../drizzle/schema");
  const {
    formatReelShadowReadout, parseJudgeRow, parseQcRow, summarizeReelShadow,
  } = await import("../server/services/reelShadowReadout");

  const db = await getDb();
  if (!db) {
    // An unreachable database is UNKNOWN, not an empty corpus. Exiting non-zero
    // keeps a failed run from reading as "no blind spots found".
    console.error("no database connection — this is unknown, not an empty corpus");
    process.exit(1);
  }

  const judgeKv = await db.select({ key: shopSettings.key, value: shopSettings.value })
    .from(shopSettings).where(like(shopSettings.key, "reel_shadow_judge_%"));
  const qcKv = await db.select({ key: shopSettings.key, value: shopSettings.value })
    .from(shopSettings).where(like(shopSettings.key, "reel_qc_checklist_%"));

  // `getDb()` yields an untyped client, so every row here is implicitly `any`.
  // Annotated explicitly rather than left inferred: scripts/ is OUTSIDE
  // tsconfig.json's include ("client/src", "shared", "server"), so `pnpm
  // typecheck` never looks at this file and an implicit any would go unreported.
  type KvRow = { key: string; value: string | null };

  const judge = (judgeKv as KvRow[])
    .map((r: KvRow) => parseJudgeRow(r.key, r.value))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const qc = (qcKv as KvRow[])
    .map((r: KvRow) => parseQcRow(r.key, r.value))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Outcome is read from reel_jobs, never copied into the KV row: the job table
  // already owns publish state, and a second copy of a decision the module
  // already makes is the invariant IG-EVIDENCE-ARCHITECTURE section 6 forbids.
  //
  // Deliberately a UNION of the judged ids and EVERY posted reel — not just the
  // judged ones. A judge that throws writes no KV row, so a reel that published
  // unjudged is invisible unless the posted set is fetched independently. That
  // difference is what `summary.coverage` reports.
  // briefId is fetched because it is what proves ELIGIBILITY: dailyReelPost
  // publishes only `autopost-<date>` jobs and the judge lives inside it, so a
  // reel published by the operator route or by contentManufacturing was never
  // judge-eligible. Counting those would fabricate a coverage gap — the same lie
  // as hiding one. summarizeReelShadow filters and reports what it excluded.
  type RawJobRow = { jobId: unknown; status: unknown; igPostId: unknown; briefId: unknown };
  const judgedIds = judge.map((r) => r.jobId);
  const toOutcome = (r: RawJobRow) => ({
    jobId: r.jobId as number, status: r.status as string,
    igPostId: r.igPostId as string | null, briefId: r.briefId as string | null,
  });
  const cols = {
    jobId: reelJobs.id, status: reelJobs.status,
    igPostId: reelJobs.igPostId, briefId: reelJobs.briefId,
  };

  const posted = ((await db.select(cols).from(reelJobs)
    .where(eq(reelJobs.status, "posted"))) as RawJobRow[]).map(toOutcome);
  const judgedRows = judgedIds.length
    ? ((await db.select(cols).from(reelJobs)
        .where(inArray(reelJobs.id, judgedIds))) as RawJobRow[]).map(toOutcome)
    : [];
  const byId = new Map([...posted, ...judgedRows].map((o) => [o.jobId, o]));
  const outcomes = [...byId.values()];

  const summary = summarizeReelShadow({ judge, qc, outcomes });
  for (const line of formatReelShadowReadout(summary)) console.log(line);

  if (summary.rows.length) {
    console.log("");
    console.log("PER-REEL");
    for (const r of summary.rows) {
      const score = r.total === null ? "  --" : String(r.total).padStart(4);
      const pub = r.published === null ? "unknown" : r.published ? "PUBLISHED" : "not posted";
      const qcTxt = r.qcFailCount === null ? "qc n/a" : `qc fails ${r.qcFailCount}`;
      console.log(`  job ${String(r.jobId).padStart(5)} ${score}  ${r.bucket.padEnd(11)} ${pub.padEnd(10)} ${qcTxt.padEnd(11)} ${r.label.slice(0, 44)}`);
      if (r.bucket === "would_block" && r.note) console.log(`${" ".repeat(12)}why: ${r.note.slice(0, 120)}`);
    }
  }

  console.log("");
  console.log("This readout does not change any gate. Promoting the reel shadow judge");
  console.log("to a blocking gate is an operator decision on a live unattended");
  console.log("publisher — the image lane's equivalent flip was 2026-08-07.");
}

// `process.exit(0)` is required, not decoration: getDb() opens a mysql2 pool
// with no exported close, so without it the script prints everything and then
// HANGS until the operator interrupts it. Caught by actually running this — the
// verification harness's timeout killed the child and reported exit `null`.
// Same shape as scripts/data-census.ts:122, the repo's existing DB-script tail.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("readout failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
