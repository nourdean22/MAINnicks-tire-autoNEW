/**
 * Opportunities - the staff-facing worklist of the revenue-opportunity queue.
 *
 * NAMED for its table, not "Follow-ups": Outreach already has a Follow-Ups tab
 * (notification follow-ups) and owns that alias. Two surfaces with one name is
 * the duplication the 2026-09-01 thesis warns against.
 *
 * WHY THIS EXISTS (2026-09-07). The queue used to surface as the owner's
 * Decision Inbox on the admin home, where the top-5 "LEAD the day". The operator
 * retired it: a queue that leads the day manufactures obligations on a healthy
 * day, and a healthy day should be allowed to be quiet. The SERVICE is good and
 * the rows are real, so the data moved here instead of being deleted: off the
 * owner's front door, onto a tab staff open when they are actually doing
 * follow-up work.
 *
 * WHY IT HAS THREE VERBS (2026-10-23). The tab had one write, a fixed dismiss,
 * so 0 of 1,621 opportunities were ever attempted while 158 missed calls from
 * the last 7 days and 90 unapproved estimates sat unworked. A row can now be
 * worked: Called and Texted record an attempt, Not a customer hides the row.
 * "Called" and "Texted" are things the crew did OUTSIDE the admin. This page
 * records them; it sends nothing.
 *
 * WHAT IS DELIBERATELY ABSENT:
 *   - No "top N", no ranking, no urgency-sorted lead. This is a worklist, not a
 *     priority engine. The order is: nobody has tried yet, then newest first.
 *   - No send button. Outreach lives in its own rails (declinedWorkRecovery,
 *     missedCallRecovery, staleLeadFollowup) with their own consent gates.
 *   - No "Fixed elsewhere / Sold the car / Not interested" chips. Those wrote
 *     `alg_estimates.stated_concern` as though the CUSTOMER had said it, and
 *     silently ended that customer's recovery sequence. Retired with the panel;
 *     see the note in routers/opportunityQueue.ts.
 *
 * DISMISS IS NEUTRAL, AND THAT IS THE POINT. `dismissed` asserts only that a
 * human looked and judged the row not a customer. It does not mark a sale lost,
 * does not touch consent, does not suppress the phone number, and does not
 * claim the customer said anything.
 *
 * THE MUTATION REFUSES IN A SUCCESSFUL RESPONSE. `transition` returns
 * `{ ok: false, error }` for an illegal move or a concurrent change; it does not
 * throw. Reading only `onError` would let a refused save look saved, so both
 * channels roll the row back and say so.
 *
 * UNKNOWN IS NOT EMPTY. `list` returns `{ items, queryable }`; when `queryable`
 * is false the queue could not be read and this renders as unknown, never as
 * "no opportunities". A paused query (offline PWA) has neither data nor error
 * and is a third unknown, not an empty list. Same contract the admin home uses
 * for its slices.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

type Row = RouterOutputs["opportunityQueue"]["list"]["items"][number];

/** The server's live (non-terminal) states. Guarded against server drift by opportunities-section.test.tsx. */
const RELEVANT_STATES = ["new", "assigned", "attempted", "contacted", "scheduled", "walk_in_expected", "arrived", "no_response"] as const;

/** States the server lets move to `attempted`. Guarded against server drift by opportunities-section.test.tsx. */
const CAN_ATTEMPT: readonly string[] = ["new", "assigned", "attempted", "no_response"];

/** 250 rows were live on 2026-10-23 and the old window of 100 hid 150 of them. 500 is the router's maximum. */
const LIMIT = 500;
const LIST_INPUT = { states: [...RELEVANT_STATES], limit: LIMIT };

const DAY_MS = 86_400_000;

const BUTTON = "min-h-[48px] min-w-[48px] px-4 rounded border border-border/50 text-sm disabled:opacity-50";

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "value unknown";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function typeLabel(sourceType: string): string {
  const words = sourceType.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ageLabel(created: Date | string): string {
  const t = new Date(created).getTime();
  if (Number.isNaN(t)) return "age unknown";
  const days = Math.floor((Date.now() - t) / DAY_MS);
  if (days <= 0) return "today";
  return days === 1 ? "1 day old" : `${days} days old`;
}

function whenLabel(iso: unknown): string {
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "time not recorded";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** What the receipts say happened last, read back from the server's own record. */
function attemptLine(r: Row): string {
  const last = [...r.receipts].reverse().find((x) => x.to === "attempted");
  if (!last) {
    if (r.attempts > 0) return "Contact attempted, time not recorded";
    // Only a new or assigned row can honestly be called untouched; later states got there another way.
    return r.state === "new" || r.state === "assigned" ? "Not contacted yet" : "No attempt recorded";
  }
  const verb = last.note === "called" ? "Called" : last.note === "texted" ? "Texted" : "Contact attempted";
  return `${verb} ${whenLabel(last.at)}${r.attempts > 1 ? `, attempt ${r.attempts}` : ""}`;
}

/** Nobody has tried yet comes first; inside each group the newest row is on top. */
function worklistOrder(a: Row, b: Row): number {
  const untouched = Number(a.attempts !== 0) - Number(b.attempts !== 0);
  return untouched || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export default function OpportunitiesSection() {
  const utils = trpc.useUtils();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const query = trpc.opportunityQueue.list.useQuery(LIST_INPUT);

  const patchItems = (fn: (items: Row[]) => Row[]) =>
    utils.opportunityQueue.list.setData(LIST_INPUT, (old) => (old ? { ...old, items: fn(old.items) } : old));

  const transition = trpc.opportunityQueue.transition.useMutation({
    // Show the result before the server answers. The row is put back if the save fails.
    onMutate: async (vars) => {
      setBusy(vars.id, true);
      await utils.opportunityQueue.list.cancel(LIST_INPUT);
      const before = utils.opportunityQueue.list.getData(LIST_INPUT)?.items ?? [];
      const index = before.findIndex((r) => r.id === vars.id);
      const prev = index >= 0 ? before[index] : undefined;
      patchItems((items) =>
        vars.to === "dismissed"
          ? items.filter((r) => r.id !== vars.id)
          : items.map((r) =>
              r.id === vars.id
                ? {
                    ...r,
                    state: "attempted" as const,
                    attempts: r.attempts + 1,
                    receipts: [...r.receipts, { at: new Date().toISOString(), by: "you", from: r.state, to: "attempted", note: vars.note }],
                  }
                : r,
            ),
      );
      return { prev, index };
    },
    onSuccess: (res, vars, ctx) => {
      if (!res.ok) putBack(vars.id, ctx, res.error);
    },
    onError: (err, vars, ctx) => putBack(vars.id, ctx, err.message),
    onSettled: (_res, _err, vars) => {
      setBusy(vars.id, false);
      void utils.opportunityQueue.list.invalidate();
    },
  });

  function putBack(id: string, ctx: { prev?: Row; index: number } | undefined, reason: string) {
    const prev = ctx?.prev;
    const index = ctx?.index ?? 0;
    if (prev) {
      patchItems((items) =>
        items.some((r) => r.id === id)
          ? items.map((r) => (r.id === id ? prev : r))
          : [...items.slice(0, index), prev, ...items.slice(index)],
      );
    }
    toast.error(`Not saved: ${reason}. The row is unchanged, try again.`);
  }

  async function hide(r: Row) {
    const ok = await confirmDialog({
      title: "Hide this opportunity?",
      message: "It leaves this list as not a customer. Nothing else changes, and it cannot be undone here.",
      confirmLabel: "Not a customer",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (ok) transition.mutate({ id: r.id, to: "dismissed", note: "not a customer" });
  }

  const queryable = query.data?.queryable;
  const items = useMemo(() => [...(query.data?.items ?? [])].sort(worklistOrder), [query.data]);
  // No data, no error and not loading: the query is paused (offline) or has not started.
  const notLoadedYet = query.data === undefined && !query.isLoading && !query.isError;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Inbox className="w-5 h-5" /> Opportunities
          </h2>
          <p className="text-sm text-foreground/60">
            Open customer opportunities collected from calls, estimates, bookings and forms. Called and
            Texted record what you did outside the admin, and this page sends nothing. Not a customer
            hides the row.
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

      {/* Unknown is not empty: the queue may simply be unreadable. */}
      {(query.isError || queryable === false) && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>Opportunities unreadable: this is UNKNOWN, not clear.</strong> The queue could not
            be read, so this list is not evidence that nothing needs doing. Press Refresh to try again.
          </span>
        </div>
      )}

      {notLoadedYet && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Opportunities have not loaded yet. If this phone is offline they load when the connection
            returns. This is not an empty list.
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
          No open opportunities. The queue was read successfully: this one is genuinely clear.
        </div>
      )}

      {items.length >= LIMIT && (
        <div className="rounded border border-border/40 p-3 text-sm text-foreground/60">
          Showing the first {LIMIT} opportunities. More exist: work these, then press Refresh.
        </div>
      )}

      <ul className="space-y-4">
        {items.map((o) => {
          const busy = busyIds.has(o.id);
          const canAttempt = o.consentOk && CAN_ATTEMPT.includes(o.state);
          return (
            <li key={o.id} className="rounded border border-border/40 p-3 space-y-3">
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-3 text-xs text-foreground/60">
                  <span className="font-medium text-foreground/80">{typeLabel(o.sourceType)}</span>
                  <span className="shrink-0">{ageLabel(o.createdAt)}</span>
                </div>
                <div className="font-medium break-words mt-1">{o.recommendedAction}</div>
                <div className="text-sm text-foreground/60 break-words">{o.reason}</div>
                <div className="text-xs text-foreground/60 mt-1 break-words">
                  {o.customerName ?? "unknown customer"} · {money(o.expectedRevenueCents)} · evidence: {o.dataQuality}
                  {o.state !== "new" && o.state !== "attempted" ? ` · state: ${o.state.replace(/_/g, " ")}` : ""}
                </div>
                {o.consentOk ? (
                  o.customerPhone ? (
                    <a
                      href={`tel:${o.customerPhone.replace(/[^\d+]/g, "")}`}
                      className="inline-flex items-center min-h-[48px] text-sm underline"
                    >
                      {o.customerPhone}
                    </a>
                  ) : (
                    <p className="text-sm text-foreground/60 mt-1">No phone number on file.</p>
                  )
                ) : (
                  <p className="text-sm text-amber-400 mt-1">
                    Consent is off for this number. Do not call or text it.
                  </p>
                )}
                <p className="text-sm mt-1">{attemptLine(o)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canAttempt && (
                  <>
                    <button
                      type="button"
                      onClick={() => transition.mutate({ id: o.id, to: "attempted", note: "called" })}
                      disabled={busy}
                      className={BUTTON}
                      aria-label={`Called: ${o.recommendedAction}`}
                    >
                      Called
                    </button>
                    <button
                      type="button"
                      onClick={() => transition.mutate({ id: o.id, to: "attempted", note: "texted" })}
                      disabled={busy}
                      className={BUTTON}
                      aria-label={`Texted: ${o.recommendedAction}`}
                    >
                      Texted
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void hide(o)}
                  disabled={busy}
                  className={BUTTON}
                  aria-label={`Not a customer: ${o.recommendedAction}`}
                >
                  Not a customer
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
