/**
 * Tip registry · Wave 20 · contextual learning notes for /tasks.
 *
 * Each tip is a short plain-English sentence (1-2 sentences max) keyed
 * by surface. Used by <TipChip> across the /tasks page so the operator
 * can summon a quick explanation of any concept inline without leaving
 * their work.
 *
 * Design rules:
 *   · plain English · no jargon · operator-grade tone
 *   · lowercase to match the editorial contract
 *   · 1-2 sentences · if you need more, the destination route gets a
 *     deeper writeup — these are inline micro-tips, not articles
 *   · explain WHAT it is + WHY it matters (or HOW to use it)
 *
 * Adding a new tip:
 *   1. Add a key here · choose surface-name.key format
 *   2. Import the constant where you mount the TipChip
 *   3. Pass `tip={LEARN_TIPS.your_key}` to the chip
 */

export const LEARN_TIPS = {
  // ─── Mode pills ───────────────────────────────────────
  mode_today:
    "today shows what's open right now. quick-add a task, knock it down, and watch your done-count grow. the default mode in the morning + early afternoon.",
  mode_goals:
    "goals are the big aims you're moving toward. each goal links to one or more missions (projects). missions break into tasks that show up here in today.",
  mode_trends:
    "trends is your numbers deck. streaks, pace, weekly review, drift, and the daily brief Nick writes for you. the default in the evening — debrief time.",

  // ─── Context band ───────────────────────────────────────
  brain_card:
    "brain is what the system knows about you · skills, identity, beliefs, what Nick noticed today. the score is a rough 0-100 maturity reading · contradictions are open questions to resolve.",
  life_band:
    "the 5 spots are how you track who you're becoming · growth (8 axes), body, money, knowledge, learn. one tap to land on any dashboard.",

  // ─── Capture ───────────────────────────────────────
  capture_button:
    "drop any thought, decision, insight, or fact here. Nick reads it and routes to the right place automatically — journal, pins, decisions, or memory.",

  // ─── Task primitives ───────────────────────────────────────
  task_kinds:
    "tasks come in 3 shapes · ONCE is a one-shot, DAILY repeats every day, PROMISE is to someone (@name). type `every day:` or `promise @nour ...` to set the kind from quick-add.",
  task_pin:
    "pinning a task keeps it visible at the top of today and protects it from drift sweeps. use it for the 1-3 tasks you absolutely must close before bed.",
  task_drift:
    "a task drifts when it's been sitting in your list for too long without progress. trends + the weekly review surface them so you can drop or re-frame instead of letting them rot.",

  // ─── Goals ───────────────────────────────────────
  goal_pace:
    "pace tells you whether the goal is on track for its deadline. green means you're hitting the daily increment · amber/red mean it's slipping. tap the pace chip to spawn a quick task tagged with this goal.",
  goal_horizon:
    "horizon is the timescale · week, month, quarter, year, decade. shorter horizons need daily increments; longer horizons are about staying directionally right.",
  goal_evidence:
    "every goal needs proof · the most-recent done tasks tagged with this goal are your evidence row. an empty evidence row = goal exists on paper but not in motion.",

  // ─── Trends · charts ───────────────────────────────────────
  trends_sparkline:
    "the sparkline shows how many tasks you've closed each day for the last 14 days. flat or falling = momentum is fading · rising = you're on a roll.",
  trends_streak:
    "streaks track consecutive days where the daily-loop tasks all got done. losing a streak isn't a failure — it's a signal that the habit might need redesign.",
  trends_promise:
    "kept-promises rate is the percent of promises (to yourself or others) you actually completed by their deadline. this is the single most important integrity number on the page.",
  trends_brief:
    "the daily brief is a 1-paragraph read Nick writes you each morning + evening, based on what you closed, what's overdue, and what's stale. the morning version is forward-looking, the evening one is debrief.",

  // ─── Drift / weekly review ───────────────────────────────────────
  drift_warning:
    "when this number is high it means tasks are sitting open for many days. drift is silent — the weekly review is where you decide: do, drop, or re-frame.",
  weekly_review:
    "every sunday-ish, Nick walks you through 4 steps · kill the stale, re-frame the promising, plan the next week's targets. takes 5-8 minutes · the highest-leverage habit on the OS.",
} as const;

export type LearnTipKey = keyof typeof LEARN_TIPS;
