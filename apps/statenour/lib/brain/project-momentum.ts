/**
 * Project Momentum — cross-page bridge from PLAN to NOW.
 *
 * Apr 26 · P1+P2. Each project (Mission) gets:
 *
 *   · momentum  — warm/steady/stale/cold/dead based on the freshest
 *                 lastTouchedAt across its tasks. Visible at a glance
 *                 on the project row.
 *   · doing     — the task currently in NOW's DOING state, if any.
 *                 Lets the project surface "1 task in flight right
 *                 now" without leaving the PLAN tab.
 *   · lastMove  — the most recent DONE/started action across the
 *                 project's tasks. The "↳ completed X · 2d ago"
 *                 ticker line.
 *   · drift     — pure-signal flag when the project has tasks but
 *                 zero touches in 14d. Drives a future "re-plan?"
 *                 nudge.
 *
 * Pure compute on tasks already loaded by the page; no extra DB
 * round-trip. Caller passes the same task array the LoopStream
 * uses, so PLAN and NOW agree on state without polling.
 */

import type { Task } from "@/components/actions/shared";

export type Momentum = "warm" | "steady" | "stale" | "cold" | "dead";

export interface ProjectMomentum {
  momentum: Momentum;
  /** Hours since the most recent task touch. Infinity if no tasks. */
  freshestTouchHrs: number;
  /** The task currently in DOING (NOW state), if any. */
  doingTask: Task | null;
  /** The most recent meaningful action — completion or start. */
  lastMove: {
    kind: "completed" | "started" | "created";
    title: string;
    when: string; // ISO
    hrsAgo: number;
  } | null;
  /** True when project has tasks but zero touches in 14d. */
  drifting: boolean;
  openCount: number;
  doneCount: number;
  totalCount: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Classify by freshest task touch:
 *   warm   <  3h
 *   steady <  3d
 *   stale  <  7d
 *   cold   < 14d
 *   dead   >= 14d
 */
function classifyMomentum(hrs: number): Momentum {
  if (hrs < 3) return "warm";
  if (hrs < 72) return "steady";
  if (hrs < 168) return "stale";
  if (hrs < 336) return "cold";
  return "dead";
}

export function computeProjectMomentum(
  projectId: string,
  tasks: Task[],
): ProjectMomentum {
  const projectTasks = tasks.filter((t) => t.missionId === projectId);
  const open = projectTasks.filter((t) =>
    ["INBOX", "READY", "DOING"].includes(t.status),
  );
  const done = projectTasks.filter((t) => t.status === "DONE");

  // Freshest touch across ALL project tasks (not just active) —
  // a recent completion still counts as momentum.
  let freshestMs = 0;
  for (const t of projectTasks) {
    const ms = new Date(t.lastTouchedAt || t.updatedAt || t.createdAt || 0).getTime();
    if (ms > freshestMs) freshestMs = ms;
  }
  const now = Date.now();
  const freshestTouchHrs = freshestMs > 0 ? (now - freshestMs) / HOUR_MS : Infinity;

  // DOING task — the bridge to NOW. Project surfaces "1 in flight"
  // when NOW has it active. Single project = single DOING in v1.
  const doingTask = projectTasks.find((t) => t.status === "DOING") ?? null;

  // Last move: prefer the most recent COMPLETION over start over create
  // since "completed X" is the most actionable ticker line.
  let lastMove: ProjectMomentum["lastMove"] = null;
  const allByRecency = [...projectTasks].sort(
    (a, b) =>
      new Date(b.lastTouchedAt || b.updatedAt || b.createdAt || 0).getTime() -
      new Date(a.lastTouchedAt || a.updatedAt || a.createdAt || 0).getTime(),
  );
  const recentDone = allByRecency.find((t) => t.status === "DONE");
  const recentStarted = allByRecency.find(
    (t) => t.status === "DOING" && t.startedAt,
  );
  const top = allByRecency[0];

  if (recentDone) {
    const when = recentDone.lastTouchedAt || recentDone.updatedAt || "";
    const hrsAgo = when ? (now - new Date(when).getTime()) / HOUR_MS : 0;
    lastMove = { kind: "completed", title: recentDone.title, when, hrsAgo };
  } else if (recentStarted?.startedAt) {
    const when = recentStarted.startedAt;
    const hrsAgo = (now - new Date(when).getTime()) / HOUR_MS;
    lastMove = { kind: "started", title: recentStarted.title, when, hrsAgo };
  } else if (top) {
    const when = top.createdAt || "";
    const hrsAgo = when ? (now - new Date(when).getTime()) / HOUR_MS : 0;
    lastMove = { kind: "created", title: top.title, when, hrsAgo };
  }

  const drifting =
    projectTasks.length > 0 &&
    open.length > 0 &&
    freshestTouchHrs > 14 * 24;

  return {
    momentum: projectTasks.length === 0 ? "dead" : classifyMomentum(freshestTouchHrs),
    freshestTouchHrs,
    doingTask,
    lastMove,
    drifting,
    openCount: open.length,
    doneCount: done.length,
    totalCount: projectTasks.length,
  };
}

/**
 * Render helper for the ticker line. Returns null when there's nothing
 * meaningful to say (project has no tasks at all).
 */
export function tickerLine(m: ProjectMomentum): string | null {
  if (!m.lastMove) {
    return m.totalCount === 0 ? "no tasks yet — plan it" : null;
  }
  const ago = formatRelative(m.lastMove.hrsAgo);
  const verb =
    m.lastMove.kind === "completed"
      ? "completed"
      : m.lastMove.kind === "started"
        ? "started"
        : "added";
  return `${verb} "${m.lastMove.title.slice(0, 44)}${m.lastMove.title.length > 44 ? "…" : ""}" · ${ago}`;
}

function formatRelative(hrs: number): string {
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  if (hrs < 24 * 7) return `${Math.round(hrs / 24)}d ago`;
  if (hrs < 24 * 30) return `${Math.round(hrs / 24 / 7)}w ago`;
  return `${Math.round(hrs / 24 / 30)}mo ago`;
}

export function momentumLabel(m: Momentum): string {
  switch (m) {
    case "warm":
      return "warm";
    case "steady":
      return "steady";
    case "stale":
      return "stale";
    case "cold":
      return "cold";
    case "dead":
      return "dead";
  }
}

export function momentumTone(m: Momentum): {
  border: string;
  bg: string;
  text: string;
  pulse: boolean;
} {
  switch (m) {
    case "warm":
      return {
        border: "border-emerald-500/40",
        bg: "bg-emerald-500/10",
        text: "text-emerald-300",
        pulse: true,
      };
    case "steady":
      return {
        border: "border-sky-500/30",
        bg: "bg-sky-500/5",
        text: "text-sky-300",
        pulse: false,
      };
    case "stale":
      return {
        border: "border-amber-500/30",
        bg: "bg-amber-500/5",
        text: "text-amber-300",
        pulse: false,
      };
    case "cold":
      return {
        border: "border-rose-500/30",
        bg: "bg-rose-500/5",
        text: "text-rose-300",
        pulse: false,
      };
    case "dead":
      return {
        border: "border-zinc-700",
        bg: "bg-zinc-800/40",
        text: "text-zinc-500",
        pulse: false,
      };
  }
}
