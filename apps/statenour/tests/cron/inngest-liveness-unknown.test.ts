/**
 * inngest-liveness must not go silent when a probe THROWS (2026-10-10).
 *
 * fleet-truth turns a probe that threw into state "unknown" ("a failed probe
 * is UNKNOWN, never healthy"), but this route only alerted on `stale` /
 * `never_produced`, so an unreadable capability returned ok:true and paged
 * nobody. Drives the REAL fleet-truth probes over a faked prisma: every model
 * answers with a fresh row unless a test makes one throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  throwOn: new Set<string>(),
  sendTelegram: vi.fn(),
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: (...a: unknown[]) => h.sendTelegram(...a),
  formatTelegramNotification: (title: string, body: string, urgency?: string) => `[${urgency}] ${title}: ${body}`,
}));
vi.mock("@/lib/prisma", () => {
  const model = (name: string) => ({
    findFirst: async () => {
      if (h.throwOn.has(name)) throw new Error(`relation for ${name} unavailable`);
      // Any date column a probe selects reads as one hour old.
      const at = new Date(Date.now() - 3_600_000);
      return new Proxy({}, { get: () => at });
    },
    // The route's error_logs read (buildInstrumentFailures): no failures logged.
    findMany: async () => [],
  });
  return { prisma: new Proxy({}, { get: (_t, prop: string) => model(prop) }) };
});

import { GET } from "@/app/api/cron/inngest-liveness/route";

async function run(): Promise<{ ok: boolean }> {
  return (await GET(new Request("http://x/api/cron/inngest-liveness"), {} as never)) as { ok: boolean };
}
const sent = () => h.sendTelegram.mock.calls.map(([m]) => String(m)).join("\n");

beforeEach(() => {
  h.throwOn.clear();
  h.sendTelegram.mockReset();
  h.sendTelegram.mockResolvedValue(true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T13:00:05Z"));
});
afterEach(() => vi.useRealTimers());

describe("inngest-liveness · a throwing probe is never silent", () => {
  it("CONTROL: every probe fresh -> ok and silent", async () => {
    const out = await run();
    expect(out.ok).toBe(true);
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("BREAKS: a capability probe that throws alerts (unknown, not healthy)", async () => {
    h.throwOn.add("briefingLog"); // the daily-brief probe
    const out = await run();
    expect(out.ok).toBe(false);
    expect(sent()).toMatch(/daily-brief: unknown/);
  });

  it("BREAKS: a heartbeat probe that throws alerts as UNKNOWN, not as 'scheduler DOWN'", async () => {
    h.throwOn.add("cronJobLog"); // the heartbeat (and the worker) probes read cron_job_logs
    const out = await run();
    expect(out.ok).toBe(false);
    expect(sent()).toMatch(/unknown/i);
    expect(sent()).not.toMatch(/appears DOWN/);
  });
});
