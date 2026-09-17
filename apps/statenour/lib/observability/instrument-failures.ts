/**
 * Which measurement instruments are FAILING TO WRITE, by name.
 *
 * THE PROBLEM THIS EXISTS FOR. A shadow or census instrument records a number
 * per turn. When its write fails, the table simply has fewer rows — and a
 * reader cannot tell "measured, found nothing" from "never managed to
 * measure". #2359 is the worked example: a query that could never succeed
 * rendered as "no surfacing data exists" for three weeks over 456 rows that
 * did exist.
 *
 * Review found the same shape again on `action.done.shadow` (2026-09-16): it
 * was wired to the fail-soft `recordMetric`, so its own error branch was dead
 * code. Fixing that one call site is not enough — `tool.surfaced` and
 * `operation.integrity_shadow` had the identical `.catch(() => {})`, one of
 * them with a comment calling it a feature. A per-SITE fix leaves siblings; the
 * cure is to give every instrument the same failure channel and one reader.
 *
 * WHY errorLog AND NOT AN IN-PROCESS COUNTER. `tool-selection-telemetry.ts`
 * already keeps `writesAttempted`/`writesFailed` and exposes `looksBroken` —
 * and nothing reads it. That is not only an oversight: those counters are
 * module-level and lambda-instance scoped, so a tRPC query answering from a
 * DIFFERENT instance than the chat turn sees its own zeros. In-process counters
 * cannot answer a cross-instance question. `logError` persists a row and also
 * writes to the console, so it survives the instance that produced it.
 *
 * ⚠ WHAT THIS CANNOT TELL YOU. It detects instruments that FAILED, not
 * instruments that never ran. An instrument whose call site was deleted, or
 * whose enclosing branch is never entered, reports nothing here and looks
 * identical to a healthy one. That is the exact defect review caught on the
 * Done-shadow's zero-action arm, and no error-log reader can see it — only a
 * wiring test can. `instrumentsWithNoFailures` is therefore reported as
 * "no failures LOGGED", never as "healthy".
 */
import { prisma } from "@/lib/prisma";
import { INSTRUMENT_SCOPE_PREFIX, instrumentScope } from "./instrument-scope";

// Re-exported so a caller can reach either from one place, while the call
// sites themselves import the prisma-free module and stay lazy.
export { INSTRUMENT_SCOPE_PREFIX, instrumentScope };

/**
 * Instruments this reader knows about, so the view can NAME a silent one
 * rather than only listing whoever happened to fail.
 *
 * Keeping the list here rather than deriving it is deliberate: derivation would
 * only find instruments that are currently wired, which is precisely the thing
 * that can go missing.
 */
export const KNOWN_INSTRUMENTS: readonly string[] = [
  "tool.surfaced",
  "operation.integrity_shadow",
  "action.done.shadow",
  "tool_selection_turn",
  // Backs the census's invoked / high-failure / stale buckets and the stored
  // `lastErrors` the description-rewrite cron reads as evidence. Found by the
  // wiring sweep rather than by reading — it had the same `.catch(() => {})`.
  "tool_invocation",
];

export interface InstrumentFailureRow {
  instrument: string;
  failures: number;
  lastAt: string | null;
  lastMessage: string | null;
}

export interface InstrumentFailureView {
  windowHours: number;
  since: string;
  totalFailures: number;
  /** Instruments that logged at least one write failure in the window. */
  failing: InstrumentFailureRow[];
  /**
   * Known instruments with no logged failure. NOT a health claim — see the
   * module header. An instrument that never ran also appears here.
   */
  instrumentsWithNoFailures: string[];
  /**
   * True when the query hit its row cap, so every count here is a FLOOR.
   *
   * Without this, a hard-failing instrument would silently read as exactly
   * `sampleCap` failures — understating severity precisely when the number
   * matters most, and looking identical to a genuine plateau. A capped count
   * presented as a total is the same defect this module exists to expose.
   */
  truncated: boolean;
  sampleCap: number;
  caveat: string;
}

/** Row cap for the live query. Exported so the view and the caller cannot disagree. */
export const INSTRUMENT_FAILURE_SAMPLE_CAP = 500;

/** Pure — extracted so the parsing and grouping are testable without a DB. */
export function assembleInstrumentFailures(
  rows: ReadonlyArray<{ message: string; createdAt: Date }>,
  windowHours: number,
  since: Date,
  sampleCap: number = INSTRUMENT_FAILURE_SAMPLE_CAP,
): InstrumentFailureView {
  const byInstrument = new Map<string, InstrumentFailureRow>();

  for (const row of rows) {
    // logError writes `[${source}] ${message}`; source is `instrument.<metric>`.
    const match = /^\[instrument\.([^\]]+)\]\s*(.*)$/.exec(row.message);
    if (!match) continue;
    const name = match[1];
    const existing = byInstrument.get(name);
    const at = row.createdAt.toISOString();
    if (!existing) {
      byInstrument.set(name, { instrument: name, failures: 1, lastAt: at, lastMessage: match[2] || null });
      continue;
    }
    existing.failures += 1;
    // Rows arrive newest-first, but do not depend on it — compare.
    if (!existing.lastAt || at > existing.lastAt) {
      existing.lastAt = at;
      existing.lastMessage = match[2] || null;
    }
  }

  // The cap was hit, so every count below is a FLOOR, not a total.
  const truncated = rows.length >= sampleCap;
  const failing = [...byInstrument.values()].sort((a, b) => b.failures - a.failures);
  const failingNames = new Set(failing.map((f) => f.instrument));

  return {
    windowHours,
    since: since.toISOString(),
    totalFailures: failing.reduce((sum, f) => sum + f.failures, 0),
    failing,
    instrumentsWithNoFailures: KNOWN_INSTRUMENTS.filter((n) => !failingNames.has(n)),
    truncated,
    sampleCap,
    caveat:
      "Detects instruments that FAILED to write, not instruments that never ran. " +
      "`instrumentsWithNoFailures` means no failure was logged in the window — an " +
      "instrument whose call site was removed, or whose branch is never entered, is " +
      "indistinguishable from a healthy one here and needs a wiring test instead." +
      " When `truncated` is true the query hit its row cap and every count is a FLOOR.",
  };
}

/** Live read over the persisted error log. */
export async function buildInstrumentFailures(windowHours = 24): Promise<InstrumentFailureView> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const rows = await prisma.errorLog.findMany({
    where: {
      createdAt: { gte: since },
      message: { startsWith: `[${INSTRUMENT_SCOPE_PREFIX}.` },
    },
    select: { message: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: INSTRUMENT_FAILURE_SAMPLE_CAP,
  });
  return assembleInstrumentFailures(rows, windowHours, since);
}
