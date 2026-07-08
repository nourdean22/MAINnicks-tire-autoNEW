/**
 * Tool-use Guardian · v10.0.357
 *
 * Wraps any async tool call with reliability infrastructure: failure
 * classification, exponential-backoff retry on transient errors,
 * truncated-JSON detection, error-as-200 detection, and structured
 * telemetry. Invisible to call sites except for the wrapper itself.
 *
 * Per /tool-use-guardian skill · 9 failure categories. Each gets a
 * deterministic recovery action so chain breaks stop swallowing
 * progress silently.
 *
 * USAGE
 *   const guarded = withGuardian("perplexity-search", searchFn, {
 *     timeoutMs: 8000,
 *     maxRetries: 2,
 *   });
 *   const result = await guarded({ query: "tire industry news" });
 *
 * Failures fold into a single GuardianError with .category / .attempts /
 * .lastError so callers can branch by category if they want · most
 * call sites just rethrow / surface the message.
 */

import { logger as rootLogger } from "@/lib/logger";
import { evaluateToolAction } from "@/lib/tools/tool-policy";
import { prisma } from "@/lib/prisma";
import { AsyncLocalStorage } from "async_hooks";

const log = rootLogger.withSurface("tools/guardian");

export const pendingExecutions = new Map<string, { fn: Function; args: any[] }>();
export const guardianBypassStorage = new AsyncLocalStorage<boolean>();

/**
 * Durable re-dispatch registry · 2026-07-07.
 *
 * `pendingExecutions` dies with the pod — an approval that arrived after a
 * restart used to fall through to the 5-entry TOOL_MAP and usually throw
 * "No execution function found" while the operator's approval sat failed
 * with nothing sent. Every policy-gated withGuardian wrap now registers its
 * guarded fn here AT MODULE INIT, so the registry rebuilds itself on every
 * boot and an approved request can always re-dispatch from the DB row's
 * (toolId, payload) — no closure persistence needed. reliabilityOnly wraps
 * are internal sub-ops that never create ApprovalRequests and are
 * deliberately not registered.
 */
export const durableToolExecutors = new Map<
  string,
  (payload: unknown) => Promise<unknown>
>();

/**
 * Legacy hand-maintained toolId -> nourTools-key map. Kept only as the
 * LAST-resort fallback behind durableToolExecutors for any request created
 * before this deploy; the durable registry supersedes it for every wrapped
 * tool going forward.
 */
export const TOOL_MAP: Record<string, string> = {
  "gmail.compose_draft_card": "composeEmail",
  "code.run_js_vm": "runCode",
  "code.run_python_e2b": "runPython",
  "memory.pin": "pinMemory",
  "memory.resolve_contradiction": "resolveContradiction",
};

export class GuardianApprovalPendingError extends Error {
  requestId: string;
  constructor(requestId: string) {
    super(`Approval pending for request: ${requestId}`);
    this.name = "GuardianApprovalPendingError";
    this.requestId = requestId;
  }
}

export async function executeApprovedToolAsync(requestId: string): Promise<void> {
  try {
    const staleTime = new Date(Date.now() - 5 * 60 * 1000); // 5 min TTL
    const claim = await prisma.approvalRequest.updateMany({
      where: { 
        id: requestId, 
        OR: [
          { status: "approved" },
          { status: "executing", updatedAt: { lt: staleTime } }
        ]
      },
      data: { status: "executing" },
    });
    
    if (claim.count !== 1) {
      log.info("approval_claim_miss", { requestId });
      return;
    }

    const request = await prisma.approvalRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    let result: any;
    const pending = pendingExecutions.get(requestId);

    if (pending) {
      // Same-process fast path · exact original closure + args (already
      // patched by approveApprovalRequest when the payload was edited).
      result = await guardianBypassStorage.run(true, () => pending.fn(...pending.args));
    } else {
      // Pod restarted (or entry evicted) since the request was created.
      // Importing the tools module re-runs every withGuardian wrap, which
      // repopulates durableToolExecutors — so the import MUST precede the
      // registry read.
      const { nourTools } = await import("@/lib/ai/tools");
      const durable = durableToolExecutors.get(request.toolId);
      if (durable) {
        // Re-dispatch from the DB row's payload (reflects operator edits).
        // Runs under bypass, so the guarded fn skips the approval gate and
        // executes with the normal retry/timeout envelope.
        result = await guardianBypassStorage.run(true, () => durable(request.payload));
      } else {
        // Legacy last resort for pre-registry requests.
        const toolName = TOOL_MAP[request.toolId];
        const toolObj = toolName ? (nourTools as any)[toolName] : null;
        if (toolObj && typeof toolObj.execute === "function") {
          result = await guardianBypassStorage.run(true, () => toolObj.execute(request.payload));
        } else {
          // Third tier: executeActionWithoutTracing for unmapped cross-system tools (like shop.sendSms)
          const { executeActionWithoutTracing } = await import("@/lib/ai/nick-agent");
          const actionResult = await guardianBypassStorage.run(true, () => 
            executeActionWithoutTracing({ type: request.toolId as any, params: request.payload as Record<string, unknown> })
          );
          if (!actionResult.success) {
            throw new Error(actionResult.error || `Action ${request.toolId} failed`);
          }
          result = actionResult.result;
        }
      }
    }

    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: "executed",
        resultPayload: result as any,
        executedAt: new Date(),
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: "failed",
        resultPayload: { error: errMsg },
      },
    });
  } finally {
    pendingExecutions.delete(requestId);
  }
}


export type FailureCategory =
  | "truncated_json"
  | "api_timeout"
  | "rate_limit"
  | "auth_expired"
  | "mid_chain_break"
  | "error_as_200"
  | "schema_mismatch"
  | "network_failure"
  | "circuit_open"
  | "unknown";

export interface GuardianOptions {
  /** Per-call timeout · default 30s. */
  timeoutMs?: number;
  /** Max retries on transient errors · default 2. */
  maxRetries?: number;
  /** Custom error-as-200 detector · default checks `result.error`. */
  isErrorAs200?: (result: unknown) => boolean;
  /** Custom schema validator · returns true if valid. */
  validateSchema?: (result: unknown) => boolean;
  /**
   * Reliability-only mode · skip the AI-tool policy/approval block
   * (evaluateToolAction + approval + memory-review) and run ONLY the
   * retry/timeout infrastructure.
   *
   * Set this for INTERNAL sub-operations — provider calls, rerankers,
   * research/agent sub-steps, server-side pipelines behind an API route —
   * i.e. anything the AI does NOT dispatch directly as a top-level tool.
   * Those ids are not in TOOL_REGISTRY, so without this flag the policy
   * gate denies them "Unknown tool ID" (see PR history · google-search).
   *
   * SECURITY · this is a COMPILE-TIME wrap option captured in the closure,
   * never read from the runtime payload. A dotted, AI-dispatchable tool
   * must NEVER be marked reliabilityOnly (the drift-guard test enforces
   * this) or it would bypass the policy gate + NICK_MUTATION_LOCK.
   */
  reliabilityOnly?: boolean;
  /** Enable the per-tool circuit breaker · default true. */
  circuitBreaker?: boolean;
  /** Consecutive backend failures before the breaker opens · default 5. */
  breakerThreshold?: number;
  /** How long the breaker stays open before a half-open probe · default 30s. */
  breakerCooldownMs?: number;
}

export class GuardianError extends Error {
  category: FailureCategory;
  attempts: number;
  lastError?: unknown;
  toolName: string;
  constructor(
    toolName: string,
    category: FailureCategory,
    attempts: number,
    message: string,
    lastError?: unknown,
  ) {
    super(`[guardian:${toolName}] ${category} after ${attempts} attempt(s) · ${message}`);
    this.name = "GuardianError";
    this.toolName = toolName;
    this.category = category;
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Classify a thrown error or returned-but-malformed result. Pure
 * function · safe to call without side effects. The classification
 * drives recovery action.
 */
export function classify(err: unknown, result?: unknown): FailureCategory {
  const msg = String(
    (err as { message?: string })?.message ?? err ?? "",
  ).toLowerCase();
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    0;

  // Auth · 401/403 · don't retry, surface immediately
  if (status === 401 || status === 403) return "auth_expired";
  if (msg.includes("unauthorized") || msg.includes("forbidden")) return "auth_expired";

  // Rate-limit · 429 or "too many requests"
  if (status === 429) return "rate_limit";
  if (msg.includes("rate limit") || msg.includes("too many requests")) return "rate_limit";

  // Timeout · AbortError or message
  if ((err as { name?: string })?.name === "AbortError") return "api_timeout";
  if (msg.includes("timeout") || msg.includes("timed out")) return "api_timeout";
  if (msg.includes("etimedout")) return "api_timeout";

  // Network · fetch failed / ECONNRESET / ENOTFOUND
  if (msg.includes("fetch failed") || msg.includes("econnreset") || msg.includes("enotfound")) {
    return "network_failure";
  }
  if (msg.includes("network") && msg.includes("error")) return "network_failure";

  // Truncated JSON · parse error with "unexpected end" / "unterminated"
  if (msg.includes("unexpected end of json") || msg.includes("unterminated string")) {
    return "truncated_json";
  }

  // Schema mismatch · "expected" / "missing required"
  if (msg.includes("expected") && (msg.includes("got") || msg.includes("received"))) {
    return "schema_mismatch";
  }
  if (msg.includes("missing required")) return "schema_mismatch";

  // Error-as-200 · result has .error but no exception
  if (result && typeof result === "object" && "error" in (result as object)) {
    return "error_as_200";
  }

  return "unknown";
}

/**
 * Recovery decision · should we retry?
 */
function isRetryable(cat: FailureCategory): boolean {
  return cat === "api_timeout"
      || cat === "rate_limit"
      || cat === "network_failure"
      || cat === "truncated_json";
}

/**
 * Exponential backoff with jitter · 200ms, 600ms, 1500ms.
 */
function backoffDelay(attempt: number): number {
  const base = [200, 600, 1500][attempt] ?? 1500;
  const jitter = Math.random() * 100;
  return base + jitter;
}

// ── Circuit breaker ──────────────────────────────────────────────────
// Per-tool state so a repeatedly-failing backend fast-fails for a cooldown
// instead of every call re-paying maxRetries×timeout — which, under fan-out
// concurrency, becomes N simultaneous retry storms against an already-down
// backend. Only "backend is misbehaving" categories trip it; auth/schema/
// unknown do not (those are config/caller bugs, not a down backend).
interface BreakerState {
  consecutiveFailures: number;
  openUntil: number; // epoch ms; 0 = closed
}
const breakers = new Map<string, BreakerState>();
const BREAKER_TRIPPING: ReadonlySet<FailureCategory> = new Set([
  "api_timeout",
  "rate_limit",
  "network_failure",
  "truncated_json",
  "error_as_200",
]);

/**
 * Gate a call against the breaker AND atomically claim the half-open probe.
 * - "closed" → breaker is fine, proceed normally (no state change).
 * - "open"   → still in cooldown, fast-fail.
 * - "probe"  → cooldown just elapsed; THIS call is the sole half-open probe.
 *
 * The claim is critical: check-and-rearm is synchronous (no await between the
 * elapsed check and pushing openUntil forward), so under concurrent fan-out
 * exactly ONE caller gets "probe" and the rest see "open". Without this, every
 * concurrent caller would probe a still-down backend the instant the cooldown
 * elapsed — the retry-storm the breaker exists to prevent.
 */
function claimBreakerSlot(toolName: string, cooldownMs: number): "closed" | "open" | "probe" {
  const b = breakers.get(toolName);
  if (!b || b.openUntil === 0) return "closed";
  const now = Date.now();
  if (b.openUntil > now) return "open";
  // Cooldown elapsed — re-arm so concurrent callers see "open" while this one
  // probes. A probe success resets openUntil to 0; a probe failure re-extends it.
  b.openUntil = now + cooldownMs;
  return "probe";
}

function recordBreakerSuccess(toolName: string): void {
  const b = breakers.get(toolName);
  if (b) {
    b.consecutiveFailures = 0;
    b.openUntil = 0;
  }
}

function recordBreakerFailure(
  toolName: string,
  category: FailureCategory,
  threshold: number,
  cooldownMs: number,
): void {
  if (!BREAKER_TRIPPING.has(category)) return;
  let b = breakers.get(toolName);
  if (!b) {
    b = { consecutiveFailures: 0, openUntil: 0 };
    breakers.set(toolName, b);
  }
  b.consecutiveFailures++;
  if (b.consecutiveFailures >= threshold) {
    b.openUntil = Date.now() + cooldownMs;
  }
}

/** Test-only · clears all breaker state between cases. */
export function __resetGuardianBreakers(): void {
  breakers.clear();
}

/**
 * Wrap an async tool with guardian protection.
 */
export function withGuardian<T, A extends unknown[]>(
  toolName: string,
  fn: (...args: A) => Promise<T>,
  opts: GuardianOptions = {},
): (...args: A) => Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? 2;
  const isErrorAs200 =
    opts.isErrorAs200 ??
    ((r: unknown) =>
      Boolean(r && typeof r === "object" && "error" in (r as object)));
  const validateSchema = opts.validateSchema;
  // Captured at wrap time · never derived from the runtime payload.
  const reliabilityOnly = opts.reliabilityOnly ?? false;
  const circuitBreaker = opts.circuitBreaker ?? true;
  const breakerThreshold = opts.breakerThreshold ?? 5;
  const breakerCooldownMs = opts.breakerCooldownMs ?? 30_000;

  const guarded = async function guarded(...args: A): Promise<T> {
    const bypassPolicy = guardianBypassStorage.getStore() === true;

    // reliabilityOnly sub-ops skip the AI-tool policy/approval block entirely
    // and run only the retry/timeout loop below.
    if (!bypassPolicy && !reliabilityOnly) {
      const payload = args[0] !== undefined ? args[0] : {};
      const decision = evaluateToolAction({
        toolId: toolName,
        actionType: "execute",
        destructive: (payload as any)?.destructive,
        containsExternalContent: (payload as any)?.containsExternalContent,
        memoryWriteRequested: (payload as any)?.memoryWriteRequested,
      });

      if (decision.decision === "deny") {
        throw new Error(`Action denied: ${decision.reason}`);
      }

      if (decision.decision === "require_memory_review") {
        const content = (payload as any)?.content || "";

        const existing = await prisma.memoryInboxItem.findFirst({
          where: {
            rawTextFenced: content,
            status: {
              in: ["quarantined", "conflicting", "committed", "discarded"]
            }
          },
          orderBy: { createdAt: "desc" }
        });

        if (existing) {
          if (existing.status === "committed") {
            return { pinned: true, committed: true, content } as T;
          }
          if (existing.status === "discarded") {
            throw new Error("Memory ingestion rejected by operator");
          }
          throw new GuardianApprovalPendingError(existing.id);
        }

        // Detect contradictions via semanticSearch
        const { semanticSearch } = await import("@/lib/brain/embedding-utils");
        const neighbors = await semanticSearch(content, 5, ["brain_memory"]).catch(() => []);
        const candidates = neighbors.filter((n) => n.similarity >= 0.75);
        let contradictionLogs: any[] = [];
        let status = "quarantined";

        if (candidates.length > 0) {
          status = "conflicting";
          const dbMemories = await prisma.brainMemory.findMany({
            where: { id: { in: candidates.map(c => c.sourceId) } },
            select: { id: true, content: true, category: true, createdAt: true }
          });
          contradictionLogs = candidates.map(c => {
            const m = dbMemories.find(row => row.id === c.sourceId);
            return {
              id: c.sourceId,
              content: m?.content || "",
              similarity: c.similarity,
              category: m?.category || "",
              createdAt: m?.createdAt ? m.createdAt.toISOString() : null
            };
          });
        }

        const newInboxItem = await prisma.memoryInboxItem.create({
          data: {
            sourceType: "agent_tool",
            sourceUrl: (payload as any)?.sourceUrl || null,
            rawTextFenced: content,
            extractedClaims: [{ text: content }],
            contradictionLogs: contradictionLogs as any,
            privacyClass: (payload as any)?.privacyClass || "internal",
            status,
          }
        });

        throw new GuardianApprovalPendingError(newInboxItem.id);
      }

      if (
        decision.decision === "require_approval" ||
        decision.decision === "require_owner" ||
        decision.decision === "require_screenshot_approval"
      ) {
        const existing = await prisma.approvalRequest.findFirst({
          where: {
            toolId: toolName,
            status: {
              in: ["pending_approval", "approved", "rejected", "executed", "failed"]
            }
          },
          orderBy: { createdAt: "desc" }
        });

        let matched = existing;
        if (existing) {
          const existingStr = JSON.stringify(existing.payload);
          const currentStr = JSON.stringify(payload);
          if (existingStr !== currentStr) {
            matched = null;
          }
        }

        if (matched) {
          if (matched.status === "executed") {
            return matched.resultPayload as T;
          }
          if (matched.status === "rejected") {
            throw new Error("Action rejected by operator");
          }
          if (matched.status === "failed") {
            throw new Error(`Action execution failed: ${JSON.stringify(matched.resultPayload)}`);
          }

          if (matched.status === "pending_approval" || matched.status === "approved") {
            pendingExecutions.set(matched.id, { fn, args });
          }

          throw new GuardianApprovalPendingError(matched.id);
        }

        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (decision.riskClass === 'high' || decision.riskClass === 'critical' ? 2 : 24));

        const newRequest = await prisma.approvalRequest.create({
          data: {
            toolId: toolName,
            actionType: decision.decision,
            status: "pending_approval",
            riskClass: decision.riskClass,
            payload: payload as any,
            requestedBy: "agent",
            reason: decision.reason,
            expiresAt,
          }
        });

        pendingExecutions.set(newRequest.id, { fn, args });

        throw new GuardianApprovalPendingError(newRequest.id);
      }
    }

    // Circuit breaker · fast-fail while this tool's backend is in an open
    // cooldown, instead of re-paying the whole retry+timeout budget. When the
    // cooldown elapses exactly ONE concurrent caller becomes the half-open
    // probe (claimBreakerSlot re-arms atomically); success resets the breaker,
    // failure re-opens it.
    if (circuitBreaker && claimBreakerSlot(toolName, breakerCooldownMs) === "open") {
      log.warn("guardian_circuit_open", { toolName });
      throw new GuardianError(
        toolName,
        "circuit_open",
        0,
        `circuit open · ${toolName} is failing repeatedly · fast-failing until cooldown elapses`,
      );
    }

    let lastError: unknown;
    let lastCategory: FailureCategory = "unknown";

    // Tagged sentinels for in-block detection · keep classify() pure
    // for unknown errors but preserve the explicit category we set
    // when error-as-200 or schema-mismatch is detected post-call.
    class _ErrorAs200 extends Error { category: FailureCategory = "error_as_200"; }
    class _SchemaMismatch extends Error { category: FailureCategory = "schema_mismatch"; }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startedAt = Date.now();
      try {
        // Hard timeout via AbortSignal that the tool can hook into;
        // also enforced as a Promise.race for tools that don't support
        // AbortSignal.
        const result = await Promise.race([
          fn(...args),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(Object.assign(new Error("guardian timeout"), { name: "AbortError" })),
              timeoutMs,
            ),
          ),
        ]);

        // Error-as-200 check
        if (isErrorAs200(result)) {
          throw new _ErrorAs200(
            `tool returned error-as-200: ${JSON.stringify(result).slice(0, 120)}`,
          );
        }

        // Schema check
        if (validateSchema && !validateSchema(result)) {
          throw new _SchemaMismatch(`tool result failed schema validation`);
        }

        const ms = Date.now() - startedAt;
        if (attempt > 0) {
          log.info("guardian_retry_succeeded", {
            toolName,
            attempt,
            recoveredFrom: lastCategory,
            ms,
          });
        }
        if (circuitBreaker) recordBreakerSuccess(toolName);
        return result;
      } catch (err) {
        lastError = err;
        // Honour explicit categories from in-block sentinels; otherwise classify.
        lastCategory =
          err instanceof _ErrorAs200 ? "error_as_200"
          : err instanceof _SchemaMismatch ? "schema_mismatch"
          : classify(err);
        const ms = Date.now() - startedAt;

        log.warn("guardian_call_failed", {
          toolName,
          attempt,
          category: lastCategory,
          ms,
          error: String((err as { message?: string })?.message ?? err).slice(0, 200),
        });

        // Auth never retries · surface immediately
        if (lastCategory === "auth_expired") break;
        if (!isRetryable(lastCategory)) break;
        if (attempt >= maxRetries) break;

        await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
      }
    }

    // Terminal failure · feed the breaker so a persistently-down backend
    // trips it and subsequent calls fast-fail during the cooldown.
    if (circuitBreaker) {
      recordBreakerFailure(toolName, lastCategory, breakerThreshold, breakerCooldownMs);
    }

    throw new GuardianError(
      toolName,
      lastCategory,
      maxRetries + 1,
      String((lastError as { message?: string })?.message ?? lastError ?? "unknown"),
      lastError,
    );
  };

  // Wrap-time registration for durable approval re-dispatch: module init
  // runs on every boot, so the registry survives pod restarts by
  // reconstruction. reliabilityOnly sub-ops never create ApprovalRequests
  // and stay out (their ids aren't in TOOL_REGISTRY anyway).
  if (!reliabilityOnly) {
    // Type-erased on purpose: the registry re-dispatches with the DB row's
    // payload as the sole argument, matching how every gated tool is called.
    durableToolExecutors.set(
      toolName,
      guarded as unknown as (payload: unknown) => Promise<unknown>,
    );
  }

  return guarded;
}
