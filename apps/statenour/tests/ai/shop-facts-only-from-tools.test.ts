/**
 * 2026-10-30 · Nick does not volunteer shop facts it has no tool result for.
 *
 * Prod, 19:43Z (counts and booleans only): Nour sent a 5-character greeting. The selector offered 9
 * tools, none of them shop tools (budget 24, not truncated), and Nick replied that it could not
 * confirm whether the shop is open Friday or how much it invoiced today. Nothing asked about the
 * shop. Manager ruling: a rule, red first, that shop numbers, hours and "I can't confirm" about the
 * shop appear only when a tool result in that turn carries them; a greeting gets the pulse as it is.
 *
 * The rule lives in the always-on HONESTY block of finalizeSystemPrompt (every turn, casual included),
 * next to the FACTS-vs-COACHING line that told Nick to say "can't confirm that". It is NOT in the
 * static prefix: that prefix is capped at 15.5 kB and had about 50 characters to spare.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({}),
  });
  return { prisma: new Proxy({}, { get: (_t, p: string) => (p === "$queryRaw" || p === "$queryRawUnsafe" ? () => Promise.resolve([]) : generic()) }) };
});
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return { ...actual, getFlag: (key: string) => ({ key, isOn: false }) };
});

import { finalizeSystemPrompt } from "@/app/api/ai/chat/finalize-system-prompt";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { detectQueryShape } from "@/lib/ai/query-shape";
import { buildResponseContract } from "@/lib/ai/response-contract";

async function promptFor(text: string): Promise<string> {
  const turnSignal = classifyTurn(text);
  const queryShape = detectQueryShape(text);
  const { systemPrompt } = await finalizeSystemPrompt({
    systemPrompt: "BASE PROMPT",
    provider: "ollama",
    personality: "master",
    userContent: text,
    turnSignal,
    contextBlocksFired: {},
    mode: "standard" as never,
    queryShape,
    contract: buildResponseContract(text, turnSignal, queryShape.shape),
    log: { info: () => {} },
  } as never);
  return systemPrompt;
}

const RULE = /SHOP FACTS[^\n]*only from a tool result in this turn[^\n]*do not volunteer that you can't confirm them[^\n]*greeting/i;

describe("shop facts come only from a tool result in the turn", () => {
  it("a 5-character greeting turn carries the rule", async () => {
    const greeting = "hey n"; // the prod message was 5 characters; its text is not stored here
    expect(greeting).toHaveLength(5);
    expect(await promptFor(greeting)).toMatch(RULE);
  });

  it("a shop question carries it too (the rule is always on, not greeting-only)", async () => {
    expect(await promptFor("how much did we invoice today")).toMatch(RULE);
  });

  it("CONTROL: the FACTS-vs-COACHING lane is still there (the rule was added, nothing swapped)", async () => {
    expect(await promptFor("hey n")).toMatch(/FACTS vs COACHING/);
  });
});
