/**
 * Admin UI v1 Wave 5, item 5: Outreach, Growth, Settings and Instagram's primary row are each one
 * horizontally scrolling strip with 48 px targets and the daily tabs first; the nested strips
 * (SMS Orchestrator, Integrations, Database hygiene) get the same strip style; Integrations labels
 * are sentence case. Deep links (?outreachTab=, ?growthTab=, ?settingsTab=, ?tab=, ?igview=) must
 * resolve exactly as before: tab ids and query keys are unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean };
const h = vi.hoisted(() => ({ queries: new Map<string, Partial<Q>>(), Null: () => null }));

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
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: vi.fn(async () => true), default: () => null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" }, loading: false }) }));

// Outreach and Settings tab bodies are not under test.
for (const p of ["SmsSection", "CampaignsSection", "FollowUpsSection", "ReviewRequestsSection", "WinBackSection", "SmsPerformanceSection"]) {
  vi.doMock(`@/pages/admin/outreach/${p}`, () => ({ default: h.Null }));
}
vi.mock("@/pages/admin/outreach/OutreachBrief", () => ({ OutreachBrief: h.Null }));
vi.mock("@/components/admin/GatewayPill", () => ({ default: h.Null }));
vi.mock("@/pages/admin/outreach/AutonomyCensusPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/outreach/SmsOpsStrip", () => ({ default: h.Null }));
vi.mock("@/pages/admin/settings/SettingsStatusTab", () => ({ default: h.Null }));
vi.mock("@/pages/admin/settings/SiteHealthSection", () => ({ default: h.Null }));
vi.mock("@/pages/admin/settings/ComplianceSection", () => ({ default: h.Null }));
vi.mock("@/pages/admin/settings/FeatureFlagsPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/settings/DeclinedRecoveryPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/shared/SectionInsightStrip", () => ({ default: h.Null, SectionInsightStrip: h.Null }));
vi.mock("@/pages/admin/instagram/Today", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/StudioV2", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/QueueV2", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Learn", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Settings", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Strategy", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/ActionCenter", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Controls", () => ({ Controls: h.Null }));

import OutreachHubSection from "@/pages/admin/OutreachHubSection";
import SettingsSection from "@/pages/admin/SettingsSection";
import IntegrationsSection from "@/pages/admin/settings/IntegrationsSection";
import SmsOrchestratorSection from "@/pages/admin/outreach/SmsOrchestratorSection";
import DatabaseHygienePanel from "@/pages/admin/settings/DatabaseHygienePanel";
import { InstagramAdmin } from "@/pages/admin/instagram/InstagramAdmin";
import { IG_PRIMARY_VIEWS } from "@/pages/admin/instagram/igViews";

beforeEach(() => {
  h.queries.clear();
  window.history.replaceState({}, "", "/admin");
});
afterEach(() => h.queries.clear());

/** The visible text of every tab button in the strip that holds `first`, in DOM order. */
function strip(first: RegExp | string) {
  const btn = screen.getAllByRole("button", { name: first })[0];
  const el = btn.parentElement as HTMLElement;
  return { el, buttons: within(el).getAllByRole("button") };
}
const names = (buttons: HTMLElement[]) => buttons.map((b) => (b.textContent ?? "").trim());
/** TabBar marks the active tab with text-primary-foreground (pill) or border-primary (underline). */
const isActive = (b: HTMLElement) => /text-primary-foreground|\bborder-primary\b/.test(b.className);
const activeName = (buttons: HTMLElement[]) => names(buttons.filter(isActive))[0];

describe("Outreach strip", () => {
  it("the daily tabs come first: Messages, Follow-Ups, Reviews, Win-Back, then the rest", () => {
    render(<OutreachHubSection />);
    expect(names(strip("Messages").buttons)).toEqual(["Messages", "Follow-Ups", "Reviews", "Win-Back", "Campaigns", "Performance", "Orchestrator"]);
  });

  it("is one horizontally scrolling strip with 48 px targets", () => {
    render(<OutreachHubSection />);
    const { el, buttons } = strip("Messages");
    expect(el.className).toMatch(/\boverflow-x-auto\b/);
    for (const b of buttons) expect(b.className, b.textContent ?? "").toMatch(/\bmin-h-12\b/);
  });

  it("deep links still resolve: every ?outreachTab= id and the reengage aliases", () => {
    const expected: Record<string, string> = {
      sms: "Messages", campaigns: "Campaigns", followups: "Follow-Ups", reviews: "Reviews", winback: "Win-Back",
      performance: "Performance", orchestrator: "Orchestrator", reengage: "Win-Back", reengagement: "Win-Back", "re-engagement": "Win-Back",
    };
    for (const [id, label] of Object.entries(expected)) {
      window.history.replaceState({}, "", `/admin?outreachTab=${id}`);
      const { unmount } = render(<OutreachHubSection />);
      expect(activeName(strip(label).buttons), id).toBe(label);
      unmount();
    }
    window.history.replaceState({}, "", "/admin?outreachTab=bogus");
    render(<OutreachHubSection />);
    expect(activeName(strip("Messages").buttons)).toBe("Messages");
  });
});


describe("Settings strip", () => {
  it("Status first, then today's order, one scrolling strip with 48 px targets", () => {
    render(<SettingsSection />);
    const { el, buttons } = strip("Status");
    expect(names(buttons)).toEqual(["Status", "ShopDriver HQ", "System Health", "Compliance", "Integrations"]);
    expect(el.className).toMatch(/\boverflow-x-auto\b/);
    for (const b of buttons) expect(b.className).toMatch(/\bmin-h-12\b/);
    expect(activeName(buttons)).toBe("Status");
  });

  it("deep links still resolve: ?settingsTab=, the legacy ?tab=, and the settings alias", () => {
    const cases: Array<[string, string]> = [
      ["settingsTab=status", "Status"], ["settingsTab=shopdriver", "ShopDriver HQ"], ["settingsTab=health", "System Health"],
      ["settingsTab=compliance", "Compliance"], ["settingsTab=integrations", "Integrations"],
      ["tab=health", "System Health"], ["tab=settings", "Status"],
    ];
    for (const [qs, label] of cases) {
      window.history.replaceState({}, "", `/admin?${qs}`);
      const { unmount } = render(<SettingsSection />);
      expect(activeName(strip("Status").buttons), qs).toBe(label);
      unmount();
    }
  });
});

describe("Instagram primary row", () => {
  it("is one scrolling strip, not a fixed five-column grid, with 48 px triggers", () => {
    render(<InstagramAdmin />);
    const list = screen.getByRole("tablist");
    expect(list.className).toMatch(/\boverflow-x-auto\b/);
    expect(list.className).not.toMatch(/grid-cols-5/);
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(IG_PRIMARY_VIEWS.map((v) => v.label));
    for (const t of tabs) {
      expect(t.className, t.textContent ?? "").toMatch(/\bmin-h-12\b/);
      expect(t.className).toMatch(/\bshrink-0\b/);
    }
  });

  it("?igview= still selects the view, and a click still writes the URL (belt-and-braces onClick kept)", () => {
    window.history.replaceState({}, "", "/admin?igview=insights");
    render(<InstagramAdmin />);
    expect(screen.getByRole("tab", { name: "Learn" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Create" }));
    expect(new URL(window.location.href).searchParams.get("igview")).toBe("create");
  });

  it("a secondary view keeps the More surfaces lane: no primary tab selected, Back to Today shown", () => {
    window.history.replaceState({}, "", "/admin?igview=settings");
    render(<InstagramAdmin />);
    for (const t of screen.getAllByRole("tab")) expect(t.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("button", { name: /Back to Today/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More surfaces" })).toBeTruthy();
  });
});

describe("Nested strips", () => {

  it("SMS Orchestrator: three tabs in the shared scrolling strip, switching still works", () => {
    render(<SmsOrchestratorSection />);
    const { el, buttons } = strip("Decision Control & Logs");
    expect(names(buttons)).toEqual(["Decision Control & Logs", "Performance & Revenue", "Self-Learning & NickGPT"]);
    expect(el.className).toMatch(/\boverflow-x-auto\b/);
    for (const b of buttons) expect(b.className).toMatch(/\bmin-h-12\b/);
    fireEvent.click(screen.getByRole("button", { name: "Performance & Revenue" }));
    expect(activeName(strip("Performance & Revenue").buttons)).toBe("Performance & Revenue");
  });

  it("Database hygiene: the three class cards sit in a scrolling strip on a phone and keep their counts", () => {
    const row = (id: number, table: string) => ({ id, name: "Test", phone: "2165550100", createdAt: new Date().toISOString(), details: "x", table });
    h.queries.set("adminDashboard.dbCleanupScan", { data: { fake: [row(1, "leads")], duplicates: [row(2, "leads"), row(3, "leads")], stale: [] }, isError: false });
    render(<DatabaseHygienePanel />);
    const cards = ["Fake / test leads", "Duplicates", "Stale (>90d)"].map((t) => screen.getByText(t).closest("button") as HTMLElement);
    const holder = cards[0].parentElement as HTMLElement;
    expect(cards.every((c) => c.parentElement === holder)).toBe(true);
    expect(holder.className).toMatch(/\boverflow-x-auto\b/);
    for (const c of cards) expect(c.className).toMatch(/\bmin-h-12\b/);
    expect(cards.map((c) => c.querySelector("p")?.textContent)).toEqual(["1", "2", "0"]);
  });
});
