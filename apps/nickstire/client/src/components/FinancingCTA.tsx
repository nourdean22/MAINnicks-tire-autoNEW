import { ArrowRight, CreditCard, DollarSign, ShieldCheck } from "lucide-react";

interface FinancingCTAProps {
  /** Compact single-line variant for tight spaces */
  variant?: "banner" | "inline" | "card";
  className?: string;
}

export default function FinancingCTA({ variant = "banner", className = "" }: FinancingCTAProps) {
  if (variant === "inline") {
    return (
      <a
        href="/financing"
        className={`inline-flex items-center gap-2 text-primary text-sm font-semibold hover:underline ${className}`}
      >
        <CreditCard className="h-4 w-4" aria-hidden="true" />
        Compare third-party payment options
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    );
  }

  if (variant === "card") {
    return (
      <div className={`rounded-xl border border-primary/15 bg-primary/5 p-5 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CreditCard className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h3 className="mb-1 text-sm font-bold text-foreground">Need another way to pay?</h3>
            <p className="mb-3 text-xs leading-relaxed text-foreground/60">
              Nick's accepts four third-party payment providers. Products, approval, initial payment, and total cost vary by provider and applicant.
            </p>
            <a
              href="/financing"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-bold tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
            >
              COMPARE OPTIONS
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-primary/15 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 ${className}`}>
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <DollarSign className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Payment Options Are Available</p>
            <p className="text-xs text-foreground/70">
              Compare four third-party providers before you apply.
            </p>
          </div>
        </div>
        <a
          href="/financing"
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-primary px-5 py-2.5 text-xs font-bold tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          SEE TERMS & OPTIONS
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
