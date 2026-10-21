/**
 * The unpaid-invoice payment reminder was retired on 2026-10-15.
 * Payment is taken on a separate register, so an unpaid invoice row is not a signal to text anyone.
 * These read the real registries, not source text: the tiered scheduler, the HTTP-only job
 * registry in cron/index.ts, and the tRPC router. A re-add under the same job name or admin
 * trigger in any of the three fails here whatever file it lives in.
 */
import { describe, expect, it } from "vitest";
import { getJobCadences } from "./scheduler";
import { getRegisteredJobNames } from "./index";
import { appRouter } from "../routers";

const RETIRED_JOB = "unpaid-invoice-recovery";
const RETIRED_PROCEDURE = "invoices.runUnpaidRecoveryNow";

describe("retired payment reminder", () => {
  const tieredJobs = [...getJobCadences().keys()];
  const httpJobs = getRegisteredJobNames().map((j) => j.name);
  const procedures = Object.keys(
    (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures,
  );

  it("positive control: all three registries are populated and still hold the neighbouring lanes", () => {
    // An empty or half-loaded registry would make the absence checks below pass.
    expect(tieredJobs.length).toBeGreaterThan(50);
    expect(tieredJobs).toContain("alg-declined-work-recovery");
    expect(httpJobs.length).toBeGreaterThan(10);
    expect(httpJobs).toContain("declined-work-recovery");
    expect(procedures).toContain("invoices.list");
  });

  it("the tiered scheduler registers no job named unpaid-invoice-recovery", () => {
    expect(tieredJobs).not.toContain(RETIRED_JOB);
  });

  it("the HTTP-only job registry has no such job either", () => {
    expect(httpJobs).not.toContain(RETIRED_JOB);
  });

  it("the admin one-shot trigger is not a registered tRPC procedure", () => {
    expect(procedures).not.toContain(RETIRED_PROCEDURE);
  });

  it("the unpaid-invoice worklist query is gone too: the register is separate, so the system cannot know who paid", () => {
    expect(procedures).not.toContain("invoices.unpaidList");
  });
});
