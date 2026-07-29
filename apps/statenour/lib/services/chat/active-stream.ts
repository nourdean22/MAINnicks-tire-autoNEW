/**
 * lib/services/chat/active-stream.ts — durable-stream registry
 * (2026-07-29 · dossier WP-A, scoped V1).
 *
 * The gap: a backgrounded PWA or dropped socket lost the visible reply
 * until a manual reload, even though the server finished the turn
 * (receipt-backed completion messages landed "on next load"). V1
 * closes the OPERATOR gap without new infra:
 *
 *   · `result.consumeStream()` in the chat route makes server-side
 *     completion unconditional (the documented SDK pattern).
 *   · This registry marks a conversation's in-flight stream in a
 *     self-expiring BrainMemory row (no DDL — the established
 *     pattern), cleared only after the onFinish persist resolves.
 *   · The reconnect route replays the PERSISTED assistant message as
 *     a one-shot UIMessage stream. It NEVER re-runs the model — the
 *     bytes come from the row the finished turn wrote.
 *
 * Deliberately deferred (documented, not hidden): mid-stream partial
 * live-tail requires the `resumable-stream` package + Redis pub/sub —
 * adopt only if completed-turn recovery proves insufficient.
 *
 * Private mode never registers (its no-persistence semantics hold).
 */
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

const CATEGORY = "active_chat_stream";
/** A stream older than this is a crashed turn — the row self-expires. */
const ACTIVE_TTL_MS = 10 * 60 * 1000;
/** Completed rows linger briefly so a late reconnect still resolves. */
const COMPLETE_LINGER_MS = 3 * 60 * 1000;

export interface ActiveStreamRecord {
  status: "active" | "complete";
  traceId: string | null;
  startedAt: string;
}

const keyFor = (convId: string) => `stream:${convId}`;

/** Mark a conversation's turn in-flight. Fire-and-forget safe. */
export async function registerActiveStream(
  convId: string,
  traceId: string | null,
): Promise<void> {
  try {
    const startedAt = new Date().toISOString();
    await prisma.brainMemory.upsert({
      where: { category_key: { category: CATEGORY, key: keyFor(convId) } },
      create: {
        category: CATEGORY,
        key: keyFor(convId),
        content: `active stream · ${startedAt}`,
        confidence: 0.1,
        source: "chat-route",
        expiresAt: new Date(Date.now() + ACTIVE_TTL_MS),
        metadata: { status: "active", traceId, startedAt } as never,
      },
      update: {
        content: `active stream · ${startedAt}`,
        expiresAt: new Date(Date.now() + ACTIVE_TTL_MS),
        metadata: { status: "active", traceId, startedAt } as never,
        deletedAt: null,
      },
    });
  } catch (e) {
    logError("chat.active-stream", e, { stage: "register", convId }, "warn");
  }
}

/** Mark the turn durably complete — called ONLY after the onFinish
 *  persist resolved (the invariant: cleared only after durable
 *  completion). Fire-and-forget safe. */
export async function completeActiveStream(convId: string): Promise<void> {
  try {
    const row = await prisma.brainMemory.findUnique({
      where: { category_key: { category: CATEGORY, key: keyFor(convId) } },
      select: { id: true, metadata: true },
    });
    if (!row) return;
    await prisma.brainMemory.update({
      where: { id: row.id },
      data: {
        expiresAt: new Date(Date.now() + COMPLETE_LINGER_MS),
        metadata: {
          ...((row.metadata ?? {}) as Record<string, unknown>),
          status: "complete",
          completedAt: new Date().toISOString(),
        } as never,
      },
    });
  } catch (e) {
    logError("chat.active-stream", e, { stage: "complete", convId }, "warn");
  }
}

/** Read the conversation's stream record; expired rows count as absent. */
export async function getActiveStream(
  convId: string,
): Promise<ActiveStreamRecord | null> {
  const row = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: CATEGORY, key: keyFor(convId) } },
      select: { metadata: true, expiresAt: true, deletedAt: true },
    })
    .catch(() => null);
  if (!row || row.deletedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  const m = (row.metadata ?? {}) as Partial<ActiveStreamRecord>;
  if (m.status !== "active" && m.status !== "complete") return null;
  return {
    status: m.status,
    traceId: typeof m.traceId === "string" ? m.traceId : null,
    startedAt: typeof m.startedAt === "string" ? m.startedAt : new Date(0).toISOString(),
  };
}

/** UIMessageChunk sequence replaying one persisted assistant message.
 *  Pure — exported for tests. The text is chunked only so very long
 *  replies don't land as one megabyte delta. */
export function buildReplayChunks(
  messageId: string,
  text: string,
): Array<Record<string, unknown>> {
  const partId = `${messageId}-text`;
  const chunks: Array<Record<string, unknown>> = [
    { type: "start", messageId },
    { type: "text-start", id: partId },
  ];
  const STEP = 2000;
  for (let i = 0; i < text.length; i += STEP) {
    chunks.push({ type: "text-delta", id: partId, delta: text.slice(i, i + STEP) });
  }
  if (text.length === 0) {
    chunks.push({ type: "text-delta", id: partId, delta: "" });
  }
  chunks.push({ type: "text-end", id: partId });
  chunks.push({ type: "finish" });
  return chunks;
}
