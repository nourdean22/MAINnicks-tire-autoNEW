/**
 * MarketSection · 2026-09-08
 *
 * Search Console + the synthesized master report, moved here from
 * StateNour's /market (operator verdict: shop analytics belong in the shop's
 * admin). Reads the same pipeline functions the nour-os bridge serves, via
 * the `market` admin router. Failed reads say "unknown", never zero.
 */
import React from "react";
import { Radar, Search, FileText, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-black/30 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Unknown({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 text-xs text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5" /> {what} could not be read — unknown, not zero.
    </p>
  );
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function MarketSection() {
  const summary = trpc.market.summary.useQuery(undefined, { staleTime: 5 * 60_000 });
  const queries = trpc.market.topQueries.useQuery({ limit: 10 }, { staleTime: 5 * 60_000 });
  const pages = trpc.market.topPages.useQuery({ limit: 10 }, { staleTime: 5 * 60_000 });
  const report = trpc.market.report.useQuery(undefined, { staleTime: 30 * 60_000 });

  return (
    <div className="space-y-4">
      <Card title="Search · last 28 days" icon={<Search className="h-4 w-4" />}>
        {summary.isError ? (
          <Unknown what="Search Console summary" />
        ) : summary.isPending ? (
          <p className="text-xs text-white/50">loading…</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Clicks", summary.data.totalClicks.toLocaleString()],
              ["Impressions", summary.data.totalImpressions.toLocaleString()],
              ["CTR", pct(summary.data.avgCtr)],
              ["Avg position", summary.data.avgPosition.toFixed(1)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-white/5 p-3">
                <dt className="text-[11px] uppercase tracking-wider text-white/50">{k}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-white">{v}</dd>
              </div>
            ))}
            <p className="col-span-full text-[11px] text-white/40">
              {summary.data.from} → {summary.data.to}
            </p>
          </dl>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Top queries" icon={<Search className="h-4 w-4" />}>
          {queries.isError ? (
            <Unknown what="Top queries" />
          ) : queries.isPending ? (
            <p className="text-xs text-white/50">loading…</p>
          ) : queries.data.length === 0 ? (
            <p className="text-xs text-white/50">No query rows in the window yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-white/50">
                <tr>
                  <th className="py-1 text-left">query</th>
                  <th className="py-1 text-right">clicks</th>
                  <th className="py-1 text-right">impr.</th>
                  <th className="py-1 text-right">pos.</th>
                </tr>
              </thead>
              <tbody>
                {queries.data.map((q) => (
                  <tr key={q.query} className="border-t border-white/5">
                    <td className="py-1.5 pr-2 text-white/90">{q.query}</td>
                    <td className="py-1.5 text-right tabular-nums">{q.clicks}</td>
                    <td className="py-1.5 text-right tabular-nums">{q.impressions}</td>
                    <td className="py-1.5 text-right tabular-nums">{q.avgPosition.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Top pages" icon={<FileText className="h-4 w-4" />}>
          {pages.isError ? (
            <Unknown what="Top pages" />
          ) : pages.isPending ? (
            <p className="text-xs text-white/50">loading…</p>
          ) : pages.data.length === 0 ? (
            <p className="text-xs text-white/50">No page rows in the window yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-white/50">
                <tr>
                  <th className="py-1 text-left">page</th>
                  <th className="py-1 text-right">clicks</th>
                  <th className="py-1 text-right">ctr</th>
                </tr>
              </thead>
              <tbody>
                {pages.data.map((p) => (
                  <tr key={p.page} className="border-t border-white/5">
                    <td className="py-1.5 pr-2 break-all text-white/90">{p.page.replace(/^https?:\/\/[^/]+/, "")}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.clicks}</td>
                    <td className="py-1.5 text-right tabular-nums">{pct(p.avgCtr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Master report" icon={<Radar className="h-4 w-4" />}>
        {report.isError ? (
          <Unknown what="The master report" />
        ) : report.isPending ? (
          <p className="text-xs text-white/50">generating…</p>
        ) : !report.data.ok ? (
          <Unknown what={`The master report (${report.data.error})`} />
        ) : (
          <div className="space-y-2 text-xs text-white/80">
            <p className="text-[11px] text-white/40">as of {new Date(report.data.timestamp).toLocaleString()}</p>
            <pre className="whitespace-pre-wrap font-sans leading-relaxed">{typeof report.data.summary === "string" ? report.data.summary : JSON.stringify(report.data.summary, null, 2)}</pre>
            {report.data.marginNote && <p className="text-amber-300">{report.data.marginNote}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
