import { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { TIER_LABEL, type RankedOffer } from "@shared/sourcing";

/**
 * Counter supplier comparison (Shop OS plan 26 screens 1 and 3): type a tire size, see Best Price
 * and Quickest Arrival across connected suppliers, with every other offer and why it lost.
 * Read-only - nothing here orders anything.
 */
type Result = RouterOutputs["sourcing"]["compareTires"];

const money = (v: number | null) => (v === null ? "No price" : `$${v.toFixed(2)}`);
const BTN =
  "inline-flex min-h-12 items-center justify-center rounded border border-border/40 px-4 text-sm font-semibold hover:border-border/70";

function arrivalLine(o: RankedOffer): string {
  if (o.statedArrival) return `Arrives ${new Date(o.statedArrival).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  if (o.tier === "shelf" && o.runMinutes) {
    const src = o.runSource === "measured" ? "measured" : "usual";
    return `${o.runMinutes.min}-${o.runMinutes.max} min (${src} run)`;
  }
  return TIER_LABEL[o.tier];
}

function PickCard({ label, offer, hideCost }: { label: string; offer: RankedOffer | null; hideCost: boolean }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      {offer ? (
        <>
          <p className="mt-1 text-base font-semibold text-foreground">{offer.description}</p>
          <p className="text-sm text-foreground/80">
            {offer.supplierName}
            {offer.location ? ` - ${offer.location}` : ""}
          </p>
          <p className="mt-1 text-sm tabular-nums">
            {hideCost ? "" : `${money(offer.unitCost)} each - `}
            {TIER_LABEL[offer.tier]} - {arrivalLine(offer)}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-foreground/80">None can be confirmed</p>
      )}
    </div>
  );
}

function Body({ data, hideCost }: { data: Result; hideCost: boolean }) {
  if (data.error) return <p className="text-sm text-destructive">{data.error}</p>;
  const c = data.comparison;
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2 text-sm">
        {data.suppliers.map((s) => (
          <li key={s.id} className="rounded border border-border/30 px-2 py-1">
            {s.name}:{" "}
            {s.status === "live" ? "live" : s.status === "no_results" ? "no tires in this size" : `not answering${s.detail ? ` (${s.detail})` : ""}`}
            {s.status !== "live" && s.portalUrl && (
              <>
                {" - "}
                <a href={s.portalUrl} target="_blank" rel="noreferrer" className="underline">
                  open portal
                </a>
              </>
            )}
          </li>
        ))}
        {data.notConnected.length > 0 && (
          <li className="rounded border border-dashed border-border/30 px-2 py-1 text-muted-foreground">
            Not connected yet: {data.notConnected.join(", ")}
          </li>
        )}
      </ul>
      {c && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <PickCard label="Best price" offer={c.bestPrice} hideCost={hideCost} />
            <PickCard label="Quickest arrival" offer={c.quickest} hideCost={hideCost} />
          </div>
          {c.note && <p className="text-sm text-foreground/80">{c.note}</p>}
          {c.offers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Tire</th>
                    <th className="py-2 pr-3 font-medium">Supplier</th>
                    {!hideCost && <th className="py-2 pr-3 font-medium">Cost</th>}
                    <th className="py-2 pr-3 font-medium">Qty</th>
                    <th className="py-2 pr-3 font-medium">Availability</th>
                    <th className="py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {c.offers.map((o) => (
                    <tr key={o.id} className="border-t border-border/20 align-top">
                      <td className="py-2 pr-3">
                        <span className="font-medium text-foreground">{o.description}</span>
                        {o.sku && <span className="block text-muted-foreground">{o.sku}</span>}
                      </td>
                      <td className="py-2 pr-3">
                        {o.supplierName}
                        {o.location && <span className="block text-muted-foreground">{o.location}</span>}
                      </td>
                      {!hideCost && <td className="py-2 pr-3 tabular-nums">{money(o.unitCost)}</td>}
                      <td className="py-2 pr-3 tabular-nums">{o.qtyAvailable ?? "?"}</td>
                      <td className="py-2 pr-3">{arrivalLine(o)}</td>
                      <td className="py-2 text-muted-foreground">{o.reasons.join(". ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SupplierComparePanel() {
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(4);
  const [submitted, setSubmitted] = useState<{ size: string; qty: number } | null>(null);
  const [hideCost, setHideCost] = useState(false);
  const query = trpc.sourcing.compareTires.useQuery(submitted ?? { size: "", qty: 4 }, {
    enabled: submitted !== null,
    staleTime: 60_000,
  });
  const submit = () => {
    const s = size.trim();
    if (s.length >= 5) setSubmitted({ size: s, qty });
  };

  return (
    <section aria-labelledby="supplier-compare-title" className="space-y-3 rounded-lg border border-border/40 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="supplier-compare-title" className="text-sm font-semibold">
          Compare suppliers
        </h2>
        <label className="inline-flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" checked={hideCost} onChange={(e) => setHideCost(e.target.checked)} className="h-5 w-5" />
          Hide cost
        </label>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col text-sm">
          Tire size
          <input
            value={size}
            onChange={(e) => setSize(e.target.value)}
            inputMode="numeric"
            placeholder="225/65R17"
            className="min-h-12 w-40 rounded border border-border/40 bg-background px-3 text-base"
          />
        </label>
        <label className="flex flex-col text-sm">
          Qty
          <select
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="min-h-12 rounded border border-border/40 bg-background px-3 text-base"
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={BTN} disabled={query.isFetching}>
          {query.isFetching ? "Checking..." : "Check suppliers"}
        </button>
      </form>
      {query.isError && (
        <p className="text-sm text-destructive">
          Could not check suppliers.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {query.data && <Body data={query.data} hideCost={hideCost} />}
      <p className="text-sm text-muted-foreground">
        Ranks where the tire is right now first: on the shelf, then a transfer, then next day, then shipped. Suppliers in the same delivery window tie, and the cheaper one wins. Nothing here places an order.
      </p>
    </section>
  );
}
