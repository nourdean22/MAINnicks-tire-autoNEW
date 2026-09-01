"use client";

/**
 * deck-lanes.tsx — eternal domain queues, told honestly (§10.6).
 *
 * The GENERAL anchors are lanes, not missions: they have counts and an
 * oldest-item age, never a progress bar (a catch-all has no 100% — its
 * own successMetric says so). The shop lane sorts last, is labeled by
 * what it actually is on the personal OS, and links out to the admin
 * where shop operations belong (boundary §3).
 */
import { useState } from "react";
import type { MissionsDeck } from "@/lib/missions/deck";
import { MissionTaskRow } from "@/components/missions/mission-task-row";
import type { Task } from "@/components/actions/shared";

type Props = {
  lanes: MissionsDeck["lanes"];
  tasks: Task[];
};

export function DeckLanes({ lanes, tasks }: Props) {
  const [openLane, setOpenLane] = useState<string | null>(null);

  if (lanes.length === 0) return null;

  return (
    <section aria-labelledby="lanes-heading" className="space-y-1.5">
      <h2
        id="lanes-heading"
        className="px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]"
      >
        lanes
      </h2>
      {lanes.map((lane) => {
        const isOpen = openLane === lane.id;
        const laneTasks = isOpen
          ? tasks.filter(
              (t) =>
                t.missionId === lane.id &&
                t.status !== "DONE" &&
                t.status !== "ARCHIVED" &&
                (t as { loopKind?: string }).loopKind !== "DAILY" &&
                (t as { loopKind?: string }).loopKind !== "WEEKLY",
            )
          : [];
        return (
          <div
            key={lane.id}
            className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)]"
          >
            <div className="flex items-center gap-2 px-3 py-1.5">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenLane(isOpen ? null : lane.id)}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span aria-hidden className="text-[10px] text-[var(--text-tertiary)]">
                  {isOpen ? "▾" : "▸"}
                </span>
                <span className="min-w-0 truncate text-[13px] font-medium text-[var(--text-primary)]">
                  {lane.isShop ? "Shop — needs your judgment" : lane.title}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-tertiary)]">
                  {lane.openCount} open
                  {lane.oldestOpenDays !== null && lane.oldestOpenDays >= 3
                    ? ` · oldest ${lane.oldestOpenDays}d`
                    : ""}
                </span>
              </button>
              {lane.isShop && (
                <a
                  href="https://nickstire.org/admin"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-md border border-[var(--border-default)] px-2.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] min-h-[44px] inline-flex items-center gap-1"
                >
                  shop admin ↗
                </a>
              )}
            </div>
            {isOpen && laneTasks.length > 0 && (
              <div className="border-t border-[var(--border-default)]/60 px-1 pb-1">
                {laneTasks.map((t) => (
                  <MissionTaskRow key={t.id} task={t} />
                ))}
              </div>
            )}
            {isOpen && laneTasks.length === 0 && (
              <p className="border-t border-[var(--border-default)]/60 px-3 py-2 text-[11px] text-[var(--text-tertiary)]">
                Lane is clear.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
