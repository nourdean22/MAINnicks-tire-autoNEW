/**
 * tests/brain/recall-eval-lanes.test.ts · 2026-10-16 (Brain W1, the arbiter; round 1 P2-9)
 *
 * scripts/recall-eval.ts runs main() at import and needs a DATABASE_URL, so
 * its lanes are pinned by a source scan; the mapping an arbiter lane feeds the
 * runner with is proven against the real runner with a stubbed retriever.
 * The corpus file is absent on this machine: nothing here measures ranking.
 *
 * PR #3088 fix round (Codex): the eval's retrievers also run for real through
 * loadDecls with every lane module stubbed, so the arbiter lane's per-mode
 * limits (CX-2), its symmetric INVALID marking (CX-4) and every lane's
 * sideEffects:false (CX-5) are pinned by behaviour, not by text.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runRecallEval, SEED_CASES } from "@/lib/brain/recall-eval";
import { buildEvidencePack, toRetrievedMemories, RECALL_MODE_LIMITS } from "@/lib/brain/evidence-pack";
import { loadDecls } from "../scripts/fixtures/script-decls";

const src = readFileSync(new URL("../../scripts/recall-eval.ts", import.meta.url), "utf8");

describe("recall-eval registers the memory-recall and arbiter lanes (W1)", () => {
  it("defines both lane builders and runs them beside vector / lexical / hybrid", () => {
    expect(src).toMatch(/async function memoryRecallRetriever\(\)/);
    expect(src).toMatch(/async function arbiterRetriever\(limits: /);
    expect(src).toMatch(/runRecallEval\(cases, await memoryRecallRetriever\(\), K\)/);
    expect(src).toMatch(/runRecallEval\(cases, await arbiterRetriever\(limits\), K\)/);
    expect(src).toMatch(/line\("memory-recall"/);
    expect(src).toMatch(/line\("arbiter"/);
  });

  it("the memory-recall lane runs read-only (no lastSeen bump) and the arbiter lane builds the real pack", () => {
    expect(src).toMatch(/recallMemoriesForQuery\(/);
    expect(src).toMatch(/sideEffects:\s*false/);
    expect(src).toMatch(/buildEvidencePackAsync\(/);
    expect(src).toMatch(/toRetrievedMemories\(/);
  });

  it("the INVALID / DEGRADED embedding banner covers all three embedding-gated lanes", () => {
    expect(src).toMatch(/knnBanner\("hybrid"/);
    expect(src).toMatch(/knnBanner\("memory-recall"/);
    expect(src).toMatch(/knnBanner\("arbiter"/);
    expect(src).toMatch(/INVALID/);
    expect(src).toMatch(/SYNTHETIC ONLY/);
  });

  it("a memory-recall ERROR / UNMEASURED provenance marks the lane INVALID instead of scoring 0 (P2-9a)", () => {
    expect(src).toMatch(/provenance === "ERROR" \|\| [a-zA-Z.]+provenance === "UNMEASURED"/);
    expect(src).toMatch(/memoryRecallInvalid/);
    expect(src).toMatch(/laneInvalidBanner\("memory-recall"/);
  });

  it("an arbiter lane missing either input lane is banner-marked INVALID (P2-9b, CX-4; behaviour pinned below)", () => {
    expect(src).toMatch(/arbiterInvalid/);
    expect(src).toMatch(/laneInvalidBanner\(\s*"arbiter",\s*arbiterInvalid\.cases/);
  });

  it("the arbiter lane's sizes come from the production table and land in the artifact with the mode (P2-9c, CX-2)", () => {
    expect(src).toMatch(/RECALL_MODE_LIMITS\[mode\]/);
    expect(src).toMatch(/arbiterConfig: \{ mode,/);
  });

  it("both new lanes land in the JSON artifact beside the existing three", () => {
    expect(src).toMatch(/vector, lexical, hybrid, memoryRecall, arbiter/);
  });
});

describe("an arbiter-shaped retriever feeds runRecallEval (stubbed, no DB)", () => {
  it("runs every seed case and scores the pack's keys", async () => {
    const pack = buildEvidencePack(
      [{ memoryId: "h1", key: SEED_CASES[0].relevantKeys?.[0] ?? "k", category: "x", source: "manual", content: "seed target" }],
      [],
    );
    const retriever = async () => toRetrievedMemories(pack.items);
    const report = await runRecallEval(SEED_CASES, retriever, 5);
    expect(report.casesRun).toBe(SEED_CASES.length);
    expect(report.k).toBe(5);
    expect(report.cases.every((c) => Array.isArray(c.retrievedKeys))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PR #3088 fix round · the eval's lane builders, run for real with stubbed modules
// ---------------------------------------------------------------------------

type Opts = Record<string, unknown> & { onRanked?: (rows: unknown[]) => void };
const ROW = { id: "c1", key: "k_c1", category: "x", source: "manual", relevance: "direct", content: "c" };

/** `ranked: null` = the contextual lane's onRanked never fires (timeout / empty pool). */
function harness(o: { ranked?: unknown[] | null; recall?: { hits: unknown[]; provenance: string } } = {}) {
  const calls = { contextual: [] as Array<{ limit: unknown; opts: Opts }>, recall: [] as Opts[], pack: [] as Opts[] };
  const modules: Record<string, unknown> = {
    "../lib/brain/contextual-recall": {
      getContextualMemories: async (_m: unknown, limit: unknown, opts: Opts) => {
        calls.contextual.push({ limit, opts });
        if (o.ranked !== null) opts.onRanked?.(o.ranked ?? [ROW]);
        return "";
      },
    },
    "../lib/brain/memory-recall": {
      recallMemoriesForQuery: async (_q: unknown, opts: Opts) => {
        calls.recall.push(opts);
        return o.recall ?? { hits: [{ memoryId: "h1", key: "k_h1", finalScore: 1 }], provenance: "OK" };
      },
    },
    "../lib/brain/evidence-pack": {
      buildEvidencePackAsync: async (_h: unknown, _r: unknown, opts: Opts) => {
        calls.pack.push(opts);
        return { items: [] };
      },
      toRetrievedMemories: () => [],
      RECALL_MODE_LIMITS,
    },
    "../lib/ai/provider": { getEmbedding: async () => [1, 0, 0] },
  };
  const req = (p: string) => {
    if (!(p in modules)) throw new Error(`unstubbed require: ${p}`);
    return modules[p];
  };
  const d = loadDecls(
    "scripts/recall-eval.ts",
    ["hybridKnn", "memoryRecallKnn", "arbiterKnn", "memoryRecallInvalid", "arbiterInvalid", "hybridRetriever", "memoryRecallRetriever", "arbiterRetriever", "evalMode"],
    { require: req },
  );
  return { d, calls };
}

describe("CX-2 · the arbiter lane mirrors one production chat mode", () => {
  it("the shared table holds brain-context's numbers (standard 5/5/10, deep 10/8/14)", () => {
    expect(RECALL_MODE_LIMITS).toEqual({
      standard: { contextual: 5, memoryRecall: 5, pack: 10 },
      deep: { contextual: 10, memoryRecall: 8, pack: 14 },
    });
  });

  it("brain-context reads the table, with no per-mode literals left at the three call sites", () => {
    const bc = readFileSync(new URL("../../lib/services/chat/brain-context.ts", import.meta.url), "utf8");
    expect(bc).toMatch(/RECALL_MODE_LIMITS\[/);
    expect(bc).toMatch(/recallLimits\.contextual/);
    expect(bc).toMatch(/limit: recallLimits\.memoryRecall/);
    expect(bc).toMatch(/limit: recallLimits\.pack/);
    expect(bc).not.toMatch(/mode === "deep" \? 10 : 5/);
    expect(bc).not.toMatch(/mode === "deep" \? 8 : 5/);
    expect(bc).not.toMatch(/mode === "deep" \? 14 : 10/);
  });

  it.each([
    ["standard", { contextual: 5, memoryRecall: 5, pack: 10 }],
    ["deep", { contextual: 10, memoryRecall: 8, pack: 14 }],
  ] as const)("%s: each lane and the pack get exactly the production sizes", async (mode, want) => {
    const { d, calls } = harness();
    await (await d.arbiterRetriever(RECALL_MODE_LIMITS[mode]))("q", 5);
    expect(calls.contextual[0].limit).toBe(want.contextual);
    expect(calls.recall[0].limit).toBe(want.memoryRecall);
    expect(calls.pack[0].limit).toBe(want.pack);
  });

  it("--mode parses standard (default), deep, --mode=deep; anything else throws", () => {
    const { d } = harness();
    expect(d.evalMode(["node", "x"])).toBe("standard");
    expect(d.evalMode(["node", "x", "--mode", "deep"])).toBe("deep");
    expect(d.evalMode(["node", "x", "--mode=deep"])).toBe("deep");
    expect(d.evalMode(["node", "x", "--mode", "standard"])).toBe("standard");
    expect(() => d.evalMode(["node", "x", "--mode", "fast"])).toThrow(/standard or deep/);
    expect(() => d.evalMode(["node", "x", "--mode"])).toThrow(/standard or deep/);
  });
});

describe("CX-4 · either input lane missing marks the arbiter case INVALID (symmetric)", () => {
  const run = async (o: Parameters<typeof harness>[0]) => {
    const { d } = harness(o);
    await (await d.arbiterRetriever(RECALL_MODE_LIMITS.standard))("q", 5);
    return d.arbiterInvalid;
  };
  it("CONTROL: both lanes ran -> nothing invalid", async () => {
    expect(await run({})).toEqual({ cases: 0, contextualMissing: 0, hybridMissing: 0 });
  });
  it("contextual onRanked never fired -> invalid, counted on the contextual side", async () => {
    expect(await run({ ranked: null })).toEqual({ cases: 1, contextualMissing: 1, hybridMissing: 0 });
  });
  it.each(["ERROR", "UNMEASURED"])("hybrid provenance %s with no hits -> invalid, counted on the hybrid side", async (provenance) => {
    expect(await run({ recall: { hits: [], provenance } })).toEqual({ cases: 1, contextualMissing: 0, hybridMissing: 1 });
  });
  it("hybrid measured ZERO is a real empty answer, not a missing lane", async () => {
    expect(await run({ recall: { hits: [], provenance: "ZERO" } })).toEqual({ cases: 0, contextualMissing: 0, hybridMissing: 0 });
  });
  it("both missing -> one invalid case, both sides counted", async () => {
    expect(await run({ ranked: null, recall: { hits: [], provenance: "ERROR" } })).toEqual({ cases: 1, contextualMissing: 1, hybridMissing: 1 });
  });
});

describe("CX-5 · every eval lane that can write runs with sideEffects:false", () => {
  it.each(["hybridRetriever", "memoryRecallRetriever", "arbiterRetriever"])("%s passes sideEffects:false to every recall call", async (name) => {
    const { d, calls } = harness();
    const build = d[name] as (l?: unknown) => Promise<(q: string, k: number) => Promise<unknown>>;
    await (await build(RECALL_MODE_LIMITS.standard))("q", 5);
    const seen = [...calls.contextual.map((c) => c.opts), ...calls.recall];
    expect(seen.length).toBeGreaterThan(0);
    for (const opts of seen) expect(opts.sideEffects).toBe(false);
  });
});
