/**
 * Corpus odometer (2026-08-06) — the one count that arms the fine-tune rows.
 *
 * Both UPSTREAMS WATCH rows (Unsloth/Axolotl LoRA · Ax/DSPy) reopen on the
 * same measured trigger — "outcomesNeedingReview has ~200+ real correction
 * cases" — and until now nothing counted. This script counts, READ-ONLY,
 * correction-shaped labels per source:
 *
 *   · intelligence_outcomes dismissed / judged-not-useful — the row's OWN
 *     named metric (the only count that literally satisfies the trigger text)
 *   · suggestion_loop operator taps (acted/dismissed/modified are verdicts;
 *     deferred means "busy", not a correction, and is reported separately)
 *   · blind A/B operator labels on prompt-comparison runs
 *   · ChatMessage thumbs (feedbackScore non-null)
 *   · mined refuted-claims JSONL (scripts/mine-refuted-claims.ts output),
 *     counted only if present locally — pending harvest review
 *
 * Machine judgments (reply_judgment) are deliberately NOT counted — counting
 * the judge's own output toward an operator-correction gate games the gate.
 *
 * Run:  pnpm exec tsx scripts/corpus-odometer.ts
 * Read-only: every query is a count/findMany; nothing writes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma";

const TRIGGER = 200;

async function main() {
  const corrections = await prisma.intelligenceOutcome.count({
    where: { OR: [{ decision: "dismissed" }, { outcomeUseful: false }] },
  });

  const suggestionRows = await prisma.brainMemory.findMany({
    where: { category: "suggestion_loop", deletedAt: null },
    select: { metadata: true },
    take: 5000,
  });
  const tapCounts: Record<string, number> = {};
  for (const r of suggestionRows) {
    const action = String((r.metadata as { action?: unknown } | null)?.action ?? "none");
    tapCounts[action] = (tapCounts[action] ?? 0) + 1;
  }
  const suggestionVerdicts =
    (tapCounts.acted ?? 0) + (tapCounts.dismissed ?? 0) + (tapCounts.modified ?? 0);

  const comparisonRows = await prisma.brainMemory.findMany({
    where: { category: "prompt_comparison_run", deletedAt: null },
    select: { metadata: true },
    take: 5000,
  });
  const abLabels = comparisonRows.filter((r) => {
    const m = r.metadata as { operatorLabel?: unknown; operator_label?: unknown } | null;
    return m?.operatorLabel != null || m?.operator_label != null;
  }).length;

  const thumbs = await prisma.chatMessage.count({ where: { feedbackScore: { not: null } } });

  let minedRefuted = 0;
  const minedPath = join(process.cwd(), "eval-datasets", "refuted-claims.jsonl");
  if (existsSync(minedPath)) {
    minedRefuted = readFileSync(minedPath, "utf8").split("\n").filter(Boolean).length;
  }

  const supplementary = suggestionVerdicts + abLabels + thumbs + minedRefuted;

  console.log("── corpus odometer (read-only) ──");
  console.log(`trigger metric — intelligence_outcomes corrections: ${corrections} / ${TRIGGER}`);
  console.log(`suggestion_loop taps: ${suggestionRows.length} rows · verdicts (acted/dismissed/modified): ${suggestionVerdicts} · breakdown: ${JSON.stringify(tapCounts)}`);
  console.log(`blind A/B operator labels: ${abLabels} of ${comparisonRows.length} comparison runs (MIN_TRUSTED_LABELS gate is 30)`);
  console.log(`chat thumbs (feedbackScore set): ${thumbs}`);
  console.log(`mined refuted-claims (pending harvest review): ${minedRefuted}`);
  console.log(`supplementary correction-shaped labels: ${supplementary}`);
  console.log(
    corrections >= TRIGGER
      ? `VERDICT: the UPSTREAMS trigger metric is MET — draft the row edit for operator review.`
      : `VERDICT: trigger metric at ${corrections}/${TRIGGER}; combined correction-shaped pool ${corrections + supplementary}. The row edit stays closed until the named metric crosses ${TRIGGER} or the operator amends the trigger.`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[corpus-odometer] fatal:", err);
  process.exit(1);
});
