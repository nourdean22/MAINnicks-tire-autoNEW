/**
 * TechnicianReferralsPanel — admin visibility + payout tracking for the
 * $300-after-90-days TECHNICIAN referral bonus advertised on /careers.
 *
 * Before drizzle/0121_technician_referrals.sql, this bonus was advertised
 * with no backing record: the referrer's name lived only inside a free-text
 * note concatenated onto the applicant's `leads.problem` field, so the shop
 * had no reliable way to know who referred whom, verify the 90-day
 * condition, or pay the bonus without a dispute.
 *
 * Separate from the customer $25/$25 program at /refer (server/routers/
 * services.ts referralsRouter) — do not conflate the two in this UI.
 *
 * Empty-vs-error, same discipline as the Lot section's vehicle_visits read:
 * `migrationPending` means "0121 not applied to this database yet", which is
 * a different fact from "no referrals have come in" and must render
 * differently rather than both collapsing to the same blank list.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, ChevronRight, Gift, Phone, Check, X } from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

const STATUS_STYLE: Record<string, string> = {
  pending: "text-amber-400 bg-amber-500/10",
  eligible: "text-sky-400 bg-sky-500/10",
  paid: "text-emerald-400 bg-emerald-500/10",
  disqualified: "text-red-400 bg-red-500/10",
  forfeited: "text-foreground/40 bg-foreground/5",
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

export function TechnicianReferralsPanel() {
  const [open, setOpen] = useState(true);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.technicianReferrals.list.useQuery(undefined, { enabled: open });

  const invalidate = () => utils.technicianReferrals.list.invalidate();
  const markHired = trpc.technicianReferrals.markHired.useMutation({
    onSuccess: (r) => {
      toast.success(`Marked hired — eligible ${new Date(r.eligibleAt).toLocaleDateString()}`);
      invalidate();
    },
    onError: () => toast.error("Couldn't update this referral."),
  });
  const markPaid = trpc.technicianReferrals.markPaid.useMutation({
    onSuccess: () => { toast.success("Marked paid."); invalidate(); },
    onError: () => toast.error("Couldn't update this referral."),
  });
  const disqualify = trpc.technicianReferrals.disqualify.useMutation({
    onSuccess: () => { toast.success("Disqualified."); invalidate(); },
    onError: () => toast.error("Couldn't update this referral."),
  });

  const rows = data?.rows ?? [];

  return (
    <div className="rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
          <Gift className="w-4 h-4 text-primary" />
          Technician Referrals
          <span className="text-[11px] font-normal text-foreground/40">
            $300 after 90 days &mdash; separate from the $25 customer program
          </span>
        </span>
        <ChevronRight className={`w-4 h-4 text-foreground/40 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border/20 px-4 py-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-foreground/40">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading&hellip;
            </div>
          ) : data?.migrationPending ? (
            <div className="border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-400">
              <strong>Referral tracking isn't live yet.</strong> The database migration
              (drizzle/0121_technician_referrals.sql) hasn't been applied to this
              environment. New referrals from /careers still save &mdash; the
              referrer's name is preserved in the applicant's own notes until this
              is applied, but nothing here is trackable or payable yet.
            </div>
          ) : rows.length === 0 ? (
            <p className="text-[12px] text-foreground/40">
              No technician referrals recorded yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => {
                const statusStyle = STATUS_STYLE[r.status] ?? "text-foreground/50 bg-foreground/5";
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] border border-border/20 rounded-lg px-3 py-2"
                  >
                    <span className={`px-1.5 py-0.5 rounded font-bold uppercase tracking-wider text-[10px] shrink-0 ${statusStyle}`}>
                      {r.status}
                    </span>
                    <span className="font-semibold text-foreground/85">{r.referrerName}</span>
                    {r.referrerPhone && (
                      <a
                        href={`tel:${r.referrerPhone}`}
                        className="inline-flex items-center gap-1 text-primary hover:opacity-80"
                      >
                        <Phone className="w-3 h-3" /> {r.referrerPhone}
                      </a>
                    )}
                    {r.positionTitle && (
                      <span className="text-foreground/45">referred for {r.positionTitle}</span>
                    )}
                    <span className="text-foreground/45">{formatCents(r.bonusAmountCents)}</span>
                    {r.eligibleAt && (
                      <span className="text-foreground/35">
                        eligible {new Date(r.eligibleAt).toLocaleDateString()}
                      </span>
                    )}
                    <span className="text-foreground/30">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>

                    <div className="ml-auto flex items-center gap-1.5 shrink-0">
                      {r.status === "pending" && (
                        <button
                          type="button"
                          onClick={() => markHired.mutate({ id: r.id })}
                          disabled={markHired.isPending}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/15 rounded transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" /> Mark hired
                        </button>
                      )}
                      {r.status === "eligible" && (
                        <button
                          type="button"
                          onClick={() => markPaid.mutate({ id: r.id })}
                          disabled={markPaid.isPending}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15 rounded transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" /> Mark paid
                        </button>
                      )}
                      {(r.status === "pending" || r.status === "eligible") && (
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: "Disqualify this referral?",
                              message: "This removes it from the payout queue. This can't be undone from here.",
                              confirmLabel: "Disqualify",
                              tone: "danger",
                            });
                            if (ok) disqualify.mutate({ id: r.id, reason: "Disqualified by admin" });
                          }}
                          disabled={disqualify.isPending}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/15 rounded transition-colors disabled:opacity-50"
                        >
                          <X className="w-3 h-3" /> Disqualify
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
