/**
 * Strategic Plan Lifecycle
 *
 * Create, track, and measure 30/60/90 day plans with:
 * - Named milestones with target dates
 * - Auto-progress tracking from daily scores + tasks + revenue
 * - AI assessment of plan health
 * - "You're 60% through Q2, behind on hiring, ahead on revenue"
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("strategic-plans");
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { today, daysAgo } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  recentScoreSnapshots,
  recentShopJobs,
  recentShopLeads,
} from "@/lib/brain/legacy-shims";

/**
 * Assess progress on active strategic plans.
 */
export async function assessStrategicPlans(): Promise<{
  activePlans: number;
  assessments: Array<{ plan: string; progress: number; status: string; detail: string }>;
}> {
  // Get active missions as proxies for strategic plan milestones
  const missions = await prisma.mission.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: {
      id: true,
      title: true,
      domain: true,
      priority: true,
      successMetric: true,
      createdAt: true,
      tasks: {
        select: { status: true },
      },
    },
  });

  if (missions.length === 0) return { activePlans: 0, assessments: [] };

  // Get supporting data
  // v10.0.55 · sourced via legacy-shims (scores real;
  // jobs/leads currently empty — no bridge query for ranged lists).
  const [recentScores, recentJobs, recentLeads] = await Promise.all([
    recentScoreSnapshots(30),
    recentShopJobs(30),
    recentShopLeads(30),
  ]);

  const avgScore = recentScores.length > 0
    ? recentScores.reduce((s, r) => s + (r.overallScore ?? 0), 0) / recentScores.length
    : 0;
  const monthRevenue = recentJobs.reduce((s, j) => s + Number(j.totalRevenue ?? 0), 0);
  const leadsConverted = recentLeads.filter((l) => l.status === "BOOKED").length;

  // ── Pure-math progress assessment (no AI needed) ──
  const mathAssessments = missions.map(m => {
    const totalTasks = m.tasks.length;
    const doneTasks = m.tasks.filter(t => t.status === "DONE").length;
    const doingTasks = m.tasks.filter(t => t.status === "DOING").length;
    const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const ageDays = Math.round((Date.now() - m.createdAt.getTime()) / 86400000);

    // Velocity: tasks completed per week
    const velocity = ageDays > 0 ? Math.round((doneTasks / ageDays) * 7 * 10) / 10 : 0;
    const remainingTasks = totalTasks - doneTasks;
    const estimatedDaysToComplete = velocity > 0 ? Math.round(remainingTasks / (velocity / 7)) : 999;

    // Status based on velocity and age
    let status: string;
    if (progress >= 100) status = "completed";
    else if (progress >= 70 || velocity >= 2) status = "on_track";
    else if (ageDays > 30 && progress < 30) status = "stale";
    else if (ageDays > 14 && doneTasks === 0) status = "stalled";
    else if (velocity < 0.5 && remainingTasks > 3) status = "at_risk";
    else status = "in_progress";

    // Staleness alert
    const isStale = ageDays > 30 && doneTasks === 0;
    const detail = isStale
      ? `${ageDays} days old, 0 tasks done — this mission may need to be re-evaluated or closed`
      : progress >= 80
        ? `Almost done (${progress}%) — push to finish`
        : velocity > 0
          ? `${velocity} tasks/week velocity → ~${estimatedDaysToComplete}d to complete`
          : `No momentum yet — ${doingTasks} in progress, need to start executing`;

    return {
      plan: m.title,
      domain: m.domain,
      progress,
      status,
      detail,
      velocity,
      ageDays,
      estimatedDaysToComplete,
      isStale,
    };
  });

  // Store math assessment immediately (doesn't need AI)
  const mathSummary = mathAssessments
    .map(a => `${a.plan}: ${a.progress}% (${a.status}, ${a.velocity} tasks/wk)`)
    .join(" | ");

  await prisma.brainMemory.upsert({
    where: { category_key: { category: BRAIN_CATEGORIES.STRATEGIC_PLAN, key: `plan_math_${today()}` } },
    create: {
      category: BRAIN_CATEGORIES.STRATEGIC_PLAN,
      key: `plan_math_${today()}`,
      content: `PLAN PROGRESS [${today()}]: ${mathSummary.slice(0, 450)}`,
      confidence: 0.85,
      source: "strategic_plan_math",
    },
    update: { content: `PLAN PROGRESS [${today()}]: ${mathSummary.slice(0, 450)}` },
  }).catch(() => {});

  // Build mission progress context for AI
  const missionContext = missions.map((m) => {
    const totalTasks = m.tasks.length;
    const doneTasks = m.tasks.filter((t) => t.status === "DONE").length;
    const progress = totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0;
    const age = Math.round(
      (Date.now() - m.createdAt.getTime()) / (24 * 60 * 60 * 1000)
    );

    return `"${m.title}" (${m.domain}, P${m.priority}): ${doneTasks}/${totalTasks} tasks done (${progress.toFixed(0)}%), ${age} days old. Success metric: ${m.successMetric || "none set"}`;
  });

  const result = await aiChat(
    [
      {
        role: "system",
        content: `Assess progress on each strategic mission/plan. Use both task completion AND contextual data.

Context: Avg mastery score ${avgScore.toFixed(1)}/10, Month revenue $${monthRevenue.toFixed(0)}, ${leadsConverted} leads converted.

Return ONLY JSON array:
[{
  "plan": "mission title",
  "progress": 0-100,
  "status": "on_track|at_risk|behind|ahead",
  "detail": "One sentence: what's working, what's blocked, what needs attention"
}]

Be honest. If a plan has 0 task completions in 30 days, it's behind. Don't sugarcoat.`,
      },
      { role: "user", content: missionContext.join("\n") },
    ],
    "fast"
  );

   
  const extracted = extractJsonArray<any>(result.content);
  if (!extracted.ok) return { activePlans: missions.length, assessments: [] };

  try {
    const assessments = extracted.value;
    if (!Array.isArray(assessments)) return { activePlans: missions.length, assessments: [] };

    // Store assessment as memory
    const summary = assessments
      .map(
        (a: any) =>
          `${a.plan}: ${a.progress}% (${a.status}) — ${a.detail}`
      )
      .join(" | ");

    await prisma.brainMemory.upsert({
      where: {
        category_key: {
          category: BRAIN_CATEGORIES.STRATEGIC_PLAN,
          key: `plan_assessment_${today()}`,
        },
      },
      create: {
        category: BRAIN_CATEGORIES.STRATEGIC_PLAN,
        key: `plan_assessment_${today()}`,
        content: summary.slice(0, 500),
        confidence: 0.8,
        source: "strategic_plan_lifecycle",
      },
      update: {
        content: summary.slice(0, 500),
        confidence: 0.8,
      },
    }).catch(() => {});

    return {
      activePlans: missions.length,
      assessments: assessments.slice(0, 10),
    };
  } catch {
    return { activePlans: missions.length, assessments: [] };
  }
}

/**
 * Get strategic plan context for system prompt.
 */
export async function getStrategicPlanContext(): Promise<string> {
  const plan = await prisma.brainMemory
    .findFirst({
      where: { category: BRAIN_CATEGORIES.STRATEGIC_PLAN },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    })
    .catch(() => null);

  if (!plan) return "";

  return `\n## Strategic Plan Status\n${plan.content}`;
}
