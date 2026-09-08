/**
 * tests/home/derive-briefing-expiry.test.ts · 2026-09-07 (program D12)
 *
 * Expired authorizations are not decisions waiting on the operator. The
 * decide card counts LIVE approvals; expired ones are named as needing a
 * re-request or a dismissal, and can never claim the card on their own.
 */
import { describe, it, expect } from "vitest";
import { deriveBriefing } from "@/lib/home/derive-briefing";

const base = {
  loading: false,
  unreadable: false,
  doingTask: null,
  resumeTask: null,
  pendingDecisions: 0,
  findingsCount: 0,
  inboxCount: 0,
  criticalFew: [],
};

describe("decide card · live vs expired", () => {
  it("names the expired ones as re-request-or-dismiss, not as waiting on you", () => {
    const b = deriveBriefing({ ...base, pendingDecisions: 2, expiredDecisions: 3 });
    expect(b.status).toBe("decide");
    expect(b.message).toContain("2 approvals are parked waiting on you");
    expect(b.message).toContain("3 more have expired");
    expect(b.message).toMatch(/re-request or a dismissal/);
    expect(b.message).not.toMatch(/declined/i);
  });

  it("singular grammar for one expired", () => {
    const b = deriveBriefing({ ...base, pendingDecisions: 1, expiredDecisions: 1 });
    expect(b.message).toContain("1 more has expired");
    expect(b.message).toContain("it needs a re-request");
  });

  it("expired-only queues never claim the decide card — nothing can be approved", () => {
    const b = deriveBriefing({ ...base, pendingDecisions: 0, expiredDecisions: 5 });
    expect(b.status).not.toBe("decide");
  });

  it("positive control: no expired → the message is unchanged from before D12", () => {
    const b = deriveBriefing({ ...base, pendingDecisions: 2 });
    expect(b.message).toMatch(/outranks any new target\.$/);
    expect(b.message).not.toContain("expired");
  });
});
