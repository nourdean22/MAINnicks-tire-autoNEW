/**
 * cron-heartbeat · first-seen registry upsert + manifest-derived coverage
 * (audit 2026-10-10: 08-F8, 05-M15, production log 12:00:01Z
 * `[inngest.cron-heartbeat] brainMemory.create Unique constraint failed (category,key)`).
 *
 * The mechanism: a `first-seen:<job>` row whose content is not an ISO timestamp
 * (nightly consolidation rewrote it into prose) parsed as NaN, so the job looked
 * unregistered, `create` hit the existing (category,key) row -> P2002, the whole
 * registry step returned null, and every never-run job was treated as ancient:
 * the watchdog pages on jobs still inside their grace window.
 *
 * Coverage: the watchdog only knew the mega fan-out children. 17 Inngest-native
 * and 5 worker-fired crons had no silence detector at all. They now come from
 * config/crons.ts.
 *
 * These drive the REAL handler with an inline `step.run`, not a replica.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (ctx: { step: { run: (id: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;
// Hoisted: createFunction runs while the module under test is imported.
const { handlers } = vi.hoisted(() => ({ handlers: {} as Record<string, Handler> }));

vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({
    createFunction: (cfg: { id: string }, handler: Handler) => {
      handlers[cfg.id] = handler;
      return { cfg, handler };
    },
  }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));

const recordCoachEvent = vi.fn(async (_e: { title: string; body: string }) => undefined);
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: (e: { title: string; body: string }) => recordCoachEvent(e) }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: vi.fn(async () => true),
  formatTelegramNotification: (t: string, b: string) => `${t}\n${b}`,
}));
const logError = vi.fn();
vi.mock("@/lib/utils/error-log", () => ({ logError: (...a: unknown[]) => logError(...a) }));

// ── a brain_memories table with a real (category,key) unique constraint ──
// `seeded(key)` answers for every key the handler asks about, so the seed does
// not depend on which job list the code under test computes.
let seeded: (key: string) => string | undefined;
const written = new Map<string, string>();
const contentOf = (k: string) => written.get(k) ?? seeded(k);
const upserts: Array<{ key: string; content: string }> = [];
const creates: string[] = [];
let groupByRows: (names: string[], okOnly: boolean) => Array<{ jobName: string; _max: { createdAt: Date | null } }>;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cronJobLog: {
      groupBy: async (args: { where: { jobName: { in: string[] }; status?: unknown } }) =>
        groupByRows(args.where.jobName.in, args.where.status !== undefined),
    },
    brainMemory: {
      findMany: async (args: { where: { key: { in: string[] } } }) =>
        args.where.key.in.filter((k) => contentOf(k) !== undefined).map((k) => ({ key: k, content: contentOf(k)! })),
      create: async (args: { data: { key: string; content: string } }) => {
        creates.push(args.data.key);
        if (contentOf(args.data.key) !== undefined) {
          throw Object.assign(new Error("Unique constraint failed on the fields: (`category`,`key`)"), { code: "P2002" });
        }
        written.set(args.data.key, args.data.content);
        return {};
      },
      upsert: async (args: {
        where: { category_key: { category: string; key: string } };
        create: { content: string };
        update: { content: string };
      }) => {
        const key = args.where.category_key.key;
        const content = contentOf(key) !== undefined ? args.update.content : args.create.content;
        written.set(key, content);
        upserts.push({ key, content });
        return {};
      },
    },
  },
}));

import { classifySilence, cronPeriodH, expectedJobs } from "@/lib/inngest/functions/cron-heartbeat";
import { CRONS } from "@/config/crons";
import { MORNING_JOBS, EVENING_JOBS, WEEKLY_JOBS } from "@/lib/inngest/jobs";

const H = 3_600_000;
const NOW = new Date("2026-10-10T12:00:00.000Z");
const step = { run: async (_id: string, fn: () => unknown) => fn() };
const nameOf = (p: string) => p.replace(/^\/api\/cron\//, "").replace(/\?.*$/, "");

function seedRegistry(namesToContent: (name: string) => string) {
  seeded = (key) => namesToContent(key.replace(/^first-seen:/, ""));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  seeded = () => undefined;
  written.clear();
  upserts.length = 0;
  creates.length = 0;
  recordCoachEvent.mockClear();
  logError.mockClear();
  groupByRows = () => []; // nothing has ever run
});
afterEach(() => vi.useRealTimers());

describe("first-seen registry · the 12:00:01Z P2002", () => {
  it("RED CASE: a prose first-seen row is rewritten, not re-created — and nothing pages inside the grace window", async () => {
    const oneHourAgo = new Date(NOW.getTime() - H).toISOString();
    seedRegistry((n) => (n === "stale-tasks" ? "Cron watchdog first noticed stale-tasks in early October." : oneHourAgo));

    await handlers["cron-heartbeat"]({ step });

    expect(creates, "create() against an existing (category,key) is the P2002").toEqual([]);
    expect(upserts).toEqual([{ key: "first-seen:stale-tasks", content: NOW.toISOString() }]);
    expect(logError).not.toHaveBeenCalled();
    // Every job is never-run but registered within its window -> newborn, no P0.
    expect(recordCoachEvent).not.toHaveBeenCalled();
  });

  it("a non-ISO value that Date.parse still accepts is treated as missing — a parse is not a timestamp", async () => {
    // "October 1, 2026" parses. Read as first-seen it would make stale-tasks
    // 9 days old and page; it is not a value this registry ever wrote.
    const oneHourAgo = new Date(NOW.getTime() - H).toISOString();
    seedRegistry((n) => (n === "stale-tasks" ? "October 1, 2026" : oneHourAgo));

    await handlers["cron-heartbeat"]({ step });

    expect(upserts).toEqual([{ key: "first-seen:stale-tasks", content: NOW.toISOString() }]);
    expect(recordCoachEvent).not.toHaveBeenCalled();
  });

  it("CONTROL: a valid ISO first-seen older than the window still pages a never-run job", async () => {
    const tenDaysAgo = new Date(NOW.getTime() - 10 * 24 * H).toISOString();
    seedRegistry(() => tenDaysAgo);

    await handlers["cron-heartbeat"]({ step });

    expect(upserts, "a valid registry row is never rewritten").toEqual([]);
    expect(recordCoachEvent).toHaveBeenCalledTimes(1);
    expect(recordCoachEvent.mock.calls[0][0].body).toContain("stale-tasks (never)");
  });

  it("first sighting registers via upsert", async () => {
    await handlers["cron-heartbeat"]({ step });
    expect(creates).toEqual([]);
    expect(upserts.length).toBe(expectedJobs().length);
    expect(recordCoachEvent).not.toHaveBeenCalled();
  });
});

describe("expectedJobs · derived from config/crons.ts", () => {
  const byName = () => new Map(expectedJobs().map((j) => [j.name, j]));
  const watchable = CRONS.filter(
    (c) => c.mode === "active" && (c.inngest || c.worker) && c.name !== "cron-heartbeat",
  );

  it("CONTROL: every fan-out child keeps its exact old window and the failing lane", () => {
    const daily = new Set([...MORNING_JOBS, ...EVENING_JOBS].map(nameOf));
    const jobs = byName();
    for (const name of daily) {
      expect(jobs.get(name), name).toEqual({ name, maxAgeH: 26 });
    }
    for (const name of new Set(WEEKLY_JOBS.map(nameOf))) {
      if (!daily.has(name)) expect(jobs.get(name), name).toEqual({ name, maxAgeH: 24 * 8 });
    }
  });

  it("RED CASE: every active Inngest-native and worker-fired cron is watched (was: none)", () => {
    const jobs = byName();
    expect(watchable.length).toBeGreaterThan(15);
    for (const c of watchable) expect(jobs.has(c.name), `${c.name} has no silence detector`).toBe(true);
  });

  it("windows come from the manifest schedule", () => {
    const jobs = byName();
    expect(jobs.get("approval-sweeper")).toEqual({ name: "approval-sweeper", maxAgeH: 2 + 5 / 60, silenceOnly: true });
    expect(jobs.get("proactive-push-cron")?.maxAgeH).toBe(3);
    expect(jobs.get("diagnose-cron-failure")?.maxAgeH).toBe(6);
    expect(jobs.get("goal-pruner")?.maxAgeH).toBe(26);
    expect(jobs.get("operating-rhythm")?.maxAgeH).toBe(26);
    expect(jobs.get("inngest-liveness")?.maxAgeH).toBe(26);
  });

  it("the watcher does not watch itself; non-active entries are not expected", () => {
    const jobs = byName();
    expect(jobs.has("cron-heartbeat")).toBe(false);
    for (const c of CRONS.filter((x) => x.mode !== "active" && (x.inngest || x.worker))) {
      expect(jobs.has(c.name), c.name).toBe(false);
    }
  });

  it("no active Inngest/worker cron escapes on an unreadable schedule", () => {
    for (const c of watchable) expect(cronPeriodH(c.schedule), `${c.name}: ${c.schedule}`).not.toBeNull();
    expect(cronPeriodH(null)).toBeNull();
    expect(cronPeriodH("0 9 1 * *")).toBeNull(); // monthly: not a shape this watchdog judges
  });
});

describe("silence-only lane for the newly covered jobs", () => {
  it("a silenceOnly job that runs and never succeeds is NOT paged as failing (no measured base rate yet)", () => {
    const v = classifySilence(
      [{ name: "approval-sweeper", maxAgeH: 2, silenceOnly: true }],
      new Map([["approval-sweeper", NOW.getTime() - 0.1 * H]]),
      new Map(),
      NOW.getTime(),
      new Map([["approval-sweeper", null]]),
    );
    expect(v.failing).toEqual([]);
    expect(v.silent).toEqual([]);
  });

  it("CONTROL: the same inputs without the flag still page as failing", () => {
    const v = classifySilence(
      [{ name: "approval-sweeper", maxAgeH: 2 }],
      new Map([["approval-sweeper", NOW.getTime() - 0.1 * H]]),
      new Map(),
      NOW.getTime(),
      new Map([["approval-sweeper", null]]),
    );
    expect(v.failing).toHaveLength(1);
  });

  it("WIRING: a silent Inngest-native cron pages through the real handler", async () => {
    const recent = new Date(NOW.getTime() - 1 * H);
    groupByRows = (names) =>
      names.map((n) => ({
        jobName: n,
        _max: { createdAt: n === "approval-sweeper" ? new Date(NOW.getTime() - 5 * H) : recent },
      }));
    await handlers["cron-heartbeat"]({ step });
    expect(recordCoachEvent).toHaveBeenCalledTimes(1);
    const { title, body } = recordCoachEvent.mock.calls[0][0];
    expect(title).toBe("1 cron not firing");
    expect(body).toContain("approval-sweeper (5h)");
  });
});
