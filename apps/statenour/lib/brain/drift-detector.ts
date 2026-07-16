/**
 * Multi-Source Drift Detector
 *
 * Pulls signals from multiple data sources to compute a composite
 * drift score — measuring alignment between stated goals and actual behavior.
 *
 * Signal sources:
 *   - Tasks: completion rate vs commitments
 *   - Business: lead response time, job frequency
 *   - Brain: stated goals vs actual patterns
 *   - Behavior: daily scores, habits (from existing drift engine)
 *   - Devices: activity patterns (shop hours, home vs work)
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { recordMetric } from "@/lib/services/metrics";
import { daysAgo, toDateString } from "@/lib/utils/datetime";
import { recentScoreSnapshots, recentShopLeads } from "@/lib/brain/legacy-shims";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface DriftSignal {
  source: string;
  label: string;
  score: number;       // 0 = fully aligned, 10 = max drift
  detail: string;
  weight: number;      // how much this signal contributes
}

export interface CompositeDriftResult {
  overallScore: number;
  signals: DriftSignal[];
  topConcern: string | null;
  generatedAt: string;
}

/**
 * Compute a multi-source drift score.
 * Each signal is scored 0-10 (0 = aligned, 10 = drifting).
 */
export async function computeDriftScore(): Promise<CompositeDriftResult> {
  const signals: DriftSignal[] = [];
  const sevenDaysAgo = daysAgo(7);
  const thirtyDaysAgo = daysAgo(30);

  // ── Signal 1: Task Completion Rate ──────────────────────────────────
  const [totalTasks, doneTasks, doingTasks] = await Promise.all([
    prisma.task.count({ where: { status: { not: "ARCHIVED" }, deletedAt: null } }),
    prisma.task.count({ where: { status: "DONE", lastTouchedAt: { gte: new Date(sevenDaysAgo) }, deletedAt: null } }),
    prisma.task.count({ where: { status: "DOING", deletedAt: null } }),
  ]);

  const taskCompletionRate = totalTasks > 0 ? doneTasks / Math.max(doingTasks + doneTasks, 1) : 0;
  const taskDrift = Math.max(0, Math.min(10, Math.round((1 - taskCompletionRate) * 10)));
  signals.push({
    source: "tasks",
    label: "Task Completion",
    score: taskDrift,
    detail: `${doneTasks} completed this week, ${doingTasks} in progress, ${totalTasks} total active`,
    weight: 2,
  });

  // ── Signal 2: Lead Response Time ────────────────────────────────────
  // v10.0.55 · leads via legacy-shim (currently empty; bridge query
  // for ranged leads with response time not yet exposed).
  const recentLeads = await recentShopLeads(7);

  if (recentLeads.length > 0) {
    const unresponded = recentLeads.filter((l) => l.status === "NEW").length;
    const responseRate = 1 - (unresponded / recentLeads.length);
    const leadDrift = Math.max(0, Math.min(10, Math.round((1 - responseRate) * 10)));
    signals.push({
      source: "business",
      label: "Lead Response",
      score: leadDrift,
      detail: `${unresponded}/${recentLeads.length} leads unresponded this week`,
      weight: 3,
    });
  }

  // ── Signal 3: Mission Alignment ─────────────────────────────────────
  const activeMissions = await prisma.mission.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, title: true, domain: true, priority: true },
  });

  const recentTasksByMission = await prisma.task.groupBy({
    by: ["missionId"],
    where: { lastTouchedAt: { gte: new Date(sevenDaysAgo) }, deletedAt: null },
    _count: true,
  });

  if (activeMissions.length > 0) {
    const missionsWithActivity = new Set(recentTasksByMission.map((t) => t.missionId));
    const neglectedMissions = activeMissions.filter((m) => !missionsWithActivity.has(m.id));
    const neglectRate = neglectedMissions.length / activeMissions.length;
    const missionDrift = Math.max(0, Math.min(10, Math.round(neglectRate * 10)));
    signals.push({
      source: "missions",
      label: "Mission Alignment",
      score: missionDrift,
      detail: neglectedMissions.length > 0
        ? `${neglectedMissions.length} neglected missions: ${neglectedMissions.map((m) => m.title).join(", ")}`
        : `All ${activeMissions.length} missions have recent activity`,
      weight: 3,
    });
  }

  // ── Signal 4: Commitment Follow-Through ─────────────────────────────
  const activeCommitments = await prisma.commitment.findMany({
    where: { status: "active", deletedAt: null },
    select: { id: true, description: true, deadline: true },
  });

  if (activeCommitments.length > 0) {
    const overdue = activeCommitments.filter((c) =>
      c.deadline && new Date(c.deadline) < new Date()
    ).length;
    const commitDrift = Math.max(0, Math.min(10, Math.round((overdue / activeCommitments.length) * 10)));
    signals.push({
      source: "commitments",
      label: "Commitment Follow-Through",
      score: commitDrift,
      detail: overdue > 0
        ? `${overdue}/${activeCommitments.length} commitments overdue`
        : `All ${activeCommitments.length} commitments on track`,
      weight: 2,
    });
  }

  // ── Signal 5: Active Task Accumulation ──────────────────────────────
  // Apr 18: OpenLoop retired. Drift score now uses the unified Task
  // surface (INBOX/READY/DOING). Same threshold model (5+ active =
  // saturated) but pulls from the live queue.
  const openLoops = await prisma.task.count({
    where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
  });

  const loopDrift = Math.max(0, Math.min(10, Math.round(Math.min(openLoops / 5, 1) * 10)));
  signals.push({
    source: "active_tasks",
    label: "Active Task Load",
    score: loopDrift,
    detail: `${openLoops} active tasks`,
    weight: 1,
  });

  // ── Signal 6: Behavioral Patterns (daily scores) ────────────────────
  // v10.0.55 · scores via legacy-shim (DailyScore retired;
  // identity_snapshot history now provides the same trend signal).
  const sevenDaysAgoStr = toDateString(sevenDaysAgo);
  const recentScores = await recentScoreSnapshots(7);

  if (recentScores.length >= 3) {
    const avgScore = recentScores.reduce((s, r) => s + (r.overallScore ?? 5), 0) / recentScores.length;
    const behaviorDrift = Math.max(0, Math.min(10, Math.round((10 - avgScore))));
    signals.push({
      source: "behavior",
      label: "Daily Score Trend",
      score: behaviorDrift,
      detail: `Average score: ${avgScore.toFixed(1)}/10 over ${recentScores.length} days`,
      weight: 2,
    });
  }

  // ── Signal 7: Brain Memory Goal Comparison ──────────────────────────
  // v10.0.46 — added `deletedAt: null` to both findManys. Pre-fix
  // deleted goals remained as drift baselines, and deleted patterns
  // inflated the drift score. Skewed Signal 7 in both directions.
  const statedGoals = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.PREFERENCE, key: { startsWith: "stated_goal_" }, deletedAt: null },
    select: { content: true },
  });

  const recentPatterns = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.PATTERN,
      createdAt: { gte: new Date(sevenDaysAgo) },
      deletedAt: null,
    },
    select: { content: true },
  });

  if (statedGoals.length > 0 && recentPatterns.length > 0) {
    // Simple heuristic: if no patterns mention goal keywords, drift is high
    const goalKeywords = statedGoals
      .map((g) => g.content.toLowerCase().split(/\s+/).filter((w) => w.length > 4))
      .flat();
    const patternText = recentPatterns.map((p) => p.content.toLowerCase()).join(" ");
    const matchedKeywords = goalKeywords.filter((k) => patternText.includes(k));
    const alignmentRate = goalKeywords.length > 0 ? matchedKeywords.length / goalKeywords.length : 0.5;
    const goalDrift = Math.max(0, Math.min(10, Math.round((1 - alignmentRate) * 8)));
    signals.push({
      source: "brain_goals",
      label: "Goal Alignment",
      score: goalDrift,
      detail: `${matchedKeywords.length}/${goalKeywords.length} goal keywords found in recent patterns`,
      weight: 2,
    });
  }

  // ── Composite Score ─────────────────────────────────────────────────
  const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
  const weightedSum = signals.reduce((s, sig) => s + sig.score * sig.weight, 0);
  const overallScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;

  // Find top concern
  const sorted = [...signals].sort((a, b) => b.score * b.weight - a.score * a.weight);
  const topConcern = sorted[0]?.score > 3 ? sorted[0].detail : null;

  const result: CompositeDriftResult = {
    overallScore,
    signals,
    topConcern,
    generatedAt: new Date().toISOString(),
  };

  // Record as metric
  await recordMetric("drift_composite_score", overallScore, {
    unit: "score",
    tags: { signals: signals.length },
    source: "drift_detector",
  });

  // Store as brain memory
  await brainMemory.remember(
    "insight",
    `drift_composite_${toDateString(new Date())}`,
    `Drift score: ${overallScore}/10. ${topConcern ? `Top concern: ${topConcern}` : "All signals aligned."}`,
    "device_analysis",
    { signals: signals.map((s) => ({ source: s.source, score: s.score })) }
  );

  return result;
}
