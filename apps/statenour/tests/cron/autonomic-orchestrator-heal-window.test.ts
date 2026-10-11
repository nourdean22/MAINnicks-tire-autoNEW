/**
 * The cron healer re-fires a failed job only for a RECENT failure, and only
 * once per failed run (P2-B2, 2026-10-10).
 *
 * Since 2026-10-10 the deck's lastRunAt / lastStatus are each job's real newest
 * row with no time window, so `lastStatus === "failed"` alone re-fired a weekly
 * job whose last run failed days or months ago, once per nightly healer run.
 * Recent = inside one cadence of the job's schedule (26h daily-or-faster, 8d
 * weekly); an unknown cadence is skipped and logged.
 *
 * The claim is taken in action_attempts BEFORE the job fires (claim-before-act).
 * The store below is an in-memory action_attempts table with a real unique key,
 * so the real beginAttempt / settleAttempt run against it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  deck: vi.fn(),
  runManifestCron: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  attempts: new Map<string, Record<string, unknown>>(),
  storeDown: false,
  cronLogs: [] as Record<string, unknown>[],
  cronLogsDown: false,
  /** Runs right after the resolver reads attempts: a racer settling the row in that gap. */
  afterAttemptRead: null as null | (() => void),
}));

vi.mock("@/lib/services/system-pages", () => ({ buildCronCommandDeck: () => h.deck() }));
vi.mock("@/lib/services/cron-control", () => ({
  runManifestCron: (...args: unknown[]) => h.runManifestCron(...args),
}));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: async () => null }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: async () => true }));
vi.mock("@/lib/services/ai-tasks", () => ({ decomposeTaskWithAi: async () => ({ ok: false, subtasksCount: 0 }) }));
vi.mock("@/lib/ai/provider", () => ({
  markOllamaQuotaExhausted: () => {},
  isOllamaQuotaExhausted: () => false,
  getProviderStatus: () => ({ providers: [] }),
}));
vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logger")>()),
  logger: { withSurface: () => h.log },
}));

vi.mock("@/lib/prisma", () => {
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  const byId = (id: unknown) => [...h.attempts.values()].find((r) => r.id === id);
  type Q = { where: Record<string, unknown>; data: Record<string, unknown> };
  // Evaluates a Prisma where (equality, in, gte, lt) so the tests assert what
  // the healer reads, not the shape of its query. Anything else throws.
  const ms = (x: unknown) => (x as Date).getTime();
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, cond]) => {
      if (k === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
      const v = row[k];
      if (cond === null || typeof cond !== "object" || cond instanceof Date) return same(v, cond);
      return Object.entries(cond).every(([op, x]) => {
        if (op === "in") return (x as unknown[]).includes(v);
        if (op === "gte") return ms(v) >= ms(x);
        if (op === "lt") return ms(v) < ms(x);
        throw new Error(`fake prisma: unsupported operator ${op}`);
      });
    });
  const cronJobLog = {
    findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc"> }) => {
      if (h.cronLogsDown) throw new Error("cron_job_logs down");
      const hits = h.cronLogs.filter((r) => matches(r, where));
      const [field, dir] = Object.entries(orderBy ?? {})[0] ?? [];
      if (field) hits.sort((a, b) => (ms(a[field]) - ms(b[field])) * (dir === "desc" ? -1 : 1));
      return hits[0] ? { ...hits[0] } : null;
    },
  };
  const actionAttempt = {
    findMany: async ({ where }: Pick<Q, "where">) => {
      if (h.storeDown) throw new Error("db down");
      const out = [...h.attempts.values()].filter((r) => matches(r, where)).map((r) => ({ ...r }));
      h.afterAttemptRead?.();
      return out;
    },
    // The unique key on operation_key: check and insert with no await between.
    create: async ({ data }: Pick<Q, "data">) => {
      if (h.storeDown) throw new Error("db down");
      const key = data.operationKey as string;
      if (h.attempts.has(key)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const row = { ...data, id: `att_${h.attempts.size + 1}` };
      h.attempts.set(key, row);
      return { id: row.id, attemptNo: row.attemptNo };
    },
    findUnique: async ({ where }: Pick<Q, "where">) => {
      const row = "operationKey" in where ? h.attempts.get(where.operationKey as string) : byId(where.id);
      return row ? { ...row } : null;
    },
    updateMany: async ({ where, data }: Q) => {
      const row = byId(where.id);
      if (!row || !Object.entries(where).every(([k, v]) => same(row[k], v))) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    update: async ({ where, data }: Q) => {
      const row = byId(where.id);
      if (!row) throw new Error("fake action_attempts: no row");
      return Object.assign(row, data);
    },
  };
  return {
    prisma: {
      actionAttempt,
      cronJobLog,
      agentTrace: { findMany: async () => [] },
      workItem: { findMany: async () => [], update: async () => ({}) },
      task: { findMany: async () => [], update: async () => ({}), updateMany: async () => ({ count: 0 }) },
    },
  };
});

import { runAutonomicOrchestrator } from "@/lib/services/autonomic-orchestrator";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();
const states = () => [...h.attempts.values()].map((r) => r.state);

/** A weekly job no fan-out runs, so the sibling guard cannot be what decides. */
function failedRow(over: Record<string, unknown> = {}) {
  return {
    name: "weekly-maint",
    schedule: "0 3 * * 1",
    mode: "active",
    enabled: true,
    lastStatus: "failed",
    lastRunAt: isoAgo(2 * HOUR),
    success14d: 1,
    partial14d: 0,
    fail14d: 1,
    ...over,
  };
}

beforeEach(() => {
  h.deck.mockReset();
  h.runManifestCron.mockReset();
  h.runManifestCron.mockResolvedValue({ ok: true, status: 200, durationMs: 5 });
  for (const f of Object.values(h.log)) f.mockClear();
  h.attempts.clear();
  h.storeDown = false;
  h.cronLogs.length = 0;
  h.cronLogsDown = false;
  h.afterAttemptRead = null;
  // Pinned before HEAL_TRIGGER_CUTOFF: the describes below that seed rows with no
  // triggerId exercise the legacy name+time rule, which only pre-cutoff heals use.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-11T12:00:00Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("cron healer · an UNKNOWN heal with no stamped run row ages out after the cutoff", () => {
  /** A post-cutoff heal claim (trigger-id era) that is still UNKNOWN, no cron_job_logs row. */
  function seedUnknownHeal(startedAt: Date) {
    const operationKey = "cron-heal:weekly-maint:2026-10-19T11:00:00.000Z";
    h.attempts.set(operationKey, {
      id: "att_stuck",
      tool: "cron.heal",
      operationKey,
      state: "UNKNOWN",
      startedAt,
    });
    h.deck.mockResolvedValue({ rows: [] });
  }

  it("a heal still UNKNOWN 24h after its claim, with no row carrying heal:<id>, settles FAILED", async () => {
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    seedUnknownHeal(new Date("2026-10-19T12:00:00Z"));

    await runAutonomicOrchestrator();

    expect(h.attempts.get("cron-heal:weekly-maint:2026-10-19T11:00:00.000Z")?.state).toBe("FAILED");
  });

  it("a post-cutoff heal claimed 2h ago with no run row yet stays UNKNOWN (not aged out early)", async () => {
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    seedUnknownHeal(new Date("2026-10-25T10:00:00Z"));

    await runAutonomicOrchestrator();

    expect(h.attempts.get("cron-heal:weekly-maint:2026-10-19T11:00:00.000Z")?.state).toBe("UNKNOWN");
  });
});

describe("cron healer · only a recent failure is healed", () => {
  it("a weekly job whose only failed run is 10 days old is not healed", async () => {
    h.deck.mockResolvedValue({ rows: [failedRow({ lastRunAt: isoAgo(10 * DAY), success14d: 0 })] });

    const res = await runAutonomicOrchestrator();

    expect(h.runManifestCron).not.toHaveBeenCalled();
    expect(res.healedCrons).toEqual([]);
  });

  it("a weekly job that failed 2 hours ago is healed, once", async () => {
    h.deck.mockResolvedValue({ rows: [failedRow()] });

    const res = await runAutonomicOrchestrator();

    expect(h.runManifestCron).toHaveBeenCalledTimes(1);
    // The heal names its own claim, so the healed run's row can be matched to it.
    expect(h.runManifestCron).toHaveBeenCalledWith("weekly-maint", "heal:att_1");
    expect(res.healedCrons).toEqual(["weekly-maint"]);
  });

  it("a daily job is healable for 26h, not after", async () => {
    h.deck.mockResolvedValue({
      rows: [
        failedRow({ name: "daily-fresh", schedule: "0 9 * * *", lastRunAt: isoAgo(20 * HOUR) }),
        failedRow({ name: "daily-stale", schedule: "0 9 * * *", lastRunAt: isoAgo(30 * HOUR) }),
      ],
    });

    const res = await runAutonomicOrchestrator();

    expect(res.healedCrons).toEqual(["daily-fresh"]);
  });

  it("a folded morning-slot job (schedule null) gets the daily window: the morning fan-out runs it", async () => {
    h.deck.mockResolvedValue({
      rows: [
        failedRow({ name: "data-source-health", mode: "folded", schedule: null }),
        failedRow({ name: "ollama-model-liveness", mode: "folded", schedule: null, lastRunAt: isoAgo(30 * HOUR) }),
      ],
    });

    const res = await runAutonomicOrchestrator();
    const again = await runAutonomicOrchestrator();

    expect(h.runManifestCron).toHaveBeenCalledTimes(1);
    expect(res.healedCrons).toEqual(["data-source-health"]);
    expect(again.healedCrons).toEqual([]);
  });

  it("an Inngest-native job with no HTTP path is never fired or claimed: runManifestCron can only 409 it", async () => {
    h.deck.mockResolvedValue({
      rows: [
        failedRow({ name: "goal-pruner", schedule: "0 12 * * *", inngest: true }),
        failedRow({ name: "industry-pull", schedule: "0 8 * * *", inngest: true, lastStatus: null, lastRunAt: null, success14d: 0, fail14d: 0 }),
      ],
    });

    const res = await runAutonomicOrchestrator();

    expect(h.runManifestCron).not.toHaveBeenCalled();
    expect(h.attempts.size).toBe(0);
    expect(res.cronErrors).toEqual([]);
    expect(h.log.info).toHaveBeenCalledWith("heal_skipped_no_http_path", expect.objectContaining({ jobName: "goal-pruner" }));
  });

  it("a failed job whose cadence is unknown is skipped, and the skip is logged", async () => {
    h.deck.mockResolvedValue({ rows: [failedRow({ schedule: null })] });

    await runAutonomicOrchestrator();

    expect(h.runManifestCron).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalledWith(
      "heal_skipped_unknown_cadence",
      expect.objectContaining({ jobName: "weekly-maint" }),
    );
  });
});

describe("cron healer · one heal per failed run", () => {
  it("the same failed run is not healed again on the next healer run", async () => {
    h.deck.mockResolvedValue({ rows: [failedRow()] });

    await runAutonomicOrchestrator();
    const second = await runAutonomicOrchestrator();

    expect(h.runManifestCron).toHaveBeenCalledTimes(1);
    expect(second.healedCrons).toEqual([]);
    // it lost on the claim, not on a store error
    expect(second.cronErrors).toEqual([]);
  });

  it("a heal that came back ok:false is not retried for the same failed run", async () => {
    h.runManifestCron.mockResolvedValue({ ok: false, status: 404, durationMs: 5 });
    h.deck.mockResolvedValue({ rows: [failedRow()] });

    await runAutonomicOrchestrator();
    const second = await runAutonomicOrchestrator();

    expect(h.runManifestCron).toHaveBeenCalledTimes(1);
    expect(second.cronErrors).toEqual([]);
    // the second run's claim is settled, not left EXECUTING
    expect(states()).toEqual(["FAILED"]);
  });

  it("a heal that threw is not retried for the same failed run", async () => {
    h.runManifestCron.mockRejectedValue(new Error("boom"));
    h.deck.mockResolvedValue({ rows: [failedRow()] });

    await runAutonomicOrchestrator();
    const second = await runAutonomicOrchestrator();

    expect(h.runManifestCron).toHaveBeenCalledTimes(1);
    expect(second.cronErrors).toEqual([]);
  });

  it("a second healer run while the first is still healing does not fire it again", async () => {
    // A fan-out retry of the healer while the first copy's heal is in flight.
    // (Not Promise.all: two simultaneous first imports of the mocked prisma
    // inside action-attempts' deps() hand one caller the REAL client under
    // vitest, so that run would lose on a connection error, not on the claim.)
    let release: (v: unknown) => void = () => {};
    h.runManifestCron.mockImplementationOnce(() => new Promise((r) => (release = r)));
    h.deck.mockResolvedValue({ rows: [failedRow()] });

    const first = runAutonomicOrchestrator();
    await vi.waitFor(() => expect(h.runManifestCron).toHaveBeenCalledTimes(1));
    const second = await runAutonomicOrchestrator();
    release({ ok: true, status: 200, durationMs: 5 });
    await first;

    expect(h.runManifestCron).toHaveBeenCalledTimes(1);
    expect(second.healedCrons).toEqual([]);
    expect(second.cronErrors).toEqual([]);
  });

  it("CONTROL: a NEW failed run of the same job is healed again", async () => {
    h.deck.mockResolvedValueOnce({ rows: [failedRow({ lastRunAt: isoAgo(30 * HOUR) })] });
    h.deck.mockResolvedValueOnce({ rows: [failedRow({ lastRunAt: isoAgo(1 * HOUR) })] });

    await runAutonomicOrchestrator();
    await runAutonomicOrchestrator();

    expect(h.runManifestCron).toHaveBeenCalledTimes(2);
  });

  it("a claim store that cannot be reached fires nothing, and the run says why", async () => {
    h.storeDown = true;
    h.deck.mockResolvedValue({ rows: [failedRow()] });

    const res = await runAutonomicOrchestrator();

    expect(h.runManifestCron).not.toHaveBeenCalled();
    expect(res.cronErrors).toEqual([expect.stringMatching(/^weekly-maint: .*claim.*db down/)]);
  });
});

// UNKNOWN is kept for a heal whose outcome really is unknown; the healer's next
// run resolves it from the healed run's own row (the describe after this one).
describe("cron healer · a heal's claim is settled by what came back", () => {
  it("an HTTP error response is a known failure (FAILED), not an open UNKNOWN", async () => {
    h.runManifestCron.mockResolvedValue({ ok: false, status: 500, durationMs: 5 });
    h.deck.mockResolvedValue({ rows: [failedRow()] });

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["FAILED"]);
  });

  it("a heal that threw is a known failure: runManifestCron throws only before it sends", async () => {
    h.runManifestCron.mockRejectedValue(new Error("boom"));
    h.deck.mockResolvedValue({ rows: [failedRow()] });

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["FAILED"]);
  });

  it("CONTROL: no response (timeout, network) stays UNKNOWN: the job may still be running", async () => {
    h.runManifestCron.mockResolvedValue({ ok: false, status: 0, durationMs: 55_000 });
    h.deck.mockResolvedValue({ rows: [failedRow()] });

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["UNKNOWN"]);
  });
});

// triggerCronByPath aborts at 55 s and most cron routes run longer, so a heal of
// a long job settles UNKNOWN while the job keeps running. The healed route opens
// its own cron_job_logs row when it starts (logCronRun), so the first run row
// after the heal began is the heal's run: the next healer run settles the claim
// by that row. Nothing else ever resolves an UNKNOWN.
describe("cron healer · a timed-out heal is resolved from the healed run's own row", () => {
  /** Heal weekly-maint with no response (the 55 s abort): its claim settles UNKNOWN. */
  async function timedOutHeal(): Promise<number> {
    h.runManifestCron.mockResolvedValueOnce({ ok: false, status: 0, durationMs: 55_000, error: "aborted due to timeout" });
    h.deck.mockResolvedValueOnce({ rows: [failedRow()] });
    await runAutonomicOrchestrator();
    expect(states()).toEqual(["UNKNOWN"]);
    // lib/system/owner-panel-data.ts bounds UNKNOWN rows of this tool by name.
    expect(attempt().tool).toBe("cron.heal");
    // The next run has nothing to heal, so only the resolution can change the row.
    h.deck.mockResolvedValue({ rows: [] });
    return (attempt().startedAt as Date).getTime();
  }
  const attempt = () => [...h.attempts.values()][0];
  const cronRow = (id: string, status: string, at: number) =>
    h.cronLogs.push({ id, jobName: "weekly-maint", status, createdAt: new Date(at) });

  it("the healed run ended success: the next healer run marks the heal VERIFIED, citing the row", async () => {
    const startedAt = await timedOutHeal();
    cronRow("log_heal", "success", startedAt + 1_000);

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["VERIFIED"]);
    expect(attempt().receiptId).toBe("log_heal");
    expect(h.runManifestCron).toHaveBeenCalledTimes(1);
  });

  it("the healed run ended failed: the heal is FAILED, citing the row", async () => {
    const startedAt = await timedOutHeal();
    cronRow("log_heal", "failed", startedAt + 1_000);

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["FAILED"]);
    expect(attempt().reason).toMatch(/log_heal/);
  });

  it("the healed run is still in flight (its row is still `started`): the heal stays UNKNOWN", async () => {
    const startedAt = await timedOutHeal();
    cronRow("log_heal", "started", startedAt + 1_000);

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["UNKNOWN"]);
  });

  it("a row from before the heal started never resolves it", async () => {
    const startedAt = await timedOutHeal();
    cronRow("log_original_failure", "failed", startedAt - 2 * HOUR);

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["UNKNOWN"]);
  });

  it("the first run after the heal decides, not a later scheduled one", async () => {
    const startedAt = await timedOutHeal();
    cronRow("log_next_day", "success", startedAt + DAY);
    cronRow("log_heal", "failed", startedAt + 1_000);

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["FAILED"]);
    expect(attempt().receiptId).toBe("log_heal");
  });

  it("a cron_job_logs read that fails leaves the heal UNKNOWN and still heals other jobs", async () => {
    await timedOutHeal();
    h.cronLogsDown = true;
    h.deck.mockResolvedValue({ rows: [failedRow({ name: "other-weekly" })] });

    const res = await runAutonomicOrchestrator();

    expect(states()).toEqual(["UNKNOWN", "SUCCEEDED_UNVERIFIED"]);
    expect(res.healedCrons).toEqual(["other-weekly"]);
  });
});

// P-HEAL: a healer killed between claiming and settling left the claim EXECUTING
// forever, and the resolver read UNKNOWN only. A live heal settles within about a
// minute (triggerCronByPath aborts at 55 s), so an old EXECUTING claim lost its healer.
describe("cron healer: a heal killed mid-flight is settled from the healed run's row", () => {
  const MIN = 60_000;
  const executing = (ageMs: number) => {
    const startedAt = new Date(Date.now() - ageMs);
    h.attempts.set("cron-heal:weekly-maint:x", {
      id: "att_dead",
      operationKey: "cron-heal:weekly-maint:x",
      tool: "cron.heal",
      state: "EXECUTING",
      attemptNo: 1,
      startedAt,
      holdUntil: new Date(Date.now() + DAY),
    });
    h.deck.mockResolvedValue({ rows: [] });
    return startedAt.getTime();
  };
  const cronRow = (id: string, status: string, at: number) =>
    h.cronLogs.push({ id, jobName: "weekly-maint", status, createdAt: new Date(at) });
  const row = () => h.attempts.get("cron-heal:weekly-maint:x")!;

  it("an EXECUTING heal past the timeout whose run succeeded is VERIFIED, citing the row", async () => {
    const startedAt = executing(2 * HOUR);
    cronRow("log_heal", "success", startedAt + 1_000);
    await runAutonomicOrchestrator();
    expect(row().state).toBe("VERIFIED");
    expect(row().receiptId).toBe("log_heal");
  });

  it("an EXECUTING heal past the timeout whose run failed is FAILED, citing the row", async () => {
    const startedAt = executing(2 * HOUR);
    cronRow("log_heal", "failed", startedAt + 1_000);
    await runAutonomicOrchestrator();
    expect(row().state).toBe("FAILED");
    expect(row().reason).toMatch(/log_heal/);
  });

  it("CONTROL: an EXECUTING heal inside the timeout is left alone (its healer may be live)", async () => {
    const startedAt = executing(2 * MIN);
    cronRow("log_heal", "success", startedAt + 1_000);
    await runAutonomicOrchestrator();
    expect(row().state).toBe("EXECUTING");
  });

  it("RACE: a heal that settles between the resolver's read and write keeps its own outcome", async () => {
    const startedAt = executing(2 * HOUR);
    cronRow("log_heal", "success", startedAt + 1_000);
    h.afterAttemptRead = () => {
      row().state = "FAILED"; // the original healer settles it in the gap
      h.afterAttemptRead = null;
    };
    await runAutonomicOrchestrator();
    expect(row().state).toBe("FAILED");
  });
});

// Codex P2 on #2984: the name+time rule let a later SCHEDULED success verify a heal
// that never reached the route, and an unrelated failure fail a good one. A heal now
// sends x-cron-trigger-id: heal:<attemptId>, the route stamps it on its own row, and
// the resolver matches that row only.
describe("cron healer: a timed-out heal settles only from the row its own trigger opened", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z")); // after HEAL_TRIGGER_CUTOFF
  });
  async function timedOutHeal(): Promise<number> {
    h.runManifestCron.mockResolvedValueOnce({ ok: false, status: 0, durationMs: 55_000, error: "aborted due to timeout" });
    h.deck.mockResolvedValueOnce({ rows: [failedRow()] });
    await runAutonomicOrchestrator();
    expect(states()).toEqual(["UNKNOWN"]);
    h.deck.mockResolvedValue({ rows: [] });
    return (attempt().startedAt as Date).getTime();
  }
  const attempt = () => [...h.attempts.values()][0];
  const cronRow = (id: string, status: string, at: number, triggerId: string | null) =>
    h.cronLogs.push({ id, jobName: "weekly-maint", status, createdAt: new Date(at), triggerId });

  it("a later scheduled success with no trigger id does NOT verify the heal", async () => {
    const startedAt = await timedOutHeal();
    cronRow("log_scheduled", "success", startedAt + 1_000, null);

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["UNKNOWN"]);
  });

  it("an unrelated failure with no trigger id does NOT fail the heal", async () => {
    const startedAt = await timedOutHeal();
    cronRow("log_scheduled", "failed", startedAt + 1_000, null);

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["UNKNOWN"]);
  });

  it("the healed run's own row (trigger id match) settles it VERIFIED, even after an earlier scheduled failure", async () => {
    const startedAt = await timedOutHeal();
    cronRow("log_scheduled", "failed", startedAt + 1_000, null);
    cronRow("log_heal", "success", startedAt + 2_000, "heal:att_1");

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["VERIFIED"]);
    expect(attempt().receiptId).toBe("log_heal");
  });

  it("the healed run's own row ended failed: the heal is FAILED, citing it", async () => {
    const startedAt = await timedOutHeal();
    cronRow("log_scheduled", "success", startedAt + 1_000, null);
    cronRow("log_heal", "failed", startedAt + 2_000, "heal:att_1");

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["FAILED"]);
    expect(attempt().receiptId).toBe("log_heal");
  });

  it("another heal's row never settles this one", async () => {
    const startedAt = await timedOutHeal();
    cronRow("log_other_heal", "success", startedAt + 1_000, "heal:att_other");

    await runAutonomicOrchestrator();

    expect(states()).toEqual(["UNKNOWN"]);
  });
});
