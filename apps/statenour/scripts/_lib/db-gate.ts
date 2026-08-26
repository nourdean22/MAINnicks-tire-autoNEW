/**
 * scripts/_lib/db-gate.ts — can this script measure, must it skip, or must it fail?
 *
 * WHY IT IS ITS OWN MODULE. `measure-prompt-size.ts` calls `main()` at module
 * scope, so a test importing it to reach this decision would RUN THE WHOLE
 * MEASUREMENT — a live Neon connection and a full prompt build as a side effect
 * of a unit test. That is the same shape as the `seed-policies.ts` near-miss
 * recorded in docs/agent-audit/CONTROL-CANARY-COVERAGE.md, where importing the
 * seeder to assert completeness would have executed a production write, and it
 * has the same remedy: put the pure decision somewhere it can be imported
 * without the side effect.
 */

export type DbGateAction = "measure" | "skip" | "fail";

/**
 * Decide from env alone. Three outcomes, deliberately not two:
 *
 *   measure  DATABASE_URL present -> behave exactly as before
 *   skip     no DATABASE_URL, not CI -> exit 0 with a banner that cannot be
 *            mistaken for a pass
 *   fail     no DATABASE_URL in CI -> exit 1, because a skip there would be a
 *            false green in the one place nobody re-reads
 */
export function resolveDbGate(env: Record<string, string | undefined>): {
  action: DbGateAction;
  message: string;
} {
  // Truthiness, not `in`: an empty DATABASE_URL is absent, not present. A
  // presence check would try to measure against "" and surface a confusing
  // Prisma crash instead of this banner.
  if (env.DATABASE_URL) return { action: "measure", message: "" };

  if (env.CI) {
    return {
      action: "fail",
      message:
        "\nFAIL: prompt:size-check has no DATABASE_URL and CI=true.\n" +
        "  This gate measures the built prompt against live Neon. In CI a missing\n" +
        "  DATABASE_URL is a broken job, not a laptop without secrets — failing\n" +
        "  rather than skipping so it cannot pass as a green.\n",
    };
  }

  return {
    action: "skip",
    message:
      "\n" +
      "  ────────────────────────────────────────────────────────────────\n" +
      "  SKIPPED: no DATABASE_URL — the prompt was NOT measured.\n" +
      "  ────────────────────────────────────────────────────────────────\n" +
      "  This step needs live Neon to build the real prompt. Without it the\n" +
      "  size of the built prompt is UNKNOWN for this run — not verified,\n" +
      "  not within budget, unknown.\n" +
      "\n" +
      "  Skipping instead of failing so the rest of `verify:hard` still runs.\n" +
      "  A worktree without credentials used to red-line the whole chain here,\n" +
      "  which meant the other gates were skipped too.\n" +
      "\n" +
      "  To measure: set DATABASE_URL (see apps/statenour/.env.example) and\n" +
      "  re-run `pnpm prompt:size-check`.\n",
  };
}
