import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ChatComposer } from "@/features/chat-v2/components/chat-composer";

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

vi.mock("@/hooks/use-draft-autosave", () => ({
  useDraftAutosave: () => ({
    clearDraft: () => {},
    restore: () => null,
  }),
}));

describe("ChatComposer Component", () => {
  it("renders the compose textarea", () => {
    const mockChat = {
      status: "idle",
      sendText: vi.fn(),
      append: vi.fn(),
    } as any;

    const markup = renderToStaticMarkup(<ChatComposer chat={mockChat} />);
    expect(markup).toContain('placeholder="Send a message to Statenour OS..."');
  });
});
