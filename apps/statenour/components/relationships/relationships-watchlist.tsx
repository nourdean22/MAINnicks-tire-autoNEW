"use client";

/**
 * RelationshipsWatchlist · Wave AB Phase 1A · 2026-05-28.
 *
 * The "needs attention right now" feed. Cross-cuts:
 *   · promise broken · KEPT_WORD BrainMemory rows with status="broken"
 *   · stale 90d · PersonProfile.lastInteraction > 90 days
 *   · power imbalance · RelationshipLedger trailing-30d net-positive
 *     for them, net-negative for operator
 *   · birthday in 2 weeks
 *
 * Sorted by urgency · taps deep-link to the dossier.
 *
 * UI v3 W4 (2026-10-17): this is the page's attention list, rendered first under the verdict as
 * ruled rows with the reason in words (not a colored chip alone). It now takes the READ STATE, so
 * a failed read says so and offers Retry instead of rendering nothing, which is what an empty
 * list also did (skill empty-vs-error). Pinned by tests/components/people-attention-first.test.tsx.
 *
 * Pure UI · the parent fetches /api/relationships/watchlist and passes the items and state in.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

export type WatchlistKind =
  | "promise_broken"
  | "stale_90d"
  | "power_imbalance"
  | "birthday_2w";

export interface WatchlistItem {
  kind: WatchlistKind;
  personId: string;
  personName: string;
  summary: string;
  /** Optional sort-rank · 0 = most urgent · driven by the endpoint. */
  rank?: number;
}

/** What the parent's read returned: in flight, failed, or answered (an empty answer is a real zero). */
export type WatchlistReadState = "loading" | "error" | "ok";

interface WatchlistProps {
  items: WatchlistItem[];
  state: WatchlistReadState;
  onRetry: () => void;
  /** Deep-link template · {personId} replaced. Defaults to the
   *  relationships page anchor scroll target the dossier listens to. */
  hrefTemplate?: string;
  onSelect?: (personId: string) => void;
}

/** The reason as a word first; the tone only repeats it. */
const KIND_META: Record<WatchlistKind, { word: string; tone: string }> = {
  promise_broken: { word: "Promise broken", tone: "text-rose-300" },
  stale_90d: { word: "No contact in 90 days", tone: "text-amber-300" },
  power_imbalance: { word: "Imbalance", tone: "text-violet-300" },
  birthday_2w: { word: "Birthday soon", tone: "text-emerald-300" },
};

export function RelationshipsWatchlist({
  items,
  state,
  onRetry,
  hrefTemplate = "/people#person-{personId}",
  onSelect,
}: WatchlistProps) {
  const sorted = [...items].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const showList = sorted.length > 0 && state !== "error";

  return (
    <section aria-labelledby="watchlist-heading" className="space-y-2">
      <h3 id="watchlist-heading" className="text-[13px] font-medium text-fg-secondary">
        Who needs you now
        {showList && <span className="ml-2 font-mono text-[12px] tabular-nums text-fg-tertiary">{sorted.length}</span>}
      </h3>

      {state === "loading" && sorted.length === 0 && (
        <p role="status" className="text-[14px] text-fg-tertiary">
          Reading who needs you.
        </p>
      )}

      {state === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-edge py-2">
          <p className="text-[14px] text-fg-secondary">
            Couldn&apos;t load who needs you: state unknown, not an empty list.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-fg underline-offset-4 transition-colors duration-[var(--motion-state)] hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {state === "ok" && sorted.length === 0 && (
        <p className="text-[14px] text-fg-tertiary">No one needs you right now.</p>
      )}

      {showList && (
        <ul className="divide-y divide-edge border-y border-edge">
          {sorted.map((item) => {
            const meta = KIND_META[item.kind];
            const href = hrefTemplate.replace("{personId}", item.personId);
            return (
              <li key={`${item.kind}:${item.personId}`}>
                <Link
                  href={href}
                  onClick={() => onSelect?.(item.personId)}
                  className="flex min-h-[44px] flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 transition-colors duration-[var(--motion-state)] hover:bg-surface-hover"
                >
                  <span data-person className="text-[15px] font-medium text-fg">
                    {item.personName}
                  </span>
                  <span className={cn("font-mono text-[12px]", meta.tone)}>{meta.word}</span>
                  <span className="min-w-0 basis-full truncate text-[13px] text-fg-tertiary sm:basis-auto sm:flex-1">
                    {item.summary}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
