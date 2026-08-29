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
 * 2026-08-28 · V2 · PARTIAL LIVE-TAIL, still without Redis. The V1 note
 * below said mid-stream tail "requires the resumable-stream package +
 * Redis pub/sub". That turned out to be false for this system's shape:
 * the chat route ALREADY accumulates every text delta into `partialRef`
 * (build-stream-config.ts onChunk, added v10.0.20 for error recovery),
 * so the bytes exist in-process — they were simply never durable. A
 * throttled write of that accumulator into this row makes the reconnect
 * route able to replay in-flight bytes and then poll for more. Redis
 * would buy lower latency, not new capability; the DO-NOT-ADD-REDIS
 * constraint costs nothing here.
 *
 * WHY `metadata`, NOT `content` (2026-08-28, deliberate): `content` is
 * the column contextual recall reads. This category's quarantine from
 * recall today rests ENTIRELY on its 0.1 confidence sitting under the
 * 0.3 floor — it was in no exclude list. Writing multi-KB assistant
 * prose into `content` would load a memory-pollution risk onto a single
 * numeric coincidence, which is the shape of the 2026-07 consolidation
 * incident (38 curated rows eaten). Partial text goes in `metadata`,
 * which no recall lane reads, AND the category is now explicitly listed
 * in RECALL_EXCLUDE_CATEGORIES + CONSOLIDATION_EXCLUDE_CATEGORIES.
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
  /** Text streamed so far (V2). Empty until the first flush lands. */
  partialText: string;
}

/** Throttle floor for partial flushes. A 132s deep turn writes ~66 rows
 *  at this cadence — one upsert on one row, negligible against the
 *  model call it rides along with, and the resume tail polls at 500ms
 *  so a tighter cadence would buy the operator nothing visible. */
const PARTIAL_FLUSH_MS = 2000;
/** Hard ceiling per flush. Beyond this the turn is pathological and the
 *  tail is not the right recovery path; truncating protects the row
 *  from unbounded growth without failing the turn. */
const PARTIAL_MAX_CHARS = 200_000;

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

/** Write the in-flight partial text onto the active row (V2).
 *  Fire-and-forget safe: a failed flush costs the tail some bytes, never
 *  the turn. Only patches `metadata` — never `content` (see header). */
export async function persistPartialStream(
  convId: string,
  text: string,
): Promise<void> {
  try {
    const row = await prisma.brainMemory.findUnique({
      where: { category_key: { category: CATEGORY, key: keyFor(convId) } },
      select: { id: true, metadata: true },
    });
    if (!row) return;
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    // Never resurrect a completed turn back into "active" — a late
    // in-flight flush racing completeActiveStream must not reopen it.
    if (meta.status === "complete") return;
    await prisma.brainMemory.update({
      where: { id: row.id },
      data: {
        metadata: {
          ...meta,
          partialText: text.slice(0, PARTIAL_MAX_CHARS),
          partialAt: new Date().toISOString(),
        } as never,
      },
    });
  } catch (e) {
    logError("chat.active-stream", e, { stage: "partial", convId }, "warn");
  }
}

/** Throttled flusher bound to one conversation. Returned function is
 *  cheap to call on EVERY delta — it drops calls inside the window and
 *  never awaits, so the hot streaming path pays a clock read. */
export function createPartialPersister(
  convId: string,
  flushMs = PARTIAL_FLUSH_MS,
): (text: string) => void {
  // Seeded to NOW, not 0: the registry row is upserted moments after the
  // stream starts being consumed, so an immediate first flush would race
  // it and no-op. One throttle window of delay costs nothing on a turn
  // long enough to be worth resuming.
  let lastFlush = Date.now();
  let inFlight = false;
  return (text: string) => {
    const now = Date.now();
    if (inFlight || now - lastFlush < flushMs) return;
    lastFlush = now;
    inFlight = true;
    void persistPartialStream(convId, text).finally(() => {
      inFlight = false;
    });
  };
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
    partialText: typeof m.partialText === "string" ? m.partialText : "",
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

/** V2 live-tail chunk primitives. `buildReplayChunks` above emits a
 *  whole completed message in one go; the tail needs the same sequence
 *  opened, fed incrementally, and closed later. Pure — exported for
 *  tests. */
export const partIdFor = (messageId: string) => `${messageId}-text`;

export function buildOpenChunks(messageId: string): Array<Record<string, unknown>> {
  return [
    { type: "start", messageId },
    { type: "text-start", id: partIdFor(messageId) },
  ];
}

export function buildDeltaChunk(
  messageId: string,
  delta: string,
): Record<string, unknown> {
  return { type: "text-delta", id: partIdFor(messageId), delta };
}

export function buildCloseChunks(messageId: string): Array<Record<string, unknown>> {
  return [{ type: "text-end", id: partIdFor(messageId) }, { type: "finish" }];
}

/** Deterministic id for a resumed in-flight turn.
 *
 *  Load-bearing for the duplicate-message invariant (this repo has scar
 *  tissue: an auto-resend spawned duplicates and a retry storm rate-
 *  limited the pipeline). A reconnect STORM must not mint N assistant
 *  bubbles — keying the id to (conversation, turn start) makes every
 *  concurrent resume of the same turn resolve to the same message id,
 *  so the client replaces rather than appends. */
export function resumeMessageId(convId: string, startedAt: string): string {
  return `resume-${convId}-${startedAt}`;
}
