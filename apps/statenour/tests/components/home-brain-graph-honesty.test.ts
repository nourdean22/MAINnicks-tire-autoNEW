/**
 * tests/components/home-brain-graph-honesty.test.ts · 2026-09-02 self-audit.
 *
 * Three defects in components/home/home-brain-graph.tsx, all of the same
 * shape: the surface asserted something the data did not support.
 *
 *  4. "Ask the brain" clipped the graph to 120 nodes off the BUILDER'S
 *     EMISSION ORDER and then told the model "do not hallucinate nodes not
 *     in the snapshot" while asking for "the single highest-leverage move
 *     I am missing". A silently truncated snapshot does not just omit
 *     context — it licenses reasoning about an absence never shown.
 *  5. The empty state said "genuinely empty — not an error. Capture
 *     memories, missions or goals and they appear here." That is
 *     unreachable for the reason given (8 SYSTEM_ANCHORS ship
 *     unconditionally) and reachable for one it denies (a focused
 *     neighbourhood whose centre has no edges — one tap from the UNLINKED
 *     tray).
 *  6. After the first success every fetch failure was silent, and the
 *     scope toggles styled themselves from the REQUESTED state, so a
 *     failed refetch left "+ ACTIVITY" reading ON over a semantic payload
 *     that omits 55 of 148 nodes.
 *
 * The decisions are exported as pure functions precisely so they can be
 * asserted here — this repo's own pure-derivation pattern (see
 * tests/components/home-health-chip-state.test.ts). These are behaviour
 * assertions on the exact code the component runs, not source-text greps.
 */

import { describe, it, expect } from "vitest";
import {
  buildAskPrompt,
  emptyStateCopy,
  loadStateAfterFailure,
  loadStateAfterSuccess,
  resolveControlState,
  type LoadState,
} from "@/components/home/home-brain-graph";
import type { BrainGraphNode } from "@/lib/brain/brain-graph";

function node(id: string, weight: number, over: Partial<BrainGraphNode> = {}): BrainGraphNode {
  return { id, type: "memory", label: `label ${id}`, weight, ...over };
}

describe("defect 4 · the ask-the-brain snapshot never poses as complete", () => {
  it("PLANTED POSITIVE · an unclipped snapshot says so and lists everything", () => {
    // Without this, "PARTIAL" assertions could pass against a builder that
    // marked every prompt partial regardless.
    const prompt = buildAskPrompt({ nodes: [node("a", 5), node("b", 3)], lens: "all", budget: 10 });
    expect(prompt).toContain("complete: all 2 nodes in view");
    expect(prompt).not.toContain("PARTIAL");
    expect(prompt).toContain("label a");
    expect(prompt).toContain("label b");
  });

  it("DISCLOSES the clip, with both numbers", () => {
    const nodes = Array.from({ length: 200 }, (_, i) => node(`n${i}`, i));
    const prompt = buildAskPrompt({ nodes, lens: "all", budget: 120 });

    expect(prompt).toContain("PARTIAL");
    expect(prompt).toContain("the 120 heaviest of 200 nodes in view");
    expect(prompt).toContain("80 lower-weight nodes are NOT shown");
  });

  it("tells the model that absence is not evidence, ONLY when clipped", () => {
    const many = Array.from({ length: 200 }, (_, i) => node(`n${i}`, i));
    const few = [node("a", 1)];

    expect(buildAskPrompt({ nodes: many, lens: "all", budget: 120 })).toContain(
      "absence is NOT evidence",
    );
    // A complete snapshot must NOT carry the hedge — the rule has to mean
    // something when it appears.
    expect(buildAskPrompt({ nodes: few, lens: "all", budget: 120 })).not.toContain(
      "absence is NOT evidence",
    );
  });

  it("keeps the HEAVIEST nodes, not whatever the builder emitted last", () => {
    // The builder appends system anchors and category hubs AFTER every
    // database domain, so an emission-order slice dropped exactly the
    // structural nodes. Weight is the graph's own attention measure.
    const nodes = [
      ...Array.from({ length: 10 }, (_, i) => node(`light-${i}`, 1)),
      node("heavy-anchor", 9),
    ];
    const prompt = buildAskPrompt({ nodes, lens: "all", budget: 3 });

    expect(prompt).toContain("label heavy-anchor");
    // 3 kept out of 11 — the tail that fell off is the light ones.
    expect(prompt).toContain("the 3 heaviest of 11 nodes in view");
  });

  it("is deterministic for a given payload", () => {
    const nodes = [node("b", 5), node("a", 5), node("c", 5)];
    const first = buildAskPrompt({ nodes, lens: "all", budget: 2 });
    const second = buildAskPrompt({ nodes: [...nodes].reverse(), lens: "all", budget: 2 });
    expect(first).toBe(second);
  });
});

describe("defect 5 · the empty state names the cause it actually has", () => {
  it("classifies a zero-node FOCUSED payload as an isolated node", () => {
    const state = loadStateAfterSuccess(0, "mem-42");
    expect(state).toEqual({ phase: "empty", isolatedFocus: true });
  });

  it("classifies a zero-node UNFOCUSED payload as a bad response, not an empty brain", () => {
    const state = loadStateAfterSuccess(0, null);
    expect(state).toEqual({ phase: "empty", isolatedFocus: false });
  });

  it("PLANTED POSITIVE · a non-empty payload is ready, not empty", () => {
    expect(loadStateAfterSuccess(12, "mem-42").phase).toBe("ready");
  });

  it("tells an operator inspecting an unlinked node that the NODE has no connections", () => {
    const copy = emptyStateCopy(true);
    expect(copy.headline).toMatch(/no connections/i);
    // The specific harm: the operator taps a node from the tray that exists
    // to list unlinked nodes, and is told to go capture some.
    expect(
      `${copy.headline} ${copy.body}`.toLowerCase(),
      "must not send the operator off to capture memories when they inspected an isolated node",
    ).not.toContain("capture memories");
  });

  it("never claims the brain is 'genuinely empty' — anchors ship unconditionally", () => {
    const copy = emptyStateCopy(false);
    const all = `${copy.headline} ${copy.body}`.toLowerCase();
    expect(all).not.toContain("genuinely empty");
    expect(all).toContain("anchors");
  });

  it("the two causes do not share copy", () => {
    expect(emptyStateCopy(true).headline).not.toBe(emptyStateCopy(false).headline);
    expect(emptyStateCopy(true).body).not.toBe(emptyStateCopy(false).body);
  });
});

describe("defect 6a · a failed refresh over a good graph is never silent", () => {
  const ready: LoadState = { phase: "ready", refreshing: true, staleError: null };

  it("keeps the payload on screen AND carries the reason", () => {
    const next = loadStateAfterFailure(ready, "graph request timed out after 12s");
    expect(next.phase).toBe("ready");
    expect(next).toMatchObject({ staleError: "graph request timed out after 12s" });
  });

  it("PLANTED POSITIVE · a first-load failure still becomes a full error phase", () => {
    const next = loadStateAfterFailure({ phase: "initial" }, "boom");
    expect(next).toEqual({ phase: "error", message: "boom" });
  });

  it("clears refreshing so the spinner cannot outlive the request", () => {
    expect(loadStateAfterFailure(ready, "boom")).toMatchObject({ refreshing: false });
  });
});

describe("defect 6b · the scope controls describe the graph on screen", () => {
  const requestedOn = { includeActivity: true, focusId: null, localOnly: false };

  it("PLANTED POSITIVE · with no payload yet, the controls follow the request", () => {
    const s = resolveControlState(null, requestedOn);
    expect(s.activityApplied).toBe(true);
    expect(s.activityPending).toBe(false);
  });

  it("reads OFF while the payload on screen was built without activity", () => {
    // The defect: the operator toggled + ACTIVITY, the refetch failed, and
    // the button stayed lit over a `semantic` graph missing task + journal.
    const applied = { includeActivity: false, focusId: null, localOnly: false };
    const s = resolveControlState(applied, requestedOn);
    expect(
      s.activityApplied,
      "the toggle must describe the payload that is rendered, not the request that failed",
    ).toBe(false);
    expect(s.activityPending).toBe(true);
  });

  it("reads ON once a payload built WITH activity has landed", () => {
    const applied = { includeActivity: true, focusId: null, localOnly: false };
    const s = resolveControlState(applied, requestedOn);
    expect(s.activityApplied).toBe(true);
    expect(s.activityPending).toBe(false);
  });

  it("applies the same rule to the local-neighbourhood toggle", () => {
    const applied = { includeActivity: false, focusId: "n1", localOnly: false };
    const s = resolveControlState(applied, { includeActivity: false, focusId: "n1", localOnly: true });
    expect(s.localOnlyApplied).toBe(false);
    expect(s.localOnlyPending).toBe(true);
  });
});
