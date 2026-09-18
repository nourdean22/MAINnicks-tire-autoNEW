/**
 * scripts/rrf-weight-sweep.ts — 2026-09-18.
 *
 * docs/RETRIEVAL-BASELINE-2026-08-27.md deferred weighted fusion with an
 * explicit gate: "stay on RRF k=60 until >=50 labelled pairs exist. The corpus
 * is 28 cases; grow it via `pnpm harvest:evals` + real misses before tuning
 * weights." PR #2443 took the corpus to 68 labelled positive pairs, so the gate
 * is cleared and the question is now answerable instead of speculative.
 *
 * ⚠ WEIGHTED FUSION IS ALREADY BUILT. lib/brain/rrf.ts takes `opts.weights`
 * (`const w = weights?.[laneIdx] ?? 1`). Nothing here implements fusion — the
 * only thing missing was ever MEASURING which weights are right. This is a
 * measurement script, not a feature.
 *
 * DESIGN: ONE retrieval pass, many weightings.
 * Retrieval is the expensive, connection-hungry part (three full eval runs died
 * on Neon connection exhaustion tonight). So each case is retrieved ONCE per
 * lane, the ranked key lists are held in memory, and the entire weight grid is
 * then fused OFFLINE. Sweeping N weights costs the same database work as N=1.
 *
 * Read-only: semanticSearch and getLexicalMatches are both SELECT-only.
 *
 * Usage (from apps/statenour):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/rrf-weight-sweep.ts
 */
import { loadEnvConfig } from "@next/env";
import Module from "node:module";

loadEnvConfig(process.cwd());

// The `server-only` tripwire throws under plain tsx. Same stub as
// scripts/recall-eval.ts — and it only protects DYNAMIC imports, because ESM
// hoists static ones above this block.
{
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Case {
  id: string;
  query: string;
  relevantKeys?: string[];
}

/** Weight pairs to sweep: [vector, lexical]. 1:1 is the incumbent. */
const GRID: Array<[number, number]> = [
  [1, 0], // vector only — the control that says whether lexical adds anything at all
  [3, 1],
  [2, 1],
  [1.5, 1],
  [1, 1], // INCUMBENT
  [1, 1.5],
  [1, 2],
  [0, 1], // lexical only — the other control
];

const K = 5;

function loadCorpus(): Case[] {
  const p = join(process.cwd(), "eval-datasets", "recall-corpus.json");
  if (!existsSync(p)) throw new Error(`corpus missing at ${p} — run pnpm harvest:evals --paraphrase`);
  const parsed = JSON.parse(readFileSync(p, "utf8")) as { cases?: Case[] };
  return (parsed.cases ?? []).filter((c) => (c.relevantKeys?.length ?? 0) > 0);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required — run under `railway run -s statenour-web --`");
    process.exit(1);
  }

  const { semanticSearch } = await import("../lib/brain/embedding-utils");
  const { getLexicalMatches } = await import("../lib/brain/contextual-recall");
  const { reciprocalRankFusion } = await import("../lib/brain/rrf");
  const { precisionAtK } = await import("../lib/brain/recall-eval");
  const { prisma } = await import("../lib/prisma");

  const cases = loadCorpus();
  console.log(`rrf-weight-sweep · ${cases.length} labelled positive cases · k=${K}`);
  console.log("");

  // ── ONE retrieval pass per lane, cached in memory ───────────────────────
  const perCase: Array<{ id: string; relevant: string[]; vector: string[]; lexical: string[] }> = [];
  let lexicalEmptyOrSkipped = 0;

  for (const c of cases) {
    // vector lane — resolve embedding matches back to brain_memories keys
    const matches = await semanticSearch(c.query, 25, ["brain_memory"]);
    let vector: string[] = [];
    if (matches.length > 0) {
      const rows = await prisma.brainMemory.findMany({
        where: { id: { in: matches.map((m) => m.sourceId) } },
        select: { id: true, key: true },
      });
      const keyById = new Map(rows.map((r) => [r.id, r.key]));
      vector = matches.map((m) => keyById.get(m.sourceId) ?? "").filter(Boolean);
    }

    const lexRows = await getLexicalMatches([c.query], 25);
    const lexical = lexRows.map((r) => r.key).filter(Boolean);
    if (lexical.length === 0) lexicalEmptyOrSkipped++;

    perCase.push({ id: c.id, relevant: c.relevantKeys ?? [], vector, lexical });
  }

  console.log(
    `retrieved: ${perCase.length} cases · lexical returned nothing on ${lexicalEmptyOrSkipped}` +
      ` (empty OR the 900ms lane skip — getLexicalMatches cannot distinguish them)`,
  );
  console.log("");

  // ── Fuse offline at every weight ────────────────────────────────────────
  const rank = (keys: string[]) => keys.map((k) => ({ id: k, item: k }));

  console.log("  vecW  lexW   precision@5   vs incumbent");
  console.log("  ----  ----   -----------   ------------");

  let incumbent = 0;
  const results: Array<{ w: [number, number]; p: number }> = [];

  for (const [vw, lw] of GRID) {
    let sum = 0;
    for (const pc of perCase) {
      const fused = reciprocalRankFusion([rank(pc.vector), rank(pc.lexical)], {
        k: 60,
        weights: [vw, lw],
      });
      sum += precisionAtK(fused.map((f) => f.id), pc.relevant, K);
    }
    const p = sum / perCase.length;
    results.push({ w: [vw, lw], p });
    if (vw === 1 && lw === 1) incumbent = p;
  }

  for (const r of results) {
    const delta = r.p - incumbent;
    const mark = r.w[0] === 1 && r.w[1] === 1 ? "  <- INCUMBENT" : "";
    const sign = delta > 0 ? "+" : "";
    console.log(
      `  ${String(r.w[0]).padStart(4)}  ${String(r.w[1]).padStart(4)}   ` +
        `${r.p.toFixed(4).padStart(11)}   ${(sign + delta.toFixed(4)).padStart(12)}${mark}`,
    );
  }

  const best = [...results].sort((a, b) => b.p - a.p)[0];
  console.log("");
  const gain = best.p - incumbent;
  if (best.w[0] === 1 && best.w[1] === 1) {
    console.log("VERDICT: the incumbent 1:1 is already best on this corpus. Do not tune.");
  } else if (gain < 0.01) {
    console.log(
      `VERDICT: best is ${best.w[0]}:${best.w[1]} at +${gain.toFixed(4)} — BELOW a 1-point` +
        ` threshold on n=${perCase.length}. Not a mandate to change anything.`,
    );
  } else {
    console.log(
      `VERDICT: ${best.w[0]}:${best.w[1]} beats the incumbent by ${gain.toFixed(4)}` +
        ` on n=${perCase.length}. Still ONE corpus and ONE run — confirm before shipping.`,
    );
  }
  console.log("");
  console.log(
    "⚠ Single corpus, single run, no holdout. This says which weight fits THESE 68 cases," +
      " not which generalises. A weight chosen on the same data it was measured on is fitted, not validated.",
  );

  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
