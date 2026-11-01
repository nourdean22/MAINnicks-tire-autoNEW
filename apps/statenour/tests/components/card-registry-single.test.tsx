/**
 * W6 PR 1 (2026-11-01) · one typed-card registry. Chat had two: TOOL_CONFIG in
 * components/chat/tool-result-registry.tsx (labels, subtitles, rich bodies) and a RENDERERS map in
 * features/chat-v2/components/typed-tool-cards.tsx (getFleetTruth, getTopDecisions). They
 * disagreed on the same turn: the receipt line said "getFleetTruth: returned data" (no card known)
 * while a second card for the same call drew below the reply. One registry: every typed card is a
 * TOOL_CONFIG entry with a zod output schema, and an output that fails its schema draws no card.
 *
 * Harness from tool-result-registry-retired.test.tsx: the REAL ChatMessageList, tool-result-card
 * and registry are the consumer under test.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import type { UIMessage } from "ai";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/trpc/client", () => {
  const hookLeaf = {
    useMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
    useQuery: () => ({ data: undefined, isLoading: false }),
  };
  const procProxy = new Proxy({}, { get: () => hookLeaf });
  const routerProxy: Record<string | symbol, unknown> = new Proxy(
    {},
    { get: (_target, prop) => (prop === "useUtils" ? () => ({}) : procProxy) },
  );
  return { trpc: routerProxy };
});
vi.mock("@/hooks/chat/use-lazy-render-messages", () => ({
  useLazyRenderMessages: (messages: UIMessage[]) => ({
    renderedMessages: messages,
    hasHidden: false,
    hiddenCount: 0,
    showOlder: () => {},
  }),
}));
vi.mock("@/components/chat/nick-message", () => ({
  NickMessage: ({ text }: { text: string }) => <div>{text}</div>,
}));
vi.mock("@/components/chat/message-bubble-shells", () => ({
  UserMessageBubble: ({ text }: { text: string }) => <div>{text}</div>,
  AssistantMessageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/chat/message-action-sheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/chat/reasoning-trace-modal", () => ({ ReasoningTraceModal: () => null }));
vi.mock("@/components/chat/reasoning-trace-live", () => ({ ReasoningTraceLive: () => null }));

import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";
import { TOOL_CONFIG, isKnownToolName } from "@/components/chat/tool-result-registry";

const APP = join(__dirname, "..", "..");
// Installed before any render: the card warns once per tool per page load, so it must see the first miss.
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

function markupFor(toolName: string, output: unknown): string {
  const list = [
    { id: "m1", role: "user", parts: [{ type: "text", text: "run it" }] },
    {
      id: "m2",
      role: "assistant",
      parts: [{ type: `tool-${toolName}`, toolCallId: "c1", state: "output-available", input: {}, output }],
    },
  ] as unknown as UIMessage[];
  return renderToStaticMarkup(<ChatMessageList messages={list} isLoading={false} error={undefined} stopped={null} />).replace(
    /<!-- -->/g,
    "",
  );
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// The producers' real shapes: lib/observability/fleet-truth.ts FleetTruth and the getTopDecisions tool.
const FLEET = {
  ok: true,
  generatedAt: "2026-11-01T12:00:00.000Z",
  statenour: [{ capability: "outbox-drain", state: "fresh", ageH: 0.2 }],
  // fleet-truth.ts emits nickstire capabilities already prefixed ("nickstire:schema-guard").
  nickstire: [
    { capability: "nickstire:schema-guard", state: "stale", ageH: 30 },
    { capability: "db", state: "fresh", ageH: null },
  ],
  queues: { postTurnOutbox: null, brainBus: null, workItems: null },
  allFresh: false,
  queuesClean: false,
};
const DECISIONS = {
  ok: true,
  // apps/nickstire/server/services/opportunityQueue.ts mapRow: id is String(r.id), a uuid; valueDollars may be null.
  decisions: [
    { id: "6f1c2a9e-0b7d-4c55-9a3e-2d8f1b7c4e01", urgency: "this_week", state: "open", recommendedAction: "Call back about the brake quote", valueDollars: 420, dataQuality: "verified", attempts: 1 },
    { id: "a83d4b10-5e2f-4f8a-b1c9-7e6d5a4f3b02", urgency: "later", state: "open", recommendedAction: "Unpriced tire follow-up", valueDollars: null, dataQuality: "partial", attempts: 0 },
  ],
  totalLive: 7,
  excludedNoConsent: 1,
  excludedSnoozed: 0,
};

describe("one typed-card registry", () => {
  it("the second renderer map is gone", () => {
    expect(existsSync(join(APP, "features/chat-v2/components/typed-tool-cards.tsx"))).toBe(false);
  });

  it.each(["getFleetTruth", "getTopDecisions"])("%s is a registry entry with an output schema", (name) => {
    expect(isKnownToolName(name)).toBe(true);
    expect(TOOL_CONFIG[name]?.outputSchema).toBeDefined();
  });

  it("a fleet-truth turn draws ONE card and its receipt names it, never the no-card line", () => {
    const markup = markupFor("getFleetTruth", FLEET);
    expect(count(markup, 'data-testid="fleet-truth-card"')).toBe(1);
    expect(markup).not.toContain("getFleetTruth: returned data");
    expect(markup).toContain("Fleet checked, attention needed");
    expect(markup).toContain("nickstire:schema-guard");
    expect(markup).not.toContain("nickstire:nickstire:");
    expect(markup).toContain("nickstire:db");
  });

  it("a decision-inbox turn draws ONE card with the sentence-case urgency word", () => {
    const markup = markupFor("getTopDecisions", DECISIONS);
    expect(count(markup, 'data-testid="top-decisions-card"')).toBe(1);
    expect(markup).not.toContain("getTopDecisions: returned data");
    expect(markup).toContain("This week");
    expect(markup).toContain("$420");
    expect(markup).toContain("value unknown");
    expect(markup).toContain("Decision inbox read, top 2 of 7 live");
  });

  it("decision rows that are not a list draw no typed card and never throw", () => {
    const markup = markupFor("getTopDecisions", { ...DECISIONS, decisions: "x" });
    expect(markup).not.toContain('data-testid="top-decisions-card"');
    expect(markup).toContain("Decision inbox read");
    expect(markup).not.toContain("of 7 live");
  });

  it("a renamed producer key (statenour gone) draws no fleet card", () => {
    const { statenour: _gone, ...renamed } = FLEET;
    const markup = markupFor("getFleetTruth", { ...renamed, statenourArtifacts: FLEET.statenour });
    expect(markup).not.toContain('data-testid="fleet-truth-card"');
    expect(markup).toContain("Fleet checked");
  });

  it("an output that fails its schema draws no typed card but keeps the receipt row", () => {
    const drifted = { ...FLEET, statenour: [{ capability: "outbox-drain", state: "green", ageH: "soon" }] };
    const markup = markupFor("getFleetTruth", drifted);
    expect(markup).not.toContain('data-testid="fleet-truth-card"');
    expect(markup).toContain("Fleet checked");
  });

  it("a state this client does not know still draws every row, in its own words", () => {
    const markup = markupFor("getFleetTruth", { ...FLEET, statenour: [{ capability: "outbox-drain", state: "half_open_now", ageH: 1 }] });
    expect(count(markup, 'data-testid="fleet-truth-card"')).toBe(1);
    expect(markup).toContain("half open now");
    expect(markup).toContain("nickstire:schema-guard");
  });

  it("all capabilities fresh but a dead queue row reads as attention, never all fresh", () => {
    const markup = markupFor("getFleetTruth", {
      ...FLEET,
      nickstire: [{ capability: "nickstire:db", state: "fresh", ageH: null }],
      statenour: [{ capability: "outbox-drain", state: "fresh", ageH: 0 }],
      allFresh: true,
      queuesClean: false,
    });
    expect(markup).toContain("Fleet checked, dead queue rows");
    expect(markup).not.toContain("all fresh");
    const clean = markupFor("getFleetTruth", { ...FLEET, allFresh: true, queuesClean: true });
    expect(clean).toContain("Fleet checked, all fresh");
  });

  it("a schema miss warns once per tool, so drift is not silent (the misses above already ran)", () => {
    markupFor("getTopDecisions", { ...DECISIONS, decisions: [{ valueDollars: "lots" }] });
    markupFor("getFleetTruth", { ...FLEET, statenour: [{ capability: "x", state: "fresh", ageH: "soon" }] });
    const hits = (tool: string) => warn.mock.calls.filter((c) => String(c[0]) === `[tool-card] ${tool} output failed its schema; card hidden`);
    expect(hits("getTopDecisions")).toHaveLength(1);
    expect(hits("getFleetTruth")).toHaveLength(1);
    expect(hits("arsenal.browserNavigate")).toHaveLength(0);
  });

  it("a non-array where rows belong still renders the turn (the subtitle reads the raw output too)", () => {
    const markup = markupFor("getFleetTruth", { ...FLEET, statenour: "not rows", nickstire: 3 });
    expect(markup).not.toContain('data-testid="fleet-truth-card"');
    expect(markup).toContain("Fleet checked");
    expect(markup).not.toContain("attention needed");
  });

  it("a failed read keeps its failure words and draws no typed card", () => {
    // Rows ride along with the failure, so only the soft-fail rule keeps the card off.
    const markup = markupFor("getTopDecisions", { ...DECISIONS, ok: false, error: "nickstire bridge timed out after 8s" });
    expect(markup).not.toContain('data-testid="top-decisions-card"');
    expect(markup).toContain("Not done");
  });

  it("CONTROL · an entry with no schema still renders its rich body unchanged", () => {
    const markup = markupFor("arsenal.browserNavigate", { url: "https://example.com/page" });
    expect(markup).toContain("Navigated successfully");
  });
});
