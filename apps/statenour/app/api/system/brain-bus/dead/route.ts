/**
 * GET /api/system/brain-bus/dead · v10.0.88 · 2026-05-02.
 *
 * Dead-letter queue inspector. Surfaces brain_bus_events rows whose
 * status is 'dead' (5 retry failures) — these need operator review
 * because they couldn't be delivered through any handler.
 *
 * Also returns a small breakdown by topic + lastError so the
 * operator can see "what's failing repeatedly" at a glance.
 *
 * Auth: owner only — exposes payload contents.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
      200,
    );

    const [deadRows, byTopic, statusCounts, oldestPending, stuckProcessing] =
      await Promise.all([
        prisma.brainBusEvent.findMany({
          where: { status: "dead" },
          orderBy: { updatedAt: "desc" },
          take: limit,
          select: {
            id: true,
            topic: true,
            eventType: true,
            attempts: true,
            lastError: true,
            createdAt: true,
            updatedAt: true,
            payload: true,
          },
        }),
        prisma.brainBusEvent.groupBy({
          by: ["topic", "status"],
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
        }),
        prisma.brainBusEvent.groupBy({
          by: ["status"],
          _count: { id: true },
        }),
        prisma.brainBusEvent.findFirst({
          where: { status: "pending" },
          orderBy: { availableAt: "asc" },
          select: { availableAt: true, topic: true, eventType: true },
        }),
        prisma.brainBusEvent.findFirst({
          where: {
            status: "processing",
            lockedAt: { lt: new Date(Date.now() - 5 * 60_000) },
          },
          orderBy: { lockedAt: "asc" },
          select: { lockedAt: true, topic: true, lockedBy: true },
        }),
      ]);

    const byStatus: Record<string, number> = {};
    statusCounts.forEach((r) => {
      byStatus[r.status] = r._count.id;
    });

    // Aggregate dead by error fingerprint (first 80 chars) so operator
    // can see common failure modes
    const errorBuckets = new Map<string, { count: number; topics: Set<string> }>();
    deadRows.forEach((r) => {
      const fp = (r.lastError ?? "").slice(0, 80) || "(no error message)";
      const bucket = errorBuckets.get(fp) ?? {
        count: 0,
        topics: new Set<string>(),
      };
      bucket.count++;
      bucket.topics.add(r.topic);
      errorBuckets.set(fp, bucket);
    });

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        deadCount: byStatus.dead ?? 0,
        pendingCount: byStatus.pending ?? 0,
        processingCount: byStatus.processing ?? 0,
        doneCount: byStatus.done ?? 0,
        oldestPendingAt: oldestPending?.availableAt.toISOString() ?? null,
        oldestPendingTopic: oldestPending?.topic ?? null,
        stuckProcessing: stuckProcessing
          ? {
              lockedAt: stuckProcessing.lockedAt?.toISOString() ?? null,
              topic: stuckProcessing.topic,
              lockedBy: stuckProcessing.lockedBy,
            }
          : null,
      },
      errorBuckets: [...errorBuckets.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([err, b]) => ({
          error: err,
          count: b.count,
          topics: [...b.topics],
        })),
      byTopic: byTopic.map((r) => ({
        topic: r.topic,
        status: r.status,
        count: r._count.id,
      })),
      deadRows: deadRows.map((r) => ({
        id: r.id,
        topic: r.topic,
        eventType: r.eventType,
        attempts: r.attempts,
        lastError: r.lastError?.slice(0, 240) ?? null,
        createdAt: r.createdAt.toISOString(),
        diedAt: r.updatedAt.toISOString(),
        ageHours:
          Math.round(
            ((Date.now() - r.createdAt.getTime()) / 3_600_000) * 10,
          ) / 10,
        payload: r.payload,
      })),
    };
  },
  { auth: "owner" },
);

/**
 * POST /api/system/brain-bus/dead · revive a dead row.
 *
 * Body: { id: string }
 * Effect: status='dead' → 'pending', attempts=0, lockedAt=null,
 * lastError prepended with 'revived-by-operator: ' marker.
 */
export const POST = apiHandler(
  async (req) => {
    const body = (await req.json()) as { id?: string; ids?: string[] };
    const ids = body.ids ?? (body.id ? [body.id] : []);
    if (ids.length === 0) {
      return { ok: false, error: "id or ids required" };
    }
    const result = await prisma.brainBusEvent.updateMany({
      where: { id: { in: ids }, status: "dead" },
      data: {
        status: "pending",
        attempts: 0,
        lockedAt: null,
        lockedBy: null,
        availableAt: new Date(),
      },
    });
    return { ok: true, revived: result.count };
  },
  { auth: "owner" },
);
