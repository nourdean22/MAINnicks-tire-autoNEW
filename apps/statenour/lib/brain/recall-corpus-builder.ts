/**
 * lib/brain/recall-corpus-builder.ts — recall corpus V2 (2026-07-29 ·
 * next-queue item 4).
 *
 * spine-8 shipped the harness with SYNTHETIC seeds and said so:
 * "the corpus grows from real corrections and misses (the outcome
 * ledger's future job), not from invented fixtures." This is that job.
 *
 * Two real sources, both already accruing:
 *   · IntelligenceOutcome rows the operator dismissed / marked
 *     not-useful (`outcomesNeedingReview`) — a recommendation the
 *     system made and the operator rejected.
 *   · BrainMemory `chat_claim_warn` rows — turns where the
 *     action-receipt verifier caught a claim without a receipt.
 *
 * Honesty rules, enforced in code:
 *   · A generated case carries provenance naming its real source row —
 *     never "synthetic-seed".
 *   · The report separates real from synthetic and REFUSES to claim
 *     corpus quality while real == 0.
 *
 * 2026-08-28 · learning-loops wave (docs/LEARNING-LOOPS-2026-08-28.md,
 * Loop B). The previous header claimed "relevantKeys are only asserted
 * when the source row actually names a memory key" — that branch NEVER
 * existed: all three constructors hard-coded empty relevantKeys AND
 * empty forbiddenKeys, so under runRecallEval every harvested case was
 * excluded from precision scoring and could never fail abstention
 * (forbiddenInjected needs a non-empty forbiddenKeys). The corpus could
 * detect a crashed retriever, never a bad one. The fourth source below
 * (noise-verdict Discover rows) is the first LABEL-BEARING shape: the
 * judged row's own key is the forbidden key, no schema change, one case
 * per operator tap that already happens.
 */
import { prisma } from "@/lib/prisma";
import { DISCOVERY_CATEGORIES } from "./discoveries";
import { RECALL_EXCLUDE_CATEGORIES } from "./categories";
import type { RecallEvalCase } from "./recall-eval";

/** Cap so one bad week can't flood the corpus. */
const MAX_PER_SOURCE = 25;

/**
 * Categories a HUMAN would actually ask about.
 *
 * ⚠⚠ MEASURED 2026-09-18, AND THIS LIST IS THE DIFFERENCE BETWEEN A BENCHMARK
 * AND A TAUTOLOGY. Ordering durable memory by confidence surfaces MACHINE rows,
 * not personal facts: `semantic_edge` (18,388 rows, avg 44 chars — graph
 * edges), `mastery_xp_event` (2,330), `nick_quality` (971), `reply_judgment`
 * (731), `data_source_probe` (386). The first cut of this builder produced
 * cases like `surface=missions day=2026-09-06 mount=2 deleteTask=5` — telemetry
 * nobody will ever type as a query, graded against itself.
 *
 * These are the categories that hold things the operator says and asks about.
 */
const HUMAN_FACT_CATEGORIES: readonly string[] = [
  "concern",
  "emotional_state",
  "blind_spot",
  "decision_log",
  "friction",
  "insight",
  "wisdom",
  "prediction_lesson",
  "customer_preference",
  "nick_advice",
  "preference",
  "win",
  "learning_journal",
  "business_event",
];


const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "case";

/**
 * Pure: an outcome the operator REJECTED becomes an abstention case —
 * "when asked about this, do not resurface the rejected suggestion".
 * Exported for tests.
 */
export function caseFromRejectedOutcome(row: {
  id: string;
  kind: string;
  sourceEngine: string;
  summary: string;
  decision: string | null;
  outcomeUseful: boolean | null;
}): RecallEvalCase {
  const why = row.decision === "dismissed" ? "dismissed" : "marked not useful";
  return {
    id: `real-outcome-${slug(row.id)}`,
    query: row.summary.slice(0, 240),
    relevantKeys: [],
    forbiddenKeys: [],
    kind: "abstention",
    provenance: `outcome:${row.id} · ${row.sourceEngine} ${row.kind} ${why}`,
    acceptableAbstention: true,
  };
}

/**
 * Pure: a claim-without-receipt warning becomes a grounding case —
 * the retriever should surface the evidence that would have prevented
 * the unsupported claim. Exported for tests.
 */
export function caseFromClaimWarning(row: {
  key: string;
  content: string;
  metadata: unknown;
}): RecallEvalCase {
  const meta = (row.metadata ?? {}) as {
    claims?: Array<{ verb?: string; expectedTool?: string }>;
    textPreview?: string;
  };
  const verb = meta.claims?.[0]?.verb ?? "the claimed action";
  const preview = (meta.textPreview ?? row.content).slice(0, 240);
  return {
    id: `real-claim-${slug(row.key)}`,
    query: preview,
    relevantKeys: [],
    forbiddenKeys: [],
    kind: "abstention",
    provenance: `chat_claim_warn:${row.key} · unproven "${verb}"`,
    acceptableAbstention: true,
  };
}

/**
 * Pure: a tool call that ERRORED becomes an abstention case — nothing
 * in memory may later assert that this action succeeded. Same logic as
 * caseFromClaimWarning (unproven action -> surface no distractor),
 * reached from the other direction: the claim detector catches the
 * model SAYING it acted, this catches the tool actually FAILING.
 *
 * Exported for tests.
 *
 * Honest about its own limits: AgentTrace deliberately stores no user
 * text (see otel-export.ts for why that matters), so the query is
 * synthesized from the tool label rather than replayed from the real
 * turn. The provenance says so — this case proves the retriever does
 * not manufacture a success record, NOT that it handles the original
 * phrasing.
 */
export function caseFromFailedToolCall(row: {
  traceId: string;
  label: string;
  errorClass: string | null;
}): RecallEvalCase {
  const why = row.errorClass ?? "unknown error";
  return {
    id: `real-toolfail-${slug(`${row.label}-${row.traceId}`)}`,
    query: `Did ${row.label} complete successfully?`,
    relevantKeys: [],
    forbiddenKeys: [],
    kind: "abstention",
    provenance: `trace:${row.traceId} · ${row.label} failed (${why}) · query synthesized from label, not the real turn`,
    acceptableAbstention: true,
  };
}

export interface CorpusComposition {
  synthetic: number;
  real: number;
  total: number;
  /** False while the corpus is synthetic-only — the harness's numbers
   *  are then a smoke test, NOT a quality measurement. */
  hasRealEvidence: boolean;
  note: string;
}

/** Pure: composition + the honest note. Exported for tests. */
export function describeCorpus(cases: readonly RecallEvalCase[]): CorpusComposition {
  const real = cases.filter((c) => c.provenance !== "synthetic-seed").length;
  const synthetic = cases.length - real;
  return {
    synthetic,
    real,
    total: cases.length,
    hasRealEvidence: real > 0,
    note:
      real === 0
        ? "SYNTHETIC ONLY — these numbers prove the harness runs, not that recall is good."
        : `${real} real case(s) from operator corrections; ${synthetic} synthetic seed(s) retained for smoke coverage.`,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
 * IS A PRECISION FIGURE FROM THIS CORPUS WORTH ANYTHING?
 * ════════════════════════════════════════════════════════════════════════════
 * `caseFromDurableFact` builds a positive case's query FROM THE MEMORY'S OWN
 * WORDING, so without paraphrasing the query IS the document: both the lexical
 * and the vector lane match it trivially, score ~1.0, and prove nothing. A
 * benchmark that cannot lose is not a benchmark.
 *
 * That makes "was the paraphrase arm applied?" a precondition on whether any
 * number off this corpus is readable — not a cosmetic detail. Kept as a PURE
 * function beside describeCorpus() rather than inline in the runner, because a
 * predicate that lives inside main() cannot be tested, and an untested
 * interpretability rule is how a tautological benchmark gets published.
 * ════════════════════════════════════════════════════════════════════════════ */

export type ParaphraseStatus =
  /** --paraphrase was not passed. Queries are verbatim content slices. */
  | "not-requested"
  /** Requested, but the model path was unreachable (e.g. the server-only guard). */
  | "blocked"
  /** Requested, eligible cases existed, and NONE were rewritten. */
  | "produced-nothing"
  /** Requested, but no case carried relevantKeys, so there was nothing to rewrite. */
  | "vacuous"
  /** Some eligible cases rewritten, some kept verbatim. */
  | "partial"
  /** Every eligible case rewritten. */
  | "complete";

export interface ParaphraseVerdict {
  status: ParaphraseStatus;
  /** True when a precision number off this corpus measures recall rather than echo. */
  scorable: boolean;
  /** True when --paraphrase was asked for and did not deliver a scorable corpus. */
  failedRequest: boolean;
  reason: string;
}

/**
 * Pure. `result` is null when --paraphrase was not passed.
 *
 * ⚠ `scorable` and `failedRequest` are DELIBERATELY NOT THE SAME FLAG. A plain
 * `pnpm harvest:evals` yields a corpus that is not scorable and that is fine —
 * the operator did not ask for one. Collapsing the two would either make the
 * default run exit non-zero, or make a blocked arm exit zero; the repo has
 * already shipped the second of those once.
 */
export function paraphraseVerdict(
  result: { rewritten: number; failed: number; blocked?: string } | null,
): ParaphraseVerdict {
  if (result === null) {
    return {
      status: "not-requested",
      scorable: false,
      failedRequest: false,
      reason:
        "queries are verbatim content slices — the positive arm is an echo check. Re-run with --paraphrase.",
    };
  }
  if (result.blocked) {
    return {
      status: "blocked",
      scorable: false,
      failedRequest: true,
      reason: `paraphrase blocked — ${result.blocked}`,
    };
  }
  const eligible = result.rewritten + result.failed;
  if (eligible === 0) {
    return {
      status: "vacuous",
      scorable: false,
      failedRequest: false,
      reason:
        "no case carried relevantKeys, so there was nothing to paraphrase — an abstention-only corpus measures no positive recall.",
    };
  }
  if (result.rewritten === 0) {
    return {
      status: "produced-nothing",
      scorable: false,
      failedRequest: true,
      reason: `paraphrase rewrote 0 of ${eligible} eligible case(s) — every positive query is still its own document.`,
    };
  }
  if (result.failed > 0) {
    return {
      status: "partial",
      scorable: true,
      failedRequest: false,
      reason: `${result.rewritten} of ${eligible} paraphrased; ${result.failed} kept verbatim and marked as such in provenance.`,
    };
  }
  return {
    status: "complete",
    scorable: true,
    failedRequest: false,
    reason: `all ${eligible} eligible case(s) paraphrased.`,
  };
}

/**
 * Pure: a discovery the operator judged NOISE becomes the first
 * label-bearing harvested case — the judged row's own key is the
 * forbidden key ("retrieval must not surface this for its own topic").
 * Non-vacuous under runRecallEval: a retriever that returns the noise
 * row now FAILS the case (forbiddenInjected > 0). Exported for tests.
 */
export function caseFromNoiseDiscovery(row: {
  id: string;
  key: string;
  category: string;
  content: string;
}): RecallEvalCase {
  return {
    id: `real-discovery-${slug(row.key)}`,
    // Strip the severity tag so the query reads like an operator asking
    // about the topic, not like the card template.
    query: row.content.replace(/^\[[A-Z]+\]\s*/, "").slice(0, 240),
    relevantKeys: [],
    forbiddenKeys: [row.key],
    kind: "abstention",
    provenance: `discovery:${row.id} · ${row.category} noise-verdict`,
    acceptableAbstention: true,
  };
}

/**
 * The METADATA-PRECEDENCE noise predicate, in SQL. An explicitly present
 * metadata.discoveryVerdict wins — including an explicit null, which is
 * what a resurface writes — and the column is consulted only where the
 * source is silent (the mirror-must-never-outrank-the-source rule from
 * the 08-22 wave). `->>` yields SQL NULL for a JSON null, so the CASE
 * arms are explicit rather than relying on that coincidence.
 */
const NOISE_VERDICT_SQL = `CASE WHEN metadata ? 'discoveryVerdict'
       THEN metadata->>'discoveryVerdict' = 'noise'
       ELSE discovery_verdict = 'noise' END`;

/**
 * How many label-bearing eval cases the operator's judgments have
 * produced so far — the metric the corpus odometer reports beside the
 * (untouched) 200 fine-tune gate. Counts the accumulating total, not
 * the MAX_PER_SOURCE harvest page.
 */
/**
 * ★★★ THE FIRST POSITIVE CASE BUILDER. Every source above harvests a FAILURE —
 * a dismissed recommendation, a warned claim, an error trace, a noise verdict —
 * so every case it produces is `kind: "abstention"` with `relevantKeys: []`.
 *
 * That has a consequence nobody stated, and it is easy to misread: on a corpus
 * with no relevant items, precision@k is ZERO BY ARITHMETIC. Measured
 * 2026-09-18, all three lanes reported precision@5=0 on 39 harvested cases —
 * which says nothing whatever about whether retrieval finds things. It only
 * says the corpus contains nothing to find.
 *
 * `RecallEvalCase` has declared the LongMemEval taxonomy since 2026-07-29
 * (exact_fact | temporal | preference | contradiction | name_number |
 * abstention | knowledge_update). Six of those seven had no builder.
 *
 * ⚠ NON-CIRCULAR BY CONSTRUCTION. The ground truth is the memory's own `key` —
 * a human/system-written slug naming the fact, written independently of any
 * ranking. Deriving cases from what the retriever PREVIOUSLY returned would
 * grade the retriever against its own past output and could only ever confirm
 * it.
 *
 * ⚠ AND THE QUERY DELIBERATELY AVOIDS THE KEY'S OWN WORDS. Asking with the key
 * text would let the lexical lane match the answer verbatim and report a win
 * that means nothing. The query is built from CONTENT with every key token
 * stripped, so a hit requires finding the row by what it SAYS rather than by
 * what it is called. A case that cannot be built that way is skipped rather
 * than weakened — returning null is the honest outcome.
 */
export function caseFromDurableFact(row: {
  id: string;
  key: string;
  category: string;
  content: string;
}): RecallEvalCase | null {
  const key = (row.key ?? "").trim();
  const content = (row.content ?? "").replace(/\s+/g, " ").trim();
  if (!key || content.length < 60) return null;

  // ⚠ REJECT ROWS THAT CANNOT MAKE AN HONEST CASE.
  //
  // A serialized blob is not something an operator would ever type, so a case
  // built from one measures nothing a user will do. And a key that is mostly an
  // identifier (`journal-take:cmok6ukiz0005…`) names the row's TYPE, not the
  // fact — stripping its tokens from the content removes almost nothing, so the
  // query ends up being the document itself and any retriever "wins"
  // tautologically.
  //
  // ★ A benchmark that cannot lose is not a benchmark. Dropping these rows
  //   shrinks the corpus and keeps it meaningful; keeping them would have
  //   manufactured a green number, which is the failure this whole wave exists
  //   to remove.
  if (/^[[{]/.test(content)) return null;
  const keyName = key.split(":")[0] ?? key;
  if (/^[0-9a-z]{20,}$/i.test(keyName)) return null;

  // Tokens the key already contains — the query must not lean on them.
  const keyTokens = new Set(
    key
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );

  const words = content.split(" ");
  const kept: string[] = [];
  for (const w of words) {
    const bare = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (bare.length > 2 && keyTokens.has(bare)) continue;
    kept.push(w);
    if (kept.join(" ").length > 140) break;
  }
  const query = kept.join(" ").trim();
  // Too short after stripping means the content was mostly the key restated;
  // such a case would test nothing.
  if (query.split(" ").filter(Boolean).length < 6) return null;

  return {
    id: `real-fact-${row.id}`,
    query,
    relevantKeys: [key],
    forbiddenKeys: [],
    kind: "exact_fact",
    provenance: `brain_memory:${row.id} · category=${row.category} · key-stripped content query`,
  };
}

export async function countLabeledEvalCases(): Promise<number> {
  const cats = [...DISCOVERY_CATEGORIES];
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM brain_memories
     WHERE category = ANY($1) AND ${NOISE_VERDICT_SQL}`,
    cats,
  );
  return Number(rows[0]?.n ?? 0);
}

/** Per-source outcome, so "no cases" can never be mistaken for "no data". */
export interface SourceReport {
  source: string;
  ok: boolean;
  cases: number;
  /** Set only when the query threw. */
  error?: string;
}

export interface RealCorpusResult {
  cases: RecallEvalCase[];
  sources: SourceReport[];
  /** True when ANY source failed — the corpus is then incomplete, not empty. */
  degraded: boolean;
}

/**
 * Read every real source and build cases.
 *
 * Still never throws — one dead source must not cost the corpus the
 * other two. But it no longer swallows the failure: the previous
 * `.catch(() => [])` made a broken query and a genuinely empty table
 * produce byte-identical output, so describeCorpus() would report
 * "SYNTHETIC ONLY" and the operator would read that as "not enough
 * corrections yet" rather than "the harvest is broken". A flywheel that
 * has stopped turning must not look like a flywheel that is merely new.
 */
export async function buildRealRecallCases(): Promise<RealCorpusResult> {
  async function read<T>(source: string, run: () => Promise<T[]>): Promise<{
    rows: T[];
    report: SourceReport;
  }> {
    try {
      const rows = await run();
      return { rows, report: { source, ok: true, cases: rows.length } };
    } catch (err) {
      return {
        rows: [],
        report: {
          source,
          ok: false,
          cases: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  const [outcomes, warnings, toolFailures, noiseDiscoveries, durableFacts] = await Promise.all([
    read("intelligence_outcomes(dismissed|not-useful)", () =>
      prisma.intelligenceOutcome.findMany({
        where: { OR: [{ decision: "dismissed" }, { outcomeUseful: false }] },
        orderBy: { shownAt: "desc" },
        take: MAX_PER_SOURCE,
        select: {
          id: true,
          kind: true,
          sourceEngine: true,
          summary: true,
          decision: true,
          outcomeUseful: true,
        },
      }),
    ),
    read("brain_memory(chat_claim_warn)", () =>
      prisma.brainMemory.findMany({
        where: { category: "chat_claim_warn", deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: MAX_PER_SOURCE,
        select: { key: true, content: true, metadata: true },
      }),
    ),
    // Third signal, previously harvested by nothing: errorClass was
    // written by stream-with-fallback and traced-aichat and read by no
    // eval lane at all.
    read("agent_traces(errorClass)", () =>
      prisma.agentTrace.findMany({
        where: { errorClass: { not: null } },
        orderBy: { createdAt: "desc" },
        take: MAX_PER_SOURCE,
        select: { traceId: true, label: true, errorClass: true },
      }),
    ),
    // Fourth source (learning-loops wave): noise-verdict Discover rows —
    // the first label-bearing cases. Raw SQL so the metadata-precedence
    // rule is honored in the predicate itself; tombstones included (a
    // tombstone does not unmake a judgement).
    read("brain_memory(discovery noise-verdict)", () =>
      prisma.$queryRawUnsafe<
        Array<{ id: string; key: string; category: string; content: string }>
      >(
        `SELECT id::text AS id, key::text AS key, category::text AS category, content
         FROM brain_memories
         WHERE category = ANY($1) AND ${NOISE_VERDICT_SQL}
         ORDER BY coalesce(discovery_rated_at, updated_at) DESC
         LIMIT ${MAX_PER_SOURCE}`,
        [...DISCOVERY_CATEGORIES],
      ),
    ),
    // FIFTH source (2026-09-18) and the first POSITIVE one. Every source above
    // harvests a failure, so every case they produce is `abstention` with
    // `relevantKeys: []` — on which precision@k is zero BY ARITHMETIC, not by
    // any property of retrieval. Without this source the eval can only measure
    // whether the brain correctly refuses noise, never whether it finds things.
    //
    // ⚠ Same liveness + quarantine contract as every recall path: a case built
    // on a soft-deleted or quarantined row would grade the retriever for
    // failing to return something it is CORRECT to withhold.
    read("brain_memory(durable facts · positive)", () =>
      prisma.brainMemory.findMany({
        where: {
          deletedAt: null,
          category: { in: [...HUMAN_FACT_CATEGORIES] },
          confidence: { gte: 0.5 },
          // Long enough to state a fact, short enough not to be a document.
          content: { not: "" },
        },
        // ⚠ NOT `confidence: desc` — that sorted the machine categories to the
        // top and produced telemetry cases. Recency gives a spread of real,
        // current operator facts across the curated categories.
        orderBy: { updatedAt: "desc" },
        take: MAX_PER_SOURCE * 3,
        select: { id: true, key: true, category: true, content: true },
      }),
    ),
  ]);

  const sources = [
    outcomes.report,
    warnings.report,
    toolFailures.report,
    noiseDiscoveries.report,
    durableFacts.report,
  ];

  return {
    cases: [
      ...outcomes.rows.map(caseFromRejectedOutcome),
      ...warnings.rows.map(caseFromClaimWarning),
      ...toolFailures.rows.map(caseFromFailedToolCall),
      ...noiseDiscoveries.rows.map(caseFromNoiseDiscovery),
      // null when the content was mostly the key restated — such a case would
      // test nothing, so it is dropped rather than weakened.
      ...durableFacts.rows.map(caseFromDurableFact).filter((c): c is RecallEvalCase => c !== null),
    ],
    sources,
    degraded: sources.some((s) => !s.ok),
  };
}
