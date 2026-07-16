/**
 * Teaching Moments Engine
 *
 * Watches for patterns in Nour's data and generates "teaching moments" —
 * short, data-backed explanations of WHY something happened, not just WHAT.
 *
 * Runs during the evening cron. Stores moments as brain memories.
 * The system prompt surfaces them so Nick can teach proactively.
 *
 * A teaching moment has:
 * - OBSERVATION: what the data shows
 * - WHY: the underlying mechanism
 * - LESSON: what to do differently
 * - EVIDENCE: specific numbers
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { daysAgo, today, toDateString } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  recentScoreSnapshots,
  recentDailyHabits,
  recentShopJobs,
  recentShopLeads,
} from "@/lib/brain/legacy-shims";

export interface TeachingMoment {
  topic: string;
  observation: string;
  why: string;
  lesson: string;
  evidence: string;
  domain: string;
}

/**
 * Scan recent data for teachable patterns.
 * Each check is a simple data analysis — no AI calls.
 */
export async function findTeachingMoments(): Promise<TeachingMoment[]> {
  const moments: TeachingMoment[] = [];
  const sevenDaysAgo = daysAgo(7);
  const fourteenDaysAgo = daysAgo(14);

  // Typed empty arrays so downstream code can access properties even on the fallback path.
  type ScoreRow = { date: string; overallScore: number | null; energyLevel: number | null; focusQuality: number | null; workoutDone: boolean; disciplineScore: number | null; journalDone: boolean };
  type JobRow = { jobDate: Date; totalRevenue: number | null };
  type LeadRow = { status: string; timeToResponseMinutes: number | null; createdAt: Date };
  type HabitRow = { date: string; habitKey: string; completed: boolean };

  const [scores, jobs, leads, habits] = await Promise.all([
    // v10.0.55 · scores/habits via legacy-shims; jobs/leads currently
    // empty (no nickstire bridge query exposes ranged lists yet).
    recentScoreSnapshots(30) as unknown as Promise<ScoreRow[]>,
    recentShopJobs(30) as unknown as Promise<JobRow[]>,
    recentShopLeads(30) as unknown as Promise<LeadRow[]>,
    recentDailyHabits(30) as unknown as Promise<HabitRow[]>,
  ]);

  // ── Workout → Next-Day Score ──
  if (scores.length >= 7) {
    let workoutNextDayScores: number[] = [];
    let noWorkoutNextDayScores: number[] = [];

    for (let i = 0; i < scores.length - 1; i++) {
      const today = scores[i];
      const tomorrow = scores[i + 1];
      if (today.workoutDone) {
        workoutNextDayScores.push(tomorrow.overallScore ?? 0);
      } else {
        noWorkoutNextDayScores.push(tomorrow.overallScore ?? 0);
      }
    }

    if (workoutNextDayScores.length >= 3 && noWorkoutNextDayScores.length >= 3) {
      const avgAfterWorkout = workoutNextDayScores.reduce((s, v) => s + v, 0) / workoutNextDayScores.length;
      const avgAfterNoWorkout = noWorkoutNextDayScores.reduce((s, v) => s + v, 0) / noWorkoutNextDayScores.length;
      const diff = avgAfterWorkout - avgAfterNoWorkout;

      if (Math.abs(diff) >= 0.5) {
        moments.push({
          topic: "Workout → Next-Day Performance",
          observation: diff > 0
            ? `Days after workouts score ${diff.toFixed(1)} points higher`
            : `Surprisingly, days after rest score ${Math.abs(diff).toFixed(1)} points higher`,
          why: diff > 0
            ? "Exercise increases BDNF (brain-derived neurotrophic factor), improves sleep quality, and boosts morning cortisol for focus"
            : "You may be overtraining — recovery days might be producing better cognitive output",
          lesson: diff > 0
            ? "Protect workout time. It's not just health — it directly predicts tomorrow's performance."
            : "Check workout intensity. More isn't always better — quality recovery matters.",
          evidence: `After workout: ${avgAfterWorkout.toFixed(1)}/10 avg (n=${workoutNextDayScores.length}). After rest: ${avgAfterNoWorkout.toFixed(1)}/10 (n=${noWorkoutNextDayScores.length}).`,
          domain: "body-performance",
        });
      }
    }
  }

  // ── Lead Response Time → Conversion ──
  if (leads.length >= 10) {
    const withResponse = leads.filter(l => l.timeToResponseMinutes != null && l.timeToResponseMinutes > 0);
    const fast = withResponse.filter(l => l.timeToResponseMinutes! < 60);
    const slow = withResponse.filter(l => l.timeToResponseMinutes! >= 60);

    if (fast.length >= 3 && slow.length >= 3) {
      const fastConvert = fast.filter(l => l.status === "BOOKED").length / fast.length;
      const slowConvert = slow.filter(l => l.status === "BOOKED").length / slow.length;

      if (fastConvert > slowConvert + 0.1) {
        moments.push({
          topic: "Response Speed → Conversion",
          observation: `Leads responded to in <1hr convert at ${(fastConvert * 100).toFixed(0)}% vs ${(slowConvert * 100).toFixed(0)}% for 1hr+`,
          why: "First-responder advantage: 78% of customers go with the first shop that responds. After 1 hour, they've already called someone else.",
          lesson: "Every lead over 30 minutes old is losing conversion probability. Prioritize response speed over response quality.",
          evidence: `Fast (<1hr): ${(fastConvert * 100).toFixed(0)}% conversion (n=${fast.length}). Slow (1hr+): ${(slowConvert * 100).toFixed(0)}% (n=${slow.length}).`,
          domain: "revenue",
        });
      }
    }
  }

  // ── Habit Streak → Score Trend ──
  if (habits.length >= 14 && scores.length >= 7) {
    const thisWeekHabits = habits.filter(h => new Date(h.date + "T12:00:00") >= sevenDaysAgo);
    const lastWeekHabits = habits.filter(h => {
      const d = new Date(h.date + "T12:00:00");
      return d >= fourteenDaysAgo && d < sevenDaysAgo;
    });

    const thisWeekRate = thisWeekHabits.length > 0
      ? thisWeekHabits.filter(h => h.completed).length / thisWeekHabits.length
      : 0;
    const lastWeekRate = lastWeekHabits.length > 0
      ? lastWeekHabits.filter(h => h.completed).length / lastWeekHabits.length
      : 0;

    const thisWeekScores = scores.filter(s => new Date(s.date + "T12:00:00") >= sevenDaysAgo);
    const lastWeekScores = scores.filter(s => {
      const d = new Date(s.date + "T12:00:00");
      return d >= fourteenDaysAgo && d < sevenDaysAgo;
    });

    const thisAvg = thisWeekScores.length > 0
      ? thisWeekScores.reduce((s, v) => s + (v.overallScore ?? 0), 0) / thisWeekScores.length
      : 0;
    const lastAvg = lastWeekScores.length > 0
      ? lastWeekScores.reduce((s, v) => s + (v.overallScore ?? 0), 0) / lastWeekScores.length
      : 0;

    if (thisWeekRate > lastWeekRate + 0.15 && thisAvg > lastAvg + 0.5) {
      moments.push({
        topic: "Habits Up → Score Up",
        observation: `Habit completion rose ${((thisWeekRate - lastWeekRate) * 100).toFixed(0)}% this week, scores followed (+${(thisAvg - lastAvg).toFixed(1)})`,
        why: "Habits create compound discipline. Each completed habit reinforces the identity of 'someone who follows through,' making the next one easier.",
        lesson: "The habits aren't just tasks — they're building your operating identity. Protect the streak.",
        evidence: `This week: ${(thisWeekRate * 100).toFixed(0)}% habits, ${thisAvg.toFixed(1)}/10 avg. Last week: ${(lastWeekRate * 100).toFixed(0)}%, ${lastAvg.toFixed(1)}/10.`,
        domain: "mastery",
      });
    } else if (thisWeekRate < lastWeekRate - 0.15 && thisAvg < lastAvg - 0.5) {
      moments.push({
        topic: "Habits Down → Score Down",
        observation: `Habit completion dropped ${((lastWeekRate - thisWeekRate) * 100).toFixed(0)}% and scores followed (${(thisAvg - lastAvg).toFixed(1)})`,
        why: "Habit decay is a leading indicator of drift. The score drop isn't random — it's a direct consequence of broken routines.",
        lesson: "Don't wait for the score to drop to fix the habits. The habits ARE the score.",
        evidence: `This week: ${(thisWeekRate * 100).toFixed(0)}% habits, ${thisAvg.toFixed(1)}/10. Last week: ${(lastWeekRate * 100).toFixed(0)}%, ${lastAvg.toFixed(1)}/10.`,
        domain: "mastery",
      });
    }
  }

  // ── Revenue by Day-of-Week ──
  if (jobs.length >= 14) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const byDow: Record<number, number[]> = {};
    for (const j of jobs) {
      const dow = j.jobDate.getDay();
      if (!byDow[dow]) byDow[dow] = [];
      byDow[dow].push(Number(j.totalRevenue));
    }

    const avgByDow = Object.entries(byDow)
      .filter(([, revs]) => revs.length >= 2)
      .map(([dow, revs]) => ({
        day: dayNames[Number(dow)],
        avg: revs.reduce((s, v) => s + v, 0) / revs.length,
        count: revs.length,
      }))
      .sort((a, b) => b.avg - a.avg);

    if (avgByDow.length >= 3) {
      const best = avgByDow[0];
      const worst = avgByDow[avgByDow.length - 1];
      const ratio = best.avg / (worst.avg || 1);

      if (ratio >= 1.5) {
        moments.push({
          topic: "Best vs Worst Revenue Day",
          observation: `${best.day} averages $${best.avg.toFixed(0)} vs ${worst.day} at $${worst.avg.toFixed(0)} (${ratio.toFixed(1)}x difference)`,
          why: "Demand patterns follow weekly cycles driven by customer behavior, weather patterns, and competitor schedules.",
          lesson: `Stack marketing spend and follow-up calls on ${best.day}. Consider running specials on ${worst.day} to lift the floor.`,
          evidence: `${best.day}: $${best.avg.toFixed(0)} avg (n=${best.count}). ${worst.day}: $${worst.avg.toFixed(0)} (n=${worst.count}).`,
          domain: "revenue",
        });
      }
    }
  }

  // ── Discipline Score → Next 3 Days Revenue ──
  if (scores.length >= 10 && jobs.length >= 10) {
    const scoreMap = new Map(scores.map((s) => [s.date, s] as const));
    const revByDate = new Map<string, number>();
    for (const j of jobs) {
      const d = j.jobDate.toISOString().split("T")[0];
      revByDate.set(d, (revByDate.get(d) ?? 0) + Number(j.totalRevenue));
    }

    let highDiscRevenue = 0, highDiscDays = 0;
    let lowDiscRevenue = 0, lowDiscDays = 0;

    for (const s of scores) {
      if ((s.disciplineScore ?? 0) === 0) continue;
      // Look at next 3 days of revenue
      const d = new Date(s.date + "T12:00:00");
      let threeDay = 0;
      let found = 0;
      for (let offset = 1; offset <= 3; offset++) {
        const next = new Date(d.getTime() + offset * 86400000).toISOString().split("T")[0];
        const rev = revByDate.get(next);
        if (rev !== undefined) { threeDay += rev; found++; }
      }
      if (found < 2) continue;

      if ((s.disciplineScore ?? 0) >= 7) {
        highDiscRevenue += threeDay; highDiscDays++;
      } else if ((s.disciplineScore ?? 0) <= 4) {
        lowDiscRevenue += threeDay; lowDiscDays++;
      }
    }

    if (highDiscDays >= 3 && lowDiscDays >= 3) {
      const highAvg = highDiscRevenue / highDiscDays;
      const lowAvg = lowDiscRevenue / lowDiscDays;
      const diff = ((highAvg - lowAvg) / (lowAvg || 1)) * 100;

      if (Math.abs(diff) >= 10) {
        moments.push({
          topic: "Discipline → 3-Day Revenue",
          observation: diff > 0
            ? `High-discipline days (7+) predict ${diff.toFixed(0)}% more revenue over the next 3 days`
            : `Low-discipline days actually predict higher revenue — investigate why`,
          why: "Discipline creates follow-through: callbacks get made, quotes get followed up, customers feel the energy. The effect compounds over 2-3 days.",
          lesson: diff > 0
            ? "Discipline isn't just personal — it's a direct revenue multiplier. A 7/10 discipline day is worth real money."
            : "Examine what happens on low-discipline days. Are you more relaxed with customers? More present?",
          evidence: `High discipline (7+): $${highAvg.toFixed(0)} avg 3-day revenue (n=${highDiscDays}). Low (≤4): $${lowAvg.toFixed(0)} (n=${lowDiscDays}).`,
          domain: "discipline-revenue",
        });
      }
    }
  }

  // ── Journal Entry → Decision Quality ──
  if (scores.length >= 10) {
    const journalDays = scores.filter(s => s.journalDone);
    const noJournalDays = scores.filter(s => !s.journalDone);

    if (journalDays.length >= 3 && noJournalDays.length >= 3) {
      const journalFocus = journalDays.reduce((s, d) => s + (d.focusQuality ?? 0), 0) / journalDays.length;
      const noJournalFocus = noJournalDays.reduce((s, d) => s + (d.focusQuality ?? 0), 0) / noJournalDays.length;
      const diff = journalFocus - noJournalFocus;

      if (Math.abs(diff) >= 0.5) {
        moments.push({
          topic: "Journaling → Focus Quality",
          observation: diff > 0
            ? `Days with journaling have ${diff.toFixed(1)} higher focus scores`
            : `Surprisingly, non-journal days show better focus — are you journaling to avoid real work?`,
          why: diff > 0
            ? "Journaling externalizes mental load. When thoughts are on paper, working memory is free for execution."
            : "If journaling takes too long, it becomes procrastination disguised as productivity.",
          lesson: diff > 0
            ? "5 minutes of morning journaling isn't optional. It's a focus multiplier."
            : "Keep journal entries under 5 minutes. Brain dump, then execute.",
          evidence: `Journal days: ${journalFocus.toFixed(1)} avg focus (n=${journalDays.length}). No journal: ${noJournalFocus.toFixed(1)} (n=${noJournalDays.length}).`,
          domain: "focus",
        });
      }
    }
  }

  // ── Weekend Workout → Monday Performance ──
  if (scores.length >= 14) {
    const mondays = scores.filter(s => new Date(s.date + "T12:00:00").getDay() === 1);
    const saturdays = scores.filter(s => new Date(s.date + "T12:00:00").getDay() === 6);
    const sundays = scores.filter(s => new Date(s.date + "T12:00:00").getDay() === 0);

    // Build weekend workout map
    const weekendWorkoutMap = new Map<string, boolean>();
    for (const s of [...saturdays, ...sundays]) {
      if (!s.workoutDone) continue;
      // Find the following Monday
      const d = new Date(s.date + "T12:00:00");
      const daysToMon = (8 - d.getDay()) % 7 || 7;
      const monday = new Date(d.getTime() + daysToMon * 86400000).toISOString().split("T")[0];
      weekendWorkoutMap.set(monday, true);
    }

    const mondayAfterWorkout = mondays.filter(m => weekendWorkoutMap.has(m.date));
    const mondayNoWorkout = mondays.filter(m => !weekendWorkoutMap.has(m.date));

    if (mondayAfterWorkout.length >= 2 && mondayNoWorkout.length >= 2) {
      const avgAfter = mondayAfterWorkout.reduce((s, m) => s + (m.overallScore ?? 0), 0) / mondayAfterWorkout.length;
      const avgNo = mondayNoWorkout.reduce((s, m) => s + (m.overallScore ?? 0), 0) / mondayNoWorkout.length;
      const diff = avgAfter - avgNo;

      if (Math.abs(diff) >= 0.5) {
        moments.push({
          topic: "Weekend Workout → Monday Launch",
          observation: diff > 0
            ? `Mondays after weekend workouts score ${diff.toFixed(1)} points higher`
            : `Weekend rest produces better Mondays — you may need the recovery`,
          why: diff > 0
            ? "Weekend workouts maintain metabolic momentum. Skipping Saturday/Sunday creates a 48-72h gap that makes Monday feel like starting from zero."
            : "Recovery is productive. If your body needs Saturday/Sunday off, your Monday brain benefits.",
          lesson: diff > 0
            ? "Saturday workout is non-negotiable. It's not about Saturday — it's about Monday."
            : "Monitor your recovery needs. Quality rest > forced workouts.",
          evidence: `Monday after weekend workout: ${avgAfter.toFixed(1)}/10 (n=${mondayAfterWorkout.length}). Monday without: ${avgNo.toFixed(1)} (n=${mondayNoWorkout.length}).`,
          domain: "body-performance",
        });
      }
    }
  }

  // ── Open Loops → Energy Drain ──
  if (scores.length >= 7) {
    const highLoopScores: number[] = [];
    const lowLoopScores: number[] = [];

    for (const s of scores) {
      // Count active tasks (Apr 18: OpenLoop → Task) that existed on this date.
      const loopCountOnDate = await prisma.task.count({
        where: {
          deletedAt: null,
          status: { in: ["INBOX", "READY", "DOING"] },
          createdAt: { lte: new Date(s.date + "T23:59:59") },
        },
      }).catch(() => -1);

      if (loopCountOnDate === -1) continue;

      if (loopCountOnDate >= 6) {
        highLoopScores.push(s.energyLevel ?? 0);
      } else if (loopCountOnDate <= 3) {
        lowLoopScores.push(s.energyLevel ?? 0);
      }
    }

    if (highLoopScores.length >= 3 && lowLoopScores.length >= 3) {
      const highAvg = highLoopScores.reduce((s, v) => s + v, 0) / highLoopScores.length;
      const lowAvg = lowLoopScores.reduce((s, v) => s + v, 0) / lowLoopScores.length;
      const diff = lowAvg - highAvg;

      if (diff >= 0.5) {
        moments.push({
          topic: "Open Loops → Energy Drain",
          observation: `Energy is ${diff.toFixed(1)} points lower when 6+ loops are open vs ≤3`,
          why: "Each open loop occupies background processing in your brain (Zeigarnik effect). More loops = more mental overhead = less energy for execution.",
          lesson: "Before starting anything new, close or delegate 2 loops. Your energy is literally being drained by unfinished work.",
          evidence: `6+ loops: ${highAvg.toFixed(1)} avg energy (n=${highLoopScores.length}). ≤3 loops: ${lowAvg.toFixed(1)} (n=${lowLoopScores.length}).`,
          domain: "productivity",
        });
      }
    }
  }

  // ── Lead Response by Time of Day ──
  if (leads.length >= 15) {
    const morningLeads = leads.filter(l => {
      const hr = new Date(l.createdAt).getHours();
      return hr >= 8 && hr < 12;
    });
    const afternoonLeads = leads.filter(l => {
      const hr = new Date(l.createdAt).getHours();
      return hr >= 12 && hr < 17;
    });

    if (morningLeads.length >= 5 && afternoonLeads.length >= 5) {
      const morningConvert = morningLeads.filter(l => l.status === "BOOKED").length / morningLeads.length;
      const afternoonConvert = afternoonLeads.filter(l => l.status === "BOOKED").length / afternoonLeads.length;

      if (Math.abs(morningConvert - afternoonConvert) >= 0.1) {
        const better = morningConvert > afternoonConvert ? "Morning" : "Afternoon";
        const diff = Math.abs(morningConvert - afternoonConvert) * 100;

        moments.push({
          topic: "Lead Timing → Conversion",
          observation: `${better} leads convert ${diff.toFixed(0)}% better`,
          why: better === "Morning"
            ? "Morning customers are planners — they've already decided they need service. Afternoon leads are often comparison shoppers."
            : "Afternoon customers may be more urgent (car broke down today) and convert faster out of necessity.",
          lesson: better === "Morning"
            ? "Prioritize morning lead response. These are your highest-quality leads."
            : "Don't deprioritize afternoon leads — they may be the most urgent.",
          evidence: `Morning: ${(morningConvert * 100).toFixed(0)}% conversion (n=${morningLeads.length}). Afternoon: ${(afternoonConvert * 100).toFixed(0)}% (n=${afternoonLeads.length}).`,
          domain: "revenue",
        });
      }
    }
  }

  // ── Score Logging Gap → Drift Prediction ──
  if (scores.length >= 14) {
    let gapDrifts = 0, gapNoDrifts = 0;
    let noGapDrifts = 0, noGapNoDrifts = 0;

    for (let i = 1; i < scores.length - 3; i++) {
      const prev = new Date(scores[i - 1].date + "T12:00:00");
      const curr = new Date(scores[i].date + "T12:00:00");
      const gapDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);

      // Check if scores dropped in the next 3 entries
      const nextThree = scores.slice(i + 1, i + 4);
      const avgNext = nextThree.length > 0
        ? nextThree.reduce((s, sc) => s + (sc.overallScore ?? 0), 0) / nextThree.length
        : 0;
      const dropped = avgNext < (scores[i].overallScore ?? 0) - 1;

      if (gapDays >= 2) {
        if (dropped) gapDrifts++;
        else gapNoDrifts++;
      } else {
        if (dropped) noGapDrifts++;
        else noGapNoDrifts++;
      }
    }

    const totalGap = gapDrifts + gapNoDrifts;
    const totalNoGap = noGapDrifts + noGapNoDrifts;

    if (totalGap >= 3 && totalNoGap >= 3) {
      const gapDriftRate = gapDrifts / totalGap;
      const noGapDriftRate = noGapDrifts / totalNoGap;

      if (gapDriftRate > noGapDriftRate + 0.15) {
        moments.push({
          topic: "Score Gap → Drift Spiral",
          observation: `${(gapDriftRate * 100).toFixed(0)}% of 2+ day score gaps lead to drift vs ${(noGapDriftRate * 100).toFixed(0)}% with daily logging`,
          why: "Score logging is a commitment device. When you stop measuring, you stop managing. The measurement itself creates accountability.",
          lesson: "A 2-day score gap is an intervention signal. Log even a rough score — 30 seconds prevents a week of drift.",
          evidence: `2+ day gap → drift: ${(gapDriftRate * 100).toFixed(0)}% (n=${totalGap}). Daily → drift: ${(noGapDriftRate * 100).toFixed(0)}% (n=${totalNoGap}).`,
          domain: "mastery",
        });
      }
    }
  }

  // ── Multi-Service Jobs → Revenue per Visit ──
  if (jobs.length >= 20) {
    const revenueByDate = new Map<string, { total: number; count: number }>();
    for (const j of jobs) {
      const d = j.jobDate.toISOString().split("T")[0];
      const entry = revenueByDate.get(d) || { total: 0, count: 0 };
      entry.total += Number(j.totalRevenue);
      entry.count++;
      revenueByDate.set(d, entry);
    }

    const highVolumeDays = [...revenueByDate.entries()]
      .filter(([, d]) => d.count >= 5)
      .map(([, d]) => d.total / d.count);
    const lowVolumeDays = [...revenueByDate.entries()]
      .filter(([, d]) => d.count >= 1 && d.count <= 3)
      .map(([, d]) => d.total / d.count);

    if (highVolumeDays.length >= 3 && lowVolumeDays.length >= 3) {
      const highAvg = highVolumeDays.reduce((s, v) => s + v, 0) / highVolumeDays.length;
      const lowAvg = lowVolumeDays.reduce((s, v) => s + v, 0) / lowVolumeDays.length;

      moments.push({
        topic: "Volume vs Ticket Size",
        observation: `High-volume days (5+ jobs): $${highAvg.toFixed(0)}/job avg. Low-volume (1-3 jobs): $${lowAvg.toFixed(0)}/job avg.`,
        why: highAvg < lowAvg
          ? "High volume pressures quick turnarounds, which means smaller jobs. Low-volume days allow time for bigger diagnostics and upsells."
          : "Busy days attract walk-in tire customers (quick $60-150 jobs). The volume compensates for lower average.",
        lesson: highAvg < lowAvg
          ? "On busy days, train staff to suggest one upsell per visit. Even a $30 add-on across 10 cars = $300."
          : "Volume IS the strategy. Keep the line moving. Every bay minute matters on high-volume days.",
        evidence: `High-vol: $${highAvg.toFixed(0)}/job. Low-vol: $${lowAvg.toFixed(0)}/job.`,
        domain: "revenue",
      });
    }
  }

  // Store top moments as brain memories (increased from 3 to 5)
  for (const moment of moments.slice(0, 5)) {
    await brainMemory.remember(
      "teaching_moment",
      `teach_${moment.domain}_${moment.topic.replace(/\s+/g, "_").slice(0, 30)}`,
      `TEACHING MOMENT [${moment.domain}]: ${moment.observation} | WHY: ${moment.why} | LESSON: ${moment.lesson} | DATA: ${moment.evidence}`,
      "teaching-moments-engine"
    ).catch(() => {});
  }

  return moments;
}

/**
 * Get teaching moments context for system prompt.
 * Reads from stored memories — no computation during prompt build.
 */
export async function getTeachingMomentsContext(): Promise<string> {
  try {
    const moments = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.TEACHING_MOMENT, deletedAt: null }, // v10.0.66 · system-prompt feeder
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { content: true },
    });

    if (moments.length === 0) return "";

    return [
      `── TEACHING MOMENTS (data-backed lessons) ──`,
      ...moments.map(m => `• ${m.content.slice(0, 250)}`),
      `Use these to teach Nour. Explain the WHY, show the data, give the lesson.`,
    ].join("\n");
  } catch {
    return "";
  }
}
