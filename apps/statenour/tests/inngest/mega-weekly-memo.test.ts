/**
 * The evening fan-out decides "is it Sunday in ET" once per run (audit 08-X4, 2026-10-11).
 *
 * isSundayET() ran outside any step, so Inngest re-evaluated it on every replay. A run
 * that started Sunday 23:00 ET and replayed after ET midnight read Monday: the weekly
 * step ids vanished from the replay, so the weekly jobs dropped out of the run's summary
 * (or, the other way round, ran on a Monday replay of a Saturday start).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { cronJobLog: { create: async () => ({ id: "hb" }) } } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { megaFanoutEvening } from "@/lib/inngest/functions/mega-fanout";
import { WEEKLY_JOBS } from "@/lib/inngest/jobs";

type Handler = (a: { step: { run: (id: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;
const handler = (megaFanoutEvening as unknown as { handler: Handler }).handler;
const stepIdFor = (path: string) => `child:${path.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

/** A step that memoizes by id across runs, as Inngest does across a replay. */
function memoStep(memo: Map<string, unknown>, requested: string[]) {
  return {
    run: async (id: string, fn: () => unknown) => {
      requested.push(id);
      if (memo.has(id)) return memo.get(id);
      const out = await fn();
      memo.set(id, out);
      return out;
    },
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  delete process.env.INNGEST_MEGA_V2;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("mega-fanout evening: Sunday is memoized", () => {
  it("a Sunday-ET run replayed after ET midnight still requests every weekly step", async () => {
    const memo = new Map<string, unknown>();
    const first: string[] = [];
    const replay: string[] = [];

    vi.setSystemTime(new Date("2026-10-12T03:00:00Z")); // Sun 2026-10-11 23:00 ET
    await handler({ step: memoStep(memo, first) });
    vi.setSystemTime(new Date("2026-10-12T05:00:00Z")); // Mon 01:00 ET
    await handler({ step: memoStep(memo, replay) });

    for (const path of WEEKLY_JOBS) {
      expect(first).toContain(stepIdFor(path));
      expect(replay).toContain(stepIdFor(path));
    }
  });

  it("CONTROL: a weekday run requests no weekly step", async () => {
    const requested: string[] = [];
    vi.setSystemTime(new Date("2026-10-14T03:00:00Z")); // Tue 23:00 ET
    await handler({ step: memoStep(new Map(), requested) });
    const weeklyOnly = WEEKLY_JOBS.filter((p) => !requested.includes(stepIdFor(p)));
    expect(weeklyOnly.length).toBeGreaterThan(0);
  });
});
