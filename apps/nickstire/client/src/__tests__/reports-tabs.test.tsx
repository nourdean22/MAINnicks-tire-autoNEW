/**
 * Reports (opsHub), 2026-10-25: the section opens on Search and keeps Traffic.
 *   - The hand-maintained Owner Actions registry and the doc list are gone; old ?reportsTab=actions and
 *     ?reportsTab=reports links land on Search, never a blank panel.
 *   - A role that sees no tab is told so, once its role has loaded.
 *   - Search drops the master-report JSON card and says what its totals are and how fresh.
 *   - Traffic dates the SEO fix drafts and calls a draft over 30 days old stale.
 * Same trpc proxy harness as local-checklist.test.tsx: every query returns no data unless a test sets it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean; fetchStatus?: string };
const h = vi.hoisted(() => ({ queries: new Map<string, Partial<Q>>() }));

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
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() {
        return undefined;
      },
    });
  return { trpc: new Proxy({}, { get: (_t, key) => (key === "useUtils" || key === "useContext" ? () => node("utils") : node(String(key))) }) };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));

import OpsHubSection from "@/pages/admin/OpsHubSection";
import MarketSection from "@/pages/admin/MarketSection";
import TrafficFunnelSection from "@/pages/admin/TrafficFunnelSection";

const ok = (data: unknown): Partial<Q> => ({ data, isError: false });
const FAILED: Partial<Q> = { data: undefined, isError: true, error: new Error("read failed") };
const SEARCH_CARD = "Search · last 28 days";
const REGISTRY_TEXT = [/Owner Actions/, /Refunds \/ writeback/, /verified 2026-06-10/];

function at(search: string) {
  window.history.replaceState(null, "", `/admin?tab=opsHub${search}`);
}
const tabNames = () => screen.getAllByRole("button").map((b) => b.textContent?.trim());

beforeEach(() => {
  h.queries.clear();
  h.queries.set("adminSecurity.status", ok({ adminRole: "owner" }));
});
afterEach(() => {
  h.queries.clear();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("Reports tabs", () => {
  it("opens on Search, and the only tabs are Search and Traffic", async () => {
    at("");
    const { container } = render(<OpsHubSection />);
    expect(await screen.findByText(SEARCH_CARD)).toBeTruthy();
    expect(tabNames()).toEqual(["Search", "Traffic"]);
    expect(container.textContent).toContain("Google search, last 28 days. Read-only: nothing here sends, posts, refunds, or orders.");
  });

  it.each(["actions", "reports"])("an old ?reportsTab=%s link lands on Search with no registry text", async (old) => {
    at(`&reportsTab=${old}`);
    const { container } = render(<OpsHubSection />);
    expect(await screen.findByText(SEARCH_CARD)).toBeTruthy();
    for (const re of REGISTRY_TEXT) expect(container.textContent).not.toMatch(re);
  });

  it("?reportsTab=traffic opens Traffic", async () => {
    at("&reportsTab=traffic");
    render(<OpsHubSection />);
    expect(await screen.findByText(/Couldn't load funnel data/)).toBeTruthy();
    expect(screen.queryByText(SEARCH_CARD)).toBeNull();
  });

  it("a loaded role with no tab is told so, with no tab bar buttons", () => {
    h.queries.set("adminSecurity.status", ok({ adminRole: "accountant" }));
    const { container } = render(<OpsHubSection />);
    expect(screen.getByText("Reports has nothing for your role.")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/Google search, last 28 days/);
  });

  it("control: while the role is still loading it does not claim the role has nothing", () => {
    h.queries.set("adminSecurity.status", { data: undefined, isError: false, isLoading: true, fetchStatus: "fetching" });
    render(<OpsHubSection />);
    expect(screen.queryByText("Reports has nothing for your role.")).toBeNull();
    expect(screen.queryByText("Could not check your access.")).toBeNull();
  });
});

describe("Search card", () => {
  const SUMMARY = {
    from: "2026-09-28",
    to: "2026-10-25",
    totalClicks: 246,
    totalImpressions: 116262,
    avgCtr: 0.2,
    avgPosition: 27.8,
    source: "gsc_official_no_dimension",
  };
  const SOURCE_LINE =
    "Google Search Console, property total, through 2026-10-25; a 28-day read: position is an impression-weighted average and is not a rank.";

  it("the master report card is gone even when its read would answer", () => {
    h.queries.set("market.summary", ok(SUMMARY));
    h.queries.set("market.report", ok({ ok: true, timestamp: "2026-10-25T12:00:00Z", summary: { score: 50, scoreBreakdown: { revenue: 84 } }, marginNote: null }));
    const { container } = render(<MarketSection />);
    expect(container.textContent).not.toMatch(/Master report/);
    expect(container.textContent).not.toMatch(/scoreBreakdown/);
    // control: the totals still render
    expect(screen.getByText("246")).toBeTruthy();
  });

  it("says what the totals are and the date they run through", () => {
    h.queries.set("market.summary", ok(SUMMARY));
    render(<MarketSection />);
    expect(screen.getByText(SOURCE_LINE)).toBeTruthy();
  });

  it("no end date in the payload: only the first clause", () => {
    h.queries.set("market.summary", ok({ ...SUMMARY, to: undefined }));
    const { container } = render(<MarketSection />);
    expect(screen.getByText("Google Search Console, property total.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/through/);
  });

  it("a partial stored-rows read never claims the property total", () => {
    h.queries.set("market.summary", ok({ ...SUMMARY, source: "stored_query_rows_partial" }));
    const { container } = render(<MarketSection />);
    expect(container.textContent).not.toMatch(/property total, through/);
    expect(container.textContent).toMatch(/PARTIAL/);
  });

  it("a failed read is unknown, with no source line", () => {
    h.queries.set("market.summary", FAILED);
    const { container } = render(<MarketSection />);
    expect(container.textContent).toMatch(/could not be read: unknown, not zero/);
    expect(container.textContent).not.toMatch(/Google Search Console, property total/);
  });
});

describe("SEO fix drafts age", () => {
  const NOW = new Date("2026-10-25T15:00:00.000Z");
  const DAY = 86_400_000;
  const DRAFT = {
    slug: "brakes", page: "/brakes", impressions: 900, position: 14.2,
    currentTitle: "Brakes", currentDescription: "Brake work", proposedTitle: "Brake repair in Cleveland",
    proposedDescription: "Free written estimate.", rationale: "Buried on page 2.",
  };
  function mount(generatedAt: string | null) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    h.queries.set("trafficFunnel.overview", ok({
      stages: [], alerts: [], topQueries: [], topPages: [],
      branded: { branded: 0, brandedPct: 0, nonBranded: 0 },
      generatedAt: NOW.toISOString(),
    }));
    h.queries.set("seoTools.seoFixDrafts", ok({ generatedAt, drafts: [DRAFT] }));
    return render(<TrafficFunnelSection />);
  }

  it("over 30 days old: dated, aged, and told to redraft", () => {
    mount("2026-09-05T11:13:24.000Z");
    expect(screen.getByText(
      "Drafted 9/5/2026, 50 days old: these were written against page positions that have moved; redraft before using them.",
    )).toBeTruthy();
  });

  it("31 days old is stale", () => {
    mount(new Date(NOW.getTime() - 31 * DAY - 3_600_000).toISOString());
    expect(screen.getByText(/31 days old: these were written/)).toBeTruthy();
  });

  it("exactly 30 days old is still current", () => {
    mount(new Date(NOW.getTime() - 30 * DAY - 3_600_000).toISOString());
    expect(screen.getByText("Drafted 9/25/2026, current.")).toBeTruthy();
    expect(screen.queryByText(/days old/)).toBeNull();
  });

  it("10 days old is current", () => {
    mount(new Date(NOW.getTime() - 10 * DAY).toISOString());
    expect(screen.getByText("Drafted 10/15/2026, current.")).toBeTruthy();
  });

  it("no generatedAt: the date is unknown", () => {
    mount(null);
    expect(screen.getByText("Draft date unknown.")).toBeTruthy();
    expect(screen.queryByText(/current\.|days old/)).toBeNull();
  });

  it("the Draft button stays the action and is at least 44 px; Copy stays Copy", () => {
    mount("2026-09-05T11:13:24.000Z");
    const draft = screen.getByRole("button", { name: /draft fixes/i });
    expect(draft.className).toMatch(/\bmin-h-11\b/);
    expect(screen.getByRole("button", { name: "Copy services.ts snippet" })).toBeTruthy();
  });
});
