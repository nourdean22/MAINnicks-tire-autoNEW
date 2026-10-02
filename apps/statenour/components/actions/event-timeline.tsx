"use client";

/**
 * EventTimeline — compact history of a task's lifecycle.
 *
 * Apr 26 · F6 of the NOW-mode upgrades. The expanded panel was
 * showing static metadata ("created Nd ago") but the substrate (S1
 * TaskEvent log) is now writing every state change. Surfacing that
 * timeline in the panel turns "this task has been around 21 days"
 * into "created 21d · stale-flagged 14d · reframed 8d · snoozed
 * 3d" — the whole story.
 *
 * Lazy-fetched on expand: the row only fires the GET when the
 * panel opens. Fast (capped 30 events, single indexed query).
 */

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

interface TaskEvent {
  id: string;
  kind: string;
  source: string | null;
  payload: unknown;
  createdAt: string;
}

interface EventTimelineProps {
  taskId: string;
}

const KIND_COLOR: Record<string, string> = {
  created: "bg-fg-tertiary",
  started: "bg-blue-400",
  completed: "bg-emerald-400",
  abandoned: "bg-rose-400",
  reframed: "bg-amber-400",
  priority_changed: "bg-violet-400",
  linked: "bg-sky-400",
  unlinked: "bg-fg-tertiary",
  nudged: "bg-amber-300",
  snoozed: "bg-amber-500",
  stale_flagged: "bg-amber-500",
  revived: "bg-emerald-500",
  killed: "bg-rose-500",
};

const KIND_LABEL: Record<string, string> = {
  created: "created",
  started: "started",
  completed: "completed",
  abandoned: "abandoned",
  reframed: "reframed",
  priority_changed: "priority changed",
  linked: "linked",
  unlinked: "unlinked",
  nudged: "nudged",
  snoozed: "snoozed",
  stale_flagged: "stale flagged",
  revived: "revived",
  killed: "killed",
};

function formatRelative(iso: string | Date): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d`;
  return `${Math.floor(ms / (7 * 86_400_000))}w`;
}

export function EventTimeline({ taskId }: EventTimelineProps) {
  // Lazy-fetched on expand · the row mounts this component only when
  // the panel opens, so the query fires exactly once per expand.
  // React Query keys on { taskId } so each task caches independently.
  const { data, isLoading } = trpc.task.events.useQuery({ taskId });
  const events: TaskEvent[] = (data?.events ?? []) as TaskEvent[];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-fg-tertiary">
        <Loader2 size={9} className="animate-spin" />
        <span>loading history…</span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="text-[11px] text-fg-tertiary italic">
        No events yet. Future state changes will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-[0.12em] text-fg-tertiary font-mono">
        timeline · {events.length}
      </div>
      <ul className="space-y-0.5">
        {events.slice(0, 8).map((e) => {
          const dot = KIND_COLOR[e.kind] || "bg-fg-tertiary";
          const label = KIND_LABEL[e.kind] || e.kind;
          return (
            <li
              key={e.id}
              className="flex items-center gap-1.5 text-[11px]"
              title={e.source ? `${e.kind} · source: ${e.source}` : e.kind}
            >
              <span className={cn("h-1 w-1 rounded-full shrink-0", dot)} />
              <span className="text-fg-tertiary">{label}</span>
              <span className="text-fg-tertiary font-mono ml-auto">
                {formatRelative(e.createdAt)} ago
              </span>
            </li>
          );
        })}
        {events.length > 8 && (
          <li className="text-[11px] text-fg-tertiary font-mono italic">
            + {events.length - 8} earlier
          </li>
        )}
      </ul>
    </div>
  );
}
