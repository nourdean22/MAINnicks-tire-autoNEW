/**
 * 09-F3 (2026-10-10): Brain's default Map view was a bare <canvas> (no role, no name, mouse and
 * touch only), its zoom buttons were 32px and named "+" / "-". The canvas now announces what it
 * draws, a visible "View as list" link gives keyboard and screen-reader users a text path (the
 * memory list), and the zoom controls are named 44px targets.
 *
 * The label is a pure function of the load state and the counts on screen, asserted here the same
 * way home-brain-graph-honesty.test.ts asserts the other decisions this component makes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { graphCanvasLabel } from "@/components/home/home-brain-graph";

const ready = { phase: "ready", refreshing: false, staleError: null } as const;

describe("graphCanvasLabel", () => {
  it("names what is drawn: node and connection counts", () => {
    expect(graphCanvasLabel(ready, { nodes: 148, edges: 212 })).toBe("Brain map: 148 nodes, 212 connections");
  });

  it("singular counts read as words, not '1 nodes'", () => {
    expect(graphCanvasLabel(ready, { nodes: 1, edges: 1 })).toBe("Brain map: 1 node, 1 connection");
  });

  it("a failed refresh over a good graph says the map is the last one that loaded", () => {
    const stale = { phase: "ready", refreshing: false, staleError: "timed out" } as const;
    expect(graphCanvasLabel(stale, { nodes: 5, edges: 4 })).toBe(
      "Brain map: 5 nodes, 4 connections, from the last load (refresh failed)",
    );
  });

  it("loading, empty and failed states never claim a graph", () => {
    expect(graphCanvasLabel({ phase: "initial" }, { nodes: 0, edges: 0 })).toBe("Brain map, loading");
    expect(graphCanvasLabel({ phase: "empty", isolatedFocus: false }, { nodes: 0, edges: 0 })).toBe("Brain map, no nodes to show");
    expect(graphCanvasLabel({ phase: "error", message: "boom" }, { nodes: 0, edges: 0 })).toBe("Brain map, failed to load");
  });
});

describe("the canvas and its controls are wired", () => {
  const src = readFileSync(join(__dirname, "..", "..", "components/home/home-brain-graph.tsx"), "utf8");

  it("the canvas is an image with the computed label", () => {
    const canvas = src.match(/<canvas[\s\S]*?\/>/)?.[0] ?? "";
    expect(canvas).toContain('role="img"');
    expect(canvas).toContain("aria-label={graphCanvasLabel(loadState, shownCounts)}");
  });

  it("a visible View as list link leads to the memory list", () => {
    expect(src).toMatch(/href="\/brain\?tab=memory"[\s\S]{0,400}View as list/);
  });

  it("zoom controls are named and 44px", () => {
    for (const name of ["Zoom in", "Zoom out", "Reset view"]) {
      // `[^>]` would stop at the `=>` of the onClick arrow, so read the same line's className.
      const className = src.match(new RegExp(`<button[^\\n]*aria-label="${name}"[^\\n]*?className="([^"]*)"`))?.[1];
      expect(className, `${name} button missing`).toBeDefined();
      expect(className).toMatch(/\bh-11 w-11\b/);
    }
  });
});
