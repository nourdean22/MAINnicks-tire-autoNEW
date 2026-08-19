/**
 * Task Context — surface Nour's live task queue into the chat
 * system prompt so Nick always knows what's in flight. Apr 19.
 *
 * The bet: Nick can't help you manage tasks if he doesn't know
 * what you're carrying. Every turn now gets a compact task block:
 *
 *   ## Nour's task queue (live)
 *   - [DOING] Install lockbox in the Subaru · p53 · 15m in
 *   - [READY ⚠] Reply to estimate #4821 · p22 CRITICAL · 2d overdue
 *   - [READY] Bloodwork follow-up · p48 · created 3d ago
 *   3 overdue · 2 stalled 7d+ · 1 DAILY streak alive (12d)
 *
 * The rollup line at the bottom is the real weapon: Nick sees
 * overdue/stalled/streak status without scrolling through 40 tasks.
 *
 * Budget: max 10 line items + 1 rollup line. ~800 chars typical.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/task-context");

interface TaskRow {
  id: string;
  title: string;
  status: string;
  loopKind: string;
  autoPriority: number | null;
  streakCount: number;
  lastCompletedAt: Date | null;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  dueDate: Date | null;
  promiseTo: string | null;
  mission: { domain: string } | null;
}

interface TaskBucket {
  doing: TaskRow[];
  criticalReady: TaskRow[];      // autoPriority >= 80 (higher = hotter), not DOING
  overduePromises: TaskRow[];    // PROMISE with dueDate in past
  stalled: TaskRow[];            // READY, no touch 7d+
  dailyWarmStreaks: TaskRow[];   // DAILY with streakCount >= 3 and touched < 36h ago
  dailyBrokenStreaks: TaskRow[]; // DAILY with streakCount >= 3 and NOT touched in 36h+
}

function bucketize(tasks: TaskRow[]): TaskBucket {
  const now = Date.now();
  const doing: TaskRow[] = [];
  const criticalReady: TaskRow[] = [];
  const overduePromises: TaskRow[] = [];
  const stalled: TaskRow[] = [];
  const dailyWarmStreaks: TaskRow[] = [];
  const dailyBrokenStreaks: TaskRow[] = [];

  for (const t of tasks) {
    if (t.status === "DOING") {
      doing.push(t);
      continue;
    }

    if (t.loopKind === "PROMISE" && t.dueDate && t.dueDate.getTime() < now) {
      overduePromises.push(t);
      continue;
    }

    if (t.loopKind === "DAILY" && t.streakCount >= 3) {
      const gapH = t.lastCompletedAt
        ? (now - t.lastCompletedAt.getTime()) / 3600_000
        : 999;
      if (gapH < 36) {
        dailyWarmStreaks.push(t);
      } else if (gapH >= 36) {
        dailyBrokenStreaks.push(t);
      }
      continue;
    }

    if (t.status === "READY" && (t.autoPriority ?? 0) >= 80) {
      criticalReady.push(t);
      continue;
    }

    if (t.status === "READY") {
      const lastTouch = t.updatedAt.getTime();
      const ageH = (now - lastTouch) / 3600_000;
      if (ageH > 24 * 7) {
        stalled.push(t);
      }
    }
  }

  return { doing, criticalReady, overduePromises, stalled, dailyWarmStreaks, dailyBrokenStreaks };
}

function formatLine(t: TaskRow, prefix: string): string {
  const title = t.title.slice(0, 70);
  const p = t.autoPriority != null ? `p${t.autoPriority}` : "";
  const dom = t.mission?.domain ? `·${t.mission.domain}` : "";
  const age = Math.floor((Date.now() - t.createdAt.getTime()) / 86400_000);
  const ageStr = age > 0 ? ` · ${age}d old` : "";

  if (t.loopKind === "PROMISE" && t.dueDate) {
    const daysOver = Math.floor((Date.now() - t.dueDate.getTime()) / 86400_000);
    const who = t.promiseTo ? ` to ${t.promiseTo}` : "";
    return `${prefix} ${title}${who} · ${p} · ${daysOver}d overdue`;
  }
  if (t.loopKind === "DAILY") {
    const streak = t.streakCount ?? 0;
    return `${prefix} ${title} · 🔥${streak}d streak${dom}`;
  }
  if (t.status === "DOING" && t.startedAt) {
    const mins = Math.round((Date.now() - t.startedAt.getTime()) / 60_000);
    return `${prefix} ${title} · ${p}${dom} · ${mins}m in`;
  }
  return `${prefix} ${title} · ${p}${dom}${ageStr}`;
}

/**
 * Build the system-prompt block. Called by the chat route every turn.
 * Non-blocking: returns empty string on any error so we never tank
 * the stream because of a task-context failure.
 */
export async function buildTaskContextBlock(): Promise<string> {
  try {
    const tasks = (await prisma.task.findMany({
      where: {
        status: { in: ["READY", "DOING"] },
        deletedAt: null,
      },
      orderBy: [
        { status: "asc" }, // DOING first alphabetically
        { autoPriority: { sort: "desc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
      take: 80, // generous — the bucketizer picks the best 10
      select: {
        id: true,
        title: true,
        status: true,
        loopKind: true,
        autoPriority: true,
        streakCount: true,
        lastCompletedAt: true,
        startedAt: true,
        createdAt: true,
        updatedAt: true,
        dueDate: true,
        promiseTo: true,
        mission: { select: { domain: true } },
      },
    })) as TaskRow[];

    if (tasks.length === 0) return "";

    const b = bucketize(tasks);
    const lines: string[] = ["## Nour's task queue (live)"];

    // Priority order: DOING first, then critical, then overdue promises, then broken streaks.
    // Warm streaks + stalled in the rollup.
    for (const t of b.doing.slice(0, 2)) lines.push(formatLine(t, "- [DOING]"));
    for (const t of b.criticalReady.slice(0, 3)) lines.push(formatLine(t, "- [READY ⚠]"));
    for (const t of b.overduePromises.slice(0, 3)) lines.push(formatLine(t, "- [PROMISE ⚠]"));
    for (const t of b.dailyBrokenStreaks.slice(0, 2)) lines.push(formatLine(t, "- [DAILY ✗]"));

    // Rollup counters
    const bullets: string[] = [];
    if (b.overduePromises.length > 0) bullets.push(`${b.overduePromises.length} overdue`);
    if (b.stalled.length > 0) bullets.push(`${b.stalled.length} stalled 7d+`);
    if (b.dailyBrokenStreaks.length > 0) bullets.push(`${b.dailyBrokenStreaks.length} broken streak${b.dailyBrokenStreaks.length > 1 ? "s" : ""}`);
    if (b.dailyWarmStreaks.length > 0) {
      const longest = Math.max(...b.dailyWarmStreaks.map((t) => t.streakCount));
      bullets.push(`${b.dailyWarmStreaks.length} warm streak${b.dailyWarmStreaks.length > 1 ? "s" : ""} (longest ${longest}d)`);
    }
    if (bullets.length > 0) {
      lines.push(`_${bullets.join(" · ")}_`);
    }

    lines.push(
      "Reference tasks by id only when Nour asks to act on one. Don't list more than he's asking for.",
    );

    return lines.join("\n");
  } catch (err) {
    log.warn("build_failed", { err: err instanceof Error ? err.message : String(err) });
    return "";
  }
}
