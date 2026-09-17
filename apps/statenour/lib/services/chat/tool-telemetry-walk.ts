/**
 * lib/services/chat/tool-telemetry-walk.ts — persist-turn decomposition
 * slice (2026-07-25). The steps->toolResults telemetry walk moved
 * VERBATIM from buildOnFinish: the v10.0.179 soft-fail detection
 * ({ error } return values counted as failures, not just SDK throws),
 * recordToolInvocation dispatch, and the capturedToolCalls buffer the
 * explainability envelope + claim verifier consume downstream.
 */

import { recordToolInvocation, isConfigurationError } from "@/lib/ai/tool-telemetry";
import { logError } from "@/lib/utils/error-log";
import { instrumentScope } from "@/lib/observability/instrument-scope";
import { classifyToolEffect, type ToolEffectClass } from "@/lib/ai/receipts/action-receipt";
import { operationStateFrom, type OperationState } from "@/lib/ai/chat/turn-control-plane";
import { summarizeOperations } from "@/lib/ai/chat/turn-execution-summary";
import {
  normalizeAiSdkToolObservations,
  type ToolObservationShape,
} from "@/lib/ai/chat/ai-sdk-tool-observation";

export interface CapturedToolCall {
  name: string;
  ok: boolean;
  durationMs: number;
  args?: Record<string, unknown>;
  /** Whether the SDK exposed any return value at all (including null). */
  resultObserved: boolean;
  /** Which SDK-shaped evidence the compatibility seam normalized. */
  observationShape?: ToolObservationShape;
  /** read/write/unknown from the canonical tool-effect classifier. */
  effectClass: ToolEffectClass;
  /**
   * Conservative completion state for the control plane.
   *
   * IMPORTANT: PROVIDER_ACCEPTED is intentionally weaker than VERIFIED.
   * A successful write result proves the tool/provider accepted the operation;
   * only an independent postcondition/read-back may promote it to VERIFIED.
   */
  operationState: OperationState;
  /**
   * 2026-09-10 · normalized, truncated text of what the tool RETURNED.
   *
   * The SDK-specific output (`result` in the app's v6 observations, `output`
   * in documented v7 ToolResult) is normalized before this point. Without the
   * digest, named-source receipt checks can see THAT a tool fired but not WHAT
   * it resolved.
   *
   * Truncated hard because this rides into the AgentTrace metadata blob and a
   * full search payload would bloat every persisted turn.
   */
  resultDigest?: string;
}

/** Flatten an arbitrary tool result into matchable text. */
function digestResult(result: unknown, max = 4000): string {
  if (result == null) return "";
  let text: string;
  if (typeof result === "string") text = result;
  else {
    try {
      text = JSON.stringify(result);
    } catch {
      // Circular or non-serializable payload. Empty digest is correct:
      // it means "could not read", and the consumer treats an absent
      // digest as blind rather than as proof of nothing.
      return "";
    }
  }
  return text.replace(/\s+/g, " ").slice(0, max);
}

/** One row this walk wants written. Pure data — no IO, no Prisma, no import. */
interface MetricWrite {
  metric: string;
  value: number;
  tags: Record<string, unknown>;
  /**
   * The instrument scope this lane reports failures under, built at the BUILDER
   * with a string literal rather than derived from `metric` at the emit site.
   *
   * That is deliberate and it is not stylistic. `instrument-failures.test.ts`
   * scans lib/ and app/ for `instrumentScope("<name>")` literals and asserts
   * every entry in KNOWN_INSTRUMENTS has a producer — an instrument nothing
   * reports under reads as healthy forever. A generic `instrumentScope(w.metric)`
   * at the emit site compiles and runs identically, and makes both lanes
   * INVISIBLE to that scan. Keeping the literal at the builder costs one line
   * and keeps the orphan check able to see this file.
   */
  scope: string;
  /** Correlation value for the failure log, so a dead lane names itself. */
  logContext: Record<string, unknown>;
}

/**
 * Shadow-only: the ONE operation-integrity receipt for the turn, or null.
 *
 * `tool_telemetry` is deliberately aggregate-by-tool and therefore the wrong
 * place for per-turn operation state. `system_metrics` already accepts JSON
 * tags and is used by the chat tool-surfacing census, so this records the
 * control-plane view without schema work and without changing user-facing Done
 * enforcement yet.
 *
 * The math comes from `summarizeOperations()`, the SAME compiler used by the
 * normalized TurnExecution summary. Shadow telemetry and future persistence
 * therefore cannot quietly disagree about what "provider accepted" means.
 *
 * Returns a payload instead of writing it. Both lanes want the same module, and
 * issuing two dynamic imports per turn was worse than one — see `loadMetrics`.
 */
function buildOperationIntegrityShadow(
  calls: ReadonlyArray<CapturedToolCall>,
  convId: string | undefined,
): MetricWrite | null {
  if (calls.length === 0) return null;
  const summary = summarizeOperations(calls);
  if (summary.consequentialCount === 0) return null;

  return {
    metric: ACTION_INTEGRITY_METRIC,
    value: summary.consequentialCount,
    scope: instrumentScope("operation.integrity_shadow"),
    tags: {
      conversationId: convId ?? null,
      legacySdkSuccesses: summary.legacySdkSuccesses,
      strictVerified: summary.strictVerified,
      legacyStrictGap: summary.legacyStrictGap,
      strictDoneEligible: summary.strictDoneEligible,
      operations: summary.operations,
    },
    logContext: { conversationId: convId ?? null },
  };
}

const ACTION_INTEGRITY_METRIC = "operation.integrity_shadow";
const CHOSEN_TOOLS_METRIC = "tool.chosen";

/**
 * The metrics module, imported at most once per process.
 *
 * Not a micro-optimisation. Measured 2026-09-17: a SECOND dynamic import of
 * this module issued while the first is still in flight never settles under
 * vitest's module mock, so the second lane's write vanished and the test that
 * asserted on it timed out with no row and no error. Memoising means there is
 * only ever one in-flight import to race with.
 *
 * A REJECTED promise is deliberately not cached: a transient import failure
 * must not disable the instrument for the lifetime of the process. Clearing on
 * rejection costs one retry per failing turn and keeps the lane recoverable.
 */
let metricsModule: Promise<typeof import("@/lib/services/metrics")> | null = null;
function loadMetrics(): Promise<typeof import("@/lib/services/metrics")> {
  if (!metricsModule) {
    metricsModule = import("@/lib/services/metrics").catch((err) => {
      metricsModule = null;
      throw err;
    });
  }
  return metricsModule;
}

/**
 * Issue every metric this turn produced, through a SINGLE dynamic import.
 *
 * WHY ONE IMPORT AND NOT TWO. Each lane used to import
 * `@/lib/services/metrics` for itself. In production that is merely wasteful —
 * the module is already in the cache, so the second import resolves instantly.
 * Under vitest's module mock it is worse than wasteful: measured 2026-09-17,
 * only the FIRST dynamic import of the mocked module ever settles, and every
 * later one hangs forever. Two lanes in one turn meant the second lane's write
 * silently never happened, and a test asserting on it timed out with no row.
 *
 * That is a harness artifact, not a production bug — but it is the exact shape
 * this file keeps warning about: a fire-and-forget instrument whose failure is
 * a MISSING row, and a missing row reads as "nothing to report". Collapsing to
 * one import removes the hazard instead of documenting it, and costs one fewer
 * dynamic import on every chat turn.
 *
 * Non-blocking, never awaited, never throws — but NOT silent. Failures log
 * under the shared instrument scope so `buildInstrumentFailures()` can name the
 * instrument. `instrumentScope` comes from the static, prisma-free import at
 * the top of this file; reaching for it through `instrument-failures` would
 * drag the Prisma client onto the chat hot path for a string helper, which is
 * what `instrument-scope.ts` exists to prevent.
 */
function emitMetricWrites(writes: ReadonlyArray<MetricWrite>): void {
  if (writes.length === 0) return;
  void loadMetrics()
    .then(({ recordMetricStrict }) => {
      for (const w of writes) {
        void recordMetricStrict(w.metric, w.value, {
          unit: "count",
          tags: w.tags,
          source: "chat",
        }).catch((err) => logError(w.scope, err, w.logContext, "warn"));
      }
    })
    .catch((err) => {
      // The dynamic import itself failed — every lane for this turn is lost,
      // and that must not be silent either.
      console.warn("[instrument.chat-metrics] failed to load writer", err);
    });
}

/**
 * The CHOSEN half of the surfacing measurement — `tool.surfaced`'s mirror.
 *
 * WHY IT DID NOT EXIST, AND WHAT THAT COST. `prepare-tools.ts` has recorded
 * one `tool.surfaced` row per turn (traceId + the offered names) since the
 * census needed a denominator. Nothing recorded the matching NUMERATOR. The
 * only record of what actually ran is `tool_telemetry`, which is aggregate-by-
 * tool and lifetime-cumulative, so "was THIS tool chosen on THIS turn" has
 * never been answerable. `chat_messages.parts` looks like it should answer it —
 * the schema documents `tool-call` parts — but measured 2026-09-17 it holds
 * only `text` and `file` parts and never has.
 *
 * The cost was concrete: a tier-4 budget investigation could not compare tier
 * 4 against tier 5 per impression, because the best available proxy was
 * "has this tool EVER been called, lifetime", which conflates a tool that was
 * offered 109 times and declined with one that was never offered at all.
 * Sharing `traceId` with `tool.surfaced` makes that a join instead of a guess.
 *
 * ⚠ WRITTEN ON EVERY TURN, INCLUDING ZERO-TOOL TURNS — deliberately, and this
 * is the whole design. A turn where the model was offered 24 tools and chose
 * NONE is the single most informative row for a prune decision. Skipping it
 * would drop those turns out of the denominator and make "surfaced but never
 * chosen" read as "never surfaced", which is the exact confound the census was
 * built to resolve. `buildOperationIntegrityShadow` above returns null on an
 * empty call list — correct for IT, since it measures consequential operations
 * — and copying that guard here was the first thing I wrote and the first
 * thing I removed. The same defect shipped once already (#2381: a shadow
 * recorder nested inside `if (actions.length > 0)`, which made the zero case
 * invisible), so it is spelled out rather than left to judgement.
 *
 * Fire-and-forget, never awaited, never throws — but NOT silent: a dead writer
 * here produces a MISSING row, and a missing row reads as "that tool was never
 * chosen". Failures log under the shared instrument scope so
 * `buildInstrumentFailures()` can name this instrument.
 */
function buildChosenToolsWrite(
  calls: ReadonlyArray<CapturedToolCall>,
  traceId: string | undefined,
  convId: string | undefined,
  observation: ChosenObservation,
): MetricWrite {
  // Distinct names, so the value is directly comparable with `tool.surfaced`
  // (which counts distinct offered names). Raw invocation count rides along as
  // a tag rather than the value, so a tool called three times in one turn does
  // not read as three separate conversions.
  const chosen = observation.observed
    ? [...new Set(observation.names)].sort()
    : [];
  const failed = [...new Set(calls.filter((c) => !c.ok).map((c) => c.name))].sort();

  return {
    metric: CHOSEN_TOOLS_METRIC,
    // A blind turn's value is 0 because the field is a number, NOT because zero
    // tools ran. `observed` is the field that says which of those it is.
    value: chosen.length,
    scope: instrumentScope("tool.chosen"),
    tags: {
      traceId: traceId ?? null,
      conversationId: convId ?? null,
      tools: chosen,
      failed: observation.observed ? failed : [],
      invocations: observation.observed ? observation.names.length : 0,
      /**
       * ⚠ CONSUMERS MUST FILTER ON THIS. False means the turn's receipts were
       * not visible to this walk — NOT that the model chose nothing. Counting a
       * blind turn as a measured zero corrupts the numerator in the one
       * direction that looks like a finding: "tools were offered and declined".
       */
      observed: observation.observed,
      /** Where the names came from: the SDK step walk, or a lane's buffer. */
      source: observation.source,
    },
    logContext: { traceId: traceId ?? null },
  };
}

/**
 * Did this turn's receipts reach the walk at all, and from where?
 *
 * THE DISTINCTION THIS ENCODES, and why it is not optional. `alternate-paths.ts`
 * runs `generateText` with the pruned tools and then calls `buildOnFinish` with
 * only `{ text, finishReason }` — no `steps`. So the walk sees nothing and,
 * before this, wrote `tool.chosen = 0` for turns that HAD invoked tools. That is
 * worse than a missing row: it is a confident zero, and "offered and declined"
 * is exactly the conclusion the numerator exists to support.
 *
 * The codebase already drew this line and I missed it. `alternate-paths.ts` has
 * carried `laneReceiptsAvailable` with the comment "for them the receipt channel
 * is BLIND -- not 'no tool fired'. That distinction is load-bearing." The same
 * rule now governs this lane.
 *
 * Three states, deliberately not two:
 *   · sdk-steps  — the streaming path walked real `ev.steps`. A zero here IS a
 *                  measured zero and is the most informative row we get.
 *   · lane       — an alternate path could not give us steps but DID buffer the
 *                  tool names it saw. Measured, from a different source.
 *   · blind      — nobody could see. Never a finding, only an absence.
 */
type ChosenObservation =
  | { observed: true; source: "sdk-steps" | "lane"; names: string[] }
  | { observed: false; source: "blind"; names: never[] };

export function classifyChosenObservation(args: {
  sdkStepsPresent: boolean;
  capturedNames: string[];
  laneToolNames?: ReadonlyArray<string>;
  laneReceiptsAvailable?: boolean;
}): ChosenObservation {
  if (args.sdkStepsPresent) {
    return { observed: true, source: "sdk-steps", names: args.capturedNames };
  }
  if (args.laneReceiptsAvailable && args.laneToolNames) {
    return { observed: true, source: "lane", names: [...args.laneToolNames] };
  }
  return { observed: false, source: "blind", names: [] };
}

export function walkToolTelemetry(args: {
  ev: { steps?: unknown };
  convId: string | undefined;
  /**
   * The SAME id `prepare-tools.ts` stamps on `tool.surfaced`, minted once per
   * request in the chat route. Without it the chosen row cannot be joined to
   * the offered row and the pair measures nothing.
   */
  traceId?: string;
  /**
   * Tool names an alternate path buffered when it could not hand over
   * `ev.steps`. Supplied WITH `laneReceiptsAvailable`, because a lane that
   * buffered nothing and a lane that saw nothing are different facts.
   */
  laneToolNames?: ReadonlyArray<string>;
  /** The lane's own receipt-visibility flag — see `classifyChosenObservation`. */
  laneReceiptsAvailable?: boolean;
}): CapturedToolCall[] {
  const { ev, convId, traceId, laneToolNames, laneReceiptsAvailable } = args;
  // Captured BEFORE the walk: `normalizeAiSdkToolObservations` returns [] both
  // for "steps present, no tools ran" and for "no steps at all", so the
  // presence of the field is the only thing that tells them apart.
  const sdkStepsPresent = Array.isArray((ev as { steps?: unknown }).steps);
  const capturedToolCalls: CapturedToolCall[] = [];

  // Keep SDK field-name/version differences OUTSIDE the truth logic. The
  // compatibility seam accepts the app's observed v6 {result,args} shape and
  // AI SDK 7's documented {output,input} shape, and retains unmatched call IDs
  // as call-only observations rather than dropping ambiguous completion.
  const observations = normalizeAiSdkToolObservations(ev);

  for (const call of observations) {
    const toolName = call.toolName;
    const sdkErrored = call.error !== undefined && call.error !== null;
    const result = call.output;
    const resultObserved = call.outputObserved;

    // Soft-fail contract: a tool may return { error } without throwing. That is
    // a completed SDK call but a FAILED_KNOWN operation, not successful work.
    const softErrored =
      !sdkErrored &&
      !!result &&
      typeof result === "object" &&
      "error" in (result as Record<string, unknown>) &&
      (result as Record<string, unknown>).error !== undefined &&
      (result as Record<string, unknown>).error !== null;
    const errored = sdkErrored || softErrored;
    const durationMs = call.durationMs;
    const errorMessage = errored
      ? (() => {
          const e = sdkErrored
            ? call.error
            : (result as Record<string, unknown>).error;
          if (typeof e === "string") return e;
          if (e && typeof e === "object" && "message" in e) {
            return String((e as { message?: string }).message ?? "error");
          }
          return "error";
        })()
      : undefined;
    const toolArgs = call.input;
    const effectClass = classifyToolEffect(toolName);
    const operationState = operationStateFrom({
      attempted: true,
      knownFailure: errored,
      completionUnknown: !errored && effectClass !== "read" && !resultObserved,
      providerAccepted: !errored && effectClass === "write" && resultObserved,
      // A read result is itself the postcondition. A write result is not:
      // it needs an independent read-back before it may become VERIFIED.
      verified: !errored && effectClass === "read" && resultObserved,
    });

    recordToolInvocation({
      toolName,
      success: !errored,
      durationMs,
      errorMessage,
      conversationId: convId,
      // A missing-key refusal is misconfiguration, not flakiness --
      // it stays a recorded failure but must not trip the breaker
      // and strip the tool from the catalog for 30 minutes.
      configError: errored && isConfigurationError(errorMessage),
    }).catch((err) =>
      // Found by the instrument-failures wiring sweep, not by reading — the
      // third sibling of the same `.catch(() => {})` in one session. This is
      // the writer for `tool_telemetry`, which backs the census's invoked /
      // high-failure / stale buckets AND the stored `lastErrors` the
      // description-rewrite cron reads as evidence. A silent failure here does
      // not make those numbers wrong, it makes them SMALL — a tool that could
      // not be recorded is indistinguishable from a tool nobody called.
      logError(instrumentScope("tool_invocation"), err, { toolName, conversationId: convId ?? null }, "warn"),
    );

    capturedToolCalls.push({
      name: toolName,
      ok: !errored,
      durationMs,
      args: toolArgs,
      resultObserved,
      observationShape: call.shape,
      effectClass,
      operationState,
      resultDigest: digestResult(result),
    });
  }

  // Both lanes are built as pure payloads and issued through ONE import.
  //
  // The integrity shadow is measurement only: it intentionally does NOT mutate
  // `ok` or the existing ActionReceipt/Done guard: promotion requires real
  // traffic. It is null on a turn with no consequential operation.
  //
  // `tool.chosen` is UNCONDITIONAL — see its header. A zero-length call list is
  // a measurement, not the absence of one.
  const integrity = buildOperationIntegrityShadow(capturedToolCalls, convId);
  const observation = classifyChosenObservation({
    sdkStepsPresent,
    capturedNames: capturedToolCalls.map((c) => c.name),
    laneToolNames,
    laneReceiptsAvailable,
  });
  emitMetricWrites([
    ...(integrity ? [integrity] : []),
    buildChosenToolsWrite(capturedToolCalls, traceId, convId, observation),
  ]);

  return capturedToolCalls;
}
