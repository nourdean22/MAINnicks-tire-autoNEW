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
import { classifyStepIntent } from "@/lib/ai/reasoning/engine";
import { LENS_PERSONA_KEY } from "@/lib/ai/pretask-fanout";
import {
  RESEARCH_ANALYST,
  CONTRARIAN_CRITIC,
  EXECUTION_PLANNER,
  RESEARCH_PLANNER,
  RESEARCH_SYNTHESIZER,
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

describe("classifyStepIntent · Phase S.1 per-step persona routing", () => {
  it("action verbs route to execution-planner", () => {
    expect(classifyStepIntent("1. create a Notion page for the campaign")).toBe("execution-planner");
    expect(classifyStepIntent("2) ship the v2 wave to production")).toBe("execution-planner");
    expect(classifyStepIntent("3. deploy the migration script")).toBe("execution-planner");
    expect(classifyStepIntent("4) schedule the follow-up email"))
      .toBe("execution-planner");
    expect(classifyStepIntent("draft the proposal")).toBe("execution-planner");
    expect(classifyStepIntent("Update the dashboard copy")).toBe("execution-planner");
    expect(classifyStepIntent("Refactor the auth flow")).toBe("execution-planner");
    expect(classifyStepIntent("commit + push the change")).toBe("execution-planner");
  });

  it("research/question phrasing routes to research-analyst", () => {
    expect(classifyStepIntent("1. find the top 3 competitors")).toBe("research-analyst");
    expect(classifyStepIntent("2) what is the average cost per acquisition"))
      .toBe("research-analyst");
    expect(classifyStepIntent("3. analyze the conversion funnel")).toBe("research-analyst");
    expect(classifyStepIntent("identify the biggest churn driver")).toBe("research-analyst");
    expect(classifyStepIntent("compare option A vs option B")).toBe("research-analyst");
    expect(classifyStepIntent("benchmark against Q3 numbers")).toBe("research-analyst");
  });

  it("conjugations of action verbs still route correctly", () => {
    expect(classifyStepIntent("building the new dashboard")).toBe("execution-planner");
    expect(classifyStepIntent("shipped the auth flow yesterday")).toBe("execution-planner");
    expect(classifyStepIntent("creating a brand voice doc")).toBe("execution-planner");
  });

  it("empty/whitespace lines default to research-analyst (safe default)", () => {
    expect(classifyStepIntent("")).toBe("research-analyst");
    expect(classifyStepIntent("   ")).toBe("research-analyst");
    expect(classifyStepIntent("1.")).toBe("research-analyst");
  });

  it("handles both `1.` and `1)` plan-line prefixes", () => {
    expect(classifyStepIntent("1. ship it")).toBe("execution-planner");
    expect(classifyStepIntent("1) ship it")).toBe("execution-planner");
    expect(classifyStepIntent("1.ship it")).toBe("execution-planner");
  });

  it("ambiguous non-action words default to research-analyst", () => {
    expect(classifyStepIntent("1. operator reviews the brief")).toBe("research-analyst");
    expect(classifyStepIntent("2) team decides on direction")).toBe("research-analyst");
  });
});

describe("specialist personas · Phase T deep-research wiring", () => {
  it("RESEARCH_PLANNER is registered under the expected key", () => {
    // deep-research.ts uses personaToSystemPrompt(RESEARCH_PLANNER)
    // at module load. If this key ever drifts the planner's prompt
    // silently disappears · this test pins the contract.
    expect(getPersona("research-planner")).not.toBeNull();
    expect(RESEARCH_PLANNER.key).toBe("research-planner");
  });

  it("RESEARCH_SYNTHESIZER is registered under the expected key", () => {
    expect(getPersona("research-synthesizer")).not.toBeNull();
    expect(RESEARCH_SYNTHESIZER.key).toBe("research-synthesizer");
  });

  it("RESEARCH_PLANNER's prompt preserves JSON output shape requirement", () => {
    // The deep-research _planSubQueries function depends on the LLM
    // returning a JSON shape with `subQueries[]`. The persona prompt
    // MUST carry this requirement forward or the parser silently
    // falls back to a 1-query plan.
    const prompt = personaToSystemPrompt(RESEARCH_PLANNER);
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("subQueries");
  });

  it("RESEARCH_SYNTHESIZER's prompt preserves Cleveland OH tire-shop framing + [N] citation pattern", () => {
    // These domain anchors are why we kept specialist personas instead
    // of migrating to the generic SYNTHESIZER · regression would lose
    // the operator-relevant context the deep-research worker needs.
    const prompt = personaToSystemPrompt(RESEARCH_SYNTHESIZER);
    expect(prompt).toContain("Cleveland");
    expect(prompt).toContain("[N]");
  });

  it("resolveSubAgentSystemPrompt resolves the specialists too", () => {
    // The orchestrator's persona lookup is the same getPersona() path
    // deep-research uses · verify both new specialists round-trip.
    const planner = resolveSubAgentSystemPrompt("research-planner");
    const synth = resolveSubAgentSystemPrompt("research-synthesizer");
    const generic = resolveSubAgentSystemPrompt();
    expect(planner).not.toBe(generic);
    expect(synth).not.toBe(generic);
    expect(planner).not.toBe(synth);
  });
});

describe("pretask-fanout lens personas · Phase U.1 wiring", () => {
  it("research lens maps to research-analyst", () => {
    // pretask-fanout.ts hard-codes this mapping in LENS_PERSONA_KEY ·
    // if research-analyst's key ever drifts this test catches it.
    expect(LENS_PERSONA_KEY.research).toBe("research-analyst");
    expect(getPersona(LENS_PERSONA_KEY.research)).not.toBeNull();
  });

  it("risk lens maps to contrarian-critic", () => {
    expect(LENS_PERSONA_KEY.risk).toBe("contrarian-critic");
    expect(getPersona(LENS_PERSONA_KEY.risk)).not.toBeNull();
  });

  it("plan lens maps to execution-planner", () => {
    expect(LENS_PERSONA_KEY.plan).toBe("execution-planner");
    expect(getPersona(LENS_PERSONA_KEY.plan)).not.toBeNull();
  });

  it("all 3 lens personas resolve to distinct system prompts", () => {
    // The fanout fires the 3 lenses in parallel so their prompts must
    // be distinguishable · same-prompt collisions would collapse the
    // 3-angle analysis into 3 copies of the same answer.
    const research = personaToSystemPrompt(RESEARCH_ANALYST);
    const risk = personaToSystemPrompt(CONTRARIAN_CRITIC);
    const plan = personaToSystemPrompt(EXECUTION_PLANNER);
    expect(research).not.toBe(risk);
    expect(risk).not.toBe(plan);
    expect(research).not.toBe(plan);
  });

  it("PERSONAS registry includes all core wired personas (7 total)", () => {
    // Sanity · the wired core set:
    //   · research-analyst · contrarian-critic · execution-planner
    //   · synthesizer · fact-checker
    //   · research-planner · research-synthesizer (T specialists)
    // (buffett/naval/munger removed 2026-07-09 — zero production callers;
    // the advisor board covers those figures via @statenour/lenses.)
    // Marketing personas spread in on top. Adding more is fine · this
    // asserts the floor.
    expect(Object.keys(PERSONAS).length).toBeGreaterThanOrEqual(7);
  });
});
