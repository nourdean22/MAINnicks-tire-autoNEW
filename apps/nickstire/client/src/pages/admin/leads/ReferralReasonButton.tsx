/**
 * WHY a $300 technician-referral bonus was refused — captured, not templated.
 *
 * THE DEFECT (2026-09-10). Disqualify and Forfeit both sent a CANNED string:
 * `Disqualified by admin · referred ${candidateName}`. The column is
 * varchar(500), the audit row is attributable and timestamped, and the panel
 * now renders the recorded reason — and all of that carried a sentence that
 * says nothing about why. In a contested payout the record answered who and
 * when, and restated the question.
 *
 * WHY CHIPS AND NOT A TEXT BOX. `window.prompt` is suppressed in iOS PWA
 * standalone — it returns null with no UI, which is the single most-recurring
 * bug class in this codebase (5+ waves) — and ConfirmDialog cannot capture free
 * text. The proven replacement here is LostReasonButton's inline-expandable
 * CHIP list, and it is better than a text box for this job rather than a
 * consolation: the reasons become a small closed vocabulary, so "how many
 * claims were self-referrals" is answerable later, and the operator taps twice
 * instead of typing on a phone.
 *
 * ONE component for two actions because they are structurally identical, not a
 * general "reason primitive" — the skill's YAGNI rule is against inventing a
 * primitive for one call site, and the shape here is two call sites with the
 * same anatomy.
 *
 * The chip tap IS the second tap of the two-tap confirm this repo requires in
 * place of window.confirm, so it replaces the old confirmDialog round-trip
 * rather than adding a step.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { X } from "lucide-react";

/**
 * Closed vocabularies, chosen so each answers a DIFFERENT question a referrer
 * could raise. "Other" exists because a forced-choice list that cannot express
 * the real cause gets answered with the nearest wrong chip, which is worse than
 * an honest catch-all.
 */
const DISQUALIFY_REASONS = [
  "Self-referral",
  "Referrer not an employee",
  "Applicant was not referred",
  "Duplicate claim",
  "Other",
] as const;

/**
 * Forfeit already means "hired, then left inside 90 days" — these distinguish
 * HOW, which is the part that decides whether the referrer could have known.
 */
const FORFEIT_REASONS = [
  "Quit before 90 days",
  "Terminated for cause",
  "Never started",
  "No-showed after hire",
  "Other",
] as const;

type Action = "disqualify" | "forfeit";

export function ReferralReasonButton({
  referralId,
  action,
  candidateName,
  disabled,
  disabledTitle,
}: {
  referralId: number;
  action: Action;
  candidateName?: string | null;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);

  const isDq = action === "disqualify";
  const reasons = isDq ? DISQUALIFY_REASONS : FORFEIT_REASONS;

  const done = (msg: string) => {
    toast.success(msg);
    void utils.technicianReferrals.list.invalidate();
    setExpanded(false);
  };

  const disqualify = trpc.technicianReferrals.disqualify.useMutation({
    onSuccess: () => done("Disqualified."),
    onError: (err) => toast.error(err.message || "Couldn't update this referral."),
  });
  const forfeit = trpc.technicianReferrals.markForfeited.useMutation({
    onSuccess: () => done("Marked forfeited — no bonus owed."),
    onError: (err) => toast.error(err.message || "Couldn't update this referral."),
  });
  const mutation = isDq ? disqualify : forfeit;

  /**
   * The chosen reason, plus the two facts a later dispute needs and the chip
   * cannot carry: whether the referral was linked to a real candidate record,
   * and who it named. Those were the only content the old canned string had,
   * so keeping them means this strictly adds information.
   */
  const submit = (reason: string) => {
    const who = candidateName ? `referred ${candidateName}` : "NOT linked to a candidate record";
    mutation.mutate({ id: referralId, reason: `${reason} · ${who}` });
  };

  const tone = isDq
    ? { border: "border-red-500/30", text: "text-red-400", bg: "hover:bg-red-500/10", soft: "bg-red-500/5" }
    : { border: "border-amber-500/30", text: "text-amber-400", bg: "hover:bg-amber-500/15", soft: "bg-amber-500/5" };

  if (expanded) {
    return (
      <div
        className={`flex flex-col gap-1.5 border ${tone.border} ${tone.soft} p-2 rounded`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <span className={`text-[10px] tracking-wider ${tone.text} font-bold`}>
            {isDq ? "WHY IS THE CLAIM INVALID?" : "WHY IS NO BONUS OWED?"}
          </span>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            // Sized with the chips deliberately. A cancel too small to hit is not a
            // minor annoyance here - the thumb that misses it lands on a chip, and
            // the chip commits.
            className="min-h-[48px] min-w-[48px] px-3 text-foreground/40 hover:text-foreground/70 text-[16px] leading-none"
            aria-label="Cancel"
          >
            ×
          </button>
        </div>
        {!isDq && (
          <p className="text-[10px] text-foreground/45 leading-snug">
            The claim was good — only the 90-day condition went unmet. Use Disqualify when the claim
            itself was invalid.
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          {reasons.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => submit(reason)}
              disabled={mutation.isPending}
              // min-h-[48px]/min-w-[48px]: these chips COMMIT an irreversible $300
              // refusal in one tap, on a phone. At the inherited px-2 py-1 sizing
              // they render ~24px tall - half the 48x48 minimum this app documents
              // - with adjacent chips a thumb-width apart. A mis-tap here does not
              // just annoy: it records the WRONG REASON against a contested payout,
              // which asserts something false where the old canned string merely
              // said nothing. Bigger is the point, not a style preference.
              className={`min-h-[48px] min-w-[48px] px-3 py-2 bg-card border ${tone.border} ${tone.text} text-[11px] tracking-wide ${tone.bg} disabled:opacity-50 transition-colors rounded`}
            >
              {reason}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      disabled={disabled || mutation.isPending}
      title={disabled ? disabledTitle : undefined}
      className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${tone.soft} border ${tone.border} ${tone.text} ${tone.bg} rounded transition-colors disabled:opacity-50`}
    >
      <X className="w-3 h-3" /> {isDq ? "Disqualify" : "Forfeit"}
    </button>
  );
}
