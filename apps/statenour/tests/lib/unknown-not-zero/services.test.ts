/**
 * Unknown is not zero: services that render bridge / DB reads (audit 2026-10-10, 08-F6
 * section 3 table: operating-rhythm, data-source-health, morning-brief, system-pulse).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queryNick: vi.fn(),
  sendTelegram: vi.fn(),
  readCalendarDay: vi.fn(),
  db: {} as Record<string, Record<string, ReturnType<typeof vi.fn>>> & { $queryRaw?: ReturnType<typeof vi.fn> },
}));

vi.mock("@/lib/nickstire/query", async (orig) => ({
  readBridge: (await orig<typeof import("@/lib/nickstire/query")>()).readBridge,
  queryNick: h.queryNick,
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: h.sendTelegram }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn(async () => undefined) } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
// The brief reads the calendar through lib/calendar/day-events (every account, every calendar).
const OK_EMPTY = { state: "ok", events: [], sources: { accounts: 1, calendars: 1 }, failedAccounts: [] };
vi.mock("@/lib/calendar/day-events", async (orig) => ({
  ...(await orig<typeof import("@/lib/calendar/day-events")>()),
  readCalendarDay: h.readCalendarDay,
  // In use recently, so an empty today reads "nothing booked", not "wrong account".
  readCalendarWindow: vi.fn(async () => ({ ...OK_EMPTY, events: [{ id: "x", title: "x", start: "2026-10-08T14:00:00Z", end: null, allDay: false, accountKey: "primary" }] })),
}));

import { executeRhythm } from "@/lib/brain/operating-rhythm";
import { runHealthProbes } from "@/lib/contracts/data-source-health";
import { buildPersonalSlice } from "@/lib/services/morning-brief";
import { buildSystemPulse } from "@/lib/services/system-pulse";

const FAILURES = {
  transport: { error: "fetch failed" },
  unknownQuery: { error: 'HTTP 400: {"error":"Unknown query: x"}', statusCode: 400 },
  softError: { query: "x", timestamp: "t", data: { error: "No DB" } },
} as const;

function resetDb() {
  for (const k of Object.keys(h.db)) delete (h.db as Record<string, unknown>)[k];
  Object.assign(h.db, {
    userPreference: { findUnique: vi.fn(async () => null) },
    brainMemory: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({})),
      // The rhythm's slot claim (claimPushSlot) and its release after a failed send.
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    task: { count: vi.fn(async () => 3), findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    commitment: { count: vi.fn(async () => 1), findMany: vi.fn(async () => []) },
    auditEvent: { create: vi.fn(async () => ({})) },
  });
}

beforeEach(() => {
  resetDb();
  h.queryNick.mockReset();
  h.sendTelegram.mockReset().mockResolvedValue(true);
  h.readCalendarDay.mockReset().mockResolvedValue(OK_EMPTY);
});
afterEach(() => vi.useRealTimers());

describe("operating-rhythm mid-morning Telegram", () => {
  const sent = () => String(h.sendTelegram.mock.calls[0]?.[0] ?? "");

  for (const [name, shape] of Object.entries(FAILURES)) {
    it(`a failed leads/callbacks read (${name}) says unknown, never "No stale leads"`, async () => {
      h.queryNick.mockImplementation(async (q: string) =>
        q === "revenue_today" ? { data: { totalDollars: 50, invoiceCount: 1 } } : shape,
      );
      await executeRhythm("mid_morning");
      expect(sent()).toContain("unknown");
      expect(sent()).not.toContain("No stale leads");
    });
  }

  it("a failed task/commitment count says unknown, not 0", async () => {
    h.queryNick.mockResolvedValue({ data: { count: 0, totalDollars: 1, invoiceCount: 1 } });
    h.db.task.count.mockRejectedValue(new Error("db down"));
    await executeRhythm("mid_morning");
    expect(sent()).toMatch(/Tasks: unknown/);
  });

  it("CONTROL: measured zero leads still says No stale leads", async () => {
    h.queryNick.mockImplementation(async (q: string) =>
      q === "revenue_today" ? { data: { totalDollars: 50, invoiceCount: 1 } } : { data: { count: 0 } },
    );
    await executeRhythm("mid_morning");
    expect(sent()).toContain("No stale leads");
    expect(sent()).not.toContain("unknown");
  });
});

describe("data-source-health bridge probes", () => {
  const probe = async (name: string) => (await runHealthProbes()).results.find((r) => r.name === name)!;
  // The probes import the bridge client concurrently, and only the first concurrent dynamic
  // import was seen to resolve the mock; the rest got the real client. Answer the same body
  // on both paths: the mock, and the real client's fetch.
  beforeEach(() => {
    process.env.STATENOUR_SYNC_KEY = "test-key";
    process.env.NICKSTIRE_URL = "http://bridge.test";
  });
  afterEach(() => {
    delete process.env.STATENOUR_SYNC_KEY;
    delete process.env.NICKSTIRE_URL;
    vi.unstubAllGlobals();
  });
  const answer = (body: unknown) => {
    h.queryNick.mockResolvedValue(body);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  };

  it("a 200 carrying data.error is a failed probe, not ok with 0 rows", async () => {
    answer(FAILURES.softError);
    const r = await probe("bridge.revenue_today");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("No DB");
    expect((await probe("bridge.attention_needed")).ok).toBe(false);
  });

  it("attention_needed counts the handler's `alerts` (it never sent `items`)", async () => {
    answer({ data: { alerts: [{ level: "critical", message: "x", count: 1 }], totalCritical: 1 } });
    const r = await probe("bridge.attention_needed");
    expect(r).toMatchObject({ ok: true, rowCount: 1 });
  });

  it("CONTROL: a measured zero is ok with 0 rows", async () => {
    answer({ data: { totalDollars: 0, invoiceCount: 0 } });
    expect(await probe("bridge.revenue_today")).toMatchObject({ ok: true, rowCount: 0 });
  });
});

describe("morning brief personal slice", () => {
  it("a failed task count / calendar / commitments read renders unknown, not a vanished line", async () => {
    h.db.task.count.mockRejectedValue(new Error("db down"));
    h.db.commitment.findMany.mockRejectedValue(new Error("db down"));
    h.readCalendarDay.mockResolvedValue({ state: "read_failed", reason: "token refresh failed" });
    const slice = await buildPersonalSlice("2026-10-10");
    const text = slice.lines.join("\n");
    expect(text).toMatch(/Open tasks: unknown/);
    expect(text).toMatch(/Calendar: unknown/);
    expect(text).toMatch(/commit\w*: unknown/i);
    expect(slice.payload.taskCount).toBeNull();
  });

  it("CONTROL: measured zero tasks and an empty calendar render no unknown line", async () => {
    h.db.task.count.mockResolvedValue(0);
    const slice = await buildPersonalSlice("2026-10-10");
    expect(slice.lines.join("\n")).not.toContain("unknown");
    expect(slice.payload.taskCount).toBe(0);
    expect(slice.payload.calendarConflicts).toBe(0);
  });
});

describe("system pulse", () => {
  it("a quota fallback on the cron bucket marks the pulse unmeasured even after a later read recovers the circuit", async () => {
    Object.assign(h.db, {
      $queryRaw: vi
        .fn()
        .mockRejectedValueOnce(new Error("Your account or project has exceeded the compute time quota"))
        .mockResolvedValue([{}]),
      cronJobLog: { groupBy: vi.fn(async () => [{ jobName: "x", _max: { createdAt: new Date() } }]) },
      autonomousAction: { count: vi.fn(async () => 0) },
      smartDevice: { findMany: vi.fn(async () => []) },
    });
    const pulse = await buildSystemPulse();
    expect(pulse.cronFails24h).toBe(0);
    expect(pulse.dbQuotaExhausted).toBe(true);
  });
});
