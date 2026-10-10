/**
 * The hourly automation-engine tick dispatches the autonomous-engine route.
 *
 * The route (not runAutonomousActions directly) because the route carries the
 * NICK_AUTONOMY gate, the per-cron kill switch and the CronJobLog row. A failed
 * dispatch must mark the tick degraded (a `partial` row) and must not throw: a
 * throw would retry the whole engine and page the operator every hour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  dispatchChild: vi.fn(),
  run: vi.fn(async () => []),
}));

vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));
vi.mock("@/lib/inngest/functions/mega-fanout", () => ({ dispatchChild: h.dispatchChild }));
vi.mock("@/lib/brain/automation-engine", () => ({ automationEngine: { run: h.run } }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { automationEngineTick } from "@/lib/inngest/functions/automation-engine";

const step = { run: (_id: string, fn: () => unknown) => fn() };
const tick = () =>
  (automationEngineTick as unknown as { handler: (ctx: unknown) => Promise<Record<string, unknown>> }).handler({ step });

const savedSecret = process.env.CRON_SECRET;
beforeEach(() => {
  h.dispatchChild.mockReset();
  h.run.mockClear();
  process.env.CRON_SECRET = "test-secret";
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe("automation-engine tick · autonomous-engine dispatch", () => {
  it("dispatches the route every tick, and still runs its own rules", async () => {
    h.dispatchChild.mockResolvedValue({ path: "/api/cron/autonomous-engine", status: 200, durationMs: 5 });
    const out = await tick();
    expect(h.dispatchChild).toHaveBeenCalledWith("/api/cron/autonomous-engine", "test-secret");
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(out.degraded).toBeUndefined();
  });

  it("a failed dispatch degrades the tick instead of throwing", async () => {
    h.dispatchChild.mockRejectedValue(new Error("child cron /api/cron/autonomous-engine returned 500"));
    const out = await tick();
    expect(out.degraded).toBe(true);
    expect(String(out.degradedReason)).toMatch(/returned 500/);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("refuses to dispatch with an empty bearer, and says so", async () => {
    process.env.CRON_SECRET = "  ";
    const out = await tick();
    expect(h.dispatchChild).not.toHaveBeenCalled();
    expect(out.degraded).toBe(true);
    expect(String(out.degradedReason)).toMatch(/CRON_SECRET/);
  });
});
