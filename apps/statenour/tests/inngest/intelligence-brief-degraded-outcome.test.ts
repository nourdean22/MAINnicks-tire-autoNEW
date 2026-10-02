/**
 * 2026-10-02 · a brief whose compose timed out used to return `status: "completed"`
 * and settle `success` in cron_job_logs. The system knew it was degraded (the
 * saved text says so) while the Owner Panel had nothing to read. `briefRunOutcome`
 * is the one place the function's return derives from the compose result; the cron
 * lifecycle (`deriveDegradation`) turns `status: "partial"` into a partial row that
 * carries the reason, and the Owner Panel shows it as `cron_degraded`.
 */
import { describe, expect, it } from "vitest";

import { briefRunOutcome } from "@/lib/inngest/functions/intelligence-brief";

describe("briefRunOutcome", () => {
  it("a degraded compose is a partial run carrying the reason", () => {
    expect(briefRunOutcome({ degraded: "compose timed out after 90s" })).toEqual({
      status: "partial",
      degradedReason: "brief compose degraded: compose timed out after 90s",
    });
  });

  it("a composed brief is completed, with no reason field to misread", () => {
    expect(briefRunOutcome({})).toEqual({ status: "completed" });
    expect(briefRunOutcome({ degraded: undefined })).toEqual({ status: "completed" });
  });
});
