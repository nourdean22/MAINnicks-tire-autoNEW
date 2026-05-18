/**
 * tests/ai/judge-eval.test.ts · Phase V.7 (2026-05-18 PM)
 *
 * Pure tests for the LLM-as-judge response parser. The parser is the
 * only piece of the judge-eval pipeline worth testing in isolation
 * (the LLM call itself gets integration coverage via the
 * /api/judge-eval/run endpoint; persistence + aggregation get hit
 * during real comparison runs).
 *
 * What the parser MUST handle:
 *   · clean JSON · the happy path
 *   · markdown fence wrappers (some models force ```json ... ```)
 *   · leading/trailing commentary
 *   · partial dimensions (fill missing with `tie` defaults)
 *   · out-of-range v2Score (clamp to 0-100)
 *   · invalid winner strings (default to `tie`)
 *   · empty / null / non-JSON inputs (default judgment, parsed:false)
 */

import { describe, expect, it } from "vitest";
import { parseJudgeResponse } from "@/lib/ai/judge-eval/comparator";
import { classifyIntent } from "@/lib/ai/judge-eval/sampler";

describe("parseJudgeResponse · Phase V judge-eval parser", () => {
  it("parses a clean JSON response", () => {
    const raw = JSON.stringify({
      winner: "v2",
      v2Score: 72,
      dimensions: [
        { dimension: "accuracy", winner: "v2", reason: "v2 cited specific numbers" },
        { dimension: "clarity", winner: "v2", reason: "v2 led with the headline" },
        { dimension: "conciseness", winner: "tie", reason: "same length" },
        { dimension: "operator-fit", winner: "v2", reason: "v2 connected to ops" },
      ],
      summary: "V2 wins 3-0-1 across dimensions.",
    });
    const result = parseJudgeResponse(raw);
    expect(result.parsed).toBe(true);
    expect(result.winner).toBe("v2");
    expect(result.v2Score).toBe(72);
    expect(result.dimensions).toHaveLength(4);
    expect(result.dimensions[0].dimension).toBe("accuracy");
    expect(result.summary).toContain("V2 wins");
  });

  it("strips markdown fence wrappers", () => {
    const raw = "```json\n" + JSON.stringify({
      winner: "v1",
      v2Score: 30,
      dimensions: [],
      summary: "V1 dominant.",
    }) + "\n```";
    const result = parseJudgeResponse(raw);
    expect(result.parsed).toBe(true);
    expect(result.winner).toBe("v1");
    expect(result.v2Score).toBe(30);
  });

  it("tolerates leading commentary before the JSON", () => {
    const raw = "Here is my verdict:\n\n" + JSON.stringify({
      winner: "tie",
      v2Score: 50,
      dimensions: [],
      summary: "Even split.",
    });
    const result = parseJudgeResponse(raw);
    expect(result.parsed).toBe(true);
    expect(result.winner).toBe("tie");
  });

  it("fills missing dimensions with tie defaults", () => {
    const raw = JSON.stringify({
      winner: "v2",
      v2Score: 60,
      dimensions: [
        { dimension: "accuracy", winner: "v2", reason: "specific" },
      ],
      summary: "Partial response.",
    });
    const result = parseJudgeResponse(raw);
    expect(result.parsed).toBe(true);
    expect(result.dimensions).toHaveLength(4);
    // Missing 3 dimensions filled with tie defaults
    const missing = result.dimensions.filter((d) => d.dimension !== "accuracy");
    expect(missing.every((d) => d.winner === "tie")).toBe(true);
  });

  it("clamps out-of-range v2Score values", () => {
    const tooHigh = parseJudgeResponse(
      JSON.stringify({ winner: "v2", v2Score: 150, dimensions: [], summary: "" }),
    );
    expect(tooHigh.v2Score).toBe(100);

    const tooLow = parseJudgeResponse(
      JSON.stringify({ winner: "v1", v2Score: -20, dimensions: [], summary: "" }),
    );
    expect(tooLow.v2Score).toBe(0);
  });

  it("defaults v2Score to 50 when missing or non-numeric", () => {
    const missing = parseJudgeResponse(
      JSON.stringify({ winner: "tie", dimensions: [], summary: "" }),
    );
    expect(missing.v2Score).toBe(50);

    const stringValue = parseJudgeResponse(
      JSON.stringify({ winner: "tie", v2Score: "high", dimensions: [], summary: "" }),
    );
    expect(stringValue.v2Score).toBe(50);
  });

  it("normalizes unknown winner strings to tie", () => {
    const result = parseJudgeResponse(
      JSON.stringify({ winner: "MAYBE", v2Score: 50, dimensions: [], summary: "" }),
    );
    expect(result.parsed).toBe(true);
    expect(result.winner).toBe("tie");
  });

  it("rejects empty strings with default tie judgment + parsed=false", () => {
    const result = parseJudgeResponse("");
    expect(result.parsed).toBe(false);
    expect(result.winner).toBe("tie");
    expect(result.v2Score).toBe(50);
    expect(result.summary).toContain("empty");
  });

  it("rejects responses with no JSON object", () => {
    const result = parseJudgeResponse("Sorry, I cannot evaluate this.");
    expect(result.parsed).toBe(false);
    expect(result.winner).toBe("tie");
    expect(result.summary).toContain("no JSON object");
  });

  it("rejects malformed JSON", () => {
    const result = parseJudgeResponse("{ not valid json at all }");
    expect(result.parsed).toBe(false);
    expect(result.winner).toBe("tie");
    expect(result.summary).toContain("parse failed");
  });

  it("ignores unknown dimensions (whitelist)", () => {
    const raw = JSON.stringify({
      winner: "v2",
      v2Score: 60,
      dimensions: [
        { dimension: "accuracy", winner: "v2", reason: "ok" },
        { dimension: "vibes", winner: "v2", reason: "ignored" },
        { dimension: "clarity", winner: "v1", reason: "ok" },
      ],
      summary: "",
    });
    const result = parseJudgeResponse(raw);
    expect(result.parsed).toBe(true);
    expect(result.dimensions).toHaveLength(4);
    expect(result.dimensions.find((d) => d.dimension === "accuracy")?.winner).toBe("v2");
    expect(result.dimensions.find((d) => d.dimension === "clarity")?.winner).toBe("v1");
    // No "vibes" entry should leak through
    expect(result.dimensions.find((d) => (d.dimension as string) === "vibes")).toBeUndefined();
  });

  it("truncates overly long reason fields (defense-in-depth)", () => {
    const longReason = "x".repeat(500);
    const raw = JSON.stringify({
      winner: "tie",
      v2Score: 50,
      dimensions: [
        { dimension: "accuracy", winner: "tie", reason: longReason },
      ],
      summary: "y".repeat(1000),
    });
    const result = parseJudgeResponse(raw);
    expect(result.dimensions[0].reason.length).toBeLessThanOrEqual(200);
    expect(result.summary.length).toBeLessThanOrEqual(400);
  });
});

describe("classifyIntent · Phase X sampler heuristic", () => {
  it("routes question-words to 'question'", () => {
    expect(classifyIntent("what is the best tire for snow?")).toBe("question");
    expect(classifyIntent("How do I rotate tires safely?")).toBe("question");
    expect(classifyIntent("why won't the alignment hold?")).toBe("question");
    expect(classifyIntent("WHEN should I replace shocks")).toBe("question");
  });

  it("routes composition verbs to 'compose'", () => {
    expect(classifyIntent("write a customer follow-up text")).toBe("compose");
    expect(classifyIntent("draft an email to the supplier")).toBe("compose");
    expect(classifyIntent("Create a service description")).toBe("compose");
    expect(classifyIntent("generate a daily newsletter")).toBe("compose");
  });

  it("routes summarize verbs to 'summarize'", () => {
    expect(classifyIntent("summarize last week's revenue")).toBe("summarize");
    expect(classifyIntent("TL;DR the meeting notes")).toBe("summarize");
    expect(classifyIntent("tldr what happened in Q3")).toBe("summarize");
  });

  it("routes plan verbs to 'plan'", () => {
    expect(classifyIntent("plan the Q4 marketing push")).toBe("plan");
    expect(classifyIntent("design a customer loyalty flow")).toBe("plan");
    expect(classifyIntent("outline the next migration")).toBe("plan");
  });

  it("routes decision-seeking phrases to 'decide'", () => {
    expect(classifyIntent("should I switch tire suppliers")).toBe("decide");
    expect(classifyIntent("do you think I should hire?")).toBe("decide");
    expect(classifyIntent("recommend a new tool for invoicing")).toBe("decide");
    expect(classifyIntent("advise me on hiring strategy")).toBe("decide");
  });

  it("routes debug requests to 'debug'", () => {
    // Note · "fix"/"debug" leading verbs route to debug. "why X" stays
    // as "question" by design (question form wins over content type ·
    // checked first in the classifier · documented behavior).
    expect(classifyIntent("fix the broken alignment machine")).toBe("debug");
    expect(classifyIntent("debug why the SMS gateway is silent")).toBe("debug");
  });

  it("prioritizes question form over content type (why-questions stay 'question')", () => {
    // Contract test · drift here would change which dashboard bucket
    // every why-question lands in. Keep this behavior stable unless
    // explicitly redesigning the routing precedence.
    expect(classifyIntent("why isn't the cron firing")).toBe("question");
    expect(classifyIntent("why won't the booking go through")).toBe("question");
  });

  it("routes review verbs to 'review'", () => {
    expect(classifyIntent("audit last month's labor margins")).toBe("review");
    expect(classifyIntent("review my Q3 pricing")).toBe("review");
    expect(classifyIntent("inspect the brand voice consistency")).toBe("review");
  });

  it("routes long-form prompts (>250 chars) to 'long-form'", () => {
    const longPrompt = "I want to think through a multi-quarter strategy that " +
      "spans pricing, hiring, equipment financing, and brand positioning. " +
      "There are tradeoffs between margin and volume that depend on competitor " +
      "moves in the next 6 months and I want a structured framework.";
    expect(classifyIntent(longPrompt)).toBe("long-form");
  });

  it("returns null for empty / ambiguous prompts", () => {
    expect(classifyIntent("")).toBeNull();
    expect(classifyIntent("   ")).toBeNull();
    expect(classifyIntent("ok thanks")).toBeNull();
    expect(classifyIntent("this is a short statement")).toBeNull();
  });

  it("is case-insensitive on the leading verb", () => {
    expect(classifyIntent("WRITE a follow-up")).toBe("compose");
    expect(classifyIntent("FIX the alignment")).toBe("debug");
    expect(classifyIntent("Plan the launch")).toBe("plan");
  });
});
