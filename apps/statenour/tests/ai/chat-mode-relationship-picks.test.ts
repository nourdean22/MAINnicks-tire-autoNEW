/**
 * People W4 S2: getRelationshipPicks is reachable from plain language (the
 * W4 kill criterion counts real calls, so the tool must actually be offered).
 * Real phrasings, not text reverse-engineered from the regex. An unrelated
 * message must not pull it in (control).
 */
import { describe, expect, it } from "vitest";
import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}
async function offered(prompt: string): Promise<string[]> {
  const pruned = (await pruneTools("standard" as never, allTools(), prompt)) as Record<string, unknown>;
  return Object.keys(pruned ?? {});
}

describe("getRelationshipPicks reachability", () => {
  it.each([
    "who should I call today",
    "who should i reach out to this week",
    "anyone I need to check in on?",
    "who have I not talked to in a while",
    "who's gone quiet",
  ])("%s", async (prompt) => {
    expect(await offered(prompt)).toContain("getRelationshipPicks");
  });

  it("CONTROL: an unrelated message does not pull it in", async () => {
    expect(await offered("what's the weather tomorrow")).not.toContain("getRelationshipPicks");
  });
});
