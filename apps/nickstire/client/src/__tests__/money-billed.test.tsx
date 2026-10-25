/**
 * Money > Billed (2026-10-25): the billed figure beside the window before, and one action.
 *
 * Rules pinned here, read from the rendered output:
 * 1. An average never shows without its count, and never as $0 when there were no invoices.
 * 2. A percent change shows only when the earlier window billed something.
 * 3. An earlier window no sync has covered shows no figure.
 * 4. The action panel picks the best-scoring estimate that has a phone and no follow-up yet,
 *    names it by first name and vehicle, and never prints the phone.
 * 5. A failed read is unknown: no $0, no "no estimate".
 * The Today form of SalesCard (no variant) is pinned in sales-card.test.tsx and stays as it was.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  sales: { data: undefined as unknown, isLoading: false, isError: false },
  declined: { data: undefined as unknown, isLoading: false, isError: false, refetch: () => {} } as {
    data: unknown;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
  },
  declinedInputs: [] as unknown[],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    controlCenter: { shopSales: { useQuery: () => h.sales } },
    invoices: {
      declined: {
        useQuery: (input: unknown) => {
          h.declinedInputs.push(input);
          return h.declined;
        },
      },
    },
  },
}));

import SalesCard from "../pages/admin/SalesCard";
import NextEstimate from "../pages/admin/money/NextEstimate";

const base = {
  available: true as const,
  cents: 424925,
  invoiceCount: 6,
  averageCents: 70821 as number | null,
  period: "last_7d" as const,
  window: { fromISO: "2026-10-18", toISO: "2026-10-25", label: "Last 7 days" },
  throughDate: "2026-10-24",
  sync: { state: "ok" as const, lastAt: "2026-10-25T08:05:00.000Z", etDate: "2026-10-25", etTime: "4:05 AM" },
  windowSynced: true as boolean | null,
  syncInFlight: false,
  basis: "invoice_date" as const,
  grossOrNet: "gross_tax_inclusive" as const,
  definitionVersion: "shop-sales-v1-invoice-date-gross",
  exclusions: {
    pendingCount: 0, pendingCents: 0, partialCount: 0, partialCentsFullValue: 0,
    refundedCount: 0, refundedCents: 0, blankInvoiceNumbers: 0,
  },
  reconciledToShopReport: false as const,
  caveats: ["Billed, not collected: invoice date basis."],
  previous: {
    cents: 519327,
    invoiceCount: 8,
    averageCents: 64916 as number | null,
    window: { fromISO: "2026-10-11", toISO: "2026-10-18", label: "The 7 days before" },
    windowSynced: true as boolean | null,
  } as null | {
    cents: number;
    invoiceCount: number;
    averageCents: number | null;
    window: { fromISO: string; toISO: string; label: string };
    windowSynced: boolean | null;
  },
};
const sales = (over: Partial<typeof base> = {}) => {
  h.sales = { data: { ...base, ...over }, isLoading: false, isError: false };
};
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  h.sales = { data: undefined, isLoading: false, isError: false };
  h.declined = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  h.declinedInputs = [];
});

describe("SalesCard money variant: the window and the one before it", () => {
  it("shows the count with the average, the earlier window with its label, and the change with a percent", () => {
    sales();
    render(<SalesCard variant="money" />);
    expect(screen.getByText("$4,249")).toBeTruthy();
    expect(screen.getByText("6 closed invoices · avg $708")).toBeTruthy();
    expect(screen.getByText("The 7 days before: $5,193 · 8 invoices · avg $649")).toBeTruthy();
    expect(screen.getByText("Change: down $944 · -18%")).toBeTruthy();
    // The basis line stays on the money form too.
    expect(screen.getByText(/not yet reconciled to the shop report/)).toBeTruthy();
  });

  it("says up when the window billed more, with the percent", () => {
    sales({ cents: 519327, previous: { ...base.previous!, cents: 424925 } });
    render(<SalesCard variant="money" />);
    expect(screen.getByText("Change: up $944 · +22%")).toBeTruthy();
  });

  it("no invoices: says so, with no average and no $0 average; no earlier window: says so", () => {
    sales({ cents: 0, invoiceCount: 0, averageCents: null, previous: null });
    render(<SalesCard variant="money" />);
    expect(screen.getByText("No closed invoices in this window")).toBeTruthy();
    expect(screen.getByText("No earlier window to compare.")).toBeTruthy();
    expect(text()).not.toMatch(/avg/);
    expect(text()).not.toMatch(/Change:/);
  });

  it("an earlier window that billed nothing gets a dollar change and no percent", () => {
    sales({ previous: { ...base.previous!, cents: 0, invoiceCount: 0, averageCents: null } });
    render(<SalesCard variant="money" />);
    expect(screen.getByText("The 7 days before: $0 · no closed invoices")).toBeTruthy();
    expect(screen.getByText("Change: up $4,249")).toBeTruthy();
    expect(text()).not.toMatch(/%/);
  });

  it("an earlier window no sync has covered shows no figure and no change", () => {
    sales({ previous: { ...base.previous!, windowSynced: false } });
    render(<SalesCard variant="money" />);
    expect(screen.getByText("The 7 days before: the earlier window is not fully synced")).toBeTruthy();
    expect(text()).not.toMatch(/\$5,193/);
    expect(text()).not.toMatch(/Change:/);
  });

  it("an earlier window whose sync is unknown shows no figure either", () => {
    sales({ previous: { ...base.previous!, windowSynced: null } });
    render(<SalesCard variant="money" />);
    expect(text()).not.toMatch(/\$5,193/);
    expect(text()).toMatch(/sync status is unknown/);
  });

  it("Today is still open: shows yesterday's figure but no change, which would read as a slow day", () => {
    sales({
      period: "today" as never,
      window: { fromISO: "2026-10-25", toISO: "2026-10-26", label: "Today" },
      previous: { ...base.previous!, window: { fromISO: "2026-10-24", toISO: "2026-10-25", label: "Yesterday" } },
    });
    render(<SalesCard variant="money" />);
    expect(screen.getByText("Yesterday: $5,193 · 8 invoices · avg $649")).toBeTruthy();
    expect(text()).not.toMatch(/Change:|%/);
    expect(screen.getByText("Today is still open, so no change is shown.")).toBeTruthy();
  });

  it("an unreadable read renders the unknown banner and no detail block", () => {
    h.sales = { data: { available: false, reason: "Database not available" }, isLoading: false, isError: false };
    render(<SalesCard variant="money" />);
    expect(screen.getByText(/UNKNOWN, not \$0/)).toBeTruthy();
    expect(text()).not.toMatch(/closed invoice|earlier window|Change:/);
  });

  it("POSITIVE CONTROL: the Today form (no variant) carries no detail block", () => {
    sales();
    render(<SalesCard />);
    expect(screen.getByText("$4,249")).toBeTruthy();
    expect(text()).not.toMatch(/closed invoices · avg|The 7 days before|Change:/);
  });
});

/* ------------------------------- One action ------------------------------- */

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY - 3_600_000).toISOString();
const row = (over: Record<string, unknown>) => ({
  id: 1,
  externalId: "E-1",
  customerName: "Someone",
  customerPhone: "2165550100",
  vehicleInfo: null,
  serviceDescription: "Brakes",
  totalAmount: 10000,
  invoiceDate: ago(5),
  followUp7dSent: false,
  followUp30dSent: false,
  recoveryNote: null,
  paymentStatus: "pending",
  provenance: "inferred",
  ...over,
});
const ROWS = [
  // The expected pick: the best score among rows with a phone and no follow-up.
  row({ id: 1, customerName: "Pat Example", vehicleInfo: "2015 Honda Civic", totalAmount: 124000, invoiceDate: ago(10), customerPhone: "2165550111" }),
  row({ id: 2, customerName: "Sam Driver", vehicleInfo: "2012 Ford F-150", totalAmount: 45000, invoiceDate: ago(3), customerPhone: "2165550122" }),
  // Scores higher than Pat, but the 7-day text already went out: it has a follow-up.
  row({ id: 3, customerName: "Lee Higher", vehicleInfo: "2019 Toyota Camry", totalAmount: 2000000, invoiceDate: ago(9), paymentStatus: "partial", followUp7dSent: true, customerPhone: "2165550133" }),
  // Scores highest of all, but there is no phone to call.
  row({ id: 4, customerName: "Kim Nophone", vehicleInfo: "2020 Kia Soul", totalAmount: 1500000, invoiceDate: ago(7), customerPhone: null }),
];
const declined = (estimates: unknown[]) => {
  h.declined = { data: { estimates, total: estimates.length, recoverable: 0, recovered: 0, recoveryRate: 0 }, isLoading: false, isError: false, refetch: () => {} };
};

describe("One action: the next estimate to chase", () => {
  it("picks the best-scoring estimate with a phone and no follow-up, by first name and vehicle", () => {
    declined(ROWS);
    render(<NextEstimate />);
    expect(screen.getByText("Chase the next estimate: Pat, 2015 Honda Civic, $1,240, 10 days ago")).toBeTruthy();
    expect(text()).not.toMatch(/Lee|Kim|Sam/);
  });

  it("reads the same 30-day queue the Declined tab opens on", () => {
    declined(ROWS);
    render(<NextEstimate />);
    expect(h.declinedInputs[0]).toEqual({ days: 30 });
  });

  it("never prints a phone number or a call link", () => {
    declined(ROWS);
    const { container } = render(<NextEstimate />);
    expect(text()).not.toMatch(/216|555/);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.querySelector('a[href^="sms:"]')).toBeNull();
  });

  it("one 44 px link opens the Declined tab", () => {
    declined(ROWS);
    const onOpen = vi.fn();
    render(<NextEstimate onOpenDeclined={onOpen} />);
    const link = screen.getByRole("link", { name: "Open in Declined" });
    expect(link.getAttribute("href")).toBe("/admin?tab=revenue&moneyTab=declined");
    expect(link.className).toMatch(/(^|\s)min-h-\[44px\](\s|$)/);
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("every open estimate followed up: says no estimate is waiting on a call", () => {
    declined([ROWS[2]]);
    render(<NextEstimate />);
    expect(screen.getByText("No estimate waiting on a call. Every open estimate has a follow-up logged.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open in Declined" })).toBeTruthy();
  });

  it("not followed up but no phone on file: says that, not that every estimate was followed up", () => {
    declined([ROWS[3]]);
    render(<NextEstimate />);
    expect(text()).toMatch(/no phone on file/);
    expect(text()).not.toMatch(/Every open estimate has a follow-up logged/);
  });

  it("a failed read is unknown, not empty, and offers a 44 px Retry", () => {
    const refetch = vi.fn();
    h.declined = { data: undefined, isLoading: false, isError: true, refetch };
    render(<NextEstimate />);
    expect(screen.getByText("The estimate queue couldn't load: unknown, not empty.")).toBeTruthy();
    expect(text()).not.toMatch(/No estimate waiting/);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.className).toMatch(/(^|\s)min-h-\[44px\](\s|$)/);
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("a paused read (no data, no error) is unknown too, never 'no estimate'", () => {
    h.declined = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
    render(<NextEstimate />);
    expect(text()).toMatch(/unknown, not empty/);
    expect(text()).not.toMatch(/No estimate waiting/);
  });

  it("loading says it is reading", () => {
    h.declined = { data: undefined, isLoading: true, isError: false, refetch: () => {} };
    const { container } = render(<NextEstimate />);
    expect(within(container).getByText(/Reading the estimate queue/)).toBeTruthy();
  });
});
