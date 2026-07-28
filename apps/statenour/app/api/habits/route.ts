import { prisma } from "@/lib/prisma";
import { HABITS } from "@/lib/mastery/config";
import { apiHandler } from "@/lib/utils/http";
import { today } from "@/lib/utils/datetime";
import { logError } from "@/lib/utils/error-log";

/**
 * Apr 19 · MasteryHabit retired (the underlying table was dropped
 * in the Apr 18 schema cleanup). This route now reads habit
 * completion state from DAILY Tasks whose titles match a HABITS
 * entry. Returns the same shape the UI expects so /mastery and
 * the nour-state loader keep working.
 *
 * POST is now a no-op that returns ok:true — habit check-offs go
 * through /api/tasks/[id]/check on the DAILY Task row instead.
 */
export const GET = apiHandler(async (req) => {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || today();

  const [dailyTasks, config] = await Promise.all([
    prisma.task
      .findMany({
        where: { loopKind: "DAILY" },
        select: { title: true, lastCompletedAt: true, streakCount: true },
      })
      .catch(() => [] as Array<{ title: string; lastCompletedAt: Date | null; streakCount: number }>),
    prisma.userPreference.findUnique({ where: { key: "habits_config" } }).catch(() => null),
  ]);

  let enabledKeys: Set<string> | null = null;
  if (config?.value) {
    try {
      const parsed = JSON.parse(config.value);
      if (Array.isArray(parsed)) {
        const enabled = parsed.filter((h: any) => h.enabled !== false).map((h: any) => h.key);
        if (enabled.length > 0) enabledKeys = new Set(enabled);
      }
    } catch {
      // Synthetic message — config content stays out of ErrorLog.
      logError("api.habits", new Error("habit config JSON parse failed"), { stage: "enabled-keys" }, "warn");
    }
  }

  // Loose match: habit key tokens appear in task title (case-insensitive).
  const wasCompletedToday = (task: { lastCompletedAt: Date | null }) => {
    if (!task.lastCompletedAt) return false;
    const d = new Date(task.lastCompletedAt).toISOString().slice(0, 10);
    return d === date;
  };
  const findTaskFor = (habitKey: string, label: string) => {
    const kw = [habitKey.replace(/_/g, " "), label]
      .map((s) => s.toLowerCase());
    return dailyTasks.find((t) => {
      const title = t.title.toLowerCase();
      return kw.some((k) => title.includes(k));
    });
  };

  const habits = HABITS
    .filter((h) => !enabledKeys || enabledKeys.has(h.key))
    .map((h) => {
      const task = findTaskFor(h.key, h.label);
      return {
        ...h,
        completed: task ? wasCompletedToday(task) : false,
        notes: null,
        streak: task?.streakCount ?? 0,
      };
    });

  return { date, habits, totalConfigured: enabledKeys?.size ?? HABITS.length };
}, { auth: "owner" }); // v10.0.37 — was unauthed

export const POST = apiHandler(async () => {
  // No-op: habit check-offs now flow through /api/tasks/[id]/check on
  // the DAILY Task row. Returning ok:true so clients that POST here
  // don't error, but the underlying update doesn't happen.
  return { ok: true, deprecated: true, migrateTo: "/api/tasks/[id]/check" };
});
