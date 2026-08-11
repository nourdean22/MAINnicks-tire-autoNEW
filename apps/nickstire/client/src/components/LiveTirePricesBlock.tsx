/**
 * LiveTirePricesBlock — proprietary-data AEO surface for the
 * /tire-prices-cleveland page (rendered via ServicePageConfig.pricingOverride).
 *
 * Two layers, both honest:
 *   1. Canon floors (shared/business.ts) — always render. The used-tire
 *      fineprint + typical band MUST travel with the $25 (wave-183 rule).
 *   2. Live per-size floors from the distributor feed
 *      (gatewayTire.publicPriceRanges) — render when data exists. When
 *      the cache and snapshot are both empty the section simply doesn't
 *      render, so prerendered HTML never shows an empty table.
 */
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { Link } from "wouter";
import { Phone } from "lucide-react";

function formatUpdated(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: BUSINESS.timezone });
}

export default function LiveTirePricesBlock() {
  const { data: ranges } = trpc.gatewayTire.publicPriceRanges.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const { data: stats } = trpc.gatewayTire.publicStats.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const floors = ranges?.floors ?? [];
  const updated = formatUpdated(ranges?.updatedAt);

  return (
    <div className="space-y-10">
      {/* Canon floors — the two headline claims, straight from shared/business.ts */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border/30 bg-foreground/[0.03] p-6">
          <div className="text-[11px] font-bold tracking-widest text-foreground/40 uppercase mb-2">
            Used tires — inspected
          </div>
          <div className="text-3xl font-bold text-primary font-mono">
            {BUSINESS.usedTires.priceDisplay}
          </div>
          <p className="mt-2 text-sm text-foreground/60">
            {BUSINESS.usedTires.fineprint}; {BUSINESS.usedTires.typicalBand}. Mount,
            balance, and disposal included.
          </p>
        </div>
        <div className="rounded-lg border border-border/30 bg-foreground/[0.03] p-6">
          <div className="text-[11px] font-bold tracking-widest text-foreground/40 uppercase mb-2">
            New tires — any brand
          </div>
          <div className="text-3xl font-bold text-primary font-mono">
            {BUSINESS.newTires.priceDisplay}
          </div>
          <p className="mt-2 text-sm text-foreground/60">
            {BUSINESS.newTires.positioning} Live per-size pricing below.
          </p>
        </div>
      </div>

      {/* Live distributor floors — only when real data exists */}
      {floors.length > 0 && (
        <div>
          <div className="text-[11px] font-bold tracking-widest text-foreground/40 uppercase mb-3">
            New-tire pricing by size — from our live distributor feed
            {updated ? ` · updated ${updated}` : ""}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/30">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30 bg-foreground/[0.03] text-left">
                  <th className="px-4 py-3 font-bold text-foreground/60">Tire size</th>
                  <th className="px-4 py-3 font-bold text-foreground/60">Per tire</th>
                  <th className="px-4 py-3 font-bold text-foreground/60">Options</th>
                  <th className="px-4 py-3 font-bold text-foreground/60">Availability</th>
                </tr>
              </thead>
              <tbody>
                {floors.map((f) => (
                  <tr key={f.size} className="border-b border-border/20 last:border-b-0">
                    <td className="px-4 py-3 font-mono font-bold">{f.size}</td>
                    <td className="px-4 py-3 font-mono text-primary font-bold">from ${f.fromPrice}</td>
                    <td className="px-4 py-3 text-foreground/60">{f.optionCount} priced</td>
                    <td className="px-4 py-3 text-foreground/60">
                      {f.inStockCount > 0 ? "In stock — same day" : "1-2 business days"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-foreground/40">
            Per-tire price with installation included in the Nick&apos;s package (mount,
            balance, valve stems, disposal). Final quote depends on brand and
            availability in your exact size — confirm by phone before driving over.
          </p>
        </div>
      )}

      {/* Real order volume — only when non-zero, no invented numbers */}
      {stats && stats.ordersThisWeek > 0 && (
        <p className="text-sm text-foreground/60">
          {stats.ordersThisWeek} tire orders came through the shop in the last 7 days
          {stats.popularSize ? ` — most-requested size: ${stats.popularSize}` : ""}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Link
          href="/tires"
          className="inline-flex min-h-12 items-center rounded-md bg-primary px-6 py-3 font-bold text-primary-foreground"
        >
          SEE EVERY OPTION IN YOUR SIZE
        </Link>
        <a
          href={BUSINESS.phone.href}
          className="inline-flex min-h-12 items-center gap-2 rounded-md border border-border/40 px-6 py-3 font-bold"
        >
          <Phone className="h-4 w-4" /> {BUSINESS.phone.display}
        </a>
      </div>
    </div>
  );
}
