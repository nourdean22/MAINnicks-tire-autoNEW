/**
 * lib/services/chat/tool-telemetry-walk.ts — persist-turn decomposition
 * slice (2026-07-25). The steps->toolResults telemetry walk moved
 * VERBATIM from buildOnFinish: the v10.0.179 soft-fail detection
 * ({ error } return values counted as failures, not just SDK throws),
 * recordToolInvocation dispatch, and the capturedToolCalls buffer the
 * explainability envelope + claim verifier consume downstream.
 */

import { recordToolInvocation, isConfigurationError } from "@/lib/ai/tool-telemetry";
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

/**
 * Shadow-only: persist ONE operation-integrity receipt for the turn.
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
 */
function recordOperationIntegrityShadow(
  calls: ReadonlyArray<CapturedToolCall>,
  convId: string | undefined,
): void {
  if (calls.length === 0) return;
  const summary = summarizeOperations(calls);
  if (summary.consequentialCount === 0) return;

  void import("@/lib/services/metrics")
    .then(({ recordMetric }) =>
      recordMetric("operation.integrity_shadow", summary.consequentialCount, {
        unit: "count",
        tags: {
          conversationId: convId ?? null,
          legacySdkSuccesses: summary.legacySdkSuccesses,
          strictVerified: summary.strictVerified,
          legacyStrictGap: summary.legacyStrictGap,
          strictDoneEligible: summary.strictDoneEligible,
          operations: summary.operations,
        },
        source: "chat",
      }),
    )
    .catch(() => {});
}

export function walkToolTelemetry(args: {
  ev: { steps?: unknown };
  convId: string | undefined;
}): CapturedToolCall[] {
  const { ev, convId } = args;
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
    }).catch(() => {});

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

  // Shadow measurement only. This intentionally does NOT mutate `ok` or the
  // existing ActionReceipt/Done guard yet; promotion requires real traffic.
  recordOperationIntegrityShadow(capturedToolCalls, convId);

  return capturedToolCalls;
}
