/**
 * Admin > Tires "Compare suppliers" panel (doc 26 section 2). It shows dealer cost, so it renders for owner and
 * manager only. Ranking runs in the browser against a ticking clock, so a lookup that ages past the shelf limit
 * stops ranking as on the shelf without a re-fetch. A failed lookup, an empty one and a refused size are three
 * different screens, never "no offers".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { UNKNOWN, type SupplierOffer } from "@shared/sourcing";

type Lookup = {
  data?: unknown;
  isError?: boolean;
  error?: { message: string } | null;
  isFetching?: boolean;
};

const h = vi.hoisted(() => ({
  role: "owner" as string | undefined,
  lookup: {} as Lookup,
  calls: [] as { input: unknown; opts: { enabled?: boolean } }[],
  refetch: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminSecurity: {
      status: { useQuery: () => ({ data: h.role ? { adminRole: h.role, permissions: [] } : undefined, isError: false }) },
    },
    sourcing: {
      compareTires: {
        useQuery: (input: unknown, opts: { enabled?: boolean }) => {
          h.calls.push({ input, opts });
          return { data: undefined, isError: false, error: null, isFetching: false, ...h.lookup, refetch: h.refetch };
        },
      },
    },
  },
}));

import SupplierComparePanel from "@/components/admin/SupplierComparePanel";

function offer(sku: string, price: number, local: number, regional?: number, verifiedAt = new Date().toISOString()): SupplierOffer {
  return {
    supplierId: "gateway_dk",
    supplierName: "Gateway Tire (D&K)",
    sku,
    description: `NEXEN ${sku} 225/65R17`,
    priceStatus: "priced",
    unitPrice: price,
    fet: 0,
    core: "not_applicable",
    priceSource: "supplier_live",
    fitConfidence: "confirmed",
    fitConditions: [],
    lastVerifiedAt: verifiedAt,
    locations: [
      { branchCode: "local", branchName: "Seville, OH", kind: "warehouse", qty: local, qtySource: "supplier_live", orderable: "yes",
        arrival: { tier: "shelf", at: UNKNOWN, orderBy: UNKNOWN }, fulfillmentMode: "route" },
      ...(regional === undefined ? [] : [
        { branchCode: "regional", branchName: "D&K regional", kind: "network" as const, qty: regional, qtySource: "supplier_live" as const,
          orderable: UNKNOWN, arrival: { tier: "transfer" as const, at: UNKNOWN, orderBy: UNKNOWN }, fulfillmentMode: "transfer" as const },
      ]),
    ],
  };
}

function live(offers: SupplierOffer[], lookedUpAt = new Date().toISOString()) {
  return {
    data: {
      size: "225/65R17",
      lookedUpAt,
      suppliers: [{ id: "gateway_dk", name: "Gateway Tire (D&K)", status: "live", reason: null, portalUrl: "https://b2b.dktire.com/dashboard?search=225%2F65R17" }],
      notConnected: ["ATD", "Capital Tire"],
      offers,
    },
  };
}

const THREE = () => [offer("CHEAP", 70, 2, 14), offer("MID", 88.5, 6), offer("PRICEY", 120, 9)];

function show() {
  render(React.createElement(SupplierComparePanel));
}
function search(size = "225/65R17") {
  fireEvent.change(screen.getByLabelText("Tire size"), { target: { value: size } });
  fireEvent.click(screen.getByRole("button", { name: "Check stock" }));
}
const card = (name: RegExp) => screen.getByRole("region", { name });

afterEach(() => {
  h.role = "owner";
  h.lookup = {};
  h.calls = [];
  h.refetch.mockClear();
  try { localStorage.clear(); } catch { /* jsdom always has it */ }
  vi.useRealTimers();
});

describe("SupplierComparePanel", () => {
  it("shows dealer cost, so front desk and tech never see it", () => {
    h.role = "front_desk";
    show();
    expect(screen.queryByText("Compare suppliers")).toBeNull();
  });

  it("asks the supplier nothing until a size is entered", () => {
    show();
    expect(screen.getByText("Compare suppliers")).toBeTruthy();
    expect(h.calls.every((c) => c.opts.enabled === false)).toBe(true);
    search("2256517");
    expect(h.calls.at(-1)).toMatchObject({ input: { size: "2256517" }, opts: { enabled: true } });
  });

  it("qty 4: the quickest is the shelf offer with enough, the best price is the cheaper regional stock", () => {
    h.lookup = live(THREE());
    show();
    search();
    expect(within(card(/^Quickest$/)).getByText(/· MID$/)).toBeTruthy();
    expect(within(card(/^Best price$/)).getByText(/· CHEAP$/)).toBeTruthy();
    expect(within(card(/^Best price$/)).getAllByText(/call to confirm/i)[0]).toBeTruthy();
  });

  it("names a speed tie as the same run window", () => {
    h.lookup = live(THREE());
    show();
    search();
    expect(within(card(/^Quickest$/)).getByText(/Same run window/i).textContent).toMatch(/PRICEY/);
  });

  it("one pick card when the same offer is quickest and cheapest", () => {
    h.lookup = live(THREE());
    show();
    search();
    fireEvent.click(screen.getByRole("button", { name: "Fewer tires" }));
    fireEvent.click(screen.getByRole("button", { name: "Fewer tires" }));
    fireEvent.click(screen.getByRole("button", { name: "Fewer tires" }));
    expect(screen.getByText("1", { selector: "output" })).toBeTruthy();
    expect(within(card(/^Quickest and best price$/)).getByText(/· CHEAP$/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: /^Quickest$/ })).toBeNull();
  });

  it("two rows with one part number are still two picks, so the cheaper one is not hidden", () => {
    const stale = new Date(Date.now() - 20 * 60_000).toISOString();
    h.lookup = live([offer("DUP", 100, 6), offer("DUP", 70, 6, undefined, stale)]);
    show();
    search();
    expect(screen.queryByRole("region", { name: /^Quickest and best price$/ })).toBeNull();
    expect(within(card(/^Best price$/)).getByText(/\$70\.00 each/)).toBeTruthy();
  });

  it("says when stock was checked, and shows a cost for each pick", () => {
    h.lookup = live(THREE(), "2026-11-06T20:05:00.000Z");
    show();
    search();
    expect(screen.getByText(/Checked .*3:05 PM/)).toBeTruthy();
    expect(within(card(/^Quickest$/)).getByText(/^Usually here .* \(run schedule, not live\)$/)).toBeTruthy();
    expect(within(card(/^Best price$/)).getByText(/\$70\.00 each/)).toBeTruthy();
    expect(within(card(/^Best price$/)).getByText(/\$280\.00 for 4/)).toBeTruthy();
  });

  it("hide cost removes every dollar figure and is remembered", () => {
    h.lookup = live(THREE());
    show();
    search();
    const toggle = screen.getByRole("button", { name: "Hide cost" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide cost" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/\$\d/)).toBeNull();
    expect(localStorage.getItem("nickstire.supplierCompare.hideCost")).toBe("1");
  });

  it("a lookup older than the shelf limit stops ranking as quickest, on screen, without a re-fetch", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-06T20:00:00.000Z"));
    h.lookup = live(THREE(), "2026-11-06T20:00:00.000Z");
    show();
    search();
    expect(screen.getByRole("region", { name: /^Quickest$/ })).toBeTruthy();
    act(() => {
      vi.setSystemTime(new Date("2026-11-06T20:15:30.000Z"));
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByRole("region", { name: /^Quickest/ })).toBeNull();
    expect(screen.getAllByText(/Stock checked 16 min ago - call to confirm/).length).toBeGreaterThan(0);
    expect(h.refetch).not.toHaveBeenCalled();
  });

  it("Re-check asks Gateway again", () => {
    h.lookup = live(THREE());
    show();
    search();
    fireEvent.click(screen.getByRole("button", { name: "Re-check" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("a Gateway that did not answer says so, with the portal link, not 'no tires'", () => {
    h.lookup = {
      data: { ...live([]).data, suppliers: [{ id: "gateway_dk", name: "Gateway Tire (D&K)", status: "unavailable", reason: "Auth /token returned HTTP 500", portalUrl: "https://b2b.dktire.com/dashboard?search=225%2F65R17" }] },
    };
    show();
    search();
    expect(screen.getByText(/Gateway did not answer/)).toBeTruthy();
    expect(screen.getByText(/Auth \/token returned HTTP 500/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Gateway portal/ }).getAttribute("href")).toContain("b2b.dktire.com");
    expect(screen.queryByText(/returned no tires/)).toBeNull();
  });

  it("an empty answer says Gateway returned no tires for that size", () => {
    h.lookup = { data: { ...live([]).data, suppliers: [{ ...live([]).data.suppliers[0], status: "no_results" }] } };
    show();
    search();
    expect(screen.getByText(/Gateway returned no tires for 225\/65R17/)).toBeTruthy();
  });

  it("a refused size shows the server's reason", () => {
    h.lookup = { isError: true, error: { message: "Enter a size like 225/65R17. LT sizes are not supported yet." } };
    show();
    search("LT265/70R17");
    expect(screen.getByRole("alert").textContent).toMatch(/LT sizes are not supported yet/);
  });

  it("names the suppliers it did not check", () => {
    h.lookup = live(THREE());
    show();
    search();
    expect(screen.getByText(/Not checked: ATD, Capital Tire/)).toBeTruthy();
  });

  it("uses no native dialog and 48px controls", () => {
    const spies = [vi.spyOn(window, "alert"), vi.spyOn(window, "confirm"), vi.spyOn(window, "prompt")];
    try {
      h.lookup = live(THREE());
      show();
      search();
      for (const name of ["Fewer tires", "More tires", "Hide cost", "Re-check", "Check stock"]) {
        const b = screen.getByRole("button", { name });
        expect(b.className, name).toMatch(/min-h-12/);
        fireEvent.click(b);
      }
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
