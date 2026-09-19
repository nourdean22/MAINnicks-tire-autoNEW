/**
 * The always-on audit's recency split.
 *
 * WHAT IT DECIDES. Tiers 1 and 2 are attached to every standard/deep turn on
 * purpose, so each costs a tool slot ~100% of the time. The only honest claim
 * the audit makes is "surfaced N times inside the window and chosen ZERO times
 * inside it" — which turns entirely on comparing the tool's last call against
 * the SURFACING window, not against some fixed idea of recent.
 *
 * Measured 2026-09-18 over 259 turns / 30d: 5 of 9 always-on tools had not been
 * called since before the window opened — 1,295 impressions that earned
 * nothing. `createTask` is the instructive row: 76 LIFETIME calls but last
 * called 37 days ago, so a ratio of calls-to-impressions would have made it
 * look like the healthiest tool in the list while it was in fact cold. That is
 * why the audit prints `lastCallAt` beside the surfaced count and never divides
 * them — see docs/agent-audit/DEFECT-SHAPE-STALE-DENOMINATOR.md.
 */
import { describe, it, expect, vi } from "vitest";
import { splitByRecency, type AlwaysOnRow } from "../../scripts/always-on-audit";

const row = (tool: string, lastCallDays: number, lifetimeCalls = 1): AlwaysOnRow => ({
  tool,
  tier: 1,
  surfaced: 259,
  lifetimeCalls,
  lastCallDays,
});

/**
 * CANARY for the import being PURE.
 *
 * The script needs two process-global side effects to run — `loadEnvConfig`
 * mutates `process.env`, and a `Module._load` stub makes `server-only` a no-op.
 * Both live inside `main()` on purpose. At module scope they would fire the
 * moment this test file imports the script, and vitest shares a worker process
 * across test FILES: `server-only` would silently stop throwing for every other
 * test in that worker, and loaded env would overwrite what they rely on.
 *
 * CI caught the consequence before this guard existed — an unrelated DB test
 * timed out at 20s on this branch while the same suite passed on main.
 */
describe("importing the script is free of global side effects", () => {
  // ⚠ THE OBVIOUS ASSERTION HERE DOES NOT WORK, and the reason is worth
  // keeping: `expect(import("server-only")).rejects.toThrow()` ALWAYS passes-
  // as-resolved, because `vitest.config.ts:65` already aliases `server-only` to
  // an empty shim for the whole suite. That test cannot return the other
  // answer — it measures the vitest config, not this script. Caught by writing
  // it, watching it fail against already-correct code, and checking why.
  //
  // So the assertion is on `Module._load` IDENTITY across a reset + re-import.
  // `vi.resetModules()` clears the registry, so a module-scope stub would
  // re-install and replace the function; with the stub inside `main()`, the
  // identity is stable.
  it("does not replace Module._load when imported", async () => {
    vi.resetModules();
    const M = (await import("node:module")).default as unknown as { _load: unknown };
    const before = M._load;
    await import("../../scripts/always-on-audit");
    expect(M._load, "a module-scope server-only stub would have replaced this").toBe(before);
  });
});

describe("splitByRecency", () => {
  it("puts a tool last called BEFORE the window into coldInWindow", () => {
    const { earning, coldInWindow } = splitByRecency([row("classifyThought", 66)], 30);
    expect(coldInWindow.map((r) => r.tool)).toEqual(["classifyThought"]);
    expect(earning).toEqual([]);
  });

  it("keeps a tool called INSIDE the window as earning", () => {
    const { earning, coldInWindow } = splitByRecency([row("searchMemories", 6, 70)], 30);
    expect(earning.map((r) => r.tool)).toEqual(["searchMemories"]);
    expect(coldInWindow).toEqual([]);
  });

  it("HIGH LIFETIME CALLS DO NOT RESCUE A COLD TOOL — the createTask case", () => {
    // 76 lifetime calls, last one 37 days ago, 30-day window. A
    // calls-per-impression ratio would rank this the healthiest row in the
    // audit; the window says it earned nothing in the period measured.
    const { coldInWindow } = splitByRecency([row("createTask", 37, 76)], 30);
    expect(coldInWindow.map((r) => r.tool)).toEqual(["createTask"]);
  });

  it("treats a NEVER-called tool as cold, not as missing data", () => {
    const { coldInWindow } = splitByRecency([row("neverCalled", Number.POSITIVE_INFINITY, 0)], 30);
    expect(coldInWindow.map((r) => r.tool)).toEqual(["neverCalled"]);
  });

  it("the boundary is the WINDOW, not a constant — same row flips with --days", () => {
    // The one case that proves the split is relative. `getRecentReflections`
    // at 15d is cold under --days=14 and earning under the 30d default; a
    // hardcoded threshold would answer the same either way and be wrong once.
    const r = [row("getRecentReflections", 15, 6)];
    expect(splitByRecency(r, 30).earning).toHaveLength(1);
    expect(splitByRecency(r, 14).coldInWindow).toHaveLength(1);
  });

  it("partitions without dropping or duplicating a row", () => {
    const rows = [row("a", 1), row("b", 40), row("c", 15), row("d", Number.POSITIVE_INFINITY)];
    const { earning, coldInWindow } = splitByRecency(rows, 30);
    expect(earning.length + coldInWindow.length).toBe(rows.length);
    expect([...earning, ...coldInWindow].map((r) => r.tool).sort()).toEqual(["a", "b", "c", "d"]);
  });
});
