/**
 * Stale-lead TRUTH (Autopilot Wave 1, 2026-07-29).
 *
 * The defect: the at-most-once claim flipped status='contacted',
 * contacted=1, contactedAt=NOW() BEFORE the send — so a BLOCKED or FAILED
 * orchestration left the lead permanently recorded as contacted, invisible
 * to every recovery rail, poisoning time-to-contact metrics.
 *
 * Pinned here:
 *   1. A blocked/failed orchestration leaves the lead status='new' (only the
 *      lastFollowUpAt claim stamp is written).
 *   2. A sent/queued orchestration marks contacted AFTER dispatch.
 *   3. The eligibility SELECT excludes already-claimed rows (isNull guard).
 *   4. Channel dedupe: a pending callback or a recent inbound SMS skips the
 *      lead entirely (no claim, no send).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let orchestrateResult: { status: string } = { status: "sent" };
const orchestrateSpy = vi.fn(async () => orchestrateResult);
vi.mock("./services/smsOrchestrator", () => ({
  orchestrateSms: (...args: unknown[]) => orchestrateSpy(...args),
}));

vi.mock("./services/featureFlags", () => ({
  isEnabled: async () => true,
}));

let leadRows: Array<Record<string, unknown>> = [];
let callbackRows: Array<Record<string, unknown>> = [];
let inboundRows: Array<Record<string, unknown>> = [];
let updateSets: Array<Record<string, unknown>> = [];
let selectWhereArgs: unknown[] = [];
let guardThrow = false;

vi.mock("./db", () => ({
  getDb: async () => {
    let selectCall = 0;
    return {
      select: () => {
        selectCall++;
        const isLeadSelect = selectCall === 1;
        return {
          from: () => ({
            where: (arg: unknown) => {
              if (isLeadSelect) selectWhereArgs.push(arg);
              // leads select chains .limit(); the opt-out select is awaited
              // directly — thenable-with-limit serves both.
              return Object.assign(
                Promise.resolve(isLeadSelect ? [] : []),
                { limit: async () => (isLeadSelect ? leadRows : []) },
              );
            },
          }),
        };
      },
      update: () => ({
        set: (payload: Record<string, unknown>) => ({
          where: async () => {
            updateSets.push(payload);
            return [{ affectedRows: 1 }];
          },
        }),
      }),
      execute: async (q: unknown) => {
        if (guardThrow) throw new Error("guard query exploded");
        const text = JSON.stringify(q);
        if (text.includes("callback_requests")) return [callbackRows];
        if (text.includes("sms_messages")) return [inboundRows];
        return [[]];
      },
    };
  },
}));

const LEAD = {
  id: 7,
  phone: "2165550107",
  status: "new",
  source: "popup",
  createdAt: new Date(Date.now() - 5 * 3600_000),
  lastFollowUpAt: null,
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  // Tue 2026-07-28 12:00 ET — inside the 8-18 business-hours gate.
  vi.setSystemTime(new Date("2026-07-28T16:00:00.000Z"));
  orchestrateResult = { status: "sent" };
  orchestrateSpy.mockClear();
  leadRows = [{ ...LEAD }];
  callbackRows = [];
  inboundRows = [];
  updateSets = [];
  selectWhereArgs = [];
});

afterEach(() => {
  vi.useRealTimers();
});

async function run() {
  const { processStaleLeadFollowUp } = await import("./cron/jobs/staleLeadFollowup");
  return processStaleLeadFollowUp();
}

describe("stale-lead truth", () => {
  it("SENT: claim stamps ONLY lastFollowUpAt; contacted is written AFTER dispatch", async () => {
    orchestrateResult = { status: "sent" };
    const res = await run();
    expect(res.recordsProcessed).toBe(1);
    expect(updateSets.length).toBe(2);
    // claim: lastFollowUpAt only — no status, no contacted, no contactedAt
    expect(Object.keys(updateSets[0])).toEqual(["lastFollowUpAt"]);
    // post-dispatch: the real contact event
    expect(updateSets[1]).toMatchObject({ status: "contacted", contacted: 1 });
    expect(updateSets[1].contactedAt).toBeInstanceOf(Date);
  });

  it("QUEUED counts as confirmed dispatch (durable queue delivers)", async () => {
    orchestrateResult = { status: "queued" };
    const res = await run();
    expect(res.recordsProcessed).toBe(1);
    expect(updateSets.length).toBe(2);
    expect(updateSets[1]).toMatchObject({ status: "contacted" });
  });

  for (const status of ["blocked", "failed", "drafted", "skipped"]) {
    it(`${status.toUpperCase()}: lead stays status='new' — NEVER marked contacted without contact`, async () => {
      orchestrateResult = { status };
      const res = await run();
      expect(res.recordsProcessed).toBe(0);
      // Only the claim stamp ran; no update ever wrote status/contacted.
      expect(updateSets.length).toBe(1);
      expect(Object.keys(updateSets[0])).toEqual(["lastFollowUpAt"]);
    });
  }

  it("eligibility SELECT excludes already-claimed rows (lastFollowUpAt IS NULL guard)", async () => {
    await run();
    // The drizzle condition object carries the isNull(lastFollowUpAt) leaf —
    // walk cycle-safely looking for the column name.
    const seen = new Set<object>();
    let found = false;
    const walk = (v: unknown): void => {
      if (found || !v || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
        if (k === "name" && inner === "lastFollowUpAt") { found = true; return; }
        walk(inner);
      }
    };
    walk(selectWhereArgs[0]);
    expect(found).toBe(true);
  });

  it("pending callback for the same phone SKIPS the lead (no claim, no text)", async () => {
    callbackRows = [{ phone: "(216) 555-0107" }];
    const res = await run();
    expect(res.recordsProcessed).toBe(0);
    expect(updateSets.length).toBe(0);
    expect(orchestrateSpy).not.toHaveBeenCalled();
  });

  it("inbound SMS within 48h SKIPS the lead (active conversation owns the thread)", async () => {
    inboundRows = [{ p: "2165550107" }];
    const res = await run();
    expect(res.recordsProcessed).toBe(0);
    expect(updateSets.length).toBe(0);
    expect(orchestrateSpy).not.toHaveBeenCalled();
  });

  it("guard-query failure proceeds UNGUARDED (speed-to-lead must not die on a read error)", async () => {
    guardThrow = true;
    try {
      orchestrateResult = { status: "sent" };
      const res = await run();
      expect(res.recordsProcessed).toBe(1);
      expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    } finally {
      guardThrow = false;
    }
  });
});
