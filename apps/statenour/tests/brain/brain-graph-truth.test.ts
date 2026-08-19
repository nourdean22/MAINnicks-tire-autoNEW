/**
 * brain-graph builder tests · 2026-08-19 (Brain truth pass).
 *
 * FIRST coverage for the /brain graph — it had ZERO tests, which is how
 * it kept a 404 href, fossil AI anchor nodes, invented keyword edges and
 * an all-or-nothing Promise.all for months. These pin the new contracts:
 *
 *  1. DEGRADED, NEVER HUNG — one failing domain must NOT fail the graph;
 *     it must arrive named in `degraded`.
 *  2. NO INVENTED EDGES — every edge carries an `origin`, and nothing
 *     links by keyword-matching a title.
 *  3. TRUST IS CARRIED — memory nodes get an evidence class, seenCount,
 *     age and TTL; weight follows re-sightings, never confidence-as-%.
 *  4. REAL DESTINATIONS — decision nodes deep-link to /decisions/<id>
 *     (the old /decisions has no page — it 404'd on every decision).
 *  5. CONTRADICTIONS ARE EDGES — unresolved pairs become `contradicts`
 *     edges and flag both endpoints.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const t = () => ({ findMany: vi.fn() });
  return {
    prisma: {
      mission: t(),
      task: t(),
      lifeGoal: t(),
      brainDump: t(),
      reflection: t(),
      decisionReplay: t(),
      personProfile: t(),
      brainMemory: t(),
      memoryEdge: t(),
      semanticEdge: t(),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { getBrainGraph } from "@/lib/brain/brain-graph";

const NOW = new Date("2026-08-19T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function memoryRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "mem-1",
    category: "belief",
    key: "belief_domain_1712334",
    content: "Consistency beats intensity for the shop's ops cadence.",
    source: "user",
    confidence: 0.8,
    seenCount: 4,
    lastSeen: daysAgo(1),
    createdAt: daysAgo(3),
    expiresAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const table of Object.values(h.prisma)) {
    table.findMany.mockReset();
    table.findMany.mockResolvedValue([]);
  }
});

describe("getBrainGraph · degraded, never hung", () => {
  it("returns a usable graph when ONE domain fails, naming it in degraded", async () => {
    h.prisma.mission.findMany.mockRejectedValue(new Error("pool exhausted"));
    h.prisma.brainMemory.findMany.mockResolvedValue([memoryRow()]);

    const g = await getBrainGraph({ scope: "full" });

    expect(g.degraded).toContain("missions");
    // the rest of the brain still rendered
    expect(g.nodes.some((n) => n.id === "mem-1")).toBe(true);
    expect(g.nodes.some((n) => n.metadata?.source === "system_seed")).toBe(true);
  });

  it("degrades a slow domain instead of waiting forever", async () => {
    // never settles — the old builder's Promise.all would hang here
    h.prisma.task.findMany.mockReturnValue(new Promise(() => {}));
    h.prisma.brainMemory.findMany.mockResolvedValue([memoryRow()]);

    const promise = getBrainGraph({ scope: "full" });
    await vi.advanceTimersByTimeAsync(9_000); // past the 8s domain deadline
    const g = await promise;

    expect(g.degraded).toContain("tasks");
    expect(g.nodes.length).toBeGreaterThan(0);
  });

  it("still returns anchors and an empty degraded list on a clean run", async () => {
    const g = await getBrainGraph({ scope: "full" });
    expect(g.degraded).toEqual([]);
    expect(g.nodes.some((n) => n.id === "nicks-tire")).toBe(true);
  });
});

describe("getBrainGraph · no invented relationships", () => {
  it("gives every edge a declared origin", async () => {
    h.prisma.brainMemory.findMany.mockResolvedValue([memoryRow()]);
    const g = await getBrainGraph({ scope: "full" });
    for (const e of g.edges) {
      expect(e.origin).toBeDefined();
      expect(["fk", "memory_edge", "semantic", "contradiction", "category", "domain"]).toContain(e.origin);
    }
  });

  it("does NOT link a mission to nicks-tire just because its title says tire", async () => {
    h.prisma.mission.findMany.mockResolvedValue([
      { id: "m-1", title: "Tire rotation SOP", status: "ACTIVE", priority: 7, roiScore: 10, neglectCost: 10, successMetric: null, createdAt: daysAgo(2), lifeGoalId: null },
    ]);
    const g = await getBrainGraph({ scope: "full" });
    const keywordEdge = g.edges.find(
      (e) => (e.source === "m-1" && e.target === "nicks-tire") || (e.target === "m-1" && e.source === "nicks-tire"),
    );
    expect(keywordEdge).toBeUndefined();
  });

  it("links a goal to its domain anchor using the goal's OWN domain field", async () => {
    h.prisma.lifeGoal.findMany.mockResolvedValue([
      { id: "g-1", title: "Grow shop revenue", status: "active", progress: 40, domain: "business", horizon: "year", why: null, createdAt: daysAgo(10) },
    ]);
    const g = await getBrainGraph({ scope: "full" });
    const domainEdge = g.edges.find((e) => e.source === "g-1" && e.target === "business");
    expect(domainEdge?.origin).toBe("domain");
  });

  it("leaves an unlinked node genuinely unlinked (isolation is signal)", async () => {
    h.prisma.personProfile.findMany.mockResolvedValue([
      { id: "p-1", name: "Sam", role: "supplier", trustScore: 0.6, relationship: null, lastInteraction: daysAgo(5), status: "active" },
    ]);
    const g = await getBrainGraph({ scope: "full" });
    const touching = g.edges.filter((e) => e.source === "p-1" || e.target === "p-1");
    expect(touching).toHaveLength(0); // old builder force-attached it to an anchor
  });
});

describe("getBrainGraph · trust and destinations", () => {
  it("carries evidence class, attention and recency on memory nodes", async () => {
    h.prisma.brainMemory.findMany.mockResolvedValue([
      memoryRow({ source: "user", seenCount: 6, createdAt: daysAgo(2), expiresAt: new Date(NOW.getTime() + 5 * 86_400_000) }),
    ]);
    const g = await getBrainGraph({ scope: "full" });
    const node = g.nodes.find((n) => n.id === "mem-1")!;
    expect(node.evidence).toBe("operator_stated");
    expect(node.seenCount).toBe(6);
    expect(node.isNew).toBe(true);
    expect(node.expiresInDays).toBe(5);
    // weight follows re-sightings (attention), not confidence-as-truth
    expect(node.weight).toBeCloseTo(2 + Math.log2(7) * 1.6, 3);
  });

  it("ranks attention on a LOG scale so a 6,516-sighting hub still outranks an 8-sighting node", async () => {
    // prod seenCount spans 1 → 6,516 (mean 3.69, measured 2026-08-19);
    // the earlier linear map saturated the cap at 8 and flattened them.
    h.prisma.brainMemory.findMany.mockResolvedValue([
      memoryRow({ id: "quiet", seenCount: 1 }),
      memoryRow({ id: "common", seenCount: 8 }),
      memoryRow({ id: "hub", seenCount: 6516 }),
    ]);
    const g = await getBrainGraph({ scope: "full" });
    const w = (id: string) => g.nodes.find((n) => n.id === id)!.weight;
    expect(w("quiet")).toBeLessThan(w("common"));
    expect(w("common")).toBeLessThan(w("hub"));
    expect(w("hub")).toBeLessThanOrEqual(10);
  });

  it("classifies an inferred memory below an operator-stated one", async () => {
    h.prisma.brainMemory.findMany.mockResolvedValue([
      memoryRow({ id: "mem-x", source: "pattern-detector" }),
    ]);
    const g = await getBrainGraph({ scope: "full" });
    expect(g.nodes.find((n) => n.id === "mem-x")!.evidence).toBe("supported_inference");
  });

  it("humanizes machine keys into readable labels", async () => {
    h.prisma.brainMemory.findMany.mockResolvedValue([memoryRow()]);
    const g = await getBrainGraph({ scope: "full" });
    const node = g.nodes.find((n) => n.id === "mem-1")!;
    expect(node.label).not.toContain("belief_domain_1712334");
    expect(node.label).toContain("Consistency beats intensity");
  });

  it("deep-links decisions to /decisions/<id> (the bare /decisions 404s)", async () => {
    h.prisma.decisionReplay.findMany.mockResolvedValue([
      { id: "d-1", title: "Switch supplier", reviewed: false, choiceMade: "A", outcome: null, context: "cost", lesson: null, createdAt: daysAgo(4), missionId: null, goalId: null },
    ]);
    const g = await getBrainGraph({ scope: "full" });
    expect(g.nodes.find((n) => n.id === "d-1")!.href).toBe("/decisions/d-1");
  });

  it("drops the fossil AI anchor nodes", async () => {
    const g = await getBrainGraph({ scope: "full" });
    for (const dead of ["ollama-glm", "gemini-backup", "provider-hud", "chat-ui", "brain-graph", "homepage-cc"]) {
      expect(g.nodes.some((n) => n.id === dead)).toBe(false);
    }
  });
});

describe("getBrainGraph · contradictions become edges", () => {
  it("renders an unresolved pair as a contradicts edge and flags both nodes", async () => {
    h.prisma.brainMemory.findMany.mockImplementation((args: { where?: { category?: unknown } }) => {
      if (args?.where?.category === "contradiction") {
        return Promise.resolve([
          {
            content: JSON.stringify({
              new_memory_id: "mem-1",
              old_memory_id: "mem-2",
              status: "unresolved",
            }),
          },
        ]);
      }
      return Promise.resolve([memoryRow(), memoryRow({ id: "mem-2", key: "belief_old", content: "Intensity beats consistency." })]);
    });

    const g = await getBrainGraph({ scope: "full" });

    const edge = g.edges.find((e) => e.type === "contradicts");
    expect(edge?.origin).toBe("contradiction");
    expect(g.contradictionCount).toBe(1);
    expect(g.nodes.find((n) => n.id === "mem-1")!.contradicted).toBe(true);
    expect(g.nodes.find((n) => n.id === "mem-2")!.contradicted).toBe(true);
  });

  it("ignores resolved contradictions", async () => {
    h.prisma.brainMemory.findMany.mockImplementation((args: { where?: { category?: unknown } }) => {
      if (args?.where?.category === "contradiction") {
        return Promise.resolve([
          { content: JSON.stringify({ new_memory_id: "mem-1", old_memory_id: "mem-2", status: "current_wins" }) },
        ]);
      }
      return Promise.resolve([memoryRow()]);
    });
    const g = await getBrainGraph({ scope: "full" });
    expect(g.edges.some((e) => e.type === "contradicts")).toBe(false);
    expect(g.contradictionCount).toBe(0);
  });
});
