/**
 * LLM call ledger — the READER.
 *
 * `services/llmLedger.ts` has been writing one row per invokeLLM() call since
 * migration 0116 was applied and LLM_LEDGER_ENABLED was set on Railway
 * (2026-09-02). Nothing ever read it. drizzle/schema.ts says so in its own
 * comment — "nothing selects from this table" — and a repo-wide grep for
 * `llmCalls` returned only the table definition and its two exported types.
 *
 * That is a WRITER WITH NO READER: ~65 call sites' worth of model usage,
 * recorded faithfully, shown to the operator never. Same defect shape as the
 * 5-of-30 heartbeat columns that had no producer, from the other end.
 *
 * TWO INDEPENDENT FACTS, NOT ONE STATE. The first draft collapsed them and got
 * two things wrong for it, both caught in review:
 *
 *   `recording` — what the WRITER is doing: on | off | stopped_after_error.
 *                 Note the third: llmLedger latches a module-level `disabled`
 *                 on its first insert failure and drops every later call until
 *                 the process restarts, so an env flag reading "true" is NOT
 *                 proof that anything is being written down.
 *   `read`       — whether THIS query succeeded: ok | unreadable.
 *
 * They are orthogonal. Recording can be off while a month of real history sits
 * in the table — and the first draft refused to query at all in that case,
 * which took the operator's existing data away at exactly the moment they
 * would want to look at it. The read now always runs; `recording` is reported
 * beside the data rather than instead of it.
 *
 * NO DOLLAR FIGURES. The table records tokens and this repo has no price
 * table. A hard-coded rate would be fabrication, and one that drifts from the
 * vendor's real pricing is a cache with no invalidation.
 *
 * TOKEN COLUMNS ARE NULLABLE. promptTokens/completionTokens are `int` with no
 * NOT NULL — not every provider returns usage. A bare SUM() would under-report
 * while looking authoritative, which is precisely how ALG's partsCost died:
 * the column kept existing, the values stopped arriving, and the UI kept
 * rendering a number. Hence `callsWithTokens` beside every sum.
 *
 * TOTALS ARE UNBOUNDED. The lane list is capped at 100 (lane, provider)
 * groups; summing that capped list would silently under-report headline calls
 * and tokens whenever more groups exist, while the UI offered to "show all
 * lanes". Totals therefore come from their own aggregate with no limit, and
 * `lanesTruncated` says plainly when the list is a subset.
 */
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";
import { ledgerRecordingState, type LedgerRecordingState } from "./llmLedger";
import { buildLaneAggregate, buildWindowTotals } from "./llmLedgerQuery";

const log = createLogger("llm-ledger-read");

type ReadState = "ok" | "unreadable";

interface LlmLaneRow {
  lane: string;
  provider: string;
  calls: number;
  failed: number;
  /** How many of `calls` actually carried token counts. See the header. */
  callsWithTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
}

interface LlmLedgerTotals {
  calls: number;
  failed: number;
  callsWithTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** Distinct (lane, provider) groups in the window, counted without a limit. */
  groups: number;
}

interface LlmLedgerSummary {
  /** What the writer is doing. Independent of whether this read worked. */
  recording: LedgerRecordingState;
  /** Whether this read worked. Independent of what the writer is doing. */
  read: ReadState;
  windowDays: number;
  lanes: LlmLaneRow[];
  /** True when more (lane, provider) groups exist than `lanes` contains. */
  lanesTruncated: boolean;
  totals: LlmLedgerTotals;
  /** ISO. When the read ran — not when the newest row was written. */
  generatedAt: string;
}

const ZERO_TOTALS: LlmLedgerTotals = {
  calls: 0,
  failed: 0,
  callsWithTokens: 0,
  promptTokens: 0,
  completionTokens: 0,
  groups: 0,
};

const unreadable = (recording: LedgerRecordingState, windowDays: number): LlmLedgerSummary => ({
  recording,
  read: "unreadable",
  windowDays,
  lanes: [],
  lanesTruncated: false,
  totals: { ...ZERO_TOTALS },
  generatedAt: new Date().toISOString(),
});

/**
 * mysql2 returns DECIMAL/BIGINT aggregates as strings often enough that this
 * coercion is not defensive clutter: `"12" + "7"` is `"127"`, and two lanes
 * summed without it would have rendered a plausible, wrong total.
 */
const n = (v: unknown): number => {
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function getLlmLedgerSummary(windowDays: number): Promise<LlmLedgerSummary> {
  const recording = ledgerRecordingState();

  try {
    const { llmCalls } = await import("../../drizzle/schema");
    const d = await db();
    if (!d) return unreadable(recording, windowDays);

    // Both aggregates, one window predicate. Sequential rather than
    // Promise.all: a single pooled connection is the common case here and
    // these are two cheap grouped reads, not a latency-critical path.
    const laneRows = (await buildLaneAggregate(d, llmCalls, windowDays)) as unknown as Array<
      Record<string, unknown>
    >;
    const totalRows = (await buildWindowTotals(d, llmCalls, windowDays)) as unknown as Array<
      Record<string, unknown>
    >;

    const lanes: LlmLaneRow[] = laneRows.map((r) => ({
      lane: String(r.lane ?? ""),
      provider: String(r.provider ?? ""),
      calls: n(r.calls),
      failed: n(r.failed),
      callsWithTokens: n(r.callsWithTokens),
      promptTokens: n(r.promptTokens),
      completionTokens: n(r.completionTokens),
      avgLatencyMs: n(r.avgLatencyMs),
      maxLatencyMs: n(r.maxLatencyMs),
    }));

    const t = totalRows[0] ?? {};
    const totals: LlmLedgerTotals = {
      calls: n(t.calls),
      failed: n(t.failed),
      callsWithTokens: n(t.callsWithTokens),
      promptTokens: n(t.promptTokens),
      completionTokens: n(t.completionTokens),
      groups: n(t.groups),
    };

    return {
      recording,
      read: "ok",
      windowDays,
      lanes,
      lanesTruncated: totals.groups > lanes.length,
      totals,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    // A failed read is UNKNOWN, never an empty ledger.
    log.error("llm ledger read failed", { error: err instanceof Error ? err.message : String(err) });
    return unreadable(recording, windowDays);
  }
}
