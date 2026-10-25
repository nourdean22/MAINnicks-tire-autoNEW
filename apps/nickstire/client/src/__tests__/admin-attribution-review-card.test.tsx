/**
 * Attribution review card, plain words (job 2026-10-25-attribution-self-learning).
 *
 * Nour, 2026-10-25, on the Voice Receptionist tab: "this attribution this is big bulky
 * ugly and all in the way of stuff i dont need, plus its only got numbers and i cant
 * track them anyways." What these tests pin:
 *   - nothing to review renders nothing; a failed read says so and offers Retry;
 *   - the card is one line until opened, and the row buttons are not on screen before;
 *   - a row names the person, what they asked for, when they called, the sale's day and
 *     total, and why the match is weak, in words; never a match_method token;
 *   - the two explanatory paragraphs sit behind a "Why" disclosure;
 *   - Confirm goes through confirmDialog (iOS PWA) and calls resolve once with the row's ids.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

type Row = {
  runId: string | null;
  callId: number;
  invoiceId: number | null;
  leadId: number | null;
  bookingId: number | null;
  workOrderId: string | null;
  matchMethod: string | null;
  evidenceLevel: string | null;
  confidence: number | null;
  firstName: string | null;
  askedFor: string | null;
  calledAt: string;
  callOutcome: string | null;
  invoicedAt: string | null;
  invoiceTotalCents: number | null;
  invoiceService: string | null;
  band: { band: string; label: string; basis: string; whatWouldRaiseIt: string | null; observed: boolean; why: string };
};

const h = vi.hoisted(() => ({
  q: { data: undefined as unknown, isLoading: false, isError: false },
  resolveCalls: [] as unknown[],
  invalidate: vi.fn(),
  refetch: vi.fn(),
  confirm: vi.fn(async (_opts: { title: string; message?: string }) => true),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      revenueAttribution: {
        reviewQueue: { invalidate: h.invalidate },
        leadRevenueSummary: { invalidate: h.invalidate },
        callInvoiceReview: { invalidate: h.invalidate },
      },
    }),
    revenueAttribution: {
      reviewQueue: { useQuery: () => ({ ...h.q, refetch: h.refetch }) },
      resolve: {
        useMutation: (opts: { onSuccess?: () => void; onSettled?: () => void }) => ({
          mutate: (vars: unknown) => {
            h.resolveCalls.push(vars);
            opts.onSuccess?.();
            opts.onSettled?.();
          },
        }),
      },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirm, default: () => null }));

import { AttributionReviewCard } from "../pages/admin/voice/AttributionReviewCard";

const weak = (over: Partial<Row> = {}): Row => ({
  runId: "run-1",
  callId: 20070022,
  invoiceId: 6060001,
  leadId: null,
  bookingId: null,
  workOrderId: null,
  matchMethod: "phone_time_service_candidate",
  evidenceLevel: "inferred",
  confidence: 0.75,
  firstName: "Dave",
  askedFor: "brake pads",
  calledAt: "2026-10-21T18:10:00.000Z",
  callOutcome: "walk_in_directed",
  invoicedAt: "2026-10-23T15:00:00.000Z",
  invoiceTotalCents: 41200,
  invoiceService: "FRONT BRAKE PADS AND ROTORS",
  band: {
    band: "weak",
    label: "Same phone and timing only",
    basis: "Exact phone match and invoice paid inside the window.",
    whatWouldRaiseIt: null,
    observed: false,
    why: "Same phone, and the sale came within 14 days of the call. Nothing else ties them.",
  },
  ...over,
});

function queue(rows: Row[], extra: Record<string, unknown> = {}) {
  return {
    rows,
    duplicates: [],
    contestedInvoiceIds: [],
    counts: { distinctInvoices: rows.length, candidateRows: rows.length, suppressedDuplicates: 0, overcountFactor: 1 },
    bands: { verified: 0, strong: 0, weak: rows.length, unscored: 0, total: rows.length, inferredPct: 100 },
    bandCaveat: "These bands rank evidence, not probability.",
    ...extra,
  };
}

beforeEach(() => {
  h.q = { data: undefined, isLoading: false, isError: false };
  h.resolveCalls.length = 0;
  h.confirm.mockClear();
});

describe("AttributionReviewCard · out of the way", () => {
  it("renders nothing when there is nothing to review", () => {
    h.q.data = queue([]);
    const { container } = render(<AttributionReviewCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a failed read says it could not load and offers Retry, never an empty card", () => {
    h.q.isError = true;
    render(<AttributionReviewCard />);
    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("is one line until opened: a count, no row buttons, no explanatory paragraphs", () => {
    h.q.data = queue(Array.from({ length: 9 }, (_, i) => weak({ callId: 100 + i, invoiceId: 200 + i })));
    render(<AttributionReviewCard />);
    const toggle = screen.getByRole("button", { name: /9 matches to review/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
    expect(screen.queryByText(/rank evidence/i)).toBeNull();
    expect(screen.queryByText(/phone_time_service_candidate/)).toBeNull();
  });
});

describe("AttributionReviewCard · plain words", () => {
  it("a row names the person, the ask, the call time, the sale, and why it is weak", () => {
    h.q.data = queue([weak()]);
    render(<AttributionReviewCard />);
    fireEvent.click(screen.getByRole("button", { name: /1 match to review/i }));
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("Dave");
    expect(row).toHaveTextContent("brake pads");
    expect(row).toHaveTextContent(/Oct 21/);
    expect(row).toHaveTextContent(/Oct 23/);
    expect(row).toHaveTextContent("$412");
    expect(row).toHaveTextContent("Nothing else ties them");
    expect(row).not.toHaveTextContent("phone_time_service_candidate");
    expect(row).not.toHaveTextContent(/invoice #/);
  });

  it("a row with no usable name reads unknown caller; no ask reads so too", () => {
    h.q.data = queue([weak({ firstName: null, askedFor: null })]);
    render(<AttributionReviewCard />);
    fireEvent.click(screen.getByRole("button", { name: /1 match to review/i }));
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent(/unknown caller/i);
    expect(row).toHaveTextContent(/did not say what for/i);
  });

  it("the explanation sits behind a Why disclosure, one sentence first", () => {
    h.q.data = queue([weak(), weak({ callId: 2, invoiceId: 3 })], {
      duplicates: [weak({ callId: 9 })],
      contestedInvoiceIds: [6060001],
      counts: { distinctInvoices: 2, candidateRows: 3, suppressedDuplicates: 1, overcountFactor: 1.5 },
    });
    render(<AttributionReviewCard />);
    fireEvent.click(screen.getByRole("button", { name: /2 matches to review/i }));
    expect(screen.queryByText(/rank evidence/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^why/i }));
    expect(screen.getByText(/rank evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/1 repeat call/i)).toBeInTheDocument();
  });

  it("every row button is a 48 px target (apps/nickstire/AGENTS.md, iOS PWA)", () => {
    h.q.data = queue([weak()]);
    render(<AttributionReviewCard />);
    fireEvent.click(screen.getByRole("button", { name: /1 match to review/i }));
    for (const name of [/confirm/i, /unsure/i, /reject/i]) {
      expect(screen.getByRole("button", { name }).className).toMatch(/min-h-\[48px\]/);
    }
  });
});

describe("AttributionReviewCard · ruling", () => {
  it("Confirm asks through confirmDialog in plain words and records one ruling with the row's ids", async () => {
    h.q.data = queue([weak()]);
    const native = vi.spyOn(window, "confirm");
    render(<AttributionReviewCard />);
    fireEvent.click(screen.getByRole("button", { name: /1 match to review/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });
    // iOS PWA standalone swallows window.confirm; the ruling must never route through it.
    expect(native).not.toHaveBeenCalled();
    expect(h.confirm).toHaveBeenCalledTimes(1);
    const dialog = h.confirm.mock.calls[0][0];
    expect(`${dialog.title} ${dialog.message}`).toMatch(/Dave/);
    expect(`${dialog.title} ${dialog.message}`).not.toMatch(/phone_time|Call #/);
    expect(h.resolveCalls).toHaveLength(1);
    expect(h.resolveCalls[0]).toMatchObject({
      callId: 20070022,
      invoiceId: 6060001,
      decision: "confirmed",
      evidenceLevel: "verified",
      confidence: 1,
    });
  });

  it("a declined dialog records nothing", async () => {
    h.confirm.mockResolvedValueOnce(false);
    h.q.data = queue([weak()]);
    render(<AttributionReviewCard />);
    fireEvent.click(screen.getByRole("button", { name: /1 match to review/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    });
    expect(h.resolveCalls).toHaveLength(0);
  });
});

describe("AttributionReviewCard · review round (Codex, PR 3271)", () => {
  it("keeps the cents on a sale total and labels an inferred row as inferred", () => {
    h.q.data = queue([weak({ invoiceTotalCents: 41250 })]);
    render(<AttributionReviewCard />);
    fireEvent.click(screen.getByRole("button", { name: /1 match to review/i }));
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("$412.50");
    expect(row).not.toHaveTextContent("$413");
    expect(row).toHaveTextContent(/Inferred/);
  });

  it("a recorded link is labelled Recorded, not Inferred", () => {
    h.q.data = queue([weak({ confidence: 1, band: { band: "verified", label: "Recorded link", basis: "b", whatWouldRaiseIt: null, observed: true, why: "A record ties this call to this sale." } })]);
    render(<AttributionReviewCard />);
    fireEvent.click(screen.getByRole("button", { name: /1 match to review/i }));
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent(/Recorded/);
    expect(row).not.toHaveTextContent(/Inferred/);
  });
});
