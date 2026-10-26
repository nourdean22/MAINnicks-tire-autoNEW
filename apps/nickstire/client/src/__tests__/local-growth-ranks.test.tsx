/**
 * local-growth-ranks.test.tsx · 2026-10-25 (job 2026-10-25-admin-tabs-localgrowth)
 *
 * Website & Local > Local Growth shows, per tracked keyword, the 28-day Search Console
 * position from the shop's own rows (localGrowth.targetKeywordRanks v1) with one action.
 * A keyword with no recorded impression has no position (never 0.0), a stale sync says so,
 * and a failed or unconfigured read renders no number at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean };

const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
}));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isFetching: false,
    ...h.queries.get(path),
  });
  const mutation = () => () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isSuccess: false, reset: () => {} });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return mutation();
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() {
        return undefined;
      },
    });
  const root = new Proxy({}, {
    get(_t, key) {
      if (key === "useUtils" || key === "useContext") return () => node("utils");
      return node(String(key));
    },
  });
  return { trpc: root };
});

import { LocalGrowthTab } from "@/pages/admin/GrowthSection";

const RANKS = "localGrowth.targetKeywordRanks";
const w = (impressions: number, clicks: number, position: number) => ({ impressions, clicks, position });

function okPayload() {
  return {
    ok: true,
    latestDate: "2026-10-23",
    staleDays: 2,
    window: { current: { from: "2026-09-26", to: "2026-10-23" }, previous: { from: "2026-08-29", to: "2026-09-25" } },
    totals: { impressions28d: 57361, distinctQueries28d: 5897 },
    keywords: [
      { keyword: "used tires cleveland", group: "tires", current: w(135, 0, 6.5), previous: w(90, 1, 9.1), seenIn90Days: true, change: 2.6, action: "review_snippet" },
      { keyword: "oil change cleveland", group: "oil", current: w(37, 0, 23.9), previous: w(40, 0, 20.5), seenIn90Days: true, change: -3.4, action: "compare_top_results" },
      { keyword: "ohio e-check repair", group: "emissions", current: null, previous: null, seenIn90Days: false, change: null, action: "verify_local" },
      { keyword: "tires euclid ave", group: "tires", current: w(12, 0, 4.0), previous: null, seenIn90Days: true, change: null, action: "new" },
      { keyword: "tire shop cleveland", group: "tires", current: w(110, 0, 8.9), previous: w(100, 0, 9.3), seenIn90Days: true, change: 0.4, action: "monitor" },
    ],
  };
}

function stalePayload() {
  const p = okPayload();
  return { ...p, staleDays: 10, keywords: p.keywords.map((k) => ({ ...k, action: "check_sync" })) };
}

const row = (keyword: string) => screen.getByText(keyword).closest("[data-keyword-row]") as HTMLElement;
const follows = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  h.queries.clear();
  window.history.replaceState({}, "", "/admin?tab=content&contentTab=local");
});
afterEach(() => {
  h.queries.clear();
  vi.restoreAllMocks();
});

describe("Local Growth: Search position per tracked keyword", () => {
  it("replaces the manual rank tracker with a read-only Search Console panel and its window header", () => {
    h.queries.set(RANKS, { data: okPayload() });
    const { container } = render(<LocalGrowthTab />);
    expect(screen.getByText("Search position (Google Search Console)")).toBeTruthy();
    expect(
      screen.getByText("28 days ending Oct 23 · versus the 28 before · site average across pages, impression-weighted"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Recorded impressions only: Google hides most query impressions, so a blank keyword is unmeasured, not unranked. Recorded this window (partial): 57,361 impressions across 5,897 queries.",
      ),
    ).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/rank tracker/i);
    expect(text).not.toMatch(/no measured ranks yet/i);
    expect(text).not.toMatch(/env-aliasing/i);
    expect(text).not.toMatch(/behind: check the gsc-pipeline cron/);
    expect(text).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
    expect(text).not.toMatch(/!/);
  });

  it("groups in the fixed order and sorts each group by recorded impressions, absent last", () => {
    h.queries.set(RANKS, { data: okPayload() });
    render(<LocalGrowthTab />);
    const tires = screen.getByText("Tires");
    const oil = screen.getByText("Oil change");
    const emissions = screen.getByText("Emissions");
    // tires, brakes, auto-repair, local-euclid, diagnostics, emissions, oil, suspension
    expect(follows(tires, emissions)).toBe(true);
    expect(follows(emissions, oil)).toBe(true);
    expect(screen.queryByText("Brakes")).toBeNull(); // no row in that group, no empty header
    expect(follows(row("used tires cleveland"), row("tire shop cleveland"))).toBe(true);
    expect(follows(row("tire shop cleveland"), row("tires euclid ave"))).toBe(true);
  });

  it("a row shows position, change in words with colour, impressions and clicks, and one action", () => {
    h.queries.set(RANKS, { data: okPayload() });
    render(<LocalGrowthTab />);

    const used = row("used tires cleveland");
    expect(used.textContent).toContain("Avg position 6.5");
    const improved = screen.getByText("Improved 2.6 positions");
    expect(used.contains(improved)).toBe(true);
    expect(improved.className).toMatch(/emerald/);
    expect(used.textContent).toContain("135 impressions · 0 clicks");
    expect(used.textContent).toContain("Review the search snippet");

    const oil = row("oil change cleveland");
    expect(oil.textContent).toContain("Avg position 23.9");
    const dropped = screen.getByText("Dropped 3.4 positions");
    expect(oil.contains(dropped)).toBe(true);
    expect(dropped.className).toMatch(/red/);
    expect(oil.textContent).toContain("Compare the page with the top results");

    const shop = row("tire shop cleveland");
    expect(shop.textContent).toContain("Steady");
    expect(shop.textContent).toContain("Monitor");
    expect(shop.textContent).not.toMatch(/Improved|Dropped/);

    const fresh = row("tires euclid ave");
    expect(fresh.textContent).toContain("Avg position 4.0");
    expect(fresh.textContent).toContain("Newly observed");
    expect(fresh.textContent).not.toMatch(/Improved|Dropped|Steady/);
  });

  it("a keyword with no recorded impressions has no position: never 0.0, never a click count", () => {
    h.queries.set(RANKS, { data: okPayload() });
    render(<LocalGrowthTab />);
    const absent = row("ohio e-check repair");
    expect(absent.textContent).toContain("no position");
    expect(absent.textContent).toContain("No recorded impressions in 28 days");
    expect(absent.textContent).toContain("Verify with a local rank check");
    expect(absent.textContent).not.toMatch(/\d+\.\d|\b0\b|\b100\b/);
    expect(absent.textContent).not.toMatch(/Avg position|clicks|Steady|Improved|Dropped/);
  });

  it("a stale sync says how far behind above the list, and every row says check the sync", () => {
    h.queries.set(RANKS, { data: stalePayload() });
    render(<LocalGrowthTab />);
    const banner = screen.getByText("Search Console sync is 10 days behind: check the gsc-pipeline cron");
    expect(banner.className).toMatch(/amber/);
    expect(follows(banner, row("used tires cleveland"))).toBe(true);
    expect(screen.getAllByText("Check the Search Console sync")).toHaveLength(5);
  });
});

describe("Local Growth: Search position honest non-ok states", () => {
  const NUMBERS = /Avg position|impressions ·|\d+ impressions|Improved|Dropped|Steady/;

  it("loading", () => {
    h.queries.set(RANKS, { isLoading: true });
    render(<LocalGrowthTab />);
    expect(screen.getByText("Reading Search Console rows...")).toBeTruthy();
  });

  it("query failed: unknown, not zero, and retry calls refetch", () => {
    const refetch = vi.fn();
    h.queries.set(RANKS, { isError: true, error: new Error("boom"), refetch });
    const { container } = render(<LocalGrowthTab />);
    const msg = screen.getByText("Search positions couldn't load: unknown, not zero.");
    const retry = (msg.parentElement as HTMLElement).querySelector("button") as HTMLButtonElement;
    expect(retry.className).toMatch(/min-h-12/);
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(NUMBERS);
  });

  it.each([
    ["unconfigured", "Search Console is not connected and no rows are stored.",
      "Search Console credentials are not set on the server; positions are UNMEASURED. Add GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY in Railway."],
    ["unmeasured", "No Search Console rows stored yet: the daily gsc-pipeline sync has not written any.",
      "No Search Console rows are stored yet; positions are UNMEASURED, not zero."],
    ["error", "Database unavailable: Search Console rows could not be read.",
      "Search Console read failed: Database unavailable: Search Console rows could not be read."],
  ])("ok:false %s: reason copy, retry, and no numbers", (reason, message, copy) => {
    const refetch = vi.fn();
    h.queries.set(RANKS, { data: { ok: false, reason, message }, refetch });
    const { container } = render(<LocalGrowthTab />);
    const msg = screen.getByText(copy);
    fireEvent.click((msg.parentElement as HTMLElement).querySelector("button") as HTMLButtonElement);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(NUMBERS);
  });
});
