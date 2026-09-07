/**
 * SalesCard — rendered. The three things it must never do.
 *
 * 1. Never show $0 for a read that failed. The procedure returns a discriminated
 *    union so there is no number on the unavailable branch, but the CARD is
 *    where that guarantee is either honoured or quietly undone by a `?? 0`.
 * 2. Never call the figure "Total Sales". It is billed-not-collected, gross,
 *    tax-inclusive and unreconciled to the shop's own report. The label is
 *    "Billed" until an ALG period export has been compared line by line.
 * 3. Never hide the mirror lag. The ALG mirror runs a day behind; a figure
 *    without its through-date invites the operator to read it as "now".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    controlCenter: { shopSales: { useQuery: () => h.result } },
  },
}));

import SalesCard from "../pages/admin/SalesCard";

const ok = {
  available: true as const,
  cents: 4213500,
  invoiceCount: 37,
  period: "last_7d" as const,
  window: { fromISO: "2026-08-31", toISO: "2026-09-07", label: "Last 7 days" },
  throughDate: "2026-09-06",
  basis: "invoice_date" as const,
  grossOrNet: "gross_tax_inclusive" as const,
  definitionVersion: "shop-sales-v1-invoice-date-gross",
  exclusions: {
    pendingCount: 4, pendingCents: 120000,
    partialCount: 2, partialCentsFullValue: 65000,
    refundedCount: 1, refundedCents: 20000,
    blankInvoiceNumbers: 0,
  },
  reconciledToShopReport: false as const,
  caveats: ["Billed, not collected — invoice date basis. There is no payment-date column."],
};

beforeEach(() => { h.result = { data: undefined, isLoading: false, isError: false }; });
afterEach(cleanup);

describe("an unreadable period is UNKNOWN, never $0", () => {
  it("renders no dollar figure when the read failed", () => {
    h.result = { data: { available: false, reason: "Database not available" }, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(screen.getByText(/UNKNOWN, not \$0/i)).toBeTruthy();
    expect(screen.queryByText(/^\$0$/)).toBeNull();
    expect(screen.getByText(/Database not available/)).toBeTruthy();
  });

  it("renders the unknown banner on a network error too", () => {
    h.result = { data: undefined, isLoading: false, isError: true };
    render(<SalesCard />);
    expect(screen.getByText(/UNKNOWN, not \$0/i)).toBeTruthy();
  });
});

describe("the figure states what it is", () => {
  beforeEach(() => { h.result = { data: ok, isLoading: false, isError: false }; });

  it("shows whole dollars, not cents", () => {
    render(<SalesCard />);
    expect(screen.getByText("$42,135")).toBeTruthy();
  });

  it("does NOT call it Total Sales", () => {
    render(<SalesCard />);
    expect(screen.queryByText(/Total Sales/i)).toBeNull();
    // The heading specifically — "Billed" also appears in the basis caption
    // below the figure, which is deliberate repetition, not a duplicate label.
    expect(screen.getByRole("heading", { name: /Billed/ })).toBeTruthy();
  });

  it("says it is not reconciled to the shop report", () => {
    render(<SalesCard />);
    expect(screen.getByText(/not yet reconciled to the shop report/i)).toBeTruthy();
  });

  it("shows the mirror through-date so the lag is visible", () => {
    render(<SalesCard />);
    expect(screen.getByText(/mirror current through 2026-09-06/)).toBeTruthy();
  });

  it("says the through-date is unknown rather than implying 'now'", () => {
    h.result = { data: { ...ok, throughDate: null }, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(screen.getByText(/mirror through-date unknown/)).toBeTruthy();
  });

  it("names the period and the invoice count alongside the money", () => {
    render(<SalesCard />);
    expect(screen.getByText(/37 invoices · Last 7 days/)).toBeTruthy();
  });
});

describe("the exclusions are one tap away, and they are counted", () => {
  beforeEach(() => { h.result = { data: ok, isLoading: false, isError: false }; });

  it("hides the reconciliation detail until asked", () => {
    render(<SalesCard />);
    expect(screen.queryByText(/pending/i)).toBeNull();
  });

  it("shows pending, partial and refunded counts and values on expand", () => {
    render(<SalesCard />);
    fireEvent.click(screen.getByRole("button", { name: /What this excludes/i }));
    expect(screen.getByText(/pending/)).toBeTruthy();
    expect(screen.getByText(/\$1,200/)).toBeTruthy();   // pending
    expect(screen.getByText(/\$650/)).toBeTruthy();     // partial, full value
    expect(screen.getByText(/\$200/)).toBeTruthy();     // refunded
  });

  it("warns when rows have no invoice number, because dedupe is keyed on it", () => {
    h.result = {
      data: { ...ok, exclusions: { ...ok.exclusions, blankInvoiceNumbers: 3 } },
      isLoading: false, isError: false,
    };
    render(<SalesCard />);
    fireEvent.click(screen.getByRole("button", { name: /What this excludes/i }));
    expect(screen.getByText(/3 row\(s\) have no invoice number/)).toBeTruthy();
  });
});

describe("phone ergonomics", () => {
  it("period controls meet a 44px touch target", () => {
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    const btn = screen.getByRole("button", { name: "7 days" });
    expect(btn.className).toMatch(/min-h-\[44px\]/);
  });
});
