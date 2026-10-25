/**
 * competitors-tab.test.tsx · 2026-10-25 (job 2026-10-25-admin-tabs-competitors)
 *
 * Website & Local > Competitors reads localGrowth.competitorSnapshot live from Google.
 * The 2026-06 hand-typed baseline, the "manual" badge and the weekly checklist are gone.
 * A failed or unconfigured read renders no number at all: unknown, never zero.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

import { CompetitorsTab, LocalGrowthTab } from "@/pages/admin/GrowthSection";

const SNAP = "localGrowth.competitorSnapshot";

function okPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    fetchedAt: new Date(Date.now() - 5 * 60000).toISOString(),
    cacheAgeSeconds: 300,
    nicks: {
      name: "Nick's Tire & Auto (You)", placeId: "SELF", rating: 4.9, reviewCount: 1715,
      recent: { count: 5, newestAt: "2026-10-24T00:00:00.000Z", oldestAt: "2026-10-10T00:00:00.000Z" },
    },
    competitors: [
      { name: "Local A", placeId: "a", group: "local", rating: 4.3, reviewCount: 1900,
        recent: { count: 5, newestAt: "2026-10-23T00:00:00.000Z", oldestAt: "2026-09-23T00:00:00.000Z" } },
      { name: "Chain B", placeId: "b", group: "chain", rating: 4.6, reviewCount: 300,
        recent: { count: 1, newestAt: "2026-10-01T00:00:00.000Z", oldestAt: "2026-10-01T00:00:00.000Z" } },
    ],
    unresolved: 1,
    rank: { byRating: 1, byVolume: 2, of: 3 },
    ...overrides,
  };
}

const row = (name: string) => screen.getByText(name).closest("[data-competitor-row]") as HTMLElement;

beforeEach(() => {
  h.queries.clear();
  window.history.replaceState({}, "", "/admin?tab=content&contentTab=competitors");
});
afterEach(() => {
  h.queries.clear();
  vi.restoreAllMocks();
});

describe("CompetitorsTab: live Google snapshot", () => {
  it("shows the live header and Google attribution, with no baseline, manual badge or weekly chore", () => {
    h.queries.set(SNAP, { data: okPayload() });
    const { container } = render(<CompetitorsTab />);
    expect(screen.getByText("Live from Google · read 5m ago · refreshes hourly")).toBeTruthy();
    expect(screen.getByText("Ratings and review counts: Google, read live. Nothing is stored.")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/baseline/i);
    expect(text).not.toMatch(/2026-06/);
    expect(text).not.toMatch(/weekly/i);
    expect(text).not.toMatch(/\bmanual\b/i);
    expect(text).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
  });

  it("Where we stand: our rating, total reviews, rank and pace as N in D days", () => {
    h.queries.set(SNAP, { data: okPayload() });
    render(<CompetitorsTab />);
    const card = screen.getByTestId("where-we-stand");
    expect(within(card).getByText("4.9")).toBeTruthy();
    expect(within(card).getByText("1,715")).toBeTruthy();
    expect(within(card).getByText("#1 of 3 by rating · #2 of 3 by review count")).toBeTruthy();
    expect(within(card).getByText("5 newest reviews in 14 days")).toBeTruthy();
  });

  it("our listing unreadable: rank is UNMEASURED and no gap is computed", () => {
    h.queries.set(SNAP, { data: okPayload({ nicks: null, rank: null }) });
    const { container } = render(<CompetitorsTab />);
    expect(screen.getByText("Our own listing could not be read: rank is UNMEASURED.")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/ahead of us/);
    expect(text).not.toMatch(/we lead by/);
    expect(text).not.toMatch(/Nearest ahead/);
    expect(text).not.toMatch(/by rating/);
  });

  it("Watch list: local independents before chains, gap sign and colour, pace only when 2+ timestamps", () => {
    h.queries.set(SNAP, { data: okPayload() });
    render(<CompetitorsTab />);
    const local = screen.getByText("Local independents");
    const chains = screen.getByText("Chains");
    expect(local.compareDocumentPosition(chains) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const a = row("Local A");
    expect(within(a).getByText("4.3 ★")).toBeTruthy();
    expect(within(a).getByText("1,900 reviews")).toBeTruthy();
    const ahead = within(a).getByText("185 ahead of us");
    expect(ahead.className).toMatch(/red/);
    expect(within(a).getByText("5 newest in 30 d")).toBeTruthy();

    const b = row("Chain B");
    expect(within(b).getByText("4.6 ★")).toBeTruthy();
    expect(within(b).getByText("300 reviews")).toBeTruthy();
    const lead = within(b).getByText("we lead by 1,415");
    expect(lead.className).toMatch(/emerald/);
    expect(b.textContent).not.toMatch(/newest in/);

    expect(screen.getByText("1 tracked shop could not be read from Google this time (the server log names them).")).toBeTruthy();
  });

  it("Watch list sorts each group by review count, most first", () => {
    const base = okPayload();
    h.queries.set(SNAP, {
      data: {
        ...base,
        competitors: [
          { ...base.competitors[0], name: "Small Local", placeId: "s", reviewCount: 40 },
          { ...base.competitors[0], name: "Big Local", placeId: "g", reviewCount: 2400 },
        ],
      },
    });
    render(<CompetitorsTab />);
    const small = screen.getByText("Small Local");
    const big = screen.getByText("Big Local");
    expect(big.compareDocumentPosition(small) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("One action: names the nearest shop ahead and deep-links to Outreach > Reviews", () => {
    h.queries.set(SNAP, { data: okPayload() });
    const navigated = vi.fn();
    window.addEventListener("admin:navigate-section", navigated as EventListener);
    render(<CompetitorsTab />);
    expect(screen.getByText("Review volume is the gap most worth closing.")).toBeTruthy();
    expect(screen.getByText("Nearest ahead by volume: Local A, 185 more reviews.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Ask recent customers for a review" });
    expect(link.getAttribute("href")).toBe("/admin?tab=campaigns&outreachTab=reviews");
    expect(link.className).toMatch(/min-h-12/);
    fireEvent.click(link);
    expect(navigated).toHaveBeenCalledTimes(1);
    expect((navigated.mock.calls[0][0] as CustomEvent).detail).toEqual({ section: "campaigns" });
    expect(window.location.search).toBe("?tab=campaigns&outreachTab=reviews");
    window.removeEventListener("admin:navigate-section", navigated as EventListener);
    expect(screen.getByRole("button", { name: /Copy our review link/ })).toBeTruthy();
  });

  it("stores nothing in the browser", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    h.queries.set(SNAP, { data: okPayload() });
    render(<CompetitorsTab />);
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("CompetitorsTab: honest non-ok states", () => {
  it("loading", () => {
    h.queries.set(SNAP, { isLoading: true });
    render(<CompetitorsTab />);
    expect(screen.getByText("Reading Google...")).toBeTruthy();
  });

  it("query failed: unknown, not zero, and retry calls refetch", () => {
    const refetch = vi.fn();
    h.queries.set(SNAP, { isError: true, error: new Error("boom"), refetch });
    const { container } = render(<CompetitorsTab />);
    expect(screen.getByText("Competitor numbers couldn't load: unknown, not zero.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/★|\d+ reviews/);
  });

  it.each([
    ["unconfigured", "no key", "Google Places key is not set on the server. Competitor numbers are UNMEASURED, not zero. Add GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY) in Railway."],
    ["denied", "REQUEST_DENIED", "Google rejected the Places key (REQUEST_DENIED). Fix the key or its API restriction in Google Cloud; nothing to do on the phone."],
    ["error", "timeout", "Google read failed: timeout."],
  ])("ok:false %s: reason copy, retry, and no numbers", (reason, message, copy) => {
    const refetch = vi.fn();
    h.queries.set(SNAP, { data: { ok: false, reason, message }, refetch });
    const { container } = render(<CompetitorsTab />);
    expect(screen.getByText(copy)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/★|\d+ reviews|ahead of us|we lead|Watch list|Where we stand/);
  });
});

describe("LocalGrowthTab: the two line edits", () => {
  it("formats the live total and points at the live Competitors tab, not a weekly baseline chore", () => {
    h.queries.set("localGrowth.reviewsHealth", {
      data: { liveReachable: true, liveReviewCount: 1715, mapsKeyPresent: true, placesKeyPresent: true, status: "live", fallbackNote: null, rating: 4.9 },
    });
    const { container } = render(<LocalGrowthTab />);
    expect(screen.getByText(/live reviews reachable \(1,715 reviews\)/)).toBeTruthy();
    expect(screen.getByText("Open the Competitors tab: live Google numbers and one action.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/against the baseline/);
  });
});
