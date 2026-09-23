/**
 * tests/brain/recall-stage-concurrency.test.ts · 2026-09-23
 *
 * WHY THIS EXISTS. brain-context races getContextualMemories at 3 s
 * (withTimeout(…, 3000, null)) and the pipeline ran every stage one after
 * another. Measured on production 2026-09-23 (the operator's chat turns,
 * [brain-recall] log + the persisted contextReceipt): five recalls took
 * 5,663 / 4,035 / 3,565 / 2,997 / 4,230 ms, and the "Context Memories" block
 * reached the prompt on exactly one of them - the 2,997 ms one. Receipts since
 * 09-18: the block landed on 4 of 89 chat turns.
 *
 * The stages do not all depend on each other:
 *   dbFetch · lexical · knnPool   need only topics / the query embedding
 *   crossSource · related         need only queryText / topics
 *   semantic → rerank → graph     need the candidate pool, in that order
 * so the pipeline now runs in two phases: phase A reads the three candidate
 * lanes concurrently; phase B starts crossSource + related the moment phase A
 * lands and overlaps them with semantic → rerank → graph. Phase A holds 3
 * reads at once and phase B peaks at 4 (graph's two neighbour lookups beside
 * crossSource and related), not the 5 a start-everything-at-once version
 * would put in flight - the Neon adapter pool is max 10 and is shared with
 * every other brain-context block (lib/prisma.ts).
 *
 * The assertions are about ORDER OF STARTS, driven by deferred promises, not
 * about wall-clock timing - a timing assertion would be flaky on CI runners
 * and would prove nothing about which call waited for which.
 *
 * Positive control (recorded when this file was written): against the
 * sequential pipeline the two "starts before" cases fail - dbFetch is the only
 * started read while it is pending, and crossSource / related have not started
 * while semantic is pending. The order and rejection cases pass on both
 * versions: they guard that the change is invisible in the output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };

const h = vi.hoisted(() => {
  function deferred<T>(): Deferred<T> {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  return {
    deferred,
    events: [] as string[],
    memFetch: null as Deferred<unknown[]> | null,
    vecFetch: null as Deferred<unknown[]> | null,
    people: [] as unknown[],
  };
});

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  });
  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRawUnsafe: vi.fn((sql: string) => {
      h.events.push(sql.includes("websearch_to_tsquery") ? "start:lexical" : "start:knn");
      return Promise.resolve([]);
    }),
  };
  const brainMemory = {
    findMany: vi.fn((args: { take?: number; where?: { id?: { in?: string[] } } }) => {
      if (args?.take === 300) {
        h.events.push("start:dbFetch");
        return h.memFetch!.promise;
      }
      // appendGraphContext's neighbour lookup
      if (args?.where?.id?.in?.includes("g1")) {
        return Promise.resolve([{ id: "g1", category: "insight", content: "graph neighbour memory" }]);
      }
      return Promise.resolve([]);
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const vectorEmbedding = {
    findMany: vi.fn(() => {
      h.events.push("start:semantic");
      return h.vecFetch!.promise;
    }),
  };
  const commitment = {
    findMany: vi.fn(() => {
      h.events.push("start:related");
      return Promise.resolve([{ description: "call the tire supplier about the invoice", deadline: null }]);
    }),
  };
  const personProfile = { findMany: vi.fn(() => Promise.resolve(h.people)) };
  const named: Record<string, unknown> = { brainMemory, vectorEmbedding, commitment, personProfile };
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop in named) return named[prop];
        if (prop === "$transaction") return (fn: (t: typeof tx) => unknown) => fn(tx);
        if (prop === "$queryRawUnsafe" || prop === "$queryRaw") return () => Promise.resolve([]);
        if (prop === "$executeRawUnsafe") return () => Promise.resolve(0);
        return generic();
      },
    },
  );
  return { prisma };
});

vi.mock("@/lib/brain/embedding-utils", () => ({
  cosineSimilarity: (a: number[], b: number[]) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  },
  semanticSearch: vi.fn(() => {
    h.events.push("start:crossSource");
    return Promise.resolve([
      { sourceType: "strategic_law", sourceId: "law-1", content: "Never outshine the master", similarity: 0.8 },
    ]);
  }),
}));

vi.mock("@/lib/brain/relational-graph", () => ({
  getConnections: vi.fn(() => Promise.resolve([{ type: "memory", id: "g1", relationship: "supports", strength: 0.9 }])),
}));

vi.mock("@/lib/brain/rerank", () => ({ rerank: vi.fn(), isRerankAvailable: () => false }));

import { getContextualMemories } from "@/lib/brain/contextual-recall";

const EMBED = [0.9, 0.1, 0.2, 0.3];
const MEMORIES = Array.from({ length: 8 }, (_, i) => ({
  id: `m${i}`,
  category: i === 0 ? "wisdom" : "insight",
  key: `k${i}`,
  content: `memory ${i} about the tire supplier invoice and follow up ${i}`,
  confidence: 0.9 - i * 0.05,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  source: "manual",
  seenCount: 2,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
}));
const VECTORS = MEMORIES.map((m, i) => ({
  sourceId: m.id,
  embedding: JSON.stringify([0.9 - i * 0.05, 0.1, 0.2, 0.3]),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));
const run = () =>
  getContextualMemories(["what did the tire supplier say about the invoice"], 5, {
    fastTopics: true,
    queryEmbedding: EMBED,
  });

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.events.length = 0;
  h.people = [];
  h.memFetch = h.deferred<unknown[]>();
  h.vecFetch = h.deferred<unknown[]>();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  // Restore ONLY the console spies: vi.restoreAllMocks() also wipes the
  // factory mocks' resolved values (updateMany then returns undefined and the
  // wisdom-citation `.catch` throws), which broke every case after the first.
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("contextual recall · independent stages start together (2026-09-23)", () => {
  it("POSITIVE CONTROL: the harness reaches the main pipeline, not the fallback", async () => {
    const p = run();
    await flush();
    expect(h.events).toContain("start:dbFetch");
    h.memFetch!.resolve(MEMORIES);
    await flush();
    h.vecFetch!.resolve(VECTORS);
    const out = await p;
    expect(out).toContain("Context-Matched Memories [semantic]");
  });

  it("★ lexical and knnPool start while dbFetch is still pending (phase A)", async () => {
    const p = run();
    await flush();
    // dbFetch has NOT resolved yet. On the sequential pipeline only dbFetch has
    // started here; the lanes waited for it.
    expect(h.events).toEqual(expect.arrayContaining(["start:dbFetch", "start:lexical", "start:knn"]));
    h.memFetch!.resolve(MEMORIES);
    await flush();
    h.vecFetch!.resolve(VECTORS);
    await p;
  });

  it("★ crossSource and related start while semantic is still pending (phase B)", async () => {
    const p = run();
    await flush();
    h.memFetch!.resolve(MEMORIES);
    await flush();
    // semantic's vector read has started and NOT resolved. On the sequential
    // pipeline crossSource and related ran only after semantic → rerank → graph.
    expect(h.events).toContain("start:semantic");
    expect(h.events).toEqual(expect.arrayContaining(["start:crossSource", "start:related"]));
    h.vecFetch!.resolve(VECTORS);
    await p;
  });

  it("phase B never starts before phase A lands (only phase A's three reads are in flight until then)", async () => {
    const p = run();
    await flush();
    expect(h.events).not.toContain("start:crossSource");
    expect(h.events).not.toContain("start:related");
    h.memFetch!.resolve(MEMORIES);
    await flush();
    h.vecFetch!.resolve(VECTORS);
    await p;
  });

  it("the rendered block keeps its section order: memories, graph, deeper context, related", async () => {
    const p = run();
    await flush();
    h.memFetch!.resolve(MEMORIES);
    await flush();
    h.vecFetch!.resolve(VECTORS);
    const out = await p;
    const at = (s: string) => out.indexOf(s);
    expect(at("Context-Matched Memories")).toBeGreaterThanOrEqual(0);
    expect(at("### Connected (linked in your brain graph)")).toBeGreaterThan(at("Context-Matched Memories"));
    expect(at("### Deeper Context")).toBeGreaterThan(at("### Connected (linked in your brain graph)"));
    expect(at("### Related Commitments")).toBeGreaterThan(at("### Deeper Context"));
    // The log counts what was rendered, not what was fetched.
    const recallLog = logSpy.mock.calls.find((c) => c[0] === "[brain-recall]")?.[1] as
      | { outcome: string; crossSourceLines: number; relatedLines: number }
      | undefined;
    expect(recallLog?.outcome).toBe("ok");
    expect(recallLog?.crossSourceLines).toBe(2); // "### Deeper Context" + one law
    expect(recallLog?.relatedLines).toBe(2); // "### Related Commitments" + one commitment
  });

  it("an error in the related stage still surfaces, and never as an unhandled rejection", async () => {
    // relationship: null makes appendRelatedContext throw inside its filter
    // (the per-query .catch() does not cover it). Started early, that
    // rejection lands while semantic is pending - with no handler attached it
    // would be an unhandledRejection, which crashes a Node process.
    h.people = [{ name: "Zed", role: "vendor", relationship: null }];
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const p = run();
      const settled = p.then(
        () => "resolved",
        (e: unknown) => e,
      );
      await flush();
      h.memFetch!.resolve(MEMORIES);
      await flush();
      await flush();
      h.vecFetch!.resolve(VECTORS);
      const outcome = await settled;
      expect(outcome).toBeInstanceOf(TypeError);
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
