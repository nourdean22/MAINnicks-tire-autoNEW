/**
 * lib/services/chat/tool-telemetry-walk.ts — persist-turn decomposition
 * slice (2026-07-25). The steps->toolResults telemetry walk moved
 * VERBATIM from buildOnFinish: the v10.0.179 soft-fail detection
 * ({ error } return values counted as failures, not just SDK throws),
 * recordToolInvocation dispatch, and the capturedToolCalls buffer the
 * explainability envelope + claim verifier consume downstream.
 */

import { recordToolInvocation, isConfigurationError } from "@/lib/ai/tool-telemetry";

export interface CapturedToolCall {
  name: string;
  ok: boolean;
  durationMs: number;
  args?: Record<string, unknown>;
  /**
   * 2026-09-10 · normalized, truncated text of what the tool RETURNED.
   *
   * `call.result` was already being read here (to detect soft errors)
   * and then discarded -- so the one artifact that can prove a name in
   * the reply came from a real lookup was available at this seam and
   * thrown away. Without it, the named-source receipt check
   * (lib/ai/chat/named-source-claims.ts) is structurally blind: it can
   * see THAT a tool fired but never WHAT it resolved, so it could only
   * ever abstain.
   *
   * Truncated hard because this rides into the AgentTrace metadata blob
   * and a full search payload would bloat every persisted turn.
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

export function walkToolTelemetry(args: {
  ev: { steps?: unknown };
  convId: string | undefined;
}): CapturedToolCall[] {
  const { ev, convId } = args;
  // Apr 19 · Tool telemetry. Walk steps → toolResults.
  // v10.0.156 · also collect into capturedToolCalls so the
  // explainability envelope (built later at recordTrace time)
  // can populate envelope.toolsCalled[] — closes the gap noted
  // in v10.0.151's "intentional next-slice gap" comment.
  const capturedToolCalls: CapturedToolCall[] = [];
  if (Array.isArray(ev.steps)) {
    interface ToolCallShape {
      toolName?: string;
      name?: string;
      executionDurationMs?: number;
      durationMs?: number;
      error?: unknown;
      result?: unknown;
      args?: Record<string, unknown>;
    }
    interface StepShape {
      toolCalls?: ToolCallShape[];
      toolResults?: ToolCallShape[];
    }
    for (const step of ev.steps) {
      if (!step || typeof step !== "object") continue;
      const s = step as StepShape;
      const callList: ToolCallShape[] = Array.isArray(s.toolResults) && s.toolResults.length > 0
        ? s.toolResults
        : Array.isArray(s.toolCalls)
          ? s.toolCalls
          : [];
      for (const call of callList) {
        const toolName = call?.toolName || call?.name;
        if (!toolName) continue;
        // ─────────────────────────────────────────────────────────
        // v10.0.179 · TELEMETRY BLIND SPOT FIX
        //
        // Pre-fix only checked call.error — the AI SDK sets that
        // when execute() THROWS. But ~22 tools (all GitHub, all
        // Drive, getShopSnapshot, queryNickstire, syncDriveMemory,
        // toolHealth itself, etc.) use the soft-fail pattern:
        //
        //   execute() {
        //     if (!process.env.GITHUB_TOKEN) {
        //       return { error: "GITHUB_TOKEN not set" };
        //     }
        //     ...
        //   }
        //
        // Returning `{ error }` from execute() is a SUCCESSFUL
        // call to the SDK — call.error stays undefined — so
        // telemetry recorded success=true while the model
        // received an error payload every turn.
        //
        // Net effect: a revoked GITHUB_TOKEN, missing
        // NICKS_ADMIN_URL, or expired Drive credentials would
        // surface as 100% success on the dashboard while the
        // model silently got `{ error: "..." }` on every call.
        // The circuit breaker never tripped. Operators couldn't
        // see the failure until they manually opened a tool's
        // raw output.
        //
        // Fix: ALSO inspect the tool's return value for an
        // `error` field. If present, treat as fail. This makes
        // soft-fails visible to telemetry, the circuit breaker,
        // and the operator-facing envelope.
        // ─────────────────────────────────────────────────────────
        const sdkErrored = call?.error !== undefined && call?.error !== null;
        const result = call?.result;
        const softErrored =
          !sdkErrored &&
          !!result &&
          typeof result === "object" &&
          "error" in (result as Record<string, unknown>) &&
          (result as Record<string, unknown>).error !== undefined &&
          (result as Record<string, unknown>).error !== null;
        const errored = sdkErrored || softErrored;
        const durationMs =
          typeof call?.executionDurationMs === "number"
            ? call.executionDurationMs
            : typeof call?.durationMs === "number"
              ? call.durationMs
              : 0;
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
        const toolArgs = call?.args as Record<string, unknown> | undefined;

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
        // Mirror into the envelope buffer — same source, same data,
        // just persisted in two places (telemetry table + AgentTrace
        // metadata). The envelope view is operator-facing and joins
        // with policy id; the telemetry table feeds /system/tools.
        capturedToolCalls.push({
          name: toolName,
          ok: !errored,
          durationMs,
          args: toolArgs,
          resultDigest: digestResult(result),
        });
      }
    }
  }
  return capturedToolCalls;
}
