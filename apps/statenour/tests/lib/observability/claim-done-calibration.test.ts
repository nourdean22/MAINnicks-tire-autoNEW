/**
 * Strict-Done calibration reader — and the writer it reads.
 *
 * `tokenUsage.claimDoneShadow` had been persisted for a week with zero
 * readers; this reader is the consumer, and the source-contract block at the
 * bottom asserts the NEW `tokenUsage.toolReceipts` has both a writer and a
 * reader on the same day it ships — per the assert-the-consumer rule, a
 * persisted key nobody reads is the defect this module exists to end.
 *
 * The measured production case is the first fixture: 2 shadow turns, 1
 * consequential, 1 gap on createTask:PROVIDER_ACCEPTED — and the reader must
 * say `sufficient: false` with a null rate, never "100% gap".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assembleClaimDoneCalibration,
  JOIN_COHORT_SINCE,
  MIN_SAMPLE,
  type ClaimDoneTurn,
} from "@/lib/observability/claim-done-calibration";

const AFTER = new Date(new Date(JOIN_COHORT_SINCE).getTime() + 3_600_000);
const BEFORE = new Date(new Date(JOIN_COHORT_SINCE).getTime() - 3_600_000);

function gapTurn(at: Date, tool = "createTask"): ClaimDoneTurn {
  return {
    createdAt: at,
    shadow: {
      legacyOk: true,
      strictOk: false,
      gap: true,
      receipts: 1,
      consequential: 1,
      strictOffenders: [{ toolName: tool, category: "personal_write", status: "success", verificationState: "PROVIDER_ACCEPTED" }],
    },
  };
}
function cleanConsequential(at: Date): ClaimDoneTurn {
  return {
    createdAt: at,
    shadow: { legacyOk: true, strictOk: true, gap: false, receipts: 1, consequential: 1, strictOffenders: [] },
    receipts: [
      { toolName: "createTask", category: "personal_write", sideEffecting: true, verifiable: true, status: "success", verificationState: "VERIFIED", entityType: "task", entityId: "t1" },
    ],
  };
}
function readOnlyTurn(at: Date): ClaimDoneTurn {
  return {
    createdAt: at,
    shadow: { legacyOk: true, strictOk: true, gap: false, receipts: 1, consequential: 0, strictOffenders: [] },
  };
}

describe("assembleClaimDoneCalibration", () => {
  it("THE MEASURED CASE: 1 gap in 1 consequential turn is sufficient:false with a null rate — never 100%", () => {
    const v = assembleClaimDoneCalibration([readOnlyTurn(AFTER), gapTurn(AFTER)], { now: AFTER });
    expect(v.sufficient).toBe(false);
    expect(v.afterJoin.turns).toBe(2);
    expect(v.afterJoin.consequentialTurns).toBe(1);
    expect(v.afterJoin.gapTurns).toBe(1);
    expect(v.afterJoin.gapPct).toBeNull();
    expect(v.afterJoin.byOffender).toEqual({ "createTask:PROVIDER_ACCEPTED": 1 });
    expect(v.caveat).toContain("No rate is stated");
  });

  it("POSITIVE CONTROL: at MIN_SAMPLE consequential turns a rate is stated, over consequential turns only", () => {
    const turns: ClaimDoneTurn[] = [];
    for (let i = 0; i < MIN_SAMPLE; i += 1) turns.push(i < 10 ? gapTurn(AFTER) : cleanConsequential(AFTER));
    // Read-only turns must not dilute the denominator.
    for (let i = 0; i < 25; i += 1) turns.push(readOnlyTurn(AFTER));
    const v = assembleClaimDoneCalibration(turns, { now: AFTER });
    expect(v.sufficient).toBe(true);
    expect(v.afterJoin.consequentialTurns).toBe(MIN_SAMPLE);
    expect(v.afterJoin.gapPct).toBe(Number(((10 / MIN_SAMPLE) * 100).toFixed(1)));
    expect(v.afterJoin.turns).toBe(MIN_SAMPLE + 25);
  });

  it("cohorts at the join: pre-join turns are context, never the promotion cohort", () => {
    const v = assembleClaimDoneCalibration([gapTurn(BEFORE), gapTurn(BEFORE), cleanConsequential(AFTER)], { now: AFTER });
    expect(v.beforeJoin.gapTurns).toBe(2);
    expect(v.afterJoin.gapTurns).toBe(0);
    expect(v.afterJoin.consequentialTurns).toBe(1);
    expect(v.caveat).toContain("Pre-join figures");
  });

  it("splits by offender, worst first, so a verifier gap is distinguishable from a Nick gap", () => {
    const v = assembleClaimDoneCalibration(
      [gapTurn(AFTER, "sendTelegram"), gapTurn(AFTER, "createTask"), gapTurn(AFTER, "sendTelegram")],
      { now: AFTER },
    );
    expect(Object.keys(v.afterJoin.byOffender)).toEqual(["sendTelegram:PROVIDER_ACCEPTED", "createTask:PROVIDER_ACCEPTED"]);
    expect(v.afterJoin.byOffender["sendTelegram:PROVIDER_ACCEPTED"]).toBe(2);
  });

  it("reads persisted receipts when present: counts replayable turns and VERIFIED mutations", () => {
    const v = assembleClaimDoneCalibration([cleanConsequential(AFTER), gapTurn(AFTER), readOnlyTurn(AFTER)], { now: AFTER });
    expect(v.afterJoin.turnsWithReceipts).toBe(1);
    expect(v.afterJoin.verifiedMutationTurns).toBe(1);
  });

  it("a gap flag on a NON-consequential turn does not count — a gap needs something to have mutated", () => {
    const odd: ClaimDoneTurn = { createdAt: AFTER, shadow: { gap: true, consequential: 0, strictOffenders: [] } };
    const v = assembleClaimDoneCalibration([odd], { now: AFTER });
    expect(v.afterJoin.gapTurns).toBe(0);
    expect(v.afterJoin.consequentialTurns).toBe(0);
  });

  it("empty input is an honest empty, not a crash", () => {
    const v = assembleClaimDoneCalibration([], { now: AFTER });
    expect(v.sufficient).toBe(false);
    expect(v.afterJoin).toMatchObject({ turns: 0, consequentialTurns: 0, gapTurns: 0, gapPct: null, byOffender: {} });
  });
});

describe("toolReceipts · writer and reader ship together", () => {
  const persist = readFileSync(resolve(process.cwd(), "lib/services/chat/persist-assistant-message.ts"), "utf8");
  const reader = readFileSync(resolve(process.cwd(), "lib/observability/claim-done-calibration.ts"), "utf8");
  const router = readFileSync(resolve(process.cwd(), "lib/trpc/routers/system/digest.ts"), "utf8");

  it("persist writes tokenUsage.toolReceipts", () => {
    expect(persist).toMatch(/toolReceipts:\s*receipts\.length > 0/);
  });
  it("the projection carries no args and no results", () => {
    const block = persist.slice(persist.indexOf("toolReceipts:"), persist.indexOf("toolReceipts:") + 900);
    expect(block).not.toMatch(/\bargs\b/);
    expect(block).not.toMatch(/\bresult\b/);
  });
  it("the reader reads it, and the digest exposes the reader", () => {
    expect(reader).toContain("toolReceipts");
    expect(router).toContain("buildClaimDoneCalibration");
    expect(router).toMatch(/claimDoneCalibration:\s*operatorProcedure/);
  });
});
