/**
 * The unpaid-invoice payment reminder was retired on 2026-10-15.
 * Payment is taken on a separate register, so an unpaid invoice row is not a signal to text anyone.
 * These read the real scheduler and router registries, not source text, so a re-add under
 * the same job name or admin trigger fails here whatever file it lives in.
 */
import { describe, expect, it } from "vitest";
import { getJobCadences } from "./scheduler";
import { appRouter } from "../routers";

const RETIRED_JOB = "unpaid-invoice-recovery";
const RETIRED_PROCEDURE = "invoices.runUnpaidRecoveryNow";

describe("retired payment reminder", () => {
  const jobs = [...getJobCadences().keys()];
  const procedures = Object.keys(
    (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures,
  );

  it("positive control: both registries are populated and still hold the neighbouring lanes", () => {
    // An empty or half-loaded registry would make the absence checks below pass.
    expect(jobs.length).toBeGreaterThan(50);
    expect(jobs).toContain("alg-declined-work-recovery");
    expect(procedures).toContain("invoices.unpaidList");
  });

  it("the tiered scheduler registers no job named unpaid-invoice-recovery", () => {
    expect(jobs).not.toContain(RETIRED_JOB);
  });

  it("the admin one-shot trigger is not a registered tRPC procedure", () => {
    expect(procedures).not.toContain(RETIRED_PROCEDURE);
  });
});
