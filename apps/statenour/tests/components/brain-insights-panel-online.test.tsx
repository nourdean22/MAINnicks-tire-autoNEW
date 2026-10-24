// @vitest-environment jsdom
/**
 * Truth sweep review (2026-10-24), finding F2: BrainInsightsPanel loaded its three feeds ONCE
 * (effect deps []) while the note read the LIVE online flag. Open /brain offline, all three feeds
 * throw, the connection returns, nothing refetched, and the note flipped from amber "Offline" to
 * red "3 of 3 feeds could not load" with no Retry. Tested at the PANEL, not the view: the view
 * test only feeds a fixed prop, which is how this slipped through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { BrainInsightsPanel } from "@/components/brain/brain-insights-panel";

const violation = { id: "v1", key: "k", content: "a principle", origin: "o", violationRate: 0.5, matches: ["m"], confidence: 0.8 };
const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

let host: HTMLElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let feedsUp: boolean;

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  onlineManager.setOnline(true);
  feedsUp = false;
  fetchMock = vi.fn(async (url: string) => {
    if (!feedsUp) throw new TypeError("Failed to fetch");
    if (url.includes("violations")) return okJson({ violations: [violation], total: 1 });
    return okJson({});
  });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

describe("BrainInsightsPanel reloads when the connection returns", () => {
  it("opened offline: says offline; the connection returns and the feeds load again, with no red note", async () => {
    onlineManager.setOnline(false);
    await act(async () => root.render(<BrainInsightsPanel />));
    await flush();
    expect(host.textContent).toContain("Offline. Brain insights shows when the connection returns.");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    feedsUp = true;
    await act(async () => onlineManager.setOnline(true));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(host.textContent).toContain("a principle");
    expect(host.textContent).not.toContain("could not load");
    expect(host.textContent).not.toContain("Offline.");
  });

  it("going offline alone does not refetch (skip while offline)", async () => {
    feedsUp = true;
    await act(async () => root.render(<BrainInsightsPanel />));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => onlineManager.setOnline(false));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("BrainInsightsPanel failed note offers a working Retry", () => {
  it("online with every feed down: the red note has Retry, and Retry loads them again", async () => {
    await act(async () => root.render(<BrainInsightsPanel />));
    await flush();
    expect(host.textContent).toContain("3 of 3 feeds could not load");
    const retry = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Retry");
    expect(retry).toBeTruthy();

    feedsUp = true;
    await act(async () => retry!.click());
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(host.textContent).toContain("a principle");
    expect(host.textContent).not.toContain("could not load");
  });
});
