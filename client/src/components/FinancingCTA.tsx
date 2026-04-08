/**
 * Reusable Financing CTA — embeddable on service pages, booking flow, etc.
 * Compact banner driving traffic to the /financing page.
 * Now includes "Check If You Qualify" pre-approval flow.
 */
import { useState } from "react";
import { CreditCard, ArrowRight, Shield, DollarSign } from "lucide-react";
import FinancingPreApprovalModal from "./FinancingPreApprovalModal";

interface FinancingCTAProps {
  /** Compact single-line variant for tight spaces */
  variant?: "banner" | "inline" | "card";
  className?: string;
}

export default function FinancingCTA({ variant = "banner", className = "" }: FinancingCTAProps) {
  const [showPreApproval, setShowPreApproval] = useState(false);

  if (variant === "inline") {
    return (
      <>
        <a
          href="/financing"
          className={`inline-flex items-center gap-2 text-primary text-sm font-semibold hover:underline ${className}`}
        >
          <CreditCard className="w-4 h-4" />
          Need financing? Apply online in 60 seconds
          <ArrowRight className="w-3.5 h-3.5" />
        </a>
        <FinancingPreApprovalModal
          open={showPreApproval}
          onClose={() => setShowPreApproval(false)}
        />
      </>
    );
  }

  if (variant === "card") {
    return (
      <>
        <div className={`bg-primary/5 border border-primary/15 rounded-xl p-5 ${className}`}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-foreground text-sm mb-1">Need to Spread Out the Cost?</h3>
              <p className="text-foreground/60 text-xs leading-relaxed mb-3">
                We offer 4 financing options with no credit needed. Get approved in seconds and pay over time.
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/financing"
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md font-bold text-xs tracking-wide hover:opacity-90 transition-colors"
                >
                  VIEW OPTIONS
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={() => setShowPreApproval(true)}
                  className="inline-flex items-center gap-2 border border-primary/30 text-primary px-4 py-2 rounded-md font-bold text-xs tracking-wide hover:bg-primary/10 transition-colors"
                >
                  CHECK IF YOU QUALIFY
                </button>
              </div>
            </div>
          </div>
        </div>
        <FinancingPreApprovalModal
          open={showPreApproval}
          onClose={() => setShowPreApproval(false)}
        />
      </>
    );
  }

  // Default: banner
  return (
    <>
      <div className={`bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/15 rounded-xl p-4 ${className}`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center text-primary shrink-0">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-foreground text-sm">Fix It Now, Pay Over Time</p>
              <p className="text-foreground/50 text-xs">
                4 options · No credit needed · Approved in seconds · Up to $7,500
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/financing"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-md font-bold text-xs tracking-wide hover:opacity-90 transition-colors whitespace-nowrap"
            >
              SEE YOUR OPTIONS
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
            <button
              onClick={() => setShowPreApproval(true)}
              className="inline-flex items-center gap-2 border border-primary/30 text-primary px-5 py-2.5 rounded-md font-bold text-xs tracking-wide hover:bg-primary/10 transition-colors whitespace-nowrap"
            >
              CHECK IF YOU QUALIFY
            </button>
          </div>
        </div>
      </div>
      <FinancingPreApprovalModal
        open={showPreApproval}
        onClose={() => setShowPreApproval(false)}
      />
    </>
  );
}
