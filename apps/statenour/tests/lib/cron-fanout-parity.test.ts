/**
 * 2026-08-06 · Cron fan-out parity.
 *
 * WHY THIS EXISTS
 *
 * On 2026-05-28 the Wave-AE prune ("cron prune · 107 → 35") deleted
 * app/api/cron/distill-sessions/route.ts. It did NOT delete that route's two
 * live consumers. The result went unnoticed for 70 days:
 *
 *   - `chat_summary` froze at 34 rows.
 *   - `nick_current_concerns` was never written AT ALL (0 rows in prod) —
 *     its only writer sits downstream of distillConversation.
 *   - The /chat "concerns" context block therefore fired 0 times in 1,128
 *     measured production turns.
 *   - fireAfternoonPush degraded to silence, exactly as its own comment
 *     promises it will when no concerns exist.
 *
 * Nothing errored. Every consumer was written to degrade quietly, so a
 * deleted producer looked identical to "nothing to report". That is the
 * failure mode this file exists to make loud.
 *
 * It is deliberately a WIRING test, not a behaviour test: it asserts that
 * every path the nightly fan-out will actually fetch resolves to a route file
 * that exists on disk. A dangling entry means the fan-out spends a request on
 * a 404 every night and whatever depended on it silently rots.
 *
 * The same prune also removed /api/cron/refresh-identity (resurrected
 * 2026-07-11) and /api/cron/autonomous-engine (resurrected 2026-06-02). Three
 * known instances of one mistake is enough to automate.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MORNING_JOBS,
  EVENING_JOBS,
  WEEKLY_JOBS,
  ALL_MEGA_JOBS,
} from "@/lib/inngest/jobs";

const APP_ROOT = path.resolve(__dirname, "..", "..");

/** "/api/cron/foo?slot=evening" -> "app/api/cron/foo/route.ts" */
function routeFileFor(jobPath: string): string {
  const withoutQuery = jobPath.split("?")[0];
  const rel = withoutQuery.replace(/^\//, "");
  return path.join(APP_ROOT, "app", rel, "route.ts");
}

describe("cron fan-out parity", () => {
  it("every job in the nightly fan-out resolves to a route file that exists", () => {
    const missing = ALL_MEGA_JOBS.filter((job) => !fs.existsSync(routeFileFor(job)));

    // Named explicitly so a failure tells you WHICH job dangles, not just a
    // count — the whole point is that the next prune fails loudly at the
    // commit that causes it.
    expect(missing, `fan-out entries with no route file:\n${missing.join("\n")}`).toEqual([]);
  });

  it("keeps the distill-sessions producer wired", () => {
    // Pinned by name because this is the one that actually broke, and the
    // consumers (brain-context concerns block, proactive-pushes) cannot tell
    // "producer deleted" from "nothing to report" on their own.
    expect(EVENING_JOBS).toContain("/api/cron/distill-sessions");
    expect(fs.existsSync(routeFileFor("/api/cron/distill-sessions"))).toBe(true);
  });

  it("has no duplicate job paths within a single slot", () => {
    // A duplicate inside one slot doubles that job's cost and, for anything
    // non-idempotent, doubles its writes. Across slots is legitimate — the
    // journal-checkin runs morning and evening by design — so this checks
    // each slot independently rather than the combined array.
    for (const [slot, jobs] of [
      ["MORNING_JOBS", MORNING_JOBS],
      ["EVENING_JOBS", EVENING_JOBS],
      ["WEEKLY_JOBS", WEEKLY_JOBS],
    ] as const) {
      const seen = new Set<string>();
      const dupes = jobs.filter((j) => (seen.has(j) ? true : (seen.add(j), false)));
      expect(dupes, `${slot} contains duplicates: ${dupes.join(", ")}`).toEqual([]);
    }
  });
});
