/**
 * Canaries for the urgent-review alert's OFF SWITCH (2026-08-25).
 *
 * MEASURED against production. Two tables mirror the same seven Google reviews:
 *
 *   review_pipeline  7 rows, ALL `reviewed = 0, responseSent = 0`. This is
 *                    what the daily "URGENT REVIEWS" Telegram reads.
 *   review_replies   7 rows, ALL status `draft`. 0 ever approved, 0 ever
 *                    posted. Oldest 256 days. This is where the operator's
 *                    approve / mark-posted workflow writes.
 *
 * Nothing assigns `reviewed` or `responseSent` anywhere in the repo - every
 * reference is a read, and prod agrees: zero rows carry either flag. So the
 * alert had NO reachable off switch. Replying on Google and marking the reply
 * posted left `reviewed = 0`, and the same 1-star review was re-announced the
 * next day, and the next.
 *
 * BASE RATE, so the numbers are not read as a crisis: 1 of 7 reviews is
 * 1-star; the other 6 are 5-star. The open complaint is 37 days old by its own
 * Google timestamp, though its pipeline row is only 14 days old - which is why
 * the age is computed from reviewTime, not createdAt.
 *
 * SYNTHETIC FIXTURES ONLY. `closureFor` is driven with fabricated rows, so
 * this suite keeps its meaning after the backlog clears.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { closureFor, suppressesAlert, URGENT_MAX_STARS } from "./services/reviewClosure";

function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const OPEN_COMPLAINT = { authorName: "Daylan Smith", rating: 1 };

describe("canary - a posted reply closes the alert", () => {
  it("BREAKS: the review with a posted reply no longer counts as urgent", () => {
    const c = closureFor(OPEN_COMPLAINT, [{ reviewerName: "Daylan Smith", reviewRating: 1 }]);
    expect(c).toBe("posted");
    expect(suppressesAlert(c)).toBe(true);
  });

  it("with no posted reply it stays open - the alert must still fire", () => {
    expect(closureFor(OPEN_COMPLAINT, [])).toBe("open");
    expect(suppressesAlert("open")).toBe(false);
  });

  it("a reply posted for a DIFFERENT review does not silence this one", () => {
    // Same shop, different customer. Matching on name alone would wrongly
    // clear every open complaint the moment any reply was posted.
    expect(closureFor(OPEN_COMPLAINT, [{ reviewerName: "Willie Bender", reviewRating: 5 }])).toBe("open");
  });

  it("a reply to the same person at a DIFFERENT rating does not count", () => {
    // A returning customer can leave a 5-star and later a 1-star. Answering
    // the praise must not retire the complaint.
    expect(closureFor(OPEN_COMPLAINT, [{ reviewerName: "Daylan Smith", reviewRating: 5 }])).toBe("open");
  });

  it("names match case- and whitespace-insensitively", () => {
    // Google echoes display names inconsistently; an exact-string compare was
    // the original defect class in this app's phone matcher (ROS-093).
    expect(closureFor(OPEN_COMPLAINT, [{ reviewerName: "  daylan   SMITH ", reviewRating: 1 }])).toBe("posted");
  });

  it("an anonymous review is never auto-closed", () => {
    // Empty names would all collide, so one posted anonymous reply would
    // silence every anonymous complaint.
    expect(closureFor({ authorName: null, rating: 1 }, [{ reviewerName: null, reviewRating: 1 }])).toBe("open");
    expect(closureFor({ authorName: "   ", rating: 1 }, [{ reviewerName: "", reviewRating: 1 }])).toBe("open");
  });
});

describe("canary - ambiguity stays LOUD", () => {
  it("BREAKS: two candidate replies do NOT silence the alert", () => {
    // The tables share no key, so the correlation is (name, rating) and is
    // imprecise by construction. A false "closed" hides a real 1-star
    // complaint - strictly worse than one extra day of alert.
    const c = closureFor(OPEN_COMPLAINT, [
      { reviewerName: "Daylan Smith", reviewRating: 1 },
      { reviewerName: "daylan smith", reviewRating: 1 },
    ]);
    expect(c).toBe("ambiguous");
    expect(suppressesAlert(c)).toBe(false);
  });

  it("POSITIVE CONTROL: all three outcomes are reachable", () => {
    // Without this, a closureFor that always returned "open" would satisfy
    // every negative assertion above.
    const seen = new Set([
      closureFor(OPEN_COMPLAINT, []),
      closureFor(OPEN_COMPLAINT, [{ reviewerName: "Daylan Smith", reviewRating: 1 }]),
      closureFor(OPEN_COMPLAINT, [
        { reviewerName: "Daylan Smith", reviewRating: 1 },
        { reviewerName: "Daylan Smith", reviewRating: 1 },
      ]),
    ]);
    expect(seen.size).toBe(3);
  });

  it("only 'posted' suppresses - nothing else may be added quietly", () => {
    expect(suppressesAlert("posted")).toBe(true);
    expect(suppressesAlert("open")).toBe(false);
    expect(suppressesAlert("ambiguous")).toBe(false);
  });
});

describe("canary - the off switch is WIRED into the alert's reader", () => {
  const src = stripComments(
    readFileSync(join(process.cwd(), "server/pipelines/gbp-reviews.ts"), "utf-8"),
  );
  const fn = src.slice(src.indexOf("export async function getUrgentReviews"));

  it("BREAKS: it reads posted replies and filters on them", () => {
    // A local helper of the same name would satisfy an identifier-only
    // assertion, so pin the import specifier AND the call.
    expect(src).toContain('from "../services/reviewClosure"');
    expect(fn).toMatch(/isNotNull\(reviewReplies\.postedAt\)/);
    expect(fn).toMatch(/suppressesAlert\(closureFor\(/);
  });

  it("the star cut comes from the shared constant, not a literal", () => {
    // Two places deciding what "urgent" means is how the alert and the
    // workflow drifted apart in the first place.
    expect(fn).toContain("URGENT_MAX_STARS");
    expect(fn).not.toMatch(/lte\(reviewPipeline\.rating,\s*\d/);
    expect(URGENT_MAX_STARS).toBe(2);
  });

  it("BREAKS: age is computed IN SQL, never by subtracting dates in JS", () => {
    // Driver-parsed TiDB DATETIME values come back shifted on Eastern time,
    // so a JS subtraction is wrong by hours and can round a day either way.
    expect(fn).toMatch(/DATEDIFF\(NOW\(\)/);
    expect(fn).toMatch(/FROM_UNIXTIME/);
    expect(fn).not.toMatch(/Date\.now\(\)\s*-/);
  });

  it("BREAKS: UrgentReview is a type alias, not an interface", () => {
    // Not cosmetic. Only a type alias gets an implicit index signature, so
    // only a type alias stays assignable to Record<string, unknown> - which is
    // how the scheduler's message formatter types this row. Declaring it as an
    // interface compiles in this file and breaks the caller.
    expect(src).toMatch(/export type UrgentReview = \{/);
    expect(src).not.toMatch(/export interface UrgentReview/);
  });
});
