/**
 * Tests for the review-reply claim-safety QA layer (shared/reviewReplyQa.ts).
 * The load-bearing assertions: a reply with a forbidden claim can never be
 * approved (block tier), legitimate neighborhood-shop replies pass clean,
 * and the AI draft prompt rules stay in lockstep with the detector.
 */
import { describe, it, expect } from "vitest";
import {
  checkReviewReply,
  hasBlockingFindings,
  buildReplyPromptRules,
  REPLY_BLOCK_PATTERNS,
} from "../shared/reviewReplyQa";

const blockRules = (text: string) =>
  checkReviewReply(text).filter((f) => f.severity === "block").map((f) => f.rule);
const warnRules = (text: string) =>
  checkReviewReply(text).filter((f) => f.severity === "warn").map((f) => f.rule);

describe("review-reply claim safety — block tier", () => {
  it("blocks guarantees", () => {
    expect(blockRules("We guarantee you'll leave happy!")).toContain("no-guarantees");
    expect(blockRules("Satisfaction guaranteed on every visit.")).toContain("no-guarantees");
  });

  it("blocks warranty talk", () => {
    expect(blockRules("Your tires are covered by our warranty.")).toContain("no-warranty-talk");
    expect(blockRules("All warranties honored here.")).toContain("no-warranty-talk");
  });

  it("blocks 'free' claims except 'free check'", () => {
    expect(blockRules("Come back for a free oil change on us.")).toContain("no-free-claims");
    expect(blockRules("Stop by for a free check anytime.")).toEqual([]);
    expect(blockRules("We do free checks every day.")).toEqual([]);
  });

  it("blocks self-ranking claims", () => {
    expect(blockRules("Glad you agree we're the best shop around!")).toContain("no-best-claims");
    expect(blockRules("Best in Cleveland, every time.")).toContain("no-best-claims");
  });

  it("blocks wait-time number promises", () => {
    expect(blockRules("We'll have you out in 20 minutes next time.")).toContain("no-wait-time-promises");
    expect(blockRules("Most jobs done within 2 hours.")).toContain("no-wait-time-promises");
  });

  it("blocks price talk", () => {
    expect(blockRules("Used tires start at $60 installed.")).toContain("no-price-talk");
    expect(blockRules("That job should run about $ 150.")).toContain("no-price-talk");
  });

  it("passes clean neighborhood-shop replies (including the cron fallback templates)", () => {
    const clean = [
      "Thank you so much, Maria! We're glad the brakes feel right. We look forward to seeing you again!",
      "We're sorry about your experience, John. This isn't our standard. Please call us at (216) 862-0005 so we can make it right.",
      "Thank you for your feedback, Sam. We'd love to make your next visit even better. Please call us at (216) 862-0005 — we want to get it right.",
      "Thank you for your review! We appreciate your feedback.",
    ];
    for (const text of clean) {
      expect(blockRules(text)).toEqual([]);
    }
  });

  it("does not false-positive on the shop phone number", () => {
    // "(216) 862-0005" has digits but no $ and no in/under/within prefix.
    expect(blockRules("Call us at (216) 862-0005 and ask for the manager.")).toEqual([]);
  });
});

describe("review-reply claim safety — warn tier", () => {
  it("warns (not blocks) on fake-corporate adjectives", () => {
    const text = "We pride ourselves on quality service.";
    expect(warnRules(text)).toContain("kill-word");
    expect(blockRules(text)).toEqual([]);
  });

  it("warns (not blocks) on same-day wording", () => {
    const text = "Glad we got you in same-day!";
    expect(warnRules(text)).toContain("same-day");
    expect(blockRules(text)).toEqual([]);
  });

  it("warns on bot phrases", () => {
    expect(warnRules("Rest assured, we will look into it.")).toContain("bot-phrase");
  });

  it("hasBlockingFindings distinguishes tiers", () => {
    expect(hasBlockingFindings(checkReviewReply("We guarantee it."))).toBe(true);
    expect(hasBlockingFindings(checkReviewReply("Quality work, every time."))).toBe(false);
  });
});

// The posted-state machine itself (markPosted only reachable from
// approved) is pinned at router level in __tests__/review-replies.test.ts.

describe("prompt rules stay in lockstep with the detector", () => {
  it("the prompt rules mention every blocked claim family", () => {
    const rules = buildReplyPromptRules().toLowerCase();
    expect(rules).toMatch(/guarantee/);
    expect(rules).toMatch(/warrant/);
    expect(rules).toMatch(/free check/);
    expect(rules).toMatch(/price/);
    expect(rules).toMatch(/wait time/);
    expect(rules).toMatch(/same.day/);
  });

  it("every block pattern carries a fix the operator can act on", () => {
    for (const r of REPLY_BLOCK_PATTERNS) {
      expect(r.fix.length).toBeGreaterThan(10);
    }
  });
});
