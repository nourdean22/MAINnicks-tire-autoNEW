/**
 * Customers opens on who to contact now (2026-10-25): one "Lapsed regulars" queue built from
 * customers.stats.lapsedRegulars, with the rule printed, the qualifying count beside the textable
 * count and the roster denominator; "View list" filters the roster to the same people; "Open Win-Back"
 * and the insight strip both land on Outreach > Win-Back. The March-2026 bulk review text is gone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import {
  VIP_MIN_VISITS, LAPSED_MIN_DAYS, LAPSED_MAX_DAYS, LAPSED_REGULAR_RULE,
} from "@shared/customerSegments";

const h = vi.hoisted(() => ({
  queries: {} as Record<string, { data?: unknown; error?: unknown; fetchStatus?: string }>,
  inputs: {} as Record<string, unknown>,
  read: new Set<string>(),
}));

vi.mock("@/lib/trpc", () => {
  const queryResult = (key: string) => {
    const c = h.queries[key] ?? {};
    return {
      data: c.data,
      isLoading: false,
      isPending: false,
      isError: c.error != null,
      isSuccess: c.error == null && c.data !== undefined,
      error: c.error ?? null,
      fetchStatus: c.fetchStatus ?? "idle",
      status: c.error != null ? "error" : c.data !== undefined ? "success" : "pending",
      refetch: vi.fn(),
    };
  };
  const procedure = (key: string) => ({
    useQuery: (input?: unknown) => { h.read.add(key); h.inputs[key] = input; return queryResult(key); },
    useMutation: () => { h.read.add(key); return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, reset: vi.fn() }; },
  });
  const utils = (): unknown =>
    new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn(), fetch: vi.fn() }) }) });
  const trpc = new Proxy({}, {
    get: (_t, ns) => {
      if (ns === "useUtils" || ns === "useContext") return utils;
      return new Proxy({}, { get: (_t2, proc) => procedure(`${String(ns)}.${String(proc)}`) });
    },
  });
  return { trpc };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { CustomersList } from "@/pages/admin/customers/CustomersList";
import { SectionInsightStrip } from "@/pages/admin/shared/insight";

const STATS = {
  total: 2400, withVisits: 2119, vipCount: 169, lapsed: 744, recent: 300, withEmail: 24, commercial: 12,
  totalRevenue: 123456700, avgSpend: 51440, unknown: 100,
};
const WINBACK_HREF = "/admin?tab=campaigns&outreachTab=winback";
const PHONE = /\(?\d{3}\)?[\s.-]?\d{3}-\d{4}/;

function renderList() {
  return render(<CustomersList onOpenCustomer={vi.fn()} />);
}

function queueLine(): HTMLElement {
  return screen.getByTestId("lapsed-regulars-queue");
}

function captureNav() {
  const sections: string[] = [];
  const onNav = (e: Event) => sections.push((e as CustomEvent<{ section: string }>).detail.section);
  window.addEventListener("admin:navigate-section", onNav);
  return { sections, stop: () => window.removeEventListener("admin:navigate-section", onNav) };
}

beforeEach(() => {
  h.queries = { "customers.list": { data: { customers: [], total: 0 } } };
  h.inputs = {};
  h.read = new Set();
  window.history.replaceState({}, "", "/admin?tab=customers");
});
afterEach(cleanup);

describe("Customers queue: lapsed regulars to contact now", () => {
  it("prints the rule, the qualifying count, the textable count and the roster denominator", () => {
    h.queries["customers.stats"] = { data: { ...STATS, lapsedRegulars: { qualifying: 61, contactable: 48 } } };
    renderList();
    const text = queueLine().textContent ?? "";
    expect(text).toContain("Lapsed regulars");
    expect(text).toContain("61 qualify");
    expect(text).toContain(`(${LAPSED_REGULAR_RULE})`);
    expect(text).toContain("48 can be texted");
    expect(text).toContain("of 2,119 customers with a visit");
    expect(text).not.toMatch(PHONE);
    expect(text).not.toMatch(/opportunity/i);
  });

  it("View list filters the roster to lapsed AND regulars, so the list shows the people the number counts", () => {
    h.queries["customers.stats"] = { data: { ...STATS, lapsedRegulars: { qualifying: 61, contactable: 48 } } };
    renderList();
    // A filter left on from an earlier tap would show fewer people than the queue counts.
    fireEvent.click(screen.getByText("With Email"));
    expect((h.inputs["customers.list"] as { hasEmail?: boolean }).hasEmail).toBe(true);
    const btn = screen.getByRole("button", { name: /view list/i });
    expect(btn.className).toMatch(/min-h-1[12]/);
    fireEvent.click(btn);
    const input = h.inputs["customers.list"] as { segment?: string; minVisits?: number; page?: number; hasEmail?: boolean; customerType?: string };
    expect(input.segment).toBe("lapsed");
    expect(input.minVisits).toBe(VIP_MIN_VISITS);
    expect(input.page).toBe(1);
    expect(input.hasEmail).toBeUndefined();
    expect(input.customerType).toBeUndefined();
  });

  it("Open Win-Back is a real link into Outreach > Win-Back and fires the section event", () => {
    h.queries["customers.stats"] = { data: { ...STATS, lapsedRegulars: { qualifying: 61, contactable: 48 } } };
    renderList();
    const link = screen.getByRole("link", { name: /open win-back/i });
    expect(link.getAttribute("href")).toBe(WINBACK_HREF);
    expect(link.className).toMatch(/min-h-1[12]/);
    const nav = captureNav();
    fireEvent.click(link);
    nav.stop();
    expect(nav.sections).toEqual(["campaigns"]);
    expect(window.location.search).toContain("outreachTab=winback");
  });

  it("a measured zero says so with the rule and keeps only the Win-Back link", () => {
    h.queries["customers.stats"] = { data: { ...STATS, lapsedRegulars: { qualifying: 0, contactable: 0 } } };
    renderList();
    expect(queueLine().textContent).toContain(`No lapsed regulars right now (${LAPSED_REGULAR_RULE}).`);
    expect(screen.queryByRole("button", { name: /view list/i })).toBeNull();
    expect(screen.getByRole("link", { name: /open win-back/i }).getAttribute("href")).toBe(WINBACK_HREF);
    expect(screen.queryByText(/0 qualify/)).toBeNull();
  });

  it("an older server without lapsedRegulars omits the line, never a 0", () => {
    h.queries["customers.stats"] = { data: { ...STATS } };
    renderList();
    expect(screen.queryByTestId("lapsed-regulars-queue")).toBeNull();
    expect(screen.queryByText(/qualify/)).toBeNull();
    expect(screen.queryByText(/can be texted/)).toBeNull();
  });

  it("a failed stats read is unknown, not 0 qualify", () => {
    h.queries["customers.stats"] = { error: new Error("SERVICE_UNAVAILABLE") };
    renderList();
    expect(screen.getByText(/couldn't load, state unknown/)).toBeTruthy();
    expect(screen.queryByTestId("lapsed-regulars-queue")).toBeNull();
    expect(screen.queryByText(/qualify/)).toBeNull();
  });

  it("a paused (offline) stats read says not checked, not 0 qualify", () => {
    h.queries["customers.stats"] = { fetchStatus: "paused" };
    renderList();
    expect(screen.getByText(/not checked \(offline\)/)).toBeTruthy();
    expect(screen.queryByTestId("lapsed-regulars-queue")).toBeNull();
  });

  it("the March-2026 bulk review text is gone: no Send Next 50, no progress bar, no campaign reads", () => {
    h.queries["customers.stats"] = { data: { ...STATS, lapsedRegulars: { qualifying: 61, contactable: 48 } } };
    h.queries["customers.campaignStats"] = { data: { sent: 5, remaining: 5, total: 10 } };
    renderList();
    expect(screen.queryByText(/send next/i)).toBeNull();
    expect(screen.queryByText(/SMS:/)).toBeNull();
    expect(h.read.has("customers.campaignStats")).toBe(false);
    expect(h.read.has("customers.retryCampaign")).toBe(false);
  });

  it("tile labels come from the shared rules", () => {
    h.queries["customers.stats"] = { data: { ...STATS, lapsedRegulars: { qualifying: 61, contactable: 48 } } };
    renderList();
    expect(screen.getByText(`Lapsed (${LAPSED_MIN_DAYS}-${LAPSED_MAX_DAYS} d)`)).toBeTruthy();
    expect(screen.getByText(`VIP (${VIP_MIN_VISITS}+)`)).toBeTruthy();
  });
});

describe("SectionInsightStrip: the action reaches the inner tab", () => {
  it("a cta with params is a real link to /admin?tab=<section>&<params> and lands on Win-Back", () => {
    h.queries["adminDashboard.sectionInsight"] = {
      data: {
        variant: "primary",
        metric: "61 lapsed regulars",
        message: "61 lapsed regulars (3+ visits, last visit 90 to 365 days ago); 48 can be texted.",
        cta: { label: "Open Win-Back", section: "campaigns", params: { outreachTab: "winback" } },
      },
    };
    render(<SectionInsightStrip section="customers" />);
    const link = screen.getByRole("link", { name: /open win-back/i });
    expect(link.getAttribute("href")).toBe(WINBACK_HREF);
    expect(link.className).toMatch(/min-h-1[12]/);
    const nav = captureNav();
    fireEvent.click(link);
    nav.stop();
    expect(nav.sections).toEqual(["campaigns"]);
    expect(window.location.search).toBe("?tab=campaigns&outreachTab=winback");
  });

  it("a legacy cta with settingsTab keeps the section-event path", () => {
    h.queries["adminDashboard.sectionInsight"] = {
      data: { variant: "warning", metric: "2 stale", message: "Two feeds are stale.", cta: { label: "Open status", section: "settings", settingsTab: "status" } },
    };
    render(<SectionInsightStrip section="settings" />);
    const btn = screen.getByRole("button", { name: /open status/i });
    expect(btn.className).toMatch(/min-h-1[12]/);
    const nav = captureNav();
    fireEvent.click(btn);
    nav.stop();
    expect(nav.sections).toEqual(["settings"]);
    expect(window.location.search).toContain("settingsTab=status");
  });
});
