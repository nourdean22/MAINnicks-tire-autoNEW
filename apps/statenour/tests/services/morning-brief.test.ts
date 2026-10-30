/**
 * Morning Brief composer · v10.0.526 · Arc C Feature 5
 *
 * Coverage:
 *   1. Personal slice (base behavior preserved)
 *   2. Shop slice when bridge is fresh
 *   3. Shop slice graceful skip when bridge is stale + no failed crons
 *   4. Shop slice keeps failed-cron line even when bridge is stale
 *   5. Wellbeing slice when logs + body data exist
 *   6. Wellbeing slice graceful skip when no data at all
 *   7. Combined output stitches all three slices with separators
 *   8. Backward compat: top-level fields stay populated from personal
 *   9. Wisdom-of-the-day is deterministic by date
 *   10. Empty bridge + empty failed crons → no shop section in text
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  task: { findMany: vi.fn(), count: vi.fn() },
  commitment: { findMany: vi.fn() },
  auditEvent: { findFirst: vi.fn() },
  cronJobLog: { count: vi.fn(), findMany: vi.fn() },
  personalDailyLog: { findMany: vi.fn() },
  bodyTracking: { findMany: vi.fn() },
  brainMemory: { findMany: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    commitment: mocks.commitment,
    auditEvent: mocks.auditEvent,
    cronJobLog: mocks.cronJobLog,
    personalDailyLog: mocks.personalDailyLog,
    bodyTracking: mocks.bodyTracking,
    brainMemory: mocks.brainMemory,
  },
}));

vi.mock("@/lib/services/calendar-api", () => ({
  listEvents: vi.fn().mockResolvedValue([]),
}));

// 2026-07-30 · buildAnticipatedSlice now RETHROWS on failure (so the
// slice-level failedSlice marker fires) instead of silently returning
// empty. Un-mocked, its dynamic import fails in this env — the old
// tests passed only because that failure was swallowed. Mock the happy
// "nothing anticipated" path; the marker contract has its own test.
vi.mock("@/lib/brain/anticipated-questions", () => ({
  getTodaysAnticipated: vi.fn().mockResolvedValue(null),
}));

// The lot brief (camera audit N4) reaches nickstire over the bridge; never the network here.
const lotBridge = vi.hoisted(() => ({ queryNick: vi.fn() }));
vi.mock("@/lib/nickstire/query", () => ({ queryNick: lotBridge.queryNick }));
const QUIET_LOT_LINE =
  "Thursday: 14 cars came in, in line with recent Thursdays (camera watched 92% of business hours).";
const QUIET_LOT = {
  query: "lot_brief",
  timestamp: "2026-10-16T11:00:00.000Z",
  data: { ok: true, date: "2026-10-15", lines: [QUIET_LOT_LINE], events: [], coverage: { pctExpected: 0.92 } },
};

// 2026-10-22 · the weekly "What you're not seeing" section: Mondays + NICK_WEEKLY_GAP_NOTE only.
const weekly = vi.hoisted(() => ({ flagOn: false, weekday: 3 as number | null, build: vi.fn(), load: vi.fn(async () => {}) }));
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return {
    ...actual,
    loadFeatureFlagOverrides: weekly.load,
    getFlag: (key: string) => ({ key, isOn: key === "NICK_WEEKLY_GAP_NOTE" ? weekly.flagOn : false }),
  };
});
vi.mock("@/lib/utils/datetime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/datetime")>();
  return { ...actual, weekdayET: (...a: Parameters<typeof actual.weekdayET>) => weekly.weekday ?? actual.weekdayET(...a) };
});
vi.mock("@/lib/services/not-seeing-note", () => ({ buildNotSeeingSlice: weekly.build }));
const maximCtl = vi.hoisted(() => ({ pick: null as null | ((tag: string, seed: string) => unknown) }));
vi.mock("@/lib/brain/maxims", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/maxims")>();
  return { ...actual, pickMaxim: (tag: string, seed: string) => (maximCtl.pick ? maximCtl.pick(tag, seed) : actual.pickMaxim(tag, seed)) };
});

import { buildMorningBrief, readLotBriefLines } from "@/lib/services/morning-brief";

let mockDriftEvents: any[] = [];
let mockWisdomEvents: any[] = [];
let mockDecisionReplays: any[] = [];

function resetMocks() {
  vi.clearAllMocks();
  mockDriftEvents = [];
  mockWisdomEvents = [];
  mockDecisionReplays = [];

  mocks.task.findMany.mockResolvedValue([]);
  mocks.task.count.mockResolvedValue(0);
  mocks.commitment.findMany.mockResolvedValue([]);
  mocks.auditEvent.findFirst.mockResolvedValue(null);
  mocks.cronJobLog.count.mockResolvedValue(0);
  mocks.cronJobLog.findMany.mockResolvedValue([]);
  mocks.personalDailyLog.findMany.mockResolvedValue([]);
  mocks.bodyTracking.findMany.mockResolvedValue([]);
  mocks.brainMemory.update.mockResolvedValue({});
  lotBridge.queryNick.mockResolvedValue(QUIET_LOT);

  mocks.brainMemory.findMany.mockImplementation(async (args: any) => {
    const where = args?.where || {};
    const category = where.category || where.active?.category;
    if (category === "coach_event") {
      return mockDriftEvents;
    }
    if (category === "wisdom" || category === "WISDOM") {
      return mockWisdomEvents;
    }
    if (category === "decision_replay_due") {
      return mockDecisionReplays;
    }
    return [];
  });
}

describe("Morning Brief · v10.0.526 multi-slice composer", () => {
  beforeEach(() => {
    resetMocks();
  });

  // 1 ─────────────────────────────────────────────────────────────
  it("personal slice · emits drift + top task + open-task count", async () => {
    mockDriftEvents = [{ metadata: { priority: "P1" } }];
    mocks.task.findMany.mockResolvedValue([
      { title: "Old title", nextPhysicalAction: "Call Mike about ALG" },
    ]);
    mocks.task.count.mockResolvedValue(7);

    const brief = await buildMorningBrief();

    expect(brief.drift).toBe("ALERT");
    expect(brief.topTask).toBe("Call Mike about ALG");
    expect(brief.taskCount).toBe(7);
    expect(brief.text).toContain("Drift: <b>ALERT</b>");
    expect(brief.text).toContain("Top: Call Mike about ALG");
    expect(brief.text).toContain("Open tasks: 7");
  });

  // 2 ─────────────────────────────────────────────────────────────
  it("shop slice · emits when bridge is fresh", async () => {
    mocks.auditEvent.findFirst.mockResolvedValue({
      createdAt: new Date(), // fresh · now
      payload: {
        lineOfCars: 8,
        revenue: { yesterday: 2400, dailyTarget: 3000 },
        declinedWork: {
          count: 12,
          countYesterday: 10,
          value: 14500,
          topByScore: [
            { customerName: "Mike Smith" },
            { customerName: "Sarah Johnson" },
            { customerName: "Joe Brown" },
          ],
        },
        intelligence: { gbp: { new: 2, total: 187 } },
      },
    });

    const brief = await buildMorningBrief();
    const text = brief.text;

    expect(text).toContain("<b>Shop</b>");
    expect(text).toContain("Line of cars: 8");
    // formatMoney compacts numbers ≥ 1000 to "k".
    expect(text).toContain("Rev (yest): $2.4k");
    expect(text).toContain("80% of $3.0k target");
    expect(text).toContain("Declined work: 12 open (+2 vs yest)");
    expect(text).toContain("$14.5k");
    expect(text).toContain("Follow-ups: Mike Smith");
    expect(text).toContain("Sarah Johnson");
    expect(text).toContain("Reviews: +2 new · 187 total");

    const shopPayload = (brief.payload as { shop: Record<string, unknown> })
      .shop;
    expect(shopPayload.lineOfCars).toBe(8);
  });

  // 3 ─────────────────────────────────────────────────────────────
  it("shop slice · a stale bridge adds no context lines; the lot brief's one line still shows (camera audit N4)", async () => {
    mocks.auditEvent.findFirst.mockResolvedValue({
      // 30h ago · stale (>24h)
      createdAt: new Date(Date.now() - 30 * 60 * 60_000),
      payload: { lineOfCars: 99 },
    });
    mocks.cronJobLog.count.mockResolvedValue(0);

    const brief = await buildMorningBrief();
    expect(brief.text).not.toContain("Line of cars");
    expect(brief.text).toContain("<b>Shop</b>");
    expect(brief.text).toContain(`Lot · ${QUIET_LOT_LINE}`);

    const shopPayload = (brief.payload as { shop: Record<string, unknown> })
      .shop;
    expect(shopPayload.lineOfCars).toBeUndefined();
    expect(shopPayload.lot).toEqual({ ok: true, date: "2026-10-15", events: [], coveragePct: 0.92 });
  });

  it("shop slice · even a malformed lot reply is a line, never silence", async () => {
    mocks.auditEvent.findFirst.mockResolvedValue(null);
    mocks.cronJobLog.count.mockResolvedValue(0);
    // A reply nickstire could never send (ok with no lines) is still a line, not silence.
    lotBridge.queryNick.mockResolvedValue({ query: "lot_brief", timestamp: "t", data: { ok: true, lines: [] } });
    const brief = await buildMorningBrief();
    expect(brief.text).toContain("Lot · brief unavailable (the reply carried no lines)");
  });

  it("lot brief · asks nickstire for lot_brief with a bounded timeout and renders at most three lines, escaped", async () => {
    lotBridge.queryNick.mockResolvedValue({
      query: "lot_brief",
      timestamp: "t",
      data: {
        ok: true,
        date: "2026-10-15",
        lines: ["Busier than usual: <b>21</b> cars", "two", "three", "four"],
        events: [{ kind: "traffic_high", text: "x" }],
        coverage: { pctExpected: 0.9 },
      },
    });
    const brief = await buildMorningBrief();
    expect(lotBridge.queryNick).toHaveBeenCalledWith("lot_brief", {}, 8_000);
    expect(brief.text).toContain("Lot · Busier than usual: &lt;b&gt;21&lt;/b&gt; cars");
    expect(brief.text).toContain("Lot · three");
    expect(brief.text).not.toContain("Lot · four");
    const shopPayload = (brief.payload as { shop: Record<string, unknown> }).shop;
    expect(shopPayload.lot).toMatchObject({ ok: true, events: ["traffic_high"], coveragePct: 0.9 });
  });

  it("lot brief · a bridge that never answers costs ONE line after 12 s, not the brief (retries alone run ~35 s)", async () => {
    vi.useFakeTimers();
    try {
      lotBridge.queryNick.mockReturnValue(new Promise(() => {}));
      const pending = readLotBriefLines();
      await vi.advanceTimersByTimeAsync(11_999);
      let settled = false;
      void pending.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const slice = await pending;
      expect(slice.lines).toEqual(["<i>Lot · brief unavailable (no reply within 12 s)</i>"]);
      expect(slice.payload).toEqual({ ok: false, error: "no reply within 12 s" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lot brief · a bridge failure and an ok:false reply are each ONE line saying so, never a quiet day", async () => {
    lotBridge.queryNick.mockResolvedValue({ error: "HTTP 500: boom", statusCode: 500 });
    const failed = await buildMorningBrief();
    expect(failed.text).toContain("Lot · brief unavailable (HTTP 500: boom)");
    expect(failed.text).not.toContain("in line with");

    lotBridge.queryNick.mockResolvedValue({ query: "lot_brief", timestamp: "t", data: { ok: false, error: "lot brief read failed (Error ER_LOCK_WAIT_TIMEOUT/1205)" } });
    const notOk = await buildMorningBrief();
    expect(notOk.text).toContain("Lot · brief unavailable (lot brief read failed (Error ER_LOCK_WAIT_TIMEOUT/1205))");
    const shopPayload = (notOk.payload as { shop: Record<string, unknown> }).shop;
    expect(shopPayload.lot).toMatchObject({ ok: false });

    lotBridge.queryNick.mockRejectedValue(new Error("socket hang up"));
    const thrown = await buildMorningBrief();
    expect(thrown.text).toContain("Lot · brief unavailable (socket hang up)");
    // A lot-brief failure is its own line, never the whole shop slice's.
    expect(thrown.text).not.toContain("Shop slice unavailable");
  });

  // 4 ─────────────────────────────────────────────────────────────
  it("shop slice · emits cron-failure line even when bridge is stale", async () => {
    mocks.auditEvent.findFirst.mockResolvedValue(null);
    mocks.cronJobLog.count.mockResolvedValue(3);
    mocks.cronJobLog.findMany.mockResolvedValue([
      { jobName: "alg-sync" },
      { jobName: "wisdom-distiller" },
      { jobName: "morning-brief" },
    ]);

    const brief = await buildMorningBrief();
    expect(brief.text).toContain("<b>Shop</b>");
    expect(brief.text).toContain("Failed crons (24h): <b>3</b>");
    expect(brief.text).toContain("alg-sync");
    expect(brief.text).toContain("wisdom-distiller");

    const shopPayload = (brief.payload as { shop: Record<string, unknown> })
      .shop;
    expect(shopPayload.failedCronCount).toBe(3);
  });

  // 5 ─────────────────────────────────────────────────────────────
  it("wellbeing slice · emits workout streak + weight delta + wisdom", async () => {
    const today = new Date("2026-05-12");
    mocks.personalDailyLog.findMany.mockResolvedValue([
      { logDate: new Date("2026-05-12"), workoutCompleted: true, sleepHours: 7.5 },
      { logDate: new Date("2026-05-11"), workoutCompleted: true, sleepHours: 8.0 },
      { logDate: new Date("2026-05-10"), workoutCompleted: true, sleepHours: 7.2 },
      { logDate: new Date("2026-05-09"), workoutCompleted: false, sleepHours: 6.5 },
    ]);
    mocks.bodyTracking.findMany.mockResolvedValue([
      { date: "2026-05-12", weight: 180.5 },
      { date: "2026-05-08", weight: 182.0 },
    ]);
    mockWisdomEvents = [
      {
        id: "w1",
        content: "Compound interest is the eighth wonder of the world.",
        source: "wisdom_buffett_1",
      },
      {
        id: "w2",
        content: "Read 500 pages every day.",
        source: "wisdom_munger_3",
      },
    ];

    vi.setSystemTime(today);
    const brief = await buildMorningBrief();

    expect(brief.text).toContain("<b>Wellbeing</b>");
    expect(brief.text).toContain("Workout streak: <b>3d</b>");
    expect(brief.text).toContain("Sleep 7d avg:");
    expect(brief.text).toContain("Weight Δ: -1.5 lb");
    // Wisdom line · contains italic + a curated quote.
    expect(brief.text).toMatch(/<i>(Compound interest|Read 500 pages)/);

    vi.useRealTimers();
  });

  // 6 ─────────────────────────────────────────────────────────────
  it("wellbeing slice · skips silently when no log + no body data", async () => {
    mocks.personalDailyLog.findMany.mockResolvedValue([]);
    mocks.bodyTracking.findMany.mockResolvedValue([]);

    const brief = await buildMorningBrief();
    expect(brief.text).not.toContain("<b>Wellbeing</b>");

    const wb = (brief.payload as { wellbeing: Record<string, unknown> })
      .wellbeing;
    expect(Object.keys(wb)).toHaveLength(0);
  });

  // 7 ─────────────────────────────────────────────────────────────
  it("combined · stitches personal + shop + wellbeing with separators", async () => {
    mockDriftEvents = [{ metadata: { priority: "P2" } }];
    mocks.task.count.mockResolvedValue(3);
    mocks.auditEvent.findFirst.mockResolvedValue({
      createdAt: new Date(),
      payload: { lineOfCars: 5 },
    });
    mocks.personalDailyLog.findMany.mockResolvedValue([
      { logDate: new Date(), workoutCompleted: true, sleepHours: 7 },
    ]);
    mockWisdomEvents = [
      { id: "w1", content: "Stay hungry.", source: "wisdom_jobs_1" },
    ];

    const brief = await buildMorningBrief();
    const text = brief.text;

    // Header always first.
    expect(text.startsWith("<b>Brief ·")).toBe(true);
    // Slice separators between sections.
    const separatorCount = (text.match(/<i>· · ·<\/i>/g) || []).length;
    expect(separatorCount).toBe(2); // personal→shop, shop→wellbeing

    expect(text).toContain("Drift: <b>WARNING</b>");
    expect(text).toContain("<b>Shop</b>");
    expect(text).toContain("<b>Wellbeing</b>");
  });

  // 8 ─────────────────────────────────────────────────────────────
  it("backward compat · top-level flat fields keep working", async () => {
    mockDriftEvents = [];
    mocks.task.count.mockResolvedValue(4);
    mocks.commitment.findMany.mockResolvedValue([
      { id: "c1", description: "Email Brian about contract", deadline: null },
      { id: "c2", description: "Review draft", deadline: null },
    ]);

    const brief = await buildMorningBrief();

    expect(brief.drift).toBe("LOW");
    expect(brief.taskCount).toBe(4);
    expect(brief.unkeptCommitments).toBe(2);
    expect(brief.calendarConflicts).toBe(0);
    expect(brief.date).toBeTruthy();
    expect(typeof brief.text).toBe("string");
    expect(brief.payload).toHaveProperty("personal");
    expect(brief.payload).toHaveProperty("shop");
    expect(brief.payload).toHaveProperty("wellbeing");
  });

  // 9 ─────────────────────────────────────────────────────────────
  it("wisdom-of-the-day · deterministic by date", async () => {
    mocks.personalDailyLog.findMany.mockResolvedValue([
      { logDate: new Date(), workoutCompleted: true, sleepHours: 7 },
    ]);
    mockWisdomEvents = [
      { id: "w1", content: "Quote A.", source: "wisdom_buffett_1" },
      { id: "w2", content: "Quote B.", source: "wisdom_munger_3" },
      { id: "w3", content: "Quote C.", source: "wisdom_naval_2" },
    ];

    vi.setSystemTime(new Date("2026-05-12"));
    const brief1 = await buildMorningBrief();
    const brief2 = await buildMorningBrief();

    const wb1 = (brief1.payload as { wellbeing: { wisdomId?: string } })
      .wellbeing.wisdomId;
    const wb2 = (brief2.payload as { wellbeing: { wisdomId?: string } })
      .wellbeing.wisdomId;
    expect(wb1).toBeTruthy();
    expect(wb1).toBe(wb2);
    vi.useRealTimers();
  });

  // 10 ────────────────────────────────────────────────────────────
  it("HTML escape · user-supplied strings are escaped in top tasks and commits", async () => {
    mocks.task.findMany.mockResolvedValue([
      { title: "x", nextPhysicalAction: "Reply <script>alert(1)</script> & go" },
    ]);
    mocks.task.count.mockResolvedValue(1);
    mocks.commitment.findMany.mockResolvedValue([
      { id: "c1", description: "Tell <b>Mike</b> & confirm", deadline: null },
    ]);

    const brief = await buildMorningBrief();
    expect(brief.text).not.toContain("<script>");
    expect(brief.text).toContain("&lt;script&gt;");
    expect(brief.text).toContain("&amp;");
    expect(brief.text).toContain("Tell &lt;b&gt;Mike&lt;/b&gt;");
  });

  it("a slice that throws renders the failed-slice marker, never silence", async () => {
    // Shop slice reads all reject -> buildShopSlice throws (inner
    // catches were removed 2026-07-30) -> slice-level catch renders the
    // marker instead of the slice silently vanishing.
    mocks.auditEvent.findFirst.mockRejectedValue(new Error("neon down"));
    mocks.cronJobLog.count.mockRejectedValue(new Error("neon down"));
    mocks.cronJobLog.findMany.mockRejectedValue(new Error("neon down"));

    const brief = await buildMorningBrief();
    expect(brief.text).toContain("Shop slice unavailable — read failed");
  });

  it("a failed drift read renders UNAVAILABLE, not the LOW all-clear", async () => {
    mocks.brainMemory.findMany.mockRejectedValue(new Error("neon down"));

    const brief = await buildMorningBrief();
    expect(brief.text).toContain("UNAVAILABLE (read failed)");
    expect(brief.text).not.toContain("Drift: <b>LOW</b>");
  });
});

describe("Morning Brief · weekly 'What you're not seeing' (2026-10-22)", () => {
  const SECTION = { lines: ["<b>What you're not seeing</b>", "· business: a gap"], payload: { gapsShown: 1 } };

  beforeEach(() => {
    resetMocks();
    weekly.flagOn = false;
    weekly.weekday = 1;
    weekly.build.mockReset();
    weekly.build.mockResolvedValue(SECTION);
    weekly.load.mockClear();
  });

  it("Mondays await the flag overrides first (a cold process would read env only); other days skip it", async () => {
    await buildMorningBrief();
    expect(weekly.load).toHaveBeenCalledTimes(1);
    weekly.weekday = 4;
    weekly.load.mockClear();
    await buildMorningBrief();
    expect(weekly.load).not.toHaveBeenCalled();
  });

  it("OFF by default: a Monday brief carries no section and never composes it", async () => {
    const brief = await buildMorningBrief();
    expect(brief.text).not.toContain("What you're not seeing");
    expect(weekly.build).not.toHaveBeenCalled();
  });

  it("flag on, Monday: the section is in the brief", async () => {
    weekly.flagOn = true;
    const brief = await buildMorningBrief();
    expect(brief.text).toContain("What you're not seeing");
    expect(brief.text).toContain("· business: a gap");
    expect(brief.payload.notSeeing).toEqual({ gapsShown: 1 });
  });

  it("the section comes after every other section, so it stays out of the 200-character push preview", async () => {
    weekly.flagOn = true;
    const { getTodaysAnticipated } = await import("@/lib/brain/anticipated-questions");
    (getTodaysAnticipated as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      questions: [{ question: "What did the lot camera count yesterday?", topic: "shop" }],
      answers: [null],
    });
    const brief = await buildMorningBrief();
    expect(brief.text).toContain("What did the lot camera count yesterday?");
    expect(brief.text.indexOf("What you're not seeing")).toBeGreaterThan(brief.text.indexOf("lot camera count"));
    expect(brief.text.trimEnd().endsWith("· business: a gap")).toBe(true);
  });

  it("flag on, Tuesday: no section", async () => {
    weekly.flagOn = true;
    weekly.weekday = 2;
    const brief = await buildMorningBrief();
    expect(brief.text).not.toContain("What you're not seeing");
  });

  it("a section that throws leaves a marker line, not silence", async () => {
    weekly.flagOn = true;
    weekly.build.mockRejectedValue(new Error("boom"));
    const brief = await buildMorningBrief();
    expect(brief.text).toContain("What you're not seeing slice unavailable");
  });
});

// 2026-10-29 · wisdom-brain upgrade 5: on Mondays one plain maxim, matched by tag to one real
// shop number the brief already read. Nothing new is sent; it is one line in the same brief.
describe("Morning Brief · Monday 'Wisdom applied' line (2026-10-29)", () => {
  type Maxim = { text: string; source: string; ref: string; tags: string[] };
  const MAXIMS: Maxim[] = ["bezos", "gracian", "greene", "munger", "naval"].flatMap(
    (p) =>
      (JSON.parse(
        readFileSync(resolve(__dirname, `../../data/wisdom/maxims/${p}-maxims.json`), "utf8"),
      ) as { entries: Maxim[] }).entries,
  );
  const wisdomLine = (text: string) => text.split("\n").find((l) => l.startsWith("Wisdom applied"));
  const applied = (brief: { payload: Record<string, unknown> }) =>
    (brief.payload as { shop: { wisdomApplied?: { tag: string; ref: string; metric: string } } }).shop.wisdomApplied;
  /** Shaped exactly like apps/nickstire/server/cron/jobs/statenourSync.ts output (keys on main, 2026-10-30). */
  const SYNC = (over: { declinedWork?: Record<string, unknown>; revenue?: Record<string, unknown> } = {}) => ({
    revenue: {
      available: true, todayEstimate: 0, yesterdayRevenue: 2400, yesterdayJobs: 6, weekRevenue: 15200,
      monthRevenue: 41000, avgTicket: 0, jobsToday: 0, monthlyTarget: 60000, ...over.revenue,
    },
    declinedWork: {
      measured: true, source: "work_order_items", sourceNote: "counted", totalRecoverable: 3400,
      customerCount: 4, safetyItemCount: 1, topItems: [], ...over.declinedWork,
    },
    intelligence: { conversionPipeline: null, revenueProjection: null, shopPulse: null },
  });
  const fresh = (payload: Record<string, unknown>, createdAt = new Date()) =>
    mocks.auditEvent.findFirst.mockResolvedValue({ createdAt, payload });
  const at = (iso: string) => vi.setSystemTime(new Date(iso));

  beforeEach(() => {
    resetMocks();
    weekly.flagOn = false;
    weekly.weekday = 1;
    maximCtl.pick = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("real sync payload, declined work measured: the customers maxim is applied to the open count", async () => {
    fresh(SYNC());
    const brief = await buildMorningBrief();
    const line = wisdomLine(brief.text);
    expect(line).toContain("declined work (4 customers open)");
    const a = applied(brief)!;
    expect(a).toEqual({ tag: "customers", ref: a.ref, metric: "declined" });
    const maxim = MAXIMS.find((m) => m.ref === a.ref)!;
    expect(maxim.tags).toContain("customers");
    expect(line).toContain(maxim.text);
    expect(line).toContain(`(${maxim.source})`);
  });

  it("declined work not measured: the week's revenue gets a money maxim", async () => {
    fresh(SYNC({ declinedWork: { measured: false } }));
    const brief = await buildMorningBrief();
    expect(wisdomLine(brief.text)).toContain("revenue ($15.2k, last 7 days)");
    expect(applied(brief)).toEqual({ tag: "money", ref: applied(brief)!.ref, metric: "revenue" });
  });

  it("revenue from a context row of another ET day is not applied, even when the row is still fresh", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-11-02T13:00:00Z"); // Monday 08:00 ET
    fresh(SYNC({ declinedWork: { measured: false } }), new Date("2026-11-02T03:00:00Z")); // Sunday 22:00 ET
    expect(wisdomLine((await buildMorningBrief()).text)).toBeUndefined();
    fresh(SYNC({ declinedWork: { measured: false } }), new Date("2026-11-02T12:00:00Z")); // CONTROL: Monday 07:00 ET
    expect(wisdomLine((await buildMorningBrief()).text)).toContain("last 7 days");
  });

  it("zeros everywhere give no line and no payload", async () => {
    fresh({ ...SYNC({ declinedWork: { customerCount: 0 }, revenue: { weekRevenue: 0 } }), intelligence: { gbp: { new: 0, total: 0 } } });
    const brief = await buildMorningBrief();
    expect(brief.text).toContain("<b>Shop</b>"); // POSITIVE CONTROL: the slice rendered
    expect(wisdomLine(brief.text)).toBeUndefined();
    expect(applied(brief)).toBeUndefined();
  });

  it("not Monday: no line and no payload", async () => {
    weekly.weekday = 2;
    fresh(SYNC());
    const brief = await buildMorningBrief();
    expect(brief.text).toContain("Rev (today)"); // POSITIVE CONTROL: the same payload renders shop lines
    expect(wisdomLine(brief.text)).toBeUndefined();
    expect(applied(brief)).toBeUndefined();
  });

  it("real clock: Sunday 23:30 ET gives no line, Monday 00:30, 08:00 and 22:00 ET give the same line", async () => {
    weekly.weekday = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    const lineAt = async (iso: string) => {
      at(iso);
      fresh(SYNC());
      return wisdomLine((await buildMorningBrief()).text);
    };
    expect(await lineAt("2026-11-02T04:30:00Z")).toBeUndefined();
    const first = await lineAt("2026-11-02T05:30:00Z");
    expect(first).toBeDefined();
    expect(await lineAt("2026-11-02T13:00:00Z")).toBe(first);
    expect(await lineAt("2026-11-03T03:00:00Z")).toBe(first);
    const { pickMaxim } = await import("@/lib/brain/maxims");
    expect(first).toContain((pickMaxim("customers", "2026-11-02") as Maxim).text);
  });

  it("the maxims module failing costs only the wisdom line: the other Shop lines stay", async () => {
    maximCtl.pick = () => {
      throw new Error("pack without entries");
    };
    fresh({ ...SYNC(), declinedWork: { ...SYNC().declinedWork, count: 12 }, lineOfCars: 8 });
    const brief = await buildMorningBrief();
    expect(brief.text).toContain("Declined work: 12 open");
    expect(brief.text).toContain("Line of cars: 8");
    expect(brief.text).not.toContain("Shop slice unavailable");
    expect(wisdomLine(brief.text)).toBeUndefined();
  });

  it("markup in a maxim is escaped, so Telegram never sees a stray tag", async () => {
    maximCtl.pick = () => ({ text: "Keep <b>score</b> & call back", source: "A<B>", ref: "r1", tags: ["customers"] });
    fresh(SYNC());
    const line = wisdomLine((await buildMorningBrief()).text)!;
    expect(line).toContain("Keep &lt;b&gt;score&lt;/b&gt; &amp; call back");
    expect(line).toContain("(A&lt;B&gt;)");
    expect(line).not.toContain("<b>score");
  });

  it("pickMaxim returns only maxims carrying the tag, varies across 60 dates, and an unknown tag gives null", async () => {
    const { pickMaxim } = await import("@/lib/brain/maxims");
    for (const tag of ["customers", "money", "reputation"]) {
      const refs = new Set<string>();
      for (let d = 1; d <= 60; d++) {
        const seed = `2026-${String(1 + (d % 12)).padStart(2, "0")}-${String(1 + (d % 28)).padStart(2, "0")}`;
        const m = pickMaxim(tag, seed) as Maxim;
        expect(m.tags).toContain(tag);
        refs.add(m.ref);
      }
      expect(refs.size).toBeGreaterThanOrEqual(10);
    }
    expect(pickMaxim("no-such-tag", "2026-11-02")).toBeNull();
  });
});
