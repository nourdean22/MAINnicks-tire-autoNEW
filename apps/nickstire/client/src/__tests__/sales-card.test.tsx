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
  sync: { state: "ok" as const, lastAt: "2026-09-07T00:00:00.000Z", etDate: "2026-09-06", etTime: "8:00 PM" },
  windowSynced: true as boolean | null,
  syncInFlight: false,
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
 * The sync is started by the admin shell on a page load (sync-on-admin-load.test.tsx). The card
 * only FOLLOWS it: while the read says a probe is running (`syncInFlight`) it re-reads on a short
 * interval so the new numbers appear without a manual refresh, for at most 3 minutes. It does not
 * depend on its own call having started one, so it also follows a probe started by the shell, the
 * OAuth callback, chat or a second tab. It only ever shows what the read returned.
 */
describe("follows a running sync, then shows what lands", () => {
  /** What the card's refetchInterval says for the latest read (react-query asks it after each read). */
  const intervalFor = (data: unknown) => {
    const fn = h.refetchIntervals[h.refetchIntervals.length - 1] as (q: { state: { data: unknown } }) => unknown;
    return fn({ state: { data } });
  };

  it("re-reads every 15 s while the read says a probe is running, and says it is syncing", () => {
    const running = { ...ok, syncInFlight: true };
    h.result = { data: running, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(intervalFor(running)).toBe(15_000);
    expect(screen.getByText(/Syncing the invoice mirror/)).toBeTruthy();
  });

  it("does not poll, and says nothing, when no probe is running", () => {
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(intervalFor(ok)).toBe(false);
    expect(screen.queryByText(/Syncing the invoice mirror/)).toBeNull();
  });

  it("does not poll on a failed read or before the first read", () => {
    h.result = { data: undefined, isLoading: true, isError: false };
    render(<SalesCard />);
    expect(intervalFor(undefined)).toBe(false);
    expect(intervalFor({ available: false, reason: "down" })).toBe(false);
  });

  it("stops re-reading after 3 minutes, so a probe that never ends does not poll forever", () => {
    vi.useFakeTimers();
    const running = { ...ok, syncInFlight: true };
    h.result = { data: running, isLoading: false, isError: false };
    render(<SalesCard />);
    expect(intervalFor(running)).toBe(15_000);
    act(() => { vi.advanceTimersByTime(3 * 60_000 + 1); });
    expect(intervalFor(running)).toBe(false);
    expect(screen.queryByText(/Syncing the invoice mirror/)).toBeNull();
  });

  it("the cap resets once the probe ends, so the next one is followed again", () => {
    vi.useFakeTimers();
    const running = { ...ok, syncInFlight: true };
    h.result = { data: running, isLoading: false, isError: false };
    const view = render(<SalesCard />);
    act(() => { vi.advanceTimersByTime(3 * 60_000 + 1); });
    h.result = { data: ok, isLoading: false, isError: false }; // it ended
    view.rerender(<SalesCard />);
    h.result = { data: running, isLoading: false, isError: false }; // another one started
    view.rerender(<SalesCard />);
    expect(intervalFor(running)).toBe(15_000);
  });

  it("the card itself no longer asks the server to sync", () => {
    h.result = { data: ok, isLoading: false, isError: false };
    render(<SalesCard />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(h.syncCalls).toBe(0);
  });

  it("while a probe runs, an unsynced Today still shows no figure", () => {
    h.result = {
      data: { ...ok, period: "today", cents: 0, invoiceCount: 0, windowSynced: false, sync: lastNight, syncInFlight: true },
      isLoading: false, isError: false,
    };
    const { container } = render(<SalesCard />);
    expect(screen.getByText(/Not synced yet today\./)).toBeTruthy();
    expect(screen.getByText(/Syncing the invoice mirror/)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
  });
});

const lastNight = { state: "ok" as const, lastAt: "2026-10-21T00:00:00.000Z", etDate: "2026-10-20", etTime: "8:00 PM" };
const thisMorning = { state: "ok" as const, lastAt: "2026-10-21T15:42:00.000Z", etDate: "2026-10-21", etTime: "11:42 AM" };

/**
 * Today and Yesterday. Whether a day has been synced is decided from the ShopDriver sync log
 * (the newest successful probe), NOT from the newest invoice: a manual invoice written today
 * says nothing about whether ShopDriver's rows for today have arrived, and a zero-sale day
 * leaves the newest invoice where it was. An unsynced day shows no figure; a synced day with no
 * invoices is a real $0; an unreadable sync log is unknown, never synced.
 */
describe("Today and Yesterday period chips", () => {
  const chipNames = () =>
    within(screen.getByRole("group", { name: "Sales period" })).getAllByRole("button").map((b) => b.textContent);

  const day = (over: Record<string, unknown>) => ({ ...ok, ...over });
  const today = { period: "today", window: { fromISO: "2026-10-21", toISO: "2026-10-22", label: "Today" } };
  const yesterday = { period: "yesterday", window: { fromISO: "2026-10-20", toISO: "2026-10-21", label: "Yesterday" } };
  const show = (data: unknown) => { h.result = { data, isLoading: false, isError: false }; };

  it("offers Today, Yesterday, 7 days, 30 days, This month, Last month in that order", () => {
    show(ok);
    render(<SalesCard />);
    expect(chipNames()).toEqual(["Today", "Yesterday", "7 days", "30 days", "This month", "Last month"]);
  });

  it("still opens on 7 days, and asks the server for it", () => {
    show(ok);
    render(<SalesCard />);
    expect(screen.getByRole("button", { name: "7 days" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("false");
    expect(h.inputs[0]).toEqual({ period: "last_7d" });
  });

  it("tapping Today and Yesterday asks the server for those periods", () => {
    show(ok);
    render(<SalesCard />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(h.inputs[h.inputs.length - 1]).toEqual({ period: "today" });
    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(h.inputs[h.inputs.length - 1]).toEqual({ period: "yesterday" });
  });

  it("today, no ShopDriver sync yet today: says so, names the last sync, prints no figure", () => {
    show(day({ ...today, cents: 0, invoiceCount: 0, windowSynced: false, sync: lastNight }));
    const { container } = render(<SalesCard />);
    expect(screen.getByText(/Not synced yet today\. Last ShopDriver sync: 2026-10-20 8:00 PM ET\./)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toMatch(/\d+ invoices?/);
    expect(screen.queryByRole("button", { name: /What this excludes/i })).toBeNull();
  });

  it("a manual invoice written today does not make today synced: the server's flag decides, not the invoice", () => {
    // throughDate is today and the read holds a $250 invoice, but no ShopDriver probe ran today.
    show(day({ ...today, cents: 25000, invoiceCount: 1, throughDate: "2026-10-21", windowSynced: false, sync: lastNight }));
    const { container } = render(<SalesCard />);
    expect(screen.getByText(/Not synced yet today\./)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toContain("250");
  });

  it("does not trust a number the server sent for an unsynced day", () => {
    show(day({ ...today, cents: 987600, invoiceCount: 9, windowSynced: false, sync: lastNight }));
    const { container } = render(<SalesCard />);
    expect(screen.getByText(/Not synced yet today\./)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toContain("9,876");
  });

  it("yesterday not yet covered by a sync that ran after it ended is also not synced", () => {
    show(day({ ...yesterday, cents: 0, invoiceCount: 0, windowSynced: false, sync: lastNight }));
    const { container } = render(<SalesCard />);
    expect(screen.getByText(/Not synced yet for yesterday\. Last ShopDriver sync: 2026-10-20 8:00 PM ET\./)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
  });

  it("no successful sync on record says that, and prints no figure", () => {
    show(day({ ...today, cents: 0, invoiceCount: 0, windowSynced: false, sync: { state: "never" } }));
    const { container } = render(<SalesCard />);
    expect(screen.getByText(/Not synced yet today\. No ShopDriver sync on record\./)).toBeTruthy();
    expect(container.textContent).not.toContain("$");
  });

  it("an unreadable sync log is UNKNOWN: no figure, and it does not say 'not synced' or 'synced'", () => {
    for (const d of [today, yesterday]) {
      show(day({ ...d, cents: 0, invoiceCount: 0, windowSynced: null, sync: { state: "unreadable", reason: "db down" } }));
      const { container } = render(<SalesCard />);
      expect(screen.getByText(/Sync status unknown/)).toBeTruthy();
      expect(container.textContent).not.toContain("$");
      expect(screen.queryByText(/Not synced yet/)).toBeNull();
      expect(container.textContent).not.toMatch(/so far today|current as of/);
      cleanup();
    }
  });

  it("a zero-sale day with a sync today shows a real $0, labelled with the sync time", () => {
    show(day({ ...today, cents: 0, invoiceCount: 0, windowSynced: true, sync: thisMorning }));
    render(<SalesCard />);
    expect(screen.getByText("$0")).toBeTruthy();
    expect(screen.getByText(/0 invoices · Today/)).toBeTruthy();
    expect(screen.getByText(/so far today, as of 11:42 AM ET/)).toBeTruthy();
    expect(screen.queryByText(/Not synced yet/)).toBeNull();
  });

  it("today, synced: shows the figure and the count with the sync time", () => {
    show(day({ ...today, cents: 123400, invoiceCount: 5, windowSynced: true, sync: thisMorning }));
    render(<SalesCard />);
    expect(screen.getByText("$1,234")).toBeTruthy();
    expect(screen.getByText(/5 invoices · Today/)).toBeTruthy();
    expect(screen.getByText(/so far today, as of 11:42 AM ET/)).toBeTruthy();
  });

  it("yesterday, synced after it ended: a real $0 is shown as current as of that sync", () => {
    show(day({ ...yesterday, cents: 0, invoiceCount: 0, windowSynced: true, sync: thisMorning }));
    render(<SalesCard />);
    expect(screen.getByText("$0")).toBeTruthy();
    expect(screen.getByText(/0 invoices · Yesterday/)).toBeTruthy();
    expect(screen.getByText(/current as of 2026-10-21 11:42 AM ET/)).toBeTruthy();
    expect(screen.queryByText(/so far today/)).toBeNull();
  });

  it("a multi-day period keeps its figure and says when it was current", () => {
    show(day({ period: "month_to_date", windowSynced: false, sync: lastNight, throughDate: "2026-10-20" }));
    render(<SalesCard />);
    expect(screen.getByText("$42,135")).toBeTruthy();
    expect(screen.getByText(/mirror current through 2026-10-20/)).toBeTruthy();
    expect(screen.getByText(/current as of 2026-10-20 8:00 PM ET/)).toBeTruthy();
    expect(screen.queryByText(/Not synced yet/)).toBeNull();
  });

  it("a multi-day period with an unreadable or empty sync log keeps its figure and says the sync time is not known", () => {
    show(day({ windowSynced: null, sync: { state: "unreadable", reason: "db down" } }));
    const first = render(<SalesCard />);
    expect(screen.getByText("$42,135")).toBeTruthy();
    expect(screen.getByText(/sync time unknown/)).toBeTruthy();
    first.unmount();
    show(day({ windowSynced: false, sync: { state: "never" } }));
    render(<SalesCard />);
    expect(screen.getByText(/no ShopDriver sync on record/)).toBeTruthy();
  });

  it("a failed read on Today is still UNKNOWN, not 'not synced' and not $0", () => {
    h.result = { data: { available: false, reason: "Database not available" }, isLoading: false, isError: false };
    const { container } = render(<SalesCard />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText(/UNKNOWN, not \$0/i)).toBeTruthy();
    expect(screen.queryByText(/Not synced yet/)).toBeNull();
    expect(screen.queryByText(/^\$[\d,]+$/)).toBeNull();
    expect(container.textContent).not.toMatch(/Sync status unknown/);
  });
});
