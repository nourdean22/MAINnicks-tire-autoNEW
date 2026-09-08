/**
 * OpportunitiesSection — the four states it can be in, RENDERED.
 *
 * WHY A RENDER TEST AND NOT A SOURCE ASSERTION. The retired Decision Inbox's
 * own test file said it plainly: "A render test that mounted the panel with
 * queryable:false would prove more, but the panel pulls tRPC, auth and a
 * mutation, and the repo has no harness for that; a guard that ships beats a
 * harness that does not." That was true of the panel. It is not true here — this
 * component takes one query and one mutation, both mockable, so the stronger
 * proof is available and the weaker one is not an acceptable substitute.
 *
 * THE STATE THAT MATTERS MOST is `queryable: false`. An unreadable queue must
 * render as UNKNOWN and must NOT also print "genuinely clear" underneath, which
 * is worse than either alone. A source assertion can see that the branch exists;
 * only a render can see that the two branches are mutually exclusive.
 *
 * NOT A VISUAL REVIEW. This asserts composition and copy, not layout, spacing or
 * how it reads on a phone. The authenticated admin cannot be rendered outside a
 * deployed, signed-in browser (OAuth), so a pixel review remains an operator
 * step and is listed as such in the PR.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  queryResult: { data: undefined as unknown, isLoading: false, isError: false, isFetching: false },
  mutate: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ opportunityQueue: { list: { invalidate: h.invalidate } } }),
    opportunityQueue: {
      list: { useQuery: () => ({ ...h.queryResult, refetch: h.refetch }) },
      transition: { useMutation: () => ({ mutate: h.mutate }) },
    },
  },
}));

import OpportunitiesSection from "../pages/admin/OpportunitiesSection";

const row = {
  id: "11111111-2222-4333-8444-555555555555",
  recommendedAction: "Call Maria about the declined brake estimate",
  reason: "declined 9 days ago, no follow-up",
  customerName: "Maria",
  expectedRevenueCents: 84000,
  sourceType: "unapproved_estimate",
  dataQuality: "verified",
  state: "new",
};

beforeEach(() => {
  h.queryResult = { data: undefined, isLoading: false, isError: false, isFetching: false };
  h.mutate.mockClear();
});
afterEach(cleanup);

describe("an unreadable queue is UNKNOWN, never 'clear'", () => {
  beforeEach(() => {
    h.queryResult = { data: { items: [], queryable: false }, isLoading: false, isError: false, isFetching: false };
  });

  it("says UNKNOWN, not clear", () => {
    render(<OpportunitiesSection />);
    expect(screen.getByText(/UNKNOWN, not clear/i)).toBeTruthy();
  });

  it("does NOT also claim the queue is genuinely clear", () => {
    // The regression the retired panel's test was written for: a banner plus a
    // reassuring empty state, printed together.
    render(<OpportunitiesSection />);
    expect(screen.queryByText(/genuinely clear/i)).toBeNull();
    expect(screen.queryByText(/No open opportunities/i)).toBeNull();
  });
});

describe("a queue that WAS read and is empty says so, with its provenance", () => {
  it("claims 'clear' only when queryable === true", () => {
    h.queryResult = { data: { items: [], queryable: true }, isLoading: false, isError: false, isFetching: false };
    render(<OpportunitiesSection />);
    expect(screen.getByText(/genuinely clear/i)).toBeTruthy();
    expect(screen.queryByText(/UNKNOWN, not clear/i)).toBeNull();
  });
});

describe("a network error is not an empty queue either", () => {
  it("shows the unknown banner on isError", () => {
    h.queryResult = { data: undefined, isLoading: false, isError: true, isFetching: false };
    render(<OpportunitiesSection />);
    expect(screen.getByText(/UNKNOWN, not clear/i)).toBeTruthy();
    expect(screen.queryByText(/genuinely clear/i)).toBeNull();
  });
});

describe("populated rows, and the only write this surface can make", () => {
  beforeEach(() => {
    h.queryResult = { data: { items: [row], queryable: true }, isLoading: false, isError: false, isFetching: false };
  });

  it("shows the action, the reason and the evidence tier", () => {
    render(<OpportunitiesSection />);
    expect(screen.getByText(/Call Maria about the declined brake estimate/)).toBeTruthy();
    expect(screen.getByText(/declined 9 days ago/)).toBeTruthy();
    expect(screen.getByText(/evidence: verified/)).toBeTruthy();
  });

  it("renders a known value as dollars, not cents", () => {
    render(<OpportunitiesSection />);
    expect(screen.getByText(/\$840/)).toBeTruthy();
  });

  it("says 'value unknown' rather than $0 when the value is not known", () => {
    // $0 is a claim about the money. Absent is not zero — the same rule the
    // retired panel's brief block followed.
    h.queryResult = {
      data: { items: [{ ...row, expectedRevenueCents: null }], queryable: true },
      isLoading: false, isError: false, isFetching: false,
    };
    render(<OpportunitiesSection />);
    expect(screen.getByText(/value unknown/)).toBeTruthy();
    expect(screen.queryByText(/\$0/)).toBeNull();
  });

  it("dismissing writes ONLY `dismissed` — never lost, never do_not_contact", () => {
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /Dismiss opportunity/i }));
    expect(h.mutate).toHaveBeenCalledTimes(1);
    const arg = h.mutate.mock.calls[0][0];
    expect(arg.id).toBe(row.id);
    expect(arg.to).toBe("dismissed");
    expect(JSON.stringify(arg)).not.toMatch(/lost|do_not_contact|stated_concern/);
  });

  it("the dismiss control meets the 48px iOS PWA touch target", () => {
    // apps/nickstire/AGENTS.md §6: this admin is an installed iOS PWA and the
    // operator uses it on a phone; 48x48 minimum is a standing rule.
    render(<OpportunitiesSection />);
    const btn = screen.getByRole("button", { name: /Dismiss opportunity/i });
    expect(btn.className).toMatch(/min-h-\[48px\]/);
  });
});
