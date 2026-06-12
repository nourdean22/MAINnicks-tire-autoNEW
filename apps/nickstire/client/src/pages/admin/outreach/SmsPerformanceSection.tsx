/**
 * SmsPerformanceSection — wave-181.51
 *
 * Reads the reply + conversion attribution columns added in 0039.
 * Two views in one tab:
 *
 *   1. Per-tier summary (last 30d) — Tier · Sent · Reply % · Conv % · Opt-out %
 *   2. Recent sends drill-in (last 50) — phone · body · tier · reply/conv state
 *
 * No interactivity beyond a tier filter on the drill-in — this is a
 * read-only telemetry surface. Variant management is operator-edits-code
 * per the wave-181.51 spec (no UI for picking variants yet).
 *
 * Empty-state guard: pre-181.51 sends have NULL variantKey and zero
 * reply/conv counts, so on first deploy the operator will see only an
 * "Untagged" row with sent count but 0% rates. That's expected — new
 * sends starting from this wave will populate the real tiers.
 */
import { trpc, type RouterOutputs } from "@/lib/trpc";

type RecentSend = NonNullable<RouterOutputs["smsPerformance"]["recentSends"]>[number];
import { useState, useRef } from "react";
import { BarChart3, MessageSquare, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { PageHeader, LoadingState, EmptyState, formatDateTime } from "../shared";

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${Math.round((num / denom) * 1000) / 10}%`;
}

export default function SmsPerformanceSection() {
  // wave-181.59 · added isError destructure for both queries (Agent C #3 + #7).
  // Server router fail-opens to empty results on DB error, which previously
  // rendered identical UI to "no data yet" — operator couldn't tell outage
  // from genuine empty state. Banner below now distinguishes them.
  const { data: summary, isLoading: sumLoading, isError: sumError } = trpc.smsPerformance.summary30d.useQuery(
    undefined,
    { refetchInterval: 60_000 },
  );

  const [tierFilter, setTierFilter] = useState<string | undefined>(undefined);
  // 2026-05-23 · scroll-target for the recent-sends drill-in card.
  // On phone, tapping a tier row had no visible response because the
  // drill-in is below the fold. Now the filtered list scrolls into
  // view + receives a brief highlight so the connection is obvious.
  const drillInRef = useRef<HTMLDivElement | null>(null);
  function handleTierClick(tierKey: string) {
    const next = tierFilter === tierKey ? undefined : tierKey;
    setTierFilter(next);
    if (next) {
      // setTimeout so the DOM updates with the filter pill first.
      setTimeout(() => drillInRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }
  const { data: recent, isLoading: recentLoading, isError: recentError } = trpc.smsPerformance.recentSends.useQuery(
    { limit: 50, tier: tierFilter },
    { refetchInterval: 60_000 },
  );

  const totalSent = summary?.tiers.reduce((s, t) => s + t.sent, 0) ?? 0;
  const totalReplied = summary?.tiers.reduce((s, t) => s + t.replied, 0) ?? 0;
  const totalConverted = summary?.tiers.reduce((s, t) => s + t.converted, 0) ?? 0;
  const totalOptedOut = summary?.tiers.reduce((s, t) => s + t.optedOut, 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SMS Performance"
        subtitle={
          `Per-tier reply + conversion attribution · last 30 days · reply window ` +
          `${summary?.replyWindowDays ?? 7}d · conversion window ${summary?.conversionWindowDays ?? 14}d`
        }
        icon={<BarChart3 className="w-5 h-5" />}
      />

      {/* wave-181.59 · error banner — surfaces server-side failures that
          would otherwise present as a misleading "no data" empty state. */}
      {(sumError || recentError) && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span className="font-medium">SMS Performance data couldn't load.</span>{" "}
          <span className="text-red-200/70">
            The server returned an error (DB connection issue, schema migration not applied, or auth failure). Numbers below may be stale or zero — refresh in a moment or check Railway logs.
          </span>
        </div>
      )}

      {/* Totals row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border/30 p-4">
          <span className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Sent · 30d</span>
          <span className="text-2xl font-semibold tabular-nums">{sumLoading ? "—" : totalSent}</span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Reply rate</span>
          <span className="text-2xl font-semibold text-emerald-400 tabular-nums">{sumLoading ? "—" : pct(totalReplied, totalSent)}</span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Conv rate · 14d</span>
          <span className="text-2xl font-semibold text-primary tabular-nums">{sumLoading ? "—" : pct(totalConverted, totalSent)}</span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Opt-out rate</span>
          <span className="text-2xl font-semibold text-red-400 tabular-nums">{sumLoading ? "—" : pct(totalOptedOut, totalSent)}</span>
        </div>
      </div>

      {/* Per-tier table */}
      <div className="bg-card border border-border/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-foreground/60" />
          <span className="text-xs uppercase tracking-[0.15em] text-foreground/70 font-medium">By tier · 30d</span>
        </div>
        {sumLoading ? (
          <LoadingState label="Loading SMS performance..." />
        ) : !summary || summary.tiers.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="w-8 h-8 text-foreground/30" />}
            title="No data yet"
            subtitle="Send an outbound SMS via a cron or the admin Messages tab — performance will populate here."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-foreground/[0.02] border-b border-border/30">
              <tr className="text-left text-[11px] uppercase tracking-[0.15em] text-foreground/50">
                <th className="px-4 py-2.5 font-medium">Tier</th>
                <th className="px-4 py-2.5 font-medium text-right">Sent</th>
                <th className="px-4 py-2.5 font-medium text-right">Replied</th>
                <th className="px-4 py-2.5 font-medium text-right">Reply %</th>
                <th className="px-4 py-2.5 font-medium text-right">Converted</th>
                <th className="px-4 py-2.5 font-medium text-right">Conv %</th>
                <th className="px-4 py-2.5 font-medium text-right">Opt-out %</th>
              </tr>
            </thead>
            <tbody>
              {summary.tiers.map((t) => (
                <tr
                  key={t.key}
                  className={`border-b border-border/20 hover:bg-foreground/[0.02] cursor-pointer ${tierFilter === t.key ? "bg-primary/[0.04]" : ""}`}
                  onClick={() => handleTierClick(t.key)}
                  title="Click to filter the recent-sends drill-in below"
                >
                  <td className="px-4 py-2.5">{t.tier}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{t.sent}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{t.replied}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400">{pct(t.replied, t.sent)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{t.converted}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-primary">{pct(t.converted, t.sent)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-400">{pct(t.optedOut, t.sent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent-sends drill-in */}
      <div ref={drillInRef} className="bg-card border border-border/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-foreground/60" />
            <span className="text-xs uppercase tracking-[0.15em] text-foreground/70 font-medium">
              Recent sends {tierFilter ? <span className="text-primary">· filtered: {tierFilter}</span> : ""}
            </span>
          </div>
          {tierFilter && (
            <button
              onClick={() => setTierFilter(undefined)}
              className="text-xs text-foreground/50 hover:text-foreground/80 transition-colors"
            >
              clear filter
            </button>
          )}
        </div>
        {recentLoading ? (
          <div className="py-10 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-primary/60" />
          </div>
        ) : !recent || recent.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="w-8 h-8 text-foreground/30" />}
            title="No recent sends"
            subtitle={tierFilter ? `No outbound sends in the "${tierFilter}" tier yet.` : "No outbound sends recorded yet."}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-foreground/[0.02] border-b border-border/30">
              <tr className="text-left text-[11px] uppercase tracking-[0.15em] text-foreground/50">
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Phone</th>
                <th className="px-4 py-2.5 font-medium">Tier</th>
                <th className="px-4 py-2.5 font-medium">Body</th>
                <th className="px-4 py-2.5 font-medium text-center">Reply</th>
                <th className="px-4 py-2.5 font-medium text-center">Conv</th>
                <th className="px-4 py-2.5 font-medium text-center">Opt-out</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r: RecentSend) => (
                <tr key={r.id} className="border-b border-border/20 hover:bg-foreground/[0.02]">
                  <td className="px-4 py-2.5 text-foreground/70 whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                  <td className="px-4 py-2.5 font-mono text-foreground/70">···{r.phoneSuffix}</td>
                  <td className="px-4 py-2.5 text-foreground/80">{r.tier}</td>
                  <td className="px-4 py-2.5 text-foreground/70 truncate max-w-xs" title={r.body}>{r.body}</td>
                  <td className="px-4 py-2.5 text-center">
                    {r.replyCount > 0
                      ? <CheckCircle2 className="w-4 h-4 inline text-emerald-400" />
                      : <span className="text-foreground/20">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {r.convertedCount > 0
                      ? <CheckCircle2 className="w-4 h-4 inline text-primary" />
                      : <span className="text-foreground/20">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {r.optOutAt
                      ? <XCircle className="w-4 h-4 inline text-red-400" />
                      : <span className="text-foreground/20">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
