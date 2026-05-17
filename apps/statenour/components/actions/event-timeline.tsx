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

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface TaskEvent {
  id: string;
  kind: string;
  source: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

interface EventTimelineProps {
  taskId: string;
}

const KIND_COLOR: Record<string, string> = {
  created: "bg-zinc-500",
  started: "bg-blue-400",
  completed: "bg-emerald-400",
  abandoned: "bg-rose-400",
  reframed: "bg-amber-400",
  priority_changed: "bg-violet-400",
  linked: "bg-sky-400",
  unlinked: "bg-zinc-500",
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

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d`;
  return `${Math.floor(ms / (7 * 86_400_000))}w`;
}

export function EventTimeline({ taskId }: EventTimelineProps) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await authedFetch(`/api/tasks/${taskId}/events`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list: TaskEvent[] = data?.data ?? data ?? [];
        if (!cancelled) setEvents(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[9px] text-zinc-600">
        <Loader2 size={9} className="animate-spin" />
        <span>loading history…</span>
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <p className="text-[9px] text-zinc-700 italic">
        No events yet. Future state changes will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[8px] uppercase tracking-wider text-zinc-700 font-mono">
        timeline · {events.length}
      </div>
      <ul className="space-y-0.5">
        {events.slice(0, 8).map((e) => {
          const dot = KIND_COLOR[e.kind] || "bg-zinc-500";
          const label = KIND_LABEL[e.kind] || e.kind;
          return (
            <li
              key={e.id}
              className="flex items-center gap-1.5 text-[9px]"
              title={e.source ? `${e.kind} · source: ${e.source}` : e.kind}
            >
              <span className={cn("h-1 w-1 rounded-full shrink-0", dot)} />
              <span className="text-zinc-500">{label}</span>
              <span className="text-zinc-700 font-mono ml-auto">
                {formatRelative(e.createdAt)} ago
              </span>
            </li>
          );
        })}
        {events.length > 8 && (
          <li className="text-[8px] text-zinc-700 font-mono italic">
            + {events.length - 8} earlier
          </li>
        )}
      </ul>
    </div>
  );
}
