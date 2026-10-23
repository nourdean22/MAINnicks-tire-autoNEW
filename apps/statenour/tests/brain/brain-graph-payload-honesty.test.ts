/**
 * tests/brain/brain-graph-payload-honesty.test.ts · 2026-09-02 self-audit.
 *
 * Sits beside tests/brain/brain-graph-truth.test.ts rather than under
 * tests/lib/brain/ so both suites for lib/brain/brain-graph.ts are in one
 * place; that older file established the location and the prisma harness
 * copied below.
 *
 * Two defects, each of which made the payload describe something other
 * than itself:
 *
 *  1. `limit` was declared, parsed by the route, forwarded, and never
 *     read: `?scope=full&limit=10` returned everything.
 *  2. Person nodes shipped without `ageDays`, which is the only field the
 *     client's LAST 30D lens matches on — a person added yesterday could
 *     never appear under "recent".
 *
 * Each block opens with a PLANTED POSITIVE so a vacuous pass (empty
 * payload, zero nodes, silently-skipped mock) cannot read as green.
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

const NOW = new Date("2026-09-02T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function memoryRow(over: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    category: "insight",
    key: "insight_domain_1712334",
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

function personRow(over: Record<string, unknown> = {}) {
  return {
    id: "person-1",
    name: "Moe",
    role: "supplier",
    trustScore: 0.7,
    relationship: "vendor",
    lastInteraction: daysAgo(2),
    createdAt: daysAgo(1),
    ...over,
  };
}

/** Every brainMemory read answers with the same memory list (the contradiction read is gone). */
function brainMemoryRouter(memories: unknown[]) {
  return () => Promise.resolve(memories);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const table of Object.values(h.prisma)) {
    table.findMany.mockReset();
    table.findMany.mockResolvedValue([]);
  }
});

describe("`limit` is a real cap, not an advertised no-op", () => {
  const manyMemories = Array.from({ length: 25 }, (_, i) =>
    memoryRow({ id: `mem-${i}`, key: `insight_${i}`, seenCount: i + 1 }),
  );

  it("PLANTED POSITIVE · without a limit the payload is larger than the cap under test", async () => {
    // If the unlimited payload were already <= 8 the cap assertion below
    // would pass without the cap doing anything.
    h.prisma.brainMemory.findMany.mockImplementation(brainMemoryRouter(manyMemories));
    const g = await getBrainGraph({ scope: "full" });
    expect(g.nodes.length).toBeGreaterThan(8);
  });

  it("honours ?limit= on the scope branch", async () => {
    h.prisma.brainMemory.findMany.mockImplementation(brainMemoryRouter(manyMemories));
    const g = await getBrainGraph({ scope: "full", limit: 8 });
    expect(
      g.nodes.length,
      "getBrainGraph declared `limit` and the route forwards it; ignoring it returns a full payload to a caller who asked for a small one",
    ).toBeLessThanOrEqual(8);
  });

  it("drops edges that lose an endpoint to the cap — never a dangling reference", async () => {
    h.prisma.brainMemory.findMany.mockImplementation(brainMemoryRouter(manyMemories));
    const g = await getBrainGraph({ scope: "full", limit: 8 });
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source), `edge source ${e.source} not in nodes`).toBe(true);
      expect(ids.has(e.target), `edge target ${e.target} not in nodes`).toBe(true);
    }
  });

  it("keeps the life-domain anchors rather than clipping them by weight", async () => {
    h.prisma.brainMemory.findMany.mockImplementation(brainMemoryRouter(manyMemories));
    const g = await getBrainGraph({ scope: "full", limit: 8 });
    // The anchors are the map's skeleton; dropping one strands the domain
    // edges that point at it.
    expect(g.nodes.some((n) => n.id === "nour-os")).toBe(true);
  });

  it("ignores junk limits instead of returning an empty graph", async () => {
    h.prisma.brainMemory.findMany.mockImplementation(brainMemoryRouter(manyMemories));
    for (const bad of [0, -5, Number.NaN]) {
      const g = await getBrainGraph({ scope: "full", limit: bad });
      expect(g.nodes.length, `limit=${bad} should mean "no cap"`).toBeGreaterThan(8);
    }
  });
});

describe("person nodes carry the field the LAST 30D lens reads", () => {
  it("PLANTED POSITIVE · the person node is in the payload at all", async () => {
    h.prisma.personProfile.findMany.mockResolvedValue([personRow()]);
    const g = await getBrainGraph({ scope: "full" });
    expect(g.nodes.some((n) => n.id === "person-1")).toBe(true);
  });

  it("sets ageDays, so a person added yesterday can match LAST 30D", async () => {
    h.prisma.personProfile.findMany.mockResolvedValue([personRow({ createdAt: daysAgo(1) })]);
    const g = await getBrainGraph({ scope: "full" });
    const person = g.nodes.find((n) => n.id === "person-1")!;

    // This IS the client predicate, copied from the LAST 30D lens in
    // components/home/home-brain-graph.tsx — asserting the behaviour the
    // operator sees rather than the presence of a field.
    const matchesRecentLens = typeof person.ageDays === "number" && person.ageDays <= 30;
    expect(
      matchesRecentLens,
      "a person created yesterday must match LAST 30D; without ageDays the lens excluded every person node",
    ).toBe(true);
  });

  it("a person row with NO timestamp degrades to unknown age, never crashing the build", async () => {
    // Regression found by tests/brain/brain-graph-truth.test.ts while this
    // change was being written: its person fixture carries no `createdAt`,
    // and the first version of this mapper called `.getTime()` on it. Rows
    // reach the mappers as Record<string, any>, and an exception inside one
    // escapes getBrainGraph and takes the WHOLE brain down — the exact
    // failure class contract #1 of this file exists to prevent.
    h.prisma.personProfile.findMany.mockResolvedValue([
      { id: "person-1", name: "Sam", role: "supplier", trustScore: 0.6, relationship: null, lastInteraction: null },
    ]);

    const g = await getBrainGraph({ scope: "full" });

    const person = g.nodes.find((n) => n.id === "person-1");
    expect(person, "the node must still be built").toBeDefined();
    // Unknown, NOT zero — a missing timestamp must not read as "today".
    expect(person!.ageDays).toBeUndefined();
    expect(person!.isNew).toBeUndefined();
  });

  it("an old person does NOT match — the field is read, not rubber-stamped", async () => {
    h.prisma.personProfile.findMany.mockResolvedValue([personRow({ createdAt: daysAgo(400) })]);
    const g = await getBrainGraph({ scope: "full" });
    const person = g.nodes.find((n) => n.id === "person-1")!;
    expect(typeof person.ageDays === "number" && person.ageDays <= 30).toBe(false);
  });
});
