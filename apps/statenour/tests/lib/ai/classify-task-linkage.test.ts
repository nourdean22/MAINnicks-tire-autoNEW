/**
 * Classifier deterministic-fallback tests · 2026-06-01.
 *
 * The AI path (classifyTaskLinkage) is integration-covered; this pins the
 * pure keyword fallback that runs when the model is unavailable — so a
 * classifier outage still produces a sane best-effort link instead of none.
 */
import { describe, it, expect } from "vitest";
import { fallbackLinkage, type ClassifyLinkageInput } from "@/lib/ai/classify-task-linkage";

const STATS = [
  { key: "physical", label: "Physical Vitality" },
  { key: "business_ops", label: "Business Operations" },
];

function input(over: Partial<ClassifyLinkageInput>): ClassifyLinkageInput {
  return { taskTitle: "", missions: [], goals: [], stats: STATS, ...over };
}

describe("fallbackLinkage · keyword overlap", () => {
  it("matches the mission sharing the most salient words", () => {
    const r = fallbackLinkage(
      input({
        taskTitle: "Send the brake estimate to the customer",
        missions: [
          { id: "m1", title: "Estimate follow-ups", domain: "sales" },
          { id: "m2", title: "Instagram content", domain: "marketing" },
        ],
      }),
    );
    expect(r.missionId).toBe("m1"); // shares "estimate"
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("only links a goal on a strong (>=2 word) overlap", () => {
    const weak = fallbackLinkage(
      input({
        taskTitle: "ship reminder",
        goals: [{ id: "g1", title: "ship statenour mvp launch", domain: "business" }],
      }),
    );
    expect(weak.goalId).toBeNull(); // only "ship" overlaps (1 < 2 threshold)

    const strong = fallbackLinkage(
      input({
        taskTitle: "ship statenour mvp launch milestone",
        goals: [{ id: "g1", title: "ship statenour mvp launch", domain: "business" }],
      }),
    );
    expect(strong.goalId).toBe("g1"); // 4 shared salient words
  });

  it("returns no link when nothing overlaps", () => {
    const r = fallbackLinkage(
      input({
        taskTitle: "zzz qqq",
        missions: [{ id: "m1", title: "Estimate follow-ups", domain: "sales" }],
      }),
    );
    expect(r.missionId).toBeNull();
    expect(r.goalId).toBeNull();
    expect(r.statHints).toEqual([]);
  });

  it("ignores stopwords + short words so generic verbs don't false-match", () => {
    const r = fallbackLinkage(
      input({
        taskTitle: "call to set up a new thing",
        missions: [{ id: "m1", title: "Call the bank", domain: "finance" }],
      }),
    );
    // "call"/"to"/"set"/"up"/"a"/"new" are all stopwords → no salient overlap
    expect(r.missionId).toBeNull();
  });

  it("empty title → empty result (domain defaults to personal)", () => {
    const r = fallbackLinkage(input({ taskTitle: "   " }));
    expect(r).toEqual({
      missionId: null,
      goalId: null,
      statHints: [],
      domain: "personal",
      confidence: 0,
      rationale: "",
    });
  });
});

describe("fallbackLinkage · canonical domain (2026-06-09)", () => {
  const FIVE = ["health", "mind", "business", "social", "personal"];

  it("ALWAYS resolves one of the 5 domains", () => {
    for (const t of [
      "go to the gym", "read a book", "fix the customer invoice",
      "call mom", "pray fajr", "buy groceries", "zzz qqq",
    ]) {
      expect(FIVE).toContain(fallbackLinkage(input({ taskTitle: t })).domain);
    }
  });

  it("infers the domain from keyword cues", () => {
    expect(fallbackLinkage(input({ taskTitle: "workout at the gym" })).domain).toBe("health");
    expect(fallbackLinkage(input({ taskTitle: "pray and read quran" })).domain).toBe("mind");
    expect(fallbackLinkage(input({ taskTitle: "send customer the invoice" })).domain).toBe("business");
    expect(fallbackLinkage(input({ taskTitle: "dinner with family" })).domain).toBe("social");
    expect(fallbackLinkage(input({ taskTitle: "study the course material" })).domain).toBe("mind");
    expect(fallbackLinkage(input({ taskTitle: "organize the garage" })).domain).toBe("personal");
  });
});
