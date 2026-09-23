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
import { createHash } from "node:crypto";
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

/**
 * Wave 0 (2026-09-08) · the FULL chat pipeline as a third lane, scored through the
 * onRanked observer — the number that actually decides whether a memory influences
 * an answer. Fast topics, no LLM, the same opts the chat route passes.
 */
/**
 * Counts how many hybrid queries actually got a query embedding. Read after the
 * run — see the banner in main(). A zero here invalidates the hybrid number.
 */
const hybridKnn = { withEmbedding: 0, withoutEmbedding: 0 };

async function hybridRetriever(): Promise<Retriever> {
  const { getContextualMemories } = await import("../lib/brain/contextual-recall");
  const { getEmbedding } = await import("../lib/ai/provider");
  return async (query, k) => {
    // ⚠⚠ THE HYBRID'S KNN POOL IS GATED ON queryEmbedding — MEASURED 2026-09-18.
    //
    // contextual-recall.ts:900-908:
    //     const knnRows = opts.queryEmbedding && opts.queryEmbedding.length > 0
    //       ? await getKnnPoolRows(...)
    //       : [];
    // with the comment "Only when the caller supplied the query embedding (the
    // chat hot path) — other callers keep today's pool shape."
    //
    // This runner omitted it, so the hybrid lane ran with ZERO true-KNN
    // candidates while the `vector` lane beside it was fully configured. The
    // resulting print — vector 0.368 vs hybrid 0.053, with hybrid ~= lexical
    // 0.066 — reads as "production recall is 7x worse than its own vector
    // component". That conclusion was an artifact of THIS FILE, not a finding
    // about production, and it was nearly published.
    //
    // Production (lib/services/chat/brain-context.ts:396) passes
    // `queryEmbedding: userEmbedding`. Matching it is the only way this lane
    // measures the pipeline the operator actually runs.
    const queryEmbedding = await getEmbedding(query).catch((): number[] => []);
    if (queryEmbedding.length > 0) hybridKnn.withEmbedding++;
    else hybridKnn.withoutEmbedding++;

    let ranked: { key: string }[] = [];
    await getContextualMemories([query], Math.max(k, 10), {
      fastTopics: true,
      queryEmbedding: queryEmbedding.length > 0 ? queryEmbedding : undefined,
      onRanked: (rows) => {
        ranked = rows;
      },
    });
    return ranked.slice(0, k).map((r, i) => ({ key: r.key, score: 1 / (i + 1) }));
  };
}

function corpusFingerprint(cases: RecallEvalCase[]): { count: number; sha256: string } {
  const h = createHash("sha256");
  for (const c of [...cases].sort((a, b) => a.query.localeCompare(b.query))) h.update(JSON.stringify(c));
  return { count: cases.length, sha256: h.digest("hex") };
}

/** Wave 0 · the labelled corpus is gitignored (real operator queries); its fingerprint is not. */
function checkManifest(cases: RecallEvalCase[]): void {
  const path = join(process.cwd(), "data", "recall-corpus.manifest.json");
  const fp = corpusFingerprint(cases);
  if (process.argv.includes("--write-manifest")) {
    writeFileSync(path, JSON.stringify({ frozenAt: new Date().toISOString().slice(0, 10), ...fp }, null, 2) + "\n");
    console.log(`manifest written: ${fp.count} cases, sha256 ${fp.sha256.slice(0, 12)}`);
    return;
  }
  if (!existsSync(path)) { console.log(`corpus manifest absent (${fp.count} cases, sha256 ${fp.sha256.slice(0, 12)}) — run with --write-manifest to freeze it`); return; }
  const want = JSON.parse(readFileSync(path, "utf8")) as { count: number; sha256: string; frozenAt: string };
  if (want.sha256 === fp.sha256) console.log(`corpus frozen ✓ (${fp.count} cases, ${want.frozenAt})`);
  else console.log(`corpus CHANGED vs manifest (${want.frozenAt}: ${want.count} cases → now ${fp.count}) — numbers are not comparable to the baseline`);
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
  checkManifest(cases);

  // ── SEALED EVALUATION BOUNDARY ────────────────────────────────────────────
  // Until 2026-09-18 every case was scored on every run, so any weight, prompt
  // or ranking change could be tuned against the same corpus used to report the
  // result. A number measured on the data it was fitted to is not a measurement.
  //
  // The visible corpus is now split development / regression; the SEALED tier
  // lives outside every checkout (see recall-corpus-tiers.sealedCorpusPath) and
  // is loaded only if present. Absent, it prints UNMEASURED — never a pass.
  const { splitByTier, sealedCorpusPath, describeSealed } = await import(
    "../lib/brain/recall-corpus-tiers"
  );
  const tiers = splitByTier(cases);
  console.log(
    `tiers · development=${tiers.development.length} regression=${tiers.regression.length}` +
      ` sealed-in-visible-corpus=${tiers.sealed.length}`,
  );
  if (tiers.sealed.length > 0) {
    console.log(
      `  ⚠ ${tiers.sealed.length} sealed-tier cases are still IN the visible corpus at` +
        ` eval-datasets/recall-corpus.json — the boundary is DECLARED, not yet ENFORCED.` +
        ` Move them to ${sealedCorpusPath()} to seal them.`,
    );
  }
  console.log(
    `recall-eval · ${cases.length} cases (${syntheticOnly ? "SYNTHETIC ONLY — run pnpm harvest:evals for real cases; this run proves the harness, not the ranking" : "seed + harvested"}) · k=${K}`,
  );

  const vector = await runRecallEval(cases, await vectorRetriever(), K);
  const lexical = await runRecallEval(cases, await lexicalRetriever(), K);
  const hybrid = await runRecallEval(cases, await hybridRetriever(), K);

  console.log(line("vector", vector));
  console.log(line("lexical", lexical));
  console.log(line("hybrid", hybrid));

  // ⚠ THE HYBRID LANE'S CONFIGURATION IS PART OF ITS NUMBER, SO IT IS PRINTED
  // BESIDE IT. Without this, a hybrid running with an empty KNN pool prints a
  // plausible-looking score next to a fully-configured vector lane and invites
  // exactly one wrong conclusion. Never let the degraded case be silent — the
  // same rule nickstire's holdout applies by reporting UNMEASURED rather than
  // treating an absent evaluator as a pass.
  const knnTotal = hybridKnn.withEmbedding + hybridKnn.withoutEmbedding;
  if (knnTotal === 0) {
    console.log("hybrid    (lane did not run)");
  } else if (hybridKnn.withEmbedding === 0) {
    console.log(
      `hybrid    !! INVALID — 0 of ${knnTotal} queries got a query embedding, so the true-KNN pool\n` +
        "          was EMPTY on every case (contextual-recall.ts gates it on queryEmbedding).\n" +
        "          This is NOT production recall. Do not compare it to the vector lane.",
    );
  } else if (hybridKnn.withoutEmbedding > 0) {
    console.log(
      `hybrid    !! DEGRADED — ${hybridKnn.withoutEmbedding} of ${knnTotal} queries ran with NO KNN pool;\n` +
        "          the score is a blend of two different pipelines.",
    );
  } else {
    console.log(
      `hybrid    knn pool ACTIVE on all ${knnTotal} queries (matches the chat hot path).`,
    );
  }

  // ★★★ REFUSE A VERDICT THE CORPUS CANNOT SUPPORT.
  //
  // Measured 2026-09-18: this line printed "lexical leads on this corpus" off a
  // run whose positive cases were ECHO cases — the query was a verbatim slice of
  // the very memory it was meant to find. Lexical matches its own input
  // trivially, so it "led" by construction. The same run also mixed in synthetic
  // seeds whose targets do not exist in this brain (0 for every lane) and
  // abstention cases with no targets at all (precision is 0 BY ARITHMETIC).
  //
  // Three incompatible case types averaged into one number, under a confident
  // one-line verdict. A benchmark that always prints a winner will eventually be
  // believed, and that is worse than one that prints nothing.
  //
  // A case earns its place in the precision denominator only if it has a target
  // AND its query was rewritten away from the source text (`--paraphrase`).
  const positives = cases.filter((c) => (c.relevantKeys?.length ?? 0) > 0);
  const paraphrased = positives.filter((c) => /paraphrased by model/.test(c.provenance ?? ""));
  const echoOnly = positives.length > 0 && paraphrased.length === 0;

  const verdict = echoOnly
    ? "NO VERDICT — positive cases are ECHO (query is a slice of its own target). " +
      "Lexical wins these by construction. Re-harvest with --paraphrase."
    : positives.length === 0
      ? "NO VERDICT — corpus has no positive cases; precision is 0 by arithmetic, not by retrieval."
      : lexical.meanPrecisionAtK > vector.meanPrecisionAtK
        ? "lexical leads on this corpus"
        : lexical.meanPrecisionAtK < vector.meanPrecisionAtK
          ? "vector leads on this corpus"
          : "tied on this corpus";

  console.log(
    `corpus: ${positives.length} positive (${paraphrased.length} paraphrased) · ${cases.length - positives.length} abstention`,
  );
  console.log(`verdict: ${verdict}${syntheticOnly ? " (synthetic corpus — not decision-grade)" : ""}`);
  if (echoOnly || positives.length === 0) {
    console.log(
      "note: abstentionClean + contradictionInjection above ARE interpretable — they need no targets.",
    );
  }

  const outDir = join(process.cwd(), "eval-datasets");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "recall-lane-comparison.json");
  writeFileSync(
    outPath,
    JSON.stringify({ ranAt: new Date().toISOString(), k: K, syntheticOnly, corpus: corpusFingerprint(cases), vector, lexical, hybrid, verdict }, null, 2),
  );
  console.log(`artifact: ${outPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("recall-eval failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
