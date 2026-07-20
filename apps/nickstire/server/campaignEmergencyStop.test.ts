/**
 * A campaign reaches real people. "Started" must not mean "unstoppable".
 *
 * campaigns.send claimed draft -> active, and the drain then selected on
 * campaignId + status='pending' ALONE — it never consulted the campaign. So once
 * send was called there was no operator stop. Worse, resumeStuckCampaigns (cron,
 * every 5 minutes) re-runs the drain for anything left mid-flight, so even
 * killing the process only bought five minutes.
 *
 * winbackProcessor has had this right from the start: its drain joins on
 * `wc.status = 'active'` (winbackProcessor.ts:69), so pausing a winback campaign
 * genuinely halts it. This brings the generic system to parity — verified rather
 * than assumed: Report 1 claimed BOTH systems lacked a stop, and that is REFUTED
 * for winback and CONFIRMED for campaigns.
 *
 * Timing matters here: a 267-person winback is queued for activation.
 */
import { describe, it, expect } from "vitest";
import { readCode, readSource } from "./testUtils/sourceAssertions";

const campaigns = readSource("server/routers/campaigns.ts");
const winback = readSource("server/services/winbackProcessor.ts");

describe("the drain can be stopped mid-run", () => {
  it("re-reads campaign status EVERY batch, not once at the top", () => {
    // The operator hits stop DURING the run — that is the only time it matters.
    expect(campaigns).toMatch(/const \[live\] = await d\.select\(\{ status: smsCampaigns\.status \}\)/);
    expect(campaigns).toMatch(/live\.status !== "active"/);
  });

  it("breaks out rather than continuing", () => {
    const idx = campaigns.indexOf("live.status !== \"active\"");
    expect(campaigns.slice(idx, idx + 400)).toMatch(/break;/);
  });

  it("leaves pending rows PENDING, not failed", () => {
    // A precautionary stop must be resumable. Marking them failed would destroy
    // the campaign to pause it.
    expect(campaigns).toMatch(/Pending rows stay pending|left pending, not failed/);
  });
});

describe("the stop control exists and is honest about its limits", () => {
  it("there is a stop mutation at all", () => {
    expect(campaigns).toMatch(/stop: adminProcedure/);
  });

  it("refuses to 'stop' a campaign that is not running", () => {
    expect(campaigns).toMatch(/not active — nothing to stop/);
  });

  it("says plainly that sent messages cannot be recalled", () => {
    // The one thing a stop CANNOT do. Claiming otherwise would be worse than
    // having no stop.
    expect(campaigns).toMatch(/cannot be recalled/);
  });

  it("reports how many were left unsent, so the operator knows the blast radius", () => {
    expect(campaigns).toMatch(/pendingLeftUnsent/);
  });

  it("writes only values the enum permits", () => {
    // smsCampaigns.status is mysqlEnum(["draft","active","completed"]).
    // Under STRICT_TRANS_TABLES an out-of-enum write is REJECTED and the row
    // LOST — a stop that wrote "paused" would throw at exactly the moment it is
    // needed. Imperfect vocabulary, correct behaviour.
    const code = readCode("server/routers/campaigns.ts");
    expect(code).not.toMatch(/status: "paused"/);
    expect(code).not.toMatch(/status: "cancelled"/);
    expect(campaigns).toMatch(/status: "completed"/);
  });
});

describe("winback already had a working stop — do not regress it", () => {
  it("its drain filters on the campaign being active", () => {
    expect(winback).toMatch(/wc\.status = 'active'/);
  });
});
