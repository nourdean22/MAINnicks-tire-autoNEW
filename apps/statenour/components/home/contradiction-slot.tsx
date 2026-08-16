"use client";

/**
 * ContradictionSlot — the one knowledge signal that earns a place on Home.
 *
 * Home is a deliberate four-question decision page and the standing rule is
 * that nothing gets added to it just because it exists. Applying that test to
 * the knowledge layer, almost nothing qualifies: candidate queues, blind spots
 * and correlations are all one tap away at /brain. Exactly one class does
 * qualify — an unresolved contradiction between something the operator said
 * recently and something he said before. It is rare (the detector requires
 * semantic similarity >= 0.78 AND a negation/reversal signal AND a >= 7-day
 * gap), it is about HIM rather than about the system, it decays if ignored,
 * and it is the single thing that makes him harder to fool. That is a
 * decision, which is what Home is for.
 *
 * DELIBERATELY NOT a resolver. A full four-verdict resolution panel already
 * exists at /brain?tab=memory#contradictions and reads `?resolve=<key>` to
 * scroll a specific row into view. Rebuilding those buttons here would be the
 * third implementation of the same flow, and it would ship that panel's 24px
 * touch targets onto the operator's primary phone surface. This slot states
 * the conflict and hands off.
 *
 * Window note: reads the same 14-day unresolved window as the bottom ticker's
 * countUnresolved(14), so the two never disagree. The `system.contradictions`
 * procedure defaults to 30 days — using it here would make Home's count read
 * as a bug next to the ticker's.
 *
 * Home contract, copied from FollowUpsList: skeleton while loading, LOUD on
 * error ("state unknown, not empty"), and `null` on a measured zero — never
 * an empty card.
 */

import Link from "next/link";
import { GlassCard } from "@/components/ui/glass-card";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

const COLLAPSED_LIMIT = 2;

function daysLabel(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n === 1) return "1 day apart";
  if (n < 14) return `${n} days apart`;
  if (n < 60) return `${Math.round(n / 7)} weeks apart`;
  return `${Math.round(n / 30)} months apart`;
}

export function ContradictionSlot() {
  const query = trpc.brain.contradictions.useQuery(
    { includeResolved: false },
    { staleTime: 60_000 },
  );

  if (query.isLoading) {
    return <div className="skeleton h-20 w-full" />;
  }

  if (query.isError) {
    return (
      <GlassCard className="p-3">
        <p className="text-xs text-amber-300">
          Contradictions couldn&apos;t load — state unknown, not empty.
        </p>
      </GlassCard>
    );
  }

  const items = query.data?.contradictions ?? [];
  if (items.length === 0) {
    // Measured zero. Nothing to reconcile is a real, quiet answer — and a
    // surface that is usually absent is what makes it trustworthy when present.
    return null;
  }

  const shown = items.slice(0, COLLAPSED_LIMIT);

  return (
    <GlassCard critical className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-rose-300 shrink-0" />
        <h2 className="text-sm font-semibold text-fg">
          You&apos;ve reversed on something
        </h2>
        <span className="ml-auto rounded border border-glass px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-fg-secondary">
          {items.length} open
        </span>
      </div>

      <div className="space-y-3">
        {shown.map((c) => (
          <Link
            key={c.key}
            href={`/brain?tab=memory&resolve=${encodeURIComponent(c.key)}`}
            className="block rounded-lg border border-glass bg-white/[0.02] p-3 transition hover:bg-white/[0.05] min-h-[44px]"
          >
            <p className="text-xs leading-relaxed text-fg">
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg-secondary">
                now ·{" "}
              </span>
              {c.new_excerpt}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-fg-secondary">
              <span className="font-mono text-[10px] uppercase tracking-wider">
                before ·{" "}
              </span>
              {c.old_excerpt}
            </p>
            <p className="mt-2 flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-fg-secondary">
              {daysLabel(c.days_apart)}
              {c.days_apart > 0 ? " · " : ""}
              both from you
              <ArrowRight size={10} className="ml-auto" />
            </p>
          </Link>
        ))}
      </div>

      {items.length > shown.length && (
        <Link
          href="/brain?tab=memory#contradictions"
          className="inline-flex min-h-[44px] items-center text-[11px] font-mono uppercase tracking-wider text-fg-secondary transition hover:text-fg"
        >
          {items.length - shown.length} more →
        </Link>
      )}
    </GlassCard>
  );
}
