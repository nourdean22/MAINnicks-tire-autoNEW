/**
 * W1 follow-up (Codex review on PR 3357):
 * 1. metadata.origin outranks the key prefix (resolveWisdomOrigin's own rule), so a
 *    wisdom_jobs_* row stamped origin "satori" must not render as Jobs.
 * 2. The no-topics/no-embedding fallback selected no key, so every pack row there
 *    rendered as "you stated" and could never be cited.
 * 3. Gracián (PR 3356) is a curated author.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], selects: [] as unknown[] }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      // Return only the selected fields, so a missing `select` key is visible.
      findMany: vi.fn(async (args: { select?: Record<string, boolean>; where?: { id?: { in: string[] } } }) => {
        h.selects.push(args.select);
        const pool = args.where?.id?.in ? h.rows.filter((r) => args.where!.id!.in.includes(r.id as string)) : h.rows;
        if (!args.select) return pool;
        return pool.map((r) => Object.fromEntries(Object.keys(args.select!).filter((k) => args.select![k]).map((k) => [k, r[k]])));
      }),
    },
  },
}));

import { provenancePrefix, attachWisdomOrigins, getContextualMemories } from "@/lib/brain/contextual-recall";

const mem = (over: Record<string, unknown>) => ({
  category: "wisdom",
  key: "wisdom_x",
  content: "x",
  confidence: 1,
  relevance: "background" as const,
  source: "manual",
  seenCount: 1,
  ...over,
});

beforeEach(() => {
  h.rows = [];
  h.selects = [];
});

describe("metadata.origin wins over the key prefix", () => {
  it("a wisdom_jobs_* row stamped origin satori renders as Satori", () => {
    const p = provenancePrefix(mem({ key: "wisdom_jobs_1", origin: "satori" }));
    expect(p).toContain("Satori");
    expect(p).not.toContain("Jobs");
  });

  it("attachWisdomOrigins reads metadata.origin for the wisdom rows only", async () => {
    h.rows = [{ id: "w1", metadata: { origin: "satori" } }];
    const rows = [mem({ id: "w1", key: "wisdom_jobs_1" }), mem({ id: "i1", category: "insight" })];
    await attachWisdomOrigins(rows);
    expect(rows[0]).toMatchObject({ origin: "satori" });
    expect(rows[1]).not.toHaveProperty("origin");
  });

  it("a failed origin lookup leaves the key prefix in charge (no throw, no invented author)", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.brainMemory.findMany).mockRejectedValueOnce(new Error("db down"));
    const rows = [mem({ id: "w1", key: "wisdom_naval-ravikant_001" })];
    // no throw; false tells the per-turn log the read failed (W2 hardening)
    await expect(attachWisdomOrigins(rows)).resolves.toBe(false);
    expect(provenancePrefix(rows[0])).toContain("Naval");
  });
});

describe("Gracián is a curated author", () => {
  it("wisdom_baltasar-gracian_007 renders Gracián, curated", () => {
    const p = provenancePrefix(mem({ key: "wisdom_baltasar-gracian_007" }));
    expect(p).toContain("Gracián");
    expect(p).toContain("curated");
  });
});

describe("the confidence fallback names curated authors too", () => {
  it("selects the key and renders the author", async () => {
    h.rows = [
      { id: "w1", category: "wisdom", key: "wisdom_charlie-munger_022", content: "Invert, always invert.", confidence: 1, source: "manual", seenCount: 1, metadata: null },
    ];
    // No topics and no embedding is the fallback trigger.
    const out = await getContextualMemories([""], 5, {});
    expect(out).toContain("Munger");
    expect(out).not.toContain("you stated");
  });
});
