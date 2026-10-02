"use client";

/**
 * WaitingLine — section 7 (rail): who the operator is waiting ON, from the
 * WaitingSummary read model (lib/home/waiting-summary.ts · full-circle Lane B).
 *
 * Renders the `others` bucket (a person owes the operator something: a task
 * with waitingOn, aged from its last update) and the `system` bucket (Nick or
 * an executing action attempt is working on it). The `me` bucket is NOT
 * rendered here: decisions already have one home on this page (JudgmentQueue)
 * and the shop's callbacks and urgent leads belong to nickstire.org/admin —
 * never on the personal command surface (operator verdict, 2026-09-02). A
 * belt-and-braces filter drops any item whose source is the shop bridge.
 *
 * Contract shared with every Home section: nothing on a measured zero; LOUD on
 * a failed read ("unknown, not empty" — the failed sources are named); at most
 * WAITING_LINE_ROW_CAP rows, oldest first, with the rest counted behind a link
 * to /missions, which owns the per-task verbs (Nudge · Check in · Unblock).
 * Like the horizon, this is a context pointer outside the attention budget.
 */

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import type { WaitingItem, WaitingSummary } from "@/lib/home/waiting-summary";

export const WAITING_LINE_ROW_CAP = 4;

export type WaitingLineStatus = "loading" | "error" | "ready";

export function formatWaitingAge(ageMin: number | null): string {
  if (ageMin === null) return "age unknown";
  if (ageMin < 60) return `${ageMin}m`;
  if (ageMin < 1_440) return `${Math.floor(ageMin / 60)}h`;
  return `${Math.floor(ageMin / 1_440)}d`;
}

const isShopItem = (i: WaitingItem) => i.source.startsWith("nickstire");

export interface WaitingLineModel {
  kind: "nothing" | "unknown" | "rows";
  /** Named when kind is unknown: the sources whose read failed. */
  failedSources: string[];
  rows: WaitingItem[];
  /** Items beyond the cap, counted not listed. */
  more: number;
  total: number;
}

/** Pure: the view's decision, pinnable without rendering. */
export function waitingLineModel(summary: WaitingSummary | null, status: WaitingLineStatus): WaitingLineModel {
  if (status === "error" || (status === "ready" && !summary)) {
    return { kind: "unknown", failedSources: ["waiting summary"], rows: [], more: 0, total: 0 };
  }
  if (status === "loading" || !summary) return { kind: "nothing", failedSources: [], rows: [], more: 0, total: 0 };
  if (summary.others.count === null || summary.system.count === null) {
    return { kind: "unknown", failedSources: summary.failedSources, rows: [], more: 0, total: 0 };
  }
  const items = [...summary.others.items, ...summary.system.items]
    .filter((i) => !isShopItem(i))
    .sort((a, b) => (b.ageMin ?? -1) - (a.ageMin ?? -1));
  // The count is what Home may show: the items in hand (shop items excluded)
  // plus whatever the read model's bucket cap left unlisted — never a number
  // that includes rows this surface refuses to render.
  const hiddenByCap = Math.max(
    0,
    summary.others.count + summary.system.count - (summary.others.items.length + summary.system.items.length),
  );
  const total = items.length + hiddenByCap;
  if (total === 0) return { kind: "nothing", failedSources: [], rows: [], more: 0, total: 0 };
  const rows = items.slice(0, WAITING_LINE_ROW_CAP);
  return { kind: "rows", failedSources: [], rows, more: total - rows.length, total };
}

export function WaitingLineView({ summary, status }: { summary: WaitingSummary | null; status: WaitingLineStatus }) {
  const model = waitingLineModel(summary, status);
  if (model.kind === "nothing") return null;

  if (model.kind === "unknown") {
    return (
      <section aria-label="waiting on others" className="mt-10 first:mt-0">
        <h2 className="vt-eyebrow text-fg-secondary">Waiting on others</h2>
        <p className="mt-3 font-mono text-[12px] uppercase tracking-[0.12em] text-amber-300/90">
          unknown — read failed: {model.failedSources.join(", ") || "unnamed source"}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="waiting on others" className="mt-10 first:mt-0">
      <div className="flex items-end justify-between gap-3">
        <h2 className="vt-eyebrow text-fg-secondary">Waiting on others</h2>
        <span className="stat-number text-2xl leading-none text-amber-300">{model.total}</span>
      </div>
      <ul className="mt-3 divide-y divide-edge border-y border-edge">
        {model.rows.map((i) => (
          <li key={i.key}>
            <Link
              href={i.href ?? "/missions"}
              className="flex min-h-[44px] items-center gap-3 py-2 text-[15px] text-fg transition-colors duration-[var(--motion-state)] hover:text-gold"
            >
              <span aria-hidden className="shrink-0 font-mono text-[12px] text-fg-tertiary">
                {i.owner === "system" ? "◐" : "⏸"}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-fg-secondary">{i.who}</span> · {i.subject}
              </span>
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
                {formatWaitingAge(i.ageMin)}
                {i.deadline ? ` · due ${i.deadline}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {model.more > 0 && (
        <Link
          href="/missions"
          className="mt-2 inline-flex min-h-[44px] items-center font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary hover:text-fg"
        >
          +{model.more} more on /missions →
        </Link>
      )}
    </section>
  );
}

export function WaitingLine() {
  // Rail scope: only the reads that feed `others` / `system` (bug-hunt 2026-10-02).
  const q = trpc.operator.waitingSummary.useQuery({ scope: "rail" }, {
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  // First-load failure only (TanStack v5 doctrine, as HomeConsole): a failed
  // background refetch keeps the last summary rather than flipping to unknown.
  const status: WaitingLineStatus = q.data ? "ready" : q.isError ? "error" : "loading";
  return <WaitingLineView summary={(q.data as WaitingSummary | undefined) ?? null} status={status} />;
}
