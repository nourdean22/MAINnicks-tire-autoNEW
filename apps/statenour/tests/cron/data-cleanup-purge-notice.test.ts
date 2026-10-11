/**
 * The operator hears when the nightly purge auto-rejects his approvals.
 *
 * THE DEFECT (audit 2026-10-10, report 13). data-cleanup flips every
 * autonomous action pending over 7 days to rejected / auto-purge. The only
 * trace was a CronJobLog count; nothing told the operator that work he never
 * reviewed had just been thrown away.
 *
 * Now: one operator Telegram line with the count when the purge rejected
 * anything, none on a zero night, and a Telegram failure never fails the
 * cleanup.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  purge: vi.fn(),
  sendTelegram: vi.fn(async (..._a: unknown[]) => true),
}));

vi.mock("@/lib/system/stale-data-purger", () => ({ purgeStaleCategory: h.purge }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: h.sendTelegram }));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
vi.mock("@/lib/db/embedding-shadow", () => ({
  sweepEmbeddingShadow: vi.fn(async () => ({
    sources: [],
    totalMarked: 0,
    totalCleared: 0,
    refused: false,
    dryRun: false,
  })),
}));
vi.mock("@/lib/services/plate-retention", () => ({ scrubExpiredPlates: vi.fn(async () => 0) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const stub = () => ({
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  });
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "$queryRaw") return () => Promise.resolve([]);
        if (prop === "$executeRaw") return () => Promise.resolve(0);
        return stub();
      },
    },
  );
  return { prisma };
});

import { GET } from "@/app/api/cron/data-cleanup/route";

const run = () => GET(new Request("http://x/api/cron/data-cleanup"), {} as never) as Promise<Record<string, unknown>>;
const purged = (n: number) => ({ category: "pending_actions_7d", purged: n, note: `Marked ${n} actions rejected` });

beforeEach(() => {
  h.purge.mockReset();
  h.sendTelegram.mockReset().mockResolvedValue(true);
});

describe("data-cleanup · auto-purge notice", () => {
  it("sends ONE operator line with the count when the purge rejected approvals", async () => {
    h.purge.mockResolvedValueOnce(purged(3));
    await run();
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    const text = String(h.sendTelegram.mock.calls[0][0]);
    expect(text).toMatch(/\b3\b/);
    expect(text).toMatch(/7 days/);
    // Operator chat: no explicit chat id, so the default TELEGRAM_CHAT_ID.
    expect(h.sendTelegram.mock.calls[0][1]).toBeUndefined();
  });

  it("stays silent on a zero night", async () => {
    h.purge.mockResolvedValueOnce(purged(0));
    await run();
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("a Telegram failure never fails the cleanup", async () => {
    h.purge.mockResolvedValueOnce(purged(5));
    h.sendTelegram.mockRejectedValueOnce(new Error("telegram down"));
    const out = await run();
    expect((out.deletedByTable as Record<string, number>).autonomous_actions_auto_purged).toBe(5);
    expect(out.ok).not.toBe(false);
  });
});
