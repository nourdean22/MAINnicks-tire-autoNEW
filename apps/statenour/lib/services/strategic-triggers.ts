/**
 * Strategic Behavioral Triggers
 *
 * Detects behavioral patterns from NOUR OS data and maps them to
 * Robert Greene strategic laws. Each trigger has REAL conditions
 * that query actual data, not placeholders.
 *
 * Triggers run as part of the daily strategy brief or on-demand.
 */
import { prisma } from "@/lib/prisma";
import { startOfDayET, toDateString } from "@/lib/utils/datetime";

export interface StrategicTrigger {
  id: string;
  name: string;
  description: string;
  lawRef: { book: string; number: number };
  severity: "info" | "warning" | "critical";
  fired: boolean;
  detail: string;
}

function daysAgoDate(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDayET(d); // ET midnight, not server-UTC midnight
}

function todayStart(): Date {
  return startOfDayET();
}

/**
 * Run all 15 strategic behavioral triggers against live data.
 * Returns only those that fired (or all if includeAll=true).
 */
export async function runStrategicTriggers(includeAll = false): Promise<StrategicTrigger[]> {
  const now = new Date();
  const etHour = parseInt(
    now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false })
  );

  // Gather context data in parallel
  const [
    recentScores,
    recentHabits,
    tasksDoing,
    tasksCompletedThisWeek,
    openLoops7d,
    missionsActive,
    situationLogsToday,
    situationLogsWeek,
    decisionsThisWeek,
    unackedAlerts,
    recentCaptures,
    dailyScoreToday,
  ] = await Promise.all([
    // v10.0.59 · Wave A part 2 · scores + habits via legacy-shims.
    (async () => {
      const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
      return recentScoreSnapshots(7);
    })(),
    (async () => {
      const { recentDailyHabits } = await import("@/lib/brain/legacy-shims");
      return recentDailyHabits(7);
    })(),
    prisma.task.count({ where: { status: "DOING" } }),
    prisma.task.count({ where: { status: "DONE", lastTouchedAt: { gte: daysAgoDate(7) } } }),
    // Apr 18: OpenLoop retired → Task creations in last 7d.
    prisma.task.count({ where: { createdAt: { gte: daysAgoDate(7) } } }),
    prisma.mission.count({ where: { status: "ACTIVE" } }).catch(() => 0),
    prisma.situationLog.count({ where: { createdAt: { gte: todayStart() } } }).catch(() => 0),
    prisma.situationLog.count({ where: { createdAt: { gte: daysAgoDate(7) } } }).catch(() => 0),
    prisma.masteryDecision.count().catch(() => 0), // decisions don't have createdAt, just count recent
    prisma.driftAlert.count({ where: { acknowledged: false } }),
    prisma.captureInboxItem.count({ where: { status: "active" } }).catch(() => 0),
    // v10.0.59 · dailyScoreToday → today's identity_snapshot row
    // (DailyScore retired Apr 19). Returns null if no snapshot
    // touched today, matching the original null fallback shape.
    (async () => {
      const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
      const all = await recentScoreSnapshots(1);
      return all[0] ?? null;
    })(),
  ]);

  const triggers: StrategicTrigger[] = [];

  // ── 1. LATE NIGHT BUILDING ──
  // Coding/working past midnight — Law 4: Always Say Less Than Necessary
  // (Overwork without rest degrades quality; silence > noise at 2am)
  const lateNight = etHour >= 0 && etHour < 5;
  triggers.push({
    id: "late_night_building",
    name: "Late Night Building",
    description: "Working past midnight degrades output quality and decision-making",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 4 },
    severity: lateNight ? "warning" : "info",
    fired: lateNight,
    detail: lateNight
      ? `It's ${etHour}:00 AM ET. Stop building. Rest is a strategic weapon.`
      : "Not in late-night hours.",
  });

  // ── 2. REVENUE FLAT WEEK ──
  // No completed tasks in business domain for 7 days — Law 28: Enter Action with Boldness
  const businessHabitsThisWeek = recentHabits.filter(
    (h) => h.habitKey === "estimate_followup" && h.completed
  );
  const revFlat = businessHabitsThisWeek.length === 0 && tasksCompletedThisWeek < 3;
  triggers.push({
    id: "revenue_flat_week",
    name: "Revenue Flat Week",
    description: "No revenue-driving actions this week — boldness is required",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 28 },
    severity: revFlat ? "critical" : "info",
    fired: revFlat,
    detail: revFlat
      ? `0 follow-ups completed, only ${tasksCompletedThisWeek} tasks done this week. Call 3 estimates NOW.`
      : `${businessHabitsThisWeek.length} follow-ups, ${tasksCompletedThisWeek} tasks completed.`,
  });

  // ── 3. NO BUSINESS ACTION TODAY ──
  // No daily score logged and no tasks touched today — Law 29: Plan All the Way to the End
  const noActionToday = !dailyScoreToday && tasksCompletedThisWeek === 0 && etHour >= 14;
  triggers.push({
    id: "no_business_action_today",
    name: "No Business Action Today",
    description: "Afternoon with zero logged activity — day is slipping without a plan",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 29 },
    severity: noActionToday ? "warning" : "info",
    fired: noActionToday,
    detail: noActionToday
      ? "Past 2 PM with no score or task progress. Plan your remaining hours NOW."
      : "Activity detected today.",
  });

  // ── 4. SPENDING WITHOUT TRACKING ──
  // Impulse purchase habit failing + no financial review — Law 40: Despise the Free Lunch
  const impulseHabits = recentHabits.filter((h) => h.habitKey === "no_impulse_purchase");
  const impulseFailCount = impulseHabits.filter((h) => !h.completed).length;
  const spendingUntracked = impulseFailCount >= 3;
  triggers.push({
    id: "spending_without_tracking",
    name: "Spending Without Tracking",
    description: "Multiple impulse purchases without financial tracking — nothing is free",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 40 },
    severity: spendingUntracked ? "critical" : "info",
    fired: spendingUntracked,
    detail: spendingUntracked
      ? `${impulseFailCount} impulse purchase failures in 7 days. Enforce 48-hour rule. Review spending.`
      : `${impulseFailCount} impulse failures this week.`,
  });

  // ── 5. SKIPPED EXERCISE ──
  // No workout for 3+ days — Mastery Law 1: Discover Your Calling (discipline = foundation)
  const workoutDays = recentScores.filter((s) => s.workoutDone);
  const noWorkout3d = recentScores.length >= 3 && workoutDays.length === 0;
  triggers.push({
    id: "skipped_exercise",
    name: "Skipped Exercise",
    description: "No workout in days — physical mastery is the foundation of all mastery",
    lawRef: { book: "MASTERY", number: 1 },
    severity: noWorkout3d ? "warning" : "info",
    fired: noWorkout3d,
    detail: noWorkout3d
      ? `0 workouts in last ${recentScores.length} days. Walk 30 minutes minimum TODAY.`
      : `${workoutDays.length} workouts in last ${recentScores.length} days.`,
  });

  // ── 6. TOOL SHOPPING ──
  // Apr 18: OpenLoop retired → trigger uses Task creation rate (7d).
  // 3+ new tasks in a week — Law 36: Disdain Things You Cannot Have.
  const toolShopping = openLoops7d >= 3;
  triggers.push({
    id: "tool_shopping",
    name: "Tool Shopping / Novelty Seeking",
    description: "Starting too many new things — ignore what you can't finish",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 36 },
    severity: toolShopping ? "warning" : "info",
    fired: toolShopping,
    detail: toolShopping
      ? `${openLoops7d} new tasks this week. CLOSE 2 before starting anything new.`
      : `${openLoops7d} new tasks this week.`,
  });

  // ── 7. REPEATED COMPLAINT TYPE ──
  // Multiple situation logs with same context in a week — Law 33: Discover Each Man's Thumbscrew
  const contextCounts: Record<string, number> = {};
  // Use situation logs as proxy for complaint patterns
  if (situationLogsWeek > 3) {
    // Repeated logging = repeated friction point
    triggers.push({
      id: "repeated_complaint_type",
      name: "Repeated Friction Pattern",
      description: "Same type of situation keeps recurring — find the pressure point",
      lawRef: { book: "FORTY_EIGHT_LAWS", number: 33 },
      severity: "warning",
      fired: true,
      detail: `${situationLogsWeek} situation logs this week. Look for the recurring pattern and address root cause.`,
    });
  } else {
    triggers.push({
      id: "repeated_complaint_type",
      name: "Repeated Friction Pattern",
      description: "Same type of situation keeps recurring — find the pressure point",
      lawRef: { book: "FORTY_EIGHT_LAWS", number: 33 },
      severity: "info",
      fired: false,
      detail: `${situationLogsWeek} logs this week — normal.`,
    });
  }

  // ── 8. VIP NEGLECT ──
  // No follow-ups in a week while having active missions — Law 6: Court Attention at All Costs
  const followUpsDone = recentHabits.filter((h) => h.habitKey === "estimate_followup" && h.completed).length;
  const vipNeglect = followUpsDone === 0 && missionsActive > 0;
  triggers.push({
    id: "vip_neglect",
    name: "VIP Neglect",
    description: "Active missions but zero customer follow-ups — you're invisible",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 6 },
    severity: vipNeglect ? "critical" : "info",
    fired: vipNeglect,
    detail: vipNeglect
      ? `${missionsActive} active missions, 0 follow-ups. Customers are forgetting you. Call someone NOW.`
      : `${followUpsDone} follow-ups done, ${missionsActive} active missions.`,
  });

  // ── 9. NO WEEKLY REVIEW ──
  // No decisions logged this week — 33 Strategies Law 2: Don't Fight the Last War
  const noWeeklyReview = decisionsThisWeek === 0 && new Date().getDay() >= 5; // Friday+
  triggers.push({
    id: "no_weekly_review",
    name: "No Weekly Review",
    description: "End of week with no strategic decisions logged — fighting blind",
    lawRef: { book: "THIRTY_THREE_STRATEGIES", number: 2 },
    severity: noWeeklyReview ? "warning" : "info",
    fired: noWeeklyReview,
    detail: noWeeklyReview
      ? "Friday+ with 0 decisions logged. Do a 15-minute weekly review NOW."
      : `${decisionsThisWeek} decisions logged this week.`,
  });

  // ── 10. YES MAN MODE ──
  // Too many tasks in DOING status — Law 3: Conceal Your Intentions
  const yesManMode = tasksDoing > 8;
  triggers.push({
    id: "yes_man_mode",
    name: "Yes Man Mode",
    description: "Overcommitted — saying yes to everything dilutes power and reveals weakness",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 3 },
    severity: yesManMode ? "critical" : "info",
    fired: yesManMode,
    detail: yesManMode
      ? `${tasksDoing} tasks in DOING. Pick the top 3, defer or delegate the rest.`
      : `${tasksDoing} tasks in progress.`,
  });

  // ── 11. UNACKNOWLEDGED ALERTS PILING UP ──
  // Ignoring system warnings — Law 15: Crush Your Enemy Totally
  const alertsPiling = unackedAlerts >= 5;
  triggers.push({
    id: "alerts_piling_up",
    name: "Alerts Piling Up",
    description: "Unresolved alerts = small problems becoming big ones",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 15 },
    severity: alertsPiling ? "warning" : "info",
    fired: alertsPiling,
    detail: alertsPiling
      ? `${unackedAlerts} unacknowledged alerts. Address them fully — half-measures create recurring enemies.`
      : `${unackedAlerts} alerts pending.`,
  });

  // ── 12. CAPTURE INBOX OVERFLOWING ──
  // Unprocessed captures piling up — Law 25: Re-Create Yourself
  const inboxOverflow = recentCaptures >= 10;
  triggers.push({
    id: "capture_inbox_overflow",
    name: "Capture Inbox Overflow",
    description: "Inputs accumulating without processing — you're consuming, not creating",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 25 },
    severity: inboxOverflow ? "warning" : "info",
    fired: inboxOverflow,
    detail: inboxOverflow
      ? `${recentCaptures} unprocessed captures. Spend 20 minutes processing. Transform input into action.`
      : `${recentCaptures} captures pending.`,
  });

  // ── 13. FOCUS QUALITY DECLINING ──
  // 3+ days of low focus — Human Nature Law 13: Advance with a Sense of Purpose
  // v10.0.59 · LegacyScoreRow.focusQuality is nullable; treat null
  // as "not enough signal" — only count rows that explicitly
  // recorded a focus value.
  const lowFocusDays = recentScores.filter((s) => s.focusQuality != null && s.focusQuality < 5);
  const focusDeclining = lowFocusDays.length >= 3;
  triggers.push({
    id: "focus_declining",
    name: "Focus Quality Declining",
    description: "Scattered attention across too many days — reconnect with purpose",
    lawRef: { book: "HUMAN_NATURE", number: 13 },
    severity: focusDeclining ? "warning" : "info",
    fired: focusDeclining,
    detail: focusDeclining
      ? `${lowFocusDays.length} days with focus below 5/10. Define ONE goal for tomorrow before sleeping.`
      : `Focus quality stable.`,
  });

  // ── 14. SCORE DROPPING BUT STILL BUILDING ──
  // Low scores but still coding — Seduction Law 21: Give Them Space to Fall
  // v10.0.59 · LegacyScoreRow.overallScore is nullable; coalesce
  // to 0 for the average (same behavior as pre-shim where missing
  // values defaulted to 0).
  const avgScore = recentScores.length > 0
    ? recentScores.reduce((sum, s) => sum + (s.overallScore ?? 0), 0) / recentScores.length
    : 0;
  const scoreLowButActive = avgScore < 5 && recentScores.length >= 3 && lateNight;
  triggers.push({
    id: "grinding_while_depleted",
    name: "Grinding While Depleted",
    description: "Low overall scores but still pushing — sometimes withdrawal is strategic",
    lawRef: { book: "ART_OF_SEDUCTION", number: 21 },
    severity: scoreLowButActive ? "warning" : "info",
    fired: scoreLowButActive,
    detail: scoreLowButActive
      ? `Average score ${avgScore.toFixed(1)}/10. Step back. Rest. Return sharper.`
      : `Average score ${avgScore.toFixed(1)}/10.`,
  });

  // ── 15. NO CONTENT CREATION THIS WEEK ──
  // Marketing dark — Seduction Law 12: Poeticize Your Presence
  const contentCreated = recentHabits.filter((h) => h.habitKey === "content_creation" && h.completed).length;
  const instagramDone = recentHabits.filter((h) => h.habitKey === "instagram_post" && h.completed).length;
  const marketingDark = contentCreated === 0 && instagramDone === 0;
  triggers.push({
    id: "marketing_dark",
    name: "Marketing Dark",
    description: "Zero content or social posts — your brand presence is fading",
    lawRef: { book: "ART_OF_SEDUCTION", number: 12 },
    severity: marketingDark ? "warning" : "info",
    fired: marketingDark,
    detail: marketingDark
      ? "Zero content this week. Post ONE piece today. Presence > perfection."
      : `${contentCreated} content pieces, ${instagramDone} Instagram posts this week.`,
  });

  // ═══ HERCULES EXPANSION — 10 business-specific triggers ═══

  // ── 16. CALLBACKS PILING UP ──
  // Bridge data: overdue callbacks > 5 — Law 28: Enter Action with Boldness
  let callbacksPiling = false;
  try {
    const { fetchShopSnapshot } = await import("@/lib/services/bridge");
    const shop = await fetchShopSnapshot().catch(() => null);
    callbacksPiling = (shop?.callbacks?.pendingCount ?? 0) > 5;
  } catch {}
  triggers.push({
    id: "callbacks_piling_up",
    name: "Callbacks Piling Up",
    description: "Overdue callbacks are cooling — every hour costs money",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 28 },
    severity: callbacksPiling ? "critical" : "info",
    fired: callbacksPiling,
    detail: callbacksPiling
      ? "More than 5 overdue callbacks. Clear the queue NOW — leads cool fast."
      : "Callback queue manageable.",
  });

  // ── 17. DAILY SCORE DECLINING ──
  const recent3Avg = recentScores.slice(0, 3).reduce((s, d) => s + (d.overallScore ?? 0), 0) / Math.max(recentScores.slice(0, 3).length, 1);
  const prior4Avg = recentScores.slice(3, 7).reduce((s, d) => s + (d.overallScore ?? 0), 0) / Math.max(recentScores.slice(3, 7).length, 1);
  const scoreDeclining = recentScores.length >= 5 && recent3Avg < prior4Avg - 1;
  triggers.push({
    id: "daily_score_declining",
    name: "Daily Score Declining",
    description: "Your scores are dropping — entering the resistance phase",
    lawRef: { book: "MASTERY", number: 1 },
    severity: scoreDeclining ? "warning" : "info",
    fired: scoreDeclining,
    detail: scoreDeclining
      ? `Recent avg ${recent3Avg.toFixed(1)} vs prior ${prior4Avg.toFixed(1)}. Push through the resistance.`
      : "Scores stable.",
  });

  // ── 18. WEEKEND NO PREP ──
  const isFridayAfternoon = now.getDay() === 5 && etHour >= 14;
  triggers.push({
    id: "weekend_no_prep",
    name: "Weekend Without Prep",
    description: "Friday afternoon — set next week's priorities before shutdown",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 29 },
    severity: isFridayAfternoon ? "warning" : "info",
    fired: isFridayAfternoon,
    detail: isFridayAfternoon
      ? "Friday afternoon. Have you set next week's priorities? Do your weekly review NOW."
      : "Not Friday afternoon.",
  });

  // ── 19. NO EXERCISE 3 DAYS ──
  const noExercise3d = recentScores.length >= 3 && recentScores.slice(0, 3).every(s => !s.workoutDone);
  triggers.push({
    id: "no_exercise_3days",
    name: "No Exercise 3 Days",
    description: "Physical stagnation leads to mental stagnation",
    lawRef: { book: "MASTERY", number: 3 },
    severity: noExercise3d ? "warning" : "info",
    fired: noExercise3d,
    detail: noExercise3d
      ? "3 days without exercise. Walk 30 minutes today — no negotiation."
      : `${recentScores.filter(s => s.workoutDone).length} workout days this week.`,
  });

  // ── 20. SYSTEM BUILDING BINGE ──
  const systemBinge = tasksCompletedThisWeek < 2 && tasksDoing > 0;
  triggers.push({
    id: "system_building_binge",
    name: "System Building Binge",
    description: "Building systems but not executing tasks — the system IS the dopamine hit",
    lawRef: { book: "FIFTIETH_LAW", number: 8 },
    severity: systemBinge ? "critical" : "info",
    fired: systemBinge,
    detail: systemBinge
      ? `Only ${tasksCompletedThisWeek} tasks done this week but ${tasksDoing} in progress. Execute the boring work.`
      : "Task completion rate healthy.",
  });

  // ── 21. NO JOURNAL 5 DAYS ──
  const journalDays = recentScores.filter(s => s.journalDone).length;
  const noJournal5d = recentScores.length >= 5 && journalDays === 0;
  triggers.push({
    id: "no_journal_5days",
    name: "No Journal 5 Days",
    description: "Self-reflection is the foundation of self-awareness",
    lawRef: { book: "HUMAN_NATURE", number: 1 },
    severity: noJournal5d ? "warning" : "info",
    fired: noJournal5d,
    detail: noJournal5d
      ? "Zero journal entries this week. Write 3 sentences tonight. Irrationality thrives in unexamined minds."
      : `${journalDays} journal entries this week.`,
  });

  // ── 22. OVERDUE TASKS ──
  const overdueTasks = await prisma.task.count({
    where: { status: { in: ["READY", "DOING"] }, dueDate: { lt: new Date() } },
  }).catch(() => 0);
  triggers.push({
    id: "overdue_tasks",
    name: "Overdue Tasks",
    description: "Tasks past due date — broken promises erode self-trust",
    lawRef: { book: "FORTY_EIGHT_LAWS", number: 26 },
    severity: overdueTasks > 3 ? "critical" : overdueTasks > 0 ? "warning" : "info",
    fired: overdueTasks > 0,
    detail: overdueTasks > 0
      ? `${overdueTasks} tasks overdue. Complete or reschedule — keep your hands clean.`
      : "No overdue tasks.",
  });

  // ── 23. ENERGY CRASHING ──
  const lowEnergyDays = recentScores.filter(s => (s.energyLevel ?? 5) < 4).length;
  const energyCrashing = lowEnergyDays >= 3;
  triggers.push({
    id: "energy_crashing",
    name: "Energy Crashing",
    description: "Multiple low-energy days — check sleep, nutrition, exercise",
    lawRef: { book: "HUMAN_NATURE", number: 9 },
    severity: energyCrashing ? "warning" : "info",
    fired: energyCrashing,
    detail: energyCrashing
      ? `${lowEnergyDays} low-energy days this week. Prioritize sleep and nasal breathing. The dark side thrives when you're depleted.`
      : "Energy levels stable.",
  });

  // ── 24. TOO MANY MISSIONS ──
  const tooManyMissions = missionsActive > 8;
  triggers.push({
    id: "too_many_missions",
    name: "Too Many Active Missions",
    description: "Spreading focus too thin — concentrate your forces",
    lawRef: { book: "THIRTY_THREE_STRATEGIES", number: 5 },
    severity: tooManyMissions ? "warning" : "info",
    fired: tooManyMissions,
    detail: tooManyMissions
      ? `${missionsActive} active missions. Pick the top 3 and put the rest on hold. Concentrated force beats dispersed effort.`
      : `${missionsActive} active missions.`,
  });

  // ── 25. PERFECT DAY STREAK ──
  const perfectStreak = recentScores.length >= 3 && recentScores.slice(0, 3).every(s => (s.overallScore ?? 0) >= 8);
  triggers.push({
    id: "perfect_streak",
    name: "Perfect Day Streak",
    description: "Momentum is building — don't break the chain",
    lawRef: { book: "MASTERY", number: 6 },
    severity: perfectStreak ? "info" : "info",
    fired: perfectStreak,
    detail: perfectStreak
      ? "3+ perfect days in a row. You're in the zone. Protect this momentum — say no to distractions."
      : "No active streak.",
  });

  return includeAll ? triggers : triggers.filter((t) => t.fired);
}

// ─────────────────────────────────────────────────────────────
// FEEDBACK LOOP — persist fired triggers as SituationLog rows
// so the StrategicLaw layer stops being dead code.
//
// Before this wiring: the laws existed, the triggers existed,
// but nothing wrote back which situation activated which law.
// Result: 187 of 189 laws had zero SituationLog / DailyStrategy
// references even after months of runtime.
//
// This function is called from the brain-cycle cron. It:
//   1. Runs every trigger
//   2. For each fired trigger, resolves the referenced law by
//      (book, number) → lawId
//   3. Upserts a SituationLog row, dedup'd per 24h so we don't
//      spam when the same condition persists across cron ticks
// ─────────────────────────────────────────────────────────────

export async function logStrategicTriggers(): Promise<{
  fired: number;
  logged: number;
  skipped: number;
}> {
  const fired = await runStrategicTriggers(false);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let logged = 0;
  let skipped = 0;

  for (const t of fired) {
    // Resolve law
    const law = await prisma.strategicLaw
      .findUnique({
        where: {
          book_number: { book: t.lawRef.book as any, number: t.lawRef.number },
        },
        select: { id: true },
      })
      .catch(() => null);

    // Dedup: skip if we already logged this trigger within 24h
    const recent = await prisma.situationLog.findFirst({
      where: {
        context: `trigger:${t.id}`,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (recent) {
      skipped++;
      continue;
    }

    await prisma.situationLog
      .create({
        data: {
          context: `trigger:${t.id}`,
          situation: `${t.name} — ${t.detail}`,
          urgency: t.severity,
          lawId: law?.id ?? null,
          aiAnalysis: t.description,
        },
      })
      .catch(() => {});
    logged++;
  }

  return { fired: fired.length, logged, skipped };
}
