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
 *    controlCenter.todayPulse exclude "sales today" deliberately. A single day
 *    newer than the mirror (`windowAfterThrough`) renders "Not synced yet" and the
 *    through-date INSTEAD of the figure: not synced is not $0. A synced day with
 *    no invoices (a holiday) is a real $0 and still shows it.
 *
 * 3. It never renders a failed read as $0. The procedure returns a discriminated
 *    union, so the unavailable branch has no number to show.
 *
 * The exclusions are one tap away rather than on the face of the card: the
 * operator scanning his phone needs the figure and the lag; the person
 * reconciling it needs pending/partial/refunded, and they are the same person on
 * a different day.
 */
import { useEffect, useState } from "react";
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

/**
 * SYNC ON A PAGE LOAD (Nour, 2026-10-21, "Refresh syncs anytime"). This card is on the
 * Today page, the /admin landing, so its first mount in a document is a load or refresh.
 * The server throttles to one ShopDriver sync per 30 min at any hour and accepts that
 * each one logs the shop counter out. This flag lives for the document, so a chip tap or
 * an in-app return to the page is not a load; a browser refresh resets it. A deep link
 * to another admin page does not sync until Today is opened (move this to the shell to
 * change that). The marker is a property of `window`, so a test starts a new document
 * by deleting it.
 */
const LOAD_SYNC_MARK = "__shopSalesLoadSyncAsked";
function claimLoadSync(): boolean {
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[LOAD_SYNC_MARK]) return false;
  w[LOAD_SYNC_MARK] = true;
  return true;
}
const SYNC_POLL_MS = 15_000;
const SYNC_POLL_MAX_MS = 3 * 60_000;

export default function SalesCard() {
  const [period, setPeriod] = useState<Period>("last_7d");
  const [showDetail, setShowDetail] = useState(false);
  // True only after the server says it started a probe; re-reads this card while it lands.
  const [syncing, setSyncing] = useState(false);
  const { mutate: syncOnLoad } = trpc.shopdriver.syncOnAdminLoad.useMutation({
    onSuccess: (r) => {
      if (r.started) setSyncing(true);
    },
  });
  useEffect(() => {
    if (claimLoadSync()) syncOnLoad();
  }, [syncOnLoad]);
  useEffect(() => {
    if (!syncing) return;
    const t = setTimeout(() => setSyncing(false), SYNC_POLL_MAX_MS);
    return () => clearTimeout(t);
  }, [syncing]);
  const query = trpc.controlCenter.shopSales.useQuery(
    { period },
    { refetchInterval: syncing ? SYNC_POLL_MS : false },
  );
  const data = query.data;
  // Decided from the period the server answered for, not the chip just tapped.
  const notSynced =
    data?.available === true && (data.period === "today" || data.period === "yesterday") && data.windowAfterThrough;

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

      {syncing && (
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

      {/* A day newer than the mirror has no invoices YET: say so, print no figure. */}
      {data?.available === true && notSynced && (
        <div className="text-sm text-foreground/70">
          {data.throughDate
            ? `Not synced yet. The invoice mirror is current through ${data.throughDate}.`
            : "Not synced yet. The invoice mirror has no through-date."}
        </div>
      )}

      {data?.available === true && !notSynced && (
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
