// @vitest-environment jsdom
/**
 * U2 (2026-10-30) · the chat's Context & Evidence panel shows what the reply used, strong first.
 *
 * Before: eight 23% "matches" filled the panel, the list did not say whether it came from this
 * turn or a re-run, and no memory could be opened. Now: below recall's top 3 (kept in recall's own
 * rank order: dense and lexical scores are not comparable), a hit under 35% folds behind
 * "N weak matches hidden"; a degraded (lexical-only) read folds nothing; the heading names the
 * source; each memory opens in the universal memory inspector.
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
import { KEEP_TOP_HITS, WEAK_MATCH_BELOW } from "@/lib/chat/recall-display";
import { readInspect } from "@/lib/ui/inspect-url";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement;

const hit = (id: string, similarity: number): MemoryHit => ({ id, content: `memory ${id}`, category: "preference", similarity });
// Recall's order: a lexical top hit with a low score first, then a strong tail and a weak tail.
const hits = [hit("m23", 0.23), hit("m60", 0.6), hit("m40", 0.4), hit("m24", 0.24), hit("m50", 0.5), hit("m21", 0.21)];

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
  it("recall's top 3 always show, in recall order; below them a hit under 35% folds", () => {
    expect(KEEP_TOP_HITS).toBe(3);
    render();
    expect(shownIds()).toEqual(["memory m23", "memory m60", "memory m40", "memory m50"]);
    expect(host.textContent).toContain("2 weak matches hidden (under 35%)");
  });

  it("Show reveals the full list in recall order", () => {
    render();
    const toggle = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("weak matches hidden"))!;
    act(() => toggle.click());
    expect(shownIds()).toEqual(["memory m23", "memory m60", "memory m40", "memory m24", "memory m50", "memory m21"]);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("a new turn's list starts folded again", () => {
    render();
    act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("weak matches hidden"))!.click());
    render({ hits: [...hits] });
    expect(host.textContent).toContain("2 weak matches hidden");
  });

  it("a degraded (lexical-only) read folds nothing: its scores are not cosine", () => {
    render({ recallProvenance: "ERROR" });
    expect(shownIds()).toHaveLength(6);
    expect(host.textContent).not.toContain("weak match");
  });

  it("the heading names the source and never claims the reply used the list", () => {
    render({ recallSource: "turn" });
    expect(host.textContent).toContain("Recalled for this turn (6)");
    expect(host.textContent).toContain("Nick's prompt may use part of it.");
    expect(host.textContent).not.toContain("Used in this reply");
    render({ recallSource: "preview" });
    expect(host.textContent).toContain("Recall preview for your last message (6)");
    expect(host.textContent).toContain("The reply may have used different memories.");
  });

  it("Open puts the memory in the universal inspector; placeholder ids get no Open", () => {
    render({ hits: [hit("cm123", 0.7), hit("hit-0", 0.6)] });
    const opens = Array.from(host.querySelectorAll("button")).filter((b) => b.textContent === "Open");
    expect(opens).toHaveLength(1);
    act(() => opens[0].click());
    expect(push).toHaveBeenCalledTimes(1);
    // The consumer end: the URL the button pushed is one InspectorHost reads back as this memory.
    const search = new URL(String(push.mock.calls[0][0]), "http://x").search;
    expect(readInspect(search)).toEqual({ kind: "memory", id: "cm123" });
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
