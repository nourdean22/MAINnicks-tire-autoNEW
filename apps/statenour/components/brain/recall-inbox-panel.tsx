"use client";

/**
 * RecallInboxPanel · Wave W Phase 4 (2026-05-24).
 *
 * One panel that aggregates the 4 "needs your attention" sources
 * the operator currently checks across separate /brain sub-pages:
 *
 *   1. Pinned memories
 *   2. Unreviewed link-review candidates
 *   3. Unresolved contradictions
 *   4. Active alerts (drift · persona · stagnation)
 *
 * Substrate: `lib/services/recall-inbox.ts` builds the merged shape ·
 * `trpc.brain.recallInbox` exposes it. This component is a pure
 * presentation layer · silent-when-empty per Wave V pattern · each
 * source's row group hides when its bucket is empty so a clean
 * "nothing to do" morning shows nothing.
 *
 * Editorial-minimalist · gold-on-dark · matches other /brain zone
 * panels. No new schema · no new cron · no AI-slop sparkles. The
 * operator's daily ritual collapses from 3 page visits to 1 panel.
 */

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  GitMerge,
  Pin,
  AlertCircle,
} from "lucide-react";

type RecallItem = {
  id: string;
  preview: string;
  meta?: string | null;
  at?: string | null;
};

function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function SourceGroup({
  label,
  icon: Icon,
  items,
  total,
  error,
  href,
  tint,
}: {
  label: string;
  icon: typeof Pin;
  items: RecallItem[];
  total: number;
  error: string | null;
  href: string;
  tint: string;
}) {
  // Silent when empty AND no error · matches Wave V pattern.
  if (items.length === 0 && !error) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Icon size={11} className={tint} aria-hidden />
          <span className={cn("text-[9px] font-bold uppercase tracking-[0.18em]", tint)}>
            {label}
          </span>
          <span className="text-[9px] font-mono text-[var(--text-tertiary)] tabular-nums">
            · {total}
          </span>
        </div>
        {total > items.length && (
          <Link
            href={href}
            className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)]"
          >
            see all →
          </Link>
        )}
      </div>
      {error ? (
        <p className="text-[10px] text-rose-300/80 px-2 py-1.5 rounded border border-rose-500/20 bg-rose-500/[0.04]">
          ⚠ {error.replace(/_/g, " ")}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-baseline gap-2 text-[11px] leading-snug"
            >
              <Link
                href={href}
                className="flex-1 min-w-0 truncate text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title={item.preview}
              >
                {item.preview}
              </Link>
              {item.meta && (
                <span className="shrink-0 text-[9px] font-mono text-[var(--text-tertiary)]/70 truncate max-w-[120px]">
                  {item.meta}
                </span>
              )}
              {item.at && (
                <span className="shrink-0 text-[9px] font-mono text-[var(--text-tertiary)]/60 tabular-nums">
                  {timeAgo(item.at)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecallInboxPanel() {
  const { data } = trpc.brain.recallInbox.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });

  if (!data) return null;
  // Silent when the entire inbox is empty (clean morning).
  if (data.totalCount === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-void)]/40 p-3 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--gold)]/80">
            Recall · attention
          </span>
          <span className="text-[10px] font-mono text-[var(--text-tertiary)] tabular-nums">
            {data.totalCount} items across {[
              data.pins.total > 0 ? 1 : 0,
              data.linkReview.total > 0 ? 1 : 0,
              data.contradictions.total > 0 ? 1 : 0,
              data.alerts.total > 0 ? 1 : 0,
            ].reduce((a, b) => a + b, 0)} sources
          </span>
        </div>
      </div>
      <SourceGroup
        label="pins"
        icon={Pin}
        items={data.pins.items}
        total={data.pins.total}
        error={data.pins.error}
        href="/brain#pinned"
        tint="text-[var(--gold)]/80"
      />
      <SourceGroup
        label="link-review"
        icon={GitMerge}
        items={data.linkReview.items}
        total={data.linkReview.total}
        error={data.linkReview.error}
        href="/brain/link-review"
        tint="text-sky-300/80"
      />
      <SourceGroup
        label="contradictions"
        icon={AlertCircle}
        items={data.contradictions.items}
        total={data.contradictions.total}
        error={data.contradictions.error}
        href="/brain#contradictions"
        tint="text-amber-300/80"
      />
      <SourceGroup
        label="alerts"
        icon={AlertTriangle}
        items={data.alerts.items}
        total={data.alerts.total}
        error={data.alerts.error}
        href="/brain"
        tint="text-rose-300/80"
      />
    </div>
  );
}
