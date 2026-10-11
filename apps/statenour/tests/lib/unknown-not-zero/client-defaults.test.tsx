/**
 * Unknown is not zero on the client (audit 2026-10-10, 02-F14, 09-F30).
 *
 * - @revenue told Nick "pipeline $0": NourState's pipeline source has been a hard-coded
 *   null since 2026-04-17 and `?? 0` turned it into a measured-looking zero.
 * - The chat store started `connection: "online"` before anything was observed.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

const state = vi.hoisted(() => ({
  s: {
    todayRevenue: 1200,
    weekRevenue: 5000,
    pipelineValue: null as number | null,
    agingCritical: 0,
    staleLeads: 0 as number | null,
    overdueCommitments: 0 as number | null,
    urgentItems: [],
    activeCommitments: 0,
    currentState: "Focus",
    habitsTotal: 0,
  },
}));
vi.mock("@/lib/state/nour-state", () => ({ useNourState: () => state.s }));
vi.mock("@/lib/trpc/client", () => ({ trpc: { useUtils: () => ({}) } }));

import { useMentionSuggestions } from "@/hooks/use-mention-suggestions";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

function Probe({ token = "@revenue" }: { token?: string }) {
  const { expandMentions } = useMentionSuggestions();
  return <div data-out={expandMentions(token)} />;
}

describe("@revenue mention", () => {
  it("an unmeasured pipeline is unknown, never $0", () => {
    state.s.pipelineValue = null;
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain("pipeline unknown");
    expect(html).not.toContain("pipeline $0");
  });

  it("CONTROL: a measured pipeline renders its value", () => {
    state.s.pipelineValue = 0;
    expect(renderToStaticMarkup(<Probe />)).toContain("pipeline $0");
  });
});

// 08-F6b: /api/command/data's brief never sends staleLeads / overdueCommitments, so the
// provider now carries null (tests/state/nour-state-brief-unknowns.test.tsx) and @critical
// must say so instead of "0 stale leads".
describe("@critical mention", () => {
  it("unknown counts (the real brief shape) say unknown, never 0", () => {
    state.s.staleLeads = null;
    state.s.overdueCommitments = null;
    const html = renderToStaticMarkup(<Probe token="@critical" />);
    expect(html).not.toContain("0 stale leads");
    expect(html).not.toContain("null");
    expect(html).toContain("unknown");
  });

  it("@commits with an unknown overdue count claims no overdue number", () => {
    state.s.overdueCommitments = null;
    const html = renderToStaticMarkup(<Probe token="@commits" />);
    expect(html).not.toContain("null");
  });

  it("CONTROL: measured counts render as numbers", () => {
    state.s.staleLeads = 2;
    state.s.overdueCommitments = 1;
    const html = renderToStaticMarkup(<Probe token="@critical" />);
    expect(html).toContain("2 stale leads");
    expect(html).toContain("1 overdue commitments");
    expect(html).not.toContain("unknown");
  });
});

describe("chat-ui-store", () => {
  it("connection starts unknown, not online", () => {
    expect(useChatUiStore.getState().connection).toBe("unknown");
  });
});
