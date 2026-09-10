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
import { Loader2, ChevronRight, Gift, Phone, Check, X, History } from "lucide-react";
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

/**
 * WHO MOVED THIS $300, AND WHEN.
 *
 * Four actions on this record write to audit_log, and until 2026-09-10 nothing
 * read them back: `getAuditTrail` existed with zero callers, baselined as
 * "pre-existing, not individually reviewed". A writer and a reader both
 * orphaned, on the one record here where a dispute costs real money.
 *
 * Its own component on purpose - the query is `enabled` only once the operator
 * opens THIS row, so twenty referrals do not fire twenty audit reads on mount.
 */
function ReferralHistory({ id }: { id: number }) {
  const [show, setShow] = useState(false);
  const q = trpc.technicianReferrals.history.useQuery({ id }, { enabled: show });

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-expanded={show}
        className="inline-flex items-center gap-1 text-[11px] text-foreground/40 hover:text-foreground/70 transition-colors"
      >
        <History className="w-3 h-3" /> {show ? "Hide" : "History"}
      </button>
      {show && (
        <div className="mt-1.5 pl-4 border-l border-border/30">
          {q.isLoading ? (
            <span className="text-[11px] text-foreground/40">Loading&hellip;</span>
          ) : q.isError || q.data?.available === false ? (
            // NOT an empty list. "Nobody touched this record" is the most
            // exonerating thing an audit trail can say, so a failed read must
            // never be able to say it.
            <span className="text-[11px] text-rose-400">
              Couldn&rsquo;t read the audit trail &mdash; this is not &ldquo;no history&rdquo;.
            </span>
          ) : q.data && q.data.rows.length === 0 ? (
            <span className="text-[11px] text-foreground/40">No recorded actions yet.</span>
          ) : (
            <ul className="space-y-0.5">
              {q.data?.rows.map((e: { id: string; actor: string; action: string; createdAt: string | Date }) => (
                <li key={e.id} className="text-[11px] text-foreground/55">
                  <span className="text-foreground/75">{e.action.replace("technician_referral.", "")}</span>
                  {" by "}
                  <span className="text-foreground/75">{e.actor}</span>
                  {" · "}
                  {new Date(e.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function TechnicianReferralsPanel() {
  const [open, setOpen] = useState(true);
  const utils = trpc.useUtils();
  const { data, isLoading, isError, error } = trpc.technicianReferrals.list.useQuery(undefined, { enabled: open });
  // Candidates who named a referrer but have no structured referral row. The
  // submit path is deliberately soft-fail so a referral write can never break
  // the applicant's own submission; this is the other half of that decision.
  // Without a surface, a lost $300 obligation exists only as free text in
  // candidates.message that nothing renders — which is a producer with no
  // consumer, the shape this repo has the most recorded history of shipping.
  const orphans = trpc.technicianReferrals.orphans.useQuery(undefined, { enabled: open });

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
    onError: (err) => toast.error(err.message || "Couldn't update this referral."),
  });
  const disqualify = trpc.technicianReferrals.disqualify.useMutation({
    onSuccess: () => { toast.success("Disqualified."); invalidate(); },
    onError: () => toast.error("Couldn't update this referral."),
  });
  // Distinct from disqualify on purpose: the claim was GOOD and the referrer
  // did nothing wrong — the referred tech simply left before 90 days. Pressing
  // Disqualify for that recorded a judgment about the referrer that the facts
  // did not support, and it was the only option available until now.
  const markForfeited = trpc.technicianReferrals.markForfeited.useMutation({
    onSuccess: () => { toast.success("Marked forfeited — no bonus owed."); invalidate(); },
    onError: (err) => toast.error(err.message || "Couldn't update this referral."),
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
          {/* Reconciliation exceptions come FIRST: an unpaid $300 obligation
              matters more than the list of ones already recorded, and it must
              not be something the operator has to scroll past the happy path
              to notice. */}
          {orphans.data?.available && orphans.data.rows.length > 0 && (
            <div className="mb-3 border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-400">
              <strong>
                {orphans.data.rows.length} referral{orphans.data.rows.length === 1 ? "" : "s"} need
                reconciling.
              </strong>{" "}
              These applicants named a referrer, but no structured referral was recorded — the
              claim survives only as text on the application. Someone is owed $300 and the
              program cannot see it.
              <ul className="mt-2 space-y-1">
                {orphans.data.rows.slice(0, 8).map((o: { id: number; name: string; createdAt: string | Date | null; referredBy: string }) => (
                  <li key={o.id} className="text-amber-300/90">
                    #{o.id} · {o.name} — referred by {o.referredBy}
                    {o.createdAt ? ` · ${new Date(o.createdAt).toLocaleDateString()}` : ""}
                  </li>
                ))}
              </ul>
              {orphans.data.rows.length > 8 && (
                <p className="mt-1 opacity-70">…and {orphans.data.rows.length - 8} more.</p>
              )}
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-foreground/40">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading&hellip;
            </div>
          ) : isError ? (
            <div className="border border-red-500/40 bg-red-500/10 p-3 text-[12px] text-red-400">
              <strong>Couldn't load referrals.</strong> {error?.message || "Unknown error."} This is
              not the same as zero referrals — retry rather than treating this as empty.
            </div>
          ) : data?.available === false ? (
            // getTechnicianReferrals returns available:false when the DB
            // connection is gone. Without this branch the panel fell through to
            // "No technician referrals recorded yet" — a confident zero on a
            // program that owes $300 per referral.
            <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-400">
              <strong>Database unavailable.</strong> Referrals could not be read, so this
              is not "none recorded" — it is "we don't know".
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
                    {/* WHO WAS REFERRED. The panel showed only the referrer,
                        so the one question this program exists to answer —
                        who referred whom — was unanswerable at the surface
                        even though the row held the link. */}
                    {r.candidateName ? (
                      <span className="text-foreground/60">
                        &rarr; <span className="font-medium text-foreground/80">{r.candidateName}</span>
                      </span>
                    ) : (
                      <span
                        className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px] font-bold uppercase tracking-wider"
                        title="This referral is not linked to a candidate record — either the association failed verification at write time, or the candidate row is gone. The payout cannot be substantiated from this row alone."
                      >
                        unlinked
                      </span>
                    )}
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
                      {r.status === "eligible" && (() => {
                        const stillWaiting = r.eligibleAt ? new Date(r.eligibleAt).getTime() > Date.now() : true;
                        return (
                          <button
                            type="button"
                            onClick={() => markPaid.mutate({ id: r.id })}
                            disabled={markPaid.isPending || stillWaiting}
                            title={stillWaiting ? "The 90-day wait isn't up yet." : undefined}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15 rounded transition-colors disabled:opacity-50"
                          >
                            <Check className="w-3 h-3" /> Mark paid
                          </button>
                        );
                      })()}
                      {r.status === "eligible" && (() => {
                        // Once eligibleAt has passed the bonus is EARNED, so
                        // forfeiting stops being a status edit and becomes
                        // refusing a debt. Mirror image of Mark Paid, which is
                        // disabled while the clock is still running. The server
                        // refuses this too — the disable is the affordance, not
                        // the guard.
                        const clockUp = r.eligibleAt ? new Date(r.eligibleAt).getTime() <= Date.now() : false;
                        return (
                        <button
                          type="button"
                          disabled={markForfeited.isPending || clockUp}
                          title={clockUp ? "The 90 days are up — this bonus is owed and can't be forfeited here." : undefined}
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: "Did this technician leave before 90 days?",
                              message:
                                "Forfeits the bonus without disqualifying the referral — the claim was good, the 90-day condition just wasn't met. Use Disqualify only when the claim itself was invalid.",
                              confirmLabel: "Mark forfeited",
                              tone: "danger",
                            });
                            if (ok) {
                              markForfeited.mutate({
                                id: r.id,
                                reason: r.candidateName
                                  ? `Left before 90 days · referred ${r.candidateName}`
                                  : "Left before 90 days · referral was NOT linked to a candidate record",
                              });
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/15 rounded transition-colors disabled:opacity-50"
                        >
                          <X className="w-3 h-3" /> Forfeit
                        </button>
                        );
                      })()}
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
                            // The reason column is varchar(500) and was
                            // receiving a constant, so it recorded nothing a
                            // later dispute could use. This is not the full
                            // fix — free-text capture needs an input on
                            // ConfirmDialog, and window.prompt is banned in
                            // client/src because iOS standalone suppresses it
                            // silently — but it at least records the two facts
                            // that matter when someone contests a lost $300:
                            // whether the referral was linked to a real
                            // candidate, and who it named.
                            if (ok) {
                              disqualify.mutate({
                                id: r.id,
                                reason: r.candidateName
                                  ? `Disqualified by admin · referred ${r.candidateName}`
                                  : "Disqualified by admin · referral was NOT linked to a candidate record",
                              });
                            }
                          }}
                          disabled={disqualify.isPending}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/15 rounded transition-colors disabled:opacity-50"
                        >
                          <X className="w-3 h-3" /> Disqualify
                        </button>
                      )}
                    </div>
                    <ReferralHistory id={r.id} />
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
