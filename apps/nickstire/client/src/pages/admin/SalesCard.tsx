/**
 * SalesCard — what the shop billed, with its own provenance attached.
 *
 * PLACEMENT. This leads the owner's home. Before 2026-09-07 the home carried NO
 * revenue figure at all — the top of the page was a decision queue, and the four
 * summary counts sat seventh, below a stale "Automation Lift" panel. The owner's
 * first question is "what did the shop sell", so that is now the first thing on
 * the page.
 *
 * THREE THINGS IT REFUSES TO DO:
 *
 * 1. It does not say "Total Sales". The figure is billed-not-collected, gross,
 *    tax-inclusive, and has never been reconciled to the shop's own report. It
 *    is labelled "Billed" and states its basis. When an ALG period export has
 *    been compared line by line, `reconciledToShopReport` flips and the label
 *    can earn a stronger word — that is an operator-verified event, not a
 *    styling decision.
 *
 * 2. It does not default to TODAY, though Today and Yesterday are chips (the owner
 *    asked for the day, 2026-10-21). The ALG mirror runs a day behind, so today's
 *    invoice count is structurally 0 every morning; a "$0 today" tile reads as a
 *    dead shop rather than a sync lag. It defaults to a completed 7-day window
 *    and always prints the through-date, which is the same reasoning that made
 *    controlCenter.todayPulse exclude "sales today" deliberately. A single day that
 *    no successful ShopDriver sync has covered (`windowSynced` false, read from the
 *    sync log, never from the newest invoice) renders "Not synced yet" INSTEAD of the
 *    figure: not synced is not $0. A day a sync has covered with no invoices (a
 *    holiday) is a real $0 and still shows it, labelled with the sync time. An
 *    unreadable sync log (`windowSynced` null) is "Sync status unknown", never synced.
 *
 * 3. It never renders a failed read as $0. The procedure returns a discriminated
 *    union, so the unavailable branch has no number to show.
 *
 * The exclusions are one tap away rather than on the face of the card: the
 * operator scanning his phone needs the figure and the lag; the person
 * reconciling it needs pending/partial/refunded, and they are the same person on
 * a different day.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, DollarSign, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

type Period = "today" | "yesterday" | "last_7d" | "last_30d" | "month_to_date" | "prev_month";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_7d", label: "7 days" },
  { id: "last_30d", label: "30 days" },
  { id: "month_to_date", label: "This month" },
  { id: "prev_month", label: "Last month" },
];

/** Cents -> "$12,345". Whole dollars: the cents are noise at this size. */
function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

type SyncState =
  | { state: "ok"; etDate: string; etTime: string }
  | { state: "never" }
  | { state: "unreadable" };

/** When the figure was last current, from the ShopDriver sync log. Never invents a time. */
function syncCaption(period: Period, sync: SyncState): string {
  if (sync.state === "ok") {
    return period === "today"
      ? `so far today, as of ${sync.etTime} ET`
      : `current as of ${sync.etDate} ${sync.etTime} ET`;
  }
  return sync.state === "never" ? "no ShopDriver sync on record" : "sync time unknown";
}

/** What a single day shows INSTEAD of a figure when no sync covers it, or the log is unreadable. */
function dayNotShownText(period: Period, windowSynced: boolean | null, sync: SyncState): string {
  const which = period === "today" ? "today" : "yesterday";
  if (windowSynced === null) {
    return `Sync status unknown: the ShopDriver sync log could not be read, so ${which}'s total is not shown.`;
  }
  const head = period === "today" ? "Not synced yet today." : "Not synced yet for yesterday.";
  if (sync.state === "ok") return `${head} Last ShopDriver sync: ${sync.etDate} ${sync.etTime} ET.`;
  return `${head} No ShopDriver sync on record.`;
}

// How the card follows a running probe: every 15 s for the first 3 minutes, then every 60 s while
// the latest read still says one is running, and it gives up after 20 minutes. A probe that takes
// longer than 3 minutes (a slow ShopDriver) used to freeze the card on the pre-sync numbers.
const SYNC_POLL_FAST_MS = 15_000;
const SYNC_POLL_FAST_FOR_MS = 3 * 60_000;
const SYNC_POLL_SLOW_MS = 60_000;
const SYNC_POLL_GIVE_UP_MS = 20 * 60_000;

export default function SalesCard() {
  const [period, setPeriod] = useState<Period>("last_7d");
  const [showDetail, setShowDetail] = useState(false);
  // The sync itself is started by the admin shell on a page load (useSyncOnAdminLoad). This card
  // only follows it: while the read says a probe is running (`syncInFlight`: this load's refresh,
  // an OAuth callback, chat, a second tab, a manual sync-now) it keeps re-reading on the schedule
  // above, so the new numbers appear without a manual refresh. The read that says "not running"
  // is itself the final read: its in-flight check runs before its data reads. It shows only what
  // the read returned.
  const followStartedAt = useRef<number | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const query = trpc.controlCenter.shopSales.useQuery(
    { period },
    {
      refetchInterval: (q) => {
        const d = q.state.data;
        if (d?.available !== true || !d.syncInFlight) {
          followStartedAt.current = null;
          return false;
        }
        followStartedAt.current ??= Date.now();
        const since = Date.now() - followStartedAt.current;
        if (since >= SYNC_POLL_GIVE_UP_MS) return false;
        return since < SYNC_POLL_FAST_FOR_MS ? SYNC_POLL_FAST_MS : SYNC_POLL_SLOW_MS;
      },
    },
  );
  const data = query.data;
  const inFlight = data?.available === true && data.syncInFlight;
  useEffect(() => {
    if (!inFlight) {
      followStartedAt.current = null;
      setGaveUp(false);
      return;
    }
    followStartedAt.current ??= Date.now();
    const t = setTimeout(() => setGaveUp(true), SYNC_POLL_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [inFlight]);
  // The line is on for as long as the server says a probe runs AND we are still following it.
  const following = inFlight && !gaveUp;  // Decided from the period the server answered for, not the chip just tapped. A single day
  // shows its figure only when a successful ShopDriver sync covers it (windowSynced === true).
  const singleDay = data?.available === true && (data.period === "today" || data.period === "yesterday");
  const dayNotShown = singleDay && data.windowSynced !== true;

  return (
    <section
      className="rounded-lg border border-border/40 p-4"
      aria-label="Shop sales"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm text-foreground/60 flex items-center gap-2">
          <DollarSign className="w-4 h-4" /> Billed
        </h2>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Sales period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              aria-pressed={period === p.id}
              className={`min-h-[44px] px-3 rounded text-xs border ${
                period === p.id ? "border-primary text-primary" : "border-border/40 text-foreground/60"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {following && (
        <div role="status" className="mb-2 flex items-center gap-2 text-xs text-foreground/60">
          <Loader2 className="w-3 h-3 animate-spin" /> Syncing the invoice mirror from ShopDriver…
        </div>
      )}

      {query.isLoading && (
        <div className="flex items-center gap-2 text-sm text-foreground/60">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading invoices…
        </div>
      )}

      {/* Unknown is not zero. No number is rendered on this branch at all. */}
      {!query.isLoading && (query.isError || data?.available === false) && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>Sales unreadable: this is UNKNOWN, not $0.</strong>{" "}
            {data?.available === false ? data.reason : "The query failed."}
          </span>
        </div>
      )}

      {/* A day no ShopDriver sync has covered has no invoices YET: say so, print no figure. */}
      {data?.available === true && dayNotShown && (
        <div className="text-sm text-foreground/70">{dayNotShownText(data.period, data.windowSynced, data.sync)}</div>
      )}

      {data?.available === true && !dayNotShown && (
        <>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-semibold tabular-nums">{dollars(data.cents)}</span>
            <span className="text-sm text-foreground/60">
              {data.invoiceCount.toLocaleString()} invoice{data.invoiceCount === 1 ? "" : "s"} · {data.window.label}
            </span>
          </div>

          {/* The lag is part of the number, not a footnote. */}
          <div className="mt-1 text-xs text-foreground/50">
            Billed (invoice date), gross incl. tax · not yet reconciled to the shop report
            {data.throughDate ? ` · mirror current through ${data.throughDate}` : " · mirror through-date unknown"}
            {` · ${syncCaption(data.period, data.sync)}`}
          </div>

          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            aria-expanded={showDetail}
            className="mt-2 min-h-[44px] text-xs text-foreground/60 underline flex items-center gap-1"
          >
            {showDetail ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            What this excludes
          </button>

          {showDetail && (
            <div className="mt-2 text-xs text-foreground/70 space-y-1 border-t border-border/30 pt-2">
              <div>
                Not counted in this window:{" "}
                <strong>{data.exclusions.pendingCount}</strong> pending ({dollars(data.exclusions.pendingCents)}),{" "}
                <strong>{data.exclusions.partialCount}</strong> partial (up to{" "}
                {dollars(data.exclusions.partialCentsFullValue)}),{" "}
                <strong>{data.exclusions.refundedCount}</strong> refunded ({dollars(data.exclusions.refundedCents)}).
              </div>
              {data.exclusions.blankInvoiceNumbers > 0 && (
                <div className="text-amber-400">
                  {data.exclusions.blankInvoiceNumbers} row(s) have no invoice number: dedupe is keyed on it.
                </div>
              )}
              <ul className="list-disc pl-4 space-y-0.5 text-foreground/60">
                {data.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <div className="text-foreground/40">definition: {data.definitionVersion}</div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
