/**
 * Attribution review: the door for the human ruling on weak call-to-sale matches.
 *
 * 2026-09-01: `revenueAttribution.reviewQueue` and `.resolve` existed with no UI; this card is
 * the door. 2026-09-18: the queue collapses same-invoice claims (an invoice is paid once).
 * 2026-10-25 (Nour: "big bulky ugly and all in the way... only got numbers and i cant track
 * them"): one line until opened, nothing when empty, and each row in words: who, what they
 * asked for, when they called, the sale and why the match is weak. The explanation sits
 * behind a Why disclosure.
 *
 * iOS PWA: rulings go through `confirmDialog` (two-tap), never window.confirm; every target
 * is at least 44 px tall.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { CheckCircle2, ChevronDown, HelpCircle, Loader2, XCircle } from "lucide-react";
import { prettyOutcome } from "./format";

type Decision = "confirmed" | "rejected" | "ambiguous";

const ET = "America/New_York";
const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: ET, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
// invoices.invoiceDate holds the SHOP DAY as stored digits (server/__tests__/invoiceDateShopLocal.test.ts);
// a date-only ticket sits at 00:00:00, so an ET conversion would show the day before. Format the digits.
const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }) : null;
// Cents stay: the total is how the operator recognises the ticket, so $412.50 must not read $413.
const fmtMoney = (cents: number | null) =>
  cents == null
    ? null
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);

export function AttributionReviewCard() {
  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.revenueAttribution.reviewQueue.useQuery(
    { limit: 20 },
    { staleTime: 60_000 },
  );
  const [open, setOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const resolve = trpc.revenueAttribution.resolve.useMutation({
    onSuccess: () => {
      toast.success("Ruling saved");
      void utils.revenueAttribution.reviewQueue.invalidate();
      void utils.revenueAttribution.leadRevenueSummary.invalidate();
      void utils.revenueAttribution.callInvoiceReview.invalidate();
    },
    onError: (e) => toast.error(e.message || "Could not save the ruling"),
    onSettled: () => setBusyKey(null),
  });

  // A failed read is not an empty queue: say so and offer the retry.
  if (isError) {
    return (
      <div className="border border-amber-400/30 bg-amber-500/5 p-4 text-sm text-amber-200 flex items-center justify-between gap-3">
        <span>Matches to review could not load.</span>
        <button type="button" onClick={() => refetch()} className="min-h-[44px] px-3 text-primary hover:underline">Retry</button>
      </div>
    );
  }
  if (isLoading) return null;

  /*
   * `data.rows` is read explicitly: reviewQueue returns an object, and an `as Array` cast once
   * kept typecheck green through that shape change while `.map` threw at render.
   */
  const rows = (data?.rows ?? []) as Array<{
    runId?: string | number | null;
    callId: number;
    leadId?: number | null;
    bookingId?: number | null;
    invoiceId?: number | null;
    workOrderId?: string | null;
    matchMethod?: string | null;
    firstName?: string | null;
    askedFor?: string | null;
    calledAt?: string | null;
    callOutcome?: string | null;
    invoicedAt?: string | null;
    invoiceTotalCents?: number | null;
    invoiceService?: string | null;
    band?: { label: string; why?: string; observed: boolean } | null;
  }>;
  if (rows.length === 0) return null;

  const duplicates = data?.duplicates?.length ?? 0;
  const n = rows.length;

  const decide = async (row: (typeof rows)[number], decision: Decision) => {
    const who = row.firstName ?? "this caller";
    const sale = [fmtDay(row.invoicedAt ?? null), fmtMoney(row.invoiceTotalCents ?? null)].filter(Boolean).join(", ");
    const copy = {
      confirmed: { title: `${who} came in because of this call?`, label: "Yes, confirm", tone: "default" as const },
      rejected: { title: `Not this call?`, label: "Not this call", tone: "danger" as const },
      ambiguous: { title: `Leave it unsure?`, label: "Unsure", tone: "default" as const },
    }[decision];
    const ok = await confirmDialog({
      title: copy.title,
      message: `${who} called${row.calledAt ? ` ${fmtWhen(row.calledAt)}` : ""}${row.askedFor ? ` about ${row.askedFor}` : ""}.${sale ? ` Sale ${sale}.` : ""} Your ruling becomes the record.`,
      confirmLabel: copy.label,
      tone: copy.tone,
    });
    if (!ok) return;
    setBusyKey(`${row.callId}:${decision}`);
    resolve.mutate({
      callId: row.callId,
      leadId: row.leadId ?? null,
      bookingId: row.bookingId ?? null,
      invoiceId: row.invoiceId ?? null,
      workOrderId: row.workOrderId ?? null,
      decision,
      // A human ruling is the strongest evidence class the contract defines.
      evidenceLevel: "verified",
      matchMethod: (row.matchMethod && row.matchMethod.length >= 3 ? row.matchMethod : "operator_review").slice(0, 64),
      confidence: decision === "confirmed" ? 1 : decision === "rejected" ? 0 : null,
      evidence: { via: "admin.attribution_review_card", queuedRunId: row.runId ?? null },
    });
  };

  return (
    <div className="border border-border/40 bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-h-[48px] px-4 py-2 flex items-center justify-between gap-3 text-left text-sm"
      >
        <span className="font-semibold">{n} match{n === 1 ? "" : "es"} to review</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-foreground/50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Each is a call with a possible sale behind it and no record that proves the link. Each row says what the match rests on.{" "}
            <button
              type="button"
              onClick={() => setWhyOpen((v) => !v)}
              aria-expanded={whyOpen}
              className="min-h-[48px] -my-3 px-1 text-primary hover:underline"
            >
              Why{whyOpen ? " (hide)" : ""}
            </button>
          </p>

          {whyOpen && (
            <div className="text-xs text-muted-foreground border border-border/20 rounded p-2 space-y-1">
              {duplicates > 0 && (
                <p>
                  {duplicates} repeat call{duplicates === 1 ? "" : "s"} from the same customer{duplicates === 1 ? " is" : " are"} folded into these: a sale is counted once, the other calls are kept as history.
                  {data?.counts.overcountFactor != null && data.counts.overcountFactor > 1 && (
                    <> Counting every call would overstate the money by {data.counts.overcountFactor}x.</>
                  )}
                </p>
              )}
              {data?.bands && data.bands.total > 0 && (
                <p>
                  {data.bands.verified > 0 && <>{data.bands.verified} with a recorded link · </>}
                  {data.bands.strong > 0 && <>{data.bands.strong} with the service matching · </>}
                  {data.bands.weak > 0 && <>{data.bands.weak} on phone and timing only · </>}
                  {data.bands.unscored > 0 && <>{data.bands.unscored} with no single sale or a contested lead link</>}
                </p>
              )}
              <p className="text-foreground/50">{data?.bandCaveat}</p>
            </div>
          )}

          <ul className="divide-y divide-border/30">
            {rows.map((row) => {
              const busy = busyKey?.startsWith(`${row.callId}:`) ?? false;
              const outcome = row.callOutcome ? prettyOutcome(row.callOutcome).label : null;
              return (
                <li key={`${row.callId}:${row.invoiceId ?? "x"}`} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-xs space-y-0.5">
                    <div className="text-sm font-medium text-foreground">
                      {row.firstName ?? "Unknown caller"}
                      <span className="font-normal text-muted-foreground">
                        {row.askedFor ? <> · asked about {row.askedFor}</> : <> · did not say what for</>}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Called {fmtWhen(row.calledAt ?? null) ?? "(time unknown)"}
                      {outcome ? <> · {outcome.toLowerCase()}</> : null}
                      {row.invoiceId ? (
                        <>
                          {" "}· Sale {fmtDay(row.invoicedAt ?? null) ?? ""} {fmtMoney(row.invoiceTotalCents ?? null) ?? ""}
                          {row.invoiceService ? <span className="text-foreground/50"> ({row.invoiceService.toLowerCase()})</span> : null}
                        </>
                      ) : (
                        <> · no one sale to confirm</>
                      )}
                    </div>
                    {/* Weak phone/time attribution stays visibly labelled as inferred
                        (docs/CURRENT-TRUTH.md, measurement contract); the sentence after
                        the label says why. */}
                    {row.band && (
                      <div className={row.band.observed ? "text-emerald-400/80" : "text-amber-400/80"}>
                        <span className="font-medium">{row.band.observed ? "Recorded" : "Inferred"}</span>
                        {" · "}
                        {row.band.why ?? row.band.label}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => decide(row, "confirmed")}
                      disabled={busy}
                      className="min-h-[48px] min-w-[48px] px-3 inline-flex items-center gap-1 text-xs font-medium rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                      aria-label={`Confirm: ${row.firstName ?? "unknown caller"} came in because of this call`}
                    >
                      {busy && busyKey?.endsWith(":confirmed") ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(row, "ambiguous")}
                      disabled={busy}
                      className="min-h-[48px] min-w-[48px] px-3 inline-flex items-center gap-1 text-xs font-medium rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                      aria-label={`Unsure about ${row.firstName ?? "unknown caller"}`}
                    >
                      <HelpCircle className="w-4 h-4" /> Unsure
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(row, "rejected")}
                      disabled={busy}
                      className="min-h-[48px] min-w-[48px] px-3 inline-flex items-center gap-1 text-xs font-medium rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                      aria-label={`Reject: ${row.firstName ?? "unknown caller"} did not come in because of this call`}
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
