// @vitest-environment jsdom
/**
 * U2 (2026-10-30) · the chat's Context & Evidence panel shows what the reply used, strong first.
 *
 * Before: every recalled memory was listed in recall's own order with its raw %, so a 60% match
 * could sit under a 23% one and eight 23% "matches" filled the panel; the list did not say whether
 * it was what the reply used or a re-run, and no memory could be opened. Now: matches under 35%
 * fold behind "N weak matches hidden", the rest sort by %, the heading names the source, and each
 * memory opens in the universal memory inspector.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/chat",
}));

import { MemoryInspectorSidebar, type MemoryHit } from "@/components/chat/memory-inspector-sidebar";
import { WEAK_MATCH_BELOW } from "@/lib/chat/recall-display";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement;

const hit = (id: string, similarity: number): MemoryHit => ({ id, content: `memory ${id}`, category: "preference", similarity });
const hits = [hit("m23", 0.23), hit("m60", 0.6), hit("m40", 0.4), hit("m24", 0.24)];

function render(props: Partial<React.ComponentProps<typeof MemoryInspectorSidebar>> = {}) {
  act(() => root!.render(<MemoryInspectorSidebar open onClose={() => {}} hits={hits} recallProvenance="OK" {...props} />));
}
const shownIds = () => Array.from(host.querySelectorAll("p.whitespace-pre-wrap")).map((p) => p.textContent);

beforeEach(() => {
  push.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

describe("Context & Evidence · recalled memories (U2)", () => {
  it("strong matches show best first; weak ones fold behind a count", () => {
    render();
    expect(shownIds()).toEqual(["memory m60", "memory m40"]);
    expect(host.textContent).toContain("2 weak matches hidden (under 35%)");
  });

  it("Show reveals the weak matches after the strong ones", () => {
    render();
    const toggle = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("weak matches hidden"))!;
    act(() => toggle.click());
    expect(shownIds()).toEqual(["memory m60", "memory m40", "memory m24", "memory m23"]);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("all weak: says so instead of an empty list", () => {
    render({ hits: [hit("a", 0.2), hit("b", 0.3)] });
    expect(host.textContent).toContain("No strong matches");
    expect(host.textContent).toContain("2 weak matches hidden");
  });

  it("the heading names the source: used in this reply, or a preview re-run", () => {
    render({ recallSource: "turn" });
    expect(host.textContent).toContain("Used in this reply (4)");
    render({ recallSource: "preview" });
    expect(host.textContent).toContain("Recall preview for your last message (4)");
    expect(host.textContent).toContain("The reply may have used different memories.");
  });

  it("Open puts the memory in the universal inspector; placeholder ids get no Open", () => {
    render({ hits: [hit("cm123", 0.7), hit("hit-0", 0.6)] });
    const opens = Array.from(host.querySelectorAll("button")).filter((b) => b.textContent === "Open");
    expect(opens).toHaveLength(1);
    act(() => opens[0].click());
    expect(push).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(String(push.mock.calls[0][0]))).toContain("memory:cm123");
  });

  it("Open closes the overlay panel (it would cover the inspector) but not the docked column", () => {
    const onClose = vi.fn();
    render({ hits: [hit("cm1", 0.7)], onClose });
    act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Open")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    render({ hits: [hit("cm1", 0.7)], onClose, docked: true });
    act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Open")!.click());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the display floor matches the recall wisdom floor (lib/brain/contextual-recall.ts)", () => {
    const src = readFileSync(join(__dirname, "..", "..", "lib", "brain", "contextual-recall.ts"), "utf8");
    const m = src.match(/export const WISDOM_SLOT_MIN_SIMILARITY = ([0-9.]+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(WEAK_MATCH_BELOW);
  });
});
