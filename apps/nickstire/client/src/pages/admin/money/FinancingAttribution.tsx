/**
 * FinancingAttribution — read-only view over financing.recentClicks.
 *
 * Surfaces provider "Apply Now" clicks (financing_clicks) LEFT JOINed to the
 * originating lead by sessionId. A matched row shows which lead a click belongs
 * to; an unmatched row (leadId null) is an unattributed click, shown honestly
 * rather than hidden. This is the UI for the attribution query shipped with the
 * financing_clicks table — the join the append-only Sheet could never provide.
 */
import { trpc } from "@/lib/trpc";
import { Loader2, CreditCard, Link2, HelpCircle } from "lucide-react";

// recentClicks rides the loosely-typed db() handle (like lead.list), so we
// annotate the row shape locally instead of relying on tRPC inference.
interface FinancingClickRow {
  id: number;
  provider: string;
  sourcePage: string | null;
  sessionId: string | null;
  createdAt: string | Date;
  leadId: number | null;
  leadName: string | null;
  leadPhone: string | null;
}

export function FinancingAttribution() {
  const { data, isLoading } = trpc.financing.recentClicks.useQuery({ limit: 50 });
  const rows = (data ?? []) as FinancingClickRow[];
  const matched = rows.filter((r) => r.leadId != null).length;

  return (
    <div className="bg-card border border-border/30 rounded-lg p-4 mt-6">
      <div className="flex items-center gap-2 mb-1">
        <CreditCard className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm tracking-wide text-foreground">Financing Attribution</h3>
      </div>
      <p className="text-[11px] text-foreground/50 mb-3">
        Provider "Apply Now" clicks joined to the originating lead by session.
        {rows.length > 0 && (
          <span className="ml-1 text-foreground/40">
            {matched}/{rows.length} matched to a lead.
          </span>
        )}
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-foreground/40 py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-foreground/40 py-2">
          No financing clicks recorded yet. Clicks populate once migration 0080 is live and customers use the financing page.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-foreground/40 uppercase tracking-wider text-[10px] border-b border-border/30">
                <th className="text-left font-bold py-1.5 pr-3">Provider</th>
                <th className="text-left font-bold py-1.5 pr-3">Source</th>
                <th className="text-left font-bold py-1.5 pr-3">Attributed lead</th>
                <th className="text-right font-bold py-1.5">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/10">
                  <td className="py-1.5 pr-3 font-mono uppercase text-foreground/70">{r.provider}</td>
                  <td className="py-1.5 pr-3 text-foreground/50 font-mono">{r.sourcePage ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    {r.leadId != null ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <Link2 className="w-3 h-3 shrink-0" />
                        {r.leadName ?? `lead #${r.leadId}`}
                        {r.leadPhone && <span className="text-foreground/40">· {r.leadPhone}</span>}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-foreground/30">
                        <HelpCircle className="w-3 h-3 shrink-0" /> unattributed
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right text-foreground/30 whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
