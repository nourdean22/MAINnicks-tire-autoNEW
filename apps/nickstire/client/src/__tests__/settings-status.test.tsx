/**
 * settings-status.test.tsx · 2026-10-26 (job 2026-10-25-admin-tabs-settings)
 *
 * Settings / Safety opens on what needs attention: pause switches are a state (never a warning, never ON/OFF),
 * scheduled work is one row per job with the failures first, a data finding is its words without the probe codes,
 * declined recovery says one state, the static cron catalog is gone, and old integration failures stop painting red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean };
type MutOpts = { onSuccess?: (res: unknown, input: unknown) => void; onError?: (err: Error) => void };

const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  calls: [] as Array<{ path: string; input: unknown }>,
  confirm: vi.fn(async () => true),
}));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isFetching: false,
    fetchStatus: "idle",
    ...h.queries.get(path),
  });
  const mutation = (path: string) => (opts?: MutOpts) => ({
    mutate: (input: unknown) => {
      h.calls.push({ path, input });
      opts?.onSuccess?.(input, input);
    },
    mutateAsync: async () => ({}),
    isPending: false,
    isSuccess: false,
    variables: undefined,
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
  const root = new Proxy({}, {
    get(_t, key) {
      if (key === "useUtils" || key === "useContext") return () => node("utils");
      return node(String(key));
    },
  });
  return { trpc: root };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));

vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirm }));

import SettingsStatusTab from "@/pages/admin/settings/SettingsStatusTab";
import SettingsSection from "@/pages/admin/SettingsSection";
import DeclinedRecoveryPanel from "@/pages/admin/settings/DeclinedRecoveryPanel";
import FeatureFlagsPanel from "@/pages/admin/settings/FeatureFlagsPanel";
import IntegrationsSection from "@/pages/admin/settings/IntegrationsSection";
import SiteHealthSection from "@/pages/admin/settings/SiteHealthSection";

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const set = (path: string, data: unknown, extra: Partial<Q> = {}) => h.queries.set(path, { data, ...extra });

const FLAG_RUNNING = { key: "sms_global_pause", value: false, description: "OFF-SWITCH", inverted: true, lastChange: null, lastChangeKnown: true };
const FLAG_PAUSED = {
  key: "ig_autopost_paused",
  value: true,
  description: "OFF-SWITCH",
  inverted: true,
  lastChange: { by: "owner@example.test", at: "2026-10-20T14:14:00Z", value: true },
  lastChangeKnown: true,
};
const FLAG_ON = { key: "sms_blast_enabled", value: true, description: "Blast", inverted: false, lastChange: null, lastChangeKnown: true };
const FLAG_OFF = { key: "missed_call_recovery", value: false, description: "Missed-call recovery texts", inverted: false, lastChange: null, lastChangeKnown: true };

const DATA_ACCURACY_FINDING =
  "1 of 25 invoices in the last 7 days have no customer phone (cannot be texted; the import or the phone backfill may be broken)";
const PROBES = "invoiceFreshness=fresh(0 shop-day-old) | invoicesVolume=unmeasured(n=0,history=1,z=?)";

const job = (over: Record<string, unknown>) => ({
  lastStartedAt: ago(5 * MIN),
  lastDurationMs: 120,
  lastDetails: null,
  lastErrorMessage: null,
  lastSuccessAt: ago(5 * MIN),
  runs: 1,
  failed: 0,
  skipped: 0,
  lastStatus: "completed",
  ...over,
});

const SUMMARY = {
  since: ago(DAY),
  to: ago(0),
  jobs: [
    job({ jobName: "reel-pipeline", lastStatus: "failed", lastErrorMessage: "ECONNRESET", runs: 3, failed: 1, lastStartedAt: ago(20 * MIN), lastSuccessAt: ago(80 * MIN) }),
    job({ jobName: "alg-mirror-health", lastStatus: "skipped", lastDetails: "skipped: admin inactive", runs: 12, skipped: 12, lastSuccessAt: null }),
    job({ jobName: "self-healing", runs: 40 }),
    job({
      jobName: "reminder-queue",
      runs: 12,
      lastDetails: "planned 169 (...); due 2: sent 0, queued 0, uncertain 0, held out 0, failed 0, awaiting approval 0, deferred 2, too late 0",
    }),
    job({ jobName: "data-accuracy-check", lastDetails: `${DATA_ACCURACY_FINDING} · probes: ${PROBES}` }),
  ],
  observer: {
    at: ago(10 * MIN),
    failing: 0,
    shapesJudged: 7,
    queuesStuck: [{ loop: "reminder-queue", ageMinutes: 23664, maxAgeMinutes: 1440 }],
    shapes: [
      { job: "sms-response-jobs", shape: "missing" },
      { job: "outbound-sms-queue", shape: "missing" },
      { job: "declined-work-recovery", shape: "dormant" },
    ],
    undeclaredLoops: 118,
    raw: "...",
  },
};

const BLEEDER_FUNNEL = {
  stages: [{ name: "x" }],
  generatedAt: ago(0),
  topPages: [{ page: "https://nickstire.org/oil-change", impressions: 50_000, clicks: 10, ctr: 0.02 }],
};

beforeEach(() => {
  h.queries.clear();
  h.calls.length = 0;
  h.confirm.mockClear();
  h.confirm.mockImplementation(async () => true);
  window.history.replaceState({}, "", "/admin?tab=settings");
});
afterEach(cleanup);

const scheduled = () => document.getElementById("scheduled-work") as HTMLElement;

describe("Status: pause switches are a state, never an open issue", () => {
  it("(a) an inverted OFF flag is not an issue and the switches line says none paused; a real OFF flag still warns", () => {
    set("featureFlags.list", [FLAG_RUNNING, FLAG_ON, FLAG_OFF]);
    set("nickActions.cronHealthSummary", { ...SUMMARY, jobs: [], observer: null });
    render(<SettingsStatusTab />);
    expect(screen.queryByText(/sms_global_pause/)).toBeNull();
    expect(screen.getByText("Pause switches: none paused · 1 switch")).toBeTruthy();
    // positive control: the noisy-alarm fix must keep the true case firing
    expect(screen.getByText("Feature flag OFF · missed_call_recovery")).toBeTruthy();
  });

  it("(b) an inverted ON flag reads Paused with who and when, and is not a warning", () => {
    set("featureFlags.list", [FLAG_RUNNING, FLAG_PAUSED]);
    set("nickActions.cronHealthSummary", { ...SUMMARY, jobs: [], observer: null });
    render(<SettingsStatusTab />);
    expect(screen.getByText("Paused: Instagram autopost since Oct 20 by owner@example.test")).toBeTruthy();
    expect(screen.queryByText(/Feature flag OFF/)).toBeNull();
    expect(screen.queryByText(/ig_autopost_paused/)).toBeNull();
  });

  it("(b2) a paused switch with no audit row says so, and an unreadable audit says unavailable", () => {
    set("featureFlags.list", [{ ...FLAG_PAUSED, lastChange: null }, { ...FLAG_RUNNING, key: "telegram_digest_muted", value: true, lastChangeKnown: false }]);
    set("nickActions.cronHealthSummary", { ...SUMMARY, jobs: [], observer: null });
    render(<SettingsStatusTab />);
    expect(screen.getByText("Paused: Instagram autopost · never flipped since install")).toBeTruthy();
    expect(screen.getByText("Paused: Telegram digests · change history unavailable")).toBeTruthy();
  });
});

describe("Status: open issues read in words", () => {
  it("(c) the SEO bleeder produces no issue", () => {
    set("featureFlags.list", []);
    set("trafficFunnel.overview", BLEEDER_FUNNEL);
    set("nickActions.cronHealthSummary", { ...SUMMARY, jobs: [], observer: null });
    render(<SettingsStatusTab />);
    expect(screen.queryByText(/CTR/)).toBeNull();
    expect(screen.queryByText(/oil-change/)).toBeNull();
  });

  it("(d) the data-accuracy finding shows only its words; the probes sit in the why text", () => {
    set("featureFlags.list", []);
    set("nickActions.cronHealthSummary", SUMMARY);
    render(<SettingsStatusTab />);
    const detail = screen.getByText(DATA_ACCURACY_FINDING);
    expect(detail.textContent).toBe(DATA_ACCURACY_FINDING);
    expect(screen.getByText(/Checks run this pass: invoiceFreshness=fresh/)).toBeTruthy();
  });

  it("(d2) a clean data-accuracy pass is not an issue", () => {
    set("featureFlags.list", []);
    set("nickActions.cronHealthSummary", {
      ...SUMMARY,
      observer: null,
      jobs: [job({ jobName: "data-accuracy-check", lastDetails: `All checks clean: 0 of 25 invoices without a phone · probes: ${PROBES}` })],
    });
    render(<SettingsStatusTab />);
    expect(screen.queryByText(/Data accuracy/)).toBeNull();
    expect(screen.queryByText(/Checks run this pass/)).toBeNull();
  });

  it("(e) the observer's stuck queue and lane shapes are two plain warnings with their denominators", () => {
    set("featureFlags.list", []);
    set("nickActions.cronHealthSummary", SUMMARY);
    render(<SettingsStatusTab />);
    expect(screen.getByText("Queue stuck · maintenance reminders")).toBeTruthy();
    expect(screen.getByText(/waited 16\.4 days \(limit 1 day\)/)).toBeTruthy();
    expect(screen.getAllByText(/Scheduled lanes not running as declared/)).toHaveLength(1);
    expect(screen.getByText("Scheduled lanes not running as declared · 3")).toBeTruthy();
    expect(
      screen.getByText("3 of 7 judged lanes: sms-response-jobs (missing), outbound-sms-queue (missing), declined-work-recovery (dormant)"),
    ).toBeTruthy();
  });

  it("(m) the stuck-queue warning carries the loop's own last run, so deferred reminders read as deferred", () => {
    set("featureFlags.list", []);
    set("nickActions.cronHealthSummary", SUMMARY);
    render(<SettingsStatusTab />);
    const title = screen.getByText("Queue stuck · maintenance reminders");
    const row = title.closest("[data-issue]") as HTMLElement;
    expect(row.textContent).toContain("deferred 2");
  });

  it("(e2) a null observer adds nothing", () => {
    set("featureFlags.list", []);
    set("nickActions.cronHealthSummary", { ...SUMMARY, observer: null });
    render(<SettingsStatusTab />);
    expect(screen.queryByText(/Queue stuck/)).toBeNull();
    expect(screen.queryByText(/Scheduled lanes not running/)).toBeNull();
  });
});

describe("Status: scheduled work, one row per job", () => {
  it("(f) the failed job comes first and the 40-run clean job is one collapsed row", () => {
    set("featureFlags.list", []);
    set("nickActions.cronHealthSummary", SUMMARY);
    render(<SettingsStatusTab />);
    const panel = scheduled();
    expect(within(panel).getByText("1 need attention · 1 skipped by design · 3 ran clean · last 24 h")).toBeTruthy();
    const names = Array.from(panel.querySelectorAll("[data-job]")).map((el) => el.getAttribute("data-job"));
    expect(names[0]).toBe("reel-pipeline");
    expect(names.filter((n) => n === "self-healing")).toHaveLength(1);
    expect(within(panel).getByText("1 of 3 runs failed")).toBeTruthy();
    expect(within(panel).getByText("ECONNRESET")).toBeTruthy();
    expect(within(panel).getByText("Ran clean (3)")).toBeTruthy();
    expect(within(panel).getByText("Skipped (1)")).toBeTruthy();
    expect(within(panel).getByText(/· 40 runs$/)).toBeTruthy();
    expect(screen.queryByText("Cron Health")).toBeNull();
  });

  it("(f2) an empty window says the scheduler may be down", () => {
    set("featureFlags.list", []);
    set("nickActions.cronHealthSummary", { ...SUMMARY, jobs: [], observer: null });
    render(<SettingsStatusTab />);
    expect(within(scheduled()).getByText("No scheduled work logged in the last 24 h. The scheduler may be down: check the server.")).toBeTruthy();
  });

  it("(g) a failed read says unknown, not healthy, and names the check that could not run", () => {
    set("featureFlags.list", []);
    set("nickActions.cronHealthSummary", undefined, { isError: true });
    render(<SettingsStatusTab />);
    expect(within(scheduled()).getByText("Scheduled work could not be read; state unknown, not healthy.")).toBeTruthy();
    expect(screen.getByText(/scheduled work/, { selector: "p" })).toBeTruthy();
    expect(screen.queryByText("All clear.")).toBeNull();
  });
});

describe("ShopDriver HQ", () => {
  it("(h) the static Autonomous Operations catalog is gone; one line points at Status and Open Status opens it", async () => {
    window.history.replaceState({}, "", "/admin?tab=settings&settingsTab=shopdriver");
    set("nickActions.cronHealthSummary", SUMMARY);
    set("featureFlags.list", []);
    render(<SettingsSection />);
    expect(screen.queryByText("Autonomous Operations")).toBeNull();
    expect(screen.getByText("Scheduled work (5 jobs in the last 24 h) is on the Status tab.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Status" }));
    });
    expect(new URL(window.location.href).searchParams.get("settingsTab")).toBe("status");
  });

  it("(h2) while the count is loading the line carries no number", () => {
    window.history.replaceState({}, "", "/admin?tab=settings&settingsTab=shopdriver");
    set("nickActions.cronHealthSummary", undefined, { isLoading: true });
    set("featureFlags.list", []);
    render(<SettingsSection />);
    expect(screen.getByText("Scheduled work is on the Status tab.")).toBeTruthy();
  });
});

describe("DeclinedRecoveryPanel renders the server's one state", () => {
  const BASE = { featureEnabled: true, sendsEnabled: false, paused: false, lastRun: null, eligible: 29, recoverableDollars: 25613, next7dSends: 8, next30dSends: 17, dryRun: false };

  it("(i) shadow never says live", () => {
    set("shopdriver.declinedRecoveryStatus", { ...BASE, state: "shadow" });
    const { container } = render(<DeclinedRecoveryPanel />);
    expect(container.textContent).not.toMatch(/\blive\b/i);
    expect(screen.getByText("Declined-work recovery · shadow")).toBeTruthy();
    expect(screen.getByText("Counts only. Nothing sends until the send lane is enabled.")).toBeTruthy();
  });

  it("(i2) live says live with its last run", () => {
    set("shopdriver.declinedRecoveryStatus", {
      ...BASE,
      sendsEnabled: true,
      state: "live",
      lastRun: { jobName: "alg-declined-work-recovery", at: ago(2 * 60 * MIN), status: "completed", details: "sent 3", recordsProcessed: 3 },
    });
    render(<DeclinedRecoveryPanel />);
    expect(screen.getByText("Declined-work recovery · live")).toBeTruthy();
    expect(screen.getByText("Sends on · last run 2h ago: 3 processed")).toBeTruthy();
  });

  it("(i3) unknown says the switch could not be read; a null count is not 0", () => {
    set("shopdriver.declinedRecoveryStatus", { ...BASE, state: "unknown", paused: null, eligible: null, recoverableDollars: null });
    const { container } = render(<DeclinedRecoveryPanel />);
    expect(screen.getByText("The pause switch could not be read; whether it sends is unknown.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$0\b/);
  });
});

describe("FeatureFlagsPanel: pause switches first, as Running / Paused", () => {
  const FLAGS = [FLAG_RUNNING, FLAG_PAUSED, FLAG_ON, FLAG_OFF];

  it("(j) a running switch pauses in one tap with no confirm", () => {
    set("featureFlags.list", FLAGS);
    render(<FeatureFlagsPanel />);
    const group = document.getElementById("pause-switches") as HTMLElement;
    const row = within(group).getByText("Automated customer texts").closest("[data-switch]") as HTMLElement;
    expect(within(row).getByText("Running")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Pause" }));
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.calls).toEqual([{ path: "featureFlags.toggle", input: { key: "sms_global_pause", value: true } }]);
  });

  it("(j2) Resume asks first and only then flips the switch off", async () => {
    set("featureFlags.list", FLAGS);
    render(<FeatureFlagsPanel />);
    const group = document.getElementById("pause-switches") as HTMLElement;
    const row = within(group).getByText("Instagram autopost").closest("[data-switch]") as HTMLElement;
    expect(within(row).getByText("Paused")).toBeTruthy();
    expect(within(row).getByText("changed Oct 20 by owner@example.test")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Resume" }));
    });
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect((h.confirm.mock.calls[0] as unknown as [{ title: string }])[0].title).toBe("Resume Instagram autopost?");
    expect(h.calls).toEqual([{ path: "featureFlags.toggle", input: { key: "ig_autopost_paused", value: false } }]);
  });

  it("(j3) a declined Resume flips nothing", async () => {
    h.confirm.mockImplementation(async () => false);
    set("featureFlags.list", FLAGS);
    render(<FeatureFlagsPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    });
    expect(h.calls).toEqual([]);
  });

  it("(j4) the header counts switches apart from features, and on/off never lists a switch", () => {
    set("featureFlags.list", FLAGS);
    render(<FeatureFlagsPanel />);
    expect(screen.getByText("1 feature on · 1 off · 1 of 2 pause switches paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "on" }));
    expect(screen.queryByText("Automated customer texts")).toBeNull();
    expect(screen.getByText("sms_blast_enabled")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "switches" }));
    expect(screen.getByText("Automated customer texts")).toBeTruthy();
    expect(screen.queryByText("sms_blast_enabled")).toBeNull();
  });
});

describe("Integrations and System Health", () => {
  it("(k) the vendor bar names what is not connected without expanding", () => {
    const connected = Array.from({ length: 8 }, (_, i) => ({ name: `Vendor ${i + 1}`, status: "connected", details: "OK" }));
    set("adminDashboard.syncHealth", {
      overallStatus: "degraded",
      checkedAt: ago(0),
      checks: [...connected, { name: "Sheets", status: "degraded", details: "slow" }, { name: "Twilio", status: "disconnected", details: "FAIL" }],
    });
    render(<IntegrationsSection />);
    expect(screen.getByText("Not connected: Sheets (degraded), Twilio")).toBeTruthy();
  });

  it("(k2) nothing is listed when every vendor is connected", () => {
    set("adminDashboard.syncHealth", { overallStatus: "all_systems_operational", checkedAt: ago(0), checks: [{ name: "Sheets", status: "connected", details: "OK" }] });
    render(<IntegrationsSection />);
    expect(screen.queryByText(/Not connected:/)).toBeNull();
  });

  const HEALTH = {
    domains: [],
    sitemapPageCount: 0,
    totalBlogPosts: 0,
    hardcodedBlogPosts: 0,
    dynamicBlogPosts: 0,
    indexedPages: 0,
    notIndexedPages: 0,
    crawledNotIndexed: 0,
    discoveredNotIndexed: 0,
    sheetsConfigured: false,
    sheetsUrl: null,
  };
  const failure = (id: number, daysAgo: number) => ({
    id,
    failureType: "sms_daily_limit",
    entityType: "lead",
    entityId: null,
    message: "Daily limit reached",
    leadAffecting: true,
    resolved: false,
    createdAt: ago(daysAgo * DAY),
  });

  it("(l) a 60-day-old failure hides behind Show older and the banner is amber, not red", () => {
    set("adminDashboard.siteHealth", HEALTH);
    set("adminDashboard.integrationFailures", {
      readable: true,
      failures: [failure(1, 60)],
      counts: { recent: 1, unresolved: 1, leadAffectingUnresolved: 1, byType: { sms_daily_limit: 1 } },
    });
    render(<SiteHealthSection />);
    expect(screen.queryByText(/a lead may have been lost/)).toBeNull();
    expect(screen.queryByText("Daily limit reached")).toBeNull();
    const banner = screen.getByText(/No lead-affecting failures in the last 30 days/);
    expect(banner.textContent).toContain("1 older unresolved row hidden");
    expect(banner.className).toMatch(/amber/);
    expect(banner.className).not.toMatch(/red/);
    fireEvent.click(screen.getByRole("button", { name: /^Show 1 older \(before / }));
    expect(screen.getByText("Daily limit reached")).toBeTruthy();
  });

  it("(l2) a failure inside 30 days still raises the red banner", () => {
    set("adminDashboard.siteHealth", HEALTH);
    set("adminDashboard.integrationFailures", {
      readable: true,
      failures: [failure(2, 3), failure(1, 60)],
      counts: { recent: 2, unresolved: 2, leadAffectingUnresolved: 2, byType: { sms_daily_limit: 2 } },
    });
    render(<SiteHealthSection />);
    const banner = screen.getByText(/1 unresolved lead-affecting failure in the last 30 days: a lead may have been lost/);
    expect(banner.className).toMatch(/red/);
  });
});
