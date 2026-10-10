import { describe, it, expect, vi } from "vitest";

// cron-control pulls in prisma at module scope; these helpers are pure.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCronStatus, isHardFailure, HARD_FAILURE_STATUSES } from "@/lib/services/cron-control";
import { TERMINAL_OK_STATUSES } from "@/lib/inngest/cron-lifecycle";

/**
 * 2026-08-20 · `partial` is a real, load-bearing third state: the mega
 * fan-out writes it whenever SOME children fail (mega-fanout.ts), and prod
 * held 2,536 such rows. Two separate services used to collapse it into
 * "failed" and the 14d counters bucketed it as neither — which is how a job
 * that had run 1,248 times reported BOTH "never run" and a 100% success rate.
 */
describe("cron status truth", () => {
  describe("normalizeCronStatus", () => {
    it("keeps partial distinct instead of collapsing it into failed", () => {
      expect(normalizeCronStatus("partial")).toBe("partial");
    });

    it("passes success through", () => {
      expect(normalizeCronStatus("success")).toBe("success");
    });

    it("maps the hard failures to failed", () => {
      expect(normalizeCronStatus("failed")).toBe("failed");
      expect(normalizeCronStatus("interrupted")).toBe("failed");
    });

    /**
     * 2026-10-10 · audit 08-F11. The negative form (`anything else -> failed`) read
     * an in-flight `started` row and a `duplicate` started row as FAILED, so the
     * healer re-fired runs that were still going (and, for Inngest-native crons,
     * threw 409 -> a false P0 "currently NOT running"). Same positive-list rule as
     * isHardFailure below: a status that is neither ok nor a named failure is
     * unclassified (null), never a guess.
     */
    it("does NOT read an in-flight started row or a duplicate as failed", () => {
      expect(normalizeCronStatus("started")).toBeNull();
      expect(normalizeCronStatus("duplicate")).toBeNull();
    });

    it("an unknown token is unclassified, not failed", () => {
      expect(normalizeCronStatus("timeout")).toBeNull();
      expect(normalizeCronStatus("")).toBeNull();
    });
  });

  describe("isHardFailure", () => {
    it("does not count a degraded fan-out as a hard failure", () => {
      expect(isHardFailure("partial")).toBe(false);
    });

    it("does not count success as a failure", () => {
      expect(isHardFailure("success")).toBe(false);
    });

    /**
     * 2026-09-22 · POSITIVE LIST. The previous form was `!== success && !== partial`,
     * which admitted every status invented after it was written. From 2026-09-17 the
     * lifecycle's `started` (invoked, outcome unknown) counted as a hard failure in
     * system-health, system-pages and the brain-insights trend: an in-flight run
     * reported as a dead one. Prod census 2026-09-22, all time: success 10,522 ·
     * started 49 · partial 15 · failed 8 - nothing else exists, so naming the
     * failures misses no real one. `interrupted` (age-settled dead run) IS one.
     */
    it("counts failed and interrupted as hard failures", () => {
      expect(isHardFailure("failed")).toBe(true);
      expect(isHardFailure("interrupted")).toBe(true);
    });

    it("does NOT count an in-flight started row as a failure", () => {
      expect(isHardFailure("started")).toBe(false);
    });

    it("an unknown status is neither failed nor ok - it stays unclassified until a human names it", () => {
      // The old assertion here read `isHardFailure("timeout")` as true. That was the
      // negative predicate's only defence, and it is the same defence that turned an
      // in-flight run into a failure. Both lists are positive; a new token lands in neither.
      expect(isHardFailure("timeout")).toBe(false);
      expect(TERMINAL_OK_STATUSES).not.toContain("timeout");
    });

    it("the ok list and the failure list are disjoint, and started is in neither", () => {
      for (const s of HARD_FAILURE_STATUSES) expect(TERMINAL_OK_STATUSES).not.toContain(s);
      expect(HARD_FAILURE_STATUSES).not.toContain("started");
      expect(TERMINAL_OK_STATUSES).not.toContain("started");
    });
  });

  describe("the prisma mirror in brain-insights", () => {
    // The trend query cannot call the function, so it spreads the same list. Scoped to the
    // cron section so an unrelated `in:` elsewhere in the file cannot satisfy it, and
    // comment-stripped so the rationale comment above the const (which names the old
    // shape) cannot fail it.
    const src = readFileSync(join(__dirname, "../../lib/services/brain-insights.ts"), "utf8");
    const from = src.indexOf("Cron failure trend");
    const section = src.slice(from, from + 1500);
    const code = section
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    it("uses the shared positive list, not a notIn", () => {
      expect(from).toBeGreaterThan(0);
      expect(code).toContain("const HARD_FAILURE_ONLY = { in: [...HARD_FAILURE_STATUSES] };");
      expect(code).not.toMatch(/notIn/);
    });
  });
});
