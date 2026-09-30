/**
 * Q-23 phase 3 · the obligation-debt tile on "Today, for real".
 *
 * The promise ledger exists so an obligation cannot be forgotten. The tile must
 * therefore keep apart the three states a silent card would merge:
 *   - could not read the ledger → UNMEASURED, and the words say "not zero";
 *   - read, nothing open        → "0 promises owed", MEASURED, stated;
 *   - read, some past due       → MEASURED counts, loud, "not marked kept".
 * A payload without the field (a server that predates the tile) draws no tile.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    controlCenter: {
      todayPulse: { useQuery: () => ({ data: h.data, isLoading: false }) },
    },
  },
}));

import { TodaysRealNumbers } from "../pages/admin/today/TodaysRealNumbers";
import { promiseDebtView } from "../pages/admin/today/todayPulse";

afterEach(cleanup);

function pulse(obligations: unknown) {
  return {
    available: true,
    declinedWork: { openCount: 0, openCents: 0, last30: 0 },
    calls: { last24h: 40, reachedTool24h: 9, abandoned24h: 0, lastCallAt: new Date() },
    revenue: { invoices7d: 3, revenue7dCents: 120_000, throughDate: new Date() },
    ...(obligations === undefined ? {} : { obligations }),
  };
}

function tile(container: HTMLElement) {
  return container.querySelector('[data-tile="promises-owed"]');
}

describe("TodaysRealNumbers · promises owed", () => {
  it("an unreadable ledger reads UNMEASURED and says it is not zero", () => {
    h.data = pulse({ available: false, reason: "read failed" });
    const { container } = render(<TodaysRealNumbers />);
    const t = tile(container);
    expect(t).not.toBeNull();
    expect(t?.querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe("UNMEASURED");
    expect(t?.textContent).toMatch(/could not be read/);
    expect(t?.textContent).toMatch(/Unknown, not zero/);
    expect(t?.textContent).not.toMatch(/\b0 promises/);
  });

  it("an empty ledger states a measured zero", () => {
    h.data = pulse({ available: true, open: 0, overdue: 0, overdue4h: 0 });
    const { container } = render(<TodaysRealNumbers />);
    const t = tile(container);
    expect(t?.textContent).toMatch(/0 promises owed/);
    expect(t?.querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe("MEASURED");
  });

  it("past-due promises are counted and loud", () => {
    h.data = pulse({ available: true, open: 5, overdue: 3, overdue4h: 2 });
    const { container } = render(<TodaysRealNumbers />);
    const t = tile(container);
    expect(t?.textContent).toMatch(/5 promises owed/);
    expect(t?.textContent).toMatch(/3 past due, not marked kept · 2 by 4h or more/);
    // The count itself is amber, not only the icon beside it.
    expect(t?.querySelector("div.text-sm.text-amber-400")?.textContent).toMatch(/5 promises owed/);
  });

  it("a payload without the field draws no tile, and the rest of the card still renders", () => {
    h.data = pulse(undefined);
    const { container } = render(<TodaysRealNumbers />);
    expect(tile(container)).toBeNull();
    expect(container.textContent).toMatch(/calls · 24h/);
  });
});

describe("promiseDebtView", () => {
  it("open with none past due is quiet", () => {
    expect(promiseDebtView({ available: true, open: 1, overdue: 0, overdue4h: 0 })).toEqual({
      provenance: "MEASURED",
      headline: "1 promise owed",
      detail: "none past due",
      loud: false,
    });
  });

  it("past due but under 4h leaves the 4h clause out", () => {
    expect(promiseDebtView({ available: true, open: 2, overdue: 1, overdue4h: 0 })?.detail).toBe(
      "1 past due, not marked kept",
    );
  });
});
