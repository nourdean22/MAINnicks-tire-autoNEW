/**
 * Telegram job, lane 2 (2026-10-17) - lib/inngest/on-failure.ts sent one
 * Telegram per failed run, so a function failing every 15 minutes buzzed Nour
 * all night. Now: one alert per function per 6 h window, claimed in the
 * existing action_attempts store (beginAttempt, compare-and-swap reclaim); the
 * repeats are counted and reported on the next alert; non-critical failures
 * wait out 22:00-07:00 ET; a database outage still pages at night.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string; operationKey: string; inputEvidenceIds: string[] };

const h = vi.hoisted(() => {
  const rows = new Map<string, Row>();
  let seq = 0;
  const same = (a: unknown, b: unknown) =>
    a instanceof Date || b instanceof Date
      ? (a as Date | null)?.getTime?.() === (b as Date | null)?.getTime?.()
      : a === b;
  const byWhere = (where: Record<string, unknown>) =>
    [...rows.values()].filter((r) => Object.entries(where).every(([k, v]) => same(r[k], v)));
  const apply = (r: Row, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !(v instanceof Date) && "push" in v) r[k] = [...(r[k] as string[]), (v as { push: string }).push];
      else if (v && typeof v === "object" && !(v instanceof Date) && "set" in v) r[k] = (v as { set: unknown }).set;
      else r[k] = v;
    }
  };
  const createImpl = async ({ data }: { data: Record<string, unknown> }) => {
    if ([...rows.values()].some((r) => r.operationKey === data.operationKey)) throw Object.assign(new Error("dup"), { code: "P2002" });
    const row = { id: `a${++seq}`, inputEvidenceIds: [], ...data } as Row;
    rows.set(row.id, row);
    return { id: row.id, attemptNo: row.attemptNo };
  };
  const actionAttempt = {
    create: vi.fn(createImpl),
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => byWhere(where)[0] ?? null),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = byWhere(where);
      hit.forEach((r) => apply(r, data));
      return { count: hit.length };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.get(where.id);
      if (!r) throw new Error("not found");
      apply(r, data);
      return r;
    }),
  };
  return { rows, actionAttempt, createImpl, sendTelegram: vi.fn(async (..._a: unknown[]) => true) };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    actionAttempt: h.actionAttempt,
    cronJobLog: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), update: vi.fn() },
  },
}));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: h.sendTelegram }));

import { onInngestFailure } from "@/lib/inngest/on-failure";

const fail = (fn: string, run: string, message = "boom") =>
  onInngestFailure({ event: { data: { function_id: fn, run_id: run } }, error: new Error(message) } as never);

const AFTERNOON_ET = new Date("2026-10-16T18:00:00Z"); // 14:00 EDT
const NIGHT_ET = new Date("2026-10-17T07:00:00Z"); // 03:00 EDT

beforeEach(() => {
  h.rows.clear();
  vi.clearAllMocks();
  h.sendTelegram.mockResolvedValue(true);
  vi.useFakeTimers();
  vi.setSystemTime(AFTERNOON_ET);
});
afterEach(() => vi.useRealTimers());

describe("Inngest failure alerts are grouped per function per window", () => {
  it("5 failures of one function in a window send once; a second function sends once more", async () => {
    for (let i = 0; i < 5; i++) await fail("statenour-mega-fanout", `run_${i}`);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    await fail("statenour-morning-brief", "run_x");
    expect(h.sendTelegram).toHaveBeenCalledTimes(2);
  });

  it("the next window's alert carries the count of repeats that were held", async () => {
    for (let i = 0; i < 5; i++) await fail("statenour-mega-fanout", `run_${i}`);
    vi.setSystemTime(new Date(AFTERNOON_ET.getTime() + 6 * 3_600_000 + 60_000));
    await fail("statenour-mega-fanout", "run_late");
    expect(h.sendTelegram).toHaveBeenCalledTimes(2);
    expect(String(h.sendTelegram.mock.calls[1][0])).toContain("4 more failures");
    expect(String(h.sendTelegram.mock.calls[0][0])).not.toContain("more failure");
  });

  it("an undelivered alert does not hold the window: the next failure tries again", async () => {
    h.sendTelegram.mockResolvedValueOnce(false);
    await fail("statenour-mega-fanout", "run_1");
    await fail("statenour-mega-fanout", "run_2");
    expect(h.sendTelegram).toHaveBeenCalledTimes(2);
  });

  it("a non-critical failure at 03:00 ET is not sent and claims nothing", async () => {
    vi.setSystemTime(NIGHT_ET);
    await fail("statenour-mega-fanout", "run_1");
    expect(h.sendTelegram).not.toHaveBeenCalled();
    expect(h.rows.size).toBe(0);
  });

  it("CONTROL - a database outage at 03:00 ET still pages", async () => {
    vi.setSystemTime(NIGHT_ET);
    await fail("statenour-mega-fanout", "run_1", "Can't reach database server at db.neon.tech:5432");
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("CONTROL - the dedupe store failing fails open: the alert still sends", async () => {
    h.actionAttempt.create.mockRejectedValueOnce(new Error("connection refused"));
    await fail("statenour-mega-fanout", "run_1");
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
  });

  // #3097 review P2-5: a database outage made every beginAttempt throw, and each
  // failure then sent its own alert: the storm this file exists to stop.
  it("with the claim store down, 5 failures of one function still send once (in-process window)", async () => {
    h.actionAttempt.create.mockRejectedValue(new Error("connection refused"));
    try {
      for (let i = 0; i < 5; i++) await fail("statenour-outage-fn", `run_${i}`);
      expect(h.sendTelegram).toHaveBeenCalledTimes(1);
      await fail("statenour-outage-other", "run_x");
      expect(h.sendTelegram).toHaveBeenCalledTimes(2);
    } finally {
      h.actionAttempt.create.mockReset();
      h.actionAttempt.create.mockImplementation(h.createImpl);
    }
  });

  // #3097 review P3-1: a non-critical alert's window must not hold a critical page.
  it("a critical failure pages even inside a non-critical window of the same function", async () => {
    await fail("statenour-crit-fn", "run_1");
    await fail("statenour-crit-fn", "run_2", "Can't reach database server at db.neon.tech:5432");
    expect(h.sendTelegram).toHaveBeenCalledTimes(2);
    await fail("statenour-crit-fn", "run_3", "Can't reach database server at db.neon.tech:5432");
    expect(h.sendTelegram).toHaveBeenCalledTimes(2);
  });
});
