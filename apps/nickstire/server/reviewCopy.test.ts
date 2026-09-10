/**
 * getReviewCopy — server-side twin of useReviewStats, same pins.
 *
 * Every AI prompt, GBP post, SMS template and invoice footer that quotes the
 * shop's review numbers goes through this. The decrease test is the important
 * one: those generators previously embedded a static floor, so a drop in the
 * real count was unrepresentable, and re-clamping to the floor here would
 * quietly restore that.
 *
 * The mock is load-bearing beyond determinism: unmocked, getGoogleReviews()
 * calls the live Places proxy AND reads shop_settings, and a successful fetch
 * fires a write back to that table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BUSINESS } from "@shared/business";

const mockGetGoogleReviews = vi.fn();

vi.mock("./google-reviews", () => ({
  getGoogleReviews: (...a: unknown[]) => mockGetGoogleReviews(...a),
}));

import { getReviewCopy } from "./lib/reviewCopy";

const FLOOR = BUSINESS.reviews.count as number;

describe("getReviewCopy", () => {
  beforeEach(() => mockGetGoogleReviews.mockReset());

  it("falls back to the static floor when the fetch returns nothing", async () => {
    mockGetGoogleReviews.mockResolvedValue(null);
    const copy = await getReviewCopy();

    expect(copy.count).toBe(FLOOR);
    expect(copy.rating).toBe(BUSINESS.reviews.rating);
  });

  it("uses live data when the fetch succeeds", async () => {
    mockGetGoogleReviews.mockResolvedValue({ totalReviews: FLOOR + 88, rating: 4.8 });
    const copy = await getReviewCopy();

    expect(copy.count).toBe(FLOOR + 88);
    expect(copy.rating).toBe(4.8);
  });

  it("lets a live count BELOW the floor through — a decrease must be able to surface", async () => {
    const dropped = FLOOR - 300;
    mockGetGoogleReviews.mockResolvedValue({ totalReviews: dropped, rating: 4.6 });
    const copy = await getReviewCopy();

    expect(copy.count).toBe(dropped);
    expect(copy.count).toBeLessThan(FLOOR);
  });

  it("formats the count the same way the client does", async () => {
    mockGetGoogleReviews.mockResolvedValue({ totalReviews: 1723, rating: 4.9 });
    const copy = await getReviewCopy();

    expect(copy.countDisplay).toBe("1,723+");
  });

  it("keeps the static rating when the payload omits one", async () => {
    mockGetGoogleReviews.mockResolvedValue({ totalReviews: FLOOR + 5 });
    const copy = await getReviewCopy();

    expect(copy.rating).toBe(BUSINESS.reviews.rating);
  });

  it("pads a round rating to one decimal for generated copy", async () => {
    mockGetGoogleReviews.mockResolvedValue({ totalReviews: 1723, rating: 5 });
    const copy = await getReviewCopy();

    expect(copy.rating).toBe(5);
    expect(copy.ratingDisplay).toBe("5.0");
  });
});
