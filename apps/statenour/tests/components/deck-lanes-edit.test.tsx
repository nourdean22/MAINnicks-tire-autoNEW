// @vitest-environment jsdom
/**
 * Lanes are missions (the GENERAL anchors) and had no way into the mission editor from /missions
 * (Nour 2026-10-26: "add subtract from the missions"). Each lane row now carries an edit entry at the
 * 44 px floor that calls onEditMission with the lane's mission id; opening the lane still works.
 *
 * Positive control: the sweep must locate every lane's entry (a scanner that matched nothing passes), and
 * the shop lane keeps its "Open shop admin" link beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/missions/mission-task-row", () => ({ MissionTaskRow: () => null }));

import { DeckLanes } from "@/components/missions/deck-lanes";
import type { MissionsDeck } from "@/lib/missions/deck";

const LANES: MissionsDeck["lanes"] = [
  { id: "m-health", title: "HEALTH", canonicalDomain: "health", isShop: false, openCount: 4, oldestOpenDays: 5 },
  { id: "m-shop", title: "SHOP", canonicalDomain: "shop", isShop: true, openCount: 2, oldestOpenDays: null },
];

const floor = (cls: string, axis: "h" | "w"): number => {
  const re = axis === "h" ? /(?:^|\s)(?:min-h|h)-(\d+|\[(\d+)px\])(?=\s|$)/g : /(?:^|\s)(?:min-w|w)-(\d+|\[(\d+)px\])(?=\s|$)/g;
  let px = 0;
  for (const m of cls.matchAll(re)) px = m[2] ? Number(m[2]) : Number(m[1]) * 4;
  return px;
};

let container: HTMLDivElement;
let root: Root;
const onEditMission = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onEditMission.mockClear();
  act(() => {
    root.render(<DeckLanes lanes={LANES} tasks={[]} onEditMission={onEditMission} />);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const edits = () => [...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Edit mission "]')];

describe("DeckLanes · edit entry per lane", () => {
  it("every lane has an edit entry at 44 x 44, and the shop lane keeps its admin link", () => {
    expect(edits().length, "the scanner located both lanes").toBe(2);
    for (const el of edits()) {
      expect(floor(el.className, "h"), el.getAttribute("aria-label") ?? "").toBeGreaterThanOrEqual(44);
      expect(floor(el.className, "w"), el.getAttribute("aria-label") ?? "").toBeGreaterThanOrEqual(44);
    }
    expect(container.textContent).toContain("Open shop admin");
  });

  it("tapping a lane's edit entry calls onEditMission with THAT lane's mission id and does not open the lane", () => {
    const health = edits().find((b) => b.getAttribute("aria-label") === "Edit mission HEALTH")!;
    act(() => {
      health.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onEditMission).toHaveBeenCalledTimes(1);
    expect(onEditMission).toHaveBeenCalledWith("m-health");
    expect(container.textContent).not.toContain("Lane is clear.");
  });
});
