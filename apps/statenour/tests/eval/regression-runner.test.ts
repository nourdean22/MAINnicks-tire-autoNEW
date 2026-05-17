/**
 * v10.0.528 · Tests for the nightly eval regression harness.
 *
 * The runner is split so the pure-compute path (scoring + aggregation)
 * can be tested independently of the chat pipeline. We exercise:
 *
 *   1. scoreReply · happy path (pass)
 *   2. scoreReply · mustContain miss
 *   3. scoreReply · mustNotContain hit
 *   4. scoreReply · tool-call expectation (positive + null)
 *   5. scoreReply · length bounds
 *   6. runRegressionSuite · aggregation + worstCategories ordering
 *   7. runRegressionSuite · pipeline-error path
 *   8. consumeUIStream · parses text-delta + tool-call frames
 *
 *   v10.0.528 extensions:
 *   9.  scoreReply · brain_recall_precision · prefix wisdom-id matches trace
 *   10. scoreReply · tool_use_correctness · expectedToolFired
 *   11. scoreReply · voice_intent_classification · classifier + reply fallback
 *   12. scoreReply · anti_pattern_detection · trace + surface tool + reply-hint paths
 *   13. runRegressionSuite · categoryStats per-category passRate
 */

import { describe, it, expect } from "vitest";
import {
  scoreReply,
  runRegressionSuite,
  consumeUIStream,
  type GoldenQuestion,
} from "@/lib/eval/regression-runner";

function makeQ(overrides: Partial<GoldenQuestion> = {}): GoldenQuestion {
  return {
    id: "test-q",
    category: "factual",
    question: "what's my drift state?",
    expected: {
      shouldCallTool: null,
      mustContain: ["drift"],
      mustNotContain: ["I cannot"],
      minLength: 5,
      maxLength: 200,
    },
    added: "2026-05-12",
    ...overrides,
  };
}

describe("scoreReply", () => {
  it("passes when every check is satisfied", () => {
    const q = makeQ();
    const result = scoreReply(q, "Drift state is LOW · clear path.", []);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it("fails when mustContain miss", () => {
    const q = makeQ();
    const result = scoreReply(q, "Everything is fine right now.", []);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("missing"))).toBe(true);
    expect(result.score).toBeLessThan(1);
  });

  it("fails when forbidden phrase appears", () => {
    const q = makeQ();
    const result = scoreReply(q, "Drift state — I cannot answer that.", []);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("forbidden"))).toBe(true);
  });

  it("enforces shouldCallTool=null (no tool calls allowed)", () => {
    const q = makeQ();
    const result = scoreReply(q, "Drift state LOW.", ["getDriftAlerts"]);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("unexpected tool"))).toBe(true);
  });

  it("enforces shouldCallTool=<name> when set", () => {
    const q = makeQ({
      expected: {
        shouldCallTool: "getDriftAlerts",
        mustContain: ["drift"],
        minLength: 5,
        maxLength: 200,
      },
    });
    const missing = scoreReply(q, "Drift state LOW.", []);
    expect(missing.passed).toBe(false);
    const present = scoreReply(q, "Drift state LOW.", ["getDriftAlerts"]);
    expect(present.passed).toBe(true);
  });

  it("flags replies under minLength or over maxLength", () => {
    const q = makeQ({
      expected: { shouldCallTool: null, minLength: 10, maxLength: 20 },
    });
    expect(scoreReply(q, "short", []).passed).toBe(false);
    expect(scoreReply(q, "x".repeat(25), []).passed).toBe(false);
    expect(scoreReply(q, "x".repeat(15), []).passed).toBe(true);
  });
});

describe("runRegressionSuite", () => {
  it("aggregates pass/fail counts and produces worstCategories", async () => {
    const questions: GoldenQuestion[] = [
      makeQ({ id: "a", category: "factual" }),
      makeQ({ id: "b", category: "factual" }),
      makeQ({ id: "c", category: "fabrication_defense" }),
    ];

    // Runner: "a" passes, "b" fails (missing drift), "c" passes.
    const report = await runRegressionSuite({
      questionsOverride: questions,
      runnerOverride: async (q) => {
        if (q.id === "b") {
          return { reply: "Everything is fine.", toolCalls: [], durationMs: 10 };
        }
        return { reply: "Drift state LOW · clear path.", toolCalls: [], durationMs: 10 };
      },
    });

    expect(report.totalRan).toBe(3);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.passRate).toBeCloseTo(2 / 3, 2);
    expect(report.worstCategories[0]?.category).toBe("factual");
    expect(report.worstCategories[0]?.failed).toBe(1);
  });

  it("treats pipeline errors as fails without throwing", async () => {
    const report = await runRegressionSuite({
      questionsOverride: [makeQ({ id: "boom" })],
      runnerOverride: async () => ({
        reply: "",
        toolCalls: [],
        durationMs: 0,
        pipelineError: "provider exploded",
      }),
    });

    expect(report.totalRan).toBe(1);
    expect(report.failed).toBe(1);
    const r = report.perQuestionResults[0];
    expect(r.passed).toBe(false);
    expect(r.pipelineError).toBe("provider exploded");
    expect(r.failures[0]).toContain("pipeline error");
  });

  it("respects limit and category filters", async () => {
    const questions: GoldenQuestion[] = [
      makeQ({ id: "a", category: "factual" }),
      makeQ({ id: "b", category: "factual" }),
      makeQ({ id: "c", category: "reasoning" }),
    ];

    const limited = await runRegressionSuite({
      questionsOverride: questions,
      limit: 2,
      runnerOverride: async () => ({ reply: "Drift state LOW.", toolCalls: [], durationMs: 5 }),
    });
    expect(limited.totalRan).toBe(2);

    const filtered = await runRegressionSuite({
      questionsOverride: questions,
      category: "reasoning",
      runnerOverride: async () => ({ reply: "Drift state LOW.", toolCalls: [], durationMs: 5 }),
    });
    expect(filtered.totalRan).toBe(1);
    expect(filtered.perQuestionResults[0]?.id).toBe("c");
  });
});

describe("scoreReply · v10.0.528 extensions", () => {
  it("matches wisdom-id prefix from agentTrace.brainMemoryIds (brain_recall_precision)", () => {
    const q = makeQ({
      id: "brain-recall-test",
      category: "brain_recall_precision",
      expected: {
        expectedWisdomIds: ["wisdom_munger_*"],
        mustReferenceWisdom: true,
        minLength: 5,
      },
    });
    // Trace HIT · prefix-style id matches
    const pass = scoreReply(
      q,
      "Invert · what would make this fail first.",
      [],
      { brainMemoryIds: ["wisdom_munger_07", "wisdom_naval_03"] },
    );
    expect(pass.passed).toBe(true);
    // Trace MISS · expected prefix not present
    const fail = scoreReply(
      q,
      "Invert · what would make this fail first.",
      [],
      { brainMemoryIds: ["wisdom_jobs_01"] },
    );
    expect(fail.passed).toBe(false);
    expect(fail.failures.some((f) => f.includes("expected wisdom"))).toBe(true);
    // mustReferenceWisdom · no trace ids → fail
    const blockMiss = scoreReply(
      q,
      "Invert · what would make this fail first.",
      [],
      { brainMemoryIds: [] },
    );
    expect(blockMiss.passed).toBe(false);
    expect(blockMiss.failures.some((f) => f.includes("wisdom block to fire"))).toBe(true);
  });

  it("enforces expectedToolFired (tool_use_correctness)", () => {
    const q = makeQ({
      id: "tool-correctness-test",
      category: "tool_use_correctness",
      expected: {
        expectedToolFired: "getTodaySchedule",
        minLength: 5,
      },
    });
    const pass = scoreReply(q, "today: 3 tasks · 1 booking", ["getTodaySchedule"]);
    expect(pass.passed).toBe(true);
    const fail = scoreReply(q, "today: 3 tasks · 1 booking", ["getTasks"]);
    expect(fail.passed).toBe(false);
    expect(fail.failures.some((f) => f.includes("getTodaySchedule"))).toBe(true);
  });

  it("checks expectedIntent against classifier + falls back to reply scan", () => {
    const q = makeQ({
      id: "intent-test",
      category: "voice_intent_classification",
      expected: {
        expectedIntent: "booking",
        minLength: 5,
      },
    });
    // Classifier trace · exact match (reply ≥ minLength 5)
    const pass = scoreReply(q, "okay sure", [], { classifiedIntent: "booking" });
    expect(pass.passed).toBe(true);
    // Classifier trace · wrong intent
    const wrong = scoreReply(q, "okay sure", [], { classifiedIntent: "price" });
    expect(wrong.passed).toBe(false);
    // No classifier · fall back to substring scan on reply (literal label)
    const fallbackHit = scoreReply(q, "Confirmed booking for tomorrow morning.", []);
    expect(fallbackHit.passed).toBe(true);
    const fallbackMiss = scoreReply(q, "Drop by anytime FCFS.", []);
    expect(fallbackMiss.passed).toBe(false);
  });

  it("detects anti-pattern via trace, surface tool, or reply hint (anti_pattern_detection)", () => {
    const baseQ = makeQ({
      id: "antipattern-test",
      category: "anti_pattern_detection",
      expected: {
        mustReferenceAntiPattern: true,
        minLength: 5,
      },
    });
    // Path 1 · agentTrace.antiPatternKeys non-empty
    const traceHit = scoreReply(baseQ, "watch for X", [], {
      antiPatternKeys: ["procrastination_tomorrow"],
    });
    expect(traceHit.passed).toBe(true);
    // Path 2 · surfaceAntiPatterns tool fired AND reply has hint
    const toolHit = scoreReply(
      baseQ,
      "you said you would clear stale tasks last week. This is a pattern.",
      ["surfaceAntiPatterns"],
    );
    expect(toolHit.passed).toBe(true);
    // Path 3 · reply hint alone (no trace, no tool)
    const replyHit = scoreReply(baseQ, "you broke this commitment two weeks ago.", []);
    expect(replyHit.passed).toBe(true);
    // Total miss · no trace, no tool, no hint
    const miss = scoreReply(baseQ, "Sounds good, go for it.", []);
    expect(miss.passed).toBe(false);
    expect(miss.failures.some((f) => f.includes("anti-pattern"))).toBe(true);

    // Specific id requested · trace must include it OR reply mentions it
    const specificQ = makeQ({
      id: "antipattern-id-test",
      category: "anti_pattern_detection",
      expected: {
        mustReferenceAntiPattern: true,
        expectedAntiPatternId: "skip_verify",
        minLength: 5,
      },
    });
    const idHit = scoreReply(specificQ, "watch for X", [], {
      antiPatternKeys: ["skip_verify"],
    });
    expect(idHit.passed).toBe(true);
    const idMiss = scoreReply(specificQ, "go for it", [], {
      antiPatternKeys: ["other_pattern"],
    });
    expect(idMiss.passed).toBe(false);
  });

  it("emits categoryStats with per-category passRate", async () => {
    const questions: GoldenQuestion[] = [
      makeQ({ id: "a1", category: "factual" }),
      makeQ({ id: "a2", category: "factual" }),
      makeQ({
        id: "b1",
        category: "brain_recall_precision",
        expected: {
          expectedWisdomIds: ["wisdom_naval_*"],
          mustReferenceWisdom: true,
          minLength: 5,
        },
      }),
      makeQ({
        id: "b2",
        category: "brain_recall_precision",
        expected: {
          expectedWisdomIds: ["wisdom_naval_*"],
          mustReferenceWisdom: true,
          minLength: 5,
        },
      }),
    ];

    const report = await runRegressionSuite({
      questionsOverride: questions,
      runnerOverride: async (q) => {
        if (q.id === "a1") {
          return { reply: "Drift state LOW · clear path.", toolCalls: [], durationMs: 5 };
        }
        if (q.id === "a2") {
          // missing "drift" → fail
          return { reply: "Everything fine.", toolCalls: [], durationMs: 5 };
        }
        if (q.id === "b1") {
          return {
            reply: "leverage compounds when you own equity",
            toolCalls: [],
            durationMs: 5,
            agentTrace: { brainMemoryIds: ["wisdom_naval_03"] },
          };
        }
        // b2 · trace missing the expected prefix → fail
        return {
          reply: "leverage compounds when you own equity",
          toolCalls: [],
          durationMs: 5,
          agentTrace: { brainMemoryIds: ["wisdom_jobs_01"] },
        };
      },
    });

    expect(report.categoryStats).toBeDefined();
    expect(report.categoryStats.length).toBe(2);
    const factualStats = report.categoryStats.find((c) => c.category === "factual");
    const brainStats = report.categoryStats.find((c) => c.category === "brain_recall_precision");
    expect(factualStats?.total).toBe(2);
    expect(factualStats?.passed).toBe(1);
    expect(factualStats?.passRate).toBeCloseTo(0.5, 2);
    expect(brainStats?.total).toBe(2);
    expect(brainStats?.passed).toBe(1);
    expect(brainStats?.passRate).toBeCloseTo(0.5, 2);
    expect(report.passRate).toBeCloseTo(0.5, 2);
  });
});

describe("consumeUIStream", () => {
  it("parses text-delta and tool-call frames from a synthetic stream", async () => {
    const frames = [
      `data: ${JSON.stringify({ type: "text-delta", delta: "Hello " })}`,
      `data: ${JSON.stringify({ type: "text-delta", delta: "world" })}`,
      `data: ${JSON.stringify({ type: "tool-call", toolName: "getDriftAlerts", toolCallId: "t1" })}`,
      // duplicate id should not double-count
      `data: ${JSON.stringify({ type: "tool-input-start", toolName: "getDriftAlerts", toolCallId: "t1" })}`,
      `data: ${JSON.stringify({ type: "tool-call", toolName: "getTasks", toolCallId: "t2" })}`,
      // a garbage line must be skipped silently
      `data: not-json{`,
      `data: [DONE]`,
    ].join("\n") + "\n";

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frames));
        controller.close();
      },
    });

    const { reply, toolCalls } = await consumeUIStream(stream);
    expect(reply).toBe("Hello world");
    expect(toolCalls).toEqual(["getDriftAlerts", "getTasks"]);
  });
});
