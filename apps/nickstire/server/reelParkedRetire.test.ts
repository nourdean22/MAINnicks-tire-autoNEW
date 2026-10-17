/**
 * F6 (2026-10-17) · parked reels retire automatically, so parked rows can never
 * fill the drain window.
 *
 * Operator decision 2026-10-13 (3): "parked reels RETIRE automatically".
 *
 * The drain reads approved assembled jobs oldest id first, 25 at a time. A parked
 * reel (reject, stock_fallback, needs_review, an unclearable or unauthorized paid
 * repair) reads the same on every pulse, so 25 of them ahead of a clean reel kept
 * the clean one out of the window forever. Retirement moves a parked reel to the
 * house "closed" shape the operator's own Archive button writes (status failed,
 * the reason in `error`): never a delete, CAS on status = assembled, idempotent.
 * A paid repair that a budget refusal may be holding is NOT parked and never retires.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const DAY = 24 * 3600_000;
const dialect = new MySqlDialect();

type Row = { id: number; status: string; error: string | null; payload: string; productionReadyAt: Date | null; createdAt: Date; igPostId: string | null; mp4Url: string; queueState?: string };
let rows: Row[] = [];
let kv = new Map<string, string>();
let gates: Record<number, { gate: string; allowed: boolean; findings: unknown[]; repairAttempts: number } | Error> = {};
let policy: Record<string, unknown> = {};

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (t: unknown) => {
        const name = getTableName(t as never);
        let result: unknown[] = [];
        if (name === "reel_jobs") result = rows.filter((r) => r.status === "assembled").sort((a, b) => a.id - b.id);
        if (name === "shop_settings") result = [...kv].map(([key, value]) => ({ key, value }));
        const tail = { limit: async (n: number) => result.slice(0, n) };
        return { where: () => ({ ...tail, orderBy: () => tail }) };
      },
    }),
    update: (t: unknown) => ({
      set: (v: Record<string, unknown>) => ({
        where: async (cond: never) => {
          const params = dialect.sqlToQuery(cond).params;
          if (getTableName(t as never) === "shop_settings") { kv.set(String(params[0] ?? "k"), String(v.value)); return [{ affectedRows: 1 }]; }
          // and(eq(id, X), eq(status, "assembled")): the CAS the retirement must use
          const row = rows.find((r) => r.id === params[0] && r.status === params[1]);
          if (!row) return [{ affectedRows: 0 }];
          Object.assign(row, v);
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    insert: () => ({ values: async (v: { key: string; value: string }) => { kv.set(v.key, v.value); } }),
  }),
}));
vi.mock("./services/qualityGate", () => ({
  evaluateReelPublishGate: async (id: number) => { const g = gates[id]; if (g instanceof Error) throw g; return g ?? { gate: "proceed", allowed: true, findings: [], repairAttempts: 0, source: "persisted", reason: "" }; },
}));
vi.mock("./services/autonomyControl", () => ({
  getActivePolicy: async () => policy,
}));

const job = (id: number, ageDays: number, over: Partial<Row> = {}): Row => ({
  id, status: "assembled", error: null, payload: "{}", productionReadyAt: new Date(NOW - ageDays * DAY),
  createdAt: new Date(NOW - ageDays * DAY), igPostId: null, mp4Url: `https://x/reels/reel-${id}.mp4`, ...over,
});
const parked = (gate: string) => ({ gate, allowed: false, findings: [], repairAttempts: 0 });
/** The drain's own window: status assembled, oldest id first, 25 at a time. */
const drainWindow = () => rows.filter((r) => r.status === "assembled").sort((a, b) => a.id - b.id).slice(0, 25).map((r) => r.id);

beforeEach(() => {
  rows = []; kv = new Map(); gates = {};
  policy = { autonomousRepair: { paidBeatRegeneration: "approval_required" }, limits: { maxRepairAttemptsPerAsset: 2 } };
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => { vi.useRealTimers(); });

async function retire() {
  const { retireParkedReels } = await import("./cron/jobs/dailyReelPost");
  return retireParkedReels(NOW);
}

describe("retireParkedReels", () => {
  it("POSITIVE CONTROL: a clean reel and a young parked reel under the cap are left alone", async () => {
    rows = [job(1, 0.5), job(2, 1)];
    gates = { 2: parked("needs_review") };
    const out = await retire();
    expect(out.retired).toEqual([]);
    expect(rows.map((r) => r.status)).toEqual(["assembled", "assembled"]);
  });

  it("a parked reel older than the threshold retires, with a written reason, and is never deleted", async () => {
    rows = [job(1, 8), job(2, 9), job(3, 10), job(4, 0.5)];
    gates = { 1: parked("reject"), 2: parked("stock_fallback"), 3: parked("needs_review") };
    const out = await retire();
    expect(out.retired.map((r) => r.jobId)).toEqual([1, 2, 3]);
    expect(rows).toHaveLength(4);
    for (const r of rows.slice(0, 3)) {
      expect(r.status).toBe("failed");
      expect(r.queueState).toBe("blocked");
      expect(r.error).toMatch(/^retired automatically: parked on (reject|stock_fallback|needs_review)/);
    }
    expect(rows[3].status).toBe("assembled");
  });

  it("30 parked + 1 clean: the cap keeps the newest 10, so the clean reel reaches the drain window", async () => {
    rows = Array.from({ length: 30 }, (_, i) => job(i + 1, 2 - i * 0.01)); // young: only the cap can retire them
    for (const r of rows) gates[r.id] = parked("needs_review");
    rows.push(job(31, 0.1)); // the clean one, newest id
    expect(drainWindow()).not.toContain(31); // CONTROL: before retirement it is outside the window
    const out = await retire();
    expect(out.retired).toHaveLength(20);
    expect(rows.filter((r) => r.status === "assembled" && r.id <= 30).map((r) => r.id)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect(drainWindow()).toContain(31);
  });

  it("a paid repair that could still run (policy auto, clearable) is a possible budget HOLD: never retired, however old", async () => {
    policy = { autonomousRepair: { paidBeatRegeneration: "auto" }, limits: { maxRepairAttemptsPerAsset: 2 } };
    const oneBeat = [{ code: "MALFORMED_GEOMETRY", severity: "block", beatNumber: 2, description: "", preserve: [], change: [] }];
    const payload = JSON.stringify({ storyboardBeats: [{ beatNumber: 1, visual: "tire tread macro" }, { beatNumber: 2, visual: "brake pad macro" }], promptPack: [{ beatNumber: 1, prompt: "a" }, { beatNumber: 2, prompt: "b" }] });
    rows = Array.from({ length: 15 }, (_, i) => job(i + 1, 30, { payload }));
    for (const r of rows) gates[r.id] = { ...parked("needs_paid_repair"), findings: oneBeat };
    // CONTROL: the verdict really is clearable, so "a repair could still run" is why nothing retires
    // (the approval_required case below retires the same gate).
    const { paidRepairCanClearVerdict } = await import("./services/repairRouter");
    expect(paidRepairCanClearVerdict(oneBeat as never, { repairAttempts: 0, maxRepairAttempts: 2 }).clearable).toBe(true);
    const out = await retire();
    expect(out.retired).toEqual([]);
    expect(rows.every((r) => r.status === "assembled")).toBe(true);
  });

  it("the DEFAULT policy (getActivePolicy's fallback on a read error or an invalid row) skips the whole pass", async () => {
    // getActivePolicy never throws: it returns this exact object, whose approval_required and
    // cap 2 are not the operator's real policy, so a held paid repair would read as a park.
    const { DEFAULT_AUTONOMY_POLICY } = await import("../client/src/lib/autonomyPolicy");
    policy = DEFAULT_AUTONOMY_POLICY as unknown as Record<string, unknown>;
    rows = [job(1, 30), job(2, 30)];
    gates = { 1: parked("needs_paid_repair"), 2: parked("reject") };
    const out = await retire();
    expect(out.retired).toEqual([]);
    expect(out.skippedRun).toBe("default_policy");
    expect(rows.every((r) => r.status === "assembled")).toBe(true);
  });

  it("CONTROL: a stored policy with the same values as DEFAULT, but not the fallback object, does run", async () => {
    const { DEFAULT_AUTONOMY_POLICY } = await import("../client/src/lib/autonomyPolicy");
    policy = structuredClone(DEFAULT_AUTONOMY_POLICY) as unknown as Record<string, unknown>;
    rows = [job(2, 30)];
    gates = { 2: parked("reject") };
    expect((await retire()).retired.map((r) => r.jobId)).toEqual([2]);
  });

  it("a paid repair that cannot run (spend not authorized) is a park and retires past the threshold", async () => {
    rows = [job(1, 30)];
    gates = { 1: parked("needs_paid_repair") };
    const out = await retire();
    expect(out.retired.map((r) => r.jobId)).toEqual([1]);
    expect(rows[0].error).toMatch(/^retired automatically: parked on needs_paid_repair/);
  });

  it("a transient gate (unavailable, auto_repair, stale) and an unreadable gate never retire", async () => {
    rows = [job(1, 30), job(2, 30), job(3, 30), job(4, 30)];
    gates = { 1: parked("unavailable"), 2: parked("auto_repair"), 3: parked("stale"), 4: new Error("gate read failed") };
    expect((await retire()).retired).toEqual([]);
  });

  it("an already-published row is never retired", async () => {
    rows = [job(1, 30, { igPostId: "ig_1" })];
    gates = { 1: parked("reject") };
    expect((await retire()).retired).toEqual([]);
  });

  it("idempotent: a second run retires nothing and rewrites nothing", async () => {
    rows = [job(1, 30), job(2, 30)];
    gates = { 1: parked("reject"), 2: parked("reject") };
    expect((await retire()).retired).toHaveLength(2);
    const firstErrors = rows.map((r) => r.error);
    kv.clear(); // past the hourly throttle
    const again = await retire();
    expect(again.retired).toEqual([]);
    expect(rows.map((r) => r.error)).toEqual(firstErrors);
  });

  it("throttled to once an hour: an immediate second pulse does not rescan", async () => {
    rows = [job(1, 30)];
    gates = { 1: parked("reject") };
    await retire();
    rows.push(job(2, 30)); gates[2] = parked("reject");
    const again = await retire();
    expect(again.retired).toEqual([]);
    expect(again.skippedRun).toBe("throttled");
  });
});

describe("wiring", () => {
  const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");
  const GATE = readFileSync(path.join(__dirname, "services", "qualityGate.ts"), "utf8");

  it("a pass that will drain retires parked reels first: after the arm switch and slot guard, before the drain query", () => {
    const body = CRON.slice(CRON.indexOf("\nasync function runDailyReelPostOnce("));
    const call = body.indexOf("await retireParkedReels();");
    expect(call).toBeGreaterThan(-1);
    expect(body.indexOf("await retireParkedReels();", call + 1)).toBe(-1);
    // CONTROL anchors exist, so the ordering below is not vacuous.
    const armed = body.indexOf('process.env.REEL_AUTOPOST_ENABLED !== "true"');
    const slotGuard = body.indexOf("if (posted >= POST_SLOT_OPEN_HOURS_ET.length) {");
    const drainQuery = body.indexOf(".limit(DRAIN_SCAN_LIMIT)");
    for (const i of [armed, slotGuard, drainQuery]) expect(i).toBeGreaterThan(-1);
    expect(armed).toBeLessThan(call);
    expect(slotGuard).toBeLessThan(call);
    expect(call).toBeLessThan(drainQuery);
    // A retirement failure is caught: it never stops the pulse.
    expect(body.slice(call - 20, call)).toContain("try {");
  });

  it("the drain still reads only status 'assembled', so a retired row is never a candidate", () => {
    expect(CRON).toContain('eq(reelJobs.status, "assembled"),\n              isNotNull(reelJobs.mp4Url),');
  });

  it("the provider-health breaker does not count retirements as provider failures", () => {
    const breaker = GATE.slice(GATE.indexOf("let providerHealthy = true;"), GATE.indexOf("providerHealthy = Number("));
    expect(breaker).toContain('inArray(reelJobs.status, ["failed", "needs_regen"])');
    expect(breaker).toContain("retired automatically");
  });
});
