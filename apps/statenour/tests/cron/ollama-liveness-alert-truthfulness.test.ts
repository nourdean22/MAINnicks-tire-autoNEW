/**
 * tests/cron/ollama-liveness-alert-truthfulness.test.ts
 * 2026-09-02 · the alarm must not claim it fired when it did not.
 *
 * ollama-model-liveness exists because this key has lost two models with no
 * warning, and the vision lane then ran dead in production for roughly six
 * weeks. The route is the alarm for that.
 *
 * It reported `alerted: true` unconditionally. sendTelegram returns a boolean
 * and catches its own errors — it never throws — so a missing bot token, a
 * missing chat id, or a 5-second timeout all produced a cron row asserting the
 * operator had been told about a dead lane when nothing left the process.
 *
 * That is the failure this route was built to prevent, reproduced inside the
 * route itself: a signal that reads healthy while the thing it watches is
 * broken. These tests pin the return value to the actual send.
 *
 * NOTE ON THE 1.4% FAILURE RATE. /system/health shows 32 failed of 2,312 runs
 * for this cron. That is NOT what this fixes and no test here claims it is —
 * the route has no unguarded throw (probeOllamaLanes catches per lane and
 * returns a report for a missing key; sendTelegram cannot throw), so those
 * failures are most likely cronHandler-level timeouts or deploy restarts.
 * Naming that here so a later reader does not mistake this file for a fix to
 * a number it does not move.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSendTelegram, mockProbe } = vi.hoisted(() => ({
  mockSendTelegram: vi.fn(),
  mockProbe: vi.fn(),
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: mockSendTelegram,
  formatTelegramNotification: (title: string, body: string) => `${title}\n${body}`,
}));
vi.mock("@/lib/ai/model-liveness", () => ({
  probeOllamaLanes: mockProbe,
  summarizeLanes: () => "chat: 410 retired",
}));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { GET } from "@/app/api/cron/ollama-model-liveness/route";

const call = () =>
  (GET as unknown as (r: Request, c: unknown) => Promise<Record<string, unknown>>)(
    new Request("http://test/api/cron/ollama-model-liveness"),
    { params: Promise.resolve({}) },
  );

/** A report with one permanently-retired lane — the case that must alert. */
const DEAD_LANE = {
  ok: false,
  probes: [{ lane: "chat", model: "deepseek-v3.1:671b", state: "retired", httpStatus: 410 }],
  failing: [{ lane: "chat", model: "deepseek-v3.1:671b", state: "retired", httpStatus: 410 }],
};

describe("ollama-model-liveness · `alerted` reflects the actual send", () => {
  beforeEach(() => {
    mockSendTelegram.mockReset();
    mockProbe.mockReset();
  });

  it("reports alerted:false when the notification did not go out", async () => {
    mockProbe.mockResolvedValue(DEAD_LANE);
    mockSendTelegram.mockResolvedValue(false); // no bot token, or a timeout
    const res = await call();
    expect(res.ok).toBe(false);
    expect(res.alerted).toBe(false);
  });

  it("PLANTED POSITIVE · reports alerted:true when it DID go out", async () => {
    // Without this, hardcoding `alerted: false` would pass the test above.
    mockProbe.mockResolvedValue(DEAD_LANE);
    mockSendTelegram.mockResolvedValue(true);
    const res = await call();
    expect(res.alerted).toBe(true);
  });

  it("PLANTED POSITIVE · a healthy run sends nothing and is not marked failing", async () => {
    mockProbe.mockResolvedValue({
      ok: true,
      probes: [{ lane: "chat", model: "minimax-m3", state: "alive", latencyMs: 120 }],
      failing: [],
    });
    const res = await call();
    expect(res.ok).toBe(true);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });
});
