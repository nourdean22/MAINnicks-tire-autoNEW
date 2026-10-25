/**
 * outreach-winback.test.tsx · 2026-10-25 (job 2026-10-25-admin-tabs-outreach)
 *
 * Outreach opens on Messages and has no Follow-Ups tab (the booking follow-up lane is gone; old
 * ?outreachTab=followups links land on Messages, not a blank panel). Win-Back opens on the shared
 * lapsed regulars rule (shared/customerSegments.ts) with the qualifying / can-be-texted pair, so the
 * Customers tab's "Open Win-Back" lands on the people it counted. Other segments say "<n> targets".
 * A failed count read says "counts unknown", never "?". A saved campaign prints its segment's rule,
 * so an old 90-180 day draft is not mistaken for the shared rule. A rejected create keeps the form
 * and says why. The brief's lifetime counts say what they count. The event log prints US phones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { LAPSED_REGULAR_RULE } from "@shared/customerSegments";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean };

const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  // Per-path mutateAsync; absent = resolves {}.
  mutateAsync: new Map<string, (input: unknown) => Promise<unknown>>(),
  calls: [] as Array<{ path: string; input: unknown }>,
  Null: () => null,
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
  const mutation = (path: string) => () => ({
    mutate: (input: unknown) => { h.calls.push({ path, input }); },
    mutateAsync: async (input: unknown) => {
      h.calls.push({ path, input });
      const fn = h.mutateAsync.get(path);
      return fn ? fn(input) : {};
    },
    isPending: false,
    isSuccess: false,
    reset: () => {},
  });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return mutation(path);
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
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: vi.fn(async () => true), default: () => null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" }, loading: false }) }));

// The Messages body is a marker so "lands on Messages" means the Messages body rendered, not a blank pane.
vi.mock("@/pages/admin/outreach/SmsSection", () => ({ default: () => <div data-testid="messages-body">messages</div> }));
for (const p of ["CampaignsSection", "ReviewRequestsSection", "SmsPerformanceSection"]) {
  vi.doMock(`@/pages/admin/outreach/${p}`, () => ({ default: h.Null }));
}
vi.mock("@/components/admin/GatewayPill", () => ({ default: h.Null }));
vi.mock("@/pages/admin/outreach/AutonomyCensusPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/outreach/SmsOpsStrip", () => ({ default: h.Null }));

import OutreachHubSection from "@/pages/admin/OutreachHubSection";
import WinBackSection from "@/pages/admin/outreach/WinBackSection";
import { OutreachBrief } from "@/pages/admin/outreach/OutreachBrief";
import SmsOrchestratorSection from "@/pages/admin/outreach/SmsOrchestratorSection";
import { fmtPhone } from "@/pages/admin/voice/format";

const ok = (data: unknown): Partial<Q> => ({ data, isLoading: false, isError: false });
const FAILED: Partial<Q> = { data: undefined, isLoading: false, isError: true, error: new Error("read failed") };

// Brief fixture, with contactable set apart from qualifying so the test can tell the pair apart.
const COUNTS = { lapsed_regulars: { qualifying: 92, contactable: 88 }, lapsed: 284, dormant: 310, lost: 1200, vip: 40, fleet: 3, recent: 230, tire_customer: 500 };
const OLD_DRAFT = {
  id: 7, name: "first of many 90 -190", status: "draft", targetSegment: "lapsed", targetCount: 284, sentCount: 0,
  createdAt: "2026-10-01T12:00:00.000Z",
};

beforeEach(() => {
  h.queries.clear();
  h.mutateAsync.clear();
  h.calls.length = 0;
  window.history.replaceState({}, "", "/admin?tab=campaigns");
});
afterEach(() => h.queries.clear());

const tabNames = () => {
  const strip = screen.getAllByRole("button", { name: "Messages" })[0].parentElement as HTMLElement;
  return within(strip).getAllByRole("button").map((b) => (b.textContent ?? "").trim());
};
const activeTab = () => {
  const strip = screen.getAllByRole("button", { name: "Messages" })[0].parentElement as HTMLElement;
  return within(strip).getAllByRole("button").filter((b) => /text-primary-foreground|\bborder-primary\b/.test(b.className)).map((b) => (b.textContent ?? "").trim())[0];
};
/** The picker option whose label starts with `label`. */
const option = (label: RegExp) => screen.getByRole("button", { name: label });

describe("Outreach hub tabs", () => {
  it("six tabs in the same order, no Follow-Ups, and it opens on Messages", async () => {
    render(<OutreachHubSection />);
    expect(tabNames()).toEqual(["Messages", "Reviews", "Win-Back", "Campaigns", "Performance", "Orchestrator"]);
    expect(activeTab()).toBe("Messages");
    expect(await screen.findByTestId("messages-body")).toBeTruthy();
  });

  it("an old ?outreachTab=followups link lands on Messages with its body, not a blank panel", async () => {
    window.history.replaceState({}, "", "/admin?tab=campaigns&outreachTab=followups");
    render(<OutreachHubSection />);
    expect(activeTab()).toBe("Messages");
    expect(await screen.findByTestId("messages-body")).toBeTruthy();
    expect(screen.queryByText(/Follow-Ups/)).toBeNull();
  });

  it("?outreachTab=winback (the Customers tab's link) opens Win-Back on Lapsed regulars with the pair", async () => {
    h.queries.set("winback.segmentCounts", ok(COUNTS));
    h.queries.set("winback.campaigns", ok([]));
    window.history.replaceState({}, "", "/admin?tab=campaigns&outreachTab=winback");
    render(<OutreachHubSection />);
    expect(activeTab()).toBe("Win-Back");
    const lr = await screen.findByRole("button", { name: /^Lapsed regulars/ });
    expect(lr.getAttribute("aria-pressed")).toBe("true");
    expect(lr.textContent).toContain(LAPSED_REGULAR_RULE);
    expect(lr.textContent).toContain("92 qualify");
    expect(lr.textContent).toContain("88 can be texted");
  });
});

describe("Win-Back segment picker", () => {
  it("Lapsed regulars is the first option and the default, with the shared rule and the pair", () => {
    h.queries.set("winback.segmentCounts", ok(COUNTS));
    h.queries.set("winback.campaigns", ok([]));
    render(<WinBackSection />);
    const group = screen.getByRole("group", { name: /audience/i });
    const options = within(group).getAllByRole("button");
    expect(options[0].textContent).toMatch(/^Lapsed regulars/);
    expect(options[0].getAttribute("aria-pressed")).toBe("true");
    expect(options.filter((o) => o.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(options[0].textContent).toContain(LAPSED_REGULAR_RULE);
    expect(options[0].textContent).toContain("92 qualify");
    expect(options[0].textContent).toContain("88 can be texted");
    expect(options[0].textContent).not.toMatch(/targets/i);
    // 44 px phone targets on every option.
    for (const o of options) expect(o.className, o.textContent ?? "").toMatch(/\bmin-h-11\b|\bmin-h-12\b/);
  });

  it("the other segments keep their windows and say '<n> targets', never TARGETS or CUSTOMERS", () => {
    h.queries.set("winback.segmentCounts", ok(COUNTS));
    h.queries.set("winback.campaigns", ok([]));
    const { container } = render(<WinBackSection />);
    expect(option(/^Lapsed \(90-180d\)/).textContent).toContain("284 targets");
    expect(option(/^Dormant \(180-365d\)/).textContent).toContain("310 targets");
    expect(option(/^Lost \(365d\+\)/).textContent).toContain("1200 targets");
    expect(container.textContent).not.toMatch(/TARGETS|CUSTOMERS/);
  });

  it("a failed count read renders 'counts unknown' on every option, never '?' or a zero", () => {
    h.queries.set("winback.segmentCounts", FAILED);
    h.queries.set("winback.campaigns", ok([]));
    render(<WinBackSection />);
    const options = within(screen.getByRole("group", { name: /audience/i })).getAllByRole("button");
    expect(options.length).toBe(8);
    for (const o of options) {
      expect(o.textContent, o.textContent ?? "").toContain("counts unknown");
      expect(o.textContent).not.toMatch(/\?|\b0 (targets|qualify)/);
    }
  });

  it("a saved draft prints its segment rule in words under its name", () => {
    h.queries.set("winback.segmentCounts", ok(COUNTS));
    h.queries.set("winback.campaigns", ok([OLD_DRAFT]));
    render(<WinBackSection />);
    const row = screen.getByRole("button", { name: /first of many 90 -190/ });
    expect(row.textContent).toContain("last visit 90 to 180 days ago, any number of visits");
    expect(row.textContent).not.toContain(LAPSED_REGULAR_RULE);
    expect(row.textContent).toContain("284 targets");
    expect(row.textContent).toContain("0 sent");
  });

  it("drafting from the picker carries Lapsed regulars into the form, and a rejected create keeps the form and says why", async () => {
    h.queries.set("winback.segmentCounts", ok(COUNTS));
    h.queries.set("winback.campaigns", ok([]));
    h.mutateAsync.set("winback.create", async () => {
      throw new Error("Data truncated for column 'targetSegment'");
    });
    render(<WinBackSection />);
    fireEvent.click(screen.getByRole("button", { name: /draft a sequence/i }));
    const name = screen.getByPlaceholderText(/Win-Back/) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "October regulars" } });
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Data truncated for column 'targetSegment'"));
    expect(h.calls.find((c) => c.path === "winback.create")?.input).toEqual({ name: "October regulars", targetSegment: "lapsed_regulars" });
    expect((screen.getByPlaceholderText(/Win-Back/) as HTMLInputElement).value).toBe("October regulars");
    expect(option(/^Lapsed regulars/).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Outreach brief", () => {
  it("says the lifetime campaign count is bulk campaigns and what the lifetime sends are", () => {
    h.queries.set("reviewRequests.stats", ok({ pending: 0, sent: 40 }));
    h.queries.set("campaigns.stats", ok({ activeCampaigns: 0, totalCampaigns: 2, totalSent: 1440 }));
    h.queries.set("shopdriver.declinedRecoveryStatus", ok({ dryRun: false, recoverableDollars: 0, eligible: 0 }));
    h.queries.set("sms.gatewayHealth", ok({ online: true }));
    const { container } = render(<OutreachBrief onRecoveryAction={() => {}} />);
    expect(container.textContent).toContain("2 bulk campaigns lifetime (Campaigns tab)");
    expect(container.textContent).toContain("1,480 messages sent lifetime (review requests and bulk campaigns)");
    expect(container.textContent).not.toMatch(/customer touches/);
  });
});

describe("US phone format", () => {
  it("E.164 and 10-digit numbers both print (216) 555-0147; anything else is unchanged", () => {
    expect(fmtPhone("+12165550147")).toBe("(216) 555-0147");
    expect(fmtPhone("2165550147")).toBe("(216) 555-0147");
    expect(fmtPhone("shop-line")).toBe("shop-line");
  });

  it("the Orchestrator event log prints an E.164 recipient as (216) 555-0147, not +(121) 655-50147", () => {
    h.queries.set("smsOrchestrator.getOrchestrations", ok({
      items: [{ id: 1, createdAt: "2026-10-25T12:00:00.000Z", eventType: "booking_reminder", customerPhone: "+12165550147", status: "sent", variantId: "a", reason: "ok" }],
      total: 1,
    }));
    const { container } = render(<SmsOrchestratorSection />);
    expect(container.textContent).toContain("(216) 555-0147");
    expect(container.textContent).not.toContain("+(121)");
  });
});
