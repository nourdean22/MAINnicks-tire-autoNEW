/**
 * lib/ai/prompt/sections/live-state.ts · Wave 84 · 2026-05-17
 *
 * Pure formatter for v1's "Live domain snapshot" + "Current state"
 * blocks (system-prompt.ts:1027-1097 pre-split). Renders the
 * business one-liner, mastery scoreboard, drift alerts, brain
 * alerts, active missions, active tasks, active commitments,
 * recent decisions, and body weight line.
 *
 * Caller owns all the data fetching; this file does no I/O. Output
 * lines are byte-identical to the prior inline pushes.
 */

import { today } from "@/lib/utils/datetime";
import { MONTHLY_REVENUE_TARGET } from "@/lib/config/business";
import { ALERT_LABEL } from "@/lib/ai/prompt/policy/operator-rules";

interface LiveStateInput {
  loopCount: number;
  commitmentCount: number;
  overdueCommitments: number;
  openLeadCount?: number;
  activeJobCount?: number;
  masteryScores: string[];
  activeAlerts: { ruleName: string; severity: string; message: string }[];
  brainAlerts: { category: string; content: string }[];
  activeMissions: { title: string; domain: string; priority: number; successMetric: string | null }[];
  openLoops: { title: string; priority: string }[];
  dedupedCommitments: { description: string; deadline: string | null }[];
  recentDecisions: { title: string; date: string; stakes: string | null; chosen: string | null; grade: string | null }[];
  latestWeight: { weight: number | null; date: string } | null;
}

/**
 * Renders v1's "Live domain snapshot" block + "Current state" header
 * + all derived sections (mastery, drift, brain alerts, missions,
 * tasks, commitments, decisions, body).
 */
export function renderLiveState(input: LiveStateInput): string[] {
  const {
    loopCount,
    commitmentCount,
    overdueCommitments,
    openLeadCount,
    activeJobCount,
    masteryScores,
    activeAlerts,
    brainAlerts,
    activeMissions,
    openLoops,
    dedupedCommitments,
    recentDecisions,
    latestWeight,
  } = input;

  const p: string[] = [];

  // Live domain snapshot — compact, data-only.
  // v11.1 · body/mood/score-gap rows retired alongside DailyScore.
  p.push(`## Live domain snapshot`);
  // Leads/jobs are nickstire-bridge data the hot prompt does NOT query
  // (latency), so they were hardcoded 0 by the caller — this line asserted
  // "0 leads · 0 jobs today" every turn. Only render when actually populated;
  // Nick pulls live numbers via the dailyPulse / queryNickstire tools. v-fix 2026-06-02.
  p.push(
    `- Business: $${(MONTHLY_REVENUE_TARGET / 1000).toFixed(0)}K/mo target` +
      (openLeadCount !== undefined && activeJobCount !== undefined && (openLeadCount > 0 || activeJobCount > 0)
        ? ` · ${openLeadCount} leads · ${activeJobCount} jobs today`
        : ``),
  );
  p.push(`- Tasks: ${loopCount} active${loopCount > 8 ? " — overloaded, triage before starting new" : ""}`);
  p.push(`- Commitments: ${commitmentCount} active${overdueCommitments > 0 ? ` · ${overdueCommitments} overdue` : ""}`);
  p.push(``);

  p.push(`# CURRENT STATE (LIVE DATA — ${today()})`);

  // Apr 19 · Daily score + habit-rate sections retired alongside the
  // underlying DailyScore + MasteryHabit models. Brain-maturity +
  // identity-snapshot blocks inject through the chat route instead.
  p.push(`## Mastery: ${masteryScores.join(" | ")}`);

  if (activeAlerts.length > 0) {
    p.push(`## DRIFT ALERTS (${activeAlerts.length})`);
    for (const a of activeAlerts) p.push(`[${a.severity.toUpperCase()}] ${a.ruleName}: ${a.message}`);
  } else {
    p.push(`## Drift: CLEAR`);
  }

  // v8.22 · brain-side alerts. The cron pipeline writes to BrainMemory
  // category=*_alert; surfacing them here lets the assistant
  // proactively reference them. Already pruned to last 7d in caller's
  // query.
  if (brainAlerts.length > 0) {
    p.push(`## BRAIN ALERTS (last 7d, ${brainAlerts.length})`);
    for (const a of brainAlerts) {
      const label = ALERT_LABEL[a.category] ?? a.category;
      const snippet = a.content.slice(0, 200);
      p.push(`- ${label}: ${snippet}`);
    }
    p.push(`If Nour's question relates to one of these alerts, surface the connection unprompted.`);
  }

  if (activeMissions.length > 0) {
    p.push(`## Active Missions`);
    for (const m of activeMissions) p.push(`- ${m.title} (${m.domain}, P${m.priority}) — ${m.successMetric || "no metric"}`);
  }

  if (openLoops.length > 0) {
    // Apr 18 naming: live Task INBOX/READY/DOING surfaced as "Active
    // Tasks" so the model reasons about the unified surface, not the
    // retired loops table.
    p.push(`## Active Tasks (${openLoops.length})`);
    for (const l of openLoops) p.push(`[${l.priority}] ${l.title}`);
  }

  if (dedupedCommitments.length > 0) {
    p.push(`## Active Commitments (${dedupedCommitments.length})`);
    for (const c of dedupedCommitments) p.push(`- ${c.description}${c.deadline ? ` (due ${c.deadline})` : ""}`);
  }

  // Apr 19 · Habit-rate section retired alongside MasteryHabit.

  if (recentDecisions.length > 0) {
    p.push(`## Recent Decisions`);
    for (const d of recentDecisions) p.push(`${d.date}: "${d.title}" (${d.stakes} stakes) — chose: ${d.chosen || "pending"}, grade: ${d.grade || "ungraded"}`);
  }

  p.push(`## Body: ${latestWeight?.weight ?? "?"} lbs (target 186) as of ${latestWeight?.date ?? "unknown"}`);

  return p;
}
