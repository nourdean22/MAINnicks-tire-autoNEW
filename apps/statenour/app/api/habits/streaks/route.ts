import { NextResponse } from "next/server";
import { HABITS } from "@/lib/mastery/config";
import { requireSession } from "@/lib/auth-guard";
import { recentDailyHabits } from "@/lib/brain/legacy-shims";

export async function GET(req: Request) {
  // v10.0.37 — auth gate. Pre-fix unauthed.
  await requireSession(req);
  try {
    // v10.0.60 · Wave A part 3 · Pre-fix this route read a dead
    // `Promise.resolve([])` for a HabitLog table that was retired.
    // Now sourced from legacy-shim which synthesizes per-day rows
    // from DAILY-task streakCount + lastCompletedAt. 90-day window
    // matches the original endpoint contract.
    const allRows = await recentDailyHabits(90);

    // Group by habitKey for O(n) lookup
    const byHabit = new Map<string, Array<{ date: string; completed: boolean }>>();
    for (const row of allRows) {
      const arr = byHabit.get(row.habitKey) ?? [];
      arr.push({ date: row.date, completed: row.completed });
      byHabit.set(row.habitKey, arr);
    }

    const streaks = HABITS.map((h) => {
      const rows = byHabit.get(h.key) ?? [];

      let currentStreak = 0;
      let bestStreak = 0;
      let streak = 0;

      for (const row of rows) {
        if (row.completed) {
          streak++;
          if (streak > bestStreak) bestStreak = streak;
        } else {
          if (currentStreak === 0) currentStreak = streak;
          streak = 0;
        }
      }
      if (currentStreak === 0) currentStreak = streak;

      const completedDays = rows.filter((r) => r.completed).length;
      const totalDays = rows.length;

      return {
        habit_key: h.key,
        label: h.label,
        icon: h.icon,
        current_streak: currentStreak,
        best_streak: bestStreak,
        completion_rate: totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0,
        total_tracked: totalDays,
      };
    });

    return NextResponse.json({ ok: true, data: { streaks } });
  } catch (err) {
    console.error("[habits/streaks] GET Error:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
