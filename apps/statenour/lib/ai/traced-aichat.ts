/**
 * Traced aiChat wrapper · v10 Track E.5 follow-up · Apr 30.
 *
 * 17 routes call `aiChat()` from lib/ai/provider.ts. Wiring each one
 * with the manual mintTraceId + recordTrace pattern (~10 lines per
 * file) is mechanical and error-prone. This helper does it once.
 *
 * Usage at call site — replace `aiChat(messages, taskType)` with:
 *
 *   const result = await tracedAiChat({
 *     label: "coach-goal",         // free-form, shows up in dashboard
 *     source: "tool",              // chat/cron/autonomous/tool/journal/brain/other
 *     metadata: { goalId },        // optional, persisted on the trace row
 *   }, messages, "reason");
 *
 * The result shape is identical to aiChat — a drop-in replacement.
 *
 * The actually-served provider + model come from the resolved aiChat
 * result (which knows which fallback fired). outputChars is the
 * cleaned content's length.
 *
 * Composes with v9.1.27 markProviderFailed + v10 streamWithFallback;
 * those work below this layer.
 *
 * wave-AO · server-only enforcement. tracedAiChat dynamic-imports
 * budget.ts (which transitively pulls prisma) for the edge-wrap budget
 * gate. budget.ts has `import "server-only"` — adding the same here
 * forces a clear compile-time error if any client chain ever reaches
 * this wrapper. Audited at wave-AO: no client-reach exists today (chain
 * verified via grep across components/ + hooks/ + app/(mastery)/).
 */
import "server-only";

import { aiChat, type AiMessage, type AiResponse, type TaskType } from "./provider";
import {
  mintTraceId,
  recordTrace,
  type TraceSource,
} from "./agent-trace";

export interface TracedAiChatOpts {
  /** Free-form label, e.g. "coach-goal", "weekly-review-plan". */
  label: string;
  /** Where this call originated (chat/tool/cron/...). */
  source: TraceSource;
  /** Optional pre-existing trace to chain under (autonomous → tool, etc). */
  parentTraceId?: string;
  /** Optional metadata blob persisted on the trace row. */
  metadata?: Record<string, unknown>;
}

/**
 * v10.0.64 · Factory for module-scoped traced aiChat. Returns a
 * drop-in `aiChat(messages, taskType)` function that auto-applies
 * a fixed label + source to every call. Use at the top of a module:
 *
 *   const aiChat = makeTracedAiChat("thinking-engine"); // default source="brain"
 *   const aiChat = makeTracedAiChat("learn-cron", "cron");
 *   const aiChat = makeTracedAiChat("auto-rename", "chat");
 *
 * This eliminates 30 call-site rewrites for the AgentTrace coverage
 * sweep — each consumer just changes its import line once.
 */
export function makeTracedAiChat(label: string, source: TraceSource = "brain") {
  return async (
    messages: AiMessage[],
    taskType: TaskType = "reason",
    runtimeOpts: { signal?: AbortSignal; force?: boolean } = {},
  ): Promise<AiResponse> => {
    return tracedAiChat({ label, source }, messages, taskType, runtimeOpts);
  };
}

/**
 * Drop-in replacement for `aiChat()` that records an AgentTrace row
 * fire-and-forget on success or failure. Never blocks the caller —
 * a trace persistence error is swallowed by recordTrace's contract.
 */
export async function tracedAiChat(
  opts: TracedAiChatOpts,
  messages: AiMessage[],
  taskType: TaskType = "reason",
  runtimeOpts: { signal?: AbortSignal; force?: boolean } = {},
): Promise<AiResponse> {
  const traceId = opts.parentTraceId ?? mintTraceId();
  const startedAt = Date.now();
  // Approximate input chars from the joined message bodies — useful
  // for "what did this turn cost?" attribution without round-tripping
  // through the model's tokenizer.
  const inputChars = messages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);

  // wave-AO · edge-wrap budget gate (audit #366). Pre-wave, only the
  // app/api/ai/chat/route.ts route called assertWithinBudget — every
  // other callsite (~30 server-side files that use tracedAiChat plus
  // ~60 that call bare aiChat) bypassed the cap silently. Adding the
  // gate at this wrapper level makes the cap inherit-by-default for
  // every traced caller: brain engines, specialists, board/consult,
  // judge-eval, adversarial-critic, content tools, reasoning engine.
  //
  // Bare aiChat callers (~60) still bypass; they're a smaller surface
  // area and are migrated to tracedAiChat opportunistically as a
  // separate kaizen sweep (queued).
  //
  // Fail-open on budget-check infra errors (DB unavailable, etc): the
  // cost-cap is a safety net, not an availability dependency.
  let budgetNearingLimit = false;
  try {
    const { assertWithinBudget, BudgetExceededError } = await import("./budget");
    const budget = await assertWithinBudget();
    if (!budget.ok) {
      throw new BudgetExceededError(budget.status);
    }
    if (budget.status.percentUsed >= 80) {
      budgetNearingLimit = true;
    }
  } catch (err) {
    if (err instanceof Error && err.name === "BudgetExceededError") throw err;
    // (Fail-open on budget-check-itself failures.)
  }

  try {
    // wave-AO follow-up · forward runtime opts (signal, force) so the
    // factory returned by makeTracedAiChat is a true drop-in for bare
    // aiChat (callers passing { signal } no longer fail typecheck).
    const result = await aiChat(messages, taskType, { ...runtimeOpts, budgetNearingLimit });
    // v10.0.26 — aiChat returns { provider: "none", content: "<sentinel>" }
    // when every provider in the chain failed (graceful-degradation
    // sentinel, not an exception). Pre-v10.0.26 this was recorded as
    // a SUCCESS trace, hiding total provider outages from the operator
    // dashboard. Now we mark such traces with errorClass: "provider_none"
    // so /system/agent-traces colors them red.
    //
    // v10.0.183 — extended to also catch provider="emergency". Live probe
    // showed plan-project:plan running 116s and returning 187 chars of
    // a fallback sentinel ("I'm having trouble connecting...") with
    // errorClass=null — looked healthy, was actually total chain failure.
    // Same lie pattern as the soft-fail tools v10.0.179 fixed.
    const providerFailed = result.provider === "none" || result.provider === "emergency";
    // v10.0.212 · attach per-provider failure detail so /system/agent-
    // traces (and any forensic probe) can read the actual SDK error
    // for each tier without Vercel runtime log access. Truncate to
    // 5 entries × 500 chars each as a sane upper bound.
    const failureMeta = (result.failures ?? []).slice(0, 5).map((f) => ({
      provider: f.provider,
      modelId: f.modelId,
      durationMs: f.durationMs,
      errorName: f.errorName,
      failureClass: f.failureClass,
      message: f.message?.slice(0, 500),
      bodySnippet: f.bodySnippet?.slice(0, 300),
    }));
    const mergedMetadata = {
      ...(opts.metadata ?? {}),
      ...(failureMeta.length > 0 ? { providerFailures: failureMeta } : {}),
    };
    void recordTrace(
      {
        traceId,
        parentId: opts.parentTraceId ?? null,
        source: opts.source,
        label: opts.label,
        provider: providerFailed ? null : result.provider,
        model: result.model,
        inputChars,
        metadata: mergedMetadata,
      },
      {
        durationMs: Date.now() - startedAt,
        outputChars: result.content?.length ?? 0,
        errorClass: providerFailed
          ? result.provider === "emergency"
            ? "provider_emergency"
            : "provider_none"
          : null,
        errorMessage: providerFailed
          ? `all providers in chain failed — ${result.provider} sentinel returned · ${failureMeta.map(f => `${f.provider}/${f.failureClass}`).join(", ")}`
          : null,
      },
    );
    return result;
  } catch (err) {
    void recordTrace(
      {
        traceId,
        parentId: opts.parentTraceId ?? null,
        source: opts.source,
        label: opts.label,
        inputChars,
        metadata: opts.metadata,
      },
      {
        durationMs: Date.now() - startedAt,
        errorClass: "aichat_threw",
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    );
    throw err;
  }
}
