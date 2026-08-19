import { cronHandler } from "@/lib/utils/http";

export const maxDuration = 55;

/**
 * Intelligence Cron — personal brain engines.
 *
 * Engines (post Apr-17 separation pass — 2 business engines retired):
 * 1. People Intelligence (L11 enrichment + neglect alerts)
 * 2. Decision Pattern Analysis
 * 3. Time-of-Day Intelligence
 * 4. Emotional Arc Tracker
 * 5. Learning Velocity
 * 6. Strategic Plan Assessment
 *
 * Runs as part of evening mega-cron.
 *
 * 2026-08-19 · converted from a bare GET (hand-rolled Bearer compare) to
 * cronHandler. The hand-rolled auth predated `requireCronAuth`, which now
 * does the identical constant-time Bearer CRON_SECRET check — but the bare
 * handler never reached logCronRun, so this child NEVER wrote a
 * cron_job_logs row. cron-heartbeat derives its expected set from the
 * fan-out arrays, saw ageH=Infinity for it every day, and filed a false
 * P0 "silent cron" alert naming a job that was running fine.
 */
export const GET = cronHandler(async () => {
  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  // Run all engines in parallel — each is independent
  const engines = [
    {
      name: "people_intelligence",
      fn: async () => {
        const { runPeopleIntelligence } = await import(
          "@/lib/brain/people-intelligence"
        );
        return runPeopleIntelligence();
      },
    },
    {
      name: "decision_patterns",
      fn: async () => {
        const { analyzeDecisionPatterns } = await import(
          "@/lib/brain/decision-patterns"
        );
        return analyzeDecisionPatterns();
      },
    },
    {
      name: "time_intelligence",
      fn: async () => {
        const { analyzeTimePatterns } = await import(
          "@/lib/brain/time-intelligence"
        );
        return analyzeTimePatterns();
      },
    },
    {
      name: "emotional_arc",
      fn: async () => {
        const { analyzeEmotionalArc } = await import(
          "@/lib/brain/emotional-arc"
        );
        return analyzeEmotionalArc();
      },
    },
    {
      name: "learning_velocity",
      fn: async () => {
        const { measureLearningVelocity } = await import(
          "@/lib/brain/learning-velocity"
        );
        return measureLearningVelocity();
      },
    },
    {
      name: "strategic_plans",
      fn: async () => {
        const { assessStrategicPlans } = await import(
          "@/lib/brain/strategic-plans"
        );
        return assessStrategicPlans();
      },
    },
  ];

  // This route is a CHILD of the evening mega fan-out, which throttles
  // its children to 6 concurrent (withConcurrency(jobs, dispatch, 6))
  // precisely to protect the shared AI provider. Firing all 6 engines
  // via Promise.all here defeated that — each engine hits the same
  // providers, so one child alone could open 6 uncapped provider calls.
  // Cap at 2 in-flight so this child adds at most ~2 to the provider
  // pressure. Per-engine try/catch still records failures into results[].
  const { withConcurrency } = await import("@/lib/utils/concurrent");
  await withConcurrency(
    engines,
    async (engine) => {
      try {
        const result = await engine.fn();
        results[engine.name] = result;
      } catch (err) {
        errors.push(
          `${engine.name}: ${err instanceof Error ? err.message : "unknown"}`
        );
        results[engine.name] = { error: true };
      }
    },
    2,
  );

  // forensic-audit MEDIUM · was always { ok: true } / HTTP 200 even when every
  // engine threw, so mega's failure counter and /system/crons diagnostics never
  // saw it fail — people-intelligence/decision-patterns/emotional-arc could stay
  // dead for weeks with zero alert. Reflect total failure in ok + status.
  const allFailed = engines.length > 0 && errors.length === engines.length;
  // ok:false on total failure now files a FAILED cron_job_logs row via
  // logCronRun's reported-failure detection — the forensic-audit MEDIUM
  // ("always {ok:true} even when every engine threw") stays fixed, and the
  // failure is finally visible on /system/crons too.
  return {
    ok: !allFailed,
    enginesRun: engines.length,
    errors: errors.length,
    errorDetails: errors.length > 0 ? errors : undefined,
    results,
    timestamp: new Date().toISOString(),
  };
});
