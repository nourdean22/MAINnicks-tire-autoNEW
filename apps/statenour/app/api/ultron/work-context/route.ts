import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

/**
 * GET /api/ultron/work-context
 *
 * Rich context for the Work Widget — stuff too expensive to compute on
 * every render:
 *
 *   - doneToday:          count of tasks completed today
 *   - weekHeatmap:        7-day completion counts (oldest first)
 *   - effortAvgMinutes:   per effort band, the average actual minutes
 *                         Nour has actually taken (learned expectation)
 *   - momentumStreak:     consecutive completions without skip/pause
 *                         today (resets on pause or skip)
 *   - lastCompletedAt:    ISO timestamp of the most recent finish
 *
 * Cached 60s (L1 + Redis). The Work Widget calls this on mount + every
 * minute, which is fine because the underlying Task table changes slowly.
 */

interface WorkContextPayload {
  doneToday: number;
  weekHeatmap: number[];            // length 7, oldest → newest
  effortAvgMinutes: Record<string, number>; // keys: M5/M15/M30/H1/H2PLUS
  momentumStreak: number;
  lastCompletedAt: string | null;
}

export const revalidate = 60;

export async function GET() {
  try {
    const payload = await cached<WorkContextPayload>("ultron_work_context_v1", 60, async () => {
      const today = new Date();
      const todayStr = toDateString(today);

      // Last 14d of DONE tasks (enough to build a 7-day heatmap + effort averages)
      const done14d = await prisma.task
        .findMany({
          where: {
            status: "DONE",
            updatedAt: { gte: daysAgo(14) },
          },
          select: {
            id: true,
            effort: true,
            actualMinutes: true,
            updatedAt: true,
            startedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        })
        .catch((): Array<{
          id: string;
          effort: string | null;
          actualMinutes: number | null;
          updatedAt: Date;
          startedAt: Date | null;
        }> => []);

      // Today count
      const doneToday = done14d.filter((t) => toDateString(t.updatedAt) === todayStr).length;

      // 7-day heatmap (oldest → newest)
      const heatmap: number[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const ds = toDateString(d);
        heatmap.push(done14d.filter((t) => toDateString(t.updatedAt) === ds).length);
      }

      // Effort avg — use actualMinutes when populated, else compute from startedAt→updatedAt
      const effortSums = new Map<string, { total: number; count: number }>();
      for (const t of done14d) {
        if (!t.effort) continue;
        let mins = t.actualMinutes ?? 0;
        if (!mins && t.startedAt) {
          mins = Math.max(0, Math.round((t.updatedAt.getTime() - t.startedAt.getTime()) / 60_000));
        }
        if (mins <= 0 || mins > 480) continue; // filter outliers >8h
        const entry = effortSums.get(t.effort) ?? { total: 0, count: 0 };
        entry.total += mins;
        entry.count += 1;
        effortSums.set(t.effort, entry);
      }
      const effortAvgMinutes: Record<string, number> = {};
      for (const [effort, { total, count }] of effortSums) {
        effortAvgMinutes[effort] = Math.round(total / count);
      }

      // Momentum streak — walk back from most recent completion, counting
      // consecutive DONE today. Resets if there's been a skip/pause today.
      // Simpler proxy in v1: number of DONE today (no skip/pause tracking yet).
      const momentumStreak = doneToday;

      const lastCompletedAt = done14d[0]?.updatedAt?.toISOString() ?? null;

      return {
        doneToday,
        weekHeatmap: heatmap,
        effortAvgMinutes,
        momentumStreak,
        lastCompletedAt,
      };
    });

    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: {
          doneToday: 0,
          weekHeatmap: [0, 0, 0, 0, 0, 0, 0],
          effortAvgMinutes: {},
          momentumStreak: 0,
          lastCompletedAt: null,
        },
        error: String(err),
      },
      { status: 500 },
    );
  }
}
