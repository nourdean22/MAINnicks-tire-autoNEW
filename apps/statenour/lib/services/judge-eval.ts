/**
 * lib/services/judge-eval.ts · Phase V (2026-05-18 PM)
 *
 * Aggregates the prompt-comparison rows from
 * lib/ai/judge-eval/persistence.ts into the dashboard payload the
 * /system/judge-eval surface renders. Same shared-service pattern
 * as buildHealthReport / buildLensStats · the tRPC procedure +
 * any future cron / probe / report consumer all call this single
 * function.
 *
 * Recommendation pillar of the AGENT_V1 → AGENT_V2 cutover plan
 * (docs/migrations/agent-v1-to-v2.md):
 *
 *   > Phase 1 canary requirement · daily judge-eval comparator runs
 *   > · alerts on regression. 7-day observation window before promotion.
 *
 * The `verdict` field below is the alerting hook · a downstream cron
 * can read `judgeEvalSummary` and trip a Telegram alert when verdict
 * flips from "safe" to "regressing".
 */

import {
  readComparisonHeads,
  readComparisons,
  type ComparisonHead,
  type ComparisonRow,
} from "@/lib/ai/judge-eval/persistence";

export type Verdict = "safe" | "watch" | "regressing" | "insufficient-data";

export interface WinRateBucket {
  label: string;
  total: number;
  v2Wins: number;
  v1Wins: number;
  ties: number;
  /** % of runs where v2 won · 0-100 · -1 when total = 0. */
  v2WinPct: number;
}

export interface IntentBreakdown extends WinRateBucket {
  intentClass: string;
}

export interface JudgeEvalSummary {
  generatedAt: string;
  totalRuns: number;
  /** Mean v2Score across all runs · 50 = pure tie · -1 when no runs. */
  meanV2Score: number;
  /** Roll-up over the last 7 days (canary observation window). */
  last7d: WinRateBucket;
  /** Roll-up over the last 24 hours (alerting window). */
  last24h: WinRateBucket;
  /** Per-intent-class breakdowns · sorted by total runs desc. */
  byIntent: IntentBreakdown[];
  /** 10 most recent comparison runs · for the recent-runs table. */
  recent: ComparisonRow[];
  /** Operator-readable verdict on the rolling 7d window. */
  verdict: Verdict;
  /** 1-line reason behind the verdict · for the dashboard chip + alerts. */
  verdictReason: string;
}

/**
 * Verdict thresholds. These match the Phase 1 canary criteria in the
 * agent-v1-to-v2 migration doc:
 *
 *   · safe        · ≥50 runs over 7d AND v2 win % ≥ 50 (V2 not losing)
 *   · watch       · ≥50 runs over 7d AND v2 win % 40-49 (close call)
 *   · regressing  · ≥50 runs over 7d AND v2 win % < 40 (V2 clearly losing)
 *   · insufficient-data · < 50 runs in 7d (not enough signal yet)
 */
const MIN_SAMPLE_FOR_VERDICT = 50;
const SAFE_THRESHOLD_PCT = 50;
const WATCH_THRESHOLD_PCT = 40;

function emptyBucket(label: string): WinRateBucket {
  return { label, total: 0, v2Wins: 0, v1Wins: 0, ties: 0, v2WinPct: -1 };
}

function rollup(heads: ComparisonHead[], label: string): WinRateBucket {
  if (heads.length === 0) return emptyBucket(label);
  let v2 = 0;
  let v1 = 0;
  let tie = 0;
  for (const h of heads) {
    if (h.winner === "v2") v2++;
    else if (h.winner === "v1") v1++;
    else tie++;
  }
  const total = heads.length;
  const v2WinPct = Number(((v2 / total) * 100).toFixed(1));
  return { label, total, v2Wins: v2, v1Wins: v1, ties: tie, v2WinPct };
}

function computeVerdict(last7d: WinRateBucket): { verdict: Verdict; reason: string } {
  if (last7d.total < MIN_SAMPLE_FOR_VERDICT) {
    return {
      verdict: "insufficient-data",
      reason: `Only ${last7d.total} runs in 7d · need ≥${MIN_SAMPLE_FOR_VERDICT} for a confident verdict`,
    };
  }
  if (last7d.v2WinPct < WATCH_THRESHOLD_PCT) {
    return {
      verdict: "regressing",
      reason: `V2 win rate ${last7d.v2WinPct}% over ${last7d.total} runs · below ${WATCH_THRESHOLD_PCT}% threshold · investigate before promoting`,
    };
  }
  if (last7d.v2WinPct < SAFE_THRESHOLD_PCT) {
    return {
      verdict: "watch",
      reason: `V2 win rate ${last7d.v2WinPct}% over ${last7d.total} runs · between ${WATCH_THRESHOLD_PCT}% and ${SAFE_THRESHOLD_PCT}% · monitor closely`,
    };
  }
  return {
    verdict: "safe",
    reason: `V2 win rate ${last7d.v2WinPct}% over ${last7d.total} runs · above ${SAFE_THRESHOLD_PCT}% safe threshold · canary promotion OK`,
  };
}

export async function buildJudgeEvalSummary(): Promise<JudgeEvalSummary> {
  // 7d heads drive the verdict + rolling rollups
  const heads7d = await readComparisonHeads({ sinceDays: 7 });
  const heads24h = heads7d.filter(
    (h) => Date.now() - new Date(h.createdAt).getTime() < 86_400_000,
  );

  const last7d = rollup(heads7d, "last 7d");
  const last24h = rollup(heads24h, "last 24h");

  // Per-intent breakdown · 7d window
  const byIntentMap = new Map<string, ComparisonHead[]>();
  for (const h of heads7d) {
    const key = h.intentClass ?? "(unclassified)";
    const arr = byIntentMap.get(key) ?? [];
    arr.push(h);
    byIntentMap.set(key, arr);
  }
  const byIntent: IntentBreakdown[] = Array.from(byIntentMap.entries())
    .map(([intentClass, hs]) => ({
      ...rollup(hs, intentClass),
      intentClass,
    }))
    .sort((a, b) => b.total - a.total);

  // Recent comparison runs · full payload for the recent-runs table
  const recent = await readComparisons({ take: 10 });

  // Mean v2Score across all 7d runs
  const meanV2Score =
    heads7d.length === 0
      ? -1
      : Number(
          (
            heads7d.reduce((s, h) => s + h.v2Score, 0) / heads7d.length
          ).toFixed(1),
        );

  const { verdict, reason } = computeVerdict(last7d);

  return {
    generatedAt: new Date().toISOString(),
    totalRuns: last7d.total,
    meanV2Score,
    last7d,
    last24h,
    byIntent,
    recent,
    verdict,
    verdictReason: reason,
  };
}
