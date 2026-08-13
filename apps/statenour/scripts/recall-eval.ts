/**
 * scripts/recall-eval.ts · 2026-08-13 · BDN-203
 *
 * The live-retriever runner lib/brain/recall-eval.ts:13 always claimed
 * existed — it did not (recorded gap: docs/RECONCILIATION.md:188).
 * This closes it AND answers the scan question it was built for:
 * does the LEXICAL lane (FTS, "grep-first") beat the VECTOR lane
 * (pgvector) on the recall corpus?
 *
 * Run (operator, from apps/statenour, DATABASE_URL required):
 *   pnpm eval:recall
 *
 * Read-only by construction: the two retrievers are semanticSearch
 * (no writes) and getLexicalMatches (SELECT only). Deliberately NOT
 * recallMemoriesForQuery — that path bumps lastSeen on every hit,
 * which would make the eval itself mutate recency signals.
 *
 * Corpus: SEED_CASES (synthetic) + eval-datasets/recall-corpus.json
 * when present (real cases via `pnpm harvest:evals`). Synthetic-only
 * runs are labeled as such — 9 synthetic cases prove the harness, not
 * the ranking. The hybrid pipeline (getContextualMemories) returns a
 * rendered prompt string, not keyed rows, so it is out of scope here;
 * this compares the two keyed lanes the hybrid composes.
 */

import { loadEnvConfig } from "@next/env";
import Module from "node:module";

loadEnvConfig(process.cwd());

// Same pattern as measure-prompt-size.ts — the recall stack imports
// "server-only", which throws under tsx; stub it for this CLI runner.
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

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  runRecallEval,
  SEED_CASES,
  type RecallEvalCase,
  type RecallEvalReport,
  type Retriever,
} from "../lib/brain/recall-eval";

const K = 5;

async function vectorRetriever(): Promise<Retriever> {
  const { semanticSearch } = await import("../lib/brain/embedding-utils");
  const { prisma } = await import("../lib/prisma");
  return async (query, k) => {
    const matches = await semanticSearch(query, k, ["brain_memory"]);
    if (matches.length === 0) return [];
    const rows = await prisma.brainMemory.findMany({
      where: { id: { in: matches.map((m) => m.sourceId) } },
      select: { id: true, key: true },
    });
    const keyById = new Map(rows.map((r) => [r.id, r.key]));
    return matches
      .map((m) => ({ key: keyById.get(m.sourceId) ?? "", score: m.hybridScore }))
      .filter((r) => r.key !== "");
  };
}

async function lexicalRetriever(): Promise<Retriever> {
  const { getLexicalMatches } = await import("../lib/brain/contextual-recall");
  return async (query, k) => {
    const rows = await getLexicalMatches([query], k);
    return rows.slice(0, k).map((r) => ({ key: r.key, score: r.rank }));
  };
}

function loadCorpus(): { cases: RecallEvalCase[]; syntheticOnly: boolean } {
  const cases: RecallEvalCase[] = [...SEED_CASES];
  const harvested = join(process.cwd(), "eval-datasets", "recall-corpus.json");
  if (existsSync(harvested)) {
    try {
      const real = JSON.parse(readFileSync(harvested, "utf8")) as { cases?: RecallEvalCase[] };
      if (Array.isArray(real.cases)) {
        cases.push(...real.cases);
        return { cases, syntheticOnly: false };
      }
    } catch (e) {
      console.warn(`could not parse ${harvested}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { cases, syntheticOnly: true };
}

function line(label: string, r: RecallEvalReport): string {
  return `${label.padEnd(9)} precision@${r.k}=${r.meanPrecisionAtK}  fullRecall=${r.fullRecallRate}  contradictionInjection=${r.contradictionInjectionRate}  abstentionClean=${r.abstentionCleanRate}  (n=${r.casesRun})`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required — this runner queries the live BrainMemory store (read-only).");
    process.exit(1);
  }
  const { cases, syntheticOnly } = loadCorpus();
  console.log(
    `recall-eval · ${cases.length} cases (${syntheticOnly ? "SYNTHETIC ONLY — run pnpm harvest:evals for real cases; this run proves the harness, not the ranking" : "seed + harvested"}) · k=${K}`,
  );

  const vector = await runRecallEval(cases, await vectorRetriever(), K);
  const lexical = await runRecallEval(cases, await lexicalRetriever(), K);

  console.log(line("vector", vector));
  console.log(line("lexical", lexical));

  const verdict =
    lexical.meanPrecisionAtK > vector.meanPrecisionAtK
      ? "lexical leads on this corpus"
      : lexical.meanPrecisionAtK < vector.meanPrecisionAtK
        ? "vector leads on this corpus"
        : "tied on this corpus";
  console.log(`verdict: ${verdict}${syntheticOnly ? " (synthetic corpus — not decision-grade)" : ""}`);

  const outDir = join(process.cwd(), "eval-datasets");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "recall-lane-comparison.json");
  writeFileSync(
    outPath,
    JSON.stringify({ ranAt: new Date().toISOString(), k: K, syntheticOnly, vector, lexical, verdict }, null, 2),
  );
  console.log(`artifact: ${outPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("recall-eval failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
