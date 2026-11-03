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

const h = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/hooks/use-min-width", () => ({ useMinWidth: () => h.desktop })); // true: the desktop pane renders inline
vi.mock("@/lib/hooks/use-coach-events", () => ({ useCoachEvents: () => ({ events: [] }) }));

import { NickSidePane } from "@/components/mastery/nick-side-pane";

let container: HTMLDivElement;
let root: Root;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const chatField = () => document.querySelector<HTMLInputElement>("input"); // the phone sheet portals to body
const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

beforeEach(async () => {
  h.desktop = true;
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

  it("a mission hand-off (submitOnMount) still sends when the pane was closed", async () => {
    const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    act(() => {
      window.dispatchEvent(new CustomEvent("statenour:open-nick", { detail: { pendingPrompt: "Suggest 3 missions.", submitOnMount: true } }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body)).toContain("Suggest 3 missions.");
  });

  it("a chat that remounts (desktop pane to phone sheet) does not re-seed a question it already took", async () => {
    act(() => {
      window.dispatchEvent(new CustomEvent("statenour:open-nick", { detail: { pendingPrompt: "First question", submitOnMount: false } }));
    });
    await flush();
    expect(chatField()!.value).toBe("First question");
    h.desktop = false;
    act(() => root.render(<NickSidePane page="goals" />));
    await flush();
    expect(chatField(), "the phone sheet mounted its own chat").not.toBeNull();
    expect(chatField()!.value).toBe("");
  });
});
