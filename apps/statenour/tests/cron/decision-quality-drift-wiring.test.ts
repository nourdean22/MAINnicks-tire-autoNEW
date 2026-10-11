/**
 * decision-quality-drift is "dormant" in config/crons.ts: operator-parked, so it
 * is in no job list and no agent may un-park it (autonomic-orchestrator.ts, #2906;
 * ruling 2026-10-10 in the audit ledger). When it does run (manual Run), its
 * coach-event title states the drop once, as a percent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
const h = vi.hoisted(() => ({ run: vi.fn(), coach: vi.fn() }));
vi.mock("@/lib/brain/decision-quality-drift", () => ({ runDecisionQualityDrift: h.run }));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: h.coach }));

import { WEEKLY_JOBS } from "@/lib/inngest/jobs";
import { CRONS } from "@/config/crons";
import { GET } from "@/app/api/cron/decision-quality-drift/route";

const run = () =>
  (GET as unknown as (req: Request, ctx: unknown) => Promise<Record<string, unknown>>)(
    new Request("http://localhost/api/cron/decision-quality-drift"),
    {},
  );

beforeEach(() => {
  h.run.mockReset();
  h.coach.mockReset().mockResolvedValue(undefined);
});

describe("decision-quality-drift · stays parked", () => {
  it("is dormant and in no weekly fan-out until the operator un-parks it", () => {
    expect(WEEKLY_JOBS).not.toContain("/api/cron/decision-quality-drift");
    const entry = CRONS.find((c) => c.name === "decision-quality-drift");
    expect(entry?.mode).toBe("dormant");
  });
});

describe("decision-quality-drift · coach title", () => {
  it("states an 18% drop as 18%, not -1800%", async () => {
    // deltaPct is already a percent (lib/brain/decision-quality-drift.ts).
    h.run.mockResolvedValue({
      drift: true,
      alertWritten: true,
      recentGpa: 2.46,
      baselineGpa: 3.0,
      deltaPct: -18,
      trend: "down",
      weekEndingDate: "2026-10-12",
      recentSampleSize: 4,
      baselineSampleSize: 9,
    });
    await run();
    const title = (h.coach.mock.calls[0][0] as { title: string }).title;
    expect(title).toContain("(−18%)");
    expect(title).not.toContain("1800");
  });
});
