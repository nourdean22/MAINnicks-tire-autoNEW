/**
 * Memory-eval runner — pure scoring. No DB, no fs, no network.
 *
 * The caller (scripts/run-memory-evals.ts or the system route) reads grounding
 * docs from disk and passes them in as `sources`. This keeps the runner pure
 * and unit-testable, and guarantees it can never mutate state.
 */

import type {
  EvalOutcome,
  MemoryEval,
  MemoryEvalCategory,
  MemoryEvalRunResult,
} from "./memory-eval-types";

/** Words that negate a forbidden term in a free-form answer ("vercel is retired"). */
const NEGATORS = [
  "retired",
  "not ",
  "no longer",
  "never",
  "isn't",
  "is not",
  "instead of",
  "deprecated",
  "former",
  "used to",
  "was ",
];

const lc = (s: string) => s.toLowerCase();

/** Which expectedFacts are missing from `text` (case-insensitive substring). */
export function missingFacts(text: string, facts: string[]): string[] {
  const hay = lc(text);
  return facts.filter((f) => !hay.includes(lc(f)));
}

/**
 * Grade a TRUTH DOC: it just needs to TEACH the expected facts. Forbidden
 * claims are NOT applied — a truth doc legitimately names retired terms to
 * mark them retired.
 */
export function gradeDoc(ev: MemoryEval, docText: string): EvalOutcome {
  const missing = missingFacts(docText, ev.expectedFacts);
  return {
    id: ev.id,
    category: ev.category,
    severity: ev.severity,
    status: missing.length === 0 ? "pass" : "fail",
    source: "doc",
    missingFacts: missing,
    presentForbidden: [],
    note: missing.length ? `grounding doc ${ev.groundingDoc} missing fact(s)` : undefined,
  };
}

/** Is a forbidden term asserted as a current claim (i.e. present and NOT negated)? */
function forbiddenAsClaim(text: string, term: string): boolean {
  const hay = lc(text);
  const t = lc(term);
  if (!hay.includes(t)) return false;
  // If any negator appears anywhere in the (typically short) answer, treat the
  // mention as "named, not claimed". Conservative but avoids "X is retired" fails.
  return !NEGATORS.some((n) => hay.includes(n));
}

/**
 * Grade a free-form ANSWER (e.g. what Nick said). Must contain expectedFacts
 * AND must not assert any forbiddenClaim as current. This is the path a future
 * LLM-judge would feed; default runs use gradeDoc.
 */
export function gradeAnswer(ev: MemoryEval, answer: string): EvalOutcome {
  const missing = missingFacts(answer, ev.expectedFacts);
  const present = ev.forbiddenClaims.filter((c) => forbiddenAsClaim(answer, c));
  return {
    id: ev.id,
    category: ev.category,
    severity: ev.severity,
    status: missing.length === 0 && present.length === 0 ? "pass" : "fail",
    source: "answer",
    missingFacts: missing,
    presentForbidden: present,
  };
}

export interface RunOptions {
  /** repo-relative path -> file content, for groundingDoc evals. */
  sources?: Record<string, string>;
  /** eval id -> a candidate answer to grade (overrides doc grounding). */
  answers?: Record<string, string>;
}

/** Dataset validity — the CI guard. Returns human-readable issues ([] = ok). */
export function validateDataset(evals: MemoryEval[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const ev of evals) {
    if (seen.has(ev.id)) issues.push(`duplicate id: ${ev.id}`);
    seen.add(ev.id);
    if (!ev.id.trim()) issues.push("eval with empty id");
    if (!ev.question.trim()) issues.push(`${ev.id}: empty question`);
    if (ev.expectedFacts.length === 0) issues.push(`${ev.id}: no expectedFacts`);
    if (ev.expectedFacts.some((f) => !f.trim())) issues.push(`${ev.id}: blank expectedFact`);
    if (ev.sourceHints.length === 0) issues.push(`${ev.id}: no sourceHints`);
  }
  return issues;
}

const EMPTY_BUCKET = () => ({ total: 0, passed: 0, failed: 0, manual: 0 });

/** Run the dataset. With no sources/answers, every eval is "manual". */
export function runMemoryEvals(evals: MemoryEval[], opts: RunOptions = {}): MemoryEvalRunResult {
  const { sources = {}, answers = {} } = opts;
  const results: EvalOutcome[] = [];

  for (const ev of evals) {
    if (answers[ev.id] != null) {
      results.push(gradeAnswer(ev, answers[ev.id]));
    } else if (ev.groundingDoc && sources[ev.groundingDoc] != null) {
      results.push(gradeDoc(ev, sources[ev.groundingDoc]));
    } else {
      results.push({
        id: ev.id,
        category: ev.category,
        severity: ev.severity,
        status: "manual",
        source: "none",
        missingFacts: [],
        presentForbidden: [],
        note: ev.groundingDoc ? `grounding doc not provided: ${ev.groundingDoc}` : "no grounding doc",
      });
    }
  }

  const byCategory: Record<string, ReturnType<typeof EMPTY_BUCKET>> = {};
  for (const r of results) {
    const cat = r.category as MemoryEvalCategory;
    byCategory[cat] ??= EMPTY_BUCKET();
    byCategory[cat].total++;
    if (r.status === "pass") byCategory[cat].passed++;
    else if (r.status === "fail") byCategory[cat].failed++;
    else byCategory[cat].manual++;
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    manual: results.filter((r) => r.status === "manual").length,
    criticalFailures: results.filter((r) => r.status === "fail" && r.severity === "critical"),
    byCategory,
    datasetIssues: validateDataset(evals),
    results,
  };
}
