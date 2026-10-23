"use client";

/**
 * Stats verdict line and the page's one state block (UI v3 W4, 2026-10-17; PLAN W4 "Stats 3 tabs +
 * verdict line", audit item 5).
 *
 * The verdict is one sentence computed from the character sheet (`operator.characterSheet`): the
 * total level and this week's top riser, or that nothing moved, or that the week could not be read
 * (`rising7dUnknown`, fix round 1). It sits above the tabs, so it reads the character sheet on
 * EVERY tab; on Mastery it shares the query key with CharacterSheet and LevelUpDirectiveCard, which
 * dedupes that one request, and on Goals and Body and learning it is an extra read. It never
 * invents a number: loading, a failed read and a real zero each render through StatsStateBlock in
 * words, the failure with a 44 px Retry. The lazy sections use the same block while their code
 * loads. Pinned by tests/components/stats-three-tabs-verdict.test.tsx.
 */

import { offlineCopy, readState } from "@/lib/query-state";
import { trpc } from "@/lib/trpc/client";

/** The fields of lib/mastery/character-sheet.ts StatLevel the verdict reads. */
export interface VerdictStat {
  label: string;
  shortLabel?: string;
  level: number;
  rising7dXp: number;
  /** The weekly read failed (lib/mastery/character-sheet.ts): no weekly claim may be made. */
  rising7dUnknown?: boolean;
}

/** A sub-1 gain keeps one decimal (+0.3 XP), so a real gain never prints as +0. */
const formatXp = (xp: number) => (xp >= 1 ? String(Math.round(xp)) : xp.toFixed(1));

export function statsVerdict(stats: VerdictStat[]): string {
  const total = stats.reduce((sum, s) => sum + s.level, 0);
  const riser = stats.reduce<VerdictStat | null>((best, s) => (s.rising7dXp > (best?.rising7dXp ?? 0) ? s : best), null);
  const head = `Total level ${total} across ${stats.length} ${stats.length === 1 ? "stat" : "stats"}.`;
  if (stats.some((s) => s.rising7dUnknown)) return `${head} This week's XP couldn't be read.`;
  if (!riser) return `${head} Nothing gained XP this week.`;
  return `${head} ${riser.shortLabel || riser.label} gained the most this week, +${formatXp(riser.rising7dXp)} XP.`;
}

export type StatsBlockState = "loading" | "error" | "empty" | "offline";

/** The page's one state block: says which state it is in words; a failure offers Retry. */
export function StatsStateBlock({ state, message, onRetry }: { state: StatsBlockState; message: string; onRetry?: () => void }) {
  return (
    <div
      data-state-block={state}
      role={state === "error" ? "alert" : "status"}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-fg-tertiary"
    >
      <p className={state === "error" ? "text-fg-secondary" : undefined}>{message}</p>
      {state === "error" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center font-medium text-fg underline-offset-4 transition-colors duration-[var(--motion-state)] hover:underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function StatsVerdict() {
  const query = trpc.operator.characterSheet.useQuery(undefined, { staleTime: 60_000 });
  const stats = (query.data as VerdictStat[] | undefined) ?? null;

  if (query.error) {
    return (
      <StatsStateBlock
        state="error"
        message="Couldn't read your stats: state unknown, not zero."
        onRetry={() => void query.refetch()}
      />
    );
  }
  // Paused with no data has no error and is not loading: say so (truth sweep 2026-10-23).
  if (readState(query) === "offline") return <StatsStateBlock state="offline" message={offlineCopy("Your stats")} />;
  if (query.isLoading || stats === null) return <StatsStateBlock state="loading" message="Reading your stats." />;
  if (stats.length === 0) {
    return <StatsStateBlock state="empty" message="No stats recorded yet. Log a workout, a weight entry or a mission task." />;
  }
  return (
    <p data-stats-verdict className="max-w-[36ch] text-[17px] font-medium leading-snug text-fg sm:text-[19px]">
      {statsVerdict(stats)}
    </p>
  );
}
