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
 *                 a reading exists and cannot support a rate
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
  KNOWN_INSTRUMENTS,
  type InstrumentFailureView,
} from "./instrument-failures";

export type InstrumentStatus = "HEALTHY" | "UNDERPOWERED" | "STALE" | "NEVER_RAN" | "FAILING";

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
}

function describeCount(n: number, unit: NonNullable<InstrumentLivenessInput["unit"]>): string {
  if (unit === "tools touched") return `${n} tool${n === 1 ? "" : "s"} touched`;
  return `${n} write${n === 1 ? "" : "s"}`;
}

export interface InstrumentHealthRow {
  instrument: string;
  status: InstrumentStatus;
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
  caveat: string;
}

const STATUS_RANK: Record<InstrumentStatus, number> = {
  FAILING: 0,
  NEVER_RAN: 1,
  STALE: 2,
  UNDERPOWERED: 3,
  HEALTHY: 4,
};

/** Pure — the status rules, with no database and no clock but the one passed in. */
export function assembleInstrumentHealth(
  inputs: ReadonlyArray<InstrumentLivenessInput>,
  failures: InstrumentFailureView,
  assistantTurns: number,
  windowHours: number,
  since: Date,
): InstrumentHealthView {
  const failuresByName = new Map(failures.failing.map((f) => [f.instrument, f.failures]));

  const rows: InstrumentHealthRow[] = inputs.map((input) => {
    const failuresInWindow = failuresByName.get(input.instrument) ?? 0;
    const conditional = CONDITIONAL_INSTRUMENTS[input.instrument] ?? null;
    const coverage = assistantTurns > 0 ? input.writesInWindow / assistantTurns : null;
    const pct = coverage === null ? "n/a" : `${(coverage * 100).toFixed(1)}%`;
    const unit = input.unit ?? "writes";
    const counted = describeCount(input.writesInWindow, unit);

    let status: InstrumentStatus;
    let reason: string;
    if (failuresInWindow > 0) {
      status = "FAILING";
      reason = `${failuresInWindow} write failure${failuresInWindow === 1 ? "" : "s"} logged in ${windowHours}h — every count from this instrument is a floor`;
    } else if (input.lastWriteAt === null) {
      status = "NEVER_RAN";
      reason = "no row has ever been written — a wiring test, not a log reader, is what can find why";
    } else if (input.writesInWindow === 0 && assistantTurns > 0) {
      status = "STALE";
      reason = `0 writes across ${assistantTurns} assistant turns; last wrote ${input.lastWriteAt.toISOString()}${
        conditional ? ` — ${conditional}, so confirm the condition did not occur before reading this as dead` : ""
      }`;
    } else if (input.writesInWindow < MIN_POWERED_N) {
      status = "UNDERPOWERED";
      reason = `${counted} across ${assistantTurns} turns (${pct}) — below n=${MIN_POWERED_N}, cannot support a rate${
        conditional ? `; ${conditional}, so this is a rare phenomenon, not a dead writer` : ""
      }`;
    } else {
      status = "HEALTHY";
      reason = `${counted} across ${assistantTurns} turns (${pct}), no failures logged`;
    }

    return {
      instrument: input.instrument,
      status,
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
]);

/** Live read. Every KNOWN_INSTRUMENT gets a row, or the view names the one it cannot source. */
export async function buildInstrumentHealth(windowHours = 24): Promise<InstrumentHealthView> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // Two awaits, not one: a single Promise.all over a heterogeneous spread
  // widens every element to the union type, and `failures` stops being an
  // InstrumentFailureView at the call below. A typed 2-tuple plus a
  // homogeneous map is the same round-trips and stays typed.
  const [failures, assistantTurns] = await Promise.all([
    buildInstrumentFailures(windowHours),
    prisma.chatMessage.count({ where: { role: "assistant", createdAt: { gte: since } } }),
  ]);
  const inputs = await Promise.all(
    KNOWN_INSTRUMENTS.map((name): Promise<InstrumentLivenessInput> => {
      if (SYSTEM_METRIC_INSTRUMENTS.has(name)) return systemMetricLiveness(name, since);
      if (name === "tool_selection_turn") return toolSelectionTurnLiveness(since);
      if (name === "tool_invocation") return toolInvocationLiveness(since);
      // A registered instrument with no liveness source is itself a finding.
      // It reports as NEVER_RAN with a reason naming the gap, rather than
      // vanishing from the view — vanishing is how instruments become alibis.
      return Promise.resolve({ instrument: name, lastWriteAt: null, writesInWindow: 0 });
    }),
  );

  return assembleInstrumentHealth(inputs, failures, assistantTurns, windowHours, since);
}
