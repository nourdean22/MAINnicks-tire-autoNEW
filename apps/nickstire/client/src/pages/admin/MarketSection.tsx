/**
 * MarketSection · 2026-09-08
 *
 * Search Console + the synthesized master report, moved here from
 * StateNour's /market (operator verdict: shop analytics belong in the shop's
 * admin). Reads the same pipeline functions the nour-os bridge serves, via
 * the `market` admin router. Failed or malformed reads say "unknown", never
 * zero — the render matrix feeds every section arbitrary data, and so can a
 * degraded pipeline.
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

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const pct = (n: number | null) => (n == null ? "unknown" : `${(n * 100).toFixed(1)}%`);
const int = (n: number | null) => (n == null ? "unknown" : n.toLocaleString());
const fixed = (n: number | null) => (n == null ? "unknown" : n.toFixed(1));
const rows = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

type QueryRow = { query?: unknown; clicks?: unknown; impressions?: unknown; avgPosition?: unknown };
type PageRow = { page?: unknown; clicks?: unknown; avgCtr?: unknown };

export default function MarketSection() {
  const summary = trpc.market.summary.useQuery(undefined, { staleTime: 5 * 60_000 });
  const queries = trpc.market.topQueries.useQuery({ limit: 10 }, { staleTime: 5 * 60_000 });
  const pages = trpc.market.topPages.useQuery({ limit: 10 }, { staleTime: 5 * 60_000 });
  const report = trpc.market.report.useQuery(undefined, { staleTime: 30 * 60_000 });

  const s = (summary.data ?? null) as Record<string, unknown> | null;
  const r = (report.data ?? null) as Record<string, unknown> | null;
  const queryRows = rows<QueryRow>(queries.data);
  const pageRows = rows<PageRow>(pages.data);

  return (
    <div className="space-y-4">
      <Card title="Search · last 28 days" icon={<Search className="h-4 w-4" />}>
        {summary.isError ? (
          <Unknown what="Search Console summary" />
        ) : summary.isPending ? (
          <p className="text-xs text-white/50">loading…</p>
        ) : !s ? (
          <Unknown what="Search Console summary" />
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Clicks", int(num(s.totalClicks))],
              ["Impressions", int(num(s.totalImpressions))],
              ["CTR", pct(num(s.avgCtr))],
              ["Avg position", fixed(num(s.avgPosition))],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-white/5 p-3">
                <dt className="text-[11px] uppercase tracking-wider text-white/50">{k}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-white">{v}</dd>
              </div>
            ))}
            {str(s.from) && str(s.to) && (
              <p className="col-span-full text-[11px] text-white/40">
                {str(s.from)} → {str(s.to)}
              </p>
            )}
          </dl>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Top queries" icon={<Search className="h-4 w-4" />}>
          {queries.isError ? (
            <Unknown what="Top queries" />
          ) : queries.isPending ? (
            <p className="text-xs text-white/50">loading…</p>
          ) : queryRows.length === 0 ? (
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
                {queryRows.map((q, i) => (
                  <tr key={`${str(q.query) ?? "q"}-${i}`} className="border-t border-white/5">
                    <td className="py-1.5 pr-2 text-white/90">{str(q.query) ?? "unknown"}</td>
                    <td className="py-1.5 text-right tabular-nums">{int(num(q.clicks))}</td>
                    <td className="py-1.5 text-right tabular-nums">{int(num(q.impressions))}</td>
                    <td className="py-1.5 text-right tabular-nums">{fixed(num(q.avgPosition))}</td>
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
          ) : pageRows.length === 0 ? (
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
                {pageRows.map((p, i) => (
                  <tr key={`${str(p.page) ?? "p"}-${i}`} className="border-t border-white/5">
                    <td className="py-1.5 pr-2 break-all text-white/90">{(str(p.page) ?? "unknown").replace(/^https?:\/\/[^/]+/, "")}</td>
                    <td className="py-1.5 text-right tabular-nums">{int(num(p.clicks))}</td>
                    <td className="py-1.5 text-right tabular-nums">{pct(num(p.avgCtr))}</td>
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
        ) : !r || r.ok !== true ? (
          <Unknown what={`The master report${str(r?.error) ? ` (${str(r?.error)})` : ""}`} />
        ) : (
          <div className="space-y-2 text-xs text-white/80">
            {str(r.timestamp) && <p className="text-[11px] text-white/40">as of {new Date(String(r.timestamp)).toLocaleString()}</p>}
            <pre className="whitespace-pre-wrap font-sans leading-relaxed">
              {typeof r.summary === "string" ? r.summary : JSON.stringify(r.summary ?? null, null, 2)}
            </pre>
            {str(r.marginNote) && <p className="text-amber-300">{str(r.marginNote)}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
