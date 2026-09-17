/**
 * The task-write transaction budget must clear its MEASURED overrun.
 *
 * WHY THIS FILE EXISTS. `createTask` / `updateTask` / `createMission` /
 * `updateMission` each wrap `syncTaskPriorities` — which issues one
 * `task.update` per open task whose score changed — in an interactive
 * transaction that carried NO options, i.e. Prisma's 5000 ms default.
 * Production, 2026-09-16/17, three failures on `/api/sync/nour-os`:
 *
 *   Transaction already closed ... timeout was 5000 ms, however 5115 ms passed
 *   (also 5089 ms, 5073 ms)
 *
 * ★ ALL THREE OVERRUN BY UNDER 115 ms. That clustering is the diagnosis: work
 *   that is pathologically too large overruns by seconds. A budget sitting just
 *   under the tail is an UNMEASURED DEFAULT — the same root cause as
 *   judge-eval's 8s-vs-12.1s-median, with the inequality flipped.
 *
 * ⚠ These assert a RELATIONSHIP against `TASK_TX_MEASURED_OVERRUN_MS`, not a
 * magic number, so tightening the budget back under the measurement turns this
 * red rather than silently restoring the bug.
 */
import { describe, it, expect } from "vitest";
import { TASK_TX_OPTS, TASK_TX_MEASURED_OVERRUN_MS } from "@/lib/services/tasks";

/** Prisma's default interactive-transaction timeout — what the bug shipped with. */
const PRISMA_DEFAULT_TX_TIMEOUT_MS = 5_000;

describe("task-write transaction budget", () => {
  // POSITIVE CONTROL — without this, every comparison below could pass on
  // undefined coerced to NaN, or on a vanished export.
  it("the config is exported and numeric", () => {
    expect(typeof TASK_TX_OPTS.timeout).toBe("number");
    expect(Number.isFinite(TASK_TX_OPTS.timeout)).toBe(true);
    expect(TASK_TX_MEASURED_OVERRUN_MS).toBeGreaterThan(0);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The shipped default. 5000 ms against a 5115 ms observed elapsed is the
  // exact failure, so the old value must be provably incapable of passing.
  it("CANARY — the budget clears the MEASURED overrun, so 5000 would fail", () => {
    expect(TASK_TX_OPTS.timeout).toBeGreaterThan(TASK_TX_MEASURED_OVERRUN_MS);
    expect(PRISMA_DEFAULT_TX_TIMEOUT_MS).toBeLessThan(TASK_TX_MEASURED_OVERRUN_MS);
  });

  /**
   * Headroom, not a hair's breadth. The measurement was taken at ~212 open
   * tasks and the count only grows, so a budget that merely edges past the
   * observed figure would re-fail on the next few tasks. 3x is the floor.
   */
  it("leaves growth headroom over the measured overrun", () => {
    expect(TASK_TX_OPTS.timeout).toBeGreaterThanOrEqual(TASK_TX_MEASURED_OVERRUN_MS * 3);
  });

  /**
   * ⚠ An interactive transaction holds a Neon connection for its whole life.
   * Unbounded generosity here trades a visible error for pool exhaustion under
   * load, which is a far harder failure to attribute.
   */
  it("stays bounded, so a stuck transaction cannot hold a connection forever", () => {
    expect(TASK_TX_OPTS.timeout).toBeLessThanOrEqual(30_000);
  });

  /**
   * `maxWait` is deliberately absent: the production failures are timeouts, not
   * pool-acquisition waits. Bundling an unmeasured change with a measured one
   * makes the fix unattributable — if the error rate moves, you cannot say
   * which half did it. If a maxWait change is ever needed, measure it first and
   * delete this test with the receipt.
   */
  it("changes ONLY what was measured — no unmeasured maxWait rides along", () => {
    expect("maxWait" in TASK_TX_OPTS).toBe(false);
  });
});
