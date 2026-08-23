/**
 * The brief must report its own most time-critical state, and its threat marker
 * must mean something.
 *
 * THE ARTEFACT, and it contains both defects at once. During the 16-day
 * `ingest-reviews` outage (2026-08-04 to 2026-08-19, 64 failures, 4 of 4 runs
 * failing every single day) the system sent 20 push notifications. Every one was
 * the routine daily brief. Every one was stamped "Drift: CRITICAL". Not one
 * mentioned the failure.
 *
 *   · COVERAGE — measured against prod 2026-08-23, 44 items were awaiting the
 *     operator (20 autonomous_actions, oldest 7d, one of them a customer-facing
 *     send_sms_outreach; 24 social_publish_queue drafts, oldest 25d) and 2 of 2
 *     approval_requests were past expires_at, both approved TEN DAYS after
 *     expiry and both then failed. The brief reported on competitor prices and
 *     AI news and mentioned none of it.
 *
 *   · SATURATION — 24 of 30 briefs (80%) carry the word CRITICAL. The composer's
 *     GROUNDING RULE forbids inventing a NUMBER; "CRITICAL" is not a number, so
 *     the marker passed straight through as prose.
 *
 * Both had to be fixed before anything could escalate on the marker: paging on
 * CRITICAL while every brief carries one pages daily, gets muted, and takes the
 * one real page down with it.
 */
import { describe, it, expect } from "vitest";
import {
  deriveThreatLevel,
  renderOperatorQueue,
  totalAwaiting,
  stripInventedSeverity,
  CUSTOMER_FACING_ACTIONS,
  THRESHOLDS,
  type OperatorQueue,
} from "@/lib/intelligence/operator-queue";

const quiet: OperatorQueue = {
  pendingActions: 0,
  oldestActionDays: 0,
  customerFacingPending: 0,
  oldestCustomerFacingDays: 0,
  pendingDrafts: 0,
  oldestDraftDays: 0,
  actionableExpired: 0,
  pendingApprovals: 0,
  soonestApprovalExpiryMinutes: null,
};
const q = (over: Partial<OperatorQueue>): OperatorQueue => ({ ...quiet, ...over });

describe("deriveThreatLevel · counted, not narrated", () => {
  it("POSITIVE CONTROL: a genuinely quiet queue is NORMAL", () => {
    // The load-bearing one. Without it, a function hardcoded to return CRITICAL
    // satisfies every escalation test below while recreating the exact
    // saturation this exists to remove — 80% of briefs marked CRITICAL.
    const v = deriveThreatLevel(quiet);
    expect(v.level).toBe("NORMAL");
    expect(v.reason).toContain("0 items awaiting");
  });

  it("POSITIVE CONTROL: a busy but fresh queue is still NORMAL", () => {
    expect(deriveThreatLevel(q({ pendingActions: 12, oldestActionDays: 2, pendingDrafts: 5, oldestDraftDays: 1 })).level)
      .toBe("NORMAL");
  });

  it("an expired-but-actionable approval is CRITICAL — the window already closed", () => {
    const v = deriveThreatLevel(q({ actionableExpired: 1 }));
    expect(v.level).toBe("CRITICAL");
    expect(v.reason).toMatch(/TTL/);
  });

  it("a customer waiting past the threshold is CRITICAL", () => {
    // LITERAL 3, not THRESHOLDS.customerFacingDays. An earlier version read the
    // constant it was meant to pin, so raising the threshold to 999 raised the
    // test input to 999 too and the assertion passed while the gate was fully
    // disabled — a mutation proved it. A test that derives its input from the
    // value under test cannot fail when that value changes.
    const v = deriveThreatLevel(q({ pendingActions: 1, customerFacingPending: 1, oldestCustomerFacingDays: 3 }));
    expect(v.level).toBe("CRITICAL");
    expect(v.reason).toMatch(/real person is waiting/);
  });

  it("the thresholds themselves are pinned — widening one must break a test", () => {
    // The constants are a judgement call, but they are not free to drift
    // silently: changing any of them is a decision that should require editing
    // this line and saying why.
    expect(THRESHOLDS.customerFacingDays).toBe(3);
    expect(THRESHOLDS.staleQueueDays).toBe(21);
    expect(THRESHOLDS.deepQueue).toBe(40);
    expect(THRESHOLDS.elevatedDays).toBe(7);
  });

  it("…but a customer-facing action BELOW the threshold is not", () => {
    // Today's real state: one send_sms_outreach pending 2 days. If this tipped
    // CRITICAL, the marker would fire on an ordinary Tuesday and be back to
    // meaning nothing.
    const v = deriveThreatLevel(
      q({ pendingActions: 20, oldestActionDays: 2, customerFacingPending: 1, oldestCustomerFacingDays: 2 }),
    );
    expect(v.level).not.toBe("CRITICAL");
  });

  it("a queue that has stopped moving is CRITICAL", () => {
    // Literal 21, same reason as above.
    const v = deriveThreatLevel(q({ pendingDrafts: 24, oldestDraftDays: 21 }));
    expect(v.level).toBe("CRITICAL");
    expect(v.reason).toMatch(/stopped moving/);
  });

  it("depth alone escalates without claiming CRITICAL", () => {
    const v = deriveThreatLevel(q({ pendingActions: 40, oldestActionDays: 1 }));
    expect(v.level).toBe("ELEVATED");
  });

  it("EVERY reason cites a counted quantity — a level with no number is prose again", () => {
    const cases: OperatorQueue[] = [
      quiet,
      q({ actionableExpired: 2 }),
      q({ pendingActions: 1, customerFacingPending: 1, oldestCustomerFacingDays: 9 }),
      q({ pendingDrafts: 30, oldestDraftDays: 40 }),
      q({ pendingActions: 50, oldestActionDays: 1 }),
      q({ pendingActions: 3, oldestActionDays: 8 }),
      q({ pendingActions: 3, oldestActionDays: 1 }),
    ];
    for (const c of cases) {
      const v = deriveThreatLevel(c);
      expect(v.reason, `no quantity in: ${v.reason}`).toMatch(/\d/);
    }
  });

  it("send_telegram is NOT customer-facing — it goes to the operator's own phone", () => {
    // A regex on /^send_/ would classify it as customer-facing and drop the
    // customer threshold onto 6 internal notifications, which is the direction
    // that produces a false CRITICAL.
    expect(CUSTOMER_FACING_ACTIONS).not.toContain("send_telegram");
    expect(CUSTOMER_FACING_ACTIONS).toContain("send_sms_outreach");
  });
});

describe("approvals are visible BEFORE they expire, not after", () => {
  it("a pending approval counts even though it has not expired", () => {
    // The original query counted only rows past expires_at, so a live request
    // was invisible for the entire window the operator could still act on it.
    const live = q({ pendingApprovals: 1, soonestApprovalExpiryMinutes: 600 });
    expect(totalAwaiting(live)).toBe(1);
    expect(renderOperatorQueue(live, deriveThreatLevel(live))).toContain("1 approval request(s)");
  });

  it("an approval about to lapse is CRITICAL — a 2h TTL cannot wait for tomorrow", () => {
    const live = q({ pendingApprovals: 1, soonestApprovalExpiryMinutes: 45 });
    const v = deriveThreatLevel(live);
    expect(v.level).toBe("CRITICAL");
    expect(v.reason).toMatch(/45m/);
  });

  it("POSITIVE CONTROL: an approval with plenty of runway is not CRITICAL", () => {
    expect(deriveThreatLevel(q({ pendingApprovals: 1, soonestApprovalExpiryMinutes: 600 })).level)
      .not.toBe("CRITICAL");
  });

  it("THE HEADER CANNOT CONTRADICT ITS CONTENTS", () => {
    // Previously: "Awaiting You (0 items)" above a CRITICAL verdict and a bullet
    // saying two approvals need attention. The total summed actions + drafts only
    // while the body rendered approvals.
    const live = q({ actionableExpired: 2 });
    const out = renderOperatorQueue(live, deriveThreatLevel(live));
    expect(totalAwaiting(live)).toBe(2);
    expect(out).toContain("Awaiting You (2 items)");
    expect(out, "a 0-item headline over a CRITICAL body teaches the reader to skip headlines")
      .not.toContain("Awaiting You (0 items)");
  });
});

describe("stripInventedSeverity · the prompt is a request, this is the contract", () => {
  it("THE FABRICATION: the real 2026-08-22 opener is defanged", () => {
    const r = stripInventedSeverity(
      "**Threat Level: CRITICAL / P1 INCIDENT.** Your entire intelligence stack has been dark.",
    );
    expect(r.stripped).toBeGreaterThan(0);
    expect(r.text).not.toMatch(/Threat Level:\s*CRITICAL/);
    expect(r.text).toContain("see the computed level above");
  });

  it("the Drift field that appeared in 24 of 30 briefs is neutralised", () => {
    const r = stripInventedSeverity("Drift: **CRITICAL** · Top: wake up routine");
    expect(r.stripped).toBe(1);
    expect(r.text).not.toMatch(/Drift:\s*\**CRITICAL/);
  });

  it("surrounding content SURVIVES — silently deleting model output is its own lie", () => {
    const r = stripInventedSeverity("Drift: CRITICAL · Top: call the supplier about winter tires");
    expect(r.text).toContain("call the supplier about winter tires");
  });

  it("POSITIVE CONTROL: an ordinary brief is untouched", () => {
    // Without this, a sanitizer that mangled every body would pass everything
    // above while destroying the brief.
    const clean = ["## CEO Brief", "Highest-ROI opportunity: restore the ingest lane."].join(String.fromCharCode(10));
    const r = stripInventedSeverity(clean);
    expect(r.stripped).toBe(0);
    expect(r.text).toBe(clean);
  });

  it("the word 'critical' as an ADJECTIVE is not a severity declaration", () => {
    // One of the three roles the word plays in these briefs. Stripping it here
    // would delete meaning, not a marker.
    const r = stripInventedSeverity("The most critical threat is margin erosion.");
    expect(r.stripped).toBe(0);
    expect(r.text).toContain("most critical threat");
  });
});

describe("renderOperatorQueue · the coverage the brief lacked", () => {
  it("THE LIVE STATE renders every count the brief used to omit", () => {
    // Verbatim from prod 2026-08-23.
    const live = q({
      pendingActions: 20,
      oldestActionDays: 7,
      customerFacingPending: 1,
      oldestCustomerFacingDays: 2,
      pendingDrafts: 24,
      oldestDraftDays: 25,
    });
    const out = renderOperatorQueue(live, deriveThreatLevel(live));
    expect(out).toContain("44 items");
    expect(out).toContain("20 automation action(s)");
    expect(out).toContain("24 content draft(s)");
    expect(out).toContain("oldest 25d");
    expect(out).toContain("1 of them are customer-facing");
  });

  it("the threat level and its reason travel together", () => {
    const live = q({ pendingDrafts: 24, oldestDraftDays: 25 });
    const out = renderOperatorQueue(live, deriveThreatLevel(live));
    expect(out).toMatch(/Threat level: CRITICAL/);
    expect(out, "a level without its reason is the old prose marker").toMatch(/stopped moving/);
  });

  it("says plainly when nothing is waiting — silence must be explicit", () => {
    const out = renderOperatorQueue(quiet, deriveThreatLevel(quiet));
    expect(out).toContain("Nothing is waiting on a decision");
    expect(out).toContain("0 items");
  });

  it("an expired approval names the consequence, not just the count", () => {
    const live = q({ actionableExpired: 2 });
    const out = renderOperatorQueue(live, deriveThreatLevel(live));
    expect(out).toContain("past TTL");
    // Both real expired rows were approved 10 days late and then failed. The
    // brief has to say that an expired row is not a harmless one.
    expect(out).toMatch(/executions then failed|not a harmless one/);
  });
});

describe("the model no longer authors a severity", () => {
  const src = readSource();

  it("the prompt forbids the marker the model used to invent", () => {
    expect(src).toMatch(/DO NOT WRITE A THREAT LEVEL/);
    for (const banned of ["Threat Level", "CRITICAL", "P1", "INCIDENT", "Drift:"]) {
      expect(src, `${banned} must be named as forbidden`).toContain(banned);
    }
  });

  it("the CEO Brief heading no longer asks for a threat level", () => {
    expect(src).toContain("## 💼 CEO Brief (Highest ROI opportunity)");
    expect(src).not.toContain("Highest ROI opportunity & Threat level");
  });

  it("the computed block is prepended VERBATIM, not summarised by the model", () => {
    // If queueBlock were folded into promptText the model could round, soften
    // or drop it — which is how a number that exists goes missing.
    expect(src).toMatch(/text: `# Daily Executive Brief V2 · \$\{today\}[\s\S]*\$\{queueBlock\}/);
    const prompt = src.slice(src.indexOf("const promptText"), src.indexOf("const queue = await loadOperatorQueue"));
    expect(prompt, "the block must not be an input to the model").not.toContain("queueBlock");
  });

  it("the queue is counted BEFORE generateText, so a model failure cannot drop it", () => {
    expect(src.indexOf("loadOperatorQueue()")).toBeLessThan(src.indexOf("await generateText("));
  });
});

function readSource(): string {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(process.cwd(), "lib/intelligence/compose-daily-brief.ts"), "utf8");
}
