/**
 * A 1-star review must never render as social proof.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * NeighborhoodPage renders the LIVE Google feed and filtered it by TEXT LENGTH
 * ONLY — 40 to 400 characters, no rating condition. Measured against the live
 * endpoint 2026-08-29, that feed's first entry is a 1-star review opening
 * "If I could rate 0 I would!!". It failed to render only because it happened
 * to exceed 400 characters. A shorter negative review, or that one edited down,
 * renders across 59 neighborhood pages — on the surface a customer checks
 * immediately before deciding whether to call.
 *
 * The server-side queries were never at risk; they already floor at 4 stars.
 * This closes the one client-side path that did not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isDisplayableReview,
  MIN_DISPLAYABLE_REVIEW_RATING,
  MIN_REVIEW_TEXT_CHARS,
  MAX_REVIEW_TEXT_CHARS,
} from "@shared/reviewDisplay";

const body = (n: number) => "x".repeat(n);
const GOOD_LEN = body(120);

describe("the rating floor", () => {
  // THE ACTUAL REVIEW, shortened to the length that would have rendered it.
  it("REFUSES the real 1-star review once it is short enough to fit", () => {
    expect(
      isDisplayableReview({
        rating: 1,
        text: "If I could rate 0 I would!! I trusted them to do a repair and had to get a tow instead.",
      }),
    ).toBe(false);
  });

  it("REFUSES every rating below the floor", () => {
    for (const rating of [1, 2, 3]) {
      expect(isDisplayableReview({ rating, text: GOOD_LEN }), `${rating} star`).toBe(false);
    }
  });

  // POSITIVE CONTROL. Without this the floor could reject everything and still
  // pass both refusals above — which would empty 59 pages instead of fixing them.
  it("PERMITS ratings at and above the floor", () => {
    for (const rating of [4, 5]) {
      expect(isDisplayableReview({ rating, text: GOOD_LEN }), `${rating} star`).toBe(true);
    }
  });

  // A MISSING RATING IS NOT A PASS. If the feed changes shape and stops
  // sending `rating`, "we could not tell" must not mean "show it".
  it("REFUSES a review whose rating is absent or unparseable", () => {
    expect(isDisplayableReview({ text: GOOD_LEN })).toBe(false);
    expect(isDisplayableReview({ rating: null, text: GOOD_LEN })).toBe(false);
    expect(isDisplayableReview({ rating: Number.NaN, text: GOOD_LEN })).toBe(false);
  });

  it("still applies the length bounds it replaced", () => {
    expect(isDisplayableReview({ rating: 5, text: body(MIN_REVIEW_TEXT_CHARS - 1) })).toBe(false);
    expect(isDisplayableReview({ rating: 5, text: body(MAX_REVIEW_TEXT_CHARS + 1) })).toBe(false);
    expect(isDisplayableReview({ rating: 5, text: body(MIN_REVIEW_TEXT_CHARS) })).toBe(true);
    expect(isDisplayableReview({ rating: 5, text: body(MAX_REVIEW_TEXT_CHARS) })).toBe(true);
  });
});

describe("one floor, not two", () => {
  const ROOT = join(__dirname, "..");

  // Two independently maintained floors is how one of them silently becomes 1.
  it("the server SQL floor still matches the shared constant", () => {
    const src = readFileSync(join(ROOT, "server", "routers", "public.ts"), "utf8");
    const m = /gte\(\s*reviewReplies\.reviewRating\s*,\s*(\d+)\s*\)/.exec(src);
    expect(m, "the server-side rating floor has moved or been removed").not.toBeNull();
    expect(Number(m![1])).toBe(MIN_DISPLAYABLE_REVIEW_RATING);
  });

  // The consumer must actually use it — a floor nothing calls is the
  // orphaned-subject shape, and this whole class of defect is why it matters.
  it("NeighborhoodPage filters through the shared predicate", () => {
    const page = readFileSync(join(ROOT, "client", "src", "pages", "NeighborhoodPage.tsx"), "utf8");
    expect(page).toContain("isDisplayableReview");
    // and no longer carries its own length-only filter
    expect(page).not.toMatch(/r\.text\.length >= 40 && r\.text\.length <= 400/);
  });
});
