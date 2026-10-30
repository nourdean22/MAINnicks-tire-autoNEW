/**
 * W3 (2026-10-30) · Nick can reach this week's features from plain language.
 *
 * These 30 everyday phrasings run through the real selector (pruneTools, standard mode, keyword tier,
 * no embeddings): on main a22256c50c 18 of 30 reached a tool that could answer, 3 of the 5 shop
 * phrasings missed (the business trigger matched singular words only: "invoice", not "invoices").
 * After the W3 trigger words: 29 of 30. (A wider 11/30 census earlier the same day used a different
 * phrasing set and was not kept.)
 *
 * NOT what this fixes: the 2026-10-30 19:43Z "I can't confirm ... how much it invoiced today" reply
 * answered a 5-character greeting; tests/ai/shop-facts-only-from-tools.test.ts covers that.
 *
 * Each row is a phrasing Nour would type and the tools that can answer it. The selector must offer
 * at least one. The floor is 29 of 30, and every shop phrasing must reach queryNickstire.
 */
import { describe, it, expect } from "vitest";
import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}
async function offeredFor(prompt: string): Promise<Set<string>> {
  return new Set(Object.keys((await pruneTools("standard" as never, allTools(), prompt)) ?? {}));
}

// A counter invoice is a closed job (a sale): invoice, job and sales questions need queryNickstire.
// An estimate with no matching invoice is a likely walk: getEstimateLeaks answers those too.
const SHOP = ["queryNickstire"];
const WALKED = ["queryNickstire", "getEstimateLeaks"];
const CENSUS: Array<{ feature: string; prompt: string; tools: string[] }> = [
  { feature: "shop", prompt: "how much did we invoice today", tools: SHOP },
  { feature: "shop", prompt: "how many jobs did the shop close this week", tools: SHOP },
  { feature: "shop", prompt: "any estimates that walked yesterday", tools: WALKED },
  { feature: "shop", prompt: "what were sales at nick's today", tools: SHOP },
  { feature: "shop", prompt: "show me the invoices from monday", tools: SHOP },
  { feature: "tasks", prompt: "what's on my plate today", tools: ["getTasks"] },
  { feature: "tasks", prompt: "show my tasks", tools: ["getTasks"] },
  { feature: "tasks", prompt: "what are my todos", tools: ["getTasks"] },
  { feature: "tasks", prompt: "what did i write in the notes on the brake task", tools: ["getTaskDetails"] },
  { feature: "tasks", prompt: "list the subtasks under the website task", tools: ["getTaskDetails"] },
  { feature: "goals", prompt: "how are my goals going", tools: ["analyzeGoals"] },
  { feature: "goals", prompt: "am i behind on any goal", tools: ["analyzeGoals"] },
  { feature: "goals", prompt: "am i on pace for my goals this month", tools: ["analyzeGoals"] },
  { feature: "goals", prompt: "which goal is slipping", tools: ["analyzeGoals"] },
  { feature: "goals", prompt: "check my goal progress", tools: ["analyzeGoals"] },
  { feature: "wisdom", prompt: "what would greene say about this", tools: ["searchGreeneLaws", "getContextualGreeneLaws"] },
  { feature: "wisdom", prompt: "give me a law of power for this situation", tools: ["searchGreeneLaws", "getContextualGreeneLaws"] },
  { feature: "wisdom", prompt: "any wisdom on handling a difficult employee", tools: ["searchGreeneLaws", "getContextualGreeneLaws"] },
  { feature: "wisdom", prompt: "what's a good maxim for patience", tools: ["searchGreeneLaws", "getContextualGreeneLaws"] },
  { feature: "wisdom", prompt: "give me a quote from gracian on reputation", tools: ["searchGreeneLaws", "getContextualGreeneLaws"] },
  { feature: "calendar", prompt: "what's on my calendar today", tools: ["getTodaySchedule"] },
  { feature: "calendar", prompt: "do i have any meetings tomorrow", tools: ["getTodaySchedule"] },
  { feature: "calendar", prompt: "am i free at 3", tools: ["getTodaySchedule"] },
  { feature: "calendar", prompt: "plan my day", tools: ["getTodaySchedule"] },
  { feature: "calendar", prompt: "when is my next appt", tools: ["getTodaySchedule"] },
  { feature: "brain", prompt: "what do you remember about my sister", tools: ["searchMemories"] },
  { feature: "brain", prompt: "what did i say last week about hiring", tools: ["searchMemories"] },
  { feature: "brain", prompt: "recall the plan for the tire sale", tools: ["searchMemories"] },
  { feature: "brain", prompt: "what do you know about manny", tools: ["searchMemories"] },
  { feature: "brain", prompt: "remind me what we decided about prices", tools: ["searchMemories"] },
];

describe("chat reach census (W3)", () => {
  it("POSITIVE CONTROL: every census tool exists in the catalog and the selector returns a bounded set", async () => {
    const names = new Set(Object.keys(allTools()));
    for (const row of CENSUS) for (const t of row.tools) expect(names.has(t), `${t} is not in TOOL_CATALOG`).toBe(true);
    const offered = await offeredFor("what are my tasks today");
    expect(offered.size).toBeGreaterThan(0);
    expect(offered.size).toBeLessThan(names.size);
  });

  it("at least 24 of 30 everyday phrasings reach a tool that can answer, and every shop phrasing does", async () => {
    const misses: string[] = [];
    for (const row of CENSUS) {
      const offered = await offeredFor(row.prompt);
      if (!row.tools.some((t) => offered.has(t))) misses.push(`${row.feature}: "${row.prompt}"`);
    }
    // 2026-10-30: 18/30 on main before the W3 trigger words, 29/30 after. Ratchet: raise, never lower.
    expect(CENSUS.length - misses.length, `misses:\n${misses.join("\n")}`).toBeGreaterThanOrEqual(29);
    expect(misses.filter((m) => m.startsWith("shop:")), "shop questions must reach the shop tools").toEqual([]);
  });
});
