"use client";

/**
 * TopMissionToday · Wave AO · 2026-05-28.
 *
 * Sam-Altman frame for /missions · the one mission that should
 * compound most today. Mirrors TopGoalToday's contract on /goals ·
 * pinned above MissionFeed · self-hides when nothing qualifies.
 *
 * Selection rules · deterministic, no AI · operator-grade triage ·
 *   1. only ACTIVE missions
 *   2. skip 100% done (all open tasks closed)
 *   3. prefer missions with a DOING task first (in-flight beats idle)
 *   4. then by deadline-urgency · imminent first · null = least urgent
 *   5. then by open task count DESC (more activity = more momentum)
 *
 * The 3 honest numbers Sam would put on a whiteboard ·
 *   · OPEN TASKS    · how many things are not done
 *   · DEADLINE      · days away · or "—" when unset
 *   · IN FLIGHT     · DOING task count · the "what are you working on?"
 *
 * CTA · "next 60 min" 1-tap to the mission's task list (uses the
 * existing #task-<id> anchor MissionFeed already applies).
 *
 * Read-only · derives entirely from the Project[] + Task[] the page
 * already fetched · zero new network or token cost.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project, Task } from "@/components/actions/shared";

interface TopMissionTodayProps {
  missions: Project[];
  tasks: Task[];
}

interface Pick {
  mission: Project;
  openTasks: number;
  doingTasks: number;
  doneTasks: number;
  daysToDeadline: number | null;
}

const DAY_MS = 86_400_000;

function buildPicks(missions: Project[], tasks: Task[]): Pick[] {
  return missions
    .filter((m) => m.status === "ACTIVE")
    .map((m) => {
      const tasksForMission = tasks.filter((t) => t.missionId === m.id);
      const open = tasksForMission.filter((t) => t.status !== "DONE");
      const doing = open.filter((t) => t.status === "DOING");
      const done = tasksForMission.filter((t) => t.status === "DONE");
      const days = m.deadline
        ? Math.round(
            (new Date(m.deadline).getTime() - Date.now()) / DAY_MS,
          )
        : null;
      return {
        mission: m,
        openTasks: open.length,
        doingTasks: doing.length,
        doneTasks: done.length,
        daysToDeadline: days,
      };
    })
    .filter((p) => p.openTasks > 0); // skip empty + fully-complete
}

function pickTopMission(picks: Pick[]): Pick | null {
  if (picks.length === 0) return null;
  // Sort: DOING tasks first, then deadline urgency, then open count desc.
  const sorted = [...picks].sort((a, b) => {
    if (a.doingTasks > 0 && b.doingTasks === 0) return -1;
    if (b.doingTasks > 0 && a.doingTasks === 0) return 1;
    const aD = a.daysToDeadline ?? 99_999;
    const bD = b.daysToDeadline ?? 99_999;
    if (aD !== bD) return aD - bD;
    return b.openTasks - a.openTasks;
  });
  return sorted[0] ?? null;
}

export function TopMissionToday({ missions, tasks }: TopMissionTodayProps) {
  const picks = useMemo(() => buildPicks(missions, tasks), [missions, tasks]);
  const pick = useMemo(() => pickTopMission(picks), [picks]);
  if (!pick) return null;

  const { mission, openTasks, doingTasks, doneTasks, daysToDeadline } = pick;
  const totalTasks = openTasks + doneTasks;
  const progress =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const deadlineLabel =
    daysToDeadline === null
      ? "—"
      : daysToDeadline < 0
        ? `${Math.abs(daysToDeadline)}d late`
        : daysToDeadline === 0
          ? "today"
          : daysToDeadline === 1
            ? "tomorrow"
            : `${daysToDeadline}d`;
  const deadlineTint =
    daysToDeadline === null
      ? "text-[var(--text-tertiary)]"
      : daysToDeadline < 0
        ? "text-rose-300"
        : daysToDeadline <= 3
          ? "text-amber-300"
          : "text-[var(--gold)]";

  return (
    <section
      aria-label="top mission today"
      className="rounded-2xl border border-[var(--gold)]/35 bg-[var(--gold)]/[0.04] p-4 shadow-[0_0_28px_rgba(253,185,19,0.04)] sm:p-5"
    >
      <div className="mb-2 flex items-center gap-2">
        <Flag size={11} className="text-[var(--gold)]" strokeWidth={2} />
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          the mission for right now
        </p>
        {doingTasks > 0 && (
          <>
            <span className="text-[var(--text-tertiary)]/40">·</span>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-300">
              {doingTasks} in flight
            </span>
          </>
        )}
      </div>

      <h2 className="text-[18px] font-semibold text-[var(--text-primary)] leading-tight">
        {mission.title}
      </h2>
      {mission.description && (
        <p className="mt-1 text-[12px] italic text-[var(--text-secondary)] leading-snug line-clamp-2">
          {mission.description}
        </p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
        <Stat
          label="open"
          value={String(openTasks)}
          sub={`${doneTasks} done · ${progress}%`}
          tint="text-[var(--text-primary)]"
        />
        <Stat
          label="in flight"
          value={String(doingTasks)}
          sub={doingTasks > 0 ? "currently DOING" : "none started"}
          tint={doingTasks > 0 ? "text-amber-300" : "text-[var(--text-tertiary)]"}
        />
        <Stat
          label="deadline"
          value={deadlineLabel}
          sub={
            mission.deadline ? `by ${mission.deadline.slice(0, 10)}` : "no date"
          }
          tint={deadlineTint}
        />
      </div>

      {/* Progress bar · open vs done */}
      <div className="mt-3">
        <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--bg-raised)]/60">
          <div
            className="absolute top-0 bottom-0 bg-[var(--gold)] transition-[width] duration-500"
            style={{ left: 0, width: `${progress}%` }}
            aria-label={`${progress}% complete`}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-[var(--text-tertiary)] leading-snug">
          {doingTasks > 0
            ? `${doingTasks} ${doingTasks === 1 ? "task" : "tasks"} in flight · ship one`
            : `${openTasks} ready · start one`}
        </p>
        <Link
          href={`#mission-${mission.id}`}
          className={cn(
            "inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 sm:w-auto",
            "text-[12px] font-medium uppercase tracking-[0.12em]",
            "bg-[var(--gold)]/15 text-[var(--gold)] hover:bg-[var(--gold)]/25",
            "border border-[var(--gold)]/30",
            "active:scale-95 transition-all",
          )}
          aria-label={`Start the next 60 minutes in ${mission.title}`}
        >
          next 60 min
          <ArrowRight size={12} strokeWidth={2} />
        </Link>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tint,
}: {
  label: string;
  value: string;
  sub?: string;
  tint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className={cn("text-[20px] font-bold tabular-nums", tint ?? "text-[var(--text-primary)]")}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] font-mono text-[var(--text-tertiary)]">
          {sub}
        </div>
      )}
    </div>
  );
}
