/**
 * nickActions.cronHealthSummary: one row per scheduled job over the last 24 hours, plus what the cron-failure
 * observer already measured (stuck queues, lane shapes).
 *
 * The removed cronHealth returned the newest 500 of ~116 jobs' runs, flat; the Settings tab printed 80 of them, every
 * one "completed", and the real signals sat inside one observer details string. This drives the REAL drizzle
 * builder over a fake mysql2 client that records the SQL and answers it the way the database would (window,
 * GROUP BY job, latest row per job), so a LIMIT, a lost window or a per-run read changes the answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This file needs the REAL drizzle builder, schema and subject; another file's mock must not leak in (AGENTS.md section 3).
vi.unmock("drizzle-orm/mysql2");
vi.unmock("drizzle-orm");
vi.unmock("../../../drizzle/schema");
vi.unmock("./chat");
vi.unmock("../nickActions");

import { drizzle } from "drizzle-orm/mysql2";

const NOW = new Date("2026-10-25T22:00:00.000Z");
const HOUR = 60 * 60 * 1000;

interface Run {
  jobName: string;
  status: string;
  at: Date;
  durationMs?: number | null;
  details?: string | null;
  errorMessage?: string | null;
}

const h = vi.hoisted(() => ({
  rows: [] as Array<{ jobName: string; status: string; at: Date; durationMs?: number | null; details?: string | null; errorMessage?: string | null }>,
  sent: [] as { sql: string; values: unknown[] }[],
  dead: false,
  failQuery: false,
  /** Make the database hand back a start time (job rows and the observer row) that is not a date. */
  badStamp: false,
}));

// mysql2 with drizzle's typeCast hands TIMESTAMP back as a "YYYY-MM-DD HH:mm:ss" string; counts and sums can be strings.
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

const fakeClient = {
  query: async (q: { sql: string; values?: unknown[] } | string, params?: unknown[]) => {
    const text = typeof q === "string" ? q : q.sql;
    const values = (typeof q === "string" ? params : q.values ?? params) ?? [];
    h.sent.push({ sql: text, values });
    if (h.failQuery) throw Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });
    if (!/from `?cron_log`?/i.test(text)) return [[], []];
    const since = new Date(`${String(values[0]).replace(" ", "T")}Z`);
    const inWindow = h.rows.filter((r) => r.at >= since);
    const byJob = new Map<string, typeof inWindow>();
    for (const r of inWindow) byJob.set(r.jobName, [...(byJob.get(r.jobName) ?? []), r]);
    if (/inner join/i.test(text)) {
      const out = [...byJob.values()].map((runs) => runs.reduce((a, b) => (b.at > a.at ? b : a)));
      return [
        out.map((r) => ({
          jobName: r.jobName,
          status: r.status,
          durationMs: r.durationMs ?? null,
          details: r.details ?? null,
          errorMessage: r.errorMessage ?? null,
          startedAt: h.badStamp ? "not-a-date" : stamp(r.at),
        })),
        [],
      ];
    }
    return [
      [...byJob.entries()].map(([jobName, runs]) => {
        const done = runs.filter((r) => r.status === "completed");
        const max = (xs: typeof runs) => (xs.length ? stamp(xs.reduce((a, b) => (b.at > a.at ? b : a)).at) : null);
        return {
          jobName,
          runs: runs.length,
          failed: String(runs.filter((r) => r.status === "failed").length),
          skipped: String(runs.filter((r) => r.status === "skipped").length),
          lastStartedAt: h.badStamp ? "not-a-date" : max(runs),
          lastSuccessAt: max(done),
        };
      }),
      [],
    ];
  },
};
const realDrizzle = drizzle(fakeClient as never);

// dbAdminProcedure's guard reads getDbTyped; getDb stays null so the admin-role read takes its documented missing-row path.
vi.mock("../../db", () => ({
  getDb: async () => null,
  getDbTyped: async () => (h.dead ? null : realDrizzle),
  getNextInvoiceNumber: async () => "INV-TEST",
  createInvoice: async () => ({}),
}));
vi.mock("../../lib/db-helper", () => ({
  db: async () => realDrizzle,
  dbTyped: async () => (h.dead ? null : realDrizzle),
  requireDb: async () => {
    if (h.dead) throw new Error("Database unavailable");
    return realDrizzle;
  },
}));

import { handleCronHealthSummary } from "./chat";
import { nickActionsRouter } from "../nickActions";

const run = (jobName: string, status: string, hoursAgo: number, extra: Partial<Run> = {}): Run => ({
  jobName,
  status,
  at: new Date(NOW.getTime() - hoursAgo * HOUR),
  ...extra,
});

const OBSERVER =
  "scanned: 0 failing jobs; telegram messages sent: 0; suppressed (recent): 4; quiet-deferred: 0; resolved: 0; root-db: no; " +
  "shapes: 3 actionable of 7 judged (sms-response-jobs=missing, outbound-sms-queue=missing, declined-work-recovery=dormant); " +
  "undeclared loops: 118; queue-age: reminder-queue=stuck(23664m>1440m), followup-cadence=empty";

/** failed x1, skipped x1, completed x40: the shapes the old flat list buried. */
const threeJobs = (): Run[] => [
  run("sms-sender", "failed", 1, { errorMessage: "gateway 502", durationMs: 120 }),
  run("weather-sms", "skipped", 2, { details: "skipped: outside window" }),
  ...Array.from({ length: 40 }, (_, i) => run("data-accuracy-check", "completed", 0.1 + i * 0.5, { details: `run ${i}` })),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.rows = [];
  h.sent.length = 0;
  h.dead = false;
  h.failQuery = false;
  h.badStamp = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("handleCronHealthSummary", () => {
  it("one row per job: failed first, then skipped, then completed, with runs and last success per job", async () => {
    h.rows = threeJobs();
    const out = await handleCronHealthSummary();
    expect(out.jobs.map((j) => [j.jobName, j.lastStatus, j.runs, j.failed, j.skipped])).toEqual([
      ["sms-sender", "failed", 1, 1, 0],
      ["weather-sms", "skipped", 1, 0, 1],
      ["data-accuracy-check", "completed", 40, 0, 0],
    ]);
    const [failed, skipped, completed] = out.jobs;
    expect(failed).toMatchObject({ lastErrorMessage: "gateway 502", lastDurationMs: 120, lastSuccessAt: null });
    expect(skipped).toMatchObject({ lastDetails: "skipped: outside window", lastSuccessAt: null });
    expect(completed.lastSuccessAt).toBe(completed.lastStartedAt);
    expect(completed.lastStartedAt).toBe("2026-10-25T21:54:00.000Z");
  });

  it("the window is the last 24 hours and the result says so", async () => {
    h.rows = [run("a", "completed", 23.9), run("b", "failed", 24.1)];
    const out = await handleCronHealthSummary();
    expect(out.since).toBe("2026-10-24T22:00:00.000Z");
    expect(out.to).toBe("2026-10-25T22:00:00.000Z");
    expect(out.jobs.map((j) => j.jobName)).toEqual(["a"]);
  });

  it("the latest run decides the status; an older failure is counted but not the headline", async () => {
    h.rows = [run("sync", "failed", 5, { errorMessage: "boom" }), run("sync", "completed", 1)];
    const [job] = (await handleCronHealthSummary()).jobs;
    expect(job).toMatchObject({ jobName: "sync", lastStatus: "completed", runs: 2, failed: 1 });
    expect(job.lastSuccessAt).toBe("2026-10-25T21:00:00.000Z");
  });

  it("jobs with the same status are newest first", async () => {
    h.rows = [run("old", "completed", 6), run("new", "completed", 1), run("mid", "completed", 3)];
    expect((await handleCronHealthSummary()).jobs.map((j) => j.jobName)).toEqual(["new", "mid", "old"]);
  });

  it("reads the observer's stuck queue and lane shapes from its latest row", async () => {
    h.rows = [run("cron-failure-observer", "completed", 0.2, { details: "scanned: 9 failing jobs; old" }), run("cron-failure-observer", "completed", 0.1, { details: OBSERVER })];
    const out = await handleCronHealthSummary();
    expect(out.observer).toEqual({
      at: "2026-10-25T21:54:00.000Z",
      failing: 0,
      shapesJudged: 7,
      shapes: [
        { job: "sms-response-jobs", shape: "missing" },
        { job: "outbound-sms-queue", shape: "missing" },
        { job: "declined-work-recovery", shape: "dormant" },
      ],
      undeclaredLoops: 118,
      queuesStuck: [{ loop: "reminder-queue", ageMinutes: 23664, maxAgeMinutes: 1440 }],
      raw: OBSERVER,
    });
  });

  it("no observer row in the window is null, not an empty observer", async () => {
    h.rows = threeJobs();
    expect((await handleCronHealthSummary()).observer).toBeNull();
  });

  it("an observer row with no details is null: nothing to read is not 'all clear'", async () => {
    h.rows = [run("cron-failure-observer", "failed", 0.1, { errorMessage: "db down" })];
    const out = await handleCronHealthSummary();
    expect(out.observer).toBeNull();
    expect(out.jobs[0]).toMatchObject({ jobName: "cron-failure-observer", lastStatus: "failed" });
  });

  it("a start time the database returns unreadable is null, never 'just now'; the job and the observer stay in the list", async () => {
    h.badStamp = true;
    h.rows = [run("sms-sender", "failed", 1, { errorMessage: "gateway 502" }), run("cron-failure-observer", "completed", 0.1, { details: OBSERVER })];
    const out = await handleCronHealthSummary();
    const sms = out.jobs.find((j) => j.jobName === "sms-sender");
    expect(sms).toMatchObject({ lastStatus: "failed", lastStartedAt: null });
    expect(out.observer?.at).toBeNull();
    expect(out.observer?.failing).toBe(0);
  });

  it("control: a readable start time is still the real time (the null above is the unreadable case only)", async () => {
    h.rows = [run("sms-sender", "failed", 1)];
    expect((await handleCronHealthSummary()).jobs[0].lastStartedAt).toBe("2026-10-25T21:00:00.000Z");
  });

  it("an empty window is an empty list with the window, not an error", async () => {
    const out = await handleCronHealthSummary();
    expect(out.jobs).toEqual([]);
    expect(out.observer).toBeNull();
  });

  it("asks the database for two grouped reads with no row cap (the old flat read stopped at 500 runs)", async () => {
    h.rows = threeJobs();
    await handleCronHealthSummary();
    const q = h.sent.filter((s) => /cron_log/i.test(s.sql));
    expect(q).toHaveLength(2);
    for (const s of q) expect(s.sql).not.toMatch(/\blimit\b/i);
    expect(q[0].sql).toMatch(/group by/i);
    // TiDB only_full_group_by: the selected job column and the GROUP BY column must be written the same way.
    const grouped = /group by (`?[\w.]+`?)/i.exec(q[0].sql)?.[1].replace(/`/g, "");
    expect(grouped).toBeDefined();
    expect(q[0].sql.replace(/`/g, "")).toMatch(new RegExp(`select ${grouped!.replace(".", "\\.")}\\b`, "i"));
    expect(String(q[0].values[0])).toBe("2026-10-24 22:00:00");
  });

  it("a read that throws rejects; it is never an empty summary", async () => {
    h.failQuery = true;
    await expect(handleCronHealthSummary()).rejects.toThrow();
  });

  it("a dead database handle rejects too", async () => {
    h.dead = true;
    await expect(handleCronHealthSummary()).rejects.toThrow(/database/i);
  });
});

describe("nickActions.cronHealthSummary registration", () => {
  const ctx = (role: "admin" | "user") =>
    ({
      user: { id: 1, openId: `${role}-u`, email: "o@example.com", name: "O", loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
      req: { protocol: "https", headers: {} },
      res: { clearCookie: () => {} },
    }) as never;

  it("is a query an admin can call", async () => {
    h.rows = threeJobs();
    const out = await nickActionsRouter.createCaller(ctx("admin")).cronHealthSummary();
    expect(out.jobs).toHaveLength(3);
  });

  it("is admin only", async () => {
    await expect(nickActionsRouter.createCaller(ctx("user")).cronHealthSummary()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a dead database handle is SERVICE_UNAVAILABLE at the router (dbAdminProcedure), never a result", async () => {
    h.dead = true;
    await expect(nickActionsRouter.createCaller(ctx("admin")).cronHealthSummary()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
