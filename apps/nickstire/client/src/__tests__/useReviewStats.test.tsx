/**
 * useReviewStats — the wiring, not the precedence.
 *
 * `resolveReviewDisplay()` already has its own coverage in
 * shared/business.test.ts. What is pinned here is that the hook actually
 * ROUTES through it: that an unresolved query degrades to the static floor,
 * that live data replaces the floor, and — the case this whole effort exists
 * for — that a live count BELOW the floor still wins. The pre-2026-09-09 code
 * could not express a decrease at all; a well-meaning `Math.max(floor, live)`
 * would restore that bug silently, and the third test is what fails if anyone
 * adds one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { BUSINESS } from "@shared/business";

const mockQuery = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    reviews: {
      google: {
        useQuery: (...args: unknown[]) => mockQuery(...args),
      },
    },
  },
}));

import { useReviewStats } from "@/hooks/useReviewStats";

const FLOOR = BUSINESS.reviews.count as number;

describe("useReviewStats", () => {
  beforeEach(() => mockQuery.mockReset());

  it("falls back to the static floor while the query is unresolved", () => {
    mockQuery.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useReviewStats());

    expect(result.current.count).toBe(FLOOR);
    expect(result.current.rating).toBe(BUSINESS.reviews.rating);
    expect(result.current.isLive).toBe(false);
  });

  it("uses live data once the query resolves", () => {
    mockQuery.mockReturnValue({ data: { totalReviews: FLOOR + 143, rating: 4.8 } });
    const { result } = renderHook(() => useReviewStats());

    expect(result.current.count).toBe(FLOOR + 143);
    expect(result.current.rating).toBe(4.8);
    expect(result.current.isLive).toBe(true);
  });

  it("lets a live count BELOW the floor through — a decrease must be able to surface", () => {
    const dropped = FLOOR - 200;
    mockQuery.mockReturnValue({ data: { totalReviews: dropped, rating: 4.7 } });
    const { result } = renderHook(() => useReviewStats());

    expect(result.current.count).toBe(dropped);
    expect(result.current.count).toBeLessThan(FLOOR);
    expect(result.current.isLive).toBe(true);
  });

  it("formats the count for copy with a thousands separator and a trailing +", () => {
    mockQuery.mockReturnValue({ data: { totalReviews: 1723, rating: 4.9 } });
    const { result } = renderHook(() => useReviewStats());

    expect(result.current.countDisplay).toBe("1,723+");
  });

  it("keeps the static rating when the payload omits one", () => {
    mockQuery.mockReturnValue({ data: { totalReviews: FLOOR + 10 } });
    const { result } = renderHook(() => useReviewStats());

    expect(result.current.rating).toBe(BUSINESS.reviews.rating);
  });

  it("requests the hour-long cache window the server caches for", () => {
    mockQuery.mockReturnValue({ data: undefined });
    renderHook(() => useReviewStats());

    expect(mockQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ staleTime: 60 * 60 * 1000 }),
    );
  });
});
