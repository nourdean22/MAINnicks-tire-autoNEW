/**
 * /api/system/mission-surface-stats · Wave AA Phase 4 · 2026-05-28.
 *
 * Telemetry sink for the /missions page · receives batches from the
 * client `useMissionSurfaceTelemetry` hook. Aggregates into BrainMemory
 * rows keyed by ISO date so the Phase 4 prune script can scan a fixed
 * window without touching the raw event stream.
 *
 * SHAPE
 *   POST · body: { version, events: [{ surface, event, ts, meta? }] }
 *
 * STORAGE
 *   category: BRAIN_CATEGORIES.MISSION_SURFACE_TELEMETRY
 *   key:      `surface_${YYYY-MM-DD}_${surface}`   (idempotent · upsert)
 *   content:  daily-summary string (counts per event)
 *   metadata: { batches: [...buffered events for the day] }
 *
 * Aggregation is intentionally per-day · the prune analysis only needs
 * "did event E fire on day D" granularity, not millisecond precision.
 * 30-day retention via a cleanup cron (not wired here · BrainMemory
 * already has its own decay logic).
 *
 * The endpoint is fire-and-forget · returns 204 on success, swallows
 * errors and returns 204 anyway so the client never retries-with-state.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/system/mission-surface-stats");

export async function POST(req: Request): Promise<NextResponse> {
  // WP-12 census finding (2026-07-29): this handler writes aggregated
  // buckets into BrainMemory and was UNAUTHENTICATED, while the GET
  // below it required a session — the mirror image of the defect class
  // check-sensitive-get-auth.ts was built for. The only caller is the
  // operator's own PWA (lib/telemetry/mission-surface.ts, same-origin
  // fetch → session cookie present), so gating changes no legitimate
  // traffic and closes an open write into the brain store.
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as {
      version: string;
      events: Array<{
        surface: string;
        event: string;
        ts: string;
        meta?: Record<string, unknown>;
      }>;
    };
    if (!body || !Array.isArray(body.events)) {
      return new NextResponse(null, { status: 204 });
    }

    // Bucket by (surface, day)
    const buckets = new Map<
      string,
      { surface: string; day: string; events: typeof body.events }
    >();
    for (const e of body.events) {
      const day = (e.ts ?? new Date().toISOString()).slice(0, 10); // YYYY-MM-DD
      const key = `${e.surface}::${day}`;
      const bucket = buckets.get(key) ?? {
        surface: e.surface,
        day,
        events: [],
      };
      bucket.events.push(e);
      buckets.set(key, bucket);
    }

    for (const { surface, day, events } of buckets.values()) {
      const memoryKey = `surface_${day}_${surface}`;
      const counts = events.reduce<Record<string, number>>((acc, e) => {
        acc[e.event] = (acc[e.event] ?? 0) + 1;
        return acc;
      }, {});
      const content = `surface=${surface} day=${day} ${Object.entries(
        counts,
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}`;

      const existing = await prisma.brainMemory.findFirst({
        where: {
          category: BRAIN_CATEGORIES.MISSION_SURFACE_TELEMETRY,
          key: memoryKey,
        },
        select: { id: true, metadata: true },
      });

      if (existing) {
        const prevMeta =
          (existing.metadata as Record<string, unknown> | null) ?? {};
        const prevCounts =
          (prevMeta.counts as Record<string, number> | undefined) ?? {};
        const prevEvents =
          (prevMeta.events as Array<unknown> | undefined) ?? [];
        const mergedCounts: Record<string, number> = { ...prevCounts };
        for (const [k, v] of Object.entries(counts)) {
          mergedCounts[k] = (mergedCounts[k] ?? 0) + v;
        }
        const mergedContent = `surface=${surface} day=${day} ${Object.entries(
          mergedCounts,
        )
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`;
        await prisma.brainMemory.update({
          where: { id: existing.id },
          data: {
            content: mergedContent,
            lastSeen: new Date(),
            metadata: {
              counts: mergedCounts,
              // Keep a rolling 200-event window per day · enough for
              // the prune analysis without unbounded growth.
              events: [...prevEvents, ...events].slice(-200),
              version: body.version,
            } as never,
          },
        });
      } else {
        await prisma.brainMemory.create({
          data: {
            category: BRAIN_CATEGORIES.MISSION_SURFACE_TELEMETRY,
            key: memoryKey,
            content,
            confidence: 1.0,
            source: "client_telemetry",
            createdBy: "user",
            metadata: {
              counts,
              events: events.slice(-200),
              version: body.version,
            } as never,
          },
        });
      }
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    log.warn("telemetry_persist_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    // Fail-silent · telemetry never breaks the UI.
    return new NextResponse(null, { status: 204 });
  }
}

/**
 * GET · returns the last 14 days of aggregated counts per surface,
 * shaped for the Phase 4 prune analysis script. No operator UI yet.
 */
export async function GET(req: Request): Promise<NextResponse> {
  // Auth (2026-07-28 cron-truth audit, dim 6): this GET dumped 14 days
  // of mission-surface telemetry with NO gate — the only genuinely open
  // route the sensitive-GET checker found. Operator-private per house
  // rule 4; the POST sink below stays fire-and-forget by design.
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);

    const rows = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.MISSION_SURFACE_TELEMETRY,
        createdAt: { gte: cutoff },
      },
      orderBy: { key: "asc" },
      select: {
        key: true,
        content: true,
        metadata: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      version: "wave-aa-2026-05-28",
      days: rows.length,
      summary: rows.map((r) => ({
        key: r.key,
        counts:
          (((r.metadata as Record<string, unknown> | null) ?? {})
            .counts as Record<string, number> | undefined) ?? {},
        eventSample:
          (((r.metadata as Record<string, unknown> | null) ?? {})
            .events as Array<unknown> | undefined)?.slice(-5) ?? [],
      })),
    });
  } catch (err) {
    log.error("telemetry_read_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
}
