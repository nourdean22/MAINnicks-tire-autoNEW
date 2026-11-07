/**
 * Spam never reaches the human queue (audit 2026-11-07): an inbound the classifier
 * calls bulk spam is written as `suppressed` at job creation, so it is never claimed,
 * never drafted and never counted by humanPendingSummary (which reads human_pending).
 * A real request must still be written `pending`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Anonymised inbound text SHAPES, written from the audit's categories, never copied from a
// real row: no real names, no digit run longer than 2. Inline so the knip orphan gate sees a consumer.
const SPAM_SHAPES: ReadonlyArray<{ kind: string; body: string }> = [
  { kind: "carrier bounce", body: "You have been blocked from originating messages to this number. Code XX" },
  { kind: "carrier bounce", body: "Message failed: sender blocked from originating to this destination" },
  { kind: "health robo", body: "Hi its Amy. Open enrollment ends soon, you may qualify for a no-cost health plan. Reply STOP to opt out" },
  { kind: "health robo", body: "Medicare Advantage update: new benefits in your area. Call us today to see if you qualify" },
  { kind: "health robo", body: "Affordable health coverage for your whole family starting at $XX a month, see if you qualify" },
  { kind: "lender", body: "Hi this is Dana with Summit Capital, your business is pre-approved for up to $XXk in working capital" },
  { kind: "lender", body: "Need cash for the shop? Merchant cash advance approved in 24h, no credit check. Reply YES" },
  { kind: "lender", body: "Business funding available today, get up to $XXk with one simple application" },
  { kind: "lender", body: "This is Rob at Bluewater Funding, I have updated terms on your file" },
  { kind: "url only", body: "https://bit.ly/abcdEF" },
  { kind: "url only", body: "  www.example-deals.com/offer  " },
  { kind: "url only", body: "https://a.example.com/x https://b.example.com/y" },
  { kind: "marketing", body: "Grow your shop with more 5-star reviews! Book a free demo this week. Reply STOP to unsubscribe" },
  { kind: "marketing", body: "FLASH SALE 50% off today only at our store. Msg&data rates may apply. Txt STOP to end" },
  { kind: "marketing", body: "Get more calls for your auto shop with our new ad program. Msg and data rates may apply" },
];

const REAL_REQUEST_SHAPES: ReadonlyArray<string> = [
  "can i bring my car in today",
  "how long is the wait",
  "need two rear tires",
  "car cut off on me",
  "coolant leak",
  "lifters ticking",
  "do you take financing? need new tires before winter",
  "my insurance company needs an estimate on the bumper",
  "stop by after work ok? need an oil change",
  "here is a pic of the tire https://img.example.com/x can you patch that",
  "can you guys check my brakes they are grinding bad",
  "is my car ready yet, you said it would be done by noon",
  "what do you charge for an alignment",
  "thank you so much see you tomorrow morning",
];

const h = vi.hoisted(() => ({ executed: [] as string[] }));

vi.mock("../db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      h.executed.push(text);
      if (/SELECT id FROM sms_response_jobs/.test(text)) return [[{ id: 9 }], []];
      return [{ affectedRows: 1 }, []];
    },
  }),
}));

import { isSpamInbound } from "../services/smsIntentRouter";
import { enqueueResponseJob } from "../services/smsResponseJobs";

beforeEach(() => {
  h.executed.length = 0;
});

describe("isSpamInbound — fixture-backed", () => {
  it("the fixtures are loaded (positive control: a scanner over nothing is green)", () => {
    expect(SPAM_SHAPES.length).toBeGreaterThanOrEqual(12);
    expect(REAL_REQUEST_SHAPES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(SPAM_SHAPES.map((s) => s.kind))).toEqual(
      new Set(["carrier bounce", "health robo", "lender", "url only", "marketing"]),
    );
  });

  it.each(SPAM_SHAPES.map((s) => [s.kind, s.body]))("spam (%s): %s", (_kind, body) => {
    expect(isSpamInbound(body)).toBe(true);
  });

  it.each(REAL_REQUEST_SHAPES.map((b) => [b]))("real request stays: %s", (body) => {
    expect(isSpamInbound(body)).toBe(false);
  });
});

describe("enqueueResponseJob — spam lands in suppressed at creation", () => {
  const insertOf = () => h.executed.find((q) => /INSERT IGNORE INTO sms_response_jobs/.test(q)) ?? "";

  it("a spam body is inserted as 'suppressed' with a spam marker", async () => {
    await enqueueResponseJob({ conversationId: 1, phone: "+12165550100", body: SPAM_SHAPES[0].body });
    expect(insertOf()).toMatch(/'suppressed'/);
    expect(insertOf()).toMatch(/spam_inbound/);
    expect(insertOf()).not.toMatch(/'pending'/);
  });

  it("a real request is inserted as 'pending' (it reaches the AI and the human queue)", async () => {
    await enqueueResponseJob({ conversationId: 1, phone: "+12165550100", body: "can i bring my car in today" });
    expect(insertOf()).toMatch(/'pending'/);
    expect(insertOf()).not.toMatch(/'suppressed'/);
  });
});
