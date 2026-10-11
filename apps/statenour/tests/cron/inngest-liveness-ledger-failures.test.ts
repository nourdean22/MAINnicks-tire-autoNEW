/**
 * inngest-liveness pages partial outcome-ledger write failures (audit 06-H4, 2026-10-11).
 *
 * fleet-truth's intelligence-outcomes probe sees only TOTAL silence. A ledger that
 * writes some rows and fails others logs `[intel.outcome-ledger] ...` to error_logs
 * and paged nobody. Drives the REAL buildInstrumentFailures over a faked errorLog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  errorRows: [] as Array<{ message: string; createdAt: Date }>,
  errorLogFails: false,
  sendTelegram: vi.fn(),
}));

vi.mock("@/lib/utils/http", () => ({ cronHandler: (fn: unknown) => fn }));
vi.mock("@/lib/observability/fleet-truth", () => ({
  statenourArtifacts: async () => [
    { capability: "inngest-heartbeat", state: "fresh", ageH: 1 },
    { capability: "intelligence-outcomes", state: "fresh", ageH: 2 },
  ],
}));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: (...a: unknown[]) => h.sendTelegram(...a),
  formatTelegramNotification: (title: string, body: string) => `${title}: ${body}`,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    errorLog: {
      findMany: async () => {
        if (h.errorLogFails) throw new Error("error_logs unavailable");
        return h.errorRows;
      },
    },
  },
}));

import { GET } from "@/app/api/cron/inngest-liveness/route";

const run = async () => (await GET(new Request("http://x/api/cron/inngest-liveness"), {} as never)) as { ok: boolean };
const sent = () => h.sendTelegram.mock.calls.map(([m]) => String(m)).join("\n");

beforeEach(() => {
  h.errorRows = [];
  h.errorLogFails = false;
  h.sendTelegram.mockReset();
  h.sendTelegram.mockResolvedValue(true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T13:00:05Z"));
});
afterEach(() => vi.useRealTimers());

describe("inngest-liveness: outcome-ledger write failures", () => {
  it("3 ledger failures in 24h -> ok:false and a Telegram naming the ledger", async () => {
    for (let i = 0; i < 3; i++) {
      h.errorRows.push({ message: "[intel.outcome-ledger] boom", createdAt: new Date(Date.now() - (i + 1) * 3_600_000) });
    }
    const out = await run();
    expect(out.ok).toBe(false);
    expect(sent()).toMatch(/intel\.outcome-ledger/);
    expect(sent()).toMatch(/3 write failures/);
  });

  it("an unreadable error log is unknown, not clear -> ok:false and a page", async () => {
    h.errorLogFails = true;
    const out = await run();
    expect(out.ok).toBe(false);
    expect(sent()).toMatch(/instrument-failures/);
  });

  it("CONTROL: no ledger failures -> ok:true and silent", async () => {
    const out = await run();
    expect(out.ok).toBe(true);
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });
});
