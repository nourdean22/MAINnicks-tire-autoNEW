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
 * TODAY'S FOLLOW-UPS (2026-10-25). Sales Pipeline opens here. The first five
 * rows show, beside the total open, and Show all opens the rest: five is a
 * phone screen, not a ranking. Each card says why it is there (the server's
 * reason and, for missed calls, the receptionist's own words) before the phone
 * and the verbs, and never shows the customer's name. There is no Later: the
 * queue has no snooze or deferred state to record it in.
 *
 * WHAT IS DELIBERATELY ABSENT:
 *   - No ranking, no urgency-sorted lead. This is a worklist, not a priority
 *     engine. The order is: nobody has tried yet, then newest first.
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
import { navigateToAdminUrl } from "./shared/navigation";

type Row = RouterOutputs["opportunityQueue"]["list"]["items"][number];

/** The server's live (non-terminal) states. Guarded against server drift by opportunities-section.test.tsx. */
const RELEVANT_STATES = ["new", "assigned", "attempted", "contacted", "scheduled", "walk_in_expected", "arrived", "no_response"] as const;

/** States the server lets move to `attempted`. Guarded against server drift by opportunities-section.test.tsx. */
const CAN_ATTEMPT: readonly string[] = ["new", "assigned", "attempted", "no_response"];

/** 250 rows were live on 2026-10-23 and the old window of 100 hid 150 of them. 500 is the router's maximum. */
const LIMIT = 500;
// "worklist": the server puts untouched rows first and the newest first BEFORE it cuts the window to LIMIT.
const LIST_INPUT = { states: [...RELEVANT_STATES], limit: LIMIT, order: "worklist" as const };

/** Cards shown before Show all. The total comes from the same read, so no second call is needed. */
const TOP = 5;

/** These states prove a customer exists, so "Not a customer" would be false on them. */
const STATE_PROVES_CUSTOMER: readonly string[] = ["scheduled", "walk_in_expected", "arrived"];

/** No phone number rides in this URL: the waiting threads are listed first in Messages. */
const MESSAGES_HREF = "/admin?tab=campaigns&outreachTab=sms";

const BUTTON = "min-h-[48px] min-w-[48px] px-4 rounded border border-border/50 text-sm disabled:opacity-50";

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "value unknown";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function typeLabel(sourceType: string): string {
  const words = sourceType.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Shop days since creation, computed in SQL (a driver-parsed DATETIME is shifted on an ET host). null = unknown. */
function ageLabel(ageDays: number | null): string {
  if (ageDays === null || !Number.isFinite(ageDays)) return "age unknown";
  if (ageDays <= 0) return "today";
  return ageDays === 1 ? "1 day old" : `${ageDays} days old`;
}

/** Texts the SOURCE system already sent (unapproved estimates record this; it never touches attempts). */
function automatedTexts(r: Row): number {
  const n = r.evidence?.recoveryTouchesSent;
  return typeof n === "number" && n > 0 ? n : 0;
}

/** The receptionist's evaluation, on missed calls the server has re-worded (2026-10-25); older rows carry none. */
function evidenceText(r: Row, key: "summaryExcerpt" | "serviceMention"): string | null {
  const v = r.evidence?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
    // "Here" matters: the source system may already have texted this customer (see automatedTexts),
    // and missed-call recovery runs on its own, so the record cannot say nobody has been in touch.
    return "No attempt recorded here";
  }
  const verb = last.note === "called" ? "Called" : last.note === "texted" ? "Texted" : "Contact attempted";
  return `${verb} ${whenLabel(last.at)}${r.attempts > 1 ? `, attempt ${r.attempts}` : ""}`;
}

/**
 * The server words a conflict ("state changed concurrently") and an illegal move for a developer, and
 * "try again" cannot fix either: the row has changed under the crew and the list is already re-read.
 * Anything else keeps the server's text, minus an em dash, and may be retried.
 */
function refusalMessage(reason: string): string {
  if (/^(conflict|illegal)/i.test(reason)) return "Someone else changed this row. It has been refreshed.";
  return `Not saved: ${reason.replace(/\s*—\s*/g, ", ")}. The row is unchanged, try again.`;
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
    // TanStack v5 runs onMutate BEFORE it pauses an offline mutation, so the default would show
    // "Called <time>" on a row while nothing is sent. "always" sends now and fails into onError.
    networkMode: "always",
    // Show the result before the server answers. The row is put back if the save fails.
    onMutate: async (vars) => {
      setBusy(vars.id, true);
      await utils.opportunityQueue.list.cancel(LIST_INPUT);
      const prev = utils.opportunityQueue.list.getData(LIST_INPUT)?.items.find((r) => r.id === vars.id);
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
      return { prev };
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

  function putBack(id: string, ctx: { prev?: Row } | undefined, reason: string) {
    const prev = ctx?.prev;
    // Position needs no restoring: the list is re-sorted on every render.
    if (prev) patchItems((items) => (items.some((r) => r.id === id) ? items.map((r) => (r.id === id ? prev : r)) : [...items, prev]));
    toast.error(refusalMessage(reason));
  }

  async function hide(r: Row) {
    // A scheduled, walk-in or arrived row has a customer by definition: say "not actionable", not "not a customer".
    const customerKnown = STATE_PROVES_CUSTOMER.includes(r.state);
    const verdict = customerKnown ? "not actionable" : "not a customer";
    const ok = await confirmDialog({
      title: "Hide this opportunity?",
      message: `It leaves this list as ${verdict}. Nothing else changes, and it cannot be undone here.`,
      confirmLabel: customerKnown ? "Not relevant" : "Not a customer",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (ok) transition.mutate({ id: r.id, from: r.state, to: "dismissed", note: verdict });
  }

  const queryable = query.data?.queryable;
  const items = useMemo(() => [...(query.data?.items ?? [])].sort(worklistOrder), [query.data]);
  // No data, no error and not loading: the query is paused (offline) or has not started.
  const notLoadedYet = query.data === undefined && !query.isLoading && !query.isError;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, TOP);
  // A full window is the router's maximum, so the true total may be higher.
  const totalLabel = items.length >= LIMIT ? `${LIMIT} or more` : String(items.length);
  const readOk = !query.isLoading && !query.isError && queryable === true;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Inbox className="w-5 h-5" /> Today's follow-ups
          </h2>
          <p className="text-sm text-foreground/60">
            Open follow-ups from calls, estimates, bookings and forms. Rows nobody has tried yet come
            before the rest, newest on top. Not a customer or Not relevant hides the row.
          </p>
          {readOk && items.length > 0 && (
            // The first TOP rows are a page, not a count of what is due: the queue has no due date.
            <p className="text-sm font-medium mt-1">
              {shown.length < items.length ? `Showing ${shown.length} of ${totalLabel} open` : `${totalLabel} open`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="min-h-[48px] min-w-[48px] px-3 rounded border border-border/50 flex items-center gap-2 text-sm disabled:opacity-50"
          aria-label="Refresh follow-ups"
        >
          {query.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {/* Unknown is not empty: the queue may simply be unreadable. */}
      {(query.isError || queryable === false) && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">
            <strong>Follow-ups couldn't load: UNKNOWN, not clear.</strong> This is not an empty list,
            and it is not evidence that nothing needs doing.
          </span>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className={`${BUTTON} shrink-0`}
          >
            Retry
          </button>
        </div>
      )}

      {notLoadedYet && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Follow-ups have not loaded yet. If this phone is offline they load when the connection
            returns. This is not an empty list.
          </span>
        </div>
      )}

      {query.isLoading && (
        <div className="flex items-center gap-2 text-sm text-foreground/60">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading follow-ups…
        </div>
      )}

      {/* Only claim "clear" when the queue was actually READ and was empty. */}
      {!query.isLoading && !query.isError && queryable === true && items.length === 0 && (
        <div className="rounded border border-border/40 p-4 text-sm text-foreground/60">
          Nothing open. No follow-up is waiting.
        </div>
      )}

      {showAll && items.length >= LIMIT && (
        <div className="rounded border border-border/40 p-3 text-sm text-foreground/60">
          Showing the first {LIMIT}. Older rows may exist: work these, then press Refresh.
        </div>
      )}

      <ul className="space-y-4">
        {shown.map((o) => {
          const busy = busyIds.has(o.id);
          // A text waiting on a reply is closed by sending or by "No reply needed" in Messages, not by
          // an attempt recorded here: Called/Texted would leave the Messages count saying the customer waits.
          const inMessages = o.sourceType === "human_pending_sms";
          const canAttempt = o.consentOk && !inMessages && CAN_ATTEMPT.includes(o.state);
          const customerKnown = STATE_PROVES_CUSTOMER.includes(o.state);
          const dismissLabel = customerKnown ? "Not relevant" : "Not a customer";
          const texts = automatedTexts(o);
          const excerpt = evidenceText(o, "summaryExcerpt");
          const service = evidenceText(o, "serviceMention");
          return (
            <li key={o.id} className="rounded border border-border/40 p-3 space-y-3">
              {/* The need and the why come first; no customer name rides on the card, the phone does. */}
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-medium break-words">{o.recommendedAction}</div>
                  <span className="shrink-0 text-xs text-foreground/60">{ageLabel(o.ageDays)}</span>
                </div>
                <div className="text-sm text-foreground/60 break-words">{o.reason}</div>
                {excerpt && <p className="text-sm break-words mt-1">Receptionist: {excerpt}</p>}
                {service && <p className="text-sm break-words">Service: {service}</p>}
                <div className="text-xs text-foreground/60 mt-1 break-words">
                  <span className="font-medium text-foreground/80">{typeLabel(o.sourceType)}</span> · {money(o.expectedRevenueCents)} · evidence: {o.dataQuality}
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
                  <>
                    {/* The flag is false for any opt-out (texts only, or do-not-contact), so it cannot say which: show the number as plain text, not a link. */}
                    {o.customerPhone && <p className="text-sm mt-1">{o.customerPhone}</p>}
                    <p className="text-sm text-amber-400 mt-1">
                      Opted out of texts or marked do-not-contact. Called and Texted are off for this row.
                    </p>
                  </>
                )}
                <p className="text-sm mt-1">{attemptLine(o)}</p>
                {texts > 0 && <p className="text-sm text-foreground/60">Automated texts sent: {texts}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {inMessages && (
                  <a
                    href={MESSAGES_HREF}
                    onClick={(e) => {
                      if (navigateToAdminUrl(e, MESSAGES_HREF, "campaigns")) e.preventDefault();
                    }}
                    className={`${BUTTON} inline-flex items-center`}
                  >
                    Reply from Messages
                  </a>
                )}
                {canAttempt && (
                  <>
                    <button
                      type="button"
                      onClick={() => transition.mutate({ id: o.id, from: o.state, to: "attempted", note: "called" })}
                      disabled={busy}
                      className={BUTTON}
                      aria-label={`Called: ${o.recommendedAction}`}
                    >
                      Called
                    </button>
                    <button
                      type="button"
                      onClick={() => transition.mutate({ id: o.id, from: o.state, to: "attempted", note: "texted" })}
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
                  aria-label={`${dismissLabel}: ${o.recommendedAction}`}
                >
                  {dismissLabel}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {!showAll && items.length > TOP && (
        <button type="button" onClick={() => setShowAll(true)} className={`${BUTTON} w-full`}>
          Show all {totalLabel}
        </button>
      )}
    </div>
  );
}
