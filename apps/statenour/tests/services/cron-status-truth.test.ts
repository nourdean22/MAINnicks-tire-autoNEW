import { describe, it, expect, vi } from "vitest";

// cron-control pulls in prisma at module scope; these helpers are pure.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { normalizeCronStatus, isHardFailure } from "@/lib/services/cron-control";

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

    it("treats anything else as failed", () => {
      expect(normalizeCronStatus("failed")).toBe("failed");
      expect(normalizeCronStatus("timeout")).toBe("failed");
      expect(normalizeCronStatus("")).toBe("failed");
    });
  });

  describe("isHardFailure", () => {
    it("does not count a degraded fan-out as a hard failure", () => {
      expect(isHardFailure("partial")).toBe(false);
    });

    it("does not count success as a failure", () => {
      expect(isHardFailure("success")).toBe(false);
    });

    it("counts a thrown or unknown status as a hard failure", () => {
      expect(isHardFailure("failed")).toBe(true);
      expect(isHardFailure("timeout")).toBe(true);
    });
  });
});
