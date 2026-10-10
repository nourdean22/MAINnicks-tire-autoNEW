/**
 * Pipeline controls (2026-10-10): the operator can run a cron job now and
 * advance one reel job one step now, instead of waiting for the next tick.
 * Measured need: a test reel sat in assets_ready for 15 minutes with nothing
 * to press; the only server-side trigger was the 15-minute pulse.
 *
 * The pure helpers decide WHAT may start and refuse by name; the routers only
 * wire them to runJobByName / processNextReelJob / processNextAssemblyJob /
 * rendered + audio QA. Nothing here bypasses a gate: each runner is the same
 * code the tick runs, scoped to one job.
 */
import { describe, expect, it } from "vitest";
import { reelStepFor, startCronJobNow, startReelStepNow } from "./services/pipelineControls";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("startCronJobNow", () => {
  const names = [{ name: "reel-pipeline", enabled: true }, { name: "daily-reel-post", enabled: true }];

  it("starts a registered job without awaiting it and reports started", async () => {
    let ran = "";
    const result = startCronJobNow("reel-pipeline", { names, run: async (n) => { ran = n; return { status: "ok" }; } });
    expect(result).toEqual({ started: true, jobName: "reel-pipeline" });
    await tick();
    expect(ran).toBe("reel-pipeline");
  });

  it("refuses an unknown name by name and runs nothing", async () => {
    let ran = false;
    const result = startCronJobNow("reel-pipelin", { names, run: async () => { ran = true; return { status: "ok" }; } });
    expect(result).toMatchObject({ started: false });
    expect(String((result as { refusal?: string }).refusal)).toMatch(/reel-pipelin.*not a registered cron job/);
    await tick();
    expect(ran).toBe(false);
  });

  it("a runner that throws does not take the request down; the error goes to the onError hook", async () => {
    let seen = "";
    startCronJobNow("reel-pipeline", { names, run: async () => { throw new Error("boom"); }, onError: (e) => { seen = e.message; } });
    await tick(); await tick();
    expect(seen).toBe("boom");
  });
});

describe("reelStepFor — which step a job in a given status may take now", () => {
  it("maps the three waiting states to their step and refuses everything else by status", () => {
    expect(reelStepFor("queued")).toEqual({ step: "generate" });
    expect(reelStepFor("assets_ready")).toEqual({ step: "assemble" });
    expect(reelStepFor("assembled")).toEqual({ step: "qa" });
    expect(reelStepFor("generating")).toMatchObject({ step: null });
    expect(String(reelStepFor("generating").refusal)).toMatch(/generating.*already in flight/);
    expect(String(reelStepFor("posted").refusal)).toMatch(/posted/);
    expect(String(reelStepFor("needs_regen").refusal)).toMatch(/needs_regen/);
  });
});

describe("startReelStepNow", () => {
  const runners = (log: string[]) => ({
    generate: async (id: number) => { log.push(`generate:${id}`); },
    assemble: async (id: number) => { log.push(`assemble:${id}`); },
    qa: async (id: number) => { log.push(`qa:${id}`); },
  });

  it("runs exactly the step the status allows, in the background, and reports which", async () => {
    const log: string[] = [];
    const r = startReelStepNow(42, "assets_ready", runners(log));
    expect(r).toEqual({ started: true, step: "assemble", jobId: 42 });
    await tick();
    expect(log).toEqual(["assemble:42"]);
  });

  it("refuses a status with no step and runs nothing", async () => {
    const log: string[] = [];
    const r = startReelStepNow(42, "assembling", runners(log));
    expect(r).toMatchObject({ started: false, jobId: 42 });
    await tick();
    expect(log).toEqual([]);
  });
});
