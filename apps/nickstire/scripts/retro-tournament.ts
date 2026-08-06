/**
 * Retro-tournament (2026-08-06) — the operator-only judge blind-grades what
 * the robots already shipped.
 *
 * The concept tournament was built to kill self-evaluation, yet the
 * autonomous lanes self-score. Forward-shadowing landed in #1389; this is the
 * BACKWARD pass: pull recent ig_autopost_log rows, run each caption through
 * the tournament's independent judge (field of one), join engagement from
 * ig_metric_snapshots, and print two readouts:
 *
 *   1. Does the 100pt rubric correlate with realized engagement at all
 *      (rank agreement judge-vs-shares)?
 *   2. How many posts the dual self-eval passed (>= 0.7) that the judge
 *      flunks (< 60 or hard-rejects) — the measured size of the
 *      self-grading blind spot.
 *
 * READ-ONLY against the DB; spends ~1 LLM judge call per row. Directional
 * at current volumes, not calibration — say so when reporting.
 *
 * Run:  pnpm exec tsx scripts/retro-tournament.ts --probe     # 1 judge call, no DB — credits check
 *       pnpm exec tsx scripts/retro-tournament.ts --limit 20
 */

/**
 * Script-shell env bootstrap: the server loads its env at boot, but a bare
 * tsx shell does not — the first probe run failed on a missing GEMINI key
 * exactly here. Populates only MISSING vars from apps/nickstire/.env
 * (read-only; same file the hand-applied migration runners read).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFromDotenv(): void {
  try {
    // cwd is apps/nickstire when run per the header instructions. The first
    // version used require()+__dirname, which dies silently under tsx ESM.
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // absent .env is fine — the shell may already carry the vars
  }
}
loadEnvFromDotenv();

interface Row {
  id: number;
  conceptKey: string;
  archetype: string;
  status: string;
  caption: string;
  imagePrompt: string;
  overallScore: number | null;
  igPostId: string | null;
  createdAt: Date;
}

const PROBE_CONCEPT = {
  title: "credits-probe",
  hook: "Cleveland potholes do not schedule appointments.",
  coreIdea: "A blunt seasonal post: what a pothole hit actually does to alignment, and why a quick check beats a bent rim discovered in July.",
  visualIdea: "One decisive photo of a pothole-scarred East Side street.",
  whyItWorks: "Concrete, local, teaches one verifiable mechanic truth.",
};

async function probe(): Promise<boolean> {
  const { judgeSingleConcept } = await import("../server/services/conceptTournament");
  try {
    const v = await judgeSingleConcept({ campaignAsk: "Probe: judge lane liveness check", concept: PROBE_CONCEPT });
    console.log(`probe OK — judge lane is live: total=${v.total} rejected=${v.rejected}`);
    return true;
  } catch (err) {
    console.log(`probe FAILED — judge lane is down: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Rank agreement in [-1, 1] over pairs (Kendall-style, ties skipped). */
function rankAgreement(pairs: Array<{ a: number; b: number }>): { tau: number; usable: number } {
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const da = pairs[i].a - pairs[j].a;
      const db = pairs[i].b - pairs[j].b;
      if (da === 0 || db === 0) continue;
      if (da * db > 0) concordant++;
      else discordant++;
    }
  }
  const usable = concordant + discordant;
  return { tau: usable ? (concordant - discordant) / usable : 0, usable };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--probe")) {
    process.exit((await probe()) ? 0 : 1);
  }
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Math.max(1, Math.min(50, parseInt(args[limitIdx + 1], 10) || 20)) : 20;

  if (!(await probe())) {
    console.log("aborting the batch — fix the judge lane first (OpenRouter credits were dead 2026-07-17).");
    process.exit(1);
  }

  const { getDb } = await import("../server/db");
  const d = await getDb();
  if (!d) throw new Error("no DB");
  const { igAutopostLog, igMetricSnapshots } = await import("../drizzle/schema");
  const { desc, inArray, sql } = await import("drizzle-orm");

  // Prefer what actually SHIPPED; fall back to dryruns if the lane is dark.
  const rows = (await d.select({
    id: igAutopostLog.id,
    conceptKey: igAutopostLog.conceptKey,
    archetype: igAutopostLog.archetype,
    status: igAutopostLog.status,
    caption: igAutopostLog.caption,
    imagePrompt: igAutopostLog.imagePrompt,
    overallScore: igAutopostLog.overallScore,
    igPostId: igAutopostLog.igPostId,
    createdAt: igAutopostLog.createdAt,
  }).from(igAutopostLog)
    .where(sql`${igAutopostLog.status} IN ('posted','dryrun') AND ${igAutopostLog.caption} <> ''`)
    .orderBy(desc(igAutopostLog.createdAt))
    .limit(limit)) as Row[];

  if (!rows.length) {
    console.log("no posted/dryrun rows found — nothing to grade");
    process.exit(0);
  }

  const postIds = rows.map((r) => r.igPostId).filter((x): x is string => Boolean(x));
  const snaps = postIds.length
    ? await d.select().from(igMetricSnapshots).where(inArray(igMetricSnapshots.postId, postIds))
    : [];
  const bestShares = new Map<string, number>();
  const bestReach = new Map<string, number>();
  for (const s of snaps as Array<Record<string, unknown>>) {
    const pid = String(s.postId);
    if (typeof s.shares === "number") bestShares.set(pid, Math.max(bestShares.get(pid) ?? 0, s.shares));
    if (typeof s.reach === "number") bestReach.set(pid, Math.max(bestReach.get(pid) ?? 0, s.reach));
  }

  const { judgeSingleConcept } = await import("../server/services/conceptTournament");
  const graded: Array<Row & { judgeTotal: number; rejected: boolean; note: string; shares: number | null; reach: number | null }> = [];
  for (const r of rows) {
    try {
      const v = await judgeSingleConcept({
        campaignAsk: `Autonomous ${r.archetype} Instagram post for the shop feed (retro-grade)`,
        priority: 3, // historical backgrading yields to live + shadow work
        concept: {
          title: r.conceptKey,
          hook: r.caption.split("\n")[0] ?? r.caption.slice(0, 120),
          coreIdea: r.caption,
          visualIdea: r.imagePrompt,
          whyItWorks: "retro-graded published draft",
        },
      });
      graded.push({
        ...r,
        judgeTotal: v.total,
        rejected: v.rejected,
        note: (v.note || v.rejectionReason).slice(0, 120),
        shares: r.igPostId ? bestShares.get(r.igPostId) ?? null : null,
        reach: r.igPostId ? bestReach.get(r.igPostId) ?? null : null,
      });
      console.log(`graded ${r.id} (${r.status}) self=${r.overallScore ?? "?"} judge=${v.total}${v.rejected ? " REJECTED" : ""}`);
    } catch (err) {
      console.log(`grade failed for row ${r.id}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    }
  }

  const withEngagement = graded.filter((g) => g.shares != null);
  const { tau, usable } = rankAgreement(withEngagement.map((g) => ({ a: g.judgeTotal, b: g.shares ?? 0 })));
  const selfPassJudgeFlunk = graded.filter((g) => (g.overallScore ?? 0) >= 70 && (g.judgeTotal < 60 || g.rejected));

  console.log("\n── retro-tournament readout ──");
  console.log(`graded ${graded.length}/${rows.length} rows (${graded.filter((g) => g.status === "posted").length} posted, rest dryrun)`);
  console.log(`judge-vs-shares rank agreement: tau=${tau.toFixed(2)} over ${usable} usable pairs (${withEngagement.length} rows had snapshots) — DIRECTIONAL at this n, not calibration`);
  console.log(`self-eval blind spot: ${selfPassJudgeFlunk.length}/${graded.length} passed self-eval >=0.7 but judge scored <60 or rejected`);
  for (const g of selfPassJudgeFlunk.slice(0, 8)) {
    console.log(`  · row ${g.id} ${g.conceptKey} self=${g.overallScore} judge=${g.judgeTotal}${g.rejected ? " REJECTED" : ""} — ${g.note}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[retro-tournament] fatal:", err);
  process.exit(1);
});
