/**
 * AcimaEstimator — interactive Lease-to-Own payment estimator.
 *
 * VOCABULARY IS A LEGAL BOUNDARY, not a style choice: Acima's merchant
 * terms prohibit presenting the program as credit. This component (and
 * anything that imports it) must only say "Lease-to-Own", "Weekly Lease
 * Payment", and "Initial Payment". The mandatory footnote at the bottom
 * is rendered VERBATIM from Acima's required disclosure — it is the one
 * place lending words may appear. Do not paraphrase it.
 *
 * Math model (estimate only — Acima sets final terms at application):
 *   weekly  = cashPrice * WEEKLY_RATE   (≈ $12/wk on a $299 set)
 *   total   = weekly * 52               (full 52-week lease cost)
 *   90-day early purchase = cashPrice + INITIAL_PAYMENT
 */
import { useMemo, useState } from "react";
import { CalendarClock, Calculator, CheckCircle2, ExternalLink } from "lucide-react";
import { trackEvent } from "@/components/SEO";

/** Estimated weekly lease payment as a fraction of the cash price. */
const WEEKLY_RATE = 0.04;
/** Typical initial payment collected when the lease starts. */
const INITIAL_PAYMENT = 50;
/** Acima application link already used elsewhere on the site. */
const ACIMA_APPLY_URL = "https://acima.us/1TjEOYtr6C";

export const ACIMA_DISCLAIMER =
  "*The advertised service is a rental or lease-purchase agreement provided by Acima. It is not a loan, credit, or financing. While no credit history is required, Acima obtains information from consumer reporting agencies in connection with lease applications. Acquiring ownership by leasing costs more than the retailer’s cash price. Not available in MN, NJ, WI, or WY.";

export function estimateLease(cashPrice: number) {
  const weekly = Math.round(cashPrice * WEEKLY_RATE);
  return {
    weekly,
    fiftyTwoWeekTotal: weekly * 52,
    ninetyDayPurchase: cashPrice + INITIAL_PAYMENT,
    initialPayment: INITIAL_PAYMENT,
  };
}

const QUICK_PRICES = [199, 299, 399, 499, 599];

export default function AcimaEstimator({ defaultPrice = 299 }: { defaultPrice?: number }) {
  const [priceInput, setPriceInput] = useState(String(defaultPrice));

  const cashPrice = useMemo(() => {
    const n = Math.round(Number(priceInput.replace(/[^0-9.]/g, "")));
    if (!Number.isFinite(n) || n < 50) return 0;
    return Math.min(n, 5000);
  }, [priceInput]);

  const est = cashPrice > 0 ? estimateLease(cashPrice) : null;

  return (
    <section
      aria-label="Lease-to-Own payment estimator"
      className="bg-linear-to-br from-blue-500/5 via-card to-card border border-blue-500/20 rounded-xl p-6 sm:p-8"
    >
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center shrink-0">
          <Calculator className="w-6 h-6 text-blue-400" />
        </div>
        <div>
          <span className="text-[10px] font-semibold text-blue-400 tracking-[0.15em] uppercase bg-blue-500/10 px-2.5 py-0.5 rounded-full">
            Lease-to-Own · No Credit History Required
          </span>
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground mt-2">
            Drive today. Small weekly lease payments.
          </h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Type any tire set price and see your estimated Weekly Lease Payment through Acima —
            plus the 90-day early purchase option that most customers use.
          </p>
        </div>
      </div>

      {/* Price input */}
      <div className="mt-6">
        <label htmlFor="acima-price" className="block text-xs text-muted-foreground mb-1.5 font-medium">
          Tire set cash price
        </label>
        <div className="flex items-center bg-background border border-border/50 rounded-md overflow-hidden focus-within:border-blue-400/50 transition-colors max-w-xs">
          <span className="pl-4 text-muted-foreground text-sm">$</span>
          <input
            id="acima-price"
            type="text"
            inputMode="numeric"
            value={priceInput}
            onChange={(e) => {
              setPriceInput(e.target.value);
              trackEvent("acima_estimator_input", { value: e.target.value });
            }}
            placeholder="299"
            className="flex-1 bg-transparent px-2 py-3 text-foreground text-base focus:outline-none"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_PRICES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriceInput(String(p))}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                cashPrice === p
                  ? "border-blue-400/60 text-blue-300 bg-blue-500/10"
                  : "border-border/30 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              ${p}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {est ? (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-background/60 border border-blue-500/20 rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Estimated Weekly Lease Payment
            </p>
            <p className="text-3xl font-extrabold text-blue-300 mt-1" data-testid="acima-weekly">
              ${est.weekly}<span className="text-sm font-medium text-muted-foreground">/wk</span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Initial Payment of ${est.initialPayment} starts the lease.
            </p>
          </div>
          <div className="bg-background/60 border border-border/30 rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Full 52-week lease cost
            </p>
            <p className="text-3xl font-extrabold text-foreground mt-1" data-testid="acima-total">
              ${est.fiftyTwoWeekTotal.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              If you make every weekly payment for a full year.
            </p>
          </div>
          <div className="bg-emerald-500/5 border border-emerald-500/25 rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold flex items-center gap-1">
              <CalendarClock className="w-3 h-3" /> 90-Day Early Purchase
            </p>
            <p className="text-3xl font-extrabold text-emerald-300 mt-1" data-testid="acima-epo">
              ${est.ninetyDayPurchase.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Own them early: pay the ${cashPrice.toLocaleString()} cash price + the ${est.initialPayment} Initial
              Payment within 90 days and skip the rest of the lease.
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-6 text-sm text-amber-400/90">Enter a price of $50 or more to see your estimate.</p>
      )}

      <ul className="mt-5 space-y-1.5 text-xs text-muted-foreground">
        {[
          "Approval decision in minutes — bring your ID and a debit card to the shop, or apply online.",
          "No credit history required to apply.",
          "Tires installed the same day you're approved (in-stock sizes).",
        ].map((line) => (
          <li key={line} className="flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <a
        href={ACIMA_APPLY_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackEvent("acima_apply_click", { source: "tires_estimator", cashPrice })}
        className="mt-5 inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-md text-sm font-semibold hover:bg-blue-600/90 transition-colors"
      >
        Apply with Acima — 2 minutes
        <ExternalLink className="w-4 h-4" />
      </a>

      {/* Mandatory Acima disclosure — verbatim, do not edit or summarize. */}
      <p className="mt-6 pt-4 border-t border-border/20 text-[10px] text-muted-foreground/70 leading-relaxed" data-testid="acima-disclaimer">
        {ACIMA_DISCLAIMER} Estimates above are illustrative; Acima determines actual lease terms at
        application.
      </p>
    </section>
  );
}
