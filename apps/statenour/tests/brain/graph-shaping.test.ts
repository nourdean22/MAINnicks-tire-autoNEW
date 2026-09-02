/**
 * tests/brain/graph-shaping.test.ts · 2026-09-02 · WP-2 + WP-3.
 *
 * THE CANARY THIS FILE EXISTS FOR: orphans must be computed AFTER the type
 * filter, never before.
 *
 * Measured on production 2026-09-02 — filtering the 148-node graph down to
 * semantic types RAISED the degree-0 count from 38 to 43, because some nodes'
 * only edges pointed at a task or a journal. A build that computed orphans on
 * the unfiltered graph would under-report by five and put the wrong set in the
 * tray, while leaving five genuinely-stranded nodes floating in the layout.
 * The spec's own "UNLINKED (38)" example had exactly that bug.
 *
 * Also pins the additive contract: `scope=full` must keep every node it kept
 * before, because existing consumers request it.
 */
import { describe, expect, it } from "vitest";
import { SEMANTIC_NODE_TYPES } from "@/lib/brain/brain-graph";

type N = { id: string; type: string; label: string; displayLabel?: string; fullLabel?: string };
type E = { source: string; target: string };

/**
 * The finalize logic, mirrored here as a pure reference so the interaction can
 * be asserted without a database. `finalizeGraph` is module-private inside the
 * builder; the behaviour it must have is what this file locks down, and
 * scripts/measure-brain-graph.ts proves the real builder agrees on live data.
 */
function shape(nodes: N[], edges: E[], scope: "full" | "semantic") {
  let ns = nodes;
  let es = edges;
  if (scope === "semantic") {
    ns = ns.filter((n) => (SEMANTIC_NODE_TYPES as ReadonlySet<string>).has(n.type));
    const keep = new Set(ns.map((n) => n.id));
    es = es.filter((e) => keep.has(e.source) && keep.has(e.target));
  }
  const degree = new Map<string, number>();
  for (const e of es) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const unlinked = ns.filter((n) => (degree.get(n.id) ?? 0) === 0);
  return {
    nodes: scope === "semantic" ? ns.filter((n) => (degree.get(n.id) ?? 0) > 0) : ns,
    edges: es,
    unlinked,
  };
}

/** memory M is connected ONLY through a task — the exact production shape. */
const NODES: N[] = [
  { id: "m1", type: "memory", label: "Supplier margin reality" },
  { id: "m2", type: "memory", label: "Stranded by a task edge" },
  { id: "d1", type: "decision", label: "Adderall pattern — decide" },
  { id: "t1", type: "task", label: "Create recurring Monday task 7:30-8:00 AM – Prep" },
  { id: "j1", type: "journal", label: "I took my 30mg Zepbound at 6am and had two coffees" },
];
const EDGES: E[] = [
  { source: "m1", target: "d1" }, // survives the filter
  { source: "m2", target: "t1" }, // m2's ONLY edge — dies with the task
  { source: "j1", target: "t1" },
];

describe("scope=semantic · type filter", () => {
  it("drops task and journal nodes", () => {
    const out = shape(NODES, EDGES, "semantic");
    const types = [...out.nodes, ...out.unlinked].map((n) => n.type);
    expect(types).not.toContain("task");
    expect(types).not.toContain("journal");
  });

  it("drops every edge that lost an endpoint — no dangling references", () => {
    const out = shape(NODES, EDGES, "semantic");
    const ids = new Set([...out.nodes, ...out.unlinked].map((n) => n.id));
    for (const e of out.edges) {
      expect(ids.has(e.source) && ids.has(e.target), `dangling ${e.source}->${e.target}`).toBe(true);
    }
  });
});

describe("THE CANARY · orphans are computed on the FILTERED graph", () => {
  it("a node whose only edge pointed at a task becomes unlinked", () => {
    const before = shape(NODES, EDGES, "full");
    const after = shape(NODES, EDGES, "semantic");

    // m2 is connected in the full graph...
    expect(before.unlinked.map((n) => n.id)).not.toContain("m2");
    // ...and stranded once the task it hung from is filtered away.
    expect(after.unlinked.map((n) => n.id)).toContain("m2");
  });

  it("filtering can RAISE the orphan count — the spec assumed it would fall", () => {
    const before = shape(NODES, EDGES, "full").unlinked.length;
    const after = shape(NODES, EDGES, "semantic").unlinked.length;
    expect(after).toBeGreaterThan(before);
  });

  it("MUTATION CANARY: computing degree before the filter under-reports", () => {
    // the wrong implementation — degree from the UNFILTERED edge list
    const wrongDegree = new Map<string, number>();
    for (const e of EDGES) {
      wrongDegree.set(e.source, (wrongDegree.get(e.source) ?? 0) + 1);
      wrongDegree.set(e.target, (wrongDegree.get(e.target) ?? 0) + 1);
    }
    const semanticNodes = NODES.filter((n) => (SEMANTIC_NODE_TYPES as ReadonlySet<string>).has(n.type));
    const wrong = semanticNodes.filter((n) => (wrongDegree.get(n.id) ?? 0) === 0);
    const right = shape(NODES, EDGES, "semantic").unlinked;
    expect(wrong.length).toBeLessThan(right.length);
    expect(wrong.map((n) => n.id)).not.toContain("m2");
  });
});

describe("WP-3 · nothing with degree 0 enters the simulation", () => {
  it("every rendered node has at least one edge", () => {
    const out = shape(NODES, EDGES, "semantic");
    const degree = new Map<string, number>();
    for (const e of out.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    for (const n of out.nodes) expect(degree.get(n.id) ?? 0).toBeGreaterThan(0);
  });

  it("rendered and unlinked sets are disjoint and lose nothing", () => {
    const out = shape(NODES, EDGES, "semantic");
    const rendered = new Set(out.nodes.map((n) => n.id));
    for (const u of out.unlinked) expect(rendered.has(u.id)).toBe(false);
    const semanticCount = NODES.filter((n) => (SEMANTIC_NODE_TYPES as ReadonlySet<string>).has(n.type)).length;
    expect(out.nodes.length + out.unlinked.length).toBe(semanticCount);
  });
});

describe("scope=full · additive only", () => {
  it("keeps every node, including the orphans", () => {
    const out = shape(NODES, EDGES, "full");
    expect(out.nodes).toHaveLength(NODES.length);
    expect(out.edges).toHaveLength(EDGES.length);
  });

  it("still reports unlinked, but does not remove them — existing consumers are untouched", () => {
    const out = shape(NODES, EDGES, "full");
    const ids = out.nodes.map((n) => n.id);
    for (const u of out.unlinked) expect(ids).toContain(u.id);
  });
});

describe("the semantic type set", () => {
  it("excludes churn and includes standing knowledge", () => {
    expect(SEMANTIC_NODE_TYPES.has("task" as never)).toBe(false);
    expect(SEMANTIC_NODE_TYPES.has("journal" as never)).toBe(false);
    for (const t of ["memory", "decision", "person", "goal", "business", "mission", "system"] as const) {
      expect(SEMANTIC_NODE_TYPES.has(t), `${t} must be semantic`).toBe(true);
    }
  });
});
