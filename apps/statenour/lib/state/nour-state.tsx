"use client";

/**
 * NourStateProvider — Single source of truth for the entire OS.
 *
 * Fetches all critical data ONCE and shares it across every widget.
 * No more duplicate fetches. No more loading waterfalls.
 *
 * Refresh intervals:
 * - Live data: every 60s (revenue, leads, loops, habits)
 * - Intelligence: every 5min (brain health, aging, seasonal)
 * - State detection: every 30s (drift/fire/scattered classification)
 *
 * Every widget reads from context. Zero prop drilling.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { notifyDataChanged, onDataChanged } from "@/lib/events/data-change";

// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice.
// NourStateProvider's `loadAll` fans out across FOUR heterogeneous
// composite endpoints in one Promise.all (/api/health · /api/habits ·
// /api/habits/streaks · /api/command/data) — and the migration's own
// TS2589 firewall rule forbids `Promise.all`-ing multiple tRPC
// `utils.*.fetch()` calls. Only /api/health has a procedure today
// (`system.healthSummary`); the other three are large uncached/cached
// composites with no procedure, and synthesising three more procedures
// for one consumer would explode this slice for no benefit (YAGNI).
// So all five calls drop to a bare `fetch` carrying `credentials:
// "include"` (the only behaviour `authedFetch` added over `fetch` for
// these best-effort, error-swallowing reads) — the same plain-fetch
// carve-out the prior slice made for endpoints with no procedure. The
// `use-authed-fetch` import is gone.

// ── Types ──

interface DailyScore {
  date: string;
  overallScore: number | null;
  energyLevel: number | null;
  focusQuality: number | null;
  disciplineScore: number | null;
  mood: string | null;
  workoutDone: boolean;
  journalDone: boolean;
}

interface Habit {
  key: string;
  label: string;
  icon: string;
  category: string;
  completed: boolean;
}

interface Streak {
  habit_key: string;
  label: string;
  icon: string;
  current_streak: number;
  best_streak: number;
  completion_rate: number;
}

interface UrgentItem {
  type: string;
  message: string;
  action: string;
  priority: "high" | "medium" | "low";
}

interface AgingItem {
  label: string;
  estimatedValue: number;
  ageHours: number;
  urgency: string;
}

export interface NourState {
  // Current state classification
  currentState: "drift" | "on_fire" | "scattered" | "low_energy" | "normal";
  timeOfDay: "morning" | "afternoon" | "evening";
  dayOfWeek: string;
  isWeekend: boolean;

  // Live data
  todayRevenue: number;
  weekRevenue: number;
  pipelineValue: number;
  pipelineDecay: number;
  staleLeads: number;
  pendingCallbacks: number;
  activeCommitments: number;
  overdueCommitments: number;
  todayScore: DailyScore | null;
  habits: Habit[];
  habitsDone: number;
  habitsTotal: number;
  streaks: Streak[];
  driftAlerts: number;

  // Intelligence
  mit: string | null;
  urgentItems: UrgentItem[];
  brainHealth: number;
  memoryCount: number;
  agingItems: AgingItem[];
  agingCritical: number;

  // System
  systemStatus: string;
  bridgeUp: boolean;
  agentOnline: boolean;
  lastRefresh: Date | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  refresh: () => void;
  toggleHabit: (key: string) => void;
}

const DEFAULT_STATE: NourState = {
  currentState: "normal",
  timeOfDay: "morning",
  dayOfWeek: "",
  isWeekend: false,
  todayRevenue: 0,
  weekRevenue: 0,
  pipelineValue: 0,
  pipelineDecay: 0,
  staleLeads: 0,
  pendingCallbacks: 0,
  activeCommitments: 0,
  overdueCommitments: 0,
  todayScore: null,
  habits: [],
  habitsDone: 0,
  habitsTotal: 0,
  streaks: [],
  driftAlerts: 0,
  mit: null,
  urgentItems: [],
  brainHealth: 0,
  memoryCount: 0,
  agingItems: [],
  agingCritical: 0,
  systemStatus: "loading",
  bridgeUp: true,
  agentOnline: true,
  lastRefresh: null,
  isLoading: true,
  error: null,
  refresh: () => {},
  toggleHabit: () => {},
};

const NourContext = createContext<NourState>(DEFAULT_STATE);

export function useNourState(): NourState {
  return useContext(NourContext);
}

// ── Time helpers ──

function getTimeOfDay(): "morning" | "afternoon" | "evening" {
  const hour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10
  );
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function getDayInfo() {
  const now = new Date();
  const dayName = now.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
  const isWeekend = dayName === "Saturday" || dayName === "Sunday";
  return { dayOfWeek: dayName, isWeekend };
}

function getTodayDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ── State detector ──

function detectState(data: Partial<NourState>): NourState["currentState"] {
  const alerts = data.driftAlerts ?? 0;
  const commitments = data.activeCommitments ?? 0;
  const habitRate = data.habitsTotal ? (data.habitsDone ?? 0) / data.habitsTotal : 0.5;

  // 2026-05-31 · score→reflection re-source. Daily-score logging was
  // retired, so detectState no longer derives energy/discipline from a
  // (now-absent) score — it reads the LIVE signals already in state.
  // (The "low_energy" mode has no honest live proxy without the score, so
  // it stays in the type union but is no longer emitted.)

  // Drift: unresolved drift alerts (the live drift signal)
  if (alerts > 0) return "drift";

  // Scattered: too many active commitments (openLoops retired Apr 18)
  if (commitments > 10) return "scattered";

  // On fire: strong habit completion with a clear board (revived — was
  // gated on the retired score, so it could never fire)
  if (habitRate >= 0.7) return "on_fire";

  return "normal";
}

// ── Provider ──

export function NourStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<NourState, "refresh" | "toggleHabit">>(DEFAULT_STATE);

  const loadAll = useCallback(async () => {
    const todayStr = getTodayDate();
    const timeOfDay = getTimeOfDay();
    const { dayOfWeek, isWeekend } = getDayInfo();

    try {
      // Parallel fetch ALL data sources (business revenue-aging
      // removed Apr 17 — shop data lives in nickstire)
      const [healthRaw, habitsRaw, streaksRaw, commandRaw] = await Promise.all([
        fetch("/api/health", { credentials: "include" }).then((r): Promise<unknown> | null => r.ok ? r.json() : null).catch((): null => null),
        fetch(`/api/habits?date=${todayStr}`, { credentials: "include" }).then((r): Promise<unknown> | null => r.ok ? r.json() : null).catch((): null => null),
        fetch("/api/habits/streaks", { credentials: "include" }).then((r): Promise<unknown> | null => r.ok ? r.json() : null).catch((): null => null),
        fetch("/api/command/data", { credentials: "include" }).then((r): Promise<unknown> | null => r.ok ? r.json() : null).catch((): null => null),
      ]);
      const agingRaw = null;

      // API responses are inconsistently wrapped — unwrap if present.
      // The shapes are inherently dynamic (different endpoints return
      // different structures) so we use `any` here deliberately rather
      // than typing each endpoint's response.
       
      const unwrap = (x: unknown): any => {
        if (!x || typeof x !== "object") return null;
         
        const o = x as any;
        return o.data ?? o;
      };
      const health = unwrap(healthRaw);
      const habitsData = unwrap(habitsRaw);
      const streaksData = unwrap(streaksRaw);
      const cmd = unwrap(commandRaw);
      const aging = unwrap(agingRaw);

      const habits = habitsData?.habits ?? [];
      const habitsDone = habits.filter((h: Habit) => h.completed).length;
      const habitsTotal = habits.length;

      const todayScore = health?.scores ? {
        date: health.scores.last_date,
        overallScore: health.scores.overall,
        energyLevel: health.scores.energy ?? null,
        focusQuality: health.scores.focus ?? null,
        disciplineScore: health.scores.discipline ?? null,
        mood: health.scores.mood ?? null,
        workoutDone: false,
        journalDone: false,
      } as DailyScore : null;

      const newState = {
        timeOfDay,
        dayOfWeek,
        isWeekend,
        todayRevenue: cmd?.shop?.todayRevenue ?? 0,
        weekRevenue: cmd?.shop?.weekRevenue ?? 0,
        pipelineValue: aging?.rawPipelineValue ?? 0,
        pipelineDecay: aging?.decayRate ?? 0,
        staleLeads: cmd?.brief?.staleLeads ?? 0,
        pendingCallbacks: cmd?.brief?.pendingCallbacks ?? 0,
        activeCommitments: health?.commitments?.active ?? 0,
        overdueCommitments: cmd?.brief?.overdueCommitments ?? 0,
        todayScore,
        habits,
        habitsDone,
        habitsTotal,
        streaks: streaksData?.streaks ?? [],
        // truth-substrate audit #4-6: alerts is now a MetricResult — read
        // .value.unresolved (undefined when the read was unavailable → 0 here).
        driftAlerts: health?.alerts?.value?.unresolved ?? 0,
        mit: cmd?.brief?.topTasks?.[0]?.title ?? null,
        urgentItems: cmd?.urgentItems ?? [],
        brainHealth: cmd?.brain?.healthScore ?? 0,
        memoryCount: cmd?.brain?.memoryCount ?? 0,
        agingItems: aging?.agingItems?.slice(0, 5) ?? [],
        agingCritical: aging?.criticalCount ?? 0,
        systemStatus: health?.status ?? "unknown",
        bridgeUp: cmd?.system?.bridgeConnected !== false, // default healthy
        agentOnline: cmd?.system?.agentOnline !== false || cmd?.system?.agentRecent === true,
        lastRefresh: new Date(),
        isLoading: false,
        error: null as string | null,
        currentState: "normal" as const,
      };

      const detectedState = detectState(newState);

      setState({ ...newState, currentState: detectedState });
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load",
        lastRefresh: new Date(),
      }));
    }
  }, []);

  // Initial load
  useEffect(() => { loadAll(); }, [loadAll]);

  // Cross-surface event bus — any chat tool, task action, or MIT
  // commit anywhere in the app fires nour:data-changed and we reload.
  // This is the instant-feedback path; the 60s interval below is the
  // fallback safety net.
  useEffect(() => {
    return onDataChanged(["any"], () => {
      loadAll();
    });
  }, [loadAll]);

  // Legacy 'nour-refresh' event — dispatched by the 'g then r'
  // keyboard shortcut in components/hud/keyboard-shortcuts.tsx. The
  // original listener lives on the retired /command/page-legacy,
  // so we adopt it here and re-broadcast as a global any-domain
  // data-change so HQ, /tasks, and every other bus listener refresh.
  useEffect(() => {
    function onRefresh() {
      loadAll();
      notifyDataChanged("any", { source: "nour-refresh-shortcut" });
    }
    window.addEventListener("nour-refresh", onRefresh);
    return () => window.removeEventListener("nour-refresh", onRefresh);
  }, [loadAll]);

  // Auto-refresh: live data every 60s
  useEffect(() => {
    const interval = setInterval(loadAll, 60000);
    return () => clearInterval(interval);
  }, [loadAll]);

  // Habit toggle
  const toggleHabit = useCallback(async (key: string) => {
    const todayStr = getTodayDate();
    const habit = state.habits.find(h => h.key === key);
    if (!habit) return;

    const newCompleted = !habit.completed;

    // Optimistic update
    setState(prev => ({
      ...prev,
      habits: prev.habits.map(h => h.key === key ? { ...h, completed: newCompleted } : h),
      habitsDone: prev.habitsDone + (newCompleted ? 1 : -1),
    }));

    // Persist
    await fetch("/api/habits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ date: todayStr, habitKey: key, completed: newCompleted }),
    }).catch(() => {
      // Revert on failure
      setState(prev => ({
        ...prev,
        habits: prev.habits.map(h => h.key === key ? { ...h, completed: !newCompleted } : h),
        habitsDone: prev.habitsDone + (newCompleted ? -1 : 1),
      }));
    });
  }, [state.habits]);

  const value = useMemo<NourState>(() => ({
    ...state,
    refresh: loadAll,
    toggleHabit,
  }), [state, loadAll, toggleHabit]);

  return <NourContext.Provider value={value}>{children}</NourContext.Provider>;
}
