/**
 * ApprovalPromiseBlock — The no-surprises contract, rendered visually.
 * A bold, compact commitment block that locks in the customer's confidence
 * before they hand over their keys. Placement: just above the booking form.
 */
import { ShieldCheck } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { trackPhoneClick } from "@/components/SEO";

interface ApprovalPromiseBlockProps {
  variant?: "compact" | "full";
}

const PROMISES = [
  "Written estimate before any work begins",
  "Price stays locked once you approve",
  "We call you if anything unexpected comes up",
  "You can say no at any point — no charge for estimates",
];

export default function ApprovalPromiseBlock({ variant = "full" }: ApprovalPromiseBlockProps) {
  if (variant === "compact") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs text-foreground/60 font-medium">
          Free estimate · Price locked at approval · No surprise bills
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-primary/5 border border-primary/20 p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading text-lg font-bold uppercase tracking-wide text-foreground">
            The Nick's Approval Promise
          </p>
          <p className="mt-1 text-sm text-foreground/60 leading-relaxed">
            We don't start work until you've seen the price in writing and said yes.
          </p>

          <ul className="mt-4 space-y-2">
            {PROMISES.map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm text-foreground/75">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                {p}
              </li>
            ))}
          </ul>

          <p className="mt-5 text-xs text-foreground/70">
            Questions before you come in?{" "}
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("approval-promise-block")}
              className="text-primary font-semibold hover:opacity-80 transition-opacity"
            >
              Call {BUSINESS.phone.display}
            </a>{" "}
            — we answer.
          </p>
        </div>
      </div>
    </div>
  );
}
