/**
 * Server-side page data builders for AI insight generation.
 *
 * Moved out of app/api/ai/insight/route.ts (which was deleted in the
 * Apr 15 consolidation) so the streaming /api/ai/page-insight endpoint
 * can use the same DB-fetching fallback when the client doesn't pass
 * `data` in the body.
 *
 * Pattern: one case per mastery page. Each case runs a focused query
 * and returns a compact string summarizing what's visible on that
 * page right now. Short strings keep the token budget reasonable and
 * keep Nick's analysis focused.
 *
 * Used by: app/api/ai/page-insight/route.ts (fallback path when
 * body.data is absent).
 */
import { prisma } from "@/lib/prisma";
import { readNickRevenue } from "@/lib/nickstire/revenue";
import { daysAgo, daysSince, daysUntil, toDateString } from "@/lib/utils/datetime";
import { recentScoreSnapshots, recentDailyHabits } from "@/lib/brain/legacy-shims";
import { isUserProject } from "@/lib/services/mission-helpers";

export type PageContext =
  | "dashboard"
  | "mastery"
  | "drift"
  | "commitments"
  | "loops"
  | "body"
  | "financial"
  | "decisions"
  | "brief"
  | "knowledge";

export async function buildPageData(page: string): Promise<string> {
  const weekAgo = toDateString(daysAgo(7));

  switch (page) {
    case "dashboard": {
      // v10.0.59 · scores + habits via legacy-shims (DailyScore +
      // HabitLog retired). Insight prompt sees real engagement
      // signal instead of "7-day scores: none" every call.
      const [scores, alerts, habits] = await Promise.all([
        recentScoreSnapshots(7),
        (async () => {
          const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
          return (await getUnresolvedAlerts().catch(() => [])).length;
        })(),
        recentDailyHabits(7),
      ]);
      const completed = habits.filter((h) => h.completed).length;
      const total = habits.length;
      return `7-day scores: ${
        scores.map((s) => `${s.date}=${s.overallScore}`).join(", ") || "none"
      }. ${alerts} unresolved alerts. Habit rate: ${
        total ? Math.round((completed / total) * 100) : 0
      }%.`;
    }

    case "mastery": {
      // v10.0.59 · recentScores via legacy-shim.
      const [domains, recentScores, goals, revenue] = await Promise.all([
        prisma.masteryScore.findMany({ orderBy: { date: "desc" }, take: 12 }),
        recentScoreSnapshots(7),
        prisma.lifeGoal.findMany({ where: { deletedAt: null, status: "active" } }), // v9.1.15
        prisma.auditEvent.findFirst({
          where: { eventType: "business_metrics_sync" },
          orderBy: { createdAt: "desc" },
          select: { payload: true },
        }),
      ]);
      const avgEnergy =
        recentScores.length > 0
          ? Math.round(
              (recentScores.reduce((s, d) => s + (d.energyLevel ?? 0), 0) /
                recentScores.length) *
                10
            ) / 10
          : 0;
      const avgDiscipline =
        recentScores.length > 0
          ? Math.round(
              (recentScores.reduce((s, d) => s + (d.disciplineScore ?? 0), 0) /
                recentScores.length) *
                10
            ) / 10
          : 0;
      const workoutDays = recentScores.filter((s) => s.workoutDone).length;
      const rev = (revenue?.payload as Record<string, unknown>) ?? {};
      // nickstire nests revenue as { totalDollars, invoiceCount } — NOT the
      // old todayEstimate/weekRevenue keys this used to read, which silently
      // omitted revenue from Nick's mastery context (payload-key drift ·
      // 2026-05-29 · same class as the /scoreboard $0 bug).
      const nickRev = readNickRevenue(rev.revenue);
      const revLine = nickRev.hasToday
        ? `Revenue today: $${nickRev.todayDollars.toLocaleString()}${
            nickRev.jobs > 0 ? ` (${nickRev.jobs} jobs)` : ""
          }.`
        : "";
      return [
        `Domain scores: ${
          domains.map((d) => `${d.domain}=${d.score}`).join(", ") || "none"
        }.`,
        `7-day avg energy: ${avgEnergy}/10, discipline: ${avgDiscipline}/10, workouts: ${workoutDays}/7.`,
        `Active goals: ${
          goals.map((g) => `"${g.title}" ${g.progress}%`).join(", ") || "none"
        }.`,
        revLine,
        `Daily scores this week: ${
          recentScores.map((s) => `${s.date}=${s.overallScore}`).join(", ") ||
          "none logged"
        }.`,
      ]
        .filter(Boolean)
        .join(" ");
    }

    case "drift": {
      const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
      const alerts = await getUnresolvedAlerts().catch(() => []);
      return `${alerts.length} unresolved alerts: ${
        alerts
          .map((a) => `[${a.severity}] ${a.ruleName}: ${a.message}`)
          .join("; ") || "none"
      }.`;
    }

    case "commitments": {
      const [active, broken] = await Promise.all([
        prisma.commitment.findMany({
          where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
        }),
        prisma.commitment.count({
          where: { status: "broken", updatedAt: { gte: new Date(weekAgo) } },
        }),
      ]);
      return `${active.length} active commitments. ${broken} broken this week. Commitments: ${active
        .map(
          (c) =>
            `"${c.description}"${c.deadline ? ` (due ${c.deadline})` : ""}`
        )
        .join(", ")}`;
    }

    // 2026-07-16 · audit HIGH · the /missions page (what bdnick.info/tasks
    // redirects to) mounts NickSidePane with page="missions", which had no
    // case here — so the side pane fell through to `default: ""` and the
    // route substituted "(no structured data available)". Nick was advising
    // on the operator's primary execution surface completely blind.
    //
    // Aliasing to the flat "tasks" case below would not fix it: the pane's
    // own presets are mission-level ("Which mission should I push today?",
    // "Which mission is stalling?"), and a bare list of task titles cannot
    // answer them. This case mirrors what MissionFeed actually renders —
    // active USER missions (Inbox/GENERAL anchors excluded via
    // isUserProject, same predicate the UI filters with), each with open
    // count, week's completions, stall age, deadline, and its top next
    // action — plus the unattached queue.
    case "missions": {
      const sevenDaysAgo = daysAgo(7);
      const [missions, tasks] = await Promise.all([
        prisma.mission.findMany({
          where: { status: "ACTIVE", deletedAt: null },
          select: { id: true, title: true, domain: true, deadline: true, systemKind: true },
        }),
        prisma.task.findMany({
          where: {
            deletedAt: null,
            OR: [
              { status: { in: ["INBOX", "READY", "DOING", "WAITING"] } },
              // "done this week" keys off lastCompletedAt, NOT updatedAt —
              // updatedAt is bumped by unrelated writes, so it overcounts.
              { status: "DONE", lastCompletedAt: { gte: sevenDaysAgo } },
            ],
          },
          select: {
            title: true,
            status: true,
            missionId: true,
            autoPriority: true,
            manualPriorityOverride: true,
            dueDate: true,
            lastTouchedAt: true,
            loopKind: true,
          },
        }),
      ]);

      const userMissions = missions.filter(isUserProject);
      const userMissionIds = new Set(userMissions.map((m) => m.id));
      const isOpen = (t: { status: string }) => t.status !== "DONE";
      // Higher effective priority = more urgent (scoreTaskPriority sums ROI +
      // due-urgency + mission weight), so the "next action" is the max.
      const prio = (t: { autoPriority: number | null; manualPriorityOverride: number | null }) =>
        t.manualPriorityOverride ?? t.autoPriority ?? 0;

      const lines = userMissions
        .map((m) => {
          const mine = tasks.filter((t) => t.missionId === m.id);
          const open = mine.filter(isOpen);
          const doneThisWeek = mine.length - open.length;
          const next = open.slice().sort((a, b) => prio(b) - prio(a))[0];
          const freshest = open
            .map((t) => (t.lastTouchedAt ? new Date(t.lastTouchedAt).getTime() : 0))
            .reduce((max, ms) => Math.max(max, ms), 0);
          const stallDays = freshest > 0 ? daysSince(new Date(freshest)) : null;
          const due = daysUntil(m.deadline);
          return {
            open: open.length,
            text: [
              `"${m.title.slice(0, 44)}" (${m.domain ?? "—"})`,
              `${open.length} open · ${doneThisWeek} done this week`,
              due != null ? (due < 0 ? `deadline OVERDUE ${Math.abs(due)}d` : `deadline in ${due}d`) : null,
              stallDays != null && stallDays >= 3 ? `STALLED ${stallDays}d untouched` : null,
              next ? `next: "${next.title.slice(0, 46)}" [${next.status} p${prio(next)}]` : "no open tasks",
            ]
              .filter(Boolean)
              .join(" · "),
          };
        })
        .sort((a, b) => b.open - a.open)
        .slice(0, 10);

      const unattached = tasks.filter((t) => isOpen(t) && !userMissionIds.has(t.missionId));
      const totalOpen = tasks.filter(isOpen).length;
      const doneWeek = tasks.length - totalOpen;
      const recurring = tasks.filter((t) => isOpen(t) && t.loopKind && t.loopKind !== "ONCE").length;

      return [
        `${userMissions.length} active missions · ${totalOpen} open tasks · ${doneWeek} completed in last 7d · ${recurring} recurring loops open.`,
        lines.length > 0 ? `Missions:\n${lines.map((l) => `- ${l.text}`).join("\n")}` : "No active user missions.",
        unattached.length > 0
          ? `Unattached/inbox (${unattached.length}): ${unattached
              .slice(0, 8)
              .map((t) => `"${t.title.slice(0, 40)}"`)
              .join(" · ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "tasks":
    case "loops": {
      // Apr 18: "loops" key kept as alias for legacy callers; returns
      // the unified Task INBOX/READY/DOING surface.
      const rows = await prisma.task.findMany({
        where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
        orderBy: [{ autoPriority: "asc" }, { createdAt: "desc" }],
        take: 20,
        select: { title: true, status: true, autoPriority: true },
      });
      return `${rows.length} active tasks: ${
        rows
          .map((t) => `[${t.status} p${t.autoPriority ?? "?"}] ${t.title}`)
          .join(", ") || "none"
      }.`;
    }

    case "body": {
      const entries = await prisma.bodyTracking.findMany({
        orderBy: { date: "desc" },
        take: 7,
      });
      // v10.0.59 · workouts derived from DAILY-loop Tasks with
      // workout/gym/exercise in the title that completed in last 7d
      // (replaces retired HabitLog table). lastCompletedAt within
      // the window counts as a workout day.
      const sevenDaysAgo = daysAgo(7);
      const workouts = await prisma.task
        .findMany({
          where: {
            loopKind: "DAILY",
            deletedAt: null,
            lastCompletedAt: { gte: sevenDaysAgo },
            OR: [
              { title: { contains: "workout", mode: "insensitive" } },
              { title: { contains: "gym", mode: "insensitive" } },
              { title: { contains: "exercise", mode: "insensitive" } },
            ],
          },
          select: { lastCompletedAt: true },
        })
        .catch((): Array<{ lastCompletedAt: Date | null }> => []);
      return `Recent body entries: ${
        entries.map((e) => `${e.date}: ${e.weight}lbs`).join(", ") || "none"
      }. Workouts this week: ${workouts.length}.`;
    }

    case "financial": {
      const latest = await prisma.financialSnapshot.findFirst({
        orderBy: { date: "desc" },
      });
      return latest
        ? `Net worth: $${latest.netWorthEstimate}, checking: $${latest.checkingBalance}, debt: $${latest.totalDebt}, savings rate: ${latest.savingsRatePct}%.`
        : "No financial data.";
    }

    case "decisions": {
      const decisions = await prisma.masteryDecision.findMany({
        where: { deletedAt: null }, // v10.0.68
        orderBy: { date: "desc" },
        take: 5,
      });
      return `Recent decisions: ${
        decisions
          .map(
            (d) =>
              `"${d.title}" (${d.stakes} stakes, grade: ${d.grade || "pending"})`
          )
          .join(", ") || "none"
      }.`;
    }

    // "brief" case retired Apr 17 — morning-brief cron removed; the
    // TodoDesk + BottomPulseTicker surface today's context live.

    case "knowledge":
      return "Knowledge base search page. User is browsing their personal knowledge files.";

    // ── Mastery surfaces (added 2026-05-26 for Phase 5 FULL propagation)
    // Each surface has a NickSidePane mount calling /api/ai/side-pane-chat
    // which falls back to buildPageData(page) when the client omits
    // explicit data. Before today these 4 surfaces returned "" and Nick
    // had zero page-specific grounding · now multi-turn replies see
    // the same data shape the operator sees on screen.

    case "goals": {
      const [goals, scores] = await Promise.all([
        prisma.lifeGoal.findMany({
          where: { deletedAt: null, status: "active" },
          orderBy: [{ horizon: "asc" }, { progress: "desc" }],
          take: 12,
          select: { title: true, domain: true, progress: true, horizon: true },
        }),
        prisma.masteryScore.findMany({ orderBy: { date: "desc" }, take: 8 }),
      ]);
      return [
        `${goals.length} active life goals.`,
        goals.length > 0
          ? `Top by progress: ${goals
              .slice(0, 6)
              .map(
                (g) =>
                  `"${g.title.slice(0, 50)}" ${g.progress}% (${g.domain}${g.horizon ? `/${g.horizon}` : ""})`,
              )
              .join(" · ")}`
          : "",
        scores.length > 0
          ? `Axis scores: ${scores.map((s) => `${s.domain}=${s.score}`).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    }

    case "journal": {
      const sevenDaysAgo = daysAgo(7);
      const [threads, recentEntries, dormantCount] = await Promise.all([
        prisma.journalThread.findMany({
          where: { status: "active" },
          orderBy: { lastJoinAt: "desc" },
          take: 6,
          select: { name: true, lastJoinAt: true, coherence: true },
        }),
        prisma.journalThreadEntry.count({
          where: { joinedAt: { gte: sevenDaysAgo } },
        }),
        prisma.journalThread.count({ where: { status: "dormant" } }),
      ]);
      return [
        `${recentEntries} entries this week · ${threads.length} active threads · ${dormantCount} dormant.`,
        threads.length > 0
          ? `Active threads: ${threads
              .map(
                (t) =>
                  `"${t.name.slice(0, 40)}"${t.coherence != null ? ` (c=${t.coherence.toFixed(2)})` : ""}`,
              )
              .join(" · ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    }

    case "brain": {
      const sevenDaysAgo = daysAgo(7);
      const [recent, totalCount, topCategoriesRaw] = await Promise.all([
        prisma.brainMemory.findMany({
          where: { lastSeen: { gte: sevenDaysAgo } },
          orderBy: { lastSeen: "desc" },
          take: 6,
          select: { category: true, content: true, confidence: true },
        }),
        prisma.brainMemory.count({ where: { lastSeen: { gte: sevenDaysAgo } } }),
        prisma.brainMemory.groupBy({
          by: ["category"],
          where: { lastSeen: { gte: sevenDaysAgo } },
          _count: true,
          orderBy: { _count: { category: "desc" } },
          take: 5,
        }),
      ]);
      return [
        `${totalCount} brain memories touched this week.`,
        topCategoriesRaw.length > 0
          ? `Top categories: ${topCategoriesRaw
              .map((c) => `${c.category}(${c._count})`)
              .join(", ")}.`
          : "",
        recent.length > 0
          ? `Most recent: ${recent
              .map(
                (r) =>
                  `[${r.category}/${r.confidence.toFixed(2)}] ${r.content.slice(0, 80)}`,
              )
              .join(" · ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    }

    case "scoreboard": {
      const [snapshot, activeAlerts, latestScores] = await Promise.all([
        prisma.systemSnapshot
          .findFirst({
            where: { scope: "global" },
            select: { headline: true, focus: true, startupStatus: true },
          })
          .catch(() => null),
        (async () => {
          const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
          return (await getUnresolvedAlerts().catch(() => [])).length;
        })(),
        prisma.masteryScore.findMany({ orderBy: { date: "desc" }, take: 8 }),
      ]);
      return [
        snapshot ? `Headline: ${snapshot.headline.slice(0, 120)}.` : "",
        snapshot?.focus ? `Focus: ${snapshot.focus.slice(0, 80)}.` : "",
        `${activeAlerts} unresolved drift alerts.`,
        latestScores.length > 0
          ? `Axis: ${latestScores.map((s) => `${s.domain}=${s.score}`).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    }

    default:
      return "";
  }
}
