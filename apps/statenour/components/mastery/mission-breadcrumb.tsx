"use client";

/**
 * MissionBreadcrumb · Mastery Layer Stage D · 2026-05-26
 *
 * The shared mission-mode banner. Mount on any page that wants to
 * participate in the unified mission-mode contract · self-fetches
 * via useMissionMode() · renders nothing when not in mission-mode.
 *
 * Pre-Stage D the /tasks page rendered this as an inline JSX block
 * (page.tsx lines ~1267-1284). That code shape is now lifted here
 * verbatim · /tasks just imports + mounts. Other 4 daily-driver
 * pages (/goals, /journal, /brain, /scoreboard) can adopt by adding
 * a single <MissionBreadcrumb /> mount once they thread missionId
 * into their data fetch.
 *
 * Visual contract is BYTE-IDENTICAL to the previous /tasks banner
 * (gold-accent border · uppercase tracking-wider clear chip). Once
 * the mission resolves via trpc, the title replaces the id-prefix.
 */

import { useMissionMode } from "@/hooks/mastery/use-mission-mode";

export function MissionBreadcrumb() {
  const { active, missionId, mission, exit } = useMissionMode();

  if (!active || !missionId) return null;

  // Title fallback strategy:
  //   1. Real mission title when the trpc query resolves
  //   2. id-prefix during the brief loading window (matches the
  //      legacy /tasks inline banner so cold renders look identical)
  const displayTitle = mission?.title ?? missionId.slice(0, 24);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] px-4 py-2.5 text-sm">
      <span className="text-white/80 truncate">
        Filtered ·{" "}
        <span className="font-medium text-[var(--gold)]">
          mission · {displayTitle}
        </span>
        {mission?.openTaskCount != null && (
          <span className="ml-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            · {mission.openTaskCount} open
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={exit}
        aria-label="Clear mission filter"
        className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-white/15 px-3 text-xs uppercase tracking-wider text-white/60 hover:text-white/90 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40"
      >
        clear
      </button>
    </div>
  );
}
