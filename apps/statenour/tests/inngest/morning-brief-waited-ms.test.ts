/**
 * The morning brief declares its deliberate combine-window sleep as
 * `waitedMs`, and the value is the SAME number it slept, so settleCronRun
 * (tests/inngest/cron-settle-waited-ms.test.ts) records work time, not the
 * 35-minute wait (audit 2026-10-10, 14-live-crons item 4).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));

import { operatorMorningBrief } from "@/lib/inngest/functions/morning-brief";

// Every step returns a canned value by id, so no real compose/push/TTS runs.
const CANNED: Record<string, unknown> = {
  compose: { date: "2026-10-10", text: "brief", sectionCount: 2 },
  "hand-off-for-combine": { sent: 1, failed: 0 },
  "voice-file": { status: "skipped" },
  "pin-scoreboard": { status: "pinned", numberCount: 3 },
  "combine-backstop": { status: "consumed" },
};

describe("operator-morning-brief · declares its deliberate wait", () => {
  it("returns waitedMs equal to the combine-window sleep", async () => {
    const sleep = vi.fn(async () => undefined);
    const step = { run: async (id: string) => CANNED[id], sleep };
    const out = await (
      operatorMorningBrief as unknown as { handler: (ctx: unknown) => Promise<Record<string, unknown>> }
    ).handler({ step });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBe("wait-for-combine-window");
    expect(out.waitedMs).toBe(35 * 60_000);
    expect(sleep.mock.calls[0][1]).toBe(out.waitedMs);
  });
});
