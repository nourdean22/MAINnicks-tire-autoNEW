/**
 * scripts/tool-reachability-census.ts — re-measure tool reachability (2026-09-18).
 *
 * WHY THIS EXISTS RATHER THAN A FIX.
 * The capability-routing bottleneck is the single most-cited measured defect in
 * this system: a 467-turn census recorded ~8.4 of 24 tool slots per turn spent
 * on tools never chosen, 3,911 wasted impressions across 101 tools, 72.9% of
 * turns hitting the budget cliff, and `searchWebVerified` / `githubRecentCommits`
 * budgeted out 52 and 53 times.
 *
 * ⚠ THAT CENSUS PREDATES THE FIXES. Acting on it now would tune against a stale
 * measurement — the same error class caught three times in this session
 * (a hybrid lane measured with its vector half removed; a 48% lexical "regression"
 * that was self-inflicted load; a corpus sampler whose comment asserted a spread
 * it never had). So this script re-measures FIRST and prints the comparison,
 * rather than pruning tools on a number that may no longer be true.
 *
 * ⚠ IT REFUSES TO CONCLUDE ON THIN DATA. A census over a handful of post-fix
 * turns is not evidence that anything improved; below MIN_TURNS it says so and
 * declines to compare. An underpowered census that renders as a verdict is how
 * a stale number gets replaced by a wrong one.
 *
 * Read-only: groupBy + findMany only.
 *
 * Usage (from apps/statenour):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/tool-reachability-census.ts
 */
import { loadEnvConfig } from "@next/env";
import Module from "node:module";

loadEnvConfig(process.cwd());

{
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

/** The recorded pre-fix baseline, for comparison only. */
const BASELINE = {
  label: "pre-fix census (.remember, 467 turns)",
  turns: 467,
  budgetTruncatedPct: 72.9,
  semanticTierSkippedPct: 70.3,
};

/**
 * Below this many post-fix turns, the census reports and REFUSES to compare.
 * 100 is the threshold the audit packet itself named ("≥100 genuinely post-fix
 * turns with candidate/rank/budget/outcome telemetry").
 */
const MIN_TURNS = 100;

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required — run under `railway run -s statenour-web --`");
    process.exit(1);
  }
  const { prisma } = await import("../lib/prisma");

  // ── Which fixes, and when did they land? ────────────────────────────────
  // The tier-4 relevance-ordering fix is the one the packet flags as NOT yet
  // prod-proven. Everything on or after this timestamp is "post-fix".
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  const since = new Date(sinceArg ? sinceArg.slice(8) : "2026-09-17T00:00:00Z");

  const [total, post] = await Promise.all([
    prisma.toolSelectionTurn.count(),
    prisma.toolSelectionTurn.count({ where: { createdAt: { gte: since } } }),
  ]);

  console.log(`tool-reachability census · all turns ${total} · since ${since.toISOString().slice(0, 10)}: ${post}`);
  console.log("");

  if (post === 0) {
    console.log("NO POST-FIX TURNS RECORDED. Nothing to measure — this is UNMEASURED, not 'unchanged'.");
    await prisma.$disconnect();
    return;
  }

  const rows = await prisma.toolSelectionTurn.findMany({
    where: { createdAt: { gte: since } },
    select: {
      mode: true,
      candidateCount: true,
      selectedCount: true,
      budget: true,
      budgetTruncated: true,
      semanticTierAttempted: true,
      searchToolsFired: true,
      invokeToolFired: true,
      forcedToolName: true,
      forcedToolHonored: true,
    },
  });

  const truncated = rows.filter((r) => r.budgetTruncated).length;
  const semanticSkipped = rows.filter((r) => r.semanticTierAttempted === false).length;
  const semanticUnknown = rows.filter((r) => r.semanticTierAttempted === null).length;
  const searchFired = rows.filter((r) => r.searchToolsFired).length;
  const invoked = rows.filter((r) => r.invokeToolFired).length;
  const forced = rows.filter((r) => r.forcedToolName !== null);
  const forcedDishonored = forced.filter((r) => r.forcedToolHonored === false).length;

  const cand = rows.map((r) => r.candidateCount).sort((a, b) => a - b);
  const sel = rows.map((r) => r.selectedCount).sort((a, b) => a - b);
  const p50 = (a: number[]) => (a.length ? a[Math.floor(a.length * 0.5)] : 0);

  console.log("POST-FIX (n=" + rows.length + ")");
  console.log(`  budget truncated      : ${truncated} (${pct(truncated, rows.length)}%)   baseline ${BASELINE.budgetTruncatedPct}%`);
  console.log(`  semantic tier SKIPPED : ${semanticSkipped} (${pct(semanticSkipped, rows.length)}%)   baseline ${BASELINE.semanticTierSkippedPct}%`);
  if (semanticUnknown > 0) {
    console.log(`  semantic tier UNKNOWN : ${semanticUnknown} (${pct(semanticUnknown, rows.length)}%) <- null, NOT counted as skipped`);
  }
  console.log(`  recovery searchTools  : ${searchFired} (${pct(searchFired, rows.length)}%)`);
  console.log(`  invokeTool fired      : ${invoked} (${pct(invoked, rows.length)}%)`);
  console.log(`  forced tool DISHONORED: ${forcedDishonored} of ${forced.length} forced`);
  console.log(`  candidates p50        : ${p50(cand)}    selected p50: ${p50(sel)}`);
  console.log("");

  // ── Tools that are SURFACED but never CHOSEN ────────────────────────────
  // This is the wasted-impression number. tool_telemetry counts CALLS, so a
  // tool with totalCalls = 0 has never been chosen at all.
  const tel = await prisma.toolTelemetry.findMany({
    select: { toolName: true, totalCalls: true, failCount: true, lastCallAt: true },
  });
  const never = tel.filter((t) => t.totalCalls === 0);
  const lowVolume = tel.filter((t) => t.totalCalls > 0 && t.totalCalls <= 2);
  console.log(`TOOL TELEMETRY · ${tel.length} tools with a row`);
  console.log(`  NEVER called          : ${never.length}`);
  console.log(`  called 1-2 times      : ${lowVolume.length}`);
  // ⚠⚠ failCount/totalCalls IS A LIFETIME RATIO WITH NO TIME WINDOW.
  //
  // The first version of this block printed it as a current defect list and was
  // WRONG on its own first run: `createMissionPlan` showed "3/4 failed" (75%)
  // and `getRecentReflections` "2/6" — but their failures decode to JUNE 2026,
  // their schemas have since been fixed (the enum describe() literally names
  // `"personal"` as invalid, and the limit says "MAXIMUM 20"), and neither has
  // been called since. A tool that failed three times in June reads as 75%
  // failing FOREVER, because nothing ages the counter out.
  //
  // So the age is printed BESIDE the ratio, and anything stale is labelled
  // rather than listed as a finding. A ratio with no denominator in TIME is the
  // same defect shape as a rate with no denominator in volume.
  const STALE_DAYS = 14;
  const now = Date.now();
  const ageDays = (d: Date | null) =>
    d === null ? Infinity : Math.floor((now - d.getTime()) / 86_400_000);
  const failing = tel
    .filter((t) => t.totalCalls >= 3 && t.failCount / t.totalCalls > 0.3)
    .sort((a, b) => b.failCount / b.totalCalls - a.failCount / a.totalCalls);
  if (failing.length > 0) {
    const live = failing.filter((t) => ageDays(t.lastCallAt) <= STALE_DAYS);
    const stale = failing.filter((t) => ageDays(t.lastCallAt) > STALE_DAYS);
    console.log(`  >30% LIFETIME failure rate (n>=3) — ratio is cumulative, never aged out:`);
    for (const t of live) {
      console.log(
        `    LIVE  ${t.toolName.padEnd(26)} ${t.failCount}/${t.totalCalls}  last call ${ageDays(t.lastCallAt)}d ago`,
      );
    }
    for (const t of stale) {
      console.log(
        `    STALE ${t.toolName.padEnd(26)} ${t.failCount}/${t.totalCalls}  last call ${ageDays(t.lastCallAt)}d ago — NOT current evidence`,
      );
    }
    if (live.length === 0) {
      console.log(`    (no tool has failed inside the last ${STALE_DAYS}d — every row above is history)`);
    }
  }
  console.log("");

  // ── The verdict, or the refusal ─────────────────────────────────────────
  if (rows.length < MIN_TURNS) {
    console.log(
      `VERDICT: WITHHELD. ${rows.length} post-fix turns is below the ${MIN_TURNS}-turn floor the audit` +
        " itself named. These numbers are printed for visibility, NOT as evidence the fixes worked.",
    );
    console.log(
      "  Pruning tools on an underpowered census would replace a stale number with a wrong one.",
    );
  } else {
    const dTrunc = pct(truncated, rows.length) - BASELINE.budgetTruncatedPct;
    const dSem = pct(semanticSkipped, rows.length) - BASELINE.semanticTierSkippedPct;
    console.log(
      `VERDICT: comparable (n=${rows.length} >= ${MIN_TURNS}). budget-cliff ${dTrunc > 0 ? "+" : ""}${dTrunc.toFixed(1)} pts,` +
        ` semantic-skip ${dSem > 0 ? "+" : ""}${dSem.toFixed(1)} pts vs the ${BASELINE.turns}-turn baseline.`,
    );
    console.log(
      "  ⚠ Different populations: the baseline window and this one are not the same traffic mix.",
    );
  }

  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
