/**
 * Instrument HEALTH — liveness beside failures, so a silent instrument has a
 * name and a status instead of an alibi.
 *
 * THE GAP THIS CLOSES. `instrument-failures.ts` reads the error log and reports
 * which instruments FAILED to write. Its own header says what it cannot do:
 * "an instrument whose call site was deleted, or whose branch is never entered,
 * reports nothing here and looks identical to a healthy one." That caveat was
 * honest, and it was also the whole problem — `instrumentsWithNoFailures` is
 * the list an operator reads as "fine".
 *
 * MEASURED 2026-09-22, and this is why the module exists rather than a comment:
 * `action.done.shadow` — the instrument that must prove verifier coverage
 * BEFORE strict-Done is enforced anywhere — had written ONE row in its life,
 * against 253 assistant turns in 14 days, with ZERO instrument failures logged.
 * The failures reader therefore listed it as having no failures. Both true.
 * Neither is a health verdict. The row it wrote was `strictRelevant: false`:
 * a null reading. Any promotion decision built on "the shadow shows no gaps"
 * would have been built on n = 1.
 *
 * The same probe showed WHY, which is the part a failures reader can never
 * show: `tool.surfaced` wrote 294 rows and `tool.chosen` 113 on the same code
 * path in the same window, so the path runs at turn cadence. The two
 * consequential-action shadows (`operation.integrity_shadow`, `action.done.
 * shadow`) wrote 1 each because each writes only when its condition holds —
 * a turn with a consequential operation, a turn whose prose claims completion
 * — and that condition held on ~1 turn in 253. The instruments are alive and
 * correct. The phenomenon is rare. A reader that cannot say "UNDERPOWERED,
 * because conditional" will accuse a correct instrument of being dead, which
 * is the opposite error and just as expensive.
 *
 * STATUS VOCABULARY, in precedence order (first match wins):
 *   FAILING       failures logged in the window — names the cause, so it wins
 *   NEVER_RAN     no row has ever been written by this instrument
 *   STALE         has written before; zero writes in a window where turns
 *                 happened (the denominator moved and it did not)
 *   UNDERPOWERED  wrote in the window, but fewer than MIN_POWERED_N rows —
 *                 a reading exists and cannot support a rate; ALSO a
 *                 conditional instrument with zero writes on turns the
 *                 deferred-turn heartbeat proves the path ran for (2026-09-22:
 *                 that zero is a reading of "condition absent", not a lapse)
 *   HEALTHY       powered and not failing
 *
 * EVERY ROW CARRIES ITS DENOMINATOR. `coverage` is writes ÷ assistant turns in
 * the window, because every instrument here is per-turn. A bare count is the
 * defect shape this repo keeps re-finding (a filtered ratio with no base rate);
 * a count beside its denominator is a reading.
 *
 * Pure assembly + one live wrapper, same split as `instrument-failures.ts`, so
 * the status rules are testable without a database.
 */
import { prisma } from "@/lib/prisma";
import {
  buildInstrumentFailures,
  DEFERRED_TURN_INSTRUMENT,
  KNOWN_INSTRUMENTS,
  type InstrumentFailureView,
} from "./instrument-failures";

/**
 * UNKNOWN (2026-09-22, review on #2482): this row could not be READ - its
 * liveness source rejected, the failure sample was truncated before it, or the
 * shared denominator could not be counted. It is neither healthy nor failing;
 * it is unread, and a monitoring failure that rendered as "no warning" is the
 * exact false green this module exists to remove.
 */
export type InstrumentStatus = "HEALTHY" | "UNDERPOWERED" | "STALE" | "NEVER_RAN" | "FAILING" | "UNKNOWN";

/**
 * Below this many writes in the window, a per-turn instrument cannot support a
 * rate. 30 is a judgement call, stated: it is the smallest n at which a
 * proportion's standard error stops being dominated by single events, and it
 * matches the floor the persona-lane census already uses for a trustworthy
 * cell. Raising it makes the reader stricter; it never makes it lie.
 */
export const MIN_POWERED_N = 30;

/**
 * Instruments that write ONLY when a per-turn condition holds. For these, a low
 * count is expected behaviour, not evidence of breakage — the reason is carried
 * into the row so the operator reads "rare phenomenon", not "dead writer".
 * Anything not listed here is unconditional: it should write on every turn the
 * path runs, so a low count IS suspicious.
 */
export const CONDITIONAL_INSTRUMENTS: Readonly<Record<string, string>> = {
  "operation.integrity_shadow": "writes only on turns with a consequential operation",
  "action.done.shadow": "writes only on turns whose prose claims completion",
  "recommendation.novelty": "writes only on turns that ask for named resources and name at least one",
};

export interface InstrumentLivenessInput {
  instrument: string;
  /** Newest row this instrument has EVER written, or null if none exists. */
  lastWriteAt: Date | null;
  /** Rows written inside the window — or rows TOUCHED, when `unit` says so. */
  writesInWindow: number;
  /**
   * What `writesInWindow` counts. Default "writes" (one row per event). An
   * aggregate-by-key table upserts one row per key, so its count is "tools
   * touched", and a reason that called 8 touched tools "8 writes across 253
   * turns" would misdescribe its own units — measured on the first live run
   * of this module, on `tool_invocation`. A reader that exists to stop
   * instruments lying does not get to be vague about what it counted.
   */
  unit?: "writes" | "tools touched";
  /** Set when the liveness read itself failed; the row is UNKNOWN, not zero. */
  sourceError?: string;
}

function describeCount(n: number, unit: NonNullable<InstrumentLivenessInput["unit"]>): string {
  if (unit === "tools touched") return `${n} tool${n === 1 ? "" : "s"} touched`;
  return `${n} write${n === 1 ? "" : "s"}`;
}

/**
 * 2026-09-23 (review on #2482) · which turns an instrument could have written
 * on. Every persisted assistant message used to be the denominator, but
 * fast-path confirmations, image results and scheduled follow-ups never enter
 * tool routing, so tool.surfaced read STALE in a window they dominated.
 * `fallback` is true when the path's own counter had no rows to read and the
 * shared assistant-turn count stood in - said out loud, never silent.
 */
export interface InstrumentDenominator {
  name: "assistant turns" | "tool-routing turns";
  count: number;
  fallback: boolean;
}

/** Instruments that fire only on turns that entered tool routing. */
export const TOOL_ROUTING_INSTRUMENTS: ReadonlySet<string> = new Set(["tool.surfaced", "tool.chosen"]);
const TOOL_ROUTING_COUNTER = "tool_selection_turn";

export interface InstrumentHealthRow {
  instrument: string;
  status: InstrumentStatus;
  /** The turns this instrument could have written on, and where that count came from. */
  denominator: InstrumentDenominator;
  /** One sentence an operator can act on. Never empty. */
  reason: string;
  lastWriteAt: string | null;
  writesInWindow: number;
  failuresInWindow: number;
  /** writes ÷ assistant turns in the window. Null when the denominator is zero. */
  coverage: number | null;
  /** Why a low count may be legitimate. Null for unconditional instruments. */
  conditional: string | null;
}

export interface InstrumentHealthView {
  windowHours: number;
  since: string;
  /** Assistant turns in the window — the shared denominator. */
  assistantTurns: number;
  rows: InstrumentHealthRow[];
  /** Instruments in any state other than HEALTHY, worst first. */
  attention: InstrumentHealthRow[];
  /** Carried from the failures view: when true every failure count is a floor. */
  failuresTruncated: boolean;
  /** Reads that failed while building this view (failures sample, denominator). Empty when every read landed. */
  sourceErrors: string[];
  caveat: string;
}

const STATUS_RANK: Record<InstrumentStatus, number> = {
  FAILING: 0,
  UNKNOWN: 1,
  NEVER_RAN: 2,
  STALE: 3,
  UNDERPOWERED: 4,
  HEALTHY: 5,
};

function describeError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

/** Pure — the status rules, with no database and no clock but the one passed in. */
export function assembleInstrumentHealth(
  inputs: ReadonlyArray<InstrumentLivenessInput>,
  failures: InstrumentFailureView,
  assistantTurnsRead: number | null,
  windowHours: number,
  since: Date,
  sourceErrors: readonly string[] = [],
): InstrumentHealthView {
  const failuresByName = new Map(failures.failing.map((f) => [f.instrument, f.failures]));
  // A denominator that could not be counted is not zero turns: with it unknown,
  // no written instrument can be called STALE, UNDERPOWERED or HEALTHY.
  const denominatorKnown = assistantTurnsRead !== null;
  const assistantTurns = assistantTurnsRead ?? 0;

  // 2026-09-22 · the deferred-turn heartbeat is the denominator the conditional
  // shadows never had. When it is among the inputs AND has ever written, its
  // count in the window is how many turns the deferred path actually RAN for,
  // and "0 writes" on a conditional instrument splits into two honest verdicts:
  // the path ran and the condition did not occur (UNDERPOWERED — a reading of
  // zero events, not a dead writer) versus the path itself did not run (STALE).
  // Null when the heartbeat is absent or has never written (the first window
  // after it deploys), so every earlier verdict is unchanged in that case.
  const heartbeat = inputs.find((i) => i.instrument === DEFERRED_TURN_INSTRUMENT);
  const pathRuns = heartbeat && heartbeat.lastWriteAt !== null ? heartbeat.writesInWindow : null;
  const routingCounter = inputs.find((i) => i.instrument === TOOL_ROUTING_COUNTER);
  const routingRuns =
    routingCounter && routingCounter.lastWriteAt !== null && !routingCounter.sourceError ? routingCounter.writesInWindow : null;

  const rows: InstrumentHealthRow[] = inputs.map((input) => {
    const failuresInWindow = failuresByName.get(input.instrument) ?? 0;
    const conditional = CONDITIONAL_INSTRUMENTS[input.instrument] ?? null;
    const onToolPath = TOOL_ROUTING_INSTRUMENTS.has(input.instrument) && routingRuns !== null;
    const denominator: InstrumentDenominator = onToolPath
      ? { name: "tool-routing turns", count: routingRuns as number, fallback: false }
      : { name: "assistant turns", count: assistantTurns, fallback: TOOL_ROUTING_INSTRUMENTS.has(input.instrument) };
    const turnsLabel = onToolPath ? "tool-routing turns" : "turns";
    const coverage = denominator.count > 0 ? input.writesInWindow / denominator.count : null;
    const pct = coverage === null ? "n/a" : `${(coverage * 100).toFixed(1)}%`;
    const unit = input.unit ?? "writes";
    const counted = describeCount(input.writesInWindow, unit);

    let status: InstrumentStatus;
    let reason: string;
    if (input.sourceError) {
      status = "UNKNOWN";
      reason = `liveness source unavailable: ${input.sourceError} — this row is unread, not healthy`;
    } else if (failuresInWindow > 0) {
      status = "FAILING";
      reason = `${failuresInWindow} write failure${failuresInWindow === 1 ? "" : "s"} logged in ${windowHours}h — every count from this instrument is a floor`;
    } else if (failures.truncated) {
      // The sample hit its cap: an instrument absent from it may simply be
      // older in the window than the newest `sampleCap` rows. Absent is not clean.
      status = "UNKNOWN";
      reason = `the failure sample hit its ${failures.sampleCap}-row cap and this instrument is not in it — its failures in ${windowHours}h may be uncounted`;
    } else if (!denominatorKnown && input.lastWriteAt !== null) {
      status = "UNKNOWN";
      reason = "assistant-turn denominator unavailable — writes cannot be read as a rate or as staleness";
    } else if (input.lastWriteAt === null) {
      status = "NEVER_RAN";
      reason = `no row has ever been written — a wiring test, not a log reader, is what can find why${
        conditional && pathRuns !== null && pathRuns > 0
          ? `; the deferred path ran on ${pathRuns} of ${assistantTurns} turns in this window, so the condition (${conditional}) may simply not have occurred yet`
          : ""
      }`;
    } else if (
      input.writesInWindow === 0 &&
      assistantTurns > 0 &&
      conditional &&
      pathRuns !== null &&
      pathRuns > 0
    ) {
      // The heartbeat proves the path ran; a conditional instrument writing
      // nothing on those turns is a reading of zero events, not a lapse.
      status = "UNDERPOWERED";
      reason = `0 writes while the deferred path ran on ${pathRuns} of ${assistantTurns} turns — ${conditional}; the condition did not occur, the writer is not dead (last wrote ${input.lastWriteAt.toISOString()})`;
    } else if (onToolPath && input.writesInWindow === 0 && denominator.count === 0 && assistantTurns > 0) {
      // The path's own counter says tool routing ran on no turn in this window:
      // there was nothing for the instrument to write on. Not dead, not stale.
      status = "UNDERPOWERED";
      reason = `0 writes while tool routing ran on 0 of ${assistantTurns} assistant turns in this window — the path did not run, the writer is not dead (last wrote ${input.lastWriteAt.toISOString()})`;
    } else if (input.writesInWindow === 0 && denominator.count > 0) {
      status = "STALE";
      reason = `0 writes across ${denominator.count} ${onToolPath ? "tool-routing turns" : "assistant turns"}; last wrote ${input.lastWriteAt.toISOString()}${
        conditional
          ? pathRuns === 0
            ? " — and the deferred path wrote no heartbeat in this window either, so the whole path did not run"
            : ` — ${conditional}, so confirm the condition did not occur before reading this as dead`
          : ""
      }`;
    } else if (input.writesInWindow < MIN_POWERED_N) {
      status = "UNDERPOWERED";
      reason = `${counted} across ${denominator.count} ${turnsLabel} (${pct}) — below n=${MIN_POWERED_N}, cannot support a rate${
        conditional ? `; ${conditional}, so this is a rare phenomenon, not a dead writer` : ""
      }`;
    } else {
      status = "HEALTHY";
      reason = `${counted} across ${denominator.count} ${turnsLabel} (${pct}), no failures logged`;
    }

    return {
      instrument: input.instrument,
      status,
      denominator,
      reason,
      lastWriteAt: input.lastWriteAt ? input.lastWriteAt.toISOString() : null,
      writesInWindow: input.writesInWindow,
      failuresInWindow,
      coverage,
      conditional,
    };
  });

  const attention = rows
    .filter((r) => r.status !== "HEALTHY")
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);

  return {
    windowHours,
    since: since.toISOString(),
    assistantTurns,
    rows,
    attention,
    failuresTruncated: failures.truncated,
    sourceErrors: [...sourceErrors],
    caveat:
      "Status is derived from rows written, not from code existing. UNDERPOWERED means a " +
      "reading exists and cannot support a rate; for a conditional instrument that is " +
      "expected. STALE means turns happened and the instrument did not write. Neither " +
      "is HEALTHY, and neither reads as \"no failures\" here. Coverage above 100% is not " +
      "an error: per-selection instruments fire once per attempt, and attempts exceed " +
      "persisted assistant replies (retries, aborted streams) — measured 294 vs 253.",
  };
}

// ── Live sources ─────────────────────────────────────────────────────────
// Four instruments write `system_metrics` under their own metric name. Two
// write their own tables. Each is read the same way: newest row ever, rows in
// window. Kept as explicit per-instrument adapters rather than a generic
// registry, because the two table-backed ones do not share a column name and a
// registry that pretended they did would be the exact "looks uniform, is not"
// shape this reader exists to catch.

async function systemMetricLiveness(instrument: string, since: Date): Promise<InstrumentLivenessInput> {
  const [last, writesInWindow] = await Promise.all([
    prisma.systemMetric.findFirst({
      where: { metric: instrument },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.systemMetric.count({ where: { metric: instrument, createdAt: { gte: since } } }),
  ]);
  return { instrument, lastWriteAt: last?.createdAt ?? null, writesInWindow };
}

async function toolSelectionTurnLiveness(since: Date): Promise<InstrumentLivenessInput> {
  const [last, writesInWindow] = await Promise.all([
    prisma.toolSelectionTurn.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.toolSelectionTurn.count({ where: { createdAt: { gte: since } } }),
  ]);
  return { instrument: "tool_selection_turn", lastWriteAt: last?.createdAt ?? null, writesInWindow };
}

async function toolInvocationLiveness(since: Date): Promise<InstrumentLivenessInput> {
  // tool_telemetry is aggregate-by-tool (one upserted row per tool), so "rows
  // in window" is not a write count. `updatedAt` moves on every upsert, so
  // rows touched in the window is the honest liveness proxy, and the newest
  // `lastCallAt` is the last time any tool was actually invoked.
  const [last, writesInWindow] = await Promise.all([
    prisma.toolTelemetry.findFirst({
      where: { lastCallAt: { not: null } },
      orderBy: { lastCallAt: "desc" },
      select: { lastCallAt: true },
    }),
    prisma.toolTelemetry.count({ where: { updatedAt: { gte: since } } }),
  ]);
  return {
    instrument: "tool_invocation",
    lastWriteAt: last?.lastCallAt ?? null,
    writesInWindow,
    unit: "tools touched",
  };
}

const SYSTEM_METRIC_INSTRUMENTS = new Set([
  "tool.surfaced",
  "operation.integrity_shadow",
  "action.done.shadow",
  "tool.chosen",
  "recommendation.novelty",
  DEFERRED_TURN_INSTRUMENT,
]);

/** Live read. Every KNOWN_INSTRUMENT gets a row, or the view names the one it cannot source. */
export async function buildInstrumentHealth(windowHours = 24): Promise<InstrumentHealthView> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // Two awaits, not one: a single Promise.all over a heterogeneous spread
  // widens every element to the union type, and `failures` stops being an
  // InstrumentFailureView at the call below. A typed 2-tuple plus a
  // homogeneous map is the same round-trips and stays typed.
  // 2026-09-22 (review on #2482) · EVERY read degrades on its own. One rejected
  // source used to reject the whole view, and the panel rendered "no data" as no
  // warning - a monitoring failure disguised as calm. A failed read is now an
  // UNKNOWN row (or an UNKNOWN denominator) that says which read failed.
  const sourceErrors: string[] = [];
  const [failures, assistantTurns] = await Promise.all([
    buildInstrumentFailures(windowHours).catch((e: unknown): InstrumentFailureView => {
      sourceErrors.push(`failures: ${describeError(e)}`);
      return {
        windowHours,
        since: since.toISOString(),
        totalFailures: 0,
        failing: [],
        instrumentsWithNoFailures: [],
        truncated: true, // nothing was read, so every count is a floor of zero
        sampleCap: 0,
        caveat: "the failure reader itself failed; no failure count here is a reading",
      };
    }),
    prisma.chatMessage.count({ where: { role: "assistant", createdAt: { gte: since } } }).catch((e: unknown) => {
      sourceErrors.push(`assistant turns: ${describeError(e)}`);
      return null;
    }),
  ]);
  const inputs = await Promise.all(
    KNOWN_INSTRUMENTS.map((name): Promise<InstrumentLivenessInput> => {
      const read = (): Promise<InstrumentLivenessInput> => {
        if (SYSTEM_METRIC_INSTRUMENTS.has(name)) return systemMetricLiveness(name, since);
        if (name === "tool_selection_turn") return toolSelectionTurnLiveness(since);
        if (name === "tool_invocation") return toolInvocationLiveness(since);
        // A registered instrument with no liveness source is itself a finding.
        // It reports as NEVER_RAN with a reason naming the gap, rather than
        // vanishing from the view — vanishing is how instruments become alibis.
        return Promise.resolve({ instrument: name, lastWriteAt: null, writesInWindow: 0 });
      };
      return read().catch((e: unknown) => ({
        instrument: name,
        lastWriteAt: null,
        writesInWindow: 0,
        sourceError: describeError(e),
      }));
    }),
  );

  return assembleInstrumentHealth(inputs, failures, assistantTurns, windowHours, since, sourceErrors);
}
