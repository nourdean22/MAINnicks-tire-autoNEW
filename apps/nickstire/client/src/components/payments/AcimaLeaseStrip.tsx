/**
 * AcimaLeaseStrip — quiet Lease-to-Own reassurance, NOT a calculator.
 *
 * Operator directive (2026-07-04): customers on /tires should never be
 * doing payment math. The old interactive estimator showed a 52-week
 * total that invited deliberation mid-funnel; this strip replaces it
 * with a single reassurance line and hands all numbers to Acima's own
 * application flow. Do not add inputs, totals, or per-week breakdowns
 * back into this component.
 *
 * VOCABULARY IS A LEGAL BOUNDARY, not a style choice: Acima's merchant
 * terms prohibit presenting the program as credit. Only say
 * "Lease-to-Own", "Weekly Lease Payment", and "Initial Payment". The
 * mandatory footnote is rendered VERBATIM from Acima's required
 * disclosure — it is the one place lending words may appear.
 */
import { CheckCircle2, ExternalLink, Zap } from "lucide-react";
import { trackEvent } from "@/components/SEO";

/** Estimated weekly lease payment as a fraction of the cash price. */
const WEEKLY_RATE = 0.04;
/** Anchor set price the "from ~$X/week" line is derived from. */
const ANCHOR_PRICE = 299;
/** Acima application link already used elsewhere on the site. */
const ACIMA_APPLY_URL = "https://acima.us/1TjEOYtr6C";

export const ACIMA_DISCLAIMER =
  "*The advertised service is a rental or lease-purchase agreement provided by Acima. It is not a loan, credit, or financing. While no credit history is required, Acima obtains information from consumer reporting agencies in connection with lease applications. Acquiring ownership by leasing costs more than the retailer’s cash price. Not available in MN, NJ, WI, or WY.";

/** Exported for the regression test that pins the anchor math. */
export function anchorWeekly(cashPrice: number = ANCHOR_PRICE) {
  return Math.round(cashPrice * WEEKLY_RATE);
}

export default function AcimaLeaseStrip() {
  const weekly = anchorWeekly();

  return (
    <section
      aria-label="Lease-to-Own with Acima"
      className="bg-card/60 border border-border/30 rounded-xl p-5 sm:p-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-[10px] font-semibold text-blue-400 tracking-[0.15em] uppercase">
              Tight week? Not a problem.
            </span>
          </div>
          <p className="text-base sm:text-lg font-semibold text-foreground mt-1.5 leading-snug">
            Roll out today from about <span className="text-blue-300">${weekly}/week</span> with
            Acima Lease-to-Own.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {[
              "No credit history required",
              "Approval in minutes",
              "90-day early purchase option",
            ].map((line) => (
              <span key={line} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                {line}
              </span>
            ))}
          </div>
        </div>
        <a
          href={ACIMA_APPLY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("acima_apply_click", { source: "tires_lease_strip" })}
          className="inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-md text-sm font-semibold hover:bg-blue-600/90 transition-colors shrink-0 min-h-[48px]"
        >
          Apply in 2 minutes
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {/* Mandatory Acima disclosure — verbatim, do not edit or summarize. */}
      <p
        className="mt-4 pt-3 border-t border-border/20 text-[10px] text-muted-foreground/60 leading-relaxed"
        data-testid="acima-disclaimer"
      >
        {ACIMA_DISCLAIMER} Weekly figure is an illustrative estimate on a ${ANCHOR_PRICE} set;
        Acima determines actual lease terms at application.
      </p>
    </section>
  );
}
