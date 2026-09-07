/**
 * Opportunities — the staff-facing read of the revenue-opportunity queue.
 *
 * NAMED for its table, not "Follow-ups": Outreach already has a Follow-Ups tab
 * (notification follow-ups) and owns that alias. Two surfaces with one name is
 * the duplication the 2026-09-01 thesis warns against.
 *
 * WHY THIS EXISTS (2026-09-07). The queue used to surface as the owner's
 * Decision Inbox on the admin home, where the top-5 "LEAD the day". The operator
 * retired it: a queue that leads the day manufactures obligations on a healthy
 * day, and a healthy day should be allowed to be quiet. The SERVICE is good and
 * the rows are real, so the data moved here instead of being deleted — off the
 * owner's front door, onto a tab staff open when they are actually doing
 * follow-up work.
 *
 * `opportunityQueue.list` already existed and had NO UI mount anywhere in the
 * repo. This is that procedure's first consumer.
 *
 * WHAT IS DELIBERATELY ABSENT:
 *   · No "top N", no ranking, no urgency-sorted lead. This is a worklist, not a
 *     priority engine — ranking is what made it an obligation.
 *   · No send button. Outreach lives in its own rails (declinedWorkRecovery,
 *     missedCallRecovery, staleLeadFollowup) with their own consent gates.
 *   · No "Fixed elsewhere / Sold the car / Not interested" chips. Those wrote
 *     `alg_estimates.stated_concern` as though the CUSTOMER had said it, and
 *     silently ended that customer's recovery sequence. Retired with the panel;
 *     see the note in routers/opportunityQueue.ts.
 *
 * DISMISS IS NEUTRAL, AND THAT IS THE POINT. `dismissed` asserts only that a
 * human looked and judged the row not actionable. It does not mark a sale lost,
 * does not touch consent, does not suppress the phone number, and does not
 * claim the customer said anything.
 *
 * UNKNOWN IS NOT EMPTY. `list` returns `{ items, queryable }`; when `queryable`
 * is false the queue could not be read and this renders as unknown, never as
 * "no opportunities". Same contract the admin home uses for its slices.
 */
import { useState } from "react";
import { AlertTriangle, Check, Inbox, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";

const RELEVANT_STATES = ["new", "assigned", "attempted", "contacted", "scheduled", "walk_in_expected", "arrived", "no_response"] as const;

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "value unknown";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function OpportunitiesSection() {
  const utils = trpc.useUtils();
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = trpc.opportunityQueue.list.useQuery({
    states: [...RELEVANT_STATES],
    limit: 100,
  });

  const dismiss = trpc.opportunityQueue.transition.useMutation({
    onSettled: () => {
      setBusyId(null);
      void utils.opportunityQueue.list.invalidate();
    },
  });

  const queryable = query.data?.queryable;
  const items = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Inbox className="w-5 h-5" /> Opportunities
          </h2>
          <p className="text-sm text-foreground/60">
            Open customer opportunities collected from calls, estimates, bookings and forms.
            Dismissing one records only that you judged it not actionable.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="min-h-[48px] min-w-[48px] px-3 rounded border border-border/50 flex items-center gap-2 text-sm disabled:opacity-50"
          aria-label="Refresh opportunities"
        >
          {query.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {/* Unknown is not empty — the queue may simply be unreadable. */}
      {(query.isError || queryable === false) && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>Opportunities unreadable — this is UNKNOWN, not clear.</strong> The queue could not
            be read, so this list is not evidence that nothing needs doing.
          </span>
        </div>
      )}

      {query.isLoading && (
        <div className="flex items-center gap-2 text-sm text-foreground/60">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading opportunities…
        </div>
      )}

      {/* Only claim "clear" when the queue was actually READ and was empty. */}
      {!query.isLoading && !query.isError && queryable === true && items.length === 0 && (
        <div className="rounded border border-border/40 p-4 text-sm text-foreground/60">
          No open opportunities. The queue was read successfully — this one is genuinely clear.
        </div>
      )}

      {items.map((o) => (
        <div key={o.id} className="rounded border border-border/40 p-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium truncate">{o.recommendedAction}</div>
            <div className="text-sm text-foreground/60 truncate">{o.reason}</div>
            <div className="text-xs text-foreground/50 mt-1">
              {o.customerName ?? "unknown customer"} · {money(o.expectedRevenueCents)} · {o.sourceType} ·{" "}
              evidence: {o.dataQuality} · state: {o.state}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setBusyId(o.id);
              dismiss.mutate({ id: o.id, to: "dismissed", note: "not actionable" });
            }}
            disabled={busyId === o.id}
            className="min-h-[48px] px-3 rounded border border-border/50 text-sm shrink-0 flex items-center gap-2 disabled:opacity-50"
            aria-label={`Dismiss opportunity: ${o.recommendedAction}`}
          >
            {busyId === o.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Not relevant
          </button>
        </div>
      ))}
    </div>
  );
}
