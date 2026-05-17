import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { sanitizeError } from "@/lib/utils/sanitize-error";

/**
 * GET /api/ultron/time-ghost
 *
 * Today's shape, bucketed into 30-minute cells from 6am to 11pm (34
 * cells total). Each cell has a "kind":
 *
 *   - done     — a task was completed in this 30-min window
 *   - started  — a task moved into DOING in this window
 *   - skipped  — a task was skipped in this window
 *   - capture  — a brain dump or capture hit
 *   - active   — a task is currently DOING spanning this window
 *   - idle     — nothing happened
 *   - future   — this cell is in the future
 *
 * Renders as a horizontal strip with colored pips — at a glance Nour
 * sees his day's shape (flames for done, dots for skips, gray for
 * idle, gold for active).
 */

export const revalidate = 120;

type CellKind = "done" | "started" | "skipped" | "capture" | "active" | "idle" | "future";

interface Cell {
  bucket: number;         // 0..33 (6am..11:30pm in 30min buckets)
  time: string;           // "hh:mm" label
  kind: CellKind;
  count: number;          // tasks/captures in this cell
}

interface GhostPayload {
  date: string;
  cells: Cell[];
  firstActivityBucket: number | null;
  lastActivityBucket: number | null;
  generatedAt: string;
}

function bucketForDate(d: Date): number | null {
  const h = d.getHours();
  const m = d.getMinutes();
  if (h < 6 || h >= 23) return null;
  return (h - 6) * 2 + (m >= 30 ? 1 : 0);
}

function labelForBucket(b: number): string {
  const h = 6 + Math.floor(b / 2);
  const m = b % 2 === 0 ? "00" : "30";
  return `${h.toString().padStart(2, "0")}:${m}`;
}

export async function GET() {
  try {
    const payload = await cached<GhostPayload>("ultron_time_ghost_v1", 120, async () => {
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const dateStr = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

      const [doneTasks, startedTasks, skippedTasks, captures] = await Promise.all([
        prisma.task.findMany({
          where: { status: "DONE", updatedAt: { gte: startOfDay }, deletedAt: null },
          select: { id: true, updatedAt: true },
        }),
        prisma.task.findMany({
          where: { status: "DOING", startedAt: { gte: startOfDay }, deletedAt: null },
          select: { id: true, startedAt: true },
        }),
        prisma.task.findMany({
          where: {
            status: "INBOX",
            lastTouchedAt: { gte: startOfDay },
            autoPriorityExplanation: { startsWith: "skipped" },
            deletedAt: null,
          },
          select: { id: true, lastTouchedAt: true },
        }),
        prisma.brainDump.findMany({
          where: { createdAt: { gte: startOfDay } },
          select: { createdAt: true },
        }),
      ]);

      // Initialize 34 cells (6am to 23:00 in 30-min increments)
      const cells: Cell[] = Array.from({ length: 34 }, (_, i) => ({
        bucket: i,
        time: labelForBucket(i),
        kind: "idle",
        count: 0,
      }));

      const nowBucket = bucketForDate(now);

      // Mark future cells
      if (nowBucket !== null) {
        for (let i = nowBucket + 1; i < cells.length; i++) {
          cells[i].kind = "future";
        }
      }

      // Captures → capture
      for (const c of captures) {
        const b = bucketForDate(c.createdAt);
        if (b !== null) {
          if (cells[b].kind === "idle" || cells[b].kind === "future") cells[b].kind = "capture";
          cells[b].count++;
        }
      }

      // Skipped → skipped
      for (const t of skippedTasks) {
        if (!t.lastTouchedAt) continue;
        const b = bucketForDate(t.lastTouchedAt);
        if (b !== null) {
          if (cells[b].kind === "idle" || cells[b].kind === "capture" || cells[b].kind === "future") {
            cells[b].kind = "skipped";
          }
          cells[b].count++;
        }
      }

      // Started → active (for cells between startedAt and now)
      for (const t of startedTasks) {
        if (!t.startedAt) continue;
        const startB = bucketForDate(t.startedAt);
        if (startB === null || nowBucket === null) continue;
        for (let i = startB; i <= nowBucket; i++) {
          if (cells[i].kind === "idle" || cells[i].kind === "capture" || cells[i].kind === "skipped" || cells[i].kind === "future") {
            cells[i].kind = "active";
            cells[i].count++;
          }
        }
      }

      // Done → done (highest priority, overrides lower signals)
      for (const t of doneTasks) {
        const b = bucketForDate(t.updatedAt);
        if (b !== null) {
          cells[b].kind = "done";
          cells[b].count++;
        }
      }

      // First + last activity bucket
      let firstActivity: number | null = null;
      let lastActivity: number | null = null;
      for (let i = 0; i < cells.length; i++) {
        const k = cells[i].kind;
        if (k !== "idle" && k !== "future") {
          if (firstActivity === null) firstActivity = i;
          lastActivity = i;
        }
      }

      return {
        date: dateStr,
        cells,
        firstActivityBucket: firstActivity,
        lastActivityBucket: lastActivity,
        generatedAt: new Date().toISOString(),
      };
    });

    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: null,
        error: sanitizeError(err),
      },
      { status: 500 }
    );
  }
}
