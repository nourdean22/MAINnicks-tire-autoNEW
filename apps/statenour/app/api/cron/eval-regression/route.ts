/**
 * v10.0.524 · Nightly eval regression cron.
 *
 * Replays `data/golden-questions.json` through the live chat pipeline,
 * scores each reply against deterministic expected criteria, persists
 * the report to `BrainMemory(category="eval_result")`, and fires a
 * Telegram alert when pass rate dips below 80%.
 *
 * Mirrors the pattern from `app/api/cron/consolidate/route.ts` —
 * cronHandler wraps with kill-switch + auth + structured logging, the
 * runner module stays pure compute so it's unit-testable.
 *
 * Budget: 300s. 35 questions × ~3-5s each ≈ 105-175s actual. Headroom
 * for cold-start + a slow provider before we trip the route ceiling.
 */
import { cronHandler } from "@/lib/utils/http";
import { runRegressionSuite } from "@/lib/eval/regression-runner";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/cron/eval-regression");

export const maxDuration = 300;

const ALERT_THRESHOLD = 0.8;
const MEMORY_CATEGORY = "eval_result";
// Cap the persisted preview so a runaway 8k reply doesn't bloat the
// BrainMemory row. The report itself stores 800 chars per question;
// the parent content field gets a one-line summary instead.
const CONTENT_PREVIEW_CAP = 600;

export const GET = cronHandler(async () => {
  const report = await runRegressionSuite();

  // Persist · category="eval_result" · key = ISO date so we get one
  // row per day (overwrite if cron retries within the same UTC day,
  // which is the right call — last run wins for that date).
  const dayKey = report.ranAt.slice(0, 10);
  const headline =
    `Eval ${report.passed}/${report.totalRan} passed · ` +
    `pass-rate ${(report.passRate * 100).toFixed(1)}% · ` +
    `score ${report.scoreAvg.toFixed(2)} · ` +
    `${(report.durationMs / 1000).toFixed(1)}s`;

  try {
    await prisma.brainMemory.upsert({
      where: {
        category_key: { category: MEMORY_CATEGORY, key: `eval_${dayKey}` },
      },
      create: {
        category: MEMORY_CATEGORY,
        key: `eval_${dayKey}`,
        content: headline.slice(0, CONTENT_PREVIEW_CAP),
        confidence: 1.0,
        source: "cron:eval-regression",
        metadata: {
          ranAt: report.ranAt,
          totalRan: report.totalRan,
          passed: report.passed,
          failed: report.failed,
          passRate: report.passRate,
          scoreAvg: report.scoreAvg,
          durationMs: report.durationMs,
          worstCategories: report.worstCategories,
          perQuestionResults: report.perQuestionResults,
        } as never,
      },
      update: {
        content: headline.slice(0, CONTENT_PREVIEW_CAP),
        metadata: {
          ranAt: report.ranAt,
          totalRan: report.totalRan,
          passed: report.passed,
          failed: report.failed,
          passRate: report.passRate,
          scoreAvg: report.scoreAvg,
          durationMs: report.durationMs,
          worstCategories: report.worstCategories,
          perQuestionResults: report.perQuestionResults,
        } as never,
      },
    });
  } catch (err) {
    log.error("persist_failed", {
      err: err instanceof Error ? err.message.slice(0, 300) : String(err),
    });
    // Don't throw — the report itself is still useful even if we
    // can't persist. The cron's success/failure is wired to whether
    // the suite ran, not whether the write succeeded.
  }

  // Telegram alert · only on regression. Below threshold → page the
  // operator. Above threshold → silent (no notification fatigue).
  if (report.passRate < ALERT_THRESHOLD) {
    const topFailures = report.perQuestionResults
      .filter((r) => !r.passed)
      .slice(0, 5)
      .map((r) => `· <code>${r.id}</code>: ${(r.failures[0] ?? "fail").slice(0, 120)}`)
      .join("\n");
    const msg =
      `<b>📉 Eval regression</b>\n` +
      `Pass rate <b>${(report.passRate * 100).toFixed(1)}%</b> ` +
      `(${report.passed}/${report.totalRan}) below ${(ALERT_THRESHOLD * 100).toFixed(0)}%.\n` +
      `Score ${report.scoreAvg.toFixed(2)}.\n\n` +
      `<b>Top failures:</b>\n${topFailures || "—"}`;
    const sent = await sendTelegram(msg, undefined, "HTML");
    if (!sent) log.warn("telegram_alert_failed", { passRate: report.passRate });
  }

  return {
    ranAt: report.ranAt,
    totalRan: report.totalRan,
    passed: report.passed,
    failed: report.failed,
    passRate: report.passRate,
    scoreAvg: report.scoreAvg,
    durationMs: report.durationMs,
    worstCategories: report.worstCategories,
    alerted: report.passRate < ALERT_THRESHOLD,
  };
});
