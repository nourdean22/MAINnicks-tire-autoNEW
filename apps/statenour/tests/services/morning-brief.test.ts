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

import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { buildMorningBrief } from "@/lib/services/morning-brief";

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
  it("shop slice · skips silently when bridge is stale AND no failed crons", async () => {
    mocks.auditEvent.findFirst.mockResolvedValue({
      // 30h ago · stale (>24h)
      createdAt: new Date(Date.now() - 30 * 60 * 60_000),
      payload: { lineOfCars: 99 },
    });
    mocks.cronJobLog.count.mockResolvedValue(0);

    const brief = await buildMorningBrief();
    expect(brief.text).not.toContain("<b>Shop</b>");
    expect(brief.text).not.toContain("Line of cars");

    const shopPayload = (brief.payload as { shop: Record<string, unknown> })
      .shop;
    expect(Object.keys(shopPayload)).toHaveLength(0);
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
