import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { CORRECTION_WHERE, outcomeStats } from "@/lib/services/outcome-ledger";
export const maxDuration = 60;

/**
 * GET /api/cron/outcome-harvest — the corpus odometer, automated.
 *
 * 2026-08-19 · outcome-loop wave follow-up (operator-ordered). The
 * outcome-loop's last hop terminated in a human: `outcomeUseful` had
 * writers but its only readers were hand-run scripts
 * (harvest-eval-corpus / export-eval-datasets / corpus-odometer), so
 * nothing ever NOTICED the corpus growing. This cron is the automated
 * reader — the measurement half of the WP-21 truth flywheel.
 *
 * Deliberately NOT automated here, by design:
 *   - the harvest FILE (eval-datasets/*.json) — "local no-send first":
 *     it carries real operator content and is reviewed by a human
 *     before promotion; Railway's FS is ephemeral anyway.
 *   - eval REPLAY — burns AI spend; stays an operator-run `pnpm` lane.
 *   - the mined refuted-claims JSONL — local-only artifact, uncounted
 *     here rather than pretended at zero.
 *
 * What it does: counts correction-shaped labels per source (read-only),
 * mirrors scripts/corpus-odometer.ts exactly — including its rule that
 * machine judgments (reply_judgment) are NEVER counted, because counting
 * the judge's own output toward an operator-correction gate games the
 * gate — then upserts ONE rolling `eval_run` BrainMemory row so the
 * digest/health surfaces (and any session) can read flywheel growth
 * without shell access. The UPSTREAMS fine-tune trigger (200 corrections)
 * is reported loudly the week it crosses.
 *
 * Schedule: WEEKLY via the Sunday-ET mega-evening fan-out
 * (config/crons.ts + lib/inngest/jobs.ts WEEKLY_JOBS).
 */

const TRIGGER = 200;
const ODOMETER_KEY = "eval_run:corpus-odometer";

export const GET = cronHandler(async () => {
  // The trigger metric — the count both UPSTREAMS WATCH rows (LoRA
  // fine-tune · Ax/DSPy) reopen on. All-time, matching the script.
  const corrections = await prisma.intelligenceOutcome.count({
    where: CORRECTION_WHERE,
  });

  // Supplementary correction-shaped labels (same sources as the script).
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

  const thumbs = await prisma.chatMessage.count({
    where: { feedbackScore: { not: null } },
  });

  const supplementary = suggestionVerdicts + abLabels + thumbs;
  const triggerMet = corrections >= TRIGGER;

  // 2026-08-28 · learning-loops wave: second metric. The 200 above is
  // FINE-TUNE volume for the UPSTREAMS WATCH rows; eval decision-grade-ness
  // is a different, nearer gate — LABEL-BEARING harvested cases
  // (noise-verdict discoveries whose own key is the forbidden key).
  // 30 mirrors MIN_TRUSTED_LABELS (judge-eval/calibration.ts).
  const { countLabeledEvalCases } = await import("@/lib/brain/recall-corpus-builder");
  const labeledCases = await countLabeledEvalCases().catch(() => -1);
  const LABELED_TRIGGER = 30;

  // 30d ledger flow (shown → decided → useful) so the row also answers
  // "is the loop MOVING this month", not just the all-time gate.
  const stats = await outcomeStats(30);

  const content =
    `Corpus odometer: ${corrections}/${TRIGGER} intelligence_outcomes corrections` +
    ` (trigger ${triggerMet ? "MET — draft the UPSTREAMS row edit for operator review" : "not met"});` +
    ` labeled eval cases ${labeledCases < 0 ? "unknown (count failed)" : `${labeledCases}/${LABELED_TRIGGER}`}` +
    ` (noise-verdict discoveries -> forbiddenKeys — the eval decision-grade gate);` +
    ` supplementary correction-shaped labels ${supplementary}` +
    ` (suggestion verdicts ${suggestionVerdicts} · A/B labels ${abLabels} · chat thumbs ${thumbs});` +
    ` 30d ledger flow: shown ${stats?.shown ?? "unknown"} · decided ${stats?.decided ?? "unknown"}` +
    ` · useful true/false ${stats?.usefulTrue ?? "?"}/${stats?.usefulFalse ?? "?"}.`;

  const metadata = {
    runAt: new Date().toISOString(),
    corrections,
    trigger: TRIGGER,
    triggerMet,
    labeledCases,
    labeledTrigger: LABELED_TRIGGER,
    suggestionVerdicts,
    tapCounts,
    abLabels,
    comparisonRuns: comparisonRows.length,
    thumbs,
    supplementary,
    ledger30d: stats,
    // Local-only artifact — deliberately uncounted on Railway rather
    // than silently reported as zero.
    minedRefuted: "local-only, not counted here",
  };

  await prisma.brainMemory.upsert({
    where: {
      category_key: { category: BRAIN_CATEGORIES.EVAL_RUN, key: ODOMETER_KEY },
    },
    create: {
      category: BRAIN_CATEGORIES.EVAL_RUN,
      key: ODOMETER_KEY,
      content,
      confidence: 1.0,
      source: "cron:outcome-harvest",
      createdBy: "system",
      metadata,
    },
    update: {
      content,
      lastSeen: new Date(),
      seenCount: { increment: 1 },
      metadata,
    },
  });

  return { corrections, trigger: TRIGGER, triggerMet, supplementary, ledger30d: stats };
});
