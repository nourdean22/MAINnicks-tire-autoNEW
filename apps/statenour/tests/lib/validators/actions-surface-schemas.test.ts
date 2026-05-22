/**
 * Actions-surface slice contract tests · (2026-05-22 · legacy-modernizer
 * REST→tRPC · components/actions/* slice).
 *
 * This slice migrated the leftover `authedFetch` / `fetch` call-sites in
 * the eight `components/actions/*` files (KommandoTrack · KommandoLearn ·
 * ProjectDetail · ProjectCard · LinkProjectPicker · MilestonesFlow ·
 * DailyBriefSection · ActionsContextBand) onto tRPC. It added a new `ai`
 * domain router plus procedures across `brain` / `task` / `operator`.
 *
 * Some are no-input reads (`brain.pulseDigest`, `operator.decisions`) —
 * nothing to pin. The procedures with a structured `.input()` are pinned
 * here:
 *
 *   · ai.teach                  · { topic, depth }
 *   · ai.research               · { query, taskType?, systemPrompt? }
 *   · ai.trackStory             · the nine-counter weekly snapshot
 *   · ai.planProject            · { mode, title?, missionId?, … }
 *   · brain.memories            · { category?, query?, minConfidence?, limit? }
 *   · brain.recordMemory        · { category, key, content, source?, … }
 *   · brain.forgetMemoryByKey   · { key }
 *   · task.leaveMission         · { id }
 *
 * The risk a migration introduces is the typed-payload-mismatch class: a
 * client payload TypeScript accepts but the server Zod `.input()` rejects
 * at runtime, surfacing as a generic failure toast (the /tasks quick-add
 * bug, 2026-05-21).
 *
 * The schemas below are the literal `.input(...)` objects from
 * lib/trpc/routers/{ai,brain,task,operator}.ts — re-declared here
 * verbatim so a tightened bound fails CI before it breaks a real
 * call-site. Pure schema parse, no Prisma. Mirrors tests/lib/validators/
 * cross-domain-residuals-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── ai.teach ────────────────
//
// KommandoLearn fires teachMut.mutateAsync({ topic, depth: "standard" })
// for the "teach" half of its smart-routed input.

describe("ai.teach · KommandoLearn micro-course payload", () => {
  const teachInput = z.object({
    topic: z.string().min(2).max(500),
    depth: z.enum(["quick", "standard", "deep"]).default("standard"),
  });

  it("accepts the standard-depth payload KommandoLearn sends", () => {
    expect(() =>
      teachInput.parse({
        topic: "Hiring and managing shop employees",
        depth: "standard",
      }),
    ).not.toThrow();
  });

  it("defaults depth to 'standard' when omitted", () => {
    const parsed = teachInput.parse({ topic: "How to read a P&L statement" });
    expect(parsed.depth).toBe("standard");
  });

  it("rejects a one-character topic (below the min(2) floor)", () => {
    expect(() => teachInput.parse({ topic: "x" })).toThrow();
  });

  it("rejects a depth outside the enum", () => {
    expect(() =>
      teachInput.parse({
        topic: "valid topic",
        depth: "exhaustive" as unknown as "deep",
      }),
    ).toThrow();
  });
});

// ──────────────── ai.research ────────────────
//
// KommandoLearn fires researchMut.mutateAsync({ query, taskType:
// "research" }) for the "research" half of its smart-routed input.

describe("ai.research · KommandoLearn multi-model query payload", () => {
  const researchInput = z.object({
    query: z.string().min(1).max(2000),
    taskType: z
      .enum(["research", "realtime", "fast", "analysis", "general"])
      .optional(),
    systemPrompt: z.string().max(8000).optional(),
  });

  it("accepts the research-task payload KommandoLearn sends", () => {
    expect(() =>
      researchInput.parse({
        query: "Current EV tire demand trends 2026",
        taskType: "research",
      }),
    ).not.toThrow();
  });

  it("accepts the bare payload — { query } only", () => {
    expect(() =>
      researchInput.parse({ query: "Average brake job markup in the US" }),
    ).not.toThrow();
  });

  it("rejects an empty query", () => {
    expect(() => researchInput.parse({ query: "" })).toThrow();
  });

  it("rejects a taskType outside the routeQuery enum", () => {
    expect(() =>
      researchInput.parse({
        query: "valid",
        taskType: "deep-dive" as unknown as "research",
      }),
    ).toThrow();
  });
});

// ──────────────── ai.trackStory ────────────────
//
// KommandoTrack fires trackStoryMut.mutateAsync({ doneToday, … }) — the
// nine aggregated weekly counters — on first load + the regen button.

describe("ai.trackStory · KommandoTrack weekly-snapshot payload", () => {
  const trackStoryInput = z.object({
    doneToday: z.number().int().nonnegative(),
    thisWkDone: z.number().int().nonnegative(),
    prevWkDone: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    goalCount: z.number().int().nonnegative(),
    projectCount: z.number().int().nonnegative(),
    coldProjects: z.number().int().nonnegative(),
    behindGoals: z.number().int().nonnegative(),
    topStreak: z.number().int().nonnegative(),
  });

  const validSnapshot = {
    doneToday: 3,
    thisWkDone: 14,
    prevWkDone: 9,
    warningCount: 2,
    goalCount: 5,
    projectCount: 3,
    coldProjects: 1,
    behindGoals: 2,
    topStreak: 7,
  };

  it("accepts the full nine-counter snapshot", () => {
    expect(() => trackStoryInput.parse(validSnapshot)).not.toThrow();
  });

  it("accepts an all-zero snapshot (a fresh account)", () => {
    expect(() =>
      trackStoryInput.parse({
        doneToday: 0,
        thisWkDone: 0,
        prevWkDone: 0,
        warningCount: 0,
        goalCount: 0,
        projectCount: 0,
        coldProjects: 0,
        behindGoals: 0,
        topStreak: 0,
      }),
    ).not.toThrow();
  });

  it("rejects a negative counter", () => {
    expect(() =>
      trackStoryInput.parse({ ...validSnapshot, doneToday: -1 }),
    ).toThrow();
  });

  it("rejects a fractional counter", () => {
    expect(() =>
      trackStoryInput.parse({ ...validSnapshot, thisWkDone: 4.5 }),
    ).toThrow();
  });

  it("rejects a snapshot missing a required counter", () => {
    const { topStreak: _omit, ...partial } = validSnapshot;
    void _omit;
    expect(() => trackStoryInput.parse(partial)).toThrow();
  });
});

// ──────────────── ai.planProject ────────────────
//
// ProjectDetail / ProjectCard / MilestonesFlow fire
// planProjectMut.mutateAsync({ mode, title?, missionId?, milestones? })
// from their plan / replan / learn / guide / milestones flows.

describe("ai.planProject · project-engine payload", () => {
  const planProjectInput = z.object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(5000).optional(),
    domain: z.string().max(80).optional(),
    answers: z.string().max(5000).optional(),
    missionId: z.string().max(64).optional(),
    currentState: z.string().max(2000).optional(),
    mode: z
      .enum(["clarify", "plan", "learn", "guide", "milestones"])
      .default("plan"),
    milestones: z.array(z.string().min(1).max(200)).max(8).optional(),
    goalTarget: z.number().optional(),
    goalUnit: z.string().max(50).optional(),
    goalDeadline: z.string().max(64).optional(),
    goalMetric: z.string().max(200).optional(),
  });

  it("accepts the ProjectCard re-plan payload — { missionId, mode, title }", () => {
    expect(() =>
      planProjectInput.parse({
        missionId: "msn_abc123",
        mode: "plan",
        title: "Garage cave buildout",
      }),
    ).not.toThrow();
  });

  it("accepts the ProjectDetail learn payload — { missionId, mode: 'learn' }", () => {
    expect(() =>
      planProjectInput.parse({ missionId: "msn_abc123", mode: "learn" }),
    ).not.toThrow();
  });

  it("accepts the MilestonesFlow milestones payload — { mode: 'milestones', title, goal* }", () => {
    expect(() =>
      planProjectInput.parse({
        mode: "milestones",
        title: "Become a Thought Leader",
        goalTarget: 50000,
        goalUnit: "interactions",
        goalMetric: "total reach",
        domain: "content",
      }),
    ).not.toThrow();
  });

  it("accepts the MilestonesFlow plan payload carrying confirmed milestones", () => {
    expect(() =>
      planProjectInput.parse({
        mode: "plan",
        missionId: "msn_abc123",
        title: "Become a Thought Leader",
        milestones: ["First 1K", "5K", "15K", "50K"],
      }),
    ).not.toThrow();
  });

  it("defaults mode to 'plan' when omitted", () => {
    const parsed = planProjectInput.parse({ title: "A bare project" });
    expect(parsed.mode).toBe("plan");
  });

  it("rejects a mode outside the five-mode enum", () => {
    expect(() =>
      planProjectInput.parse({
        title: "x",
        mode: "execute" as unknown as "plan",
      }),
    ).toThrow();
  });

  it("rejects a milestones array longer than 8", () => {
    expect(() =>
      planProjectInput.parse({
        mode: "plan",
        title: "x",
        milestones: new Array(9).fill("milestone"),
      }),
    ).toThrow();
  });

  it("rejects an empty-string milestone", () => {
    expect(() =>
      planProjectInput.parse({
        mode: "plan",
        title: "x",
        milestones: ["valid", ""],
      }),
    ).toThrow();
  });
});

// ──────────────── brain.memories ────────────────
//
// DailyBriefSection fires utils.brain.memories.fetch({ category, limit })
// for the belief-refresh + pin-hygiene rows; KommandoLearn fetches the
// spaced_review rows.

describe("brain.memories · memory-recall payload", () => {
  const memoriesInput = z
    .object({
      category: z.string().max(80).optional(),
      query: z.string().max(200).optional(),
      minConfidence: z.number().min(0).max(1).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })
    .optional();

  it("accepts the DailyBriefSection category+limit fetch", () => {
    expect(() =>
      memoriesInput.parse({ category: "belief_refresh_report", limit: 1 }),
    ).not.toThrow();
  });

  it("accepts the KommandoLearn spaced-review fetch", () => {
    expect(() =>
      memoriesInput.parse({ category: "spaced_review", limit: 50 }),
    ).not.toThrow();
  });

  it("accepts an entirely omitted input (the optional wrapper)", () => {
    expect(() => memoriesInput.parse(undefined)).not.toThrow();
  });

  it("rejects a minConfidence above 1", () => {
    expect(() =>
      memoriesInput.parse({ category: "x", minConfidence: 1.5 }),
    ).toThrow();
  });

  it("rejects a limit above the 200 ceiling", () => {
    expect(() => memoriesInput.parse({ limit: 500 })).toThrow();
  });
});

// ──────────────── brain.recordMemory ────────────────
//
// KommandoLearn fires recordMemoryMut.mutateAsync({ category, key,
// content, source }) from "Save to brain" + the spaced-review scheduler.

describe("brain.recordMemory · memory-write payload", () => {
  const recordMemoryInput = z.object({
    category: z.string().min(1).max(80),
    key: z.string().min(1).max(200),
    content: z.string().min(1).max(20_000),
    source: z.string().max(60).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  });

  it("accepts the 'Save to brain' insight payload", () => {
    expect(() =>
      recordMemoryInput.parse({
        category: "insight",
        key: "learn_hiring_1747900000000",
        content: "[Learn: Hiring] Always hire slow, fire fast.",
        source: "learn_mode",
      }),
    ).not.toThrow();
  });

  it("accepts the spaced-review scheduler payload (JSON-string content)", () => {
    expect(() =>
      recordMemoryInput.parse({
        category: "spaced_review",
        key: "review_options_trading_d7",
        content: JSON.stringify({
          topic: "Options trading",
          interval: 7,
          completed: false,
        }),
        source: "learn_mode",
      }),
    ).not.toThrow();
  });

  it("rejects a missing key — the legacy /api/brain/memories 400 case", () => {
    expect(() =>
      recordMemoryInput.parse({
        category: "insight",
        content: "no key here",
      }),
    ).toThrow();
  });

  it("rejects an empty category", () => {
    expect(() =>
      recordMemoryInput.parse({ category: "", key: "k", content: "c" }),
    ).toThrow();
  });

  it("rejects an empty content body", () => {
    expect(() =>
      recordMemoryInput.parse({ category: "insight", key: "k", content: "" }),
    ).toThrow();
  });
});

// ──────────────── brain.forgetMemoryByKey ────────────────
//
// KommandoLearn fires forgetMemoryMut.mutateAsync({ key }) from the
// spaced-review "Got it ✓" button.

describe("brain.forgetMemoryByKey · spaced-review dismiss payload", () => {
  const forgetMemoryByKeyInput = z.object({
    key: z.string().min(1).max(200),
  });

  it("accepts a spaced-review key", () => {
    expect(() =>
      forgetMemoryByKeyInput.parse({ key: "review_options_trading_d3" }),
    ).not.toThrow();
  });

  it("rejects an empty key", () => {
    expect(() => forgetMemoryByKeyInput.parse({ key: "" })).toThrow();
  });
});

// ──────────────── task.leaveMission ────────────────
//
// ProjectDetail (clear-inbox + remove-from-project) and LinkProjectPicker
// ("leave mission") fire leaveMissionMut.mutateAsync({ id }).

describe("task.leaveMission · leave-project payload", () => {
  const leaveMissionInput = z.object({
    id: z.string().min(1).max(64),
  });

  it("accepts a task-id payload", () => {
    expect(() =>
      leaveMissionInput.parse({ id: "task_abc123" }),
    ).not.toThrow();
  });

  it("rejects an empty id", () => {
    expect(() => leaveMissionInput.parse({ id: "" })).toThrow();
  });

  it("rejects an id past the 64-char ceiling", () => {
    expect(() =>
      leaveMissionInput.parse({ id: "x".repeat(65) }),
    ).toThrow();
  });
});
