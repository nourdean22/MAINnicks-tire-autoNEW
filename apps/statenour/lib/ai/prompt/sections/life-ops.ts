/**
 * lib/ai/prompt/sections/life-ops.ts · Wave 84 · 2026-05-17
 *
 * Pure formatter for the v1 "Life Operating System" block — today's
 * situational awareness (drift/scattered state), time-aware priority,
 * weekly rhythm protocols, weekly targets, and the live scoreboard.
 *
 * Lifted verbatim from system-prompt.ts:913-1017. Byte-identical
 * output is the contract — any wording change must be paired with
 * the equivalent move in v2/renderer.ts so v1/v2 don't drift.
 */

import { today } from "@/lib/utils/datetime";

interface LifeOpsInput {
  loopCount: number;
  commitmentCount: number;
  missionCount: number;
  overdueCommitments: number;
  customerCount?: number;
  // Pre-computed weekly target (already fetched by the caller; the
  // caller owns the weekKey since it lives inside an async block).
  weeklyTarget: { content: string; metadata: unknown } | null;
  weekKey: string;
}

/**
 * Renders the full Life OS block — header through scoreboard. The
 * caller passes the data the section needs; this function does no
 * I/O. Returns the lines exactly as v1's inline pushes did, so the
 * rendered prompt stays byte-identical.
 */
export function renderLifeOps(input: LifeOpsInput): string[] {
  const {
    loopCount,
    commitmentCount,
    missionCount,
    overdueCommitments,
    customerCount,
    weeklyTarget,
    weekKey,
  } = input;

  const p: string[] = [];

  // Time-of-day signals (ET-anchored, mirrors v2/renderer.ts).
  const now = new Date();
  const currentHour = parseInt(
    now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10,
  );
  const dayName = now.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
  const isWeekend = dayName === "Saturday" || dayName === "Sunday";
  const timeOfDay = currentHour < 12 ? "morning" : currentHour < 17 ? "afternoon" : "evening";

  const todayStr = today();
  // v11.1 · only overload-driven states fire now that score/energy
  // signals retired alongside DailyScore.
  const isDrifting = loopCount > 8;
  const isScattered = loopCount > 5 && commitmentCount > 5;

  p.push(`# LIFE OPERATING SYSTEM`);
  p.push(``);

  // ── SECTION 1: TODAY'S SITUATIONAL AWARENESS ──
  p.push(`## TODAY: ${dayName}, ${todayStr} — ${timeOfDay.toUpperCase()} (${currentHour}:00 ET)`);
  p.push(``);

  if (isDrifting) {
    p.push(`### ⚠️ OVERLOAD STATE DETECTED`);
    p.push(`${loopCount} active tasks in the queue. Do NOT let Nour start anything new — force close one before opening another. The system can't move what it can't close.`);
    p.push(``);
  } else if (isScattered) {
    p.push(`### 🔀 SCATTERED STATE`);
    p.push(`${loopCount} active tasks + ${commitmentCount} active commitments = fragmented attention. Before ANYTHING new: "Which of these 3 can you close in 15 minutes?"`);
    p.push(``);
  }

  // v10.0.447 · temporal sections compressed (~200 tokens saved
  // per turn). Voice tuning lives in TIME_OF_DAY_VOICE; priority
  // rules + weekly protocols stay here.
  p.push(`### TIME-AWARE PRIORITY`);
  if (timeOfDay === "morning" && !isWeekend) {
    p.push(`Adderall peak window. MIT (Most Important Task that moves revenue) goes FIRST — redirect small-talk to "Your MIT today is [X]."`);
  } else if (timeOfDay === "morning" && isWeekend) {
    p.push(`BODY or FAMILY only. Redirect work talk to "What are you doing for yourself and Dania today?"`);
  } else if (timeOfDay === "afternoon" && !isWeekend) {
    p.push(`Operations mode — follow-ups + admin + callbacks. NO creative starts, NO big decisions. Execute the morning plan.`);
  } else if (timeOfDay === "evening") {
    p.push(`REVIEW ONLY, no new decisions. Permitted: today's review, tomorrow's MIT, journaling. New ideas → "Write it down. We'll evaluate at 9am."`);
  }
  p.push(``);

  // Weekly rhythm — day-specific protocols (distinct from voice tuning above)
  p.push(`### WEEKLY RHYTHM — ${dayName.toUpperCase()}`);
  if (dayName === "Monday") {
    p.push(`Set 3 targets (1 revenue · 1 personal · 1 health) + review last week. If unset, lead with "What are your 3 targets this week?"`);
  } else if (dayName === "Wednesday") {
    p.push(`Mid-week pulse. On pace for the week's targets? Estimates followed up · workouts on schedule · task queue growing or shrinking?`);
  } else if (dayName === "Friday") {
    p.push(`Revenue close. What deals pull forward before weekend? Ask: "Revenue this week vs target — what can we close in 4 hours?"`);
  } else if (dayName === "Sunday") {
    p.push(`Reflection + planning. What worked / didn't / insight. Set Monday's launch pad. NOT a work day — body + family + strategy only.`);
  } else {
    p.push(`Execute day. Head down on the week's 3 targets. Check pace.`);
  }
  p.push(``);

  // Weekly targets (caller already fetched these).
  if (weeklyTarget) {
    p.push(`### THIS WEEK'S TARGETS (set for week of ${weekKey})`);
    const meta = weeklyTarget.metadata as { revenue?: string; personal?: string; health?: string } | null;
    if (meta?.revenue || meta?.personal || meta?.health) {
      p.push(`1. REVENUE: ${meta.revenue || "not set"}`);
      p.push(`2. PERSONAL: ${meta.personal || "not set"}`);
      p.push(`3. HEALTH: ${meta.health || "not set"}`);
    } else {
      p.push(weeklyTarget.content);
    }
    p.push(`Reference these in every response where relevant. Hold Nour accountable to them.`);
    p.push(``);
  } else {
    p.push(`### ⚠️ NO WEEKLY TARGETS SET`);
    p.push(`If it's Monday, FORCE target-setting before anything else: "It's Monday. 3 targets: revenue, personal, health. Go."`);
    p.push(`If it's mid-week, note: "You're operating without a scoreboard this week."`);
    p.push(``);
  }

  // ── SECTION 2: SCOREBOARD ──
  // v10.0.445 · pushed leads/jobs to "Live domain snapshot" to dedupe
  // with this section. customerCount stays here as a one-liner.
  p.push(`### LIVE SCOREBOARD`);
  if (overdueCommitments > 0) {
    p.push(`🔴 ${overdueCommitments} OVERDUE commitments. Broken promises erode self-trust. Close or renegotiate TODAY.`);
  }
  p.push(`Active tasks: ${loopCount} | Active commitments: ${commitmentCount} | Active missions: ${missionCount}`);
  // customerCount is bridge-sourced + currently hardcoded 0 by the caller,
  // so this asserted "Customer base: 0 in DB". Only show when real. v-fix 2026-06-02.
  if (customerCount !== undefined && customerCount > 0) p.push(`Customer base: ${customerCount} in DB`);
  p.push(``);

  return p;
}
