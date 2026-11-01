/**
 * PR #3090 review 4299648934: a tool card with a live Undo (undoToken + undoExpiresAt, 30 s) sits
 * behind the receipt disclosure since W3b. The disclosure stays open until that undo expires, so the
 * Undo chip is never hidden while it can still be used; then it may fold. No undo: it folds at settle.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  const routerProxy: Record<string | symbol, unknown> = new Proxy({}, { get: (_target, prop) => (prop === "useUtils" ? () => ({}) : procProxy) });
  return { trpc: routerProxy };
});
vi.mock("@/hooks/chat/use-lazy-render-messages", () => ({
  useLazyRenderMessages: (messages: unknown[]) => ({ renderedMessages: messages, hasHidden: false, hiddenCount: 0, showOlder: () => {} }),
}));
vi.mock("@/components/chat/nick-message", () => ({ NickMessage: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock("@/components/chat/tool-result-card", () => ({ ToolResultCard: () => <div data-card>Undo</div>, isKnownToolName: () => true }));
vi.mock("@/components/chat/message-action-sheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/chat/reasoning-trace-modal", () => ({ ReasoningTraceModal: () => null }));
vi.mock("@/components/chat/reasoning-trace-live", () => ({ ReasoningTraceLive: () => null }));

import type { UIMessage } from "ai";
import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";

const NOW = new Date("2026-10-16T22:00:00Z").getTime();
const turn = (output: Record<string, unknown>) =>
  [
    { id: "u1", role: "user", parts: [{ type: "text", text: "close the demo task" }] },
    { id: "a1", role: "assistant", parts: [{ type: "tool-completeTask", toolCallId: "c1", state: "output-available", output }, { type: "text", text: "Done." }] },
  ] as unknown as UIMessage[];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
const details = () => container.querySelector("details") as HTMLDetailsElement;

describe("the receipt disclosure and a live Undo", () => {
  it("is open at settle while the undo is live, and folds after it expires", () => {
    const messages = turn({ success: true, undoToken: "u-1", undoExpiresAt: new Date(NOW + 30_000).toISOString() });
    act(() => root.render(<ChatMessageList messages={messages} isLoading={false} error={undefined} />));
    expect(details(), "no disclosure rendered").not.toBeNull();
    expect(details().open, "the Undo chip must be visible while the undo is live").toBe(true);
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(details().open, "still live at 29 s").toBe(true);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(details().open, "folds once the undo expired").toBe(false);
  });

  it("an undo that lands while the reply streams still holds it open after the settle", () => {
    const running = turn({});
    (running[1].parts[0] as { state: string }).state = "input-available";
    act(() => root.render(<ChatMessageList messages={running} isLoading error={undefined} />));
    const settled = turn({ success: true, undoToken: "u-1", undoExpiresAt: new Date(NOW + 30_000).toISOString() });
    act(() => root.render(<ChatMessageList messages={settled} isLoading={false} error={undefined} />));
    expect(details().open).toBe(true);
    act(() => { vi.advanceTimersByTime(31_000); });
    expect(details().open).toBe(false);
  });

  it("CONTROL: no undo token, it folds at settle as before", () => {
    act(() => root.render(<ChatMessageList messages={turn({ success: true })} isLoading={false} error={undefined} />));
    expect(details().open).toBe(false);
  });

  it("CONTROL: an undo that already expired does not hold it open", () => {
    const messages = turn({ success: true, undoToken: "u-1", undoExpiresAt: new Date(NOW - 1_000).toISOString() });
    act(() => root.render(<ChatMessageList messages={messages} isLoading={false} error={undefined} />));
    expect(details().open).toBe(false);
  });
});
