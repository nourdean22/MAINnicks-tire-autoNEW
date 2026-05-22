/**
 * lib/services/agent-trace-by-message.ts · cross-domain residuals slice
 * (2026-05-22 · legacy-modernizer REST→tRPC · chat cross-domain
 * residuals).
 *
 * Resolve a ChatMessage to its agent-trace chain · lifted verbatim from
 * app/api/system/agent-traces/by-message/[messageId]/route.ts so the
 * legacy REST endpoint AND the new `system.agentTraceByMessage` tRPC
 * procedure call the SAME function · drift between consumers
 * structurally impossible.
 *
 * The trace link lives in `ChatMessage.tokenUsage.traceId` (v10.0.515).
 * Pre-v10.0.515 rows return `unavailable: true`. The fresh-stream
 * fallbacks (by conversationId → latest-assistant-in-60s) are preserved
 * verbatim — useChat assigns its own nanoid that doesn't match the
 * Prisma cuid until reload.
 *
 * TS2589 firewall · the per-row `metadata` Json column from
 * `getTraceChain` is DROPPED in the row projection (the ReasoningTrace
 * component reads only scalar row fields + the `consolidated` envelope,
 * never per-row metadata) so the recursive `JsonValue` type never
 * reaches the AppRouter. `consolidated` is the fully-flat
 * `ExplanationEnvelope` (scalars + flat arrays · no Json). `summary`
 * projects `tokenUsage` to scalars + `critic: unknown`.
 */

import { prisma } from "@/lib/prisma";
import { getTraceChain } from "@/lib/ai/agent-trace";
import {
  extractEnvelope,
  type ExplanationEnvelope,
} from "@/lib/automation/envelope";
import { ServiceError } from "@/lib/utils/service-error";

/** One sub-trace row · scalar-only projection (Json `metadata` dropped). */
export interface AgentTraceRowView {
  id: string;
  label: string;
  source: string;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  costCents: number | null;
  toolCalls: number;
  errorClass: string | null;
  errorMessage: string | null;
  startedAt: string;
}

/** The message-summary line · `tokenUsage` projected to scalars. */
export interface AgentTraceSummaryView {
  model: string | null;
  provider: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  persona: string | null;
  /** ChatMessage.tokenUsage.critic · `unknown` to keep the type shallow. */
  critic: unknown;
  createdAt: string;
}

/** The full resolved trace view for one chat message. */
export interface AgentTraceByMessageView {
  messageId: string;
  traceId: string | null;
  unavailable?: boolean;
  reason?: string;
  startedAt?: string;
  rootLabel?: string;
  rootSource?: string;
  totalDurationMs?: number;
  totalCostCents?: number;
  hasError?: boolean;
  consolidated?: ExplanationEnvelope;
  rows?: AgentTraceRowView[];
  summary: AgentTraceSummaryView | null;
}

function dedupeBy<T>(items: T[], keyFn: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * Resolve a chat message to its agent-trace chain. The REST route and
 * the tRPC `system.agentTraceByMessage` procedure both call this.
 *
 * @param messageId  the ChatMessage id (or the useChat nanoid)
 * @param conversationId  optional · enables the fresh-stream fallback
 * @throws ServiceError(404) · no message resolvable via any fallback
 */
export async function buildAgentTraceByMessage(
  messageId: string,
  conversationId?: string,
): Promise<AgentTraceByMessageView> {
  if (!messageId || typeof messageId !== "string") {
    throw new ServiceError("messageId required", 400);
  }

  // Try id lookup first (works for DB-loaded clicks + direct callers).
  let msg = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      role: true,
      tokenUsage: true,
      model: true,
      createdAt: true,
    },
  });

  // Fresh-stream fallback · latest assistant in the conversation.
  if (!msg && conversationId) {
    msg = await prisma.chatMessage.findFirst({
      where: { conversationId, role: "assistant" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        role: true,
        tokenUsage: true,
        model: true,
        createdAt: true,
      },
    });
  }

  // Ultimate fallback · latest assistant message in the last 60s
  // (single-operator system · the window between persist and click
  // is ≤2s so this resolves to the click target safely).
  if (!msg) {
    msg = await prisma.chatMessage.findFirst({
      where: {
        role: "assistant",
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        role: true,
        tokenUsage: true,
        model: true,
        createdAt: true,
      },
    });
  }
  if (!msg) throw new ServiceError("message not found", 404);

  // tokenUsage shape varies — be defensive about extracting traceId.
  const usage = (msg.tokenUsage ?? {}) as Record<string, unknown>;
  const traceId = typeof usage.traceId === "string" ? usage.traceId : null;

  const summary: AgentTraceSummaryView = {
    model: msg.model ?? null,
    provider: typeof usage.provider === "string" ? usage.provider : null,
    promptTokens:
      typeof usage.promptTokens === "number" ? usage.promptTokens : null,
    completionTokens:
      typeof usage.completionTokens === "number"
        ? usage.completionTokens
        : null,
    persona: typeof usage.persona === "string" ? usage.persona : null,
    critic: usage.critic ?? null,
    createdAt: msg.createdAt.toISOString(),
  };

  if (!traceId) {
    return {
      messageId,
      traceId: null,
      unavailable: true,
      reason:
        "This message was created before traceId linking shipped (v10.0.515). New messages will show the full chain.",
      summary,
    };
  }

  const chain = await getTraceChain(traceId);
  if (!chain) {
    return {
      messageId,
      traceId,
      unavailable: true,
      reason: "Trace rows expired or pruned.",
      summary: null,
    };
  }

  // Project each row to the scalar `AgentTraceRowView` — the Json
  // `metadata` is consumed here (for the envelope) then DROPPED so it
  // never reaches the AppRouter type.
  const rowEnvelopes = chain.children.map((c) => extractEnvelope(c.metadata));
  const rows: AgentTraceRowView[] = chain.children.map((c) => ({
    id: c.id,
    label: c.label,
    source: c.source,
    provider: c.provider,
    model: c.model,
    durationMs: c.durationMs,
    costCents: c.costCents,
    toolCalls: c.toolCalls,
    errorClass: c.errorClass,
    errorMessage: c.errorMessage,
    startedAt: c.startedAt.toISOString(),
  }));

  const consolidated: ExplanationEnvelope = {
    version: 1,
    policyId:
      rowEnvelopes.find((e) => e?.policyId != null)?.policyId ?? null,
    memoriesUsed: dedupeBy(
      rowEnvelopes.flatMap((e) => e?.memoriesUsed ?? []),
      (m) => m.id,
    ),
    factsAssumed: [
      ...new Set(rowEnvelopes.flatMap((e) => e?.factsAssumed ?? [])),
    ],
    toolsCalled: rowEnvelopes.flatMap((e) => e?.toolsCalled ?? []),
    reason:
      rowEnvelopes
        .map((e) => e?.reason)
        .filter((x): x is string => !!x)
        .join(" · ") || null,
  };

  return {
    messageId,
    traceId: chain.traceId,
    startedAt: chain.startedAt.toISOString(),
    rootLabel: chain.rootLabel,
    rootSource: chain.rootSource,
    totalDurationMs: chain.totalDurationMs,
    totalCostCents: chain.totalCostCents,
    hasError: chain.hasError,
    consolidated,
    rows,
    summary,
  };
}
