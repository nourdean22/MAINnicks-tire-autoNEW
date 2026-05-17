/**
 * Brain-bus tail · v10.0.21 · Apr 30.
 *
 * Read-side helper for the durable brain-bus. The producer side
 * (publishDurable) writes to BrainBusEvent; this is what dashboards
 * use to "watch the bus live" via 2s-poll instead of long-lived SSE
 * (which doesn't fit Vercel serverless lambdas cleanly).
 *
 * Composes with brain-bus-handlers (v10.0.17 dispatch registry):
 *   · handlers PROCESS events and mutate state.
 *   · tail READS events for operator visibility — non-mutating.
 *
 * Pattern: poll with `sinceId` so the dashboard only fetches new
 * rows since last frame. Falls back to "last N rows" on first load.
 */

import { prisma } from "@/lib/prisma";

export interface TailEvent {
  id: string;
  topic: string;
  eventType: string;
  status: string;
  attempts: number;
  payloadPreview: string | null;
  lastError: string | null;
  createdAt: Date;
  processedAt: Date | null;
  availableAt: Date;
}

export interface TailResult {
  /** Newest events, oldest-first so the UI can append in order. */
  events: TailEvent[];
  /** Newest event id — pass back as `sinceId` next poll. */
  cursor: string | null;
  /** Aggregate counts from a wider window for the pulse strip. */
  windowCounts: {
    pending: number;
    processing: number;
    done: number;
    failed: number;
    dead: number;
  };
}

const MAX_LIMIT = 200;
const PAYLOAD_PREVIEW_CHARS = 240;

function asPreview(payload: unknown): string | null {
  if (payload == null) return null;
  try {
    const s =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    return s.length > PAYLOAD_PREVIEW_CHARS
      ? `${s.slice(0, PAYLOAD_PREVIEW_CHARS)}…`
      : s;
  } catch {
    return null;
  }
}

/**
 * Read recent durable events. If `sinceId` is provided, returns only
 * rows with id > sinceId (cursor-based pagination — relies on the
 * traceId-style monotonic ids the BrainBusEvent table generates).
 *
 * Otherwise returns the last `limit` rows (default 50, max 200).
 */
export async function tailEvents(opts: {
  sinceId?: string;
  limit?: number;
  topic?: string;
} = {}): Promise<TailResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, MAX_LIMIT));
  const where: Record<string, unknown> = {};
  if (opts.topic) where.topic = opts.topic;
  if (opts.sinceId) where.id = { gt: opts.sinceId };

  const [rows, counts] = await Promise.all([
    prisma.brainBusEvent.findMany({
      where: where as never,
      orderBy: opts.sinceId
        ? { id: "asc" }
        : { id: "desc" },
      take: limit,
    }),
    prisma.brainBusEvent.groupBy({
      by: ["status"],
      _count: { _all: true },
      // 24h window for pulse counts
      where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    }),
  ]);

  const ordered = opts.sinceId ? rows : rows.reverse(); // oldest-first for UI append
  const cursor = ordered.length > 0 ? ordered[ordered.length - 1].id : null;

  const windowCounts = {
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
    dead: 0,
  };
  for (const c of counts) {
    const n = c._count._all;
    if (c.status === "pending") windowCounts.pending = n;
    else if (c.status === "processing") windowCounts.processing = n;
    else if (c.status === "done") windowCounts.done = n;
    else if (c.status === "failed") windowCounts.failed = n;
    else if (c.status === "dead") windowCounts.dead = n;
  }

  return {
    events: ordered.map((r) => ({
      id: r.id,
      topic: r.topic,
      eventType: r.eventType,
      status: r.status,
      attempts: r.attempts,
      payloadPreview: asPreview(r.payload),
      lastError: r.lastError,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
      availableAt: r.availableAt,
    })),
    cursor,
    windowCounts,
  };
}
