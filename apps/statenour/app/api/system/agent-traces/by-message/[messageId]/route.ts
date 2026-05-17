/**
 * GET /api/system/agent-traces/by-message/[messageId] · v10.0.515 · #7 reasoning-trace UI
 *
 * Resolves a ChatMessage to its agent-trace chain. The link lives
 * in `ChatMessage.tokenUsage.traceId` (added v10.0.515) so this
 * route never needs a schema migration. Pre-v10.0.515 assistant
 * rows return `traceId: null` and the UI shows "trace unavailable"
 * for those — the new ones get the full chain.
 *
 * Mirrors /api/system/agent-traces/[traceId] but accepts a
 * messageId instead. Used by the chat-side "Why this answer"
 * collapsible card under each assistant message.
 *
 * Owner-gated. Read-only. Returns the same shape as the trace-id
 * variant so the UI can reuse one renderer.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { getTraceChain } from "@/lib/ai/agent-trace";
import { extractEnvelope, type ExplanationEnvelope } from "@/lib/automation/envelope";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (req, { params }) => {
    const { messageId } = await params!;
    if (!messageId || typeof messageId !== "string") {
      throw new ServiceError("messageId required", 400);
    }

    // v10.0.517 · fresh-stream timing fallback. The Chrome smoke test
    // of v10.0.516 revealed that useChat (AI SDK v6) assigns its own
    // nanoid to assistant messages, which doesn't match the Prisma
    // cuid that persist-assistant-turn writes. Page reload fixes it
    // because the loaded messages use the DB id, but the operator's
    // first click on "why this answer" right after a stream lands
    // 404'd. Same root cause as the pre-existing feedback route bug.
    //
    // Fix: try id lookup first (works for DB-loaded clicks and any
    // future direct-API callers). If 404 AND ?conversationId=... is
    // present in the query string, fall back to the latest assistant
    // message in that conversation. The window between persist and
    // click is ≤2s so the latest-assistant heuristic is safe.
    let msg = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, role: true, tokenUsage: true, model: true, createdAt: true },
    });
    if (!msg) {
      const url = new URL(req.url);
      const conversationId = url.searchParams.get("conversationId");
      if (conversationId) {
        msg = await prisma.chatMessage.findFirst({
          where: { conversationId, role: "assistant" },
          orderBy: { createdAt: "desc" },
          select: { id: true, role: true, tokenUsage: true, model: true, createdAt: true },
        });
      }
    }
    // v10.0.518 · ultimate fallback for the fresh-stream timing case
    // when the chat page can't pass conversationId yet (first message
    // of a brand-new conversation · activeId is still null between
    // stream-start and the X-Conversation-Id header round-trip).
    // Single-operator system · the "latest assistant message in the
    // last 60s" heuristic resolves to the click target safely.
    if (!msg) {
      msg = await prisma.chatMessage.findFirst({
        where: {
          role: "assistant",
          createdAt: { gte: new Date(Date.now() - 60_000) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, role: true, tokenUsage: true, model: true, createdAt: true },
      });
    }
    if (!msg) throw new ServiceError("message not found", 404);

    // tokenUsage shape varies — be defensive about extracting traceId.
    const usage = (msg.tokenUsage ?? {}) as Record<string, unknown>;
    const traceId = typeof usage.traceId === "string" ? usage.traceId : null;

    if (!traceId) {
      return {
        messageId,
        traceId: null,
        unavailable: true,
        reason:
          "This message was created before traceId linking shipped (v10.0.515). New messages will show the full chain.",
        // Surface what we DO have so the UI isn't empty.
        summary: {
          model: msg.model ?? null,
          provider: typeof usage.provider === "string" ? usage.provider : null,
          promptTokens: typeof usage.promptTokens === "number" ? usage.promptTokens : null,
          completionTokens:
            typeof usage.completionTokens === "number" ? usage.completionTokens : null,
          persona: typeof usage.persona === "string" ? usage.persona : null,
          critic: usage.critic ?? null,
          createdAt: msg.createdAt.toISOString(),
        },
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

    const rowsWithEnvelope = chain.children.map((c) => ({
      ...c,
      startedAt: c.startedAt.toISOString(),
      envelope: extractEnvelope(c.metadata),
    }));

    const consolidated: ExplanationEnvelope = {
      version: 1,
      policyId:
        rowsWithEnvelope.find((r) => r.envelope?.policyId != null)?.envelope?.policyId ?? null,
      memoriesUsed: dedupeBy(
        rowsWithEnvelope.flatMap((r) => r.envelope?.memoriesUsed ?? []),
        (m) => m.id,
      ),
      factsAssumed: [
        ...new Set(rowsWithEnvelope.flatMap((r) => r.envelope?.factsAssumed ?? [])),
      ],
      toolsCalled: rowsWithEnvelope.flatMap((r) => r.envelope?.toolsCalled ?? []),
      reason:
        rowsWithEnvelope
          .map((r) => r.envelope?.reason)
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
      rows: rowsWithEnvelope,
      // Carry the model + persona + critic from the message itself
      // so the UI's top line ("Anthropic · claude-3.5-sonnet · 1.4s
      // · 8 tools · 12 memories") has everything it needs in ONE
      // fetch.
      summary: {
        model: msg.model ?? null,
        provider: typeof usage.provider === "string" ? usage.provider : null,
        promptTokens: typeof usage.promptTokens === "number" ? usage.promptTokens : null,
        completionTokens:
          typeof usage.completionTokens === "number" ? usage.completionTokens : null,
        persona: typeof usage.persona === "string" ? usage.persona : null,
        critic: usage.critic ?? null,
        createdAt: msg.createdAt.toISOString(),
      },
    };
  },
  { auth: "owner" },
);

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
