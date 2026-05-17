#!/usr/bin/env tsx
/**
 * scripts/prompt-shadow-summary.ts · v10.0.463
 *
 * Reads SystemMetric rows produced by the v1/v2 prompt shadow mode
 * and emits aggregate parity stats keyed to the cutover criteria
 * defined in `docs/v2-prompt-cutover-plan.md` (v10.0.459 · ADR-0003).
 *
 * Phase 0 of the v2 cutover · the script that lets the operator
 * answer "are the criteria satisfied yet?" in a single command.
 *
 * Telemetry shape (from lib/ai/prompt/v2/shadow-metrics.ts):
 *   metric "prompt.shadow.chars_delta"        unit "chars"  value=charsDelta
 *   metric "prompt.shadow.chars_delta_pct"    unit "pct"    value=delta%
 *   metric "prompt.shadow.sections_only_v1"   unit "count"  value=N
 *   metric "prompt.shadow.sections_only_v2"   unit "count"  value=N
 *   metric "prompt.shadow.build_failures"     unit "count"  value=1
 *   tags: { tier, slot, builderVersion, charsV1, charsV2 }
 *   source: "prompt-shadow"
 *
 * Usage:
 *   pnpm tsx scripts/prompt-shadow-summary.ts                 # human · 7 day window
 *   pnpm tsx scripts/prompt-shadow-summary.ts --days 3        # 3 day window
 *   pnpm tsx scripts/prompt-shadow-summary.ts --json          # JSON · CI gate
 *
 * Exit codes (CI gate semantics):
 *   0 = cutover criteria 1, 2, 3 PASS
 *   1 = at least one criterion FAIL
 *   2 = no data (shadow mode hasn't run · enable NICK_PRIME_PROMPT=shadow first)
 *
 * Skill provenance: prompt-engineering + claude-api +
 * production-code-audit (top-50 always-on floor).
 */

import { prisma } from "@/lib/prisma";

interface Tags {
  tier?: string;
  slot?: string;
  builderVersion?: string;
  charsV1?: number;
  charsV2?: number;
  error?: string;
}

interface MetricRow {
  metric: string;
  value: number;
  tags: Tags | null;
  createdAt: Date;
}

interface PerTierStats {
  tier: string;
  turnCount: number;
  avgCharsV1: number;
  avgCharsV2: number;
  avgDeltaPct: number;
  sumSectionsOnlyV1: number;
  sumSectionsOnlyV2: number;
  buildFailures: number;
  /** Criterion 1: structural drift · true when v1=v2 sections for ≥ 99% of turns. */
  structuralDriftPass: boolean;
  /** Criterion 2: token economy parity · true when -40% ≤ deltaPct ≤ +5% */
  tokenEconomyPass: boolean;
  /** Criterion 3: zero build failures over the window. */
  buildFailuresPass: boolean;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 7 : 7;
  return { json, days };
}

async function main() {
  const { json, days } = parseArgs();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = (await prisma.systemMetric.findMany({
    where: {
      source: "prompt-shadow",
      createdAt: { gte: since },
    },
    select: {
      metric: true,
      value: true,
      tags: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  })) as MetricRow[];

  if (rows.length === 0) {
    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "no_data",
            since: since.toISOString(),
            days,
            message:
              "No prompt-shadow telemetry in window · enable NICK_PRIME_PROMPT=shadow in production for 24-48h to populate",
          },
          null,
          2,
        ),
      );
    } else {
      console.log("");
      console.log(`Prompt shadow summary · last ${days}d · since ${since.toISOString()}`);
      console.log("");
      console.log("✗ NO DATA · shadow mode hasn't run in this window.");
      console.log("");
      console.log("To populate · set NICK_PRIME_PROMPT=shadow in Vercel env");
      console.log("vars and let the chat path accumulate 24-48h of paired");
      console.log("turns · then re-run this script.");
      console.log("");
    }
    process.exit(2);
  }

  // Group by tier (default "?" when missing) and aggregate.
  const tierBuckets = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const tier = (r.tags?.tier ?? "?") as string;
    const list = tierBuckets.get(tier) ?? [];
    list.push(r);
    tierBuckets.set(tier, list);
  }

  const perTier: PerTierStats[] = [];
  for (const [tier, list] of tierBuckets) {
    const charDeltaRows = list.filter((r) => r.metric === "prompt.shadow.chars_delta");
    const charDeltaPctRows = list.filter((r) => r.metric === "prompt.shadow.chars_delta_pct");
    const sectionsV1Rows = list.filter((r) => r.metric === "prompt.shadow.sections_only_v1");
    const sectionsV2Rows = list.filter((r) => r.metric === "prompt.shadow.sections_only_v2");
    const failureRows = list.filter((r) => r.metric === "prompt.shadow.build_failures");

    const turnCount = charDeltaRows.length;
    const avgCharsV1 =
      turnCount > 0
        ? charDeltaRows.reduce((s, r) => s + (Number(r.tags?.charsV1) || 0), 0) / turnCount
        : 0;
    const avgCharsV2 =
      turnCount > 0
        ? charDeltaRows.reduce((s, r) => s + (Number(r.tags?.charsV2) || 0), 0) / turnCount
        : 0;
    const avgDeltaPct =
      charDeltaPctRows.length > 0
        ? charDeltaPctRows.reduce((s, r) => s + r.value, 0) / charDeltaPctRows.length
        : 0;
    const sumSectionsOnlyV1 = sectionsV1Rows.reduce((s, r) => s + r.value, 0);
    const sumSectionsOnlyV2 = sectionsV2Rows.reduce((s, r) => s + r.value, 0);
    const buildFailures = failureRows.length;

    // Cutover criteria
    const structuralDriftPass =
      turnCount > 0 &&
      sumSectionsOnlyV1 / turnCount <= 0.01 &&
      sumSectionsOnlyV2 / turnCount <= 0.01;
    const tokenEconomyPass = avgDeltaPct >= -40 && avgDeltaPct <= 5;
    const buildFailuresPass = buildFailures === 0;

    perTier.push({
      tier,
      turnCount,
      avgCharsV1: Math.round(avgCharsV1),
      avgCharsV2: Math.round(avgCharsV2),
      avgDeltaPct: Math.round(avgDeltaPct * 10) / 10,
      sumSectionsOnlyV1,
      sumSectionsOnlyV2,
      buildFailures,
      structuralDriftPass,
      tokenEconomyPass,
      buildFailuresPass,
    });
  }

  // Sort descending by sample size so the most-confident tier reports first.
  perTier.sort((a, b) => b.turnCount - a.turnCount);

  const overall = {
    totalTurns: perTier.reduce((s, t) => s + t.turnCount, 0),
    totalBuildFailures: perTier.reduce((s, t) => s + t.buildFailures, 0),
    allTiersStructuralDriftPass: perTier.every((t) => t.structuralDriftPass),
    allTiersTokenEconomyPass: perTier.every((t) => t.tokenEconomyPass),
    allTiersBuildFailuresPass: perTier.every((t) => t.buildFailuresPass),
  };

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          status: "ok",
          since: since.toISOString(),
          days,
          overall,
          perTier,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("");
    console.log(`Prompt shadow summary · last ${days}d · since ${since.toISOString()}`);
    console.log(`Sample · ${overall.totalTurns} paired turns across ${perTier.length} tier(s)`);
    console.log("");
    console.log("Per-tier:");
    console.log("");
    for (const t of perTier) {
      console.log(`  ${t.tier} · ${t.turnCount} turns`);
      console.log(`    chars · v1=${t.avgCharsV1} · v2=${t.avgCharsV2} · Δ=${t.avgDeltaPct}%`);
      console.log(`    sections-only-in-v1: ${t.sumSectionsOnlyV1} (across all turns)`);
      console.log(`    sections-only-in-v2: ${t.sumSectionsOnlyV2}`);
      console.log(`    build failures: ${t.buildFailures}`);
      console.log(
        `    cutover criteria · structural=${t.structuralDriftPass ? "✓" : "✗"} · ` +
          `token-economy=${t.tokenEconomyPass ? "✓" : "✗"} · ` +
          `build-failures=${t.buildFailuresPass ? "✓" : "✗"}`,
      );
      console.log("");
    }

    console.log("Overall · cutover criteria 1, 2, 3:");
    console.log(`  · Criterion 1 (zero structural drift): ${overall.allTiersStructuralDriftPass ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  · Criterion 2 (token economy parity): ${overall.allTiersTokenEconomyPass ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  · Criterion 3 (zero build failures): ${overall.allTiersBuildFailuresPass ? "✓ PASS" : "✗ FAIL"}`);
    console.log("");
    console.log("(Criterion 4 = judge-eval delta · run scripts/prompt-judge-comparator.ts)");
    console.log("(Criterion 5 = rollback verified · operator confirms manually)");
    console.log("");
  }

  const allPass =
    overall.allTiersStructuralDriftPass &&
    overall.allTiersTokenEconomyPass &&
    overall.allTiersBuildFailuresPass;
  process.exit(allPass ? 0 : 1);
}

main()
  .catch((err) => {
    console.error("[prompt-shadow-summary] error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
