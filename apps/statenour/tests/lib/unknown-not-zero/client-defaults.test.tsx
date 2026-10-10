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
    staleLeads: 0,
    overdueCommitments: 0,
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

function Probe() {
  const { expandMentions } = useMentionSuggestions();
  return <div data-out={expandMentions("@revenue")} />;
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

describe("chat-ui-store", () => {
  it("connection starts unknown, not online", () => {
    expect(useChatUiStore.getState().connection).toBe("unknown");
  });
});
