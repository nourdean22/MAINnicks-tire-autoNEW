/**
 * Upgrade 5 (background brains finish), 2026-11-01. The four LLM-heavy brain children
 * (think, distill-sessions, conversation-compile, consolidate) left the concurrent 03:00Z
 * evening blast for a sequential 05:00Z phase.
 *
 * Why (Langfuse prod, 7 days): every one of their aborted model calls happened in the
 * 03:00Z hour, where ~25 evening children start together. conversation-memory, which also
 * runs by day, aborted on 11 of 27 calls at 03:00Z and on 1 of 142 calls the rest of the
 * day — same model, same 100 s ceiling. The slot was the problem, not the model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ createFunction: (cfg: unknown, handler: unknown) => ({ cfg, handler }) }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { cronJobLog: { create: async () => ({ id: "hb" }) } } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { megaFanoutEvening, megaBrainOffpeak } from "@/lib/inngest/functions/mega-fanout";
import { EVENING_JOBS, OFFPEAK_BRAIN_JOBS } from "@/lib/inngest/jobs";

type Step = ReturnType<typeof recordingStep>;
type Handler = (a: { step: Step; event?: unknown }) => Promise<unknown>;
const evening = (megaFanoutEvening as unknown as { handler: Handler }).handler;
const brain = (megaBrainOffpeak as unknown as { handler: Handler; cfg: Record<string, unknown> });

function recordingStep() {
  const log: string[] = [];
  const sent: Array<{ id: string; payload: { name: string; id?: string; data: { at: string } } }> = [];
  return {
    log,
    sent,
    run: async (id: string, fn: () => unknown) => { log.push(`run:${id}`); return fn(); },
    sleep: async (id: string, d: string) => { log.push(`sleep:${id}:${d}`); },
    sleepUntil: async (id: string, at: Date | string) => { log.push(`until:${id}:${new Date(at).toISOString()}`); },
    sendEvent: async (id: string, payload: { name: string; id?: string; data: { at: string } }) => { sent.push({ id, payload }); },
  };
}

let fetched: string[] = [];
beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  process.env.APP_BASE_URL = "https://example.test";
  delete process.env.INNGEST_MEGA_V2;
  fetched = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { fetched.push(new URL(url).pathname + new URL(url).search); return new Response("ok", { status: 200 }); }));
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.APP_BASE_URL;
});

describe("evening slot · brain jobs leave the 03:00Z blast", () => {
  it("the brain set is exactly the four measured surfaces, all still in EVENING_JOBS", () => {
    expect([...OFFPEAK_BRAIN_JOBS].sort()).toEqual(
      ["/api/cron/consolidate", "/api/cron/conversation-compile", "/api/cron/distill-sessions", "/api/cron/think"],
    );
    // Still listed: cron-heartbeat, check:crons and the autonomic orchestrator read EVENING_JOBS.
    for (const p of OFFPEAK_BRAIN_JOBS) expect(EVENING_JOBS).toContain(p);
  });

  it("the 03:00Z run dispatches no brain job and schedules the 05:00Z phase once", async () => {
    vi.setSystemTime(new Date("2026-11-03T03:00:00Z")); // Mon 22:00 ET
    const step = recordingStep();
    await evening({ step });
    for (const p of OFFPEAK_BRAIN_JOBS) expect(fetched).not.toContain(p);
    expect(step.sent).toHaveLength(1);
    expect(step.sent[0].payload.name).toBe("mega/brain.offpeak");
    expect(step.sent[0].payload.data.at).toBe("2026-11-03T05:00:00.000Z");
    // Event id dedupes a replayed or double-fired evening run (Inngest drops repeats for 24h).
    expect(step.sent[0].payload.id).toBe("brain-offpeak-2026-11-03T05:00:00.000Z");
  });

  it("CONTROL: the rest of the evening set is still dispatched at 03:00Z", async () => {
    vi.setSystemTime(new Date("2026-11-03T03:00:00Z"));
    await evening({ step: recordingStep() });
    expect(fetched).toContain("/api/cron/data-cleanup");
    expect(fetched).toContain("/api/cron/predict");
  });

  it("a run inside the quiet window starts the phase now", async () => {
    vi.setSystemTime(new Date("2026-11-03T06:10:00Z"));
    const step = recordingStep();
    await evening({ step });
    expect(step.sent[0].payload.data.at).toBe("2026-11-03T06:10:00.000Z");
  });

  it("a manual fire in peak hours does not schedule the brain phase (the nightly run covers it)", async () => {
    vi.setSystemTime(new Date("2026-11-03T15:00:00Z")); // 10:00 ET
    const step = recordingStep();
    await evening({ step });
    expect(step.sent).toHaveLength(0);
    for (const p of OFFPEAK_BRAIN_JOBS) expect(fetched).not.toContain(p);
  });
});

describe("brain phase · sequential, off-peak, one retry pass", () => {
  const at = "2026-11-03T05:00:00.000Z";

  it("never runs two at once", () => {
    expect(brain.cfg.concurrency).toEqual({ limit: 1 });
  });

  it("waits for 05:00Z, then runs one child at a time with a gap, then retries the two re-runnable ones", async () => {
    const step = recordingStep();
    await brain.handler({ step, event: { data: { at } } });
    expect(step.log[0]).toBe(`until:offpeak-start:${at}`);
    const order = step.log.filter((l) => l.startsWith("run:")).map((l) => l.slice(4));
    expect(order).toEqual([
      "child:_api_cron_think",
      "child:_api_cron_distill-sessions",
      "child:_api_cron_conversation-compile",
      "child:_api_cron_consolidate",
      "retry:_api_cron_distill-sessions",
      "retry:_api_cron_conversation-compile",
    ]);
    // A gap follows every dispatch but the last: never two LLM batches on the slots at once.
    expect(step.log.filter((l) => l.startsWith("sleep:"))).toHaveLength(5);
    expect(fetched).toEqual([
      "/api/cron/think",
      "/api/cron/distill-sessions",
      "/api/cron/conversation-compile",
      "/api/cron/consolidate",
      "/api/cron/distill-sessions",
      "/api/cron/conversation-compile",
    ]);
  });

  it("think and consolidate are never re-run (a second run duplicates rows / churns 20-36 min)", async () => {
    const step = recordingStep();
    await brain.handler({ step, event: { data: { at } } });
    expect(step.log).not.toContain("run:retry:_api_cron_think");
    expect(step.log).not.toContain("run:retry:_api_cron_consolidate");
  });

  it("one child failing does not stop the rest, and the run still fails loudly at the end", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      fetched.push(path);
      return new Response("x", { status: path.endsWith("/think") ? 500 : 200 });
    }));
    const step = recordingStep();
    await expect(brain.handler({ step, event: { data: { at } } })).rejects.toThrow(/think.*500/);
    expect(fetched).toContain("/api/cron/consolidate");
  });

  it("a malformed start time is skipped, not run at peak", async () => {
    const step = recordingStep();
    await expect(brain.handler({ step, event: { data: { at: "nope" } } })).resolves.toMatchObject({ skipped: true });
    expect(fetched).toHaveLength(0);
  });
});
