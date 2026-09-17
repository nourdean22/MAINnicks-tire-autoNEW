/**
 * Weekly quality benchmark · 2026-08-05
 *
 * run-quality-bench.ts carried "weekly cron + manual after model swaps is the
 * intended cadence" in its header since Phase 4 — and nothing ever scheduled
 * it, so model/prompt/sanitizer drift could only be caught by a human
 * remembering to run a script. This is the stated cadence, made real.
 *
 * Design inherits the 07-28 cron-truth lessons:
 *  · SELF-ROW FIRST (CronJobLog) — proof-of-invocation before any work, so
 *    a silent Inngest function-set drift is detectable out-of-band.
 *  · Baseline diff via SystemMetric (`quality_bench.pass_rate`) — a regression
 *    against the previous run alerts on Coach + Telegram; a bench that only
 *    prints to a log nobody reads is the manual-cadence problem again.
 *
 * Cost: ~$0.05-0.20/run (live model calls through the production provider
 * stack — deliberately the same path prod uses). Weekly, not per-PR.
 */
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { prisma } from "@/lib/prisma";
import { recordCoachEvent } from "@/lib/services/coach-events";
import { sendTelegram, formatTelegramNotification } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/quality-bench");

/**
 * What a bench run means, as three distinct states rather than two.
 *
 * ★ THE MISSING THIRD STATE WAS THE BUG. The original code branched on "should
 * I alert?" and let everything else mean OK, so a suite failing 4 of 8 every
 * week — never newly worse, therefore never alert-worthy — logged `bench_ok`.
 * Naming `unresolved` separately is what stops a chronic failure from being
 * reported as a healthy run.
 *
 * Pure and exported so the distinction is testable without executing a live
 * benchmark against real model providers.
 */
export type BenchOutcome = "alert" | "unresolved" | "ok";

export function classifyBenchOutcome(a: {
  failed: number;
  passRate: number;
  prevRate: number | null;
}): BenchOutcome {
  const regressed = a.prevRate != null && a.passRate < a.prevRate;
  if (a.failed > 0 && (regressed || a.prevRate == null)) return "alert";
  if (a.failed > 0) return "unresolved";
  return "ok";
}

const inngest = getInngest();

export const qualityBenchWeekly = inngest.createFunction(
  {
    id: "quality-bench-weekly",
    name: "Weekly quality benchmark (drift watch)",
    retries: 1,
    // Monday 13:00 UTC — after the morning fan-out window, weekly cadence per
    // the bench's own stated intent.
    triggers: [{ cron: "0 13 * * 1" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // ⚠⚠ 2026-09-17 — a `status: "success"` row used to be written HERE, before
    // the benchmark ran. A weekly quality benchmark that records success before
    // measuring anything is a false reassurance with a schedule attached: the
    // run could crash mid-suite and `cron_job_log` would still show a clean
    // weekly green. lib/inngest/cron-lifecycle.ts now writes `started` via the
    // client middleware and settles it only on the handler's real outcome.

    // One step for the whole bench: the gold set is small (~8 prompts) and a
    // per-prompt step would checkpoint model outputs into Inngest state for no
    // replay benefit. Returns only serializable summary fields.
    const summary = await step.run("run-bench", async () => {
      const { QUALITY_PROMPTS } = await import("@/tests/fixtures/quality-prompts.gold");
      const { runQualityBench } = await import("@/lib/ai/evals/quality-bench-core");
      const bench = await runQualityBench(QUALITY_PROMPTS, { dry: false });
      const failing = bench.results
        .filter((r) => !r.pass)
        .map((r) => ({
          id: r.id,
          error: r.error ?? null,
          failedChecks: r.checks.filter((c) => !c.pass).map((c) => `${c.check}: ${c.detail ?? ""}`),
        }));
      return { total: bench.total, passed: bench.passed, failed: bench.failed, failedIds: bench.failedIds, failing };
    });

    const baseline = await step.run("baseline-diff", async () => {
      const prev = await prisma.systemMetric.findFirst({
        where: { metric: "quality_bench.pass_rate" },
        orderBy: { createdAt: "desc" },
        select: { value: true, createdAt: true },
      });
      const passRate = summary.total > 0 ? summary.passed / summary.total : 0;
      await prisma.systemMetric.create({
        data: {
          metric: "quality_bench.pass_rate",
          value: passRate,
          unit: "ratio",
          source: "inngest",
          tags: { total: summary.total, passed: summary.passed, failed: summary.failed, failedIds: summary.failedIds },
        },
      });
      return { passRate, prevRate: prev?.value ?? null, prevAt: prev?.createdAt?.toISOString() ?? null };
    });

    const regressed = baseline.prevRate != null && baseline.passRate < baseline.prevRate;
    const outcome = classifyBenchOutcome({
      failed: summary.failed,
      passRate: baseline.passRate,
      prevRate: baseline.prevRate,
    });
    if (outcome === "alert") {
      const title = `Quality bench: ${summary.failed}/${summary.total} failing${regressed ? " (REGRESSION)" : ""}`;
      const body = `Pass rate ${(baseline.passRate * 100).toFixed(0)}%${
        baseline.prevRate != null ? ` (was ${(baseline.prevRate * 100).toFixed(0)}%)` : " (first measured run)"
      }. Failing: ${summary.failedIds.join(", ")}. Model, system prompt, or sanitizer drifted — run scripts/run-quality-bench.ts --ids=${summary.failedIds.join(",")} to reproduce.`;
      await step.run("regression-alert", async () => {
        await recordCoachEvent({
          kind: "system-alert",
          subjectId: "quality-bench-weekly",
          priority: regressed ? "P1" : "P2",
          title,
          body,
          deepLink: "/system/health",
          surfaces: ["scoreboard", "brain"],
          expiresAt: new Date(Date.now() + 8 * 24 * 3_600_000).toISOString(),
        });
        await sendTelegram(formatTelegramNotification(title, body, regressed ? "high" : "medium"));
        return true;
      });
      log.warn("bench_failing", { failed: summary.failed, regressed });
    } else if (outcome === "unresolved") {
      // ★★★ THIS BRANCH USED TO FALL THROUGH TO `bench_ok`.
      //
      // The alert above only fires when the bench got WORSE (or on the very
      // first run). A suite sitting at a steady 4/8 failing, week after week,
      // satisfies neither condition — not a regression, not a first run — so it
      // landed in the else and logged `bench_ok` with a passed/total pair that
      // read as healthy at a glance.
      //
      // ⚠ An aggregate that stops getting worse is not an aggregate that is
      // fine. Tying visibility to the DELTA means a failure becomes invisible
      // exactly when it becomes chronic, which is the point at which someone
      // most needs to see it. `bench_ok` now means what its name says, and a
      // standing failure keeps saying so every week until it is fixed.
      log.warn("bench_failing_unchanged", {
        failed: summary.failed,
        total: summary.total,
        failedIds: summary.failedIds,
        passRate: baseline.passRate,
        note: "not a new regression, still unresolved - deliberately not silent",
      });
    } else {
      log.info("bench_ok", { passed: summary.passed, total: summary.total });
    }

    return { ...summary, passRate: baseline.passRate, prevRate: baseline.prevRate, regressed };
  },
);
