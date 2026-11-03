// @vitest-environment jsdom
/**
 * W5 2026-11-02: "Ask Nick about this goal" opens the side pane with the question prefilled. When the pane
 * was closed, its chat was not mounted, so the open-nick event's prompt reached no listener and the pane
 * opened empty. The pane now keeps the prompt and the chat starts from it; a pane opened by hand starts empty.
 * (pr-test-analyzer P1, 2026-11-03: behaviour, not a source grep.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/use-min-width", () => ({ useMinWidth: () => true })); // the desktop pane renders inline
vi.mock("@/lib/hooks/use-coach-events", () => ({ useCoachEvents: () => ({ events: [] }) }));

import { NickSidePane } from "@/components/mastery/nick-side-pane";

let container: HTMLDivElement;
let root: Root;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const chatField = () => container.querySelector<HTMLInputElement>("input");
const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

beforeEach(async () => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<NickSidePane page="goals" />));
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("side pane prefill", () => {
  it("a closed pane opened by the event shows the question in the field, not sent; a pane reopened by hand is empty", async () => {
    expect(chatField(), "the pane starts closed (no chat mounted)").toBeNull();
    const prompt = 'About my goal "Run" [id:g1]: what is the one move?';
    act(() => {
      window.dispatchEvent(new CustomEvent("statenour:open-nick", { detail: { pendingPrompt: prompt, submitOnMount: false } }));
    });
    await flush();
    expect(chatField(), "the event opened the pane").not.toBeNull();
    expect(chatField()!.value).toBe(prompt);

    await click(byLabel("close nick"));
    await flush();
    expect(chatField(), "closed").toBeNull();
    await click(byLabel("open nick side pane"));
    await flush();
    expect(chatField()!.value, "a hand-opened pane never re-seeds an old question").toBe("");
  });
});
