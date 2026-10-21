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
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false },
  inputs: [] as Array<{ period: string }>,
  refetchIntervals: [] as unknown[],
  syncCalls: 0,
  syncStarted: false,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    controlCenter: {
      shopSales: {
        useQuery: (input: { period: string }, opts?: { refetchInterval?: unknown }) => {
          h.inputs.push(input);
          h.refetchIntervals.push(opts?.refetchInterval);
          return h.result;
        },
      },
    },
    shopdriver: {
      syncOnAdminLoad: {
        useMutation: (opts?: { onSuccess?: (r: { started: boolean }) => void }) => ({
          mutate: () => {
            h.syncCalls++;
            opts?.onSuccess?.({ started: h.syncStarted });
          },
        }),
      },
    },
  },
}));

import SalesCard from "../pages/admin/SalesCard";

/** A new document: a browser refresh clears the card's once-per-load marker on window. */
const newDocument = () => {
  delete (window as unknown as Record<string, unknown>).__shopSalesLoadSyncAsked;
};

const ok = {
  available: true as const,
  cents: 4213500,
  invoiceCount: 37,
  period: "last_7d" as const,
  window: { fromISO: "2026-08-31", toISO: "2026-09-07", label: "Last 7 days" },
  throughDate: "2026-09-06",
  windowAfterThrough: false,
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

beforeEach(() => {
  h.result = { data: undefined, isLoading: false, isError: false };
  h.inputs = [];
  h.refetchIntervals = [];
  h.syncCalls = 0;
  h.syncStarted = false;
  newDocument();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

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
  it("every period control meets a 44px touch target", () => {
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    const chips = within(screen.getByRole("group", { name: "Sales period" })).getAllByRole("button");
    expect(chips).toHaveLength(6);
    for (const chip of chips) expect(chip.className).toMatch(/min-h-\[44px\]/);
  });
});

/**
 * Sync on a full admin page load (Nour, 2026-10-21). The card is the Today page's first
 * mount, so it asks the server once per document load. A chip tap or an in-app return to
 * the page is NOT a load. While a started sync is landing the card re-reads on a short
 * interval so the new numbers appear without a manual refresh; it only ever shows what
 * the read returned.
 */
describe("syncs the invoice mirror once per page load, then shows what lands", () => {
  const lastInterval = () => h.refetchIntervals[h.refetchIntervals.length - 1];

  it("asks the server to sync on the first mount", () => {
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(h.syncCalls).toBe(1);
  });

  it("does not ask again on a chip tap, a re-render, or coming back to the page in the same document", () => {
    h.result = { data: ok, isLoading: false, isError: false };
    const first = render(<SalesCard />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    first.rerender(<SalesCard />);
    first.unmount();
    render(<SalesCard />);
    expect(h.syncCalls).toBe(1);
  });

  it("a browser refresh (a new document) asks again", () => {
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    cleanup();
    newDocument();
    render(<SalesCard />);
    expect(h.syncCalls).toBe(2);
  });

  it("a started sync re-reads every 15 s and says it is syncing", () => {
    h.syncStarted = true;
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(lastInterval()).toBe(15_000);
    expect(screen.getByText(/Syncing the invoice mirror/)).toBeTruthy();
  });

  it("a sync that did not start (one ran in the last 30 min) adds no polling and no syncing line", () => {
    h.syncStarted = false;
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(lastInterval()).toBe(false);
    expect(screen.queryByText(/Syncing the invoice mirror/)).toBeNull();
  });

  it("stops re-reading after 3 minutes, so a sync that never lands does not poll forever", () => {
    vi.useFakeTimers();
    h.syncStarted = true;
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(lastInterval()).toBe(15_000);
    act(() => { vi.advanceTimersByTime(3 * 60_000 + 1); });
    expect(lastInterval()).toBe(false);
    expect(screen.queryByText(/Syncing the invoice mirror/)).toBeNull();
  });

  it("while syncing, an unsynced Today still shows no figure", () => {
    h.syncStarted = true;
    h.result = {
      data: { ...ok, period: "today", cents: 0, invoiceCount: 0, throughDate: "2026-10-20", windowAfterThrough: true },
      isLoading: false, isError: false,
    };
    const { container } = render(<SalesCard />);
    expect(screen.getByText(/Not synced yet\. The invoice mirror is current through 2026-10-20\./)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
  });
});

/**
 * Today and Yesterday. The mirror runs a day behind, so a day newer than its through-date has
 * no invoices YET. That is not "$0 of sales": it is "not synced", and the card must say so
 * without printing any figure, while a synced day with no invoices is still a real $0.
 */
describe("Today and Yesterday period chips", () => {
  const chipNames = () =>
    within(screen.getByRole("group", { name: "Sales period" })).getAllByRole("button").map((b) => b.textContent);

  const day = (over: Record<string, unknown>) => ({ ...ok, ...over });
  const notSynced = /Not synced yet\. The invoice mirror is current through 2026-10-20\./;

  it("offers Today, Yesterday, 7 days, 30 days, This month, Last month in that order", () => {
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(chipNames()).toEqual(["Today", "Yesterday", "7 days", "30 days", "This month", "Last month"]);
  });

  it("still opens on 7 days, and asks the server for it", () => {
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(screen.getByRole("button", { name: "7 days" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("false");
    expect(h.inputs[0]).toEqual({ period: "last_7d" });
  });

  it("tapping Today and Yesterday asks the server for those periods", () => {
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(h.inputs[h.inputs.length - 1]).toEqual({ period: "today" });
    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(h.inputs[h.inputs.length - 1]).toEqual({ period: "yesterday" });
  });

  it("today, mirror through yesterday: says not synced, names the through-date, prints no dollar figure", () => {
    h.result = {
      data: day({
        period: "today", window: { fromISO: "2026-10-21", toISO: "2026-10-22", label: "Today" },
        cents: 0, invoiceCount: 0, throughDate: "2026-10-20", windowAfterThrough: true,
      }),
      isLoading: false, isError: false,
    };
    const { container } = render(<SalesCard />);
    expect(screen.getByText(notSynced)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toMatch(/\d+ invoices?/);
    expect(screen.queryByRole("button", { name: /What this excludes/i })).toBeNull();
  });

  it("does not trust a number the server sent for an unsynced day", () => {
    h.result = {
      data: day({
        period: "today", window: { fromISO: "2026-10-21", toISO: "2026-10-22", label: "Today" },
        cents: 987600, invoiceCount: 9, throughDate: "2026-10-20", windowAfterThrough: true,
      }),
      isLoading: false, isError: false,
    };
    const { container } = render(<SalesCard />);
    expect(screen.getByText(notSynced)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toContain("9,876");
  });

  it("yesterday with the mirror two days behind is also not synced", () => {
    h.result = {
      data: day({
        period: "yesterday", window: { fromISO: "2026-10-20", toISO: "2026-10-21", label: "Yesterday" },
        cents: 0, invoiceCount: 0, throughDate: "2026-10-19", windowAfterThrough: true,
      }),
      isLoading: false, isError: false,
    };
    const { container } = render(<SalesCard />);
    expect(screen.getByText(/Not synced yet\. The invoice mirror is current through 2026-10-19\./)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
  });

  it("an empty mirror says the through-date is unknown instead of naming one", () => {
    h.result = {
      data: day({ period: "today", cents: 0, invoiceCount: 0, throughDate: null, windowAfterThrough: true }),
      isLoading: false, isError: false,
    };
    const { container } = render(<SalesCard />);
    expect(screen.getByText(/Not synced yet\. The invoice mirror has no through-date\./)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
  });

  it("today, mirror through today: shows the figure and the count", () => {
    h.result = {
      data: day({
        period: "today", window: { fromISO: "2026-10-21", toISO: "2026-10-22", label: "Today" },
        cents: 123400, invoiceCount: 5, throughDate: "2026-10-21", windowAfterThrough: false,
      }),
      isLoading: false, isError: false,
    };
    render(<SalesCard />);
    expect(screen.getByText("$1,234")).toBeTruthy();
    expect(screen.getByText(/5 invoices · Today/)).toBeTruthy();
    expect(screen.queryByText(/Not synced yet/)).toBeNull();
  });

  it("a synced day with no invoices is a real $0, not 'not synced'", () => {
    h.result = {
      data: day({
        period: "yesterday", window: { fromISO: "2026-10-20", toISO: "2026-10-21", label: "Yesterday" },
        cents: 0, invoiceCount: 0, throughDate: "2026-10-20", windowAfterThrough: false,
      }),
      isLoading: false, isError: false,
    };
    render(<SalesCard />);
    expect(screen.getByText("$0")).toBeTruthy();
    expect(screen.getByText(/0 invoices · Yesterday/)).toBeTruthy();
    expect(screen.queryByText(/Not synced yet/)).toBeNull();
  });

  it("a multi-day period keeps its figure when the mirror lags, with only the existing through-date line", () => {
    h.result = {
      data: day({ period: "month_to_date", throughDate: "2026-10-20", windowAfterThrough: true }),
      isLoading: false, isError: false,
    };
    render(<SalesCard />);
    expect(screen.getByText("$42,135")).toBeTruthy();
    expect(screen.getByText(/mirror current through 2026-10-20/)).toBeTruthy();
    expect(screen.queryByText(/Not synced yet/)).toBeNull();
  });

  it("a failed read on Today is still UNKNOWN, not 'not synced' and not $0", () => {
    h.result = { data: { available: false, reason: "Database not available" }, isLoading: false, isError: false };
    const { container } = render(<SalesCard />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText(/UNKNOWN, not \$0/i)).toBeTruthy();
    expect(screen.queryByText(/Not synced yet/)).toBeNull();
    expect(screen.queryByText(/^\$[\d,]+$/)).toBeNull();
  });
});
