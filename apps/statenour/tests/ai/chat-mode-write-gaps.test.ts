/**
 * tests/ai/chat-mode-write-gaps.test.ts · 2026-11-03
 *
 * The five chat write gaps closed this day (dated habit check-off on
 * completeTask, uncheckTask, archiveTask, logJournalEntry, logBodyEntry) are
 * only useful if Nick LOADS them on Nour's own wording. pruneTools keys tool
 * families on the user text; a tool that exists but is never attached is the
 * 2026-09-17 sendTelegram shape (built, shipped, never offered once).
 *
 * Runs the real pruneTools over the real catalog names.
 */

import { describe, expect, it } from "vitest";
import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}
const offered = async (prompt: string) =>
  new Set(Object.keys((await pruneTools("standard" as never, allTools(), prompt)) ?? {}));

describe("chat write gaps · reachable from his words", () => {
  it.each([
    ["I journaled on Oct 30 and Nov 2, I just didn't click it", "completeTask"],
    ["backfill my journal habit for yesterday", "completeTask"],
    ["I missed clicking the workout habit on friday", "completeTask"],
    ["uncheck my journal for yesterday, I tapped it by mistake", "uncheckTask"],
    ["untick today's workout", "uncheckTask"],
    ["undo that habit check off", "uncheckTask"],
    ["drop that task about the lift quote", "archiveTask"],
    ["archive the meineke task", "archiveTask"],
    ["delete the task about the battery contract", "archiveTask"],
    ["journal entry: long day, manny covered the counter while I did the honda", "logJournalEntry"],
    ["log this in my journal: I keep putting off the lease call", "logJournalEntry"],
    ["I wrote in my journal this morning about the lease", "logJournalEntry"],
    ["log my weight 212.4", "logBodyEntry"],
    ["weighed in at 210 this morning, slept 6 hours", "logBodyEntry"],
    ["body log: workout done, energy 4, stress 2", "logBodyEntry"],
  ])("%s -> %s", async (prompt, tool) => {
    expect(await offered(prompt)).toContain(tool);
  });

  it("CONTROL: a shop question reaches none of the new personal writers", async () => {
    // No "today"/"log" on purpose: those words open the habit family (getBodyData and
    // logBodyEntry ride together there), which is the pre-existing family behaviour.
    const got = await offered("how many cars did we do this week and what was the revenue on the honda");
    for (const w of ["uncheckTask", "archiveTask", "logJournalEntry", "logBodyEntry"]) {
      expect(got.has(w), `${w} offered for a shop question`).toBe(false);
    }
  });
});

// The second reader's probe (2026-11-03): each of these reached a personal WRITER at
// the explicit-mention tier with the first regex set. They must pin nothing now.
describe("chat write gaps · shop and customer wording pins no personal writer", () => {
  const WRITERS = ["uncheckTask", "archiveTask", "logJournalEntry", "logBodyEntry"];
  it.each([
    "how many cars did we do yesterday",
    "we finished the honda on monday",
    "manny forgot to log the invoice for the f150",
    "the customer didn't check the oil",
    "remove the line item for the alignment from the honda invoice",
    "drop the price on that item to 120",
    "note the weight rating on those 265/70r17 tires",
    "the customer weighed in on the quote",
    "track energy costs at the shop",
    "mash checked the wrong one",
    "i wrote the invoice entry wrong",
  ])("%s", async (prompt) => {
    // Pinned = present at the explicit tier. A family may still OFFER a tool on these
    // words (that is tier 4, budget-cut, pre-existing); what must not happen is the
    // explicit-intent pin, so run with a budget of 10 where only pinned tools survive.
    const prev = process.env.NICK_TOOL_BUDGET;
    process.env.NICK_TOOL_BUDGET = "10";
    try {
      const got = await offered(prompt);
      for (const w of WRITERS) expect(got.has(w), `${w} pinned for: ${prompt}`).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.NICK_TOOL_BUDGET;
      else process.env.NICK_TOOL_BUDGET = prev;
    }
  });

  it("POSITIVE CONTROL: with the same budget of 10, his own wording still pins the writer", async () => {
    const prev = process.env.NICK_TOOL_BUDGET;
    process.env.NICK_TOOL_BUDGET = "10";
    try {
      expect(await offered("uncheck my journal for yesterday, I tapped it by mistake")).toContain("uncheckTask");
      expect(await offered("drop that task about the lift quote")).toContain("archiveTask");
      expect(await offered("log this in my journal: I keep putting off the lease call")).toContain("logJournalEntry");
      expect(await offered("log my weight 212.4")).toContain("logBodyEntry");
    } finally {
      if (prev === undefined) delete process.env.NICK_TOOL_BUDGET;
      else process.env.NICK_TOOL_BUDGET = prev;
    }
  });
});

// 2026-11-03 (second PR) · the relationship ledger's in-turn writer. Pinned only by the ledger
// grammar itself: a verb, a signed amount, then for/to/with and a name (never an article).
describe("logPersonInteraction · reachable from the ledger grammar, never from shop wording", () => {
  const withBudget = async <T,>(fn: () => Promise<T>) => {
    const prev = process.env.NICK_TOOL_BUDGET;
    process.env.NICK_TOOL_BUDGET = "10";
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.NICK_TOOL_BUDGET;
      else process.env.NICK_TOOL_BUDGET = prev;
    }
  };

  it.each([
    "log +20 for Mash, covered the counter",
    "log -5 for manny, late again",
    "record +10 with Dania, coffee and talked about the move",
    "add +3 for zach, helped with the lift",
    "+5 for mash, opened early",
  ])("%s pins logPersonInteraction", async (prompt) => {
    expect(await withBudget(() => offered(prompt))).toContain("logPersonInteraction");
  });

  it.each([
    "log +2 tasks for the week",
    "recorded +5 lb on bench",
    "log +20 for the honda",
    "add +10 to the invoice total",
    "manny forgot to log the invoice for the f150",
    "how many cars did we do this week",
    "log the deposit for the f150 customer",
  ])("CONTROL: %s pins no ledger writer", async (prompt) => {
    expect(await withBudget(() => offered(prompt))).not.toContain("logPersonInteraction");
  });
});

