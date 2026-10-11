/**
 * 05-X3 step 1: a forgotten memory must not render in the graph neighborhood.
 *
 * memory_edges have no foreign key, so an edge can still point at a
 * soft-deleted memory. The label read must skip deleted rows, and a memory or
 * reflection node whose read SUCCEEDED but found no live row is dropped with
 * its edges. A FAILED label read is not "deleted": those nodes stay, with the
 * placeholder label (unknown, never silently absent).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ edges: vi.fn(), memories: vi.fn(), reflections: vi.fn(), tasks: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    memoryEdge: { findMany: m.edges },
    brainMemory: { findMany: m.memories },
    reflection: { findMany: m.reflections },
    task: { findMany: m.tasks },
  },
}));

import { buildGraphNeighborhood } from "@/lib/services/brain-domain";

const MEMS = [
  { id: "m-gone", content: "SECRET forgotten text", category: "identity", deletedAt: new Date() },
  { id: "m-live", content: "Still believed", category: "identity", deletedAt: null },
];
const REFS = [
  { id: "r-gone", insight: "GONE reflection", date: "2026-09-01", deletedAt: new Date() },
  { id: "r-live", insight: "Live reflection", date: "2026-09-02", deletedAt: null },
];

const edge = (targetType: string, targetId: string) => ({
  sourceType: "task",
  sourceId: "t1",
  targetType,
  targetId,
  relationship: "relates_to",
  strength: 0.5,
  evidence: null,
});

/** A findMany fake that honours `where.deletedAt: null` the way Postgres would. */
function honouring<T extends { id: string; deletedAt: Date | null }>(rows: T[]) {
  return async ({ where }: { where: { id: { in: string[] }; deletedAt?: null } }) =>
    rows.filter((r) => where.id.in.includes(r.id) && (!("deletedAt" in where) || r.deletedAt === null));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.edges.mockResolvedValue([
    edge("memory", "m-gone"),
    edge("memory", "m-live"),
    edge("reflection", "r-gone"),
    edge("reflection", "r-live"),
  ]);
  m.memories.mockImplementation(honouring(MEMS));
  m.reflections.mockImplementation(honouring(REFS));
  m.tasks.mockResolvedValue([{ id: "t1", title: "Root task" }]);
});

describe("buildGraphNeighborhood / deleted rows", () => {
  it("a deleted memory or reflection is absent, its content in no label, its edge gone", async () => {
    const view = await buildGraphNeighborhood({ type: "task", id: "t1", depth: 1 });
    const ids = view.nodes.map((n) => n.id);
    expect(ids).toContain("m-live");
    expect(ids).toContain("r-live");
    expect(ids).not.toContain("m-gone");
    expect(ids).not.toContain("r-gone");
    expect(JSON.stringify(view)).not.toContain("SECRET");
    expect(JSON.stringify(view)).not.toContain("GONE");
    expect(view.edges.map((e) => e.target.id).sort()).toEqual(["m-live", "r-live"]);
  });

  it("CONTROL: a FAILED memory label read keeps the nodes with placeholder labels", async () => {
    m.memories.mockRejectedValue(new Error("db down"));
    const view = await buildGraphNeighborhood({ type: "task", id: "t1", depth: 1 });
    const ids = view.nodes.map((n) => n.id);
    expect(ids).toContain("m-gone");
    expect(ids).toContain("m-live");
    expect(view.nodes.find((n) => n.id === "m-live")!.label).toBe("memory:m-live");
  });
});
