/**
 * The 2-day declined text (flag declined_recovery_2d, Nour 2026-11-07) and the declined lane's share of the
 * shop-wide 200/24 h text cap.
 *
 * 1. Selection floor: the eligibility WHERE is rendered by drizzle's real MySqlDialect. Flag OFF the newest
 *    estimate it takes is 7 days old (today's rule, pinned); flag ON it is 2 days old. Both keep
 *    `matched_invoice_id is null`, which is what skips an estimate the 09:30 estimate-invoice-match job
 *    cleared that same morning (scheduler order pinned in estimateInvoiceMatch.test.ts).
 * 2. Send: a 3-day-old P0 estimate gets the 2-day text (claim on the 3d columns, key declined_2d_P0) only
 *    with the flag ON; flag OFF it gets nothing.
 * 3. Reservation: the declined run never takes the last 40 texts of the shared cap, so inbound replies keep
 *    headroom. Tested around that line and at the cap itself; an unreadable count leaves the run as today.
 * Synthetic 555 numbers, stub db.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const DAY = 86_400_000;
const dialect = new MySqlDialect();

const h = vi.hoisted(() => ({
  twoDay: false,
  cap: { allowed: true, count: 0, cap: 200, readable: false } as { allowed: boolean; count: number; cap: number; readable: boolean },
  sent: [] as Array<{ to: string; body: string; variantKey?: string }>,
  claims: [] as string[],
  selects: [] as unknown[][],
  wheres: [] as unknown[],
}));

vi.mock("../../services/featureFlags", () => ({
  isEnabled: async (key: string) => key === "declined_recovery_2d" && h.twoDay,
}));
vi.mock("../../services/smsControl", () => ({ checkGlobalDailyCap: async () => h.cap }));
vi.mock("../../services/sendPause", () => ({ sendPauseHoldReason: async () => null }));
vi.mock("../../db", () => ({
  getDb: async () => ({
    select: () => {
      const rows = h.selects.shift() ?? [];
      return {
        from: () => ({
          where: (w: unknown) => {
            h.wheres.push(w);
            return Object.assign(Promise.resolve(rows), { limit: async () => rows });
          },
        }),
      };
    },
    update: () => ({
      set: (v: Record<string, unknown>) => {
        for (const k of Object.keys(v)) if (/AttemptedAt$/.test(k)) h.claims.push(k);
        return { where: async () => [{ affectedRows: 1 }] };
      },
    }),
  }),
}));
vi.mock("../../sms", () => ({
  sendSms: async (to: string, body: string, opts: { variantKey?: string }) => {
    h.sent.push({ to, body, variantKey: opts?.variantKey });
    return { success: true, sid: `SM${h.sent.length}` };
  },
}));
vi.mock("../../services/smsInstrumentation", () => ({ logOutboundSms: async () => undefined }));
vi.mock("../../services/telegram", () => ({ sendTelegram: async () => undefined, sendTelegramMessage: async () => undefined }));

const estimate = (id: number, ageDays: number) => ({
  id,
  customerName: "Synthetic Lead",
  customerPhone: `216555014${id}`,
  serviceDescription: "oil change",
  estimatedAmount: 20_000,
  estimateDate: new Date(Date.now() - ageDays * DAY - 3_600_000),
  followUp3dSent: 0, followUp3dAttemptedAt: null,
  followUp7dSent: 0, followUp7dAttemptedAt: null,
  followUp14dSent: 0, followUp14dAttemptedAt: null,
  followUp30dSent: 0, followUp30dAttemptedAt: null,
  followUp45dSent: 0, followUp45dAttemptedAt: null,
  recoveryProfile: "P0",
  statedConcern: null,
  statedConcernSource: null,
  recoveryHoldout: 0,
});

beforeEach(() => {
  h.twoDay = false;
  h.cap = { allowed: true, count: 0, cap: 200, readable: false };
  h.sent = [];
  h.claims = [];
  h.wheres = [];
  vi.stubEnv("FEATURE_DECLINED_RECOVERY", "1");
});
afterEach(() => vi.unstubAllEnvs());

const run = async () => (await import("./declinedWorkRecovery")).runDeclinedWorkRecovery({ bypassBusinessHoursCheck: true, maxSends: 50 });

/** Age in days of the newest estimate the rendered WHERE accepts (its `<=` date bound). */
function floorDays(): number {
  const q = dialect.sqlToQuery(h.wheres[0] as never);
  expect(q.sql).toMatch(/`matched_invoice_id` is null/);
  const lte = /`estimate_date` <= \?/.exec(q.sql);
  expect(lte, q.sql).not.toBeNull();
  const idx = (q.sql.slice(0, lte!.index).match(/\?/g) ?? []).length;
  const bound = q.params[idx];
  const ms = bound instanceof Date ? bound.getTime() : new Date(String(bound).replace(" ", "T") + "Z").getTime();
  return Math.round((Date.now() - ms) / DAY);
}

describe("declined recovery · selection floor", () => {
  it("flag OFF: newest estimate taken is 7 days old (today's rule)", async () => {
    h.selects = [[], [], []];
    await run();
    expect(floorDays()).toBe(7);
  });

  it("flag ON: newest estimate taken is 2 days old, and a matched estimate is still excluded", async () => {
    h.twoDay = true;
    h.selects = [[], [], []];
    await run();
    expect(floorDays()).toBe(2);
  });
});

describe("declined recovery · the 2-day text", () => {
  it("flag ON: a 3-day-old P0 estimate gets one text, claimed on the 3d columns, key declined_2d_P0", async () => {
    h.twoDay = true;
    h.selects = [[estimate(1, 3)], [], []];
    const r = await run();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].variantKey).toBe("declined_2d_P0");
    expect(h.claims).toEqual(["followUp3dAttemptedAt"]);
    expect(r.recordsProcessed).toBe(1);
  });

  it("flag OFF: the same estimate gets nothing (too fresh for the 7-day touch)", async () => {
    h.selects = [[estimate(1, 3)], [], []];
    const r = await run();
    expect(h.sent).toHaveLength(0);
    expect(r.recordsProcessed).toBe(0);
  });

  it("flag ON: a 10-day-old estimate that never got the 2-day text gets the 7-day text, not a late 2-day one", async () => {
    h.twoDay = true;
    h.selects = [[estimate(1, 10)], [], []];
    await run();
    expect(h.sent.map((s) => s.variantKey)).toEqual(["declined_7d_P0"]);
  });
});

describe("declined recovery · reservation in the shared 200/24 h cap", () => {
  const three = () => [[estimate(1, 10), estimate(2, 10), estimate(3, 10)], [], []];
  const at = async (count: number) => {
    h.cap = { allowed: count < 200, count, cap: 200, readable: true };
    h.selects = three();
    await run();
    return h.sent.length;
  };

  it("CONTROL: unreadable count -> run as today (3 of 3)", async () => {
    h.selects = three();
    await run();
    expect(h.sent).toHaveLength(3);
  });
  it("40 below the line minus 1 (count 159): one text left for the lane", async () => {
    expect(await at(159)).toBe(1);
  });
  it("at the line (count 160): nothing, the last 40 stay for replies", async () => {
    expect(await at(160)).toBe(0);
  });
  it("past the line (count 161): nothing", async () => {
    expect(await at(161)).toBe(0);
  });
  it("cap-1, cap, cap+1 (199, 200, 201): nothing", async () => {
    expect(await at(199)).toBe(0);
    h.sent = [];
    expect(await at(200)).toBe(0);
    h.sent = [];
    expect(await at(201)).toBe(0);
  });
  it("well under (count 0): all three", async () => {
    expect(await at(0)).toBe(3);
  });
});
