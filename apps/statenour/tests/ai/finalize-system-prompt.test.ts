/**
 * AG-10 · finalizeSystemPrompt behavior-directive wiring.
 *
 * The ANTICIPATE→ANSWER→ELEVATE directive (Sparring Partner Mode at
 * NICK_CHAT_INTENSITY=HIGH) is authored in lib/ai/knowledge/
 * behavior-directive.ts. These tests pin the injection contract:
 *   · STANDARD intensity → the ANTICIPATE block appears
 *   · HIGH intensity → the Sparring Partner addendum appears
 *   · "/strict" user message → NO directive appears (strict escape)
 *   · casual turns → NO directive appears
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    strategicLaw: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { finalizeSystemPrompt } from "@/app/api/ai/chat/finalize-system-prompt";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { detectQueryShape } from "@/lib/ai/query-shape";
import { setIntensityOverride } from "@/lib/ai/knowledge/behavior-directive";
import { buildResponseContract } from "@/lib/ai/response-contract";
import type { ContextBlocksFired } from "@/lib/services/chat/brain-context";

const NO_BLOCKS = {
  recall: false,
  skills: false,
  identity: false,
  ghost: false,
  qualitative: false,
  beliefs: false,
  nudges: false,
  contradictions: false,
} as ContextBlocksFired;

const silentLog = { info: () => {} };

async function finalize(userContent: string, opts?: { withContract?: boolean }) {
  const turnSignal = classifyTurn(userContent);
  const queryShape = detectQueryShape(userContent);
  const result = await finalizeSystemPrompt({
    systemPrompt: "BASE PROMPT",
    provider: "ollama",
    personality: "master",
    userContent,
    turnSignal,
    contextBlocksFired: NO_BLOCKS,
    mode: "standard" as never,
    queryShape,
    contract: opts?.withContract
      ? buildResponseContract(userContent, turnSignal, queryShape.shape)
      : undefined,
    log: silentLog,
  });
  return result.systemPrompt;
}

describe("finalizeSystemPrompt · behavior directive (AG-10)", () => {
  const originalIntensity = process.env.NICK_CHAT_INTENSITY;

  beforeEach(() => {
    setIntensityOverride(null);
  });

  afterEach(() => {
    if (originalIntensity === undefined) delete process.env.NICK_CHAT_INTENSITY;
    else process.env.NICK_CHAT_INTENSITY = originalIntensity;
    setIntensityOverride(null);
  });

  it("injects ANTICIPATE→ANSWER→ELEVATE on analytical turns at STANDARD", async () => {
    process.env.NICK_CHAT_INTENSITY = "STANDARD";
    const prompt = await finalize(
      "analyze whether raising the alignment price would hurt our win rate",
    );
    expect(prompt).toContain("ANTICIPATE");
    expect(prompt).not.toContain("Sparring Partner Mode");
  });

  it("injects Sparring Partner Mode at HIGH", async () => {
    process.env.NICK_CHAT_INTENSITY = "HIGH";
    const prompt = await finalize(
      "analyze whether raising the alignment price would hurt our win rate",
    );
    expect(prompt).toContain("Sparring Partner Mode");
  });

  it("suppresses the directive on /strict messages", async () => {
    process.env.NICK_CHAT_INTENSITY = "HIGH";
    const prompt = await finalize("/strict what is our alignment win rate");
    expect(prompt).not.toContain("ANTICIPATE");
    expect(prompt).not.toContain("Sparring Partner Mode");
  });

  it("skips the directive on casual turns", async () => {
    process.env.NICK_CHAT_INTENSITY = "HIGH";
    const prompt = await finalize("hey");
    expect(prompt).not.toContain("Sparring Partner Mode");
    expect(prompt).not.toContain("# ANTICIPATE");
  });

  it("honors the /strict · /chill intensity override over env", async () => {
    process.env.NICK_CHAT_INTENSITY = "HIGH";
    setIntensityOverride("MINIMAL");
    const prompt = await finalize(
      "analyze whether raising the alignment price would hurt our win rate",
    );
    expect(prompt).not.toContain("ANTICIPATE");
  });
});

describe("finalizeSystemPrompt · response contract (AG-11)", () => {
  it("enforces exact rank counts and no-clarifying-questions", async () => {
    const prompt = await finalize(
      "give me the top 5 hooks for the tire post, don't ask questions",
      { withContract: true },
    );
    expect(prompt).toContain("Return exactly 5 ranked items.");
    expect(prompt).toContain("Do NOT ask clarifying questions");
  });

  it("keeps casual turns tight (concise directive, nothing heavier)", async () => {
    // "hey" is not unconstrained: the contract classifies it casual and
    // emits a small conciseness directive. Pin that — and pin that none
    // of the heavyweight obligations leak in.
    const prompt = await finalize("hey", { withContract: true });
    expect(prompt).toContain("Be concise");
    expect(prompt).not.toContain("ranked items");
    expect(prompt).not.toContain("Do NOT ask clarifying questions");
  });

  it("omitting the contract leaves the prompt byte-identical (default path unchanged)", async () => {
    const a = await finalize("hey");
    const b = await finalize("hey");
    expect(a).toBe(b);
    expect(a).not.toContain("## This turn");
  });
});
