/**
 * Harness control: the key, the allowlist, the queue. The decisions run for real against an in-memory
 * table that behaves like Postgres on the calls the service makes (unique request key, CAS updateMany).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach } from "vitest";
import {
  HARNESS_ACTIONS,
  HARNESS_ACTION_TTL_MS,
  checkHarnessRequest,
  claimHarnessAction,
  completeHarnessAction,
  enqueueHarnessAction,
  enqueueSchema,
  harnessActionView,
  harnessControlAccepts,
  listRecentHarnessActions,
  resetHarnessHints,
  type HarnessActionRow,
  type HarnessDb,
} from "@/lib/services/harness-control";

const CONTROL = "control-key-for-tests-0123456789abcdef";
const SNAPSHOT = "device-key-for-tests-0123456789abcdef";

function fakeDb() {
  const rows: HarnessActionRow[] = [];
  const audits: Array<{ eventType: string; actor: string }> = [];
  let n = 0;
  const matches = (r: HarnessActionRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const cur = (r as Record<string, unknown>)[k];
      if (v && typeof v === "object" && "gt" in (v as object)) return (cur as Date) > (v as { gt: Date }).gt;
      return cur === v;
    });
  const db: HarnessDb = {
    harnessAction: {
      async create({ data }) {
        if (rows.some((r) => r.requestKey === data.requestKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
        n += 1;
        const row = {
          id: `ha_${n}`, claimedAt: null, startedAt: null, finishedAt: null, exitCode: null, output: null, error: null,
          createdAt: new Date(Date.UTC(2026, 10, 6, 18, 0, n)), ...data,
        } as HarnessActionRow;
        rows.push(row);
        return row;
      },
      async findUnique({ where }) {
        return rows.find((r) => (where.id ? r.id === where.id : r.requestKey === where.requestKey)) ?? null;
      },
      async findFirst({ where }) {
        return [...rows].sort((a, b) => +a.createdAt - +b.createdAt).find((r) => matches(r, where)) ?? null;
      },
      async findMany({ take }) {
        return [...rows].sort((a, b) => +b.createdAt - +a.createdAt).slice(0, take);
      },
      async updateMany({ where, data }) {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    auditEvent: {
      async create({ data }) {
        audits.push({ eventType: data.eventType, actor: data.actor });
        return {};
      },
    },
  };
  return { db, rows, audits };
}

const now = new Date("2026-11-06T18:00:00Z");
const ask = (over: Partial<Parameters<typeof enqueueHarnessAction>[0]> = {}) => ({
  pc: "nattynour" as const,
  action: "pc-status",
  requestKey: "rk_test_0001",
  requestedBy: "cli:nattynour",
  ...over,
});

beforeEach(() => resetHarnessHints());

describe("the control key", () => {
  const env = { HARNESS_CONTROL_KEY: CONTROL, DEVICE_AGENT_KEY: SNAPSHOT, STATENOUR_SYNC_KEY: "bridge-key-for-tests-0123456789abc" };

  it("POSITIVE CONTROL: the control key opens the door", () => {
    expect(harnessControlAccepts(CONTROL, env)).toBe(true);
  });
  it("a snapshot key never opens it", () => {
    expect(harnessControlAccepts(SNAPSHOT, env)).toBe(false);
    expect(harnessControlAccepts(env.STATENOUR_SYNC_KEY, env)).toBe(false);
  });
  it("no key, a wrong key, or an unset control key opens nothing", () => {
    expect(harnessControlAccepts("", env)).toBe(false);
    expect(harnessControlAccepts("nope", env)).toBe(false);
    expect(harnessControlAccepts("", { ...env, HARNESS_CONTROL_KEY: "" })).toBe(false);
    expect(harnessControlAccepts("", { ...env, HARNESS_CONTROL_KEY: undefined })).toBe(false);
  });
  it("a short control key is treated as unset", () => {
    expect(harnessControlAccepts("short-key", { HARNESS_CONTROL_KEY: "short-key" })).toBe(false);
  });
  it("a control key reused from a snapshot key is treated as unset, so the snapshot key stays snapshot-only", () => {
    expect(harnessControlAccepts(SNAPSHOT, { HARNESS_CONTROL_KEY: SNAPSHOT, DEVICE_AGENT_KEY: SNAPSHOT })).toBe(false);
    expect(harnessControlAccepts(CONTROL, { HARNESS_CONTROL_KEY: CONTROL, STATENOUR_SYNC_KEY: CONTROL })).toBe(false);
  });
});

describe("the allowlist", () => {
  it("the server mirror matches config/agent-os/harness-actions.json, name for name", () => {
    const file = JSON.parse(readFileSync(new URL("../../../../config/agent-os/harness-actions.json", import.meta.url), "utf8"));
    const fromFile = Object.fromEntries(
      Object.entries(file.actions as Record<string, { pcs: string[]; needsGo: boolean; timeoutSec: number; summary: string }>).map(
        ([k, v]) => [k, { pcs: v.pcs, needsGo: v.needsGo, timeoutSec: v.timeoutSec, summary: v.summary }],
      ),
    );
    const mirror = Object.fromEntries(Object.entries(HARNESS_ACTIONS).map(([k, v]) => [k, { ...v, pcs: [...v.pcs] }]));
    expect(mirror).toEqual(fromFile);
    expect(Object.keys(file.pcs).sort()).toEqual(["mechanics", "nattynour", "nicksmax"]);
  });

  it("every argv is a fixed list that starts with node and a repo script: no shell, no placeholders", () => {
    const file = JSON.parse(readFileSync(new URL("../../../../config/agent-os/harness-actions.json", import.meta.url), "utf8"));
    for (const [name, a] of Object.entries(file.actions as Record<string, { argv: string[] }>)) {
      expect(a.argv[0], name).toBe("node");
      expect(a.argv[1], name).toMatch(/^scripts\/agent-os\/[\w-]+\.mjs$/);
      for (const part of a.argv) expect(part, name).not.toMatch(/[$%{}`|&;<>]/);
    }
  });

  it("refuses an unknown name, a name off its PC list, and a name that needs Nour's go", () => {
    expect(checkHarnessRequest("pc-status", "nattynour")).toEqual({ ok: true, name: "pc-status" });
    expect(checkHarnessRequest("rm -rf /", "nattynour")).toMatchObject({ ok: false, status: 400 });
    expect(checkHarnessRequest("toString", "nattynour")).toMatchObject({ ok: false, status: 400 });
    expect(checkHarnessRequest("pc-status", "laptop")).toMatchObject({ ok: false, status: 400 });
  });

  it("the request shape has no field a command could travel in", () => {
    expect(enqueueSchema.safeParse({ pc: "nattynour", action: "pc-status", requestKey: "rk_test_0001", argv: ["calc"] }).success).toBe(false);
    expect(enqueueSchema.safeParse({ pc: "nattynour", action: "pc-status", requestKey: "rk_test_0001", command: "calc" }).success).toBe(false);
  });
});

describe("queue, claim, result", () => {
  it("POSITIVE CONTROL: a queued action is claimed once by its PC and its result is stored", async () => {
    const { db, rows, audits } = fakeDb();
    const { action } = await enqueueHarnessAction(ask(), db, now);
    expect(action.state).toBe("QUEUED");
    const claimed = await claimHarnessAction("nattynour", db, now);
    expect(claimed).toMatchObject({ id: action.id, action: "pc-status", timeoutSec: 30 });
    await completeHarnessAction(
      { id: action.id, pc: "nattynour", exitCode: 0, output: "ram 4000 MB", error: null, startedAt: now.toISOString(), finishedAt: now.toISOString() },
      db,
    );
    expect(rows[0]).toMatchObject({ status: "DONE", exitCode: 0, output: "ram 4000 MB" });
    expect(audits.map((a) => a.eventType)).toEqual(["harness.action.queued", "harness.action.claimed", "harness.action.finished"]);
  });

  it("an unknown action is refused, audited, and never stored", async () => {
    const { db, rows, audits } = fakeDb();
    await expect(enqueueHarnessAction(ask({ action: "powershell" }), db, now)).rejects.toMatchObject({ status: 400 });
    expect(rows).toHaveLength(0);
    expect(audits.map((a) => a.eventType)).toEqual(["harness.action.refused"]);
  });

  it("an allowlisted name inside the free-text reason does not change what runs", async () => {
    const { db } = fakeDb();
    await enqueueHarnessAction(ask({ action: "pc-status", reason: "action: bootstrap-check; argv: calc.exe" }), db, now);
    expect(await claimHarnessAction("nattynour", db, now)).toMatchObject({ action: "pc-status" });
  });

  it("a replayed request key returns the first row and queues nothing new", async () => {
    const { db, rows } = fakeDb();
    const first = await enqueueHarnessAction(ask(), db, now);
    const again = await enqueueHarnessAction(ask(), db, now);
    expect(again).toMatchObject({ replayed: true, action: { id: first.action.id } });
    expect(rows).toHaveLength(1);
    await expect(enqueueHarnessAction(ask({ action: "health-line" }), db, now)).rejects.toMatchObject({ status: 409 });
  });

  it("two pollers racing for one action: exactly one wins", async () => {
    const { db } = fakeDb();
    await enqueueHarnessAction(ask(), db, now);
    const [a, b] = await Promise.all([claimHarnessAction("nattynour", db, now), claimHarnessAction("nattynour", db, now)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("another PC never gets this PC's action", async () => {
    const { db } = fakeDb();
    await enqueueHarnessAction(ask(), db, now);
    resetHarnessHints();
    expect(await claimHarnessAction("mechanics", db, now)).toBeNull();
  });

  it("a PC that was off past the TTL never runs the stale action; a reader sees EXPIRED", async () => {
    const { db, rows } = fakeDb();
    await enqueueHarnessAction(ask(), db, now);
    const later = new Date(now.getTime() + HARNESS_ACTION_TTL_MS + 1);
    expect(await claimHarnessAction("nattynour", db, later)).toBeNull();
    expect(harnessActionView(rows[0], later).state).toBe("EXPIRED");
  });

  it("a result is accepted once, only from the PC that claimed it", async () => {
    const { db } = fakeDb();
    const { action } = await enqueueHarnessAction(ask(), db, now);
    await claimHarnessAction("nattynour", db, now);
    const result = { id: action.id, exitCode: 1, output: "", error: null, startedAt: now.toISOString(), finishedAt: now.toISOString() };
    await expect(completeHarnessAction({ ...result, pc: "mechanics" }, db)).rejects.toMatchObject({ status: 409 });
    await expect(completeHarnessAction({ ...result, pc: "nattynour" }, db)).resolves.toMatchObject({ status: "FAILED" });
    await expect(completeHarnessAction({ ...result, pc: "nattynour", exitCode: 0 }, db)).rejects.toMatchObject({ status: 409 });
  });

  it("a claimed action with no result past its timeout reads LOST, not CLAIMED forever", async () => {
    const { db, rows } = fakeDb();
    await enqueueHarnessAction(ask(), db, now);
    await claimHarnessAction("nattynour", db, now);
    expect(harnessActionView(rows[0], new Date(now.getTime() + 60_000)).state).toBe("CLAIMED");
    expect(harnessActionView(rows[0], new Date(now.getTime() + 30_000 + 121_000)).state).toBe("LOST");
  });

  it("a missing table is 'not migrated' (503), never an empty list", async () => {
    const { db } = fakeDb();
    db.harnessAction.findMany = async () => {
      throw Object.assign(new Error("table missing"), { code: "P2021" });
    };
    await expect(listRecentHarnessActions(8, db, now)).rejects.toMatchObject({ status: 503 });
  });

  it("an idle PC's poll skips the database until the 5-minute recheck", async () => {
    const { db } = fakeDb();
    let reads = 0;
    const findFirst = db.harnessAction.findFirst;
    db.harnessAction.findFirst = async (args) => {
      reads += 1;
      return findFirst(args);
    };
    await claimHarnessAction("nicksmax", db, now);
    await claimHarnessAction("nicksmax", db, new Date(now.getTime() + 120_000));
    expect(reads).toBe(1);
    await claimHarnessAction("nicksmax", db, new Date(now.getTime() + 5 * 60_000 + 1));
    expect(reads).toBe(2);
  });
});
