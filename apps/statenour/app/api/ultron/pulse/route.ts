import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

// CP7 · Railway build cannot reach Neon during static prerender. Force
// runtime-only · same effective behavior as Vercel due to the cached()
// wrapper. No production semantics change.
export const dynamic = "force-dynamic";

/**
 * GET /api/ultron/pulse
 *
 * THE 4-STACK — the hero chips that live at the top of Ultron:
 *   body · mind · money · life
 *
 * One composite call replaces what would otherwise be 8+ fragmented fetches
 * across the old /mastery + /body + /financial + /drift + /causation surfaces.
 * Cached 60s (L1) + Redis on top.
 *
 * Shape is flat and stable. The UI maps each chip to a color/spark/delta
 * without needing to understand the underlying engines.
 */

type DomainRow = { date: string; score: number; delta: number | null };

interface PulsePayload {
  body: {
    score: number;
    delta: number;
    spark: number[];
    workoutStreak: number;
    weightTrend: number | null; // delta over 30d, null if <2 entries
  };
  mind: {
    score: number;
    delta: number;
    spark: number[];
    driftBudget: { current: number; cap: number };
    focusScore: number | null; // 0-100 attention alignment
  };
  money: {
    netDelta: number;         // month-over-month net worth delta
    savingsRate: number | null;
    debtChange: number;       // month-over-month debt delta
    spark: number[];          // last 12 net-worth snapshots
  };
  life: {
    callsPending: number;
  };
  generatedAt: string;
}

export const revalidate = 60;

// Helper: pick the latest MasteryScore for a domain plus last 14 days for spark
async function domainPulse(domain: string, since: Date): Promise<{ score: number; delta: number; spark: number[] }> {
  const rows = await prisma.masteryScore
    .findMany({
      where: { domain, date: { gte: toDateString(since) } },
      orderBy: { date: "asc" },
      select: { date: true, score: true, delta: true },
    })
    .catch((): DomainRow[] => []);
  if (rows.length === 0) return { score: 0, delta: 0, spark: [] };
  const latest = rows[rows.length - 1];
  return {
    score: latest.score,
    delta: latest.delta ?? 0,
    spark: rows.map((r) => r.score),
  };
}

export async function GET() {
  try {
    const payload = await cached<PulsePayload>("ultron_pulse_v1", 60, async () => {
      const fourteen = daysAgo(14);
      const thirty = daysAgo(30);
      const sevenDayStr = toDateString(daysAgo(7));

      const [
        physicalPulse,
        mentalPulse,
        workoutEntries,
        weightPoints,
        driftAlertsOpen,
        financialSnapshots,
        people,
        callbacks,
      ] = await Promise.all([
        domainPulse("physical", fourteen),
        domainPulse("mental", fourteen),
        // v10.0.60 · Wave A part 3 · habits via legacy-shim (HabitLog
        // retired; DAILY-task streak synthesis provides the same
        // per-day completion shape).
        (async () => {
          const { recentDailyHabits } = await import("@/lib/brain/legacy-shims");
          const all = await recentDailyHabits(14);
          return all.map((r) => ({ date: r.date, completed: r.completed }));
        })(),
        prisma.bodyTracking.findMany({
          where: { date: { gte: toDateString(thirty) } },
          select: { date: true, weight: true },
          orderBy: { date: "asc" },
        }).catch((): Array<{ date: string; weight: number | null }> => []),
        (async () => {
          const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
          const alerts = await getUnresolvedAlerts().catch(() => []);
          return alerts.length;
        })(),
        prisma.financialSnapshot.findMany({
          orderBy: { date: "desc" },
          take: 12,
          select: {
            date: true,
            netWorthEstimate: true,
            savingsRatePct: true,
            totalDebt: true,
          },
        }).catch((): Array<{ date: string; netWorthEstimate: number | null; savingsRatePct: number | null; totalDebt: number | null }> => []),
        prisma.personProfile.findMany({
          where: {
            role: { in: ["family", "friend", "partner", "wife", "dania"] },
          },
          select: { name: true, role: true, relationship: true, lastInteraction: true },
          take: 20,
        }).catch((): Array<{ name: string; role: string; relationship: string; lastInteraction: Date | null }> => []),
        // Apr 18: OpenLoop retired → Task queue.
        prisma.task.count({
          where: {
            status: { in: ["INBOX", "READY"] },
            OR: [{ title: { contains: "callback", mode: "insensitive" } }, { title: { contains: "call", mode: "insensitive" } }],
          },
        }).catch(() => 0),
      ]);

      // ── BODY
      const workoutStreak = (() => {
        // How many consecutive days ending today have workoutDone=true?
        let streak = 0;
        const todayStr = toDateString(new Date());
        // Apr 18: masteryHabit is now a retired-model shim returning any[];
        // cast the mapped tuples explicitly so Map's iterable constructor is happy.
        const map = new Map(
          (workoutEntries as Array<{ date: string; completed: boolean }>)
            .map((w) => [w.date, w.completed] as [string, boolean]),
        );
        const cursor = new Date();
        // Walk back from today, stop at first miss
        for (let i = 0; i < 30; i++) {
          const ds = toDateString(cursor);
          if (i === 0 && !map.has(ds)) break; // today not yet entered → streak is yesterday-backward
          if (map.get(ds)) streak++;
          else if (i > 0) break;
          cursor.setDate(cursor.getDate() - 1);
          if (ds < toDateString(daysAgo(30))) break;
          void todayStr;
        }
        return streak;
      })();

      const weightTrend: number | null = (() => {
        const ws = weightPoints
          .filter((p: { weight: number | null }) => p.weight != null)
          .map((p: { weight: number | null }) => p.weight as number);
        if (ws.length < 2) return null;
        return Math.round((ws[ws.length - 1] - ws[0]) * 10) / 10; // 30-day delta
      })();

      const body = {
        score: Math.round(physicalPulse.score * 10) / 10,
        delta: Math.round(physicalPulse.delta * 10) / 10,
        spark: physicalPulse.spark,
        workoutStreak,
        weightTrend,
      };

      // ── MIND
      // Drift budget = open drift alerts as a % of a soft cap (10)
      const driftCap = 10;
      const driftBudget = {
        current: Math.min(driftAlertsOpen, driftCap),
        cap: driftCap,
      };

      // Focus score lives on attention-tracker context; we leave it null here
      // to avoid hammering that engine in the hot path — signal API surfaces it.
      const mind = {
        score: Math.round(mentalPulse.score * 10) / 10,
        delta: Math.round(mentalPulse.delta * 10) / 10,
        spark: mentalPulse.spark,
        driftBudget,
        focusScore: null as number | null,
      };

      // ── MONEY
      const sortedSnaps = [...financialSnapshots].reverse(); // oldest→newest
      const sparkMoney = sortedSnaps.map((s) => s.netWorthEstimate ?? 0);
      let netDelta = 0;
      let debtChange = 0;
      if (sortedSnaps.length >= 2) {
        const last = sortedSnaps[sortedSnaps.length - 1];
        const prev = sortedSnaps[sortedSnaps.length - 2];
        netDelta = (last.netWorthEstimate ?? 0) - (prev.netWorthEstimate ?? 0);
        debtChange = (last.totalDebt ?? 0) - (prev.totalDebt ?? 0);
      }
      const money = {
        netDelta: Math.round(netDelta),
        savingsRate: sortedSnaps[sortedSnaps.length - 1]?.savingsRatePct ?? null,
        debtChange: Math.round(debtChange),
        spark: sparkMoney,
      };

      // ── LIFE
      // 2026-05-31 · relationship-silence exposure scrubbed (D-REL — no
      // person-silence nags surfaced anywhere). Only the neutral callback
      // count remains. (`people` query left in the fan-out for now; see the
      // flagged deeper-cleanup note.)
      void people;
      const life = {
        callsPending: callbacks,
      };

      return {
        body,
        mind,
        money,
        life,
        generatedAt: new Date().toISOString(),
      };
    });

    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: {
          body: { score: 0, delta: 0, spark: [], workoutStreak: 0, weightTrend: null },
          mind: { score: 0, delta: 0, spark: [], driftBudget: { current: 0, cap: 10 }, focusScore: null },
          money: { netDelta: 0, savingsRate: null, debtChange: 0, spark: [] },
          life: { daniaSilent: 0, familySilent: 0, topSilent: null, callsPending: 0 },
          generatedAt: new Date().toISOString(),
        },
        error: String(err),
      },
      { status: 500 },
    );
  }
}
