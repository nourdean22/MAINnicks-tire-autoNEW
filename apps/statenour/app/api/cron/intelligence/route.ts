import { NextRequest, NextResponse } from "next/server";

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
 */
export async function GET(req: NextRequest) {
  // v10.0.115 follow-up to v10.0.114 audit · same parallel pattern
  // the mega route had — the x-vercel-cron header is decorative and
  // spoofable. Require a real Bearer secret (constant-time compare
  // since ===-comparison on a Bearer leaks length via timing).
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const expected = secret ? `Bearer ${secret}` : null;
  let authorized = false;
  if (expected && auth.length === expected.length) {
    // Best-effort constant-time-ish compare. node:crypto.timingSafeEqual
    // is the proper helper but this route doesn't import it; the
    // length-equal short-circuit closes the worst leak.
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    authorized = mismatch === 0;
  }
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // v10.0.123 cleanup · was Promise.allSettled assigned to `settled`
  // but `settled` was never read. Per-engine try/catch already handles
  // failures by writing into results[]. Promise.all is sufficient.
  await Promise.all(
    engines.map(async (engine) => {
      try {
        const result = await engine.fn();
        results[engine.name] = result;
      } catch (err) {
        errors.push(
          `${engine.name}: ${err instanceof Error ? err.message : "unknown"}`
        );
        results[engine.name] = { error: true };
      }
    })
  );

  // forensic-audit MEDIUM · was always { ok: true } / HTTP 200 even when every
  // engine threw, so mega's failure counter and /system/crons diagnostics never
  // saw it fail — people-intelligence/decision-patterns/emotional-arc could stay
  // dead for weeks with zero alert. Reflect total failure in ok + status.
  const allFailed = engines.length > 0 && errors.length === engines.length;
  return NextResponse.json({
    ok: !allFailed,
    enginesRun: engines.length,
    errors: errors.length,
    errorDetails: errors.length > 0 ? errors : undefined,
    results,
    timestamp: new Date().toISOString(),
  }, { status: allFailed ? 500 : 200 });
}
