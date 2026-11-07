/**
 * Admin > Tires: compare supplier stock for one size (docs/plans/shop-os/26-VENDOR-SCHEMATICS.md section 2).
 * sourcing.compareTires does one read-only Gateway search; compareOffers ranks it here against a clock that ticks
 * every 30 s, so a lookup older than the shelf limit stops ranking as on the shelf without a re-fetch.
 * It shows dealer cost, so it renders for owner and manager only (Tires is also open to front_desk and tech).
 * Nothing here orders, carts or writes anything.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { trpc } from "@/lib/trpc";
import { compareOffers, SUPPLIER_SCHEDULES, UNKNOWN, type Candidate } from "@shared/sourcing";

const VIEWERS = new Set(["owner", "manager"]);
const HIDE_COST_KEY = "nickstire.supplierCompare.hideCost";
const MAX_QTY = 12;
const SHOWN_ROWS = 6;
const BUTTON = "min-h-12 min-w-12 px-4 rounded-md border border-border/40 text-sm font-semibold";

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const money = (n: number) => `$${n.toFixed(2)}`;

function readHideCost(): boolean {
  try {
    return localStorage.getItem(HIDE_COST_KEY) === "1";
  } catch {
    return false;
  }
}

function where(c: Candidate): string {
  const name = c.location.branchName;
  switch (c.location.arrival.tier) {
    case "shelf": return `On the shelf at ${name}`;
    case "transfer": return `Transfer from ${name}`;
    case "next_day": return `Next day from ${name}`;
    case "ship": return `Ships from ${name}`;
    default: return `${name}, arrival not stated`;
  }
}

function arrives(c: Candidate): string {
  // A window exists only when the supplier has a schedule row, so the label is read from the same row.
  if (c.window === UNKNOWN) return "Arrival time not stated";
  return `Usually here ${clock(c.window.from)} to ${clock(c.window.to)} (run ${SUPPLIER_SCHEDULES[c.offer.supplierId]?.basis})`;
}

function Price({ c, qty, hideCost }: { c: Candidate; qty: number; hideCost: boolean }) {
  if (hideCost) return <p className="text-sm text-muted-foreground">Cost hidden</p>;
  if (c.landedUnit === UNKNOWN) return <p className="text-sm text-muted-foreground">No complete price</p>;
  return (
    <p className="text-sm">
      <span className="font-semibold">{money(c.landedUnit)} each</span>
      <span className="text-muted-foreground"> with FET · {money(c.landedUnit * qty)} for {qty}</span>
    </p>
  );
}

function Reasons({ c }: { c: Candidate }) {
  if (c.reasons.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-sm text-amber-400">
      {c.reasons.map((r) => <li key={r}>{r}</li>)}
    </ul>
  );
}

function Offer({ c, qty, hideCost }: { c: Candidate; qty: number; hideCost: boolean }) {
  const have = c.location.qty === UNKNOWN ? "quantity not stated" : `${c.location.qty} there`;
  return (
    <div>
      <p className="font-semibold">{c.offer.description}</p>
      <p className="text-xs text-muted-foreground">{c.offer.supplierName} · {c.offer.sku}</p>
      <p className="mt-1 text-sm">{where(c)} · {have}</p>
      <p className="text-sm text-muted-foreground">{arrives(c)}</p>
      <Price c={c} qty={qty} hideCost={hideCost} />
      <Reasons c={c} />
    </div>
  );
}

function Pick({ title, c, ties, qty, hideCost }: { title: string; c: Candidate; ties?: Candidate[]; qty: number; hideCost: boolean }) {
  const id = `supplier-pick-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border/60 bg-background/40 p-3">
      <h3 id={id} className="text-xs font-semibold text-muted-foreground">{title}</h3>
      <div className="mt-1"><Offer c={c} qty={qty} hideCost={hideCost} /></div>
      {ties && ties.length > 0 && (
        <p className="mt-2 text-sm">
          Same run window, so no faster: {ties.map((t) => `${t.offer.sku}${hideCost || t.landedUnit === UNKNOWN ? "" : ` at ${money(t.landedUnit)}`}`).join(", ")}
        </p>
      )}
    </section>
  );
}

export default function SupplierComparePanel() {
  const { data: security } = trpc.adminSecurity.status.useQuery();
  const allowed = !!security && VIEWERS.has(security.adminRole);
  const [draft, setDraft] = useState("");
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(4);
  const [hideCost, setHideCost] = useState(readHideCost);
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const lookup = trpc.sourcing.compareTires.useQuery({ size: size ?? "" }, { enabled: allowed && size !== null, retry: false });
  const data = lookup.data;
  const result = useMemo(() => (data ? compareOffers(data.offers, qty, now) : null), [data, qty, now]);

  if (!allowed) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (!next) return;
    if (next === size) void lookup.refetch();
    setSize(next);
    setShowAll(false);
  }

  function toggleCost() {
    const next = !hideCost;
    setHideCost(next);
    try {
      localStorage.setItem(HIDE_COST_KEY, next ? "1" : "0");
    } catch {
      /* private mode: the choice lasts for this visit only */
    }
  }

  const gateway = data?.suppliers[0];
  const both = !!result?.quickest && result.quickest.key === result.bestPrice?.key;
  const rows = result?.candidates ?? [];

  return (
    <section className="mb-6 rounded-lg border border-border/40 bg-card p-4" aria-labelledby="supplier-compare-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="supplier-compare-title" className="text-sm font-semibold">Compare suppliers</h2>
        <button type="button" aria-pressed={hideCost} onClick={toggleCost} className={BUTTON}>Hide cost</button>
      </div>

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-muted-foreground">
          Tire size
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="225/65R17"
            inputMode="text"
            autoCapitalize="characters"
            className="mt-1 min-h-12 w-40 rounded-md border border-border/40 bg-background px-3 text-base text-foreground"
          />
        </label>
        <button type="submit" className={BUTTON}>Check stock</button>
        <div className="flex items-center gap-1" role="group" aria-label="Tires needed">
          <button type="button" aria-label="Fewer tires" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} className={BUTTON}>-</button>
          <output className="w-8 text-center text-base font-semibold" aria-live="polite">{qty}</output>
          <button type="button" aria-label="More tires" disabled={qty >= MAX_QTY} onClick={() => setQty((q) => Math.min(MAX_QTY, q + 1))} className={BUTTON}>+</button>
        </div>
      </form>

      {size === null && <p className="mt-3 text-sm text-muted-foreground">Enter a size to see Gateway stock, the quickest pick and the best price.</p>}

      {size !== null && lookup.isError && (
        <p role="alert" className="mt-3 text-sm text-amber-400">{lookup.error?.message ?? "The lookup failed."}</p>
      )}

      {size !== null && !lookup.isError && !data && lookup.isFetching && <p className="mt-3 text-sm text-muted-foreground">Checking Gateway.</p>}

      {data && gateway && !lookup.isError && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>{data.size} · Checked {clock(data.lookedUpAt)}{lookup.isFetching ? " · checking again" : ""}</span>
            <button type="button" onClick={() => void lookup.refetch()} className={BUTTON}>Re-check</button>
          </div>

          {gateway.status === "unavailable" && (
            <p className="text-sm text-amber-400">
              Gateway did not answer, so stock is unknown. Detail: {gateway.reason}.{" "}
              <a href={gateway.portalUrl} target="_blank" rel="noopener noreferrer" className="underline">Open the Gateway portal</a>
            </p>
          )}
          {gateway.status === "no_results" && (
            <p className="text-sm">
              Gateway has no tires in {data.size}.{" "}
              <a href={gateway.portalUrl} target="_blank" rel="noopener noreferrer" className="underline">Open the Gateway portal</a>
            </p>
          )}

          {result && gateway.status === "live" && (
            <>
              {both && result.quickest ? (
                <Pick title="Quickest and best price" c={result.quickest} ties={result.sameWindow} qty={result.qtyNeeded} hideCost={hideCost} />
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {result.quickest && <Pick title="Quickest" c={result.quickest} ties={result.sameWindow} qty={result.qtyNeeded} hideCost={hideCost} />}
                  {result.bestPrice && <Pick title="Best price" c={result.bestPrice} qty={result.qtyNeeded} hideCost={hideCost} />}
                </div>
              )}
              {!result.quickest && !result.bestPrice && (
                <p className="text-sm text-amber-400">No offer can be promised for {result.qtyNeeded}. Call to confirm.</p>
              )}
              {!result.quickest && result.bestPrice && (
                <p className="text-sm text-amber-400">No offer can be promised as quickest. Call to confirm stock and arrival.</p>
              )}

              <div>
                <h3 className="text-xs font-semibold text-muted-foreground">All {rows.length} options</h3>
                <ul className="mt-1 divide-y divide-border/30">
                  {(showAll ? rows : rows.slice(0, SHOWN_ROWS)).map((c) => (
                    <li key={c.key} className="py-2"><Offer c={c} qty={result.qtyNeeded} hideCost={hideCost} /></li>
                  ))}
                </ul>
                {rows.length > SHOWN_ROWS && (
                  <button type="button" onClick={() => setShowAll((s) => !s)} className={`${BUTTON} mt-1`}>
                    {showAll ? "Show fewer" : `Show all ${rows.length}`}
                  </button>
                )}
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground">Not checked: {data.notConnected.join(", ")} (not connected yet).</p>
        </div>
      )}
    </section>
  );
}
