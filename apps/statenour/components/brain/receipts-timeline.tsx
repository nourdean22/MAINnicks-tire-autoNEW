"use client";

/**
 * ReceiptsTimeline — BDN-003 · the ONE merged activity/receipts timeline.
 *
 * ORGANIZATION-WIRING-AUDIT §6/§7 called this shape twice: "fold the
 * receipt feed into /brain/continuity rather than building a second
 * activity view." This renders trpc.system.receiptFeed — the existing
 * 3-source merge (entity-audit + autonomous-action + agent action_receipt
 * rows, typed adapters in lib/services/action-receipt-feed.ts) — with
 * status filters, replacing the raw entity-audit-only stream on the
 * Continuity tab. Read-only: no mutations, no schema.
 *
 * Honest-states contract: loading renders a skeleton, failure renders as
 * FAILURE (unknown ≠ empty), measured zero says so in words.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { AlertCircle, ReceiptText } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type StatusFilter = "all" | "success" | "failed" | "needs_approval" | "other";

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "all" },
  { key: "success", label: "success" },
  { key: "failed", label: "failed" },
  { key: "needs_approval", label: "needs approval" },
  { key: "other", label: "other" },
];

const STATUS_DOT: Record<string, string> = {
  success: "bg-emerald-400",
  partial: "bg-amber-400",
  skipped: "bg-fg-tertiary",
  needs_approval: "bg-rose-400",
  failed: "bg-rose-500",
};

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ReceiptsTimeline({ limit = 30 }: { limit?: number }) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const feedQ = trpc.system.receiptFeed.useQuery({ limit }, { staleTime: 30_000 });

  if (feedQ.isLoading) {
    return (
      <section aria-label="receipts-timeline" className="rounded-surface border border-edge-subtle p-4 space-y-2">
        <div className="h-3 w-44 rounded-micro bg-surface-interactive animate-pulse" />
        <div className="h-24 rounded-micro bg-surface-interactive animate-pulse" />
      </section>
    );
  }
  if (feedQ.isError) {
    return (
      <section aria-label="receipts-timeline" className="rounded-surface border border-red-500/15 bg-red-500/5 p-4">
        <p className="text-[11px] text-red-400 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          Receipts couldn&apos;t load — state unknown, not empty.
        </p>
      </section>
    );
  }

  const items = feedQ.data?.items ?? [];
  const counts = feedQ.data?.counts ?? { total: 0, success: 0, failed: 0, other: 0 };
  const filtered =
    filter === "all"
      ? items
      : filter === "other"
        ? items.filter((r) => r.status === "skipped" || r.status === "partial")
        : items.filter((r) => r.status === filter);

  return (
    <section
      aria-label="receipts-timeline"
      className="rounded-surface border border-edge-subtle bg-content p-4 flex flex-col space-y-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-edge-subtle pb-2">
        <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary flex items-center gap-1.5">
          <ReceiptText className="h-3.5 w-3.5 text-fg-secondary" /> Activity &amp; Receipts
        </p>
        <span className="text-[11px] font-mono text-fg-tertiary">
          {counts.total} in window · {counts.success} ok · {counts.failed} failed
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Filter receipts by status">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-2.5 py-1 min-h-[32px] text-[12px] font-medium transition-colors duration-[var(--motion-state)]",
              filter === f.key
                ? "border-accent text-fg bg-surface-interactive"
                : "border-edge-default text-fg-tertiary hover:border-edge-strong hover:text-fg",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-[11px] text-fg-tertiary py-2">
          {items.length === 0
            ? "No receipts in the current window — nothing acted, nothing audited."
            : "No receipts match this filter in the current window."}
        </p>
      ) : (
        <ul className="space-y-1.5 max-h-[420px] overflow-y-auto scrollbar-thin">
          {filtered.map((r) => (
            <li
              key={r.receiptId}
              className="flex items-start gap-2 p-2 rounded-micro bg-content border border-edge-subtle"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 inline-block h-1.5 w-1.5 rounded-full shrink-0",
                  STATUS_DOT[r.status] ?? "bg-fg-tertiary",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono text-fg-secondary truncate">{r.toolName}</span>
                  <span className="text-[11px] font-mono text-fg-tertiary border border-edge-subtle rounded-micro px-1 py-px">
                    {r.category}
                  </span>
                  <span className="text-[11px] font-mono text-fg-tertiary ml-auto shrink-0">
                    {timeAgo(r.createdAt)}
                  </span>
                </div>
                <p className="text-[11px] text-fg-secondary leading-snug mt-0.5 break-words">
                  {r.userVisibleSummary}
                </p>
                {r.status === "failed" && r.errorSafeMessage && (
                  <p className="text-[11px] text-rose-400/90 mt-0.5">{r.errorSafeMessage}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
