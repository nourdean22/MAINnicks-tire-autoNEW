/**
 * DataFreshness — Q-23 phase 9 · how current the inputs behind Intelligence HQ are.
 *
 * Four rows: ShopDriver connection, invoice mirror, SMS gateway, and the NHTSA
 * manufacturer-program list behind the work-order drawer (Q-50 phase 3). The first
 * three read existing queries (see ./freshnessRows for which, and why no new reader):
 * `todayPulse` is shared with "Today, for real" through the react-query cache. The
 * NHTSA row is the one extra request, a two-row SELECT polled every 10 minutes,
 * because nothing else on the admin reads the ingest's state.
 *
 * HONESTY · unlike "Today, for real", this card always renders, because its job
 * is to report the reads that failed. A failed read is a row that says
 * "unknown" with UNMEASURED, never an empty card and never "offline".
 */
import { trpc } from "@/lib/trpc";
import { Clock } from "lucide-react";
import { ProvenanceTag } from "../shared/ProvenanceTag";
import { invoiceMirrorRow, nhtsaWarrantyRow, shopDriverRow, smsGatewayRow, type FreshnessRow } from "./freshnessRows";

export function DataFreshness() {
  const shopDriver = trpc.adminSecurity.integrationFreshness.useQuery(undefined, { refetchInterval: 300_000 });
  const pulse = trpc.controlCenter.todayPulse.useQuery(undefined, { refetchInterval: 120_000 });
  const gateway = trpc.sms.gatewayHealth.useQuery(undefined, { refetchInterval: 60_000 });
  // The ingest runs once a day; a 10-minute poll is plenty.
  const nhtsa = trpc.vehicleData.warrantyIngestFreshness.useQuery(undefined, { refetchInterval: 600_000 });

  const now = new Date();
  const rows: FreshnessRow[] = [
    shopDriverRow({ data: shopDriver.data, isError: shopDriver.isError }, now),
    invoiceMirrorRow({ data: pulse.data, isError: pulse.isError }, now),
    smsGatewayRow({ data: gateway.data, isError: gateway.isError }),
    nhtsaWarrantyRow({ data: nhtsa.data, isError: nhtsa.isError }, now),
  ];
  const needsLook = rows.filter((r) => r.loud).length;

  return (
    <div className="bg-card border border-border/30" data-card="data-freshness">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <Clock className="w-4 h-4 text-foreground/60" />
        <span className="text-xs uppercase tracking-[0.15em] text-foreground/70 font-medium">Data freshness</span>
        {needsLook > 0 && (
          <span className="ml-auto text-[11px] text-amber-400" data-freshness-summary>
            {needsLook} need a look
          </span>
        )}
      </div>
      <div className="divide-y divide-border/20">
        {rows.map((r) => (
          <div key={r.key} className="px-4 py-2.5" data-freshness-row={r.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-foreground/60">{r.label}</span>
              <span className={`text-xs font-medium tabular-nums text-right ${r.loud ? "text-amber-400" : "text-foreground/80"}`}>
                {r.status} {r.provenance && <ProvenanceTag provenance={r.provenance} />}
              </span>
            </div>
            {r.detail && <div className="text-[11px] text-foreground/50 mt-0.5">{r.detail}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
