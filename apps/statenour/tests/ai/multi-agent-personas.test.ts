/**
 * tests/ai/multi-agent-personas.test.ts · Phase R (2026-05-18 PM)
 *
 * Tests for the M.2 persona-wiring follow-up · validates that
 * `SubAgentTask.persona` actually changes the system prompt the
 * orchestrator sends to the sub-agent LLM, and that unknown keys fall
 * back gracefully instead of silently disabling steering.
 *
 * Pure unit tests · exercise `resolveSubAgentSystemPrompt` directly ·
 * no aiChat mocking, no provider plumbing, no DB. The whole point of
 * extracting the helper was so this single decision is fast-testable.
 */

import { describe, expect, it } from "vitest";
import { resolveSubAgentSystemPrompt } from "@/lib/ai/multi-agent-orchestrator";
import {
  RESEARCH_ANALYST,
  CONTRARIAN_CRITIC,
  EXECUTION_PLANNER,
  PERSONAS,
  getPersona,
  personaToSystemPrompt,
} from "@/lib/ai/personas";

describe("resolveSubAgentSystemPrompt · Phase R persona wiring", () => {
  it("returns the generic SUB_AGENT_SYSTEM when no persona key given", () => {
    const generic = resolveSubAgentSystemPrompt();
    expect(generic).toContain("focused sub-agent");
    expect(generic).toContain("Output max 200 words");
    // The generic prompt should NOT include any persona-specific
    // language (no role title, no backstory)
    expect(generic).not.toContain("GOAL:");
    expect(generic).not.toContain("BACKGROUND:");
  });

  it("returns the persona prompt for research-analyst", () => {
    const prompt = resolveSubAgentSystemPrompt("research-analyst");
    expect(prompt).toContain("Research Analyst");
    expect(prompt).toContain("Surface the 3-5 concrete pieces");
    expect(prompt).toContain("terse, factual, allergic to vague claims");
  });

  it("returns the persona prompt for contrarian-critic", () => {
    const prompt = resolveSubAgentSystemPrompt("contrarian-critic");
    expect(prompt).toContain("Contrarian Risk Analyst");
    expect(prompt).toContain("failure modes");
    expect(prompt).toContain("professional skeptic");
  });

  it("falls back to generic SUB_AGENT_SYSTEM on unknown persona key", () => {
    // The orchestrator should NOT throw on typos · it should fall
    // back to the generic prompt + log a warning. The warning isn't
    // asserted here (no logger mock) · we just verify the fallback.
    const prompt = resolveSubAgentSystemPrompt("definitely-not-a-real-persona");
    const generic = resolveSubAgentSystemPrompt();
    expect(prompt).toBe(generic);
  });

  it("falls back to generic SUB_AGENT_SYSTEM on empty-string key", () => {
    // Empty string is treated like an unknown key (not "no persona")
    // because the orchestrator path only sees the field after the
    // caller has explicitly set it. Tightens the contract.
    const prompt = resolveSubAgentSystemPrompt("");
    const generic = resolveSubAgentSystemPrompt();
    expect(prompt).toBe(generic);
  });

  it("returns a different prompt for each registered persona", () => {
    // Sanity check · ensures the personas aren't accidentally
    // collapsed to the same string by personaToSystemPrompt.
    const seen = new Set<string>();
    for (const key of Object.keys(PERSONAS)) {
      const prompt = resolveSubAgentSystemPrompt(key);
      expect(seen.has(prompt)).toBe(false);
      seen.add(prompt);
    }
    // 8 personas in the M.2 library
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });
});

describe("persona library · Phase R wiring depends on these contracts", () => {
  it("research-analyst is registered under the expected key", () => {
    // The engine's runMultiAgent hard-codes `persona: "research-analyst"`
    // — if this key ever changes the engine will silently fall back
    // to the generic prompt. This test pins the contract.
    expect(getPersona("research-analyst")).not.toBeNull();
    expect(RESEARCH_ANALYST.key).toBe("research-analyst");
  });

  it("contrarian-critic is registered under the expected key", () => {
    expect(getPersona("contrarian-critic")).not.toBeNull();
    expect(CONTRARIAN_CRITIC.key).toBe("contrarian-critic");
  });

  it("execution-planner is registered under the expected key (future runRouter wiring)", () => {
    expect(getPersona("execution-planner")).not.toBeNull();
    expect(EXECUTION_PLANNER.key).toBe("execution-planner");
  });

  it("personaToSystemPrompt is stable across calls (pure function)", () => {
    const a = personaToSystemPrompt(RESEARCH_ANALYST);
    const b = personaToSystemPrompt(RESEARCH_ANALYST);
    expect(a).toBe(b);
  });

  it("personaToSystemPrompt includes all four persona fields", () => {
    const prompt = personaToSystemPrompt(CONTRARIAN_CRITIC);
    expect(prompt).toContain(CONTRARIAN_CRITIC.role);
    expect(prompt).toContain(CONTRARIAN_CRITIC.goal);
    expect(prompt).toContain(CONTRARIAN_CRITIC.backstory);
    expect(prompt).toContain(CONTRARIAN_CRITIC.outputHint);
  });
});
