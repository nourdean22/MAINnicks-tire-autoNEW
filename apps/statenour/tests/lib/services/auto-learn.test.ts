/**
 * runAutoLearn tests · v10.0.529.106 · Wave 54
 *
 * Pins the cross-engine completion contract that fires after every
 * Task transitions to DONE. Three engines: Mastery (domain score
 * bump) · Knowledge (BrainMemory task_insight when title reads as a
 * learning) · Learn (BrainMemory learn_complete when title prefix
 * matches "Tutorial:" / "Lesson:"). Plus a Wisdom citation pass
 * that only fires when at least ONE engine actually did something.
 *
 * The contract is: each engine fails gracefully so the report can
 * have partial nulls. Wisdom citation only runs when there was
 * real growth (no wisdom on a "nothing happened" task). Ghost
 * outcome always runs · independent of engines.
 *
 * Test surface is the v22 adaptive-scoring formula:
 *   bump = BASE(0.5) · roiWeight · effortMult · goalMult · streakMult
 *   bounded [0.1, 3.0] · rounded to 1 decimal place.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  masteryScore: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  brainMemory: {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
  },
  recordGhostOutcome: vi.fn().mockResolvedValue(null),
  enrichInsightAsync: vi.fn(),
  semanticSearch: vi.fn().mockResolvedValue([]),
  storeMemoryEmbedding: vi.fn().mockResolvedValue(undefined),
  today: vi.fn(() => "2026-05-16"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    masteryScore: mocks.masteryScore,
    brainMemory: mocks.brainMemory,
    mission: mocks.mission,
  },
}));
vi.mock("@/lib/utils/datetime", () => ({ today: mocks.today }));
vi.mock("@/lib/services/auto-learn-llm", () => ({
  enrichInsightAsync: mocks.enrichInsightAsync,
}));
vi.mock("@/lib/brain/ghost-nick", () => ({
  recordGhostOutcome: mocks.recordGhostOutcome,
}));
vi.mock("@/lib/brain/embedding-utils", () => ({
  semanticSearch: mocks.semanticSearch,
  storeMemoryEmbedding: mocks.storeMemoryEmbedding,
}));

import { runAutoLearn } from "@/lib/services/auto-learn";

describe("runAutoLearn · mastery engine adaptive scoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.masteryScore.findUnique.mockResolvedValue(null);
    mocks.masteryScore.findFirst.mockResolvedValue({ score: 50 });
    mocks.masteryScore.upsert.mockResolvedValue({});
  });

  it("lifts the domain score using BASE × roi × effort × goal × streak", async () => {
    // Mid-ROI · M30 effort · no goal · no streak.
    // 0.5 × 0.5 × 1.0 × 1.0 × 1.0 = 0.25 → bounded → 0.3 (1dp).
    const report = await runAutoLearn({
      taskId: "t1",
      task: {
        title: "ship X",
        finishCondition: null,
        mission: { title: "Business", domain: "BUSINESS" },
        goal: null,
        roiScore: 50,
        effort: "M30",
        loopKind: "ONCE",
        streakCount: 0,
        hasGoalId: false,
      },
    });
    expect(report.mastery).toMatchObject({
      domain: "BUSINESS",
      delta: 0.3,
      date: "2026-05-16",
    });
  });

  it("rewards a 7-day daily streak with the 2× streak multiplier", async () => {
    // High-ROI · H1 · goal-linked · 7d streak.
    // 0.5 × 1.0 × 1.3 × 1.5 × 2.0 = 1.95 → ~2.0 (1dp).
    const report = await runAutoLearn({
      taskId: "t2",
      task: {
        title: "20 min run",
        finishCondition: null,
        mission: { title: "Fitness", domain: "HEALTH" },
        goal: { domain: "HEALTH" },
        roiScore: 100,
        effort: "H1",
        loopKind: "DAILY",
        streakCount: 7,
        hasGoalId: true,
      },
    });
    expect(report.mastery?.delta).toBeGreaterThanOrEqual(1.9);
    expect(report.mastery?.delta).toBeLessThanOrEqual(2.1);
  });

  it("returns null for the mastery engine when no domain can be resolved", async () => {
    const report = await runAutoLearn({
      taskId: "t3",
      task: {
        title: "no-domain task",
        finishCondition: null,
        mission: null,
        goal: null,
      },
    });
    expect(report.mastery).toBeNull();
  });

  it("returns null delta when score already at cap (100)", async () => {
    mocks.masteryScore.findUnique.mockResolvedValueOnce({ score: 100 });
    const report = await runAutoLearn({
      taskId: "t4",
      task: {
        title: "maxed-out domain",
        finishCondition: null,
        mission: { title: "X", domain: "FINANCE" },
        goal: null,
      },
    });
    // Lift can't push past 100 · delta = 0 → engine returns null.
    expect(report.mastery).toBeNull();
  });
});

describe("runAutoLearn · knowledge engine learning detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.masteryScore.findUnique.mockResolvedValue(null);
    mocks.masteryScore.findFirst.mockResolvedValue({ score: 50 });
    mocks.masteryScore.upsert.mockResolvedValue({});
    mocks.brainMemory.upsert.mockResolvedValue({});
  });

  it("captures a knowledge insight when the title reads like a learning", async () => {
    const report = await runAutoLearn({
      taskId: "t5",
      task: {
        title: "researched Postgres index strategy",
        finishCondition: null,
        mission: { title: "Eng", domain: "BUSINESS" },
        goal: null,
      },
    });
    expect(report.knowledge).not.toBeNull();
    expect(report.knowledge?.content).toContain("Postgres");
  });

  it("forwards outcomeScore and completionNote to enrichInsightAsync when present", async () => {
    const report = await runAutoLearn({
      taskId: "t5-outcome",
      task: {
        title: "learned Postgres index strategy",
        finishCondition: null,
        mission: { title: "Eng", domain: "BUSINESS" },
        goal: null,
        outcomeScore: 85,
        completionNote: "Successful indexing optimize",
      },
    });

    expect(report.knowledge).not.toBeNull();
    expect(mocks.enrichInsightAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          outcomeScore: 85,
          completionNote: "Successful indexing optimize",
        }),
      })
    );
  });

  it("does NOT capture knowledge for a plain action title", async () => {
    const report = await runAutoLearn({
      taskId: "t6",
      task: {
        title: "send invoice to ABC corp",
        finishCondition: null,
        mission: { title: "Sales", domain: "BUSINESS" },
        goal: null,
      },
    });
    expect(report.knowledge).toBeNull();
  });

  it("matches each learning verb the LEARNING_VERB_PATTERN covers", async () => {
    const verbs = ["learned", "studied", "watched", "read", "discovered"];
    for (const v of verbs) {
      vi.clearAllMocks();
      mocks.masteryScore.findFirst.mockResolvedValue({ score: 50 });
      mocks.masteryScore.upsert.mockResolvedValue({});
      mocks.brainMemory.upsert.mockResolvedValue({});
      const report = await runAutoLearn({
        taskId: `verb-${v}`,
        task: {
          title: `${v} how the autonomous engine claims fire`,
          finishCondition: null,
          mission: { title: "Eng", domain: "BUSINESS" },
          goal: null,
        },
      });
      expect(report.knowledge, `verb=${v}`).not.toBeNull();
    }
  });
});

describe("runAutoLearn · learn engine tutorial detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.masteryScore.findUnique.mockResolvedValue(null);
    mocks.masteryScore.findFirst.mockResolvedValue({ score: 50 });
    mocks.masteryScore.upsert.mockResolvedValue({});
    mocks.brainMemory.upsert.mockResolvedValue({});
  });

  it("records a learn_complete row when title is prefixed Tutorial:", async () => {
    const report = await runAutoLearn({
      taskId: "t7",
      task: {
        title: "Tutorial: pgvector basics",
        finishCondition: null,
        mission: { title: "Eng", domain: "BUSINESS" },
        goal: null,
      },
    });
    expect(report.learn).not.toBeNull();
    expect(report.learn?.slug).toContain("pgvector");
  });

  it("skips learn engine when title lacks the tutorial prefix", async () => {
    const report = await runAutoLearn({
      taskId: "t8",
      task: {
        title: "wrote a blog post on pgvector",
        finishCondition: null,
        mission: { title: "Eng", domain: "BUSINESS" },
        goal: null,
      },
    });
    expect(report.learn).toBeNull();
  });
});

describe("runAutoLearn · graceful failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never throws when every engine fails · returns a partial report", async () => {
    mocks.masteryScore.findUnique.mockRejectedValue(new Error("DB down"));
    mocks.masteryScore.findFirst.mockRejectedValue(new Error("DB down"));
    mocks.brainMemory.upsert.mockRejectedValue(new Error("DB down"));

    const report = await runAutoLearn({
      taskId: "t9",
      task: {
        title: "anything",
        finishCondition: null,
        mission: { title: "X", domain: "BUSINESS" },
        goal: null,
      },
    });
    // All engines null but the call itself resolves.
    expect(report.mastery).toBeNull();
    expect(report.knowledge).toBeNull();
    expect(report.learn).toBeNull();
    expect(report.wisdom).toBeNull();
  });
});
