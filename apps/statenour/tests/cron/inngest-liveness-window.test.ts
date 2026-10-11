/**
 * inngest-liveness must page within hours of a missed heartbeat, not ~49h
 * (audit 08-F7, 2026-10-10).
 *
 * cron-heartbeat writes at 12:00 UTC; this watcher runs at 13:00 UTC. With a
 * 26h ceiling, a heartbeat missed on day D+1 was 25h old at D+1 13:00 and
 * PASSED, so the first alarm came at D+2 13:00. The ceiling is now 6h, judged
 * as of this route's own 13:00 slot, so a run at another hour (the 03:00
 * healer re-fire, a manual "run now") does not false-alarm on a healthy beat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  artifacts: vi.fn(),
  sendTelegram: vi.fn(),
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
vi.mock("@/lib/observability/fleet-truth", () => ({ statenourArtifacts: () => h.artifacts() }));
vi.mock("@/lib/observability/instrument-failures", () => ({
  buildInstrumentFailures: async () => ({ windowHours: 24, failing: [] }),
}));
// No model on purpose: this file must never read a database.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: (...a: unknown[]) => h.sendTelegram(...a),
  formatTelegramNotification: (title: string, body: string) => `${title}: ${body}`,
}));

import { GET } from "@/app/api/cron/inngest-liveness/route";

type LivenessOut = { ok: boolean; heartbeatAge?: string; heartbeatAgeH?: number };

async function runAt(isoNow: string, heartbeatAgeH: number | null): Promise<LivenessOut> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(isoNow));
  h.artifacts.mockResolvedValue([
    heartbeatAgeH === null
      ? { capability: "inngest-heartbeat", state: "never_produced", ageH: null }
      : { capability: "inngest-heartbeat", state: "fresh", ageH: heartbeatAgeH },
  ]);
  return (await GET(new Request("http://x/api/cron/inngest-liveness"), {} as never)) as LivenessOut;
}

const sentDown = () =>
  h.sendTelegram.mock.calls.some(([msg]) => String(msg).includes("Inngest scheduler appears DOWN"));

beforeEach(() => {
  h.artifacts.mockReset();
  h.sendTelegram.mockReset();
  h.sendTelegram.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe("inngest-liveness · heartbeat age window", () => {
  it("CONTROL: the scheduled 13:00 run with a 1h-old beat is healthy and silent", async () => {
    const out = await runAt("2026-10-10T13:00:05Z", 1);
    expect(out.ok).toBe(true);
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("BREAKS: one missed beat (25h old at 13:00) pages the SAME day", async () => {
    const out = await runAt("2026-10-10T13:00:05Z", 25);
    expect(out.ok).toBe(false);
    expect(sentDown()).toBe(true);
  });

  it("BREAKS: a beat 7h old at the 13:00 slot is already stale", async () => {
    const out = await runAt("2026-10-10T13:00:05Z", 7);
    expect(out.ok).toBe(false);
  });

  it("an off-slot run (03:00 healer re-fire) does NOT false-alarm on last noon's healthy beat", async () => {
    const out = await runAt("2026-10-11T03:00:05Z", 15);
    expect(out.ok).toBe(true);
    expect(sentDown()).toBe(false);
  });

  it("an off-slot run still pages when the last beat predates the most recent 12:00 slot", async () => {
    const out = await runAt("2026-10-11T03:00:05Z", 39);
    expect(out.ok).toBe(false);
    expect(sentDown()).toBe(true);
  });

  it("a heartbeat that was never written pages", async () => {
    const out = await runAt("2026-10-10T13:00:05Z", null);
    expect(out.ok).toBe(false);
    expect(out.heartbeatAge).toBe("NEVER written");
  });
});
