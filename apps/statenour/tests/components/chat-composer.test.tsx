import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ChatComposer } from "@/features/chat-v2/components/chat-composer";

// 2026-07-11 · ChatComposer now calls useRouter() (slash-nav wiring), which
// needs the app-router context that SSR-render lacks — mock it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

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
    // The live composer calls trpc.brain.createPin.useMutation() at render.
    brain: {
      createPin: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) },
    },
    // 2026-08-19 · #1672 added edit-resend truncation, which calls
    // trpc.chat.deleteMessage.useMutation() at render — the mock lagged
    // the component and this file failed on main since that merge.
    chat: {
      deleteMessage: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) },
    },
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
    expect(markup).toContain('placeholder="Ask, analyze, create, or tell Nick to act…"');
  });

  // 2026-08-28 · Operator directive: no capability dials in the composer.
  // posture/depth were a thinking tax; turbo was provably DEAD (it armed
  // providerOverride:"anthropic" with no ANTHROPIC_API_KEY in any env, so
  // it silently degraded every time); private was removed by decision.
  // Read-aloud and Edit moved onto the messages themselves. This pins the
  // removal so a future refactor cannot quietly reintroduce a knob.
  it("renders no capability chips — the composer is input only", () => {
    const mockChat = { status: "idle", sendText: vi.fn(), append: vi.fn() } as any;
    const markup = renderToStaticMarkup(<ChatComposer chat={mockChat} />);

    expect(markup).not.toContain("authority-controls");
    expect(markup).not.toContain("private-lab-banner");
    expect(markup).not.toContain("control-sheet-");
    for (const chip of ["posture", "depth", "turbo", "private"]) {
      expect(markup.toLowerCase()).not.toContain(`>${chip}<`);
    }
  });

  it("keeps the controls that act on the draft itself", () => {
    const mockChat = { status: "idle", sendText: vi.fn(), append: vi.fn() } as any;
    const markup = renderToStaticMarkup(<ChatComposer chat={mockChat} />);

    expect(markup).toContain('aria-label="Attach image, audio or PDF"');
    expect(markup).toContain('aria-label="Voice input"');
    expect(markup).toContain('aria-label="Send message"');
  });
});
