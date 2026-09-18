/**
 * Attribution review — the door the human step never had (2026-09-01 audit,
 * artifact 4 §2.6).
 *
 * `revenueAttribution.reviewQueue` and `.resolve` existed on the server —
 * `resolve` is the ONLY writer of `revenue_attribution_decisions` — and no
 * surface anywhere called either. CURRENT-TRUTH listed "resolving weak invoice
 * or customer matches" as a manual operator system; the machinery had no UI.
 *
 * iOS PWA: decisions go through `confirmDialog` (two-tap), never
 * window.confirm; every target is ≥ 44px tall.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { CheckCircle2, HelpCircle, XCircle, SearchCheck, Loader2 } from "lucide-react";

type Decision = "confirmed" | "rejected" | "ambiguous";

export function AttributionReviewCard() {
  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.revenueAttribution.reviewQueue.useQuery(
    { limit: 20 },
    { staleTime: 60_000 },
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const resolve = trpc.revenueAttribution.resolve.useMutation({
    onSuccess: () => {
      toast.success("Attribution recorded");
      void utils.revenueAttribution.reviewQueue.invalidate();
      void utils.revenueAttribution.leadRevenueSummary.invalidate();
      void utils.revenueAttribution.callInvoiceReview.invalidate();
    },
    onError: (e) => toast.error(e.message || "Could not record the decision"),
    onSettled: () => setBusyKey(null),
  });

  if (isLoading) {
    return (
      <div className="border border-border/40 bg-card p-4 text-[11px] font-bold uppercase tracking-[0.18em] text-foreground/30">
        Loading attribution review queue…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="border border-amber-400/30 bg-amber-500/5 p-4 text-sm text-amber-200 flex items-center justify-between gap-3">
        <span>Attribution review queue unavailable.</span>
        <button onClick={() => refetch()} className="min-h-[44px] px-3 text-primary hover:underline">Retry</button>
      </div>
    );
  }

  /*
   * 2026-09-18 - reviewQueue now returns an OBJECT, not an array, because an
   * invoice can be paid once and so can be claimed once. Live that day: of 20
   * weak matches, EIGHT claimed invoice #5160005 - one customer who rang eight
   * times - and each row read "this call produced this invoice". Confirming
   * them all would have counted that invoice eight times.
   *
   * NOTE THE CAST BELOW WAS WHY TYPECHECK STAYED GREEN through that shape
   * change: `as Array<...>` asserts rather than checks, so `.map` would have
   * thrown at render while every gate passed. Reading `data?.rows` explicitly
   * is the fix; the cast is kept only to name the row fields.
   */
  const rows = (data?.rows ?? []) as Array<{
    runId?: number | null;
    callId: number;
    leadId?: number | null;
    bookingId?: number | null;
    invoiceId?: number | null;
    workOrderId?: string | null;
    evidenceLevel?: string | null;
    matchMethod?: string | null;
    evidence?: unknown;
    createdAt?: string | Date | null;
    latest?: string | null;
  }>;

  const decide = async (row: (typeof rows)[number], decision: Decision) => {
    const label = decision === "confirmed" ? "Confirm" : decision === "rejected" ? "Reject" : "Mark ambiguous";
    const ok = await confirmDialog({
      title: `${label} this match?`,
      message:
        `Call #${row.callId}` +
        (row.invoiceId ? ` ↔ invoice #${row.invoiceId}` : "") +
        (row.leadId ? ` · lead #${row.leadId}` : "") +
        (row.matchMethod ? ` · matched by ${row.matchMethod}` : "") +
        `. Your ruling becomes the attribution record.`,
      confirmLabel: label,
      tone: decision === "rejected" ? "danger" : "default",
    });
    if (!ok) return;
    const key = `${row.callId}:${decision}`;
    setBusyKey(key);
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
    <div className="border border-border/40 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <SearchCheck className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Attribution review · {rows.length} weak match{rows.length === 1 ? "" : "es"}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No call ↔ invoice matches are waiting for a ruling.</p>
      ) : (
        <ul className="divide-y divide-border/30">
          {/* Same-invoice contacts are collapsed, never silently dropped. An
              operator who sees eight rows become one deserves to know why, and
              a queue that shrinks without explaining itself is a queue nobody
              trusts. */}
          {(data?.duplicates?.length ?? 0) > 0 && (
            <div className="mb-3 text-xs text-muted-foreground bg-amber-500/5 border border-amber-500/20 rounded p-2">
              <span className="text-amber-400 font-medium">
                {data!.duplicates.length} same-invoice contact(s) collapsed
              </span>
              {" "}across {data!.contestedInvoiceIds.length} invoice(s). An invoice can be
              paid once, so it is claimed once - the rest are the same customer
              calling again, kept as history rather than counted as separate money.
              {data!.counts.overcountFactor != null && data!.counts.overcountFactor > 1 && (
                <span className="block mt-1">
                  Counting each row as a conversion would have overstated attributed
                  revenue by {data!.counts.overcountFactor}x.
                </span>
              )}
            </div>
          )}
          {rows.map((row) => {
            const rowKey = `${row.callId}:${row.invoiceId ?? "x"}:${row.runId ?? "x"}`;
            const busy = busyKey?.startsWith(`${row.callId}:`) ?? false;
            return (
              <li key={rowKey} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-xs">
                  <div className="font-medium text-foreground">
                    Call #{row.callId}
                    {row.invoiceId ? <> ↔ invoice #{row.invoiceId}</> : <span className="text-muted-foreground"> · no invoice</span>}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {row.matchMethod ?? "unknown method"} · {row.evidenceLevel ?? "no evidence level"}
                    {row.leadId ? ` · lead #${row.leadId}` : ""}
                    {row.workOrderId ? ` · WO ${row.workOrderId}` : ""}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => decide(row, "confirmed")}
                    disabled={busy}
                    className="min-h-[48px] min-w-[48px] px-3 inline-flex items-center gap-1 text-xs font-medium rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                    aria-label={`Confirm match for call ${row.callId}`}
                  >
                    {busy && busyKey?.endsWith(":confirmed") ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Confirm
                  </button>
                  <button
                    onClick={() => decide(row, "ambiguous")}
                    disabled={busy}
                    className="min-h-[48px] min-w-[48px] px-3 inline-flex items-center gap-1 text-xs font-medium rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                    aria-label={`Mark match ambiguous for call ${row.callId}`}
                  >
                    <HelpCircle className="w-4 h-4" /> Unsure
                  </button>
                  <button
                    onClick={() => decide(row, "rejected")}
                    disabled={busy}
                    className="min-h-[48px] min-w-[48px] px-3 inline-flex items-center gap-1 text-xs font-medium rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    aria-label={`Reject match for call ${row.callId}`}
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
