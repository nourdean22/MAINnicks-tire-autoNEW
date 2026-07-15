/**
 * Conversation-aware pruning pins (2026-07-15).
 *
 * The pruner keyed ONLY on the current message, so short follow-ups
 * ("try again", "?") dropped the tool families the conversation needed
 * — tool telemetry showed "Model tried to call unavailable tool
 * 'arsenalWebSearch' · Available tools: <core-only list>" on exactly
 * such turns, and the model told the operator "web search still
 * unavailable". pruneTools now accepts a conversationTail of recent
 * user messages and matches families against message + tail.
 *
 * Also pins the route's explicit web-search intent regex (mirrored,
 * same convention as chat-mode-keyword-families.test.ts).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/ai/tool-telemetry", () => ({
  isToolBlocked: () => false,
}));

import { pruneTools } from "@/lib/ai/chat-mode";

const t = () => ({ description: "stub", parameters: {} });
const TOOLS: Record<string, unknown> = {
  arsenalWebSearch: t(),
  searchWebVerified: t(),
  arsenalDeepResearch: t(),
  classifyThought: t(),
  searchMemories: t(),
  createTask: t(),
  completeTask: t(),
};

describe("pruneTools · conversation tail", () => {
  it("a bare follow-up drops the web family (baseline behavior)", async () => {
    const pruned = await pruneTools("standard", TOOLS, "try again", undefined);
    expect(Object.keys(pruned)).not.toContain("arsenalWebSearch");
  });

  it("the same follow-up KEEPS the web family when the tail carries the original ask", async () => {
    const pruned = await pruneTools("standard", TOOLS, "try again", undefined, {
      conversationTail:
        "search the web for the hottest pro tips and hacks for daytime approaches",
    });
    expect(Object.keys(pruned)).toContain("arsenalWebSearch");
    expect(Object.keys(pruned)).toContain("searchWebVerified");
  });

  it("a direct current-message match still works without any tail", async () => {
    const pruned = await pruneTools(
      "standard",
      TOOLS,
      "search the web for tire prices",
      undefined,
    );
    expect(Object.keys(pruned)).toContain("arsenalWebSearch");
  });
});

// MIRRORS the __webSearchIntent regex in app/api/ai/chat/route.ts ·
// keep in sync (same convention as the family mirrors).
const WEB_INTENT =
  /\b(search (the )?(web|internet|net|online)|google (it|for|me|this|that)|web ?search|look (it |this |that |them )?up online|(find|pull|get) (me )?(the )?(latest|current|live|breaking|newest|hottest) .{0,40}\b(online|on the web|from the web|news|trends?)\b)\b/i;

describe("explicit web-search intent (route mirror)", () => {
  it.each([
    "alright now ur a master seducer with an iq of 220. search the web for the hottest pro tips",
    "google it for me",
    "run a web search on tire prices",
    "pull the latest ev tax credit news",
  ])("fires on: %s", (q) => expect(WEB_INTENT.test(q)).toBe(true));

  it.each(["what time is it", "try again", "create a task for tomorrow", "summarize my week"])(
    "stays quiet on: %s",
    (q) => expect(WEB_INTENT.test(q)).toBe(false),
  );
});
