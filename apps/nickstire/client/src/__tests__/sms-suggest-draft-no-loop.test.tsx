/**
 * NICKSTIRE-2 (Sentry): 157 of 183 "You do not have required permission
 * (10002)" events were ONE batched POST of
 * `smsConversations.suggestDraft,suggestDraft,suggestDraft,...`.
 *
 * Cause: ThreadView's auto-suggest effect depended on `handleSuggestDraft`,
 * whose useCallback deps held the WHOLE `useMutation()` result. TanStack
 * returns a new result object on every mutation state change, so
 * idle -> pending -> settled re-created the callback, re-fired the effect and
 * called `mutate` again — forever, while the newest message was inbound. With a
 * stale admin session every iteration was a 10002; with a live one, every
 * iteration was a billed LLM draft.
 *
 * The mock reproduces the one property that matters: `useMutation` returns a
 * fresh object per render with a STABLE `mutate` (exactly TanStack v5's
 * contract). The fix must therefore produce exactly one draft request per
 * inbound message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => {
  const state = { calls: 0, cap: 25 };
  // Stable identity, like TanStack's useCallback-wrapped mutate.
  const mutate = (_input: unknown, opts?: { onError?: (e: Error) => void }) => {
    state.calls += 1;
    // Cap so the pre-fix loop terminates instead of hanging the test.
    if (state.calls > state.cap) return;
    queueMicrotask(() => opts?.onError?.(new Error("You do not have required permission (10002)")));
  };
  return { state, mutate };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

vi.mock("@/lib/trpc", () => {
  const noopMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  const messages = [
    { id: 1, conversationId: 7, direction: "inbound", body: "Do you have 225/65R17?", twilioSid: null, status: "received", createdAt: "2026-10-02T12:00:00Z" },
  ];
  return {
    trpc: {
      useUtils: () => ({
        smsConversations: {
          list: { invalidate: vi.fn() },
          unreadCount: { invalidate: vi.fn() },
          messages: { invalidate: vi.fn() },
        },
      }),
      smsConversations: {
        messages: { useQuery: () => ({ data: messages, isLoading: false }) },
        // A NEW object every render — the real-world property that drove the loop.
        suggestDraft: { useMutation: () => ({ mutate: h.mutate, isPending: false }) },
        saveFeedback: { useMutation: noopMutation },
        markRead: { useMutation: noopMutation },
        send: { useMutation: noopMutation },
      },
    },
  };
});

import { ThreadView } from "../pages/admin/outreach/SmsSection";

const conversation = {
  id: 7,
  customerPhone: "2165550100",
  customerName: null,
  lastMessage: "Do you have 225/65R17?",
  lastMessageAt: "2026-10-02T12:00:00Z",
  unreadCount: 0,
};

beforeEach(() => {
  h.state.calls = 0;
});

describe("ThreadView auto-suggest fires once per inbound message (NICKSTIRE-2)", () => {
  it("positive control: an inbound last message does request a draft", async () => {
    render(<ThreadView conversation={conversation} onBack={() => {}} />);
    await waitFor(() => expect(h.state.calls).toBeGreaterThanOrEqual(1));
  });

  it("does not re-fire suggestDraft when the mutation object changes identity", async () => {
    render(<ThreadView conversation={conversation} onBack={() => {}} />);
    await waitFor(() => expect(h.state.calls).toBeGreaterThanOrEqual(1));
    // Let any loop run: several settle/re-render cycles.
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(h.state.calls).toBe(1);
  });
});
