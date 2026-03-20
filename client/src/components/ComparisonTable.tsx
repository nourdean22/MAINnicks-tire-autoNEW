/**
 * ComparisonTable — Nick's vs Dealership vs Chain comparison.
 * Builds trust by showing transparent advantages.
 */
import { Check, X, Minus } from "lucide-react";

interface Row {
  feature: string;
  nicks: "yes" | "no" | "partial";
  dealership: "yes" | "no" | "partial";
  chain: "yes" | "no" | "partial";
}

const ROWS: Row[] = [
  { feature: "Honest upfront pricing", nicks: "yes", dealership: "no", chain: "partial" },
  { feature: "OBD-II advanced diagnostics", nicks: "yes", dealership: "yes", chain: "partial" },
  { feature: "Same-day service available", nicks: "yes", dealership: "no", chain: "partial" },
  { feature: "All vehicle makes & models", nicks: "yes", dealership: "no", chain: "yes" },
  { feature: "Show you the problem first", nicks: "yes", dealership: "partial", chain: "no" },
  { feature: "No upselling pressure", nicks: "yes", dealership: "no", chain: "no" },
  { feature: "Locally owned & operated", nicks: "yes", dealership: "no", chain: "no" },
  { feature: "Financing options", nicks: "yes", dealership: "yes", chain: "partial" },
];

function StatusIcon({ status }: { status: "yes" | "no" | "partial" }) {
  if (status === "yes") return <Check className="w-4 h-4 text-emerald-400" />;
  if (status === "no") return <X className="w-4 h-4 text-red-400/60" />;
  return <Minus className="w-4 h-4 text-foreground/30" />;
}

export default function ComparisonTable() {
  return (
    <section className="bg-[oklch(0.065_0.004_260)] py-20">
      <div className="container">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-3">
            Why Choose Us
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
            How We Compare
          </h2>
        </div>

        <div className="max-w-3xl mx-auto overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left py-4 pr-4 text-foreground/40 font-medium text-xs uppercase tracking-wider">Feature</th>
                <th className="text-center py-4 px-4 text-primary font-semibold text-xs uppercase tracking-wider">Nick's</th>
                <th className="text-center py-4 px-4 text-foreground/40 font-medium text-xs uppercase tracking-wider">Dealership</th>
                <th className="text-center py-4 px-4 text-foreground/40 font-medium text-xs uppercase tracking-wider">Chain Shop</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.feature} className="border-b border-border/10">
                  <td className="py-3.5 pr-4 text-foreground/70">{row.feature}</td>
                  <td className="py-3.5 px-4 text-center"><div className="flex justify-center"><StatusIcon status={row.nicks} /></div></td>
                  <td className="py-3.5 px-4 text-center"><div className="flex justify-center"><StatusIcon status={row.dealership} /></div></td>
                  <td className="py-3.5 px-4 text-center"><div className="flex justify-center"><StatusIcon status={row.chain} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
