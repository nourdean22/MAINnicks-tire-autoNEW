/**
 * Every outbound message carries its own way out.
 *
 * This codebase already treats a STOP notice as MANDATORY everywhere else:
 * aiContentGenerator states it as a format rule for sms-blast ("Must include
 * 'Reply STOP to opt out'"), and declinedRecoverySequence and crossSellOutreach
 * put it in every variant they send.
 *
 * The four winback message bodies did not have it, and nothing appended one — so
 * the single sequence aimed at people who have NOT been in for three to six
 * months, the coldest audience the shop texts, was the one that went out with no
 * stated opt-out. The codebase's own standard, applied everywhere except where it
 * mattered most. Found while checking what a 268-person campaign would actually
 * say before it was activated.
 */
import { describe, it, expect } from "vitest";
import { withOptOutNotice } from "./services/winbackProcessor";
import { readCode, readSource } from "./testUtils/sourceAssertions";

describe("no winback text leaves without a way out", () => {
  it("appends the notice to a body that lacks one", () => {
    const out = withOptOutNotice("It's been a while since your last visit to Nick's Tire & Auto.");
    expect(out).toMatch(/Reply STOP to opt out\.$/);
  });

  it.each([
    "It's been a while since your last visit to Nick's Tire & Auto. Due for an oil change?",
    "Still here at Nick's Tire & Auto whenever it's easy. Drop it off any morning for a free check.",
    "Nick's Tire & Auto — open 7 days, walk-ins welcome.",
    "Last note from Nick's Tire & Auto for now — we're here 7 days a week, no appointment.",
  ])("covers the real campaign body: %s", (body) => {
    expect(withOptOutNotice(body)).toMatch(/STOP/i);
  });

  it("does NOT double up when the author already wrote one", () => {
    // crossSellOutreach and declinedRecoverySequence include it inline. An author
    // who does the right thing must not be punished with a duplicate.
    const body = "Hey there, Nick's here. Free check any day. Reply STOP to opt out.";
    expect(withOptOutNotice(body)).toBe(body);
  });

  it("recognises the notice in any casing", () => {
    const body = "Nick's here. Reply stop to opt out.";
    expect(withOptOutNotice(body)).toBe(body);
  });

  it("leaves an empty body alone rather than sending a bare notice", () => {
    // A message that is only "Reply STOP to opt out." is not a message.
    expect(withOptOutNotice("")).toBe("");
    expect(withOptOutNotice("   ")).toBe("");
  });

  it("is idempotent", () => {
    const once = withOptOutNotice("Nick's Tire & Auto, open 7 days.");
    expect(withOptOutNotice(once)).toBe(once);
  });
});

describe("both Queue publish paths carry the hashtags", () => {
  // Queue.tsx's reel capability moved to ReelQueue.tsx (Publish's Reels
  // segment, reel-absorption wave) and the legacy file was deleted —
  // capability-first this time, unlike the earlier premature deletion this
  // comment used to describe. The hashtag invariant travels with the port:
  // both the primary publish and the override retry must use the helper.
  const q = readSource("client/src/pages/admin/instagram/ReelQueue.tsx");
  const qc = readCode("client/src/pages/admin/instagram/ReelQueue.tsx");

  it("neither publish call sends the bare caption any more", () => {
    expect(qc).not.toMatch(/caption: draft\.caption \|\| ""/);
    expect(qc).not.toMatch(/caption: d\.caption \|\| ""/);
  });

  it("both the primary publish AND the override retry use the helper", () => {
    const uses = q.match(/captionWithHashtags\(/g) ?? [];
    // declaration + two call sites
    expect(uses.length).toBeGreaterThanOrEqual(3);
  });

  it("returns the bare caption when a draft genuinely has no hashtags", () => {
    expect(q).toMatch(/tags\.length \? /);
  });
});

describe("the cross-sell text says what the check is FOR", () => {
  const src = readSource("server/cron/jobs/crossSellOutreach.ts");
  const code = readCode("server/cron/jobs/crossSellOutreach.ts");

  it("SERVICE_LABELS finally has a reader", () => {
    // It was declared with ten services and referenced by nothing but its own
    // declaration, while predictedService was fetched, typed, mapped, logged and
    // stored — and the line the customer reads said "a check".
    const uses = src.match(/SERVICE_LABELS/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps it a soft prompt, not a diagnosis", () => {
    // The prediction is a statistical due-date, not an inspection. "Your brake
    // pads are worn" would assert a fact about a part nobody has looked at.
    expect(src).toMatch(/about due for/);
    expect(code).not.toMatch(/your .{0,30}(are|is) worn/i);
  });

  it("falls back to the generic line for an unknown service", () => {
    // Never print a raw enum value at a customer.
    expect(src).toMatch(/about due for a check/);
  });

  it("still carries its own STOP notice", () => {
    expect(src).toMatch(/Reply STOP to opt out\./);
  });
});
