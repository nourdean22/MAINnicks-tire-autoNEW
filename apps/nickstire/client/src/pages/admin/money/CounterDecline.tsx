/**
 * Q-37 · how each declined estimate is known, and the one-tap counter capture.
 *
 * "Declined" on this screen used to mean one thing: an ALG estimate with no
 * matching invoice. That is an INFERENCE (the matcher found nothing). A tap on
 * DECLINED records an OBSERVATION — the customer said no at the counter — in
 * declined_work_captures. The badge and strip keep the two visibly apart.
 *
 * The tap contacts no one and does not change what the recovery SMS lane sends.
 * One tap, no confirm: the write is additive, idempotent (a second tap reports
 * the first), and has no customer-facing effect. No native dialogs — they are
 * suppressed in iOS standalone mode (nickstire-ios-pwa-primitives).
 */
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { DECLINE_PROVENANCE_LABEL, type DeclineProvenance } from "@shared/declineProvenance";

const BADGE_TONE: Record<DeclineProvenance, string> = {
  counter: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  inferred: "bg-foreground/5 text-foreground/50 border-foreground/15",
  unknown: "bg-amber-500/10 text-amber-400 border-amber-500/30",
};

export function DeclineProvenanceBadge({ provenance }: { provenance: DeclineProvenance }) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 font-semibold border ${BADGE_TONE[provenance]}`}
      title={
        provenance === "counter"
          ? "Recorded at the counter: the customer said no."
          : provenance === "inferred"
            ? "No invoice matched this estimate. The customer may have declined — or paid under another phone, or the invoice never mirrored."
            : "Counter captures could not be read, so it is unknown whether this decline was observed."
      }
    >
      {DECLINE_PROVENANCE_LABEL[provenance].toUpperCase()}
    </span>
  );
}

export function DeclineProvenanceStrip({
  captureStatus,
  counts,
}: {
  captureStatus: "ok" | "not_enabled" | "error";
  counts: Record<DeclineProvenance, number>;
}) {
  if (captureStatus === "error") {
    return (
      <p className="text-[12px] text-amber-400">
        Counter captures couldn&apos;t load — which of these declines were observed is unknown.
      </p>
    );
  }
  if (captureStatus === "not_enabled") {
    return (
      <p className="text-[12px] text-foreground/50">
        Counter capture is not enabled yet (migration 0132 pending), so every decline below is inferred from
        &ldquo;no matching invoice&rdquo;.
      </p>
    );
  }
  return (
    <p className="text-[12px] text-foreground/50">
      How we know: <span className="text-emerald-400 font-semibold">{counts.counter} declined at counter</span>
      {" · "}
      <span>{counts.inferred} inferred (no matching invoice)</span>
    </p>
  );
}

/** Own mutation per row, so one row's pending state never disables the others. */
export function CounterDeclineButton({ estimateId, provenance }: { estimateId: number; provenance: DeclineProvenance }) {
  const utils = trpc.useUtils();
  const capture = trpc.invoices.captureDecline.useMutation({
    onSuccess: (r) => {
      utils.invoices.declined.invalidate();
      if (r.kind === "already_captured") toast.info("Already recorded as declined at the counter");
      else toast.success("Recorded: customer declined at the counter");
    },
    onError: (err) => toast.error(err.message.slice(0, 160)),
  });
  if (provenance === "counter") return null;
  return (
    <button
      type="button"
      onClick={() => capture.mutate({ id: estimateId })}
      disabled={capture.isPending}
      aria-label="Customer declined at the counter"
      title="The customer said no at the counter — record it (contacts no one)"
      className="min-h-12 min-w-12 px-3 bg-emerald-500/10 text-emerald-400 text-[11px] font-bold tracking-wide border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
    >
      DECLINED
    </button>
  );
}
