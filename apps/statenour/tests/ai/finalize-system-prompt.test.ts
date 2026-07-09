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

async function finalize(userContent: string) {
  const result = await finalizeSystemPrompt({
    systemPrompt: "BASE PROMPT",
    provider: "ollama",
    personality: "master",
    userContent,
    turnSignal: classifyTurn(userContent),
    contextBlocksFired: NO_BLOCKS,
    mode: "standard" as never,
    queryShape: detectQueryShape(userContent),
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
