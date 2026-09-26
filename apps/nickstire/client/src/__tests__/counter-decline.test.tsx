/**
 * Q-37 · Declined Work says HOW each decline is known, and the counter can
 * record one in a single tap.
 *
 * RENDERED, not source-asserted:
 *   · each provenance renders its own label — an inferred row never reads as a
 *     customer decision, and an unreadable capture read renders UNKNOWN;
 *   · the strip explains the split, including "migration pending" and "couldn't
 *     load" as their own states (never folded into "all inferred");
 *   · the DECLINED button is one tap: it calls the mutation directly, never a
 *     native dialog (suppressed in iOS standalone, the operator's device), and
 *     is a 48px target. It is not offered on a row already captured.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ invoices: { declined: { invalidate: vi.fn() } } }),
    invoices: {
      captureDecline: { useMutation: () => ({ mutate: h.mutate, isPending: h.isPending }) },
    },
  },
}));

import { CounterDeclineButton, DeclineProvenanceBadge, DeclineProvenanceStrip } from "../pages/admin/money/CounterDecline";

beforeEach(() => { h.mutate.mockClear(); h.isPending = false; });
afterEach(cleanup);

describe("DeclineProvenanceBadge", () => {
  it("renders a distinct label per provenance", () => {
    const { rerender } = render(<DeclineProvenanceBadge provenance="counter" />);
    expect(screen.getByText(/declined at counter/i)).toBeTruthy();
    rerender(<DeclineProvenanceBadge provenance="inferred" />);
    expect(screen.getByText(/inferred/i)).toBeTruthy();
    expect(screen.queryByText(/declined at counter/i)).toBeNull();
    rerender(<DeclineProvenanceBadge provenance="unknown" />);
    expect(screen.getByText(/unknown/i)).toBeTruthy();
  });
});

describe("DeclineProvenanceStrip", () => {
  it("reports the split when captures were read", () => {
    render(<DeclineProvenanceStrip captureStatus="ok" counts={{ counter: 2, inferred: 5, unknown: 0 }} />);
    expect(screen.getByText(/2 declined at counter/i)).toBeTruthy();
    expect(screen.getByText(/5 inferred/i)).toBeTruthy();
  });

  it("says the migration is pending rather than implying nobody captured anything", () => {
    render(<DeclineProvenanceStrip captureStatus="not_enabled" counts={{ counter: 0, inferred: 7, unknown: 0 }} />);
    expect(screen.getByText(/not enabled yet/i)).toBeTruthy();
  });

  it("an unreadable capture read is UNKNOWN, not 'all inferred'", () => {
    render(<DeclineProvenanceStrip captureStatus="error" counts={{ counter: 0, inferred: 0, unknown: 7 }} />);
    expect(screen.getByText(/couldn.t load/i)).toBeTruthy();
    expect(screen.queryByText(/inferred \(/i)).toBeNull();
  });
});

describe("CounterDeclineButton", () => {
  it("one tap records the decline — no native dialog", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const promptSpy = vi.spyOn(window, "prompt");
    try {
      render(<CounterDeclineButton estimateId={42} provenance="inferred" />);
      fireEvent.click(screen.getByRole("button", { name: /customer declined/i }));
      expect(h.mutate).toHaveBeenCalledWith({ id: 42 });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(promptSpy).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
      promptSpy.mockRestore();
    }
  });

  it("is a 48px target", () => {
    render(<CounterDeclineButton estimateId={42} provenance="inferred" />);
    const btn = screen.getByRole("button", { name: /customer declined/i });
    expect(btn.className).toMatch(/min-h-12/);
    expect(btn.className).toMatch(/min-w-12/);
  });

  it("is not offered once the counter has captured it", () => {
    render(<CounterDeclineButton estimateId={42} provenance="counter" />);
    expect(screen.queryByRole("button", { name: /customer declined/i })).toBeNull();
  });
});
