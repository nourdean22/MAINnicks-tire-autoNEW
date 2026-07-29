/**
 * Decision Inbox draft bridge — determinism + claim safety + channel policy
 * (2026-07-29).
 *
 * The drafts are assembled strings, so the banned-claims sweep here is a
 * TOTAL check of everything this path can ever say — the same doctrine as
 * declinedRecoverySequence.test.ts's variant sweep.
 */
import { describe, it, expect } from "vitest";
import { buildDraftBody, bestChannelFor, riskLabelFor } from "./services/opportunityDraft";
import type { OpportunityRow } from "./services/opportunityQueue";

function opp(partial: Partial<OpportunityRow>): OpportunityRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    sourceType: "stale_lead",
    sourceId: "1",
    customerId: null,
    customerName: "Jordan Smith",
    customerPhone: "+12165550101",
    expectedRevenueCents: null,
    dataQuality: "verified",
    urgency: "this_week",
    recommendedAction: "Call Jordan",
    reason: "test",
    evidence: {},
    owner: null,
    dueAt: null,
    state: "new",
    attempts: 0,
    consentOk: true,
    receipts: [],
    outcomeInvoiceId: null,
    createdAt: new Date("2026-07-25T12:00:00Z"),
    updatedAt: new Date("2026-07-25T12:00:00Z"),
    ...partial,
  } as OpportunityRow;
}

const DRAFTABLE = ["stale_lead", "unapproved_estimate", "deferred_service", "missed_call"] as const;
const CALL_ONLY = ["callback", "review_recovery", "promise_overdue"] as const;

/** Claim-safety kill list for this path — nothing here may promise, price,
 *  diagnose, discount, or invent urgency/warranties/wait times. */
const BANNED_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /guarant/i, why: "no guarantees" },
  { re: /warrant/i, why: "no warranty claims" },
  { re: /\$\s?\d/, why: "no dollar amounts — the draft can't know a price" },
  { re: /\b\d+\s?%/, why: "no percentages/discounts" },
  { re: /discount|% off|special price|deal ends|expires/i, why: "no invented offers/urgency" },
  { re: /right now|today only|last chance|don'?t wait|hurry/i, why: "no manufactured urgency" },
  { re: /\b(no|zero) wait\b|\bin and out\b|\b\d+\s?min/i, why: "no wait-time claims" },
  { re: /safe to drive|perfectly safe|no risk/i, why: "safety certainty is banned everywhere" },
  { re: /we'?ll honor|price match|lock(ed)? in/i, why: "the retired price-guarantee copy must stay dead" },
  { re: /financing/i, why: "payment language is 'Payment Programs', never 'financing'" },
  { re: /\{\w+\}|\$\{\w+\}/, why: "no unresolved template variables" },
];

describe("draft claim safety (total sweep)", () => {
  for (const sourceType of DRAFTABLE) {
    it(`${sourceType}: draft contains no banned claim`, () => {
      const { draft } = buildDraftBody(opp({ sourceType, evidence: { problem: "brakes squealing", service: "front brakes" } }));
      expect(draft).toBeTruthy();
      for (const { re, why } of BANNED_PATTERNS) {
        expect(draft!, `${sourceType}: ${why} (matched ${re})`).not.toMatch(re);
      }
      // Voice: short and human — 3 SMS segments max even before edits.
      expect(draft!.length).toBeLessThanOrEqual(480);
      // Identifies the shop (a cold text must say who's texting).
      expect(draft!).toMatch(/Nick'?s Tire/i);
    });
  }

  it("drafts are deterministic (same row → same text)", () => {
    const a = buildDraftBody(opp({ sourceType: "unapproved_estimate", evidence: { service: "alternator" } }));
    const b = buildDraftBody(opp({ sourceType: "unapproved_estimate", evidence: { service: "alternator" } }));
    expect(a.draft).toBe(b.draft);
  });

  it("nameless rows get a natural greeting, not 'Hey customer'", () => {
    const { draft } = buildDraftBody(opp({ sourceType: "missed_call", customerName: "customer" }));
    expect(draft).not.toMatch(/hey customer/i);
  });
});

describe("channel policy", () => {
  for (const sourceType of CALL_ONLY) {
    it(`${sourceType}: call-first, NO draft, reason stated`, () => {
      const res = buildDraftBody(opp({ sourceType }));
      expect(res.draft).toBeNull();
      expect(res.noDraftReason).toBeTruthy();
      expect(bestChannelFor(sourceType)).toBe("call");
    });
  }

  for (const sourceType of DRAFTABLE) {
    it(`${sourceType}: sms channel allowed`, () => {
      expect(bestChannelFor(sourceType)).toBe("sms");
    });
  }
});

describe("risk labeling", () => {
  it("clean verified row → low", () => {
    const { label } = riskLabelFor(opp({ dataQuality: "verified", consentOk: true }));
    expect(label).toBe("low");
  });

  it("inferred evidence / quote flags / ambiguity → elevated with reasons", () => {
    const { label, reasons } = riskLabelFor(
      opp({ dataQuality: "inferred", evidence: { identityAmbiguous: true, quoteFlags: ["below_parts_cost"] } }),
    );
    expect(label).toBe("elevated");
    expect(reasons.join(" ")).toMatch(/ambiguous/);
    expect(reasons.join(" ")).toMatch(/below_parts_cost/);
  });

  it("call-only complaint rows → human_only", () => {
    const { label } = riskLabelFor(opp({ sourceType: "review_recovery" }));
    expect(label).toBe("human_only");
  });
});
