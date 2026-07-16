/**
 * ULTRON NARRATOR — back-stage meta-observer voice.
 *
 * Four voices that sit ABOVE the mode classifier (BATTLE/SURGICAL/etc).
 * The mode pill shifts Nick's front-stage voice when Nour talks to him.
 * The narrator is Nick's back-stage voice — observing patterns, naming
 * them, and surfacing strategic wisdom WITHOUT waiting to be asked.
 *
 * Voices:
 *   • watcher  — quiet observations ("Nour has opened /tasks 14× today")
 *   • coach    — warm nudges when drift is detected
 *   • analyst  — pattern recaps with stats (evenings, weekly reviews)
 *   • adviser  — applied laws from the 190+ StrategicLaw library
 *
 * The engine is pure(-ish): pulls recent events + current state, extracts
 * trigger patterns, picks the right voice + narration. No AI calls in v1
 * — everything is rule-based so it's fast, predictable, and teachable.
 * Adviser pattern-matches against law triggerPatterns that are already
 * seeded in the DB.
 */

import { prisma } from "@/lib/prisma";
import { daysAgo, hourET, toDateString } from "@/lib/utils/datetime";
import { findLawsForPatterns, pickApplication, type LawRef } from "./adviser";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";

// Opt-in LLM synthesis (NARRATOR_LLM_SYNTHESIS=1). See synthesizeNarration.
const aiChatSynth = makeTracedAiChat("narrator-synthesis");

// ── Public types ──────────────────────────────────────────
export type NarratorVoice = "watcher" | "coach" | "analyst" | "adviser";
export type NarrationSeverity = "info" | "win" | "warn";

export interface Narration {
  id: string;               // stable per-event key for feedback + React
  voice: NarratorVoice;
  severity: NarrationSeverity;
  title: string;            // one-liner headline
  body?: string;             // optional second sentence
  law?: LawRef;             // only for adviser voice
  triggers: string[];       // snake_case patterns that fired
  createdAt: string;        // ISO
  domain?: "body" | "mind" | "money" | "life" | "system";
}

// ── Event inputs ──────────────────────────────────────────
interface EngineInputs {
  now: Date;
  hour: number;
  todayStr: string;
  todayScoreLogged: boolean;
  workoutStreakDays: number;
  workoutSkippedToday: boolean;
  workoutSkippedStreakDays: number; // days in a row not done
  habitsDone: number;
  habitsTotal: number;
  doneTasksToday: number;
  skippedTasksToday: number;
  overdueCommitments: number;
  openPendingDecisions: number;    // reviewAt past, not reviewed
  driftOpen: number;
  recentSkipReasons: string[];     // autoPriorityExplanation from recent skipped tasks
  recentCaptureSamples: string[];  // first 200 chars of today's captures
  recentChatMessages: string[];    // last 10 user chat messages
  recentReflectionsToday: number;
  mostRecentTaskTitle: string | null;
  mostRecentTaskCompletedAt: Date | null;
}

// ── Trigger pattern extractors ────────────────────────────
/**
 * Scan current state + recent activity and emit snake_case pattern names
 * that downstream (voice router + law matcher) can key off. This is the
 * ONLY place where real-world event shapes get mapped to Adviser-friendly
 * pattern keys. Keep patterns human-readable and stable — Adviser's
 * triggerPatterns match against these exact strings.
 */
// Opt-in LLM synthesis. The rule-based voices below each map a SINGLE
// signal to a template; they can't observe how signals COMBINE. When >=2
// patterns fire, this asks the model for ONE compound observation across
// them. Gated behind NARRATOR_LLM_SYNTHESIS=1 (off by default so it can
// never regress the ticker until reviewed), cached per hour+signal to
// avoid per-load LLM cost, best-effort (any failure or a "NONE" reply
// yields no synthesis narration). Additive only - never replaces a voice.
const synthCache = new Map<string, string>();

async function synthesizeNarration(
  inputs: EngineInputs,
  patterns: string[],
  now: string,
): Promise<Narration | null> {
  if (process.env.NARRATOR_LLM_SYNTHESIS !== "1") return null;
  if (patterns.length < 2) return null;
  const cacheKey = `${inputs.todayStr}-${inputs.hour}-${[...patterns].sort().join(",")}`;
  let text = synthCache.get(cacheKey);
  if (text === undefined) {
    try {
      const signal = {
        patterns,
        workoutSkippedStreakDays: inputs.workoutSkippedStreakDays,
        habits: `${inputs.habitsDone}/${inputs.habitsTotal}`,
        tasksDone: inputs.doneTasksToday,
        tasksSkipped: inputs.skippedTasksToday,
        driftOpen: inputs.driftOpen,
        skipReasons: inputs.recentSkipReasons.slice(0, 3),
        captures: inputs.recentCaptureSamples.slice(0, 2),
      };
      const res = await aiChatSynth(
        [
          {
            role: "system",
            content:
              "You are Nick's back-stage observer. Given today's signals about Nour, surface ONE sharp compound observation that connects MULTIPLE signals into a pattern he can't see from any single metric. One sentence, concrete, no praise, no hedging, no restating a lone number. If nothing genuinely connects, reply with exactly: NONE",
          },
          { role: "user", content: JSON.stringify(signal) },
        ],
        "fast",
      );
      const out = (res.content ?? "").trim();
      text = !out || out.toUpperCase() === "NONE" || out.length > 220 ? "" : out;
    } catch {
      text = "";
    }
    synthCache.set(cacheKey, text);
  }
  if (!text) return null;
  return {
    id: `synth-${inputs.todayStr}-${inputs.hour}`,
    voice: "analyst",
    severity: "info",
    title: text,
    triggers: [...patterns, "llm_synthesis"],
    createdAt: now,
  };
}

function extractTriggerPatterns(i: EngineInputs): string[] {
  const out: string[] = [];

  // ─── SCORE / AWARENESS ───
  // Overlap w/ Mastery "complacency_check" + 33 Strategies
  // "distraction_detected" so Adviser actually finds a matching law.
  if (!i.todayScoreLogged && i.hour >= 11) {
    out.push("self_awareness_gap", "discipline_slip",
             "complacency_check", "distraction_detected");
  }

  // ─── WORKOUT / BODY / REPUTATION ───
  // "credibility_risk" → Law 5 (reputation). "coasting_alert" → Mastery.
  // "drift_pattern" → 33 Strategies.
  if (i.workoutSkippedStreakDays >= 3) {
    out.push("reputation_at_risk", "credibility_risk", "coasting_alert",
             "drift_pattern", "discipline_slip", "body_neglect");
  }
  if (i.workoutStreakDays >= 7) {
    out.push("winning_streak", "discipline_peak", "flow_state");
  }

  // ─── RUMINATION / DECISION LOOP ───
  // "decision_paralysis" + "impatience_spiral" are real seeded patterns.
  if (i.openPendingDecisions >= 1) {
    out.push("rumination_loop", "decision_rehash", "indecision",
             "decision_paralysis", "impatience_spiral");
  }
  if (i.overdueCommitments >= 3) {
    out.push("broken_commitment", "trust_erosion", "losing_initiative");
  }

  // ─── EXECUTION MOMENTUM ───
  if (i.doneTasksToday >= 3) {
    out.push("bold_action", "bold_move", "winning_streak",
             "execution_flow", "flow_state", "decisive_action");
  }
  if (i.skippedTasksToday >= 3) {
    out.push("avoidance", "avoiding_confrontation", "discipline_slip",
             "friction_high", "losing_battle");
  }

  // ─── DRIFT ───
  if (i.driftOpen >= 3) {
    out.push("scattered_attention", "drift_accumulation",
             "drift_pattern", "mission_drift", "distraction_detected");
  }

  // ─── OVEREXPLAINING / CHAT PATTERNS ───
  // All 5 patterns map to Law 4 (Always Say Less Than Necessary).
  const longMsgs = i.recentChatMessages.filter((m) => m.length > 400).length;
  if (longMsgs >= 3) {
    out.push("over_explaining", "excessive_talking", "verbal_diarrhea",
             "filling_silence", "nervous_rambling");
  }

  // ─── CAPTURE THEMES ───
  const captureBlob = i.recentCaptureSamples.join(" ").toLowerCase();
  if (/\b(overwhelm|too much|cant keep up|can't keep up|scattered)\b/.test(captureBlob)) {
    out.push("overwhelmed", "scattered_attention", "burnout_risk",
             "distraction_detected");
  }
  if (/\b(frustrat|angry|pissed|annoy)\b/.test(captureBlob)) {
    out.push("ego_display", "emotion_leak", "emotional_reaction",
             "anger_spike");
  }

  // ─── SKIP-REASON PATTERNS (calibrated from skipped tasks) ───
  const skipBlob = i.recentSkipReasons.join(" ").toLowerCase();
  if (/\b(no time|later|tired|not feeling)\b/.test(skipBlob)) {
    out.push("avoidance", "rationalization", "comfort_zone",
             "complacency_detected");
  }

  return Array.from(new Set(out)); // dedupe
}

// ── Voice router ──────────────────────────────────────────
function selectVoice(
  patterns: string[],
  i: EngineInputs,
  hasLawMatch: boolean,
): NarratorVoice {
  // Adviser wins when patterns match a known law — strategic wisdom available
  if (hasLawMatch && patterns.some((p) =>
    ADVISER_TRIGGERING_PATTERNS.has(p)
  )) return "adviser";

  // Coach wins on drift / slip signals
  if (
    patterns.includes("discipline_slip") ||
    patterns.includes("avoidance") ||
    patterns.includes("drift_accumulation") ||
    patterns.includes("connection_slip")
  ) return "coach";

  // Analyst for evening recaps or high-activity days
  if (i.hour >= 20 && (i.doneTasksToday >= 2 || i.recentReflectionsToday >= 1)) {
    return "analyst";
  }

  // Default — watcher's quiet vibe
  return "watcher";
}

// Patterns strong enough to route to Adviser. Each one either matches a
// seeded law's triggerPatterns directly, or is synonymous with one the
// narrator consistently co-emits alongside. Expanded after the first
// v1 pass — the original set under-matched the law index.
const ADVISER_TRIGGERING_PATTERNS = new Set([
  // Rumination family
  "rumination_loop",
  "decision_rehash",
  "indecision",
  "decision_paralysis",
  "impatience_spiral",

  // Over-speaking family (Law 4)
  "over_explaining",
  "excessive_talking",
  "verbal_diarrhea",
  "nervous_rambling",
  "filling_silence",

  // Reputation / body family (Law 5)
  "reputation_at_risk",
  "credibility_risk",
  "coasting_alert",

  // Commitment / trust family
  "broken_commitment",
  "trust_erosion",
  "losing_initiative",

  // Ego / emotional leak
  "ego_display",
  "emotional_reaction",
  "anger_spike",

  // Drift family
  "drift_pattern",
  "mission_drift",
  "distraction_detected",
  "complacency_check",
  "complacency_detected",

  // Avoidance
  "avoidance",
  "avoiding_confrontation",
  "losing_battle",
  "comfort_zone",

  // Overwhelm
  "overwhelmed",
  "burnout_risk",

  // Strategic
  "premature_reveal",
  "outshining_detected",
  "showing_hand",
]);

// ── Template generators (watcher / coach / analyst) ──────
// Adviser template is law-driven, handled in generateNarration below.
function watcherTitle(i: EngineInputs): string | null {
  if (i.doneTasksToday >= 3) {
    return `${i.doneTasksToday} tasks done today · streak without skip`;
  }
  if (i.workoutStreakDays >= 7) {
    return `workout streak ${i.workoutStreakDays}d · in protection window`;
  }
  if (i.recentReflectionsToday >= 1) {
    return `${i.recentReflectionsToday} reflection${i.recentReflectionsToday > 1 ? "s" : ""} logged today`;
  }
  return null;
}

function coachTitle(i: EngineInputs): { title: string; body?: string; severity: NarrationSeverity } | null {
  if (i.workoutSkippedStreakDays >= 3) {
    return {
      title: `workout skipped ${i.workoutSkippedStreakDays}d running`,
      body: "body→business chain is the next thing to slip",
      severity: "warn",
    };
  }
  if (!i.todayScoreLogged && i.hour >= 14) {
    return {
      title: "no reflection yet · past 2pm",
      body: "a 60-sec reflection closes the self-tracking loop",
      severity: "warn",
    };
  }
  if (i.skippedTasksToday >= 3) {
    return {
      title: `${i.skippedTasksToday} tasks skipped today`,
      body: "pick the smallest one that's still open and finish it",
      severity: "warn",
    };
  }
  if (i.driftOpen >= 3) {
    return {
      title: `${i.driftOpen} drift alerts open`,
      body: "each unresolved alert = -0.3 discipline tomorrow",
      severity: "warn",
    };
  }
  return null;
}

function analystTitle(i: EngineInputs): { title: string; body?: string; severity: NarrationSeverity } | null {
  if (i.hour >= 20) {
    const bits: string[] = [];
    if (i.doneTasksToday > 0) bits.push(`${i.doneTasksToday} done`);
    if (i.recentReflectionsToday > 0) bits.push(`${i.recentReflectionsToday} reflections`);
    if (i.habitsTotal > 0) bits.push(`${i.habitsDone}/${i.habitsTotal} habits`);
    if (bits.length === 0) return null;
    return {
      title: `today's tape: ${bits.join(" · ")}`,
      body:
        i.doneTasksToday >= 3
          ? "above-average execution · log the lesson before shutdown"
          : i.doneTasksToday === 0
            ? "no completions · tomorrow's top-3 should include one quick win"
            : "mid-tempo day · one reflection captures the signal",
      severity: i.doneTasksToday >= 3 ? "win" : "info",
    };
  }
  return null;
}

// ── Main generator ────────────────────────────────────────
/**
 * Produce up to 3 narrations ordered by severity/priority. Caller (the
 * narrator strip + ticker) decides which to actually show and how long.
 *
 * Emotional balance: if the last 3 narrations in feedback log were all
 * "warn," bump a "win" narration to the top of the return list so we
 * don't pile warnings on warnings.
 */
export async function generateNarrations(): Promise<Narration[]> {
  const inputs = await computeEngineInputs();
  const patterns = extractTriggerPatterns(inputs);

  // Law matching for adviser voice
  const lawMatches = await findLawsForPatterns(patterns, { limit: 3 }).catch(() => []);
  const hasLawMatch = lawMatches.length > 0;

  const now = new Date().toISOString();
  const narrations: Narration[] = [];

  // Adviser narration (top priority when law hits)
  if (hasLawMatch) {
    const law = lawMatches[0];
    const application = pickApplication(law, { /* context hints live here in v2 */ });
    const id = `adv-${law.number}-${toDateString(new Date())}-${inputs.hour}`;
    narrations.push({
      id,
      voice: "adviser",
      severity: "info",
      title: `Law ${law.number}: ${law.shortTitle}`,
      body: application.text,
      law: {
        id: law.id,
        book: law.book,
        number: law.number,
        shortTitle: law.shortTitle,
        application: application.kind,
        applicationText: application.text,
      },
      triggers: patterns.filter((p) => ADVISER_TRIGGERING_PATTERNS.has(p)),
      createdAt: now,
    });
  }

  // Coach narration (warn vibe)
  const coach = coachTitle(inputs);
  if (coach) {
    narrations.push({
      id: `coa-${inputs.todayStr}-${inputs.hour}-${coach.title.slice(0, 12).replace(/\s/g, "_")}`,
      voice: "coach",
      severity: coach.severity,
      title: coach.title,
      body: coach.body,
      triggers: patterns,
      createdAt: now,
    });
  }

  // Analyst recap (evening)
  const analyst = analystTitle(inputs);
  if (analyst) {
    narrations.push({
      id: `ana-${inputs.todayStr}-${inputs.hour}`,
      voice: "analyst",
      severity: analyst.severity,
      title: analyst.title,
      body: analyst.body,
      triggers: patterns,
      createdAt: now,
    });
  }

  // Watcher observation (quiet info)
  const watcher = watcherTitle(inputs);
  if (watcher) {
    narrations.push({
      id: `wat-${inputs.todayStr}-${inputs.hour}-${watcher.slice(0, 12).replace(/\s/g, "_")}`,
      voice: "watcher",
      severity: "info",
      title: watcher,
      triggers: patterns,
      createdAt: now,
    });
  }

  // ── Brain-aware narrations (Apr 19) ──
  // The narrator reads the self-model subsystems and surfaces a
  // targeted observation when something salient is happening.
  // Non-blocking: any failure just skips the voice.
  try {
    const { computeNudges } = await import("@/lib/brain/cross-system-nudge");
    const nudges = await computeNudges();
    const highSeverity = nudges.find((n) => n.severity === "high");
    if (highSeverity) {
      narrations.push({
        id: `brain-${inputs.todayStr}-${inputs.hour}-${highSeverity.source}`,
        voice: "coach",
        severity: "warn",
        title: highSeverity.text,
        triggers: patterns,
        createdAt: now,
      });
    }

    // Contradictions piling up = narrator escalation
    const { countUnresolved } = await import("@/lib/brain/contradiction-surfacer");
    const openContradictions = await countUnresolved(14).catch(() => 0);
    if (openContradictions >= 2) {
      narrations.push({
        id: `brain-contra-${inputs.todayStr}-${inputs.hour}`,
        voice: "analyst",
        severity: "warn",
        title: `${openContradictions} contradictions sitting open — worth 2 minutes in /brain to reconcile`,
        triggers: patterns,
        createdAt: now,
      });
    }

    // Identity axis shift nudge
    const identityMod = await import("@/lib/brain/identity-snapshot");
    const snap = await identityMod.loadIdentitySnapshot().catch(() => null);
    if (snap) {
      const axes = snap.axes as Record<string, { value: number; manual: number | null; direction: string; evidence: string[] }>;
      const shifting = Object.entries(axes)
        .filter(([, a]) => a.direction !== "stable" && a.evidence.length > 0)
        .sort(([, a], [, b]) => (b.manual ?? b.value) - (a.manual ?? a.value))
        .slice(0, 1);
      if (shifting.length > 0) {
        const [axisKey, axis] = shifting[0];
        const arrow = axis.direction === "rising" ? "↑" : "↓";
        narrations.push({
          id: `brain-axis-${inputs.todayStr}-${axisKey}`,
          voice: "watcher",
          severity: "info",
          title: `${axisKey.replace(/_/g, " ")} is ${arrow} — ${axis.evidence[0] ?? ""}`,
          triggers: patterns,
          createdAt: now,
        });
      }
    }
  } catch {
    // swallow — narrator continues with whatever it has
  }

  // LLM synthesis - one compound observation across signals (opt-in).
  try {
    const synth = await synthesizeNarration(inputs, patterns, now);
    if (synth) narrations.push(synth);
  } catch {
    // best-effort - synthesis is a bonus narration, never block others
  }

  // XP drift - surface the single most-significant mastery-cadence shift
  // (recent 7d vs trailing 28d per stat). Math finds it; this narrates it.
  // Self-contained + best-effort: a bonus narration that never blocks others.
  try {
    const { detectXpDrift } = await import("@/lib/mastery/xp-drift");
    const topDrift = (await detectXpDrift())[0];
    if (topDrift) {
      const statLabel = topDrift.stat.replace(/_/g, " ");
      const pct = Math.round(topDrift.ratio * 100);
      narrations.push(
        topDrift.direction === "decay"
          ? {
              id: `xpdrift-${inputs.todayStr}-${topDrift.stat}`,
              voice: "coach",
              severity: "warn",
              title: `${statLabel} cadence is down to ${pct}% of your usual - it's slipping this week`,
              triggers: [...patterns, "xp_drift_decay"],
              createdAt: now,
            }
          : {
              id: `xpdrift-${inputs.todayStr}-${topDrift.stat}`,
              voice: "analyst",
              severity: "win",
              title: `${statLabel} is surging - ${pct}% of your usual pace this week`,
              triggers: [...patterns, "xp_drift_surge"],
              createdAt: now,
            },
      );
    }
  } catch {
    // best-effort - drift is a bonus narration, never block the others
  }

  return narrations.slice(0, 3);
}

// ── Engine input computation ──────────────────────────────
/**
 * One DB-trip aggregation of everything the engine needs. Kept private
 * so callers can't accidentally rely on specific query shapes.
 */
async function computeEngineInputs(): Promise<EngineInputs> {
  const now = new Date();
  const hour = hourET(now);
  const todayStr = toDateString(now);
  const weekAgo = daysAgo(7);
  const twoDaysAgo = daysAgo(2);

  const [
    habitsToday,
    workoutWeek,
    tasksToday,
    overdueTasks,
    openDecisions,
    driftOpen,
    chatMessages,
    captures,
    reflectionsToday,
    reflectionLoggedToday,
  ] = await Promise.all([
    Promise.resolve([] as Array<{ habitKey: string; completed: boolean }>),
    Promise.resolve([] as Array<{ date: string; completed: boolean }>),
    prisma.task
      .findMany({
        where: {
          OR: [
            { status: "DONE", updatedAt: { gte: new Date(todayStr + "T00:00:00") } },
            { status: "INBOX", lastTouchedAt: { gte: new Date(todayStr + "T00:00:00") }, autoPriorityExplanation: { contains: "skip" } },
          ],
        },
        select: { id: true, title: true, status: true, updatedAt: true, autoPriorityExplanation: true },
        orderBy: { updatedAt: "desc" },
        take: 30,
      })
      .catch((): Array<{ id: string; title: string; status: string; updatedAt: Date; autoPriorityExplanation: string | null }> => []),
    prisma.task
      .count({
        where: {
          loopKind: "PROMISE",
          deletedAt: null,
          status: { notIn: ["DONE", "ARCHIVED"] },
          dueDate: { lt: now },
        },
      })
      .catch(() => 0),
    prisma.decisionReplay
      .count({ where: { reviewed: false, reviewAt: { lte: now } } })
      .catch(() => 0),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
        },
        select: { metadata: true },
      })
      .then((rows) => {
        return rows.filter((r) => {
          const meta = (r.metadata ?? {}) as Record<string, any>;
          return !meta.ackedAt;
        }).length;
      })
      .catch(() => 0),
    prisma.chatMessage
      .findMany({
        where: { role: "user", createdAt: { gte: twoDaysAgo } },
        select: { content: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
      .catch((): Array<{ content: string; createdAt: Date }> => []),
    prisma.brainDump
      .findMany({
        where: { date: todayStr },
        select: { rawThoughts: true, summary: true },
        take: 5,
      })
      .catch((): Array<{ rawThoughts: string; summary: string | null }> => []),
    prisma.reflection
      .count({ where: { date: todayStr, deletedAt: null } })
      .catch(() => 0),
    // Proxy for "self-tracking loop closed today" — Apr 17, DailyScore
    // retired. Any reflection logged today counts as awareness signal.
    prisma.reflection
      .count({ where: { date: todayStr, deletedAt: null } })
      .catch(() => 0),
  ]);

  // Derived workout stats
  const workoutDoneToday = habitsToday.find((h) => h.habitKey === "workout")?.completed === true;
  const workoutSorted = [...workoutWeek].sort((a, b) => (a.date < b.date ? 1 : -1));
  let workoutStreakDays = 0;
  let workoutSkippedStreakDays = 0;
  for (const w of workoutSorted) {
    if (w.date === todayStr) continue;
    if (w.completed) {
      workoutStreakDays++;
      if (workoutSkippedStreakDays > 0) break;
    } else {
      workoutSkippedStreakDays++;
      if (workoutStreakDays > 0) break;
    }
  }

  // Tasks today breakdown
  const doneTasksToday = tasksToday.filter((t) => t.status === "DONE").length;
  const skippedTasksToday = tasksToday.filter((t) =>
    t.autoPriorityExplanation?.toLowerCase().includes("skip"),
  ).length;

  const mostRecentDone = tasksToday.find((t) => t.status === "DONE");

  return {
    now,
    hour,
    todayStr,
    todayScoreLogged: reflectionLoggedToday > 0,
    workoutStreakDays,
    workoutSkippedToday: !workoutDoneToday,
    workoutSkippedStreakDays,
    habitsDone: habitsToday.filter((h) => h.completed).length,
    habitsTotal: habitsToday.length,
    doneTasksToday,
    skippedTasksToday,
    overdueCommitments: overdueTasks,
    openPendingDecisions: openDecisions,
    driftOpen,
    recentSkipReasons: tasksToday
      .filter((t) => t.autoPriorityExplanation?.toLowerCase().includes("skip"))
      .map((t) => t.autoPriorityExplanation ?? ""),
    recentCaptureSamples: captures.map((c) => (c.summary ?? c.rawThoughts).slice(0, 200)),
    recentChatMessages: chatMessages.map((m) => m.content),
    recentReflectionsToday: reflectionsToday,
    mostRecentTaskTitle: mostRecentDone?.title ?? null,
    mostRecentTaskCompletedAt: mostRecentDone?.updatedAt ?? null,
  };
}

// Note: selectVoice is defined above but currently only used inline in
// generateNarrations via individual template checks. Exposing it for
// future callers (e.g. chat interstitial pipeline) that want to pick a
// voice for a stand-alone event.
export { selectVoice, extractTriggerPatterns };
