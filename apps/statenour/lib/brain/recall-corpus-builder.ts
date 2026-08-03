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
 *   · relevantKeys are only asserted when the source row actually names
 *     a memory key; otherwise the case is an ABSTENTION case (the
 *     retriever must not surface a distractor), which is a real signal
 *     rather than an invented expectation.
 *   · The report separates real from synthetic and REFUSES to claim
 *     corpus quality while real == 0.
 */
import { prisma } from "@/lib/prisma";
import type { RecallEvalCase } from "./recall-eval";

/** Cap so one bad week can't flood the corpus. */
const MAX_PER_SOURCE = 25;

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

  const [outcomes, warnings, toolFailures] = await Promise.all([
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
  ]);

  const sources = [outcomes.report, warnings.report, toolFailures.report];

  return {
    cases: [
      ...outcomes.rows.map(caseFromRejectedOutcome),
      ...warnings.rows.map(caseFromClaimWarning),
      ...toolFailures.rows.map(caseFromFailedToolCall),
    ],
    sources,
    degraded: sources.some((s) => !s.ok),
  };
}
