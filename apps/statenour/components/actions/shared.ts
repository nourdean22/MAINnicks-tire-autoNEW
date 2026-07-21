/**
 * Shared types + formatting helpers for the Actions page.
 *
 * Everything in this file is framework-agnostic and safely importable
 * from both server code and client components. No React imports.
 */

export type LoopKind = "ONCE" | "DAILY" | "PROMISE";

/**
 * v10.0.529.15 · Project shape consumed by page.tsx + projects-panel
 * + ProjectCard. Loose by design · `planData` is opaque here (the AI
 * plan JSON has its own schema owned by `lib/ai/plan-project`).
 *
 * Previously duplicated between page.tsx (line 113) + projects-panel
 * (line 62). Consolidated here so any future API contract change
 * lands in one place.
 */
export interface Project {
  id: string;
  title: string;
  status: string;
  domain?: string | null;
  description?: string | null;
  deadline?: string | null;
  planData?: unknown;
  /** Wave AJ · 2026-05-28 · operator-set sort rank · lower = higher in
   *  the missions list · nulls sink to bottom. MissionFeed sorts by
   *  this first so the ↑/↓ reorder buttons actually persist visually. */
  manualRankOverride?: number | null;
  /** truth-substrate audit P1 (#19): carried through by listMissions/
   *  decorateMissions at runtime; declared here so MissionFeed can call
   *  isGeneralAnchor(mission) to split GENERAL domain-anchor buckets out of
   *  the "unattached" pile. "GENERAL" ⇒ a per-domain classifier anchor. */
  systemKind?: string | null;
  canonicalDomain?: string | null;
}

/**
 * v10.0.529.15 · Cached subset of LifeGoal that the /tasks page +
 * ProjectsPanel both render. Carries the union needed for staleness
 * signals (createdAt/updatedAt) + pace fields (targetValue/deadline)
 * used by the goalLineage paceKind computation.
 *
 * Previously a function-scoped local `type` in page.tsx + an exported
 * `interface` in projects-panel · structurally identical · merged
 * here as the single source of truth.
 */
export interface GoalCacheEntry {
  id: string;
  title: string;
  horizon?: string | null;
  domain?: string;
  createdAt?: string;
  updatedAt?: string;
  progress?: number;
  currentValue?: number;
  targetValue?: number;
  deadline?: string | null;
  status?: string;
  linkedActiveCount?: number;
  linkedDoneCount?: number;
  loopsThisWeek?: number;
  /** 2026-05-27 · "so that" clause from LifeGoal.why · surfaced in
   *  ReviewWizard Step 2 so mission alignment is fresh during the
   *  weekly review (Challies framework). Nullable · operators may
   *  not have filled this in for older goals. */
  why?: string | null;
}

/**
 * v10.0.529.16 · GoalLineageEntry · per-row rollup that the /tasks
 * page builds via the `goalLineage` useMemo and threads down through
 * NowPanel → LoopStream. `paceKind` drives the cross-tab urgency
 * bump · rows linked to a goal that's "behind" or "missed" get
 * priority boosted.
 *
 * Previously declared in 3 places (page.tsx useMemo return type,
 * NowPanel local type, LoopStream inline prop type). Consolidated
 * here so future field additions land in one place.
 */
export interface GoalLineageEntry {
  title: string;
  horizon?: string;
  domain?: string;
  paceKind:
    | "behind"
    | "needs"
    | "missed"
    | "on-track"
    | "ahead"
    | "unscored";
}

/**
 * Goal → linked-project chip. Computed by useGoalProjectBridge by
 * walking tasks: any Mission with at least one Task whose `goalId`
 * matches the goal is "linked". Feeds the bridge's `goalToProjects`
 * map.
 *
 * Previously exported from components/actions/mode-plan.tsx. That
 * component was relocated to components/goals/goal-board.tsx and
 * trimmed (2026-05-21 · KommandoShell dismantle) — the goal↔project
 * link manager was removed there, so the type's natural home is here
 * alongside the other goal-project bridge types.
 */
export interface PlanLinkedProjectChip {
  id: string;
  title: string;
  openCount: number;
  totalCount: number;
}

export interface Task {
  id: string;
  title: string;
  status: string;
  nextPhysicalAction: string;
  missionId: string;
  effort?: string;
  context?: string;
  /** v10.0.529.14 · "what does done look like" string. Renders in
   *  the row metadata grid. Promoted to the Task interface so the
   *  child component can drop unsafe runtime casts. */
  finishCondition?: string | null;
  /** v10.0.529.14 · energy band the task needs ("low" · "medium" ·
   *  "high"). Drives now-signals fit classification + metadata grid. */
  energyRequired?: string | null;
  autoPriority: number | null;
  autoPriorityExplanation: string | null;
  stale?: boolean;
  dueDate?: string;
  createdAt?: string;
  updatedAt?: string;
  lastTouchedAt?: string;
  mission?: { title: string; domain: string };
  // ── Loops unification (Apr 15) ──
  loopKind?: LoopKind;
  promiseTo?: string | null;
  lastCompletedAt?: string | null;
  streakCount?: number;
  // ── Lineage + time tracking (Apr 15 over-delivery pass) ──
  /** Link to parent LifeGoal — lets the UI render "↳ Goal title" breadcrumbs */
  goalId?: string | null;
  /** Project phase name for project-spawned tasks */
  phaseName?: string | null;
  /** Tracked minutes (diff of startedAt→now when transitioning DOING→DONE) */
  actualMinutes?: number;
  /** Set when status → DOING. Used to compute actualMinutes delta. */
  startedAt?: string | null;
  /** Person/vendor/decision the task is blocked on (status WAITING). */
  waitingOn?: string | null;
  /** v10.0.529.84 · Wave 28 · A1 · when set, the task is snoozed (not
   *  vendor-blocked) and the task-resurface cron will flip it back to
   *  READY at this timestamp. WaitingBand uses this to differentiate
   *  "snoozed until friday" from "blocked on X indefinitely". */
  snoozedUntil?: string | null;
  /** Apr 26 · Source of the original `created` event — surfaces a
   *  small attribution chip on the row. Examples:
   *  "service:createTask", "chat-fast-path:brain-dump",
   *  "journal-ingest", "ai-suggest", "auto-extract:chat".
   *  Null for legacy tasks created before the TaskEvent log. */
  originSource?: string | null;
  /** 2026-05-23 · task #22 · self-FK for subtask hierarchy. Nullable ·
   *  top-level tasks have null · subtasks point at their parent. The
   *  UI gates "new subtask" creation on rows where parentTaskId is
   *  null (per ADR-0017 amended Rule 4 · 1-level depth). Companion
   *  schema field at prisma/schema.prisma line 348. */
  parentTaskId?: string | null;
}

/**
 * Apr 26 · Coarse-grained "where did this come from?" label suitable
 * for a row chip. Maps the various source strings to a tight set
 * of human-readable labels. Returns null when source is unknown,
 * legacy, or just the manual page-add path (in which case the chip
 * adds noise, not signal).
 */
export function originSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  if (source.startsWith("service:")) return null; // manual page action — default, no chip
  if (source.includes("chat") || source.includes("interceptor")) return "chat";
  if (source.includes("journal") || source.includes("brain-dump")) return "journal";
  if (source.includes("ai-suggest") || source.includes("ai_")) return "AI";
  if (source.includes("auto-extract")) return "auto";
  if (source.includes("voice")) return "voice";
  if (source.includes("cron")) return "cron";
  if (source.includes("project") || source.includes("plan")) return "plan";
  return null;
}

export interface AiTask {
  title: string;
  missionId: string | null;
  priority: "critical" | "high" | "medium" | "low";
  nextAction: string;
  reasoning: string;
}

export interface NickTask {
  id: number;
  title: string;
  domain: string | null;
  priority: string;
  description: string | null;
  status: string;
  source: string | null;
  /** Optional backlink to the BrainDump that spawned this loop — set
   *  by the journal-ingest pipeline and backfill scripts so the /tasks
   *  UI can render a "from journal" link that opens the source entry. */
  sourceBrainDumpId?: string | null;
  createdAt: string;
}

export interface Commitment {
  id: string;
  description?: string;
  title?: string;
  domain?: string;
  deadline?: string;
  createdAt?: string;
}

export interface Habit {
  key: string;
  completed: boolean;
}

// v10.0.529.15 · the prior loose `Project` interface here (id/title/
// domain?/status only) was a strict subset of the new richer one
// defined above (which adds description/deadline/planData). Removed
// the duplicate · the consolidated declaration earlier in this file
// is the single source of truth.

export interface BrainInsight {
  type: "warning" | "action" | "success" | "info";
  text: string;
}

export interface ActionsBrain {
  stats?: {
    openTasks: number;
    activeCommitments: number;
  };
  dailyFocus?: string;
  insights?: BrainInsight[];
}

// ─── Formatting tables ─────────────────────────────────

export const EFFORT_LABEL: Record<string, string> = {
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H2PLUS: "2h+",
};

export const CONTEXT_ICON: Record<string, string> = {
  DESK: "💻",
  PHONE: "📱",
  SHOP: "🔧",
  CAR: "🚗",
  HOME: "🏠",
  ANYWHERE: "📍",
};

export const DOMAIN_COLOR: Record<string, string> = {
  business: "bg-amber-500/15 text-amber-400",
  personal: "bg-violet-500/15 text-violet-400",
  health: "bg-green-500/15 text-green-400",
  finance: "bg-blue-500/15 text-blue-400",
  content: "bg-pink-500/15 text-pink-400",
  default: "bg-zinc-500/15 text-zinc-400",
};

export const HABIT_ICON: Record<string, string> = {
  wake: "⏰", exercise: "💪", workout: "💪", business: "💼", order: "📋", shutdown: "🌙",
  journal: "📝", walk: "🚶", nasal: "👃", nasal_breathing: "👃", water: "💧", water_intake: "💧",
  adderall: "💊", read: "📖", meditate: "🧘", cold_shower: "🥶", prayer: "🤲",
  estimate_followup: "📊", instagram_post: "📸", sleep_before_midnight: "😴",
  morning_routine: "☀️", content_creation: "✍️", no_impulse_purchase: "🚫",
  spanish_practice: "🇪🇸", daily_command: "⚡",
};

export const HABIT_LABEL: Record<string, string> = {
  wake: "Wake Up", exercise: "Workout", workout: "Workout", business: "Biz Block",
  order: "Daily Order", shutdown: "Shutdown", journal: "Journal", walk: "Walk",
  nasal: "Breathe", nasal_breathing: "Nasal", water: "Water", water_intake: "Water",
  adderall: "Meds", read: "Read", meditate: "Meditate", cold_shower: "Cold Shower",
  prayer: "Prayer", estimate_followup: "Estimates", instagram_post: "Instagram",
  sleep_before_midnight: "Sleep Early", morning_routine: "AM Routine",
  content_creation: "Content", no_impulse_purchase: "No Impulse",
  spanish_practice: "Spanish", daily_command: "Command",
};

// ─── Helpers ───────────────────────────────────────────

export function domainClass(d?: string): string {
  return DOMAIN_COLOR[(d || "").toLowerCase()] ?? DOMAIN_COLOR.default;
}

export function daysSince(s?: string): number {
  if (!s) return 0;
  return Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
}

export function ageLabel(s?: string): string {
  if (!s) return "";
  const d = daysSince(s);
  if (d === 0) return "today";
  if (d === 1) return "1d";
  if (d < 7) return `${d}d`;
  if (d < 30) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

export function isActive(t: Task): boolean {
  return ["INBOX", "READY", "DOING"].includes(t.status);
}

export function isOverdue(t: Task): boolean {
  return !!t.stale || daysSince(t.createdAt) > 7;
}

/**
 * Parse a smart quick-add string like "fix the tire @business /30m".
 * Returns the cleaned title, any domain hint, and any effort hint.
 *
 * Supported tokens:
 *   @domain   — business / personal / health / finance / content
 *   /effort   — 5m / 15m / 30m / 1h / 2h
 *
 * Tokens can appear anywhere in the input and will be stripped from
 * the resulting title. Unknown tokens are left in the title.
 */
export function parseQuickAdd(input: string): {
  title: string;
  domain?: string;
  effort?: string;
} {
  let title = input.trim();
  let domain: string | undefined;
  let effort: string | undefined;

  // Domain token
  const domainMatch = title.match(/(?:^|\s)@(\w+)/i);
  if (domainMatch) {
    const d = domainMatch[1].toLowerCase();
    if (DOMAIN_COLOR[d]) {
      domain = d;
      title = title.replace(domainMatch[0], " ").trim();
    }
  }

  // Effort token
  const effortMatch = title.match(/(?:^|\s)\/(5m|15m|30m|1h|2h\+?)/i);
  if (effortMatch) {
    const e = effortMatch[1].toLowerCase();
    const map: Record<string, string> = {
      "5m": "M5",
      "15m": "M15",
      "30m": "M30",
      "1h": "H1",
      "2h": "H2PLUS",
      "2h+": "H2PLUS",
    };
    if (map[e]) {
      effort = map[e];
      title = title.replace(effortMatch[0], " ").trim();
    }
  }

  // Collapse any double spaces left behind
  title = title.replace(/\s+/g, " ").trim();

  return { title, domain, effort };
}
