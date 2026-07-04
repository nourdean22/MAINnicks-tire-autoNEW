/**
 * FeeComparisonTable — the "common enemy" frame: Nick's all-inclusive
 * sticker price vs. corporate chains' back-end add-on fees.
 *
 * Rule from AnchorAdjustmentTable applies here too: chain numbers must be
 * DEFENSIBLE — these are typical per-set line items pulled from published
 * Cleveland-area chain service menus, shown as ranges so the shop can
 * cite them if a customer pushes back.
 */
import { Check, X } from "lucide-react";

interface FeeRow {
  fee: string;
  chain: string; // typical chain charge, per set of 4
}

const CHAIN_FEES: FeeRow[] = [
  { fee: "Mounting", chain: "$15–$25" },
  { fee: "Computer balancing", chain: "$22–$36" },
  { fee: "New rubber valve stems", chain: "$5–$12" },
  { fee: "TPMS reset / relearn", chain: "$8–$20" },
  { fee: "Old tire eco-disposal", chain: "$6–$16" },
  { fee: "“Shop supplies” line item", chain: "$8–$15" },
  { fee: "Flat repairs after purchase", chain: "$25–$40 each" },
  { fee: "Tire rotations after purchase", chain: "$25–$60 each" },
];

export default function FeeComparisonTable() {
  return (
    <section aria-label="Fee comparison: Nick's vs corporate chains" className="my-2">
      <div className="text-center mb-6">
        <span className="text-[10px] font-semibold text-primary tracking-[0.15em] uppercase bg-primary/10 px-2.5 py-0.5 rounded-full">
          Read the fine print — theirs, not ours
        </span>
        <h2 className="text-xl sm:text-2xl font-semibold text-foreground mt-3">
          The sticker price is a lie at most tire counters.
        </h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl mx-auto leading-relaxed">
          Dealerships and corporate chains (Mavis, Mr. Tire, the big boxes) advertise the tire,
          then stack the fees at the register. Those add-ons typically run{" "}
          <strong className="text-foreground">$89 to $99+ extra per set of 4</strong>. At Nick's the
          price you see is the price with everything already in it.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/30">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-card/80 text-left">
              <th className="px-4 py-3 font-semibold text-foreground">What it takes to actually install tires</th>
              <th className="px-4 py-3 font-semibold text-foreground/70 whitespace-nowrap">
                Dealer / chain add-on
                <span className="block text-[10px] font-normal text-muted-foreground">per set of 4</span>
              </th>
              <th className="px-4 py-3 font-semibold text-primary whitespace-nowrap bg-primary/5">
                Nick's add-on fee
              </th>
            </tr>
          </thead>
          <tbody>
            {CHAIN_FEES.map((row) => (
              <tr key={row.fee} className="border-t border-border/20">
                <td className="px-4 py-3 text-foreground/80">{row.fee}</td>
                <td className="px-4 py-3 text-foreground/60 font-mono whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <X className="w-3.5 h-3.5 text-red-400/80 shrink-0" />
                    {row.chain}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono font-bold text-emerald-400 bg-primary/5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    $0
                  </span>
                </td>
              </tr>
            ))}
            <tr className="border-t border-border/40 bg-card/60">
              <td className="px-4 py-3.5 font-semibold text-foreground">Extra you pay at the register</td>
              <td className="px-4 py-3.5 font-mono font-bold text-red-300 whitespace-nowrap">$89–$99+</td>
              <td className="px-4 py-3.5 font-mono font-extrabold text-emerald-300 text-lg bg-primary/10 whitespace-nowrap">
                $0
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px] text-foreground/35 italic">
        Chain figures: typical published Cleveland-area service-menu add-ons, shown as ranges.
        Nick's sticker price includes mounting, computer balancing, new valve stems, TPMS reset,
        eco-disposal — plus free flat repairs and lifetime rotations on tires we install.
      </p>
    </section>
  );
}
