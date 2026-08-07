/**
 * Readout over eval-datasets/ig-retro-dual-judge.jsonl (2026-08-07).
 *
 * The corpus exists to answer two questions, and this is its reader — a
 * dataset nothing reads is the failure mode this whole arc keeps rediscovering.
 *
 *   Q1 COLLUSION. Prod runs one model for everything (AI_FORCE_OLLAMA=true,
 *      OLLAMA_MODEL unset), so the igAutopost generator and the judge that
 *      gates it were the same family. Does a same-family judge score its own
 *      family's output HIGHER than an independent family does? The paired gap
 *      and its sign test answer that.
 *
 *   Q2 HELD-OUT JUDGE VIABILITY. The anti-collusion design gates the holdout
 *      on a different family. That only works if the two families AGREE on the
 *      gate decision more often than they disagree. If inter-judge disagreement
 *      is as large as judge-vs-self disagreement, a held-out judge is noise
 *      and option 2 is dead.
 *
 * Read-only. No DB, no LLM, no writes.
 *   pnpm exec tsx scripts/ig-dual-judge-readout.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(process.cwd(), "eval-datasets/ig-retro-dual-judge.jsonl");

interface Verdict { model: string; total: number; rejected: boolean; note: string }
interface Rec {
  id: number; conceptKey: string; archetype: string; createdAt: string;
  selfOverall: number | null; hasImageUrl: boolean; prod: Verdict; diverse: Verdict;
}

/** The live gate predicate, verbatim from igJudgeGate.shadowJudgeGate + content.shadowJudgeReadout. */
const GATE_MIN = 60;
const wouldBlock = (v: Verdict): boolean => v.rejected || v.total < GATE_MIN;
const isDisagreement = (self: number | null, v: Verdict): boolean => (self ?? 0) >= 70 && wouldBlock(v);

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function main(): void {
  if (!existsSync(FILE)) {
    console.error(`no corpus at ${FILE} — run scripts/ig-retro-dual-judge.ts first`);
    process.exit(1);
  }
  const recs: Rec[] = readFileSync(FILE, "utf8").split(/\r?\n/)
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as Rec);
  if (!recs.length) {
    console.error("corpus is empty — a run that graded nothing is a failed run, not a clean result");
    process.exit(1);
  }

  const prodTotals = recs.map((r) => r.prod.total);
  const divTotals = recs.map((r) => r.diverse.total);
  const gaps = recs.map((r) => r.prod.total - r.diverse.total);
  const prodHigher = gaps.filter((g) => g > 0).length;
  const divHigher = gaps.filter((g) => g < 0).length;
  const tied = gaps.filter((g) => g === 0).length;

  console.log(`corpus: ${recs.length} rows  (${recs[recs.length - 1]?.createdAt.slice(0, 10)} -> ${recs[0]?.createdAt.slice(0, 10)})`);
  console.log(`lanes:  prod=${recs[0].prod.model}  diverse=${recs[0].diverse.model}\n`);

  console.log("── Q1: same-family judge generosity ──");
  console.log(`  self-eval     mean=${mean(recs.map((r) => r.selfOverall ?? 0)).toFixed(1)}  median=${median(recs.map((r) => r.selfOverall ?? 0)).toFixed(1)}`);
  console.log(`  PROD judge    mean=${mean(prodTotals).toFixed(1)}  median=${median(prodTotals).toFixed(1)}   (same family as the generator)`);
  console.log(`  DIVERSE judge mean=${mean(divTotals).toFixed(1)}  median=${median(divTotals).toFixed(1)}   (independent family)`);
  console.log(`  paired gap (prod - diverse): mean=${mean(gaps) >= 0 ? "+" : ""}${mean(gaps).toFixed(1)}  median=${median(gaps) >= 0 ? "+" : ""}${median(gaps).toFixed(1)}`);
  console.log(`  sign test: prod higher on ${prodHigher}/${recs.length}, diverse higher on ${divHigher}, tied ${tied}`);

  console.log("\n── Q2: would the gate have fired? ──");
  const prodDis = recs.filter((r) => isDisagreement(r.selfOverall, r.prod));
  const divDis = recs.filter((r) => isDisagreement(r.selfOverall, r.diverse));
  const onlyDiverse = recs.filter((r) => !wouldBlock(r.prod) && wouldBlock(r.diverse));
  const onlyProd = recs.filter((r) => wouldBlock(r.prod) && !wouldBlock(r.diverse));
  const bothBlock = recs.filter((r) => wouldBlock(r.prod) && wouldBlock(r.diverse));
  console.log(`  blind-spot rows, PROD lane    : ${prodDis.length}/${recs.length}  (${((100 * prodDis.length) / recs.length).toFixed(0)}%)  <- what the LIVE gate catches`);
  console.log(`  blind-spot rows, DIVERSE lane : ${divDis.length}/${recs.length}  (${((100 * divDis.length) / recs.length).toFixed(0)}%)  <- what an INDEPENDENT gate catches`);
  console.log(`  blocked by BOTH               : ${bothBlock.length}`);
  console.log(`  blocked ONLY by diverse       : ${onlyDiverse.length}   <- the measured cost of the pin defect`);
  console.log(`  blocked ONLY by prod          : ${onlyProd.length}`);

  const gateAgree = recs.filter((r) => wouldBlock(r.prod) === wouldBlock(r.diverse)).length;
  console.log(`\n  inter-judge GATE agreement: ${gateAgree}/${recs.length} (${((100 * gateAgree) / recs.length).toFixed(0)}%)`);
  console.log(`  → a held-out judge is only viable if this is high AND it still catches rows the prod lane misses.`);

  if (onlyDiverse.length) {
    console.log("\n── rows an independent judge would have blocked and prod let through ──");
    for (const r of onlyDiverse.slice(0, 10)) {
      console.log(`  row ${r.id} ${r.conceptKey} [${r.archetype}] self=${r.selfOverall} prod=${r.prod.total} diverse=${r.diverse.total}${r.diverse.rejected ? " REJECTED" : ""}`);
      console.log(`     diverse: ${r.diverse.note.slice(0, 150)}`);
    }
  }

  // The "generic visual" hypothesis, countable rather than anecdotal.
  const generic = recs.filter((r) => /generic|stock|any shop|interchangeab|nondescript/i.test(`${r.prod.note} ${r.diverse.note}`));
  const genericProdBlocks = generic.filter((r) => wouldBlock(r.prod)).length;
  const genericDivBlocks = generic.filter((r) => wouldBlock(r.diverse)).length;
  console.log(`\n── generic-visual signature: ${generic.length}/${recs.length} rows (${((100 * generic.length) / recs.length).toFixed(0)}%) mention it in either note ──`);
  console.log(`  blocked by PROD lane   : ${genericProdBlocks}`);
  console.log(`  blocked by DIVERSE lane: ${genericDivBlocks}`);
  // REFUTED 2026-08-07 (this line previously read "a missing rubric
  // criterion"): HARD_REJECT_RULES[0] is verbatim "generic mechanic imagery
  // any shop could run unchanged". The criterion is present and first in the
  // list. gpt-oss:120b enforces it (hard-rejects, quoting it almost verbatim);
  // deepseek-v4-pro scores the same rows 77-95. This is ENFORCEMENT divergence
  // between model families, not a gap in the rubric — so adding criteria will
  // not fix it, and the judge lane is the lever.
  console.log(`  → HARD_REJECT_RULES[0] already names this exactly. A gap here is ENFORCEMENT, not rubric.`);
}

main();
