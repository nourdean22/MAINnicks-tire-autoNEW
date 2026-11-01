// @vitest-environment jsdom
/**
 * Chat bubble gestures (operator report 2026-10-29: "can't copy text +
 * tap-to-edit not working", iPhone home-screen PWA).
 *
 * Copy: both bubbles ran a 450 ms long-press timer that opened the action
 * sheet and then cancelled the context menu. iOS starts text selection on
 * the same hold (about 500 ms), so the sheet always won and text could
 * never be selected. Long-press now belongs to iOS; the sheet is the
 * visible More button.
 *
 * Edit: a tap on the operator's own text arms edit-resend AND focuses the
 * composer inside the same tap, the only moment iOS lets a page raise the
 * keyboard. A tap that ends a text selection is a copy, not an edit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessage } from "ai";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => <a href={String(href)}>{children}</a>,
}));
vi.mock("@/lib/trpc/client", () => {
  const hookLeaf = {
    useMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
    useQuery: () => ({ data: undefined, isLoading: false }),
  };
  const procProxy = new Proxy({}, { get: () => hookLeaf });
  return { trpc: new Proxy({}, { get: (_t, prop) => (prop === "useUtils" ? () => ({}) : procProxy) }) };
});
vi.mock("@/hooks/chat/use-lazy-render-messages", () => ({
  useLazyRenderMessages: (messages: UIMessage[]) => ({ renderedMessages: messages, hasHidden: false, hiddenCount: 0, showOlder: () => {} }),
}));
vi.mock("@/components/chat/nick-message", () => ({ NickMessage: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock("@/components/chat/tool-result-card", () => ({ ToolResultCard: () => null, isKnownToolName: () => false }));
const sheet = vi.hoisted(() => ({ props: {} as { onEdit?: () => void; finalFocus?: (closeType: string) => unknown } }));
vi.mock("@/components/chat/message-action-sheet", () => ({
  MessageActionSheet: (props: { open: boolean; onEdit?: () => void; finalFocus?: (t: string) => unknown }) => {
    sheet.props = props;
    return props.open ? <div data-testid="action-sheet" /> : null;
  },
}));
vi.mock("@/components/chat/reasoning-trace-modal", () => ({ ReasoningTraceModal: () => null }));
vi.mock("@/components/chat/reasoning-trace-live", () => ({ ReasoningTraceLive: () => null }));

import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

const USER_TEXT = "Synthetic question about the bay schedule";
const REPLY_TEXT = "Synthetic reply about the bay schedule";
const messages = [
  { id: "u1", role: "user", parts: [{ type: "text", text: USER_TEXT }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: REPLY_TEXT }] },
] as unknown as UIMessage[];

let host: HTMLDivElement;
let root: Root;
let composer: HTMLTextAreaElement;

beforeEach(() => {
  vi.useFakeTimers();
  useChatUiStore.setState({ draft: "", editingMessageId: null, draftReplace: null });
  composer = document.createElement("textarea");
  composer.setAttribute("data-chat-composer-input", "");
  document.body.appendChild(composer);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(<ChatMessageList messages={messages} isLoading={false} error={undefined} onRetry={() => {}} />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
});

/** The innermost element rendering exactly this text (outer planes match too). */
function textNode(text: string): HTMLElement {
  const el = Array.from(host.querySelectorAll<HTMLElement>("span, div")).filter((n) => n.textContent === text).pop();
  if (!el) throw new Error(`no element renders "${text}"`);
  return el;
}

/** A finger held still on the text for 700 ms, the way iOS starts a selection. */
function hold(el: HTMLElement): MouseEvent {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(700);
  });
  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(menu);
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  return menu;
}

describe("chat bubbles leave long-press to iOS text selection", () => {
  it.each([
    ["the operator's message", USER_TEXT],
    ["Nick's reply", REPLY_TEXT],
  ])("a held press on %s opens no sheet and keeps the native menu", (_label, text) => {
    const menu = hold(textNode(text));
    expect(host.querySelector('[data-testid="action-sheet"]')).toBeNull();
    expect(menu.defaultPrevented).toBe(false);
  });

  it("CONTROL · the visible More button still opens the sheet", () => {
    const more = host.querySelectorAll<HTMLButtonElement>('button[aria-label="More actions"]')[0];
    act(() => more.click());
    expect(host.querySelector('[data-testid="action-sheet"]')).not.toBeNull();
  });
});

describe("tap-to-edit on the operator's own message", () => {
  it("a tap arms edit-resend with the message text and focuses the composer", () => {
    act(() => textNode(USER_TEXT).click());
    const s = useChatUiStore.getState();
    expect(s.draft).toBe(USER_TEXT);
    expect(s.editingMessageId).toBe("u1");
    expect(document.activeElement).toBe(composer);
  });

  it("a tap that ends a text selection copies, it does not edit", () => {
    const el = textNode(USER_TEXT);
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()?.addRange(range);
    act(() => el.click());
    expect(useChatUiStore.getState().editingMessageId).toBeNull();
    expect(useChatUiStore.getState().draft).toBe("");
  });

  // Codex P2 on PR 3351: the sheet's own focus restoration ran after the edit
  // and put focus back on More, so the keyboard closed again.
  it("Edit from the More sheet hands the sheet's closing focus to the composer", () => {
    const more = host.querySelectorAll<HTMLButtonElement>('button[aria-label="More actions"]')[0];
    act(() => more.click());
    act(() => sheet.props.onEdit?.());
    expect(useChatUiStore.getState().editingMessageId).toBe("u1");
    expect(sheet.props.finalFocus?.("click")).toBe(composer);
  });

  it("CONTROL · any other sheet action keeps the default focus restoration", () => {
    const more = host.querySelectorAll<HTMLButtonElement>('button[aria-label="More actions"]')[0];
    act(() => more.click());
    expect(sheet.props.finalFocus?.("click")).toBe(true);
  });

  it("the Edit button focuses the composer too", () => {
    const edit = host.querySelector<HTMLButtonElement>('button[aria-label="Edit and resend"]')!;
    act(() => edit.click());
    expect(useChatUiStore.getState().editingMessageId).toBe("u1");
    expect(document.activeElement).toBe(composer);
  });
});
