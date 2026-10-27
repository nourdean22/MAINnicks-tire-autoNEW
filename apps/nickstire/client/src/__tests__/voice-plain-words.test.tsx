/**
 * Voice Receptionist in plain words (job 2026-10-25-admin-tabs-voice, lane nickstire-client).
 *
 * Counter staff work this page. Five things it must do, each pinned here against the rendered section:
 *   1. Needs Attention splits the loaded queue at 48 hours: "Call back now" shows the fresh rows, older
 *      rows sit in a closed fold with a count and an age split, are mounted only while the fold is open,
 *      and are never described as done. The tab badge counts the fresh pending rows only.
 *   2. "All Caught Up!" is only for a truly empty list; fresh-empty with older rows says so in words.
 *   3. The call-reason chips are built from the loaded list and grouped by label, so "Other" is one chip
 *      whose filter matches every raw reason behind it; a loaded list shorter than the range says so.
 *   4. No engineering labels (versions, sources, classifier names, id column names) and no gamified card.
 *   5. An empty follow-up transfer destination reads "No number set", not "Anonymous".
 *
 * Mounts the real VoiceReceptionistSection with "@/lib/trpc" replaced by a proxy (same shape as
 * admin-w0-honesty.test.tsx) whose overrides may be a function of the query input, so the pending badge
 * query and the roster query can disagree. Only Date is faked, so no timer-driven code changes shape.
 * Fixtures are synthetic: names are "Test Caller ..." and numbers are (216) 555-01xx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean };
type Override = Partial<Q> | ((input: any) => Partial<Q>);

const h = vi.hoisted(() => ({
  queries: new Map<string, Override>(),
}));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => (input: unknown) => {
    const o = h.queries.get(path);
    return {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: () => {},
      isFetching: false,
      ...(typeof o === "function" ? o(input) : o),
    };
  };
  const mutation = () => () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isSuccess: false, reset: () => {} });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery") return query(path);
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
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: vi.fn(async () => true), default: () => null }));
// jsdom gives ResponsiveContainer no width, so the bars never render. Print the chart data as a list instead.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ data }: { data: { name: string; value: number }[] }) => (
    <ul data-testid="outcome-chart">{data.map((d) => <li key={d.name}>{`${d.name}: ${d.value}`}</li>)}</ul>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

import VoiceReceptionistSection from "@/pages/admin/VoiceReceptionistSection";
import * as voiceFormat from "@/pages/admin/voice/format";

const NOW = new Date("2026-10-27T18:00:00Z");
const hoursAgo = (hrs: number) => new Date(NOW.getTime() - hrs * 3_600_000).toISOString();

const FAILED: Partial<Q> = { data: undefined, isError: true, error: new Error("read failed") };
const ok = (data: unknown): Partial<Q> => ({ data, isError: false });

let nextId = 1;
function queueItem(label: string, ageHours: number, extra: Record<string, unknown> = {}) {
  const id = nextId++;
  return {
    id, vapiCallId: `call-${id}`, phoneNumber: "+12165550101", customerName: `Test Caller ${label}`, durationSeconds: null,
    endedReason: null, aiSummary: null, evalScore: null, evalOutcome: "callback_needed", createdAt: hoursAgo(ageHours),
    intents: [], queueStatus: "pending", queueUrgency: 50, priorityScore: 50, isRepeatCaller: false, notes: "",
    episodeKey: `ep-${id}`, contactCount: 1, callIds: [id], firstCallAt: hoursAgo(ageHours), ageMinutes: ageHours * 60,
    intentFamily: "tires", lane: "recovery", slaMinutes: 60, slaBreached: true, priorityReasons: [], demand: null,
    transferFailed: false,
    ...extra,
  };
}

/** Six pending rows: three inside 48 hours, three outside (49 h, 10 days, 40 days). */
const SIX = () => [
  queueItem("2h", 2),
  queueItem("30h", 30),
  queueItem("47h", 47),
  queueItem("49h", 49),
  queueItem("10d", 10 * 24),
  queueItem("40d", 40 * 24),
];

/** The queue read answers by status: pending rows, reviewed rows, or a failed read. */
function setQueue(by: { pending?: unknown[]; reviewed?: unknown[]; failPending?: boolean }) {
  h.queries.set("vapi.getMissedRevenueQueue", (input: { status: string }) => {
    if (input.status === "pending") return by.failPending ? FAILED : ok(by.pending ?? []);
    if (input.status === "reviewed") return ok(by.reviewed ?? []);
    return ok([]);
  });
}

const SUMMARY = {
  windowDays: 90, sourceCallCount: 3245, needsAttention: 1334, slaBreached: 1315, laneCounts: {}, exclusionCounts: {},
  unclassified: 0, transferConnect: { attempted: 0 }, transferAgreement: null,
};

function call(n: number, reason: string | null) {
  return {
    id: `c-${n}`, type: "inboundPhoneCall", createdAt: hoursAgo(n), durationSeconds: 60 + n, endedReason: reason,
    customerNumber: "+12165550102", customerName: `Test Call ${n}`, summary: null, successEvaluation: null, evalOutcome: null,
  };
}

const METRICS = {
  ok: true, total: 366, inbound: 366, outbound: 0, web: 0, forwarded: 183, customerEnded: 157, assistantEnded: 1,
  totalSeconds: 100, avgSeconds: 10,
  // Counts over the whole range, per RAW reason. Five of them map to the label "Other".
  endReasons: {
    "assistant-forwarded-call": 183, "customer-ended-call": 157, "assistant-ended-call": 1, "silence-timed-out": 11,
    "assistant-error": 6, unknown: 2, "exceeded-max-duration": 1, "phone-call-provider-closed-websocket": 5,
  },
  validConversationsCount: 100, hardConversionsCount: 3, walkInDirectedCount: 5, actionableOutcomesCount: 20,
  legacyConversionRate: 1, revisedHardConversionRate: 1, actionableRate: 6, avgScore: null,
  transferEvidence: { reliable: false, forwards: 4, classifiable: 2, redialed: 0, quiet: 0, failedTransfers: 0, redialRate: 0 },
  weeklyTrend: [], outcomeBreakdown: { hard_conversion: 3, unknown: 2, Unknown: 1 }, intentDistribution: [],
};

/** Eight loaded calls: forwarded x2, caller closed x1, and five raw reasons that all read "Other". */
const LOADED_CALLS = () => [
  call(1, "assistant-forwarded-call"),
  call(2, "assistant-forwarded-call"),
  call(3, "customer-ended-call"),
  call(4, "silence-timed-out"),
  call(5, "assistant-error"),
  call(6, "exceeded-max-duration"),
  call(7, "phone-call-provider-closed-websocket"),
  call(8, null),
];

const SCORECARD = {
  metricDefinitionVersion: "revenue-ops-v1", source: "vapi_call_logs", dataAsOf: "2026-10-27T21:22:50Z",
  counts: {
    totalInboundRecords: 37, versionedCalls: 8, legacyUnversioned: 29, qualifiedServiceInquiries: 74, leadsCreated: 0,
    callbacksCreated: 0, bookingsCreated: 0, walkInsDirected: 3, paidInvoicesVerified: 0,
  },
  quality: { average: null, scoredCalls: 0 },
  rates: {
    qualifiedToLead: { numerator: 0, denominator: 74, percent: 0 },
    qualifiedToBooking: { numerator: 0, denominator: 74, percent: 0 },
    technicalFailure: { numerator: 0, denominator: 74, percent: 0 },
  },
  evaluation: { oldestUnversionedAt: hoursAgo(5), evalCadenceHours: 24 },
};

const ACHIEVEMENTS = { totalCalls: 5480, totalResolved: 1621, totalReachedTool: 100, totalAfterHours: 100, totalExemplary: 2686, totalDuration: 272580 };

function openTab(tab: "queue" | "performance") {
  window.history.replaceState({}, "", tab === "queue" ? "/admin?voiceTab=queue" : "/admin");
}

/** The pending badge sits inside the Needs Attention tab button. */
const tabButton = () => screen.getByRole("button", { name: /Needs Attention/ });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  h.queries.clear();
  nextId = 1;
  window.history.replaceState({}, "", "/admin");
  h.queries.set("vapi.getRecoveryQueueSummary", ok(SUMMARY));
});
afterEach(() => {
  vi.useRealTimers();
  h.queries.clear();
});

describe("Needs Attention: call back now, older kept apart", () => {
  it("shows the last 48 hours as Call back now and folds the rest, closed, with the age split in words", () => {
    openTab("queue");
    setQueue({ pending: SIX() });
    render(<VoiceReceptionistSection />);

    const heading = screen.getByRole("heading", { name: /Call back now/ });
    expect(heading.textContent).toMatch(/3/);
    for (const label of ["2h", "30h", "47h"]) expect(screen.getByText(`Test Caller ${label}`), label).toBeTruthy();

    const fold = document.querySelector("details") as HTMLDetailsElement;
    expect(fold, "a native <details> fold").toBeTruthy();
    expect(fold.hasAttribute("open")).toBe(false);
    const summary = within(fold).getByText(/Older than 2 days: 3/).closest("summary") as HTMLElement;
    expect(summary.textContent).toContain("2 to 7 days 1 · 7 to 30 days 1 · 30 to 90 days 1");
    expect(summary.textContent).toContain("Not deleted and not counted as done. Open to review them.");

    // Older cards are not mounted while the fold is closed.
    for (const label of ["49h", "10d", "40d"]) expect(screen.queryByText(`Test Caller ${label}`), label).toBeNull();

    fireEvent.click(summary);
    expect(fold.hasAttribute("open")).toBe(true);
    for (const label of ["49h", "10d", "40d"]) {
      expect(within(fold).getByText(`Test Caller ${label}`), label).toBeTruthy();
    }
    // Fresh cards never move into the fold.
    expect(screen.getByText("Test Caller 2h").closest("details")).toBeNull();

    fireEvent.click(summary);
    expect(fold.hasAttribute("open")).toBe(false);
    expect(screen.queryByText("Test Caller 40d")).toBeNull();
  });

  it("cuts at exactly 48 hours: 47.9 is fresh, 48 is older (an unreadable age stays visible)", () => {
    expect(typeof voiceFormat.splitQueueByAge).toBe("function");
    const rows = [
      { createdAt: hoursAgo(47.9) },
      { createdAt: hoursAgo(48) },
      { createdAt: null },
      { createdAt: "not a date" },
    ];
    const { fresh, older } = voiceFormat.splitQueueByAge(rows, NOW.getTime());
    expect(fresh).toEqual([rows[0], rows[2], rows[3]]);
    expect(older).toEqual([rows[1]]);
  });

  it("the tab badge counts the fresh pending rows only, and a failed pending read keeps the ? badge", () => {
    setQueue({ pending: SIX() });
    const { unmount } = render(<VoiceReceptionistSection />);
    expect(within(tabButton()).getByText("3")).toBeTruthy();
    expect(tabButton().textContent).not.toContain("6");
    unmount();

    // Only older rows pending: no number at all.
    setQueue({ pending: [queueItem("10d", 10 * 24), queueItem("40d", 40 * 24)] });
    const second = render(<VoiceReceptionistSection />);
    expect(tabButton().textContent).toBe("Needs Attention");
    second.unmount();

    setQueue({ failPending: true });
    render(<VoiceReceptionistSection />);
    expect(within(tabButton()).getByText("?")).toBeTruthy();
  });

  it("says no one from the last 2 days is waiting while older rows exist; All Caught Up only when the list is empty", () => {
    openTab("queue");
    setQueue({ pending: [queueItem("10d", 10 * 24), queueItem("40d", 40 * 24)] });
    const { unmount } = render(<VoiceReceptionistSection />);
    expect(screen.getByText("No one from the last 2 days is waiting.")).toBeTruthy();
    expect(screen.queryByText("All Caught Up!")).toBeNull();
    expect(screen.getByText(/Older than 2 days: 2/)).toBeTruthy();
    unmount();

    setQueue({ pending: [] });
    render(<VoiceReceptionistSection />);
    expect(screen.getByText("All Caught Up!")).toBeTruthy();
    expect(screen.queryByText("No one from the last 2 days is waiting.")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
  });

  it("a failed queue read is not caught up and not empty", () => {
    openTab("queue");
    setQueue({ failPending: true });
    render(<VoiceReceptionistSection />);
    expect(screen.getByText("Queue unreadable")).toBeTruthy();
    expect(screen.queryByText("All Caught Up!")).toBeNull();
    expect(screen.queryByText("No one from the last 2 days is waiting.")).toBeNull();
  });

  it("the summary leads with the fresh count, then the older count, then the 90-day breakdown with its window", () => {
    openTab("queue");
    setQueue({ pending: SIX() });
    render(<VoiceReceptionistSection />);
    const lead = screen.getByText("to call back now (last 2 days)").parentElement as HTMLElement;
    expect(lead.textContent).toMatch(/3\s*to call back now \(last 2 days\)/);
    expect(lead.textContent).toContain("3 older");
    const card = lead.parentElement as HTMLElement;
    expect(card.textContent).toContain("Needs attention, last 90 days");
    expect(card.textContent).toContain("1334");
    expect(card.textContent).toContain("1315 past its response target");
    // Order: the fresh line comes before the 90-day figure.
    expect(card.textContent!.indexOf("to call back now")).toBeLessThan(card.textContent!.indexOf("Needs attention, last 90 days"));
  });

  it("a failed pending read leaves the lead line unknown, not zero", () => {
    openTab("queue");
    setQueue({ failPending: true });
    render(<VoiceReceptionistSection />);
    expect(screen.getByText(/Callbacks due now: unknown/)).toBeTruthy();
    expect(screen.queryByText("to call back now (last 2 days)")).toBeNull();
  });

  it("applies the same split to another status, while the badge still counts pending", () => {
    openTab("queue");
    setQueue({ pending: SIX(), reviewed: [queueItem("rev-5h", 5, { queueStatus: "reviewed" }), queueItem("rev-20d", 20 * 24, { queueStatus: "reviewed" })] });
    render(<VoiceReceptionistSection />);
    // Open the pending fold first: a fold left open would mount every older row of the next status at once.
    fireEvent.click(screen.getByText(/Older than 2 days: 3/));
    expect(screen.getByText("Test Caller 40d")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "REVIEWED" }));
    expect(screen.getByText("Test Caller rev-5h")).toBeTruthy();
    expect(screen.queryByText("Test Caller rev-20d")).toBeNull();
    expect(screen.getByText(/Older than 2 days: 1/)).toBeTruthy();
    expect((document.querySelector("details") as HTMLDetailsElement).hasAttribute("open")).toBe(false);
    expect(screen.queryByText("Test Caller 2h")).toBeNull();
  });

  it("fold summaries are at least 48 x 48 px", () => {
    openTab("queue");
    setQueue({ pending: SIX() });
    render(<VoiceReceptionistSection />);
    const summary = document.querySelector("details > summary") as HTMLElement;
    expect(summary, "a fold summary to measure").toBeTruthy();
    expect(summary.className).toMatch(/\bmin-h-12\b/);
    expect(summary.className).toMatch(/\bmin-w-12\b/);
  });
});

describe("Calls: one chip per label, counts from the loaded list", () => {
  function mountCalls(calls: unknown[] = LOADED_CALLS(), metrics: Record<string, unknown> = METRICS) {
    h.queries.set("vapi.todayCalls", ok(calls));
    h.queries.set("vapi.todayMetrics", ok(metrics));
    return render(<VoiceReceptionistSection />);
  }
  const chipRow = () => screen.getByText("Filter:").parentElement as HTMLElement;
  const chipLabels = () => Array.from(chipRow().querySelectorAll("button")).map((b) => b.textContent);

  it("builds one Other chip whose count and filter cover every raw reason behind it", () => {
    mountCalls();
    expect(chipLabels()).toEqual(["All8", "Other5", "Forwarded2", "Caller closed1"]);

    fireEvent.click(within(chipRow()).getByRole("button", { name: /^Other/ }));
    for (const n of [4, 5, 6, 7, 8]) expect(screen.getByText(`Test Call ${n}`), `call ${n}`).toBeTruthy();
    for (const n of [1, 2, 3]) expect(screen.queryByText(`Test Call ${n}`), `call ${n}`).toBeNull();

    // Same chip again clears the filter; a different label switches to it.
    fireEvent.click(within(chipRow()).getByRole("button", { name: /^Forwarded/ }));
    expect(screen.getByText("Test Call 1")).toBeTruthy();
    expect(screen.queryByText("Test Call 4")).toBeNull();
  });

  it("chip counts add up to All, because the metrics totals are not used", () => {
    mountCalls();
    const counts = Array.from(chipRow().querySelectorAll("button")).map((b) => Number(b.textContent!.replace(/\D+/g, "")));
    const [all, ...rest] = counts;
    expect(rest.reduce((a, b) => a + b, 0)).toBe(all);
    // The range-wide forwarded count (183) never reaches a chip.
    expect(chipRow().textContent).not.toMatch(/183|157/);
  });

  it("says the list is the newest N of M when the loaded list is shorter than the range", () => {
    mountCalls();
    expect(screen.getByText("Showing the newest 8 of 366 calls in the last 7 days.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("Showing the newest 8 of 366 calls today.")).toBeTruthy();
  });

  it("stays quiet when the whole range is loaded, and counts the list's own population (inbound), not outbound", () => {
    const { unmount } = mountCalls(LOADED_CALLS(), { ...METRICS, total: 8, inbound: 8 });
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
    unmount();
    // 20 rows in the range, 12 of them outbound campaign calls the list never carries: nothing was cut off.
    mountCalls(LOADED_CALLS(), { ...METRICS, total: 20, inbound: 8, outbound: 12 });
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });

  it("the Outcome Taxonomy chart sums counts that share a label", () => {
    mountCalls();
    const chart = screen.getByTestId("outcome-chart");
    expect(within(chart).getByText("Unknown: 3")).toBeTruthy();
    expect(within(chart).getByText("Hard Conversion: 3")).toBeTruthy();
    expect(within(chart).queryByText("Unknown: 2")).toBeNull();
  });

  it("chips and Reset filters are at least 48 x 48 px", () => {
    mountCalls();
    for (const chip of Array.from(chipRow().querySelectorAll("button"))) {
      expect(chip.className, chip.textContent ?? "").toMatch(/\bmin-h-12\b/);
      expect(chip.className, chip.textContent ?? "").toMatch(/\bmin-w-12\b/);
    }
    fireEvent.click(within(chipRow()).getByRole("button", { name: /^Other/ }));
    const reset = screen.getByRole("button", { name: "Reset filters" });
    expect(reset.className).toMatch(/\bmin-h-12\b/);
    expect(reset.className).toMatch(/\bmin-w-12\b/);
  });
});

describe("Plain words on the page", () => {
  it("prints no engineering labels and no gamified card, and says what it means instead", () => {
    h.queries.set("revenueOps.voiceScorecard", ok(SCORECARD));
    h.queries.set("vapi.activeCallStates", ok({ count: 0, byState: {} }));
    h.queries.set("vapi.achievements", ok(ACHIEVEMENTS));
    h.queries.set("vapi.todayMetrics", ok(METRICS));
    h.queries.set("vapi.todayCalls", ok(LOADED_CALLS()));
    const { container } = render(<VoiceReceptionistSection />);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/Version|Versioned|revenue-ops|vapi_call_logs|classifier-v2|leadId|callbackId|bookingId|\bv1\b/);
    expect(text).not.toMatch(/\bLVL\b|\bXP\b|streak|Silver Tongue|Night Watchman|Off-Counter Relief|Protector|Hours Saved|Achievements/i);

    expect(screen.getByText("Today so far")).toBeTruthy();
    expect(text).toMatch(/Updated \d{1,2}:\d{2}\s[AP]M/);
    expect(text).toContain("8 scored, 29 not scored yet");
    expect(text).toContain("the AI's read of the call");
    expect(text).toContain("(a lead, callback or booking was saved)");
    // Numbers are untouched.
    expect(text).toContain("0% of 74 qualified calls");
  });

  it("keeps the unknown state of the update time, and the behind-schedule alarm, in words", () => {
    h.queries.set("revenueOps.voiceScorecard", ok({
      ...SCORECARD,
      dataAsOf: null,
      counts: { ...SCORECARD.counts, versionedCalls: 0 },
      rates: { ...SCORECARD.rates, qualifiedToLead: { numerator: 0, denominator: 0, percent: null } },
      evaluation: { oldestUnversionedAt: hoursAgo(100), evalCadenceHours: 24 },
    }));
    h.queries.set("vapi.activeCallStates", ok({ count: 0, byState: {} }));
    const { container } = render(<VoiceReceptionistSection />);
    expect(container.textContent).toContain("Update time not available");
    expect(container.textContent).toContain("Evaluations behind");
    expect(container.textContent).toContain("0 scored, 29 not scored");
    expect(container.textContent).toContain("0/0 · too few calls for a percent");
    expect(container.textContent).not.toMatch(/denominator|Updated Invalid/);
  });

  it("an empty follow-up transfer number reads No number set; a real number still prints", () => {
    h.queries.set("vapi.getFollowUpTransferDestination", ok({ ok: true, isShopLandline: false, currentNumber: "" }));
    const { unmount } = render(<VoiceReceptionistSection />);
    expect(screen.getByText("No number set")).toBeTruthy();
    expect(screen.queryByText("Anonymous")).toBeNull();
    // The chip and the reset button work as before.
    expect(screen.getByText("Off shop number")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset to shop" })).toBeTruthy();
    unmount();

    h.queries.set("vapi.getFollowUpTransferDestination", ok({ ok: true, isShopLandline: false, currentNumber: "+12165550123" }));
    render(<VoiceReceptionistSection />);
    expect(screen.getByText("(216) 555-0123")).toBeTruthy();
    expect(screen.queryByText("No number set")).toBeNull();
  });
});

describe("Codex round 1 on PR 3334", () => {
  it("the fold under a finished status does not call its rows unfinished", () => {
    openTab("queue");
    setQueue({ pending: SIX(), reviewed: [queueItem("rev-20d", 20 * 24, { queueStatus: "reviewed" })] });
    render(<VoiceReceptionistSection />);
    fireEvent.click(screen.getByRole("button", { name: "REVIEWED" }));
    const summary = screen.getByText(/Older than 2 days: 1/).closest("summary") as HTMLElement;
    expect(summary.textContent).not.toContain("not counted as done");
    expect(summary.textContent).toContain("Open to see them.");
  });

  it("a failed pending re-read that still holds the last rows shows unknown, not the old counts", () => {
    openTab("queue");
    h.queries.set("vapi.getMissedRevenueQueue", (input: { status: string }) =>
      input.status === "pending" ? { data: SIX(), isError: true, error: new Error("refetch failed") } : ok([]),
    );
    render(<VoiceReceptionistSection />);
    expect(screen.getByText(/Callbacks due now: unknown/)).toBeTruthy();
    expect(screen.queryByText("to call back now (last 2 days)")).toBeNull();
  });

  it("splits on the server's ageMinutes, not the device clock, and falls back to createdAt only without it", () => {
    const rows = [
      { createdAt: hoursAgo(1), ageMinutes: 50 * 60 },
      { createdAt: hoursAgo(60), ageMinutes: 30 },
      { createdAt: hoursAgo(60) },
    ];
    const { fresh, older } = voiceFormat.splitQueueByAge(rows, NOW.getTime());
    expect(fresh).toEqual([rows[1]]);
    expect(older).toEqual([rows[0], rows[2]]);
  });
});
