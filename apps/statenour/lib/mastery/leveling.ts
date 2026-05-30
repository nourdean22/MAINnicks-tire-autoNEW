/**
 * Mastery leveling engine · 2026-05-30
 *
 * Turns the existing MasteryScore "bumps" — the per-action `delta` the
 * auto-learn engine already writes when you complete a task — into an
 * RPG-style XP → LEVEL system. Schema-free: lifetime XP for a stat is
 * the SUM of its deltas, i.e. every action you've ever taken in that
 * domain. No migration, no new tables; it reinterprets data we already
 * have so it ships today.
 *
 * Patterns applied (the curated "steal" list):
 *  · product-tracking · SIGNAL_XP below is the event taxonomy — which
 *    signal earns which stat's XP. Only `task` fires today; the others
 *    are documented now (the model is whole) and wired in later slices.
 *  · loss-aversion-designer · decayXp() lets a neglected stat bleed XP.
 *    A level you can LOSE is what makes a streak feel like it matters.
 *  · startup-metrics-framework · the curve is gentle early (quick wins)
 *    and steep late (the grind) — earned but reachable.
 */

// ─── Signal → XP taxonomy (product-tracking event model) ────────────
// Base XP weight per signal type. The TASK weight is scaled at write
// time by the auto-learn adaptive multiplier (effort × ROI × goal ×
// streak, range 0.1–3.0); the unstructured signals (journal/chat/email)
// get an AI-assigned weight at attribution time, floored at these bases.
export const SIGNAL_XP = {
  task: 1.0, // a completed task (already live, adaptively scaled)
  habit: 0.5, // a checked daily habit
  decision: 1.2, // a logged decision made under real stakes
  journal: 0.8, // an insight caught in the journal (AI-attributed)
  email: 0.6, // an email handled well (AI-attributed)
  chat: 0.4, // a meaningful exchange with Nick (AI-attributed)
} as const;
export type MasterySignal = keyof typeof SIGNAL_XP;

// ─── XP curve ───────────────────────────────────────────────────────
// Cumulative XP required to REACH a level. Increments grow linearly
// (5, 10, 15, …) so cumulative XP is quadratic:
//   L1=0 · L2=5 · L3=15 · L4=30 · L5=50 · L7=105 · L10=225 · L13=390
const CURVE_K = 2.5;

/** Cumulative XP needed to reach `level` (level 1 = 0). */
export function xpForLevel(level: number): number {
  const L = Math.max(1, Math.floor(level));
  return Math.round(CURVE_K * L * (L - 1));
}

/** The level an XP total has reached (≥ 1). Inverse of xpForLevel:
 *  CURVE_K·L·(L-1) ≤ xp → L = floor((1 + √(1 + 4·xp/CURVE_K)) / 2). */
export function levelFromXp(xp: number): number {
  if (xp <= 0) return 1;
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xp) / CURVE_K)) / 2));
}

export interface LevelProgress {
  level: number;
  /** XP earned since reaching the current level. */
  xpIntoLevel: number;
  /** XP span from the current level to the next. */
  xpForNext: number;
  /** 0–100 toward the next level. */
  progressPct: number;
}

export function levelProgress(xp: number): LevelProgress {
  const safeXp = Math.max(0, xp);
  const level = levelFromXp(safeXp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  const span = Math.max(1, ceil - floor);
  const into = Math.max(0, safeXp - floor);
  return {
    level,
    xpIntoLevel: Math.round(into * 10) / 10,
    xpForNext: span,
    progressPct: Math.min(100, Math.round((into / span) * 100)),
  };
}

// ─── Tiers (Greene apprenticeship → mastery arc) ────────────────────
export interface MasteryTier {
  name: string;
  emoji: string;
}

/** Greene-flavored tier for a level — the arc Nour is already living. */
export function tierForLevel(level: number): MasteryTier {
  if (level >= 13) return { name: "Transcendent", emoji: "🌌" };
  if (level >= 10) return { name: "Mastery", emoji: "👑" };
  if (level >= 7) return { name: "Practitioner", emoji: "⚔️" };
  if (level >= 4) return { name: "Active", emoji: "🔥" };
  return { name: "Apprentice", emoji: "🌱" };
}

// ─── Loss aversion · decay ──────────────────────────────────────────
/**
 * A stat with no rep in `graceDays` starts bleeding XP at `ratePerDay`
 * (a fraction of current XP, compounding). Untouched mastery fades —
 * which is exactly what makes keeping a streak feel like it matters.
 *
 * Pure + side-effect free (the caller supplies daysSinceLastRep) so it
 * stays testable. Not yet wired to a cron — the mastery-decay cron is
 * currently dead; a later slice gives it a home. Documented here so the
 * leveling math already knows decay exists.
 */
export function decayXp(
  xp: number,
  daysSinceLastRep: number,
  graceDays = 7,
  ratePerDay = 0.01,
): number {
  if (xp <= 0 || daysSinceLastRep <= graceDays) return Math.max(0, xp);
  const decayDays = daysSinceLastRep - graceDays;
  const decayed = xp * Math.pow(1 - ratePerDay, decayDays);
  return Math.max(0, Math.round(decayed * 10) / 10);
}
