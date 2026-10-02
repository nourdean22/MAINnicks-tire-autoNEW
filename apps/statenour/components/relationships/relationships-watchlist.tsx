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
 * Single-line items · sorted by urgency · taps deep-link to the
 * dossier (existing collapsed surface · operator can act there).
 *
 * Pure UI · the parent fetches /api/relationships/watchlist and
 * passes the items in.
 */

import { AlertTriangle, Cake, Clock, Scale } from "lucide-react";
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

interface WatchlistProps {
  items: WatchlistItem[];
  /** Deep-link template · {personId} replaced. Defaults to the
   *  relationships page anchor scroll target the dossier listens to. */
  hrefTemplate?: string;
  onSelect?: (personId: string) => void;
}

const KIND_META: Record<
  WatchlistKind,
  { Icon: typeof AlertTriangle; tone: string; label: string }
> = {
  promise_broken: {
    Icon: AlertTriangle,
    tone: "text-rose-300 border-rose-500/30 bg-rose-500/[0.05]",
    label: "promise",
  },
  stale_90d: {
    Icon: Clock,
    tone: "text-amber-300 border-amber-500/30 bg-amber-500/[0.05]",
    label: "stale",
  },
  power_imbalance: {
    Icon: Scale,
    tone: "text-violet-300 border-violet-500/30 bg-violet-500/[0.05]",
    label: "imbalance",
  },
  birthday_2w: {
    Icon: Cake,
    tone: "text-emerald-300 border-emerald-500/30 bg-emerald-500/[0.05]",
    label: "birthday",
  },
};

export function RelationshipsWatchlist({
  items,
  hrefTemplate = "/people#person-{personId}",
  onSelect,
}: WatchlistProps) {
  if (items.length === 0) return null;

  const sorted = [...items].sort(
    (a, b) => (a.rank ?? 999) - (b.rank ?? 999),
  );

  return (
    <section
      aria-label="watchlist"
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)]"
    >
      <header className="px-3 py-2 flex items-center gap-2 border-b border-[var(--border-default)]/60">
        <AlertTriangle
          size={11}
          className="text-amber-400"
          strokeWidth={1.75}
        />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          watchlist
        </h3>
        <span className="text-[11px] font-mono tabular-nums text-fg-tertiary">
          {sorted.length}
        </span>
      </header>
      <ul className="py-1">
        {sorted.map((item) => {
          const meta = KIND_META[item.kind];
          const Icon = meta.Icon;
          const href = hrefTemplate.replace("{personId}", item.personId);
          return (
            <li key={`${item.kind}:${item.personId}`}>
              <Link
                href={href}
                onClick={() => onSelect?.(item.personId)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-[12px] hover:bg-surface-hover transition-colors duration-[var(--motion-state)]",
                )}
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-micro border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] shrink-0",
                    meta.tone,
                  )}
                >
                  <Icon size={9} strokeWidth={1.75} />
                  {meta.label}
                </span>
                <span className="font-medium text-[var(--text-primary)] shrink-0">
                  {item.personName}
                </span>
                <span className="text-[var(--text-tertiary)]/80 truncate">
                  · {item.summary}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
