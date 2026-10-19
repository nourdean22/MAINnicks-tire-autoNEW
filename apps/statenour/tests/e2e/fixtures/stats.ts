/**
 * DEMO fixtures for Stats (/stats, the default Mastery tab), UI v3 W4 gate (2026-10-19). Typed against
 * the routers' outputs.
 *
 * The reads the Mastery tab makes on load (the same set before and after W4; W4 added StatsVerdict,
 * which shares operator.characterSheet's query key):
 *   operator.characterSheet       the verdict line (W4), the level-up card and the character sheet: the content
 *   task.goals                    the level-up card's goal ranking ({ goals: [] } is a measured empty)
 *   operator.bodyTracking         the level-up card's body input (no entries, no progress: measured empty)
 *   operator.identityProjection   the identity arc (no trajectories: measured empty)
 *   operator.xpGrowthComparison   the identity arc's growth rows ([] measured empty)
 *   systemBrain.antiPatterns      recurring enemies (no items: measured empty)
 *   operator.skills               graduated skills (none active, none pending)
 *   system.journeyLens            the Journey panel under the page (every section "not enough data yet")
 * The character sheet carries the content; every side read answers in its measured-empty shape, so the
 * render is the loaded page, never an error state.
 */
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/lib/trpc/root";

import { NOW_ISO } from "./time";
import type { Wire } from "./wire";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Stat = Wire<RouterOutputs["operator"]["characterSheet"]>[number];

const stat = (key: string, label: string, branch: string, color: string, level: number, xp: number, rising7dXp: number, progressPct: number, tier: string): Stat => ({
  key,
  label,
  shortLabel: label,
  description: `${label}: an invented stat for the six-feet render`,
  color,
  branch,
  xp,
  level,
  tier,
  tierEmoji: "",
  xpIntoLevel: Math.round((progressPct / 100) * 400),
  xpForNext: 400,
  progressPct,
  rising7dXp,
  goals: [],
});

/** The week's top riser: its label is the Stats anchor (the verdict line and the sheet both print it). */
export const STATS_TOP_RISER = "Demo Focus";

export const STATS_SHEET: Wire<RouterOutputs["operator"]["characterSheet"]> = [
  stat("demo_focus", STATS_TOP_RISER, "mind", "#7aa2f7", 9, 3120, 46, 62, "adept"),
  stat("demo_strength", "Demo Strength", "body", "#9ece6a", 7, 2240, 18, 35, "adept"),
  stat("demo_craft", "Demo Craft", "empire", "#e0af68", 6, 1810, 12, 80, "apprentice"),
  stat("demo_patience", "Demo Patience", "mind", "#bb9af7", 5, 1290, 0, 15, "apprentice"),
  stat("demo_reach", "Demo Reach", "influence", "#f7768e", 4, 860, 4, 50, "novice"),
  stat("demo_endurance", "Demo Endurance", "body", "#73daca", 3, 520, 0, 20, "novice"),
];

export const STATS_GOALS: Wire<RouterOutputs["task"]["goals"]> = { goals: [] };
export const STATS_BODY: Wire<RouterOutputs["operator"]["bodyTracking"]> = { entries: [], progress: null };
export const STATS_IDENTITY: Wire<RouterOutputs["operator"]["identityProjection"]> = { projectedAt: NOW_ISO, horizonDays: 30, trajectories: [] };
export const STATS_XP_GROWTH: Wire<RouterOutputs["operator"]["xpGrowthComparison"]> = [];
export const STATS_ANTI_PATTERNS: Wire<RouterOutputs["systemBrain"]["antiPatterns"]> = {
  items: [],
  summary: {
    total: 0,
    byDomain: { business: 0, personal: 0, tech: 0, health: 0, relationships: 0, other: 0 },
    bySeverity: { info: 0, warn: 0, critical: 0 },
    oldestAt: null,
  },
};
export const STATS_SKILLS: Wire<RouterOutputs["operator"]["skills"]> = { active: [], pending: [] };

const notEnough = <T,>(data: T) => ({ enoughData: false, since: NOW_ISO, source: "demo fixture", data });
export const STATS_JOURNEY: Wire<RouterOutputs["system"]["journeyLens"]> = {
  identity: notEnough([]),
  xp: notEnough({ current30: 0, prior30: 0, growthPct: null }),
  enemies: notEnough([]),
  skills: notEnough([]),
};
