import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useMentionSuggestions } from "@/hooks/use-mention-suggestions";

vi.mock("@/lib/state/nour-state", () => ({
  useNourState: () => ({
    todayRevenue: 0,
    weekRevenue: 0,
    pipelineValue: 0,
    agingCritical: 0,
    staleLeads: 0,
    overdueCommitments: 0,
    urgentItems: [],
    activeCommitments: 0,
    currentState: "Focus",
    habitsTotal: 0,
  }),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({}),
  },
}));

function Probe() {
  const { show, filter } = useMentionSuggestions();
  return (
    <div
      data-show={String(show)}
      data-filter={filter}
    />
  );
}

describe("useMentionSuggestions Hook", () => {
  it("defaults to show=false and filter='' on mount", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-show="false"');
    expect(markup).toContain('data-filter=""');
  });
});
