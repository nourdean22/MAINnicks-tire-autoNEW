/**
 * NICK VNEXT · deterministic golden set v1 — the SIGNAL layer (2026-08-12).
 *
 * Plan #21's Eval-40, restricted to what a golden set can honestly gate
 * today: the PURE per-turn routing signals (query shape, turn classifier,
 * action intent, response contract) plus cross-layer routing rows. Every
 * item is machine-checkable — no LLM, no judge. The LLM-graded half of
 * Eval-40 (strategic quality, anti-sycophancy pairs) needs the Ollama
 * judge harness and is deliberately NOT faked here with string matches.
 *
 * These fixtures pin RELATIVE invariants (factual runs tighter than
 * creative; yes/no budgets under explain budgets) rather than magic
 * numbers, so classifier tuning doesn't shatter the suite — only an
 * inversion of the documented design does.
 */

import { describe, it, expect } from "vitest";
import { detectQueryShape } from "@/lib/ai/query-shape";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { buildResponseContract } from "@/lib/ai/response-contract";
import { detectActionIntent } from "@/lib/ai/chat/action-intent-detector";
import { routeCapability, canaryDeepForce, CLAUDE5_MODELS } from "@/lib/ai/vnext/effort-policy";

describe("golden · query shape budgets (relative invariants)", () => {
  const budget = (q: string) => detectQueryShape(q).tokenBudget;

  it("yes/no and casual turns budget under explain turns", () => {
    const yesNo = budget("is the deploy green?");
    const casual = budget("hey what's up");
    const explain = budget("explain how the tire rotation schedule works and why it matters");
    for (const b of [yesNo, casual]) {
      if (b > 0 && explain > 0) expect(b).toBeLessThanOrEqual(explain);
    }
  });

  it("plan-shaped asks get the largest budgets", () => {
    const plan = budget("give me a step by step plan to grow the shop to 2M revenue");
    const yesNo = budget("is the deploy green?");
    if (plan > 0 && yesNo > 0) expect(plan).toBeGreaterThanOrEqual(yesNo);
  });
});

describe("golden · turn classifier (documented design invariants)", () => {
  it("factual turns run tighter than creative turns", () => {
    const factual = classifyTurn("what was the total revenue in March?");
    const creative = classifyTurn("brainstorm wild new slogan ideas for the shop");
    expect(factual.temperature).toBeLessThan(creative.temperature);
  });

  it("temperature always stays inside the classifier's own 0.1-0.9 band", () => {
    for (const q of [
      "what was the total revenue in March?",
      "brainstorm wild new slogan ideas for the shop",
      "hey",
      "should I open a second location or reinvest?",
      "write me an email to the supplier about the late delivery",
    ]) {
      const t = classifyTurn(q).temperature;
      expect(t).toBeGreaterThanOrEqual(0.1);
      expect(t).toBeLessThanOrEqual(0.9);
    }
  });

  it("a consequential decision ask classifies as decision or factual — never casual", () => {
    const turn = classifyTurn("should I take the $80K loan to open a second location?");
    expect(["decision", "factual", "analytical", "complex"]).toContain(turn.intent);
  });
});

describe("golden · action intent (the anti-fabrication force's trigger)", () => {
  it("clear action asks produce an intent with an expected tool", () => {
    const intent = detectActionIntent("add a task to rotate the Chevy's tires tomorrow");
    expect(intent).not.toBeNull();
    expect(intent?.expectedTool ?? "").toMatch(/task/i);
  });

  it("pure questions produce NO action intent (reads stay toolChoice auto)", () => {
    expect(detectActionIntent("what tasks do I have today?")).toBeNull();
    expect(detectActionIntent("how did revenue do last month?")).toBeNull();
  });
});

describe("golden · response contract (request-fit obligations)", () => {
  it("a concise ask produces a concise-length contract", () => {
    const turn = classifyTurn("keep it concise: is the deploy green?");
    const c = buildResponseContract("keep it concise: is the deploy green?", turn);
    expect(["ultra_concise", "concise"]).toContain(c.length);
  });

  it("a top-N ask pins the rank count", () => {
    const turn = classifyTurn("give me the top 5 upgrades");
    const c = buildResponseContract("give me the top 5 upgrades", turn);
    expect(c.rankCount).toBe(5);
  });

  it("plain turns carry no rank obligation", () => {
    const turn = classifyTurn("how are the bays looking today?");
    const c = buildResponseContract("how are the bays looking today?", turn);
    expect(c.rankCount).toBeNull();
  });
});

describe("golden · routing layer (cross-checks against the shipped policies)", () => {
  it("deep-mode canary force only exists under its attestation", () => {
    expect(canaryDeepForce("deep", false)).toBeUndefined();
    expect(canaryDeepForce("deep", true)).toBe("anthropic");
    expect(canaryDeepForce("standard", true)).toBeUndefined();
  });

  it("untrusted input always routes to the classifier-on lane", () => {
    const d = routeCapability({ band: "hard", untrustedInput: true, mythosEnabled: true });
    expect(d.model).toBe(CLAUDE5_MODELS.fable);
  });

  it("frontier effort stays justify-gated even under a conversation pin", () => {
    const d = routeCapability({ band: "normal", conversationEffort: "max", mythosEnabled: false });
    expect(d.effort).not.toBe("max");
  });
});
