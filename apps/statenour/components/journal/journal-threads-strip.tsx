"use client";

/**
 * JournalThreadsStrip · Wave AP · 2026-05-28.
 *
 * The 1-glance triage strip for /journal · same Sam-pattern that
 * worked on /goals (GoalsHealthStrip) and /missions
 * (MissionsHealthStrip). One chip per JournalThread · color-coded by
 * how recently the operator wrote into it.
 *
 *   · emerald · alive    (last joined within 7 days · momentum)
 *   · amber   · cooling  (7-14 days · still active but slowing)
 *   · rose    · stalled  (>14 days · operator hasn't written here)
 *   · muted   · dormant  (status="dormant" · auto-archived by cron)
 *
 * Eyebrow count summary makes triage operator-grade: "N stalled · M
 * cooling · K alive." Hover tooltip surfaces full thread name +
 * member count + last write date. Chips are PASSIVE in v1 (no row
 * anchor in the ThreadRail yet · Phase 4 add).
 *
 * Sam-Altman frame · "what threads have you ABANDONED?" The stalled
 * row is the honest reckoning · journals only compound if you keep
 * writing in the same threads.
 *
 * Read-only · derives entirely from trpc.journal.threads · no new
 * network call beyond what ThreadRail already triggers.
 */

import { useMemo } from "react";
import { NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

type Pace = "alive" | "cooling" | "stalled" | "dormant";

interface ChipData {
  id: string;
  name: string;
  pace: Pace;
  memberCount: number;
  daysSinceLastJoin: number | null;
}

const DAY_MS = 86_400_000;

function classifyPace(
  status: string,
  lastJoinAt: string | Date | null,
): Pace {
  if (status === "dormant") return "dormant";
  if (!lastJoinAt) return "stalled";
  const ts =
    lastJoinAt instanceof Date
      ? lastJoinAt.getTime()
      : new Date(lastJoinAt).getTime();
  const days = (Date.now() - ts) / DAY_MS;
  if (days <= 7) return "alive";
  if (days <= 14) return "cooling";
  return "stalled";
}

const PACE_STYLE: Record<Pace, { dot: string; ring: string; label: string }> = {
  alive: {
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/30",
    label: "active",
  },
  cooling: {
    dot: "bg-amber-400",
    ring: "ring-amber-400/40",
    label: "slowing",
  },
  stalled: {
    dot: "bg-rose-500",
    ring: "ring-rose-500/40",
    label: "stalled",
  },
  dormant: {
    dot: "bg-edge-strong",
    ring: "ring-edge-default",
    label: "dormant",
  },
};

export function JournalThreadsStrip() {
  const threadsQuery = trpc.journal.threads.useQuery(
    { includeDormant: true },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );

  const chips = useMemo<ChipData[]>(() => {
    const threads = threadsQuery.data ?? [];
    return threads
      .map((t: {
        id: string;
        name: string;
        status: string;
        memberCount: number;
        lastJoinAt: string | Date | null;
      }) => {
        const days = t.lastJoinAt
          ? Math.floor(
              (Date.now() -
                (t.lastJoinAt instanceof Date
                  ? t.lastJoinAt.getTime()
                  : new Date(t.lastJoinAt).getTime())) /
                DAY_MS,
            )
          : null;
        return {
          id: t.id,
          name: t.name,
          pace: classifyPace(t.status, t.lastJoinAt),
          memberCount: t.memberCount,
          daysSinceLastJoin: days,
        };
      });
  }, [threadsQuery.data]);

  if (chips.length === 0) return null;

  const counts = {
    alive: chips.filter((c) => c.pace === "alive").length,
    cooling: chips.filter((c) => c.pace === "cooling").length,
    stalled: chips.filter((c) => c.pace === "stalled").length,
    dormant: chips.filter((c) => c.pace === "dormant").length,
  };

  return (
    <section
      aria-label="journal threads strip"
      className="rounded-surface border border-edge-subtle bg-content px-4 py-3"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <NotebookPen
          size={11}
          className="text-fg-tertiary"
          strokeWidth={1.75}
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          threads · {chips.length}
        </span>
        <span className="text-fg-tertiary/30">·</span>
        {counts.stalled > 0 && (
          <span className="text-[11px] font-mono text-rose-300">
            {counts.stalled} stalled
          </span>
        )}
        {counts.cooling > 0 && (
          <span className="text-[11px] font-mono text-amber-300">
            {counts.cooling} cooling
          </span>
        )}
        {counts.alive > 0 && (
          <span className="text-[11px] font-mono text-emerald-300">
            {counts.alive} alive
          </span>
        )}
        {counts.dormant > 0 && (
          <span className="text-[11px] font-mono text-fg-tertiary">
            {counts.dormant} dormant
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const style = PACE_STYLE[c.pace];
          const subtitle =
            c.daysSinceLastJoin !== null
              ? `${c.daysSinceLastJoin}d since last write`
              : style.label;
          return (
            <span
              key={c.id}
              title={`${c.name} · ${c.memberCount} entries · ${subtitle}`}
              className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-micro bg-surface-interactive"
              aria-label={`${c.name}: ${c.memberCount} entries, ${subtitle}`}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full ring-2 ring-offset-1 ring-offset-content shrink-0",
                  style.dot,
                  style.ring,
                )}
                aria-hidden
              />
              <span className="text-[11px] font-mono text-fg-tertiary truncate max-w-[140px]">
                {c.name}
              </span>
            </span>
          );
        })}
      </div>
    </section>
  );
}
