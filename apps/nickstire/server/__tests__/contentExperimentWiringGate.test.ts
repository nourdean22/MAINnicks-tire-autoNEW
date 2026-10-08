/**
 * Only an experiment whose arm generation applies can start, and every
 * experiment generation applies is recorded (2026-10-08).
 *
 * Before: all six presets were startable, though four ("exposed") change
 * nothing in generation, so starting one ran an A/A test under a treatment's
 * name. And enqueue recorded each Reel in only the single OLDEST running
 * experiment, so a second wired experiment (hook + duration both running) had
 * its arm applied to every Reel and recorded on none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const state = vi.hoisted(() => ({
  running: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ experimentId: string; armId: string; episodeKey: string }>,
  started: [] as string[],
}));

// dbAdminProcedure refuses the call when getDbTyped() is null; assignment reads
// getDb(). One fake serves both: SELECT running experiments, INSERT assignments.
vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const fake = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => state.running }) }) }),
    insert: () => ({
      values: (v: { experimentId: string; armId: string; episodeKey: string }) => ({
        onDuplicateKeyUpdate: async () => { state.inserts.push(v); },
      }),
    }),
  };
  return { ...actual, getDb: async () => fake, getDbTyped: async () => fake };
});

// With the db faked, the real admin-role read throws, and a mutation whose
// role read THREW is refused (audit F-11). No security row → the documented
// owner fallback, the assumption every admin-router harness here declares.
vi.mock("../services/adminSecurity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/adminSecurity")>()),
  getAdminSecurityState: async () => null,
}));

// The real assignment code, with only startExperiment replaced so the router
// test can see whether a start was attempted.
vi.mock("../services/contentExperimentStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/contentExperimentStore")>();
  return {
    ...actual,
    startExperiment: async (def: { experimentId: string }) => { state.started.push(def.experimentId); return true; },
  };
});

import { assignEpisodeToActiveExperiment } from "../services/contentExperimentStore";
import { contentAdminRouter } from "../routers/content";

const row = (experimentId: string, primaryVariable: string, startedAt: string, arms = 2) => ({
  experimentId, primaryVariable, objective: "discovery", primaryMetric: "shares_per_reach",
  armsJson: Array.from({ length: arms }, (_, i) => ({ armId: `${experimentId}-a${i}`, variantValue: `v${i}` })),
  startedAt: new Date(startedAt),
});

describe("assignEpisodeToActiveExperiment — what generation applies is what is recorded", () => {
  beforeEach(() => { state.inserts.length = 0; });

  it("records the oldest running experiment of EACH variable, skipping unwired presets", async () => {
    state.running = [
      row("audio-style-v1", "audio_style", "2026-09-01"),      // exposed: generation ignores it
      row("hook-style-direct-v1", "hook_style", "2026-09-02"),
      row("duration-lane-v1", "length_band", "2026-09-03", 3),
      row("hook-style-later", "hook_style", "2026-09-04"),     // not the one generation reads
    ];
    const out = await assignEpisodeToActiveExperiment(7, { briefId: "autopost-2026-10-08" });
    expect(out.map((o) => o.experimentId)).toEqual(["hook-style-direct-v1", "duration-lane-v1"]);
    expect(state.inserts.map((i) => i.experimentId)).toEqual(["hook-style-direct-v1", "duration-lane-v1"]);
    expect(new Set(state.inserts.map((i) => i.episodeKey))).toEqual(new Set(["autopost-2026-10-08"]));
  });

  it("no running experiment is still a no-op", async () => {
    state.running = [];
    expect(await assignEpisodeToActiveExperiment(7, { briefId: "b" })).toEqual([]);
    expect(state.inserts).toEqual([]);
  });
});

const adminCtx = (): TrpcContext => ({
  user: {
    id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin User", loginMethod: "manus",
    role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {} } as TrpcContext["res"],
} as TrpcContext);

describe("contentAdmin.startContentExperiment — only wired presets start", () => {
  beforeEach(() => { state.started.length = 0; });

  it("refuses an exposed preset and starts nothing", async () => {
    const caller = contentAdminRouter.createCaller(adminCtx());
    await expect(caller.startContentExperiment({ preset: "audio_v1" })).rejects.toThrow(/not wired yet/);
    expect(state.started).toEqual([]);
  });

  it("a wired preset still starts", async () => {
    const caller = contentAdminRouter.createCaller(adminCtx());
    const r = await caller.startContentExperiment({ preset: "hook_style_v1" });
    expect(r.wiring).toBe("wired");
    expect(state.started).toEqual(["hook-style-direct-v1"]);
  });
});
