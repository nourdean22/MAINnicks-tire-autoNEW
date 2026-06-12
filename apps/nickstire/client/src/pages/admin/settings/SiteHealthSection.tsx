/**
 * SiteHealthSection — extracted from Admin.tsx for maintainability.
 */
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, ExternalLink, Eye, FileSpreadsheet, Gauge, Globe, Loader2, MapPin, PieChart, RefreshCw, Search, Sparkles, Star, TrendingUp, XCircle, Heart
} from "lucide-react";
import { PageHeader, ErrorState, formatDateTime } from "../shared";
import { deriveSheetsSyncHealth, type SheetsSyncStatus } from "../siteHealth/sheetsSyncHealth";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell, Legend
} from "recharts";
import DatabaseHygienePanel from "./DatabaseHygienePanel";

export default function SiteHealthSection() {
  const { data: health, isLoading, isError, refetch } = trpc.adminDashboard.siteHealth.useQuery();
  const { data: reviews } = trpc.reviews.google.useQuery();
  // 2026-05-30 · surface the self-healing reliability machinery the operator
  // couldn't see anywhere. This procedure (generateDiagnosticReport) already
  // existed but had ZERO consumers — it computes healthScore/state/components/
  // trends/watchdog every 60s. Poll it here so "Site Health" finally leads with
  // actual system reliability, not just SEO. Pure read of already-computed data.
  const { data: diag } = trpc.adminDashboard.systemDiagnostics.useQuery(undefined, { refetchInterval: 60_000 });
  // Read-only integration-failure visibility — silent sheets/CAPI/SMS/email
  // breakage that can lose leads. Safe fields only (raw payloads never exposed).
  const { data: failData } = trpc.adminDashboard.integrationFailures.useQuery(undefined, { refetchInterval: 60_000 });
  // journey/CAPI wave 2026-06 - env-presence booleans only; values never leave the server.
  const { data: capi } = trpc.adminDashboard.capiStatus.useQuery(undefined, { staleTime: 60_000 });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Site Health"
          subtitle="Domain status · search rankings · review velocity · GA4 + GSC · vendor uptime"
          icon={<Heart className="w-5 h-5" />}
        />
        <ErrorState message="Couldn't load site-health data" onRetry={() => refetch()} />
      </div>
    );
  }

  // wave-143 — was `if (!health) return null` which silently rendered
  // nothing on error (network fail, GSC timeout). Operator saw the
  // section disappear with no feedback. Now: explicit empty state.
  if (!health) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Site Health"
          subtitle="Domain status · search rankings · review velocity · GA4 + GSC · vendor uptime"
          icon={<Heart className="w-5 h-5" />}
        />
        <div className="bg-card border border-border/30 py-12 px-6 text-center">
          <Heart className="w-8 h-8 text-foreground/15 mx-auto mb-3" />
          <h4 className="text-foreground/70 font-medium tracking-tight">Health data unavailable</h4>
          <p className="text-foreground/40 text-[13px] mt-1 max-w-sm mx-auto">
            The site-health endpoint returned no data. Either GSC/GA4 hasn't synced yet, or the vendor is timing out. Try again in a moment.
          </p>
        </div>
      </div>
    );
  }

  // wave-2 · derive Sheets/CRM sync trust from the (already-queried) integration-
  // failure feed. Pure mapper — sheets-sync logs failures only, so "Healthy" means
  // "no recent failures logged", never a fabricated last-success.
  const sheetsSync = deriveSheetsSyncHealth(failData);
  const sheetsSyncMeta: Record<SheetsSyncStatus, { label: string; pill: string; icon: string }> = {
    healthy: { label: "Healthy", pill: "text-emerald-400 bg-emerald-500/10", icon: "text-emerald-400" },
    warning: { label: "Warning", pill: "text-amber-400 bg-amber-500/10", icon: "text-amber-400" },
    failing: { label: "Failing", pill: "text-red-400 bg-red-500/10", icon: "text-red-400" },
    unknown: { label: "Unknown", pill: "text-foreground/50 bg-foreground/5", icon: "text-foreground/40" },
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Site Health"
        subtitle="System reliability · domain status · search rankings · review velocity · vendor uptime"
        icon={<Heart className="w-5 h-5" />}
      />

      {/* ── SYSTEM RELIABILITY (2026-05-30) ──────────────────
          Surfaces server/lib/self-healing.ts — healthScore, self-heal state,
          per-component recovery, watchdog liveness, trend early-warnings.
          Was computed every 60s but rendered nowhere. */}
      {diag && (
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            SYSTEM RELIABILITY
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={`p-4 border text-center ${diag.healthScore >= 80 ? "border-emerald-500/30 bg-emerald-500/5" : diag.healthScore >= 50 ? "border-amber-500/30 bg-amber-500/5" : "border-red-500/30 bg-red-500/5"}`}>
              <p className={`font-bold text-3xl ${diag.healthScore >= 80 ? "text-emerald-400" : diag.healthScore >= 50 ? "text-amber-400" : "text-red-400"}`}>{diag.healthScore}</p>
              <p className="text-[11px] text-foreground/50 mt-1">Health score · {diag.state}</p>
            </div>
            <div className="p-4 border border-border/20 text-center">
              <p className="font-bold text-3xl text-foreground">{Math.floor(diag.uptime / 3600)}h</p>
              <p className="text-[11px] text-foreground/50 mt-1">Uptime</p>
            </div>
            <div className="p-4 border border-border/20 text-center">
              <p className="font-bold text-3xl text-foreground">{diag.memory.heapPercent}<span className="text-sm text-foreground/40">%</span></p>
              <p className="text-[11px] text-foreground/50 mt-1">Heap · {diag.memory.rssMB}MB RSS</p>
            </div>
            <div className={`p-4 border text-center ${diag.watchdog.healthy ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
              <p className={`font-bold text-lg ${diag.watchdog.healthy ? "text-emerald-400" : "text-red-400"}`}>{diag.watchdog.healthy ? "OK" : "STALE"}</p>
              <p className="text-[11px] text-foreground/50 mt-1">Watchdog · {diag.eventLoopLagMs}ms lag</p>
            </div>
          </div>

          {/* Per-component self-heal status */}
          {Object.keys(diag.components).length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              {Object.entries(diag.components).map(([name, c]) => (
                <div key={name} className="flex items-center justify-between p-3 border border-border/20">
                  <span className="text-[13px] text-foreground capitalize">{name.replace(/-/g, " ")}</span>
                  <div className="flex items-center gap-2">
                    {c.recoveryCount > 0 && <span className="text-[11px] text-foreground/40">{c.recoveryCount} heal{c.recoveryCount === 1 ? "" : "s"}</span>}
                    {c.status === "ok" || c.status === "up"
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      : <XCircle className="w-4 h-4 text-red-400" />}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Trend early-warnings — only render when a metric is actually flagged */}
          {diag.trends.some(t => t.warning) && (
            <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-[12px] font-medium text-amber-400 mb-1">Trend warnings</p>
              <ul className="text-[12px] text-foreground/60 space-y-0.5">
                {diag.trends.filter(t => t.warning).map(t => (
                  <li key={t.metric}>{t.metric}: {t.warning}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-foreground/40 mt-3">
            Traffic: {diag.requestRate.currentPerMinute}/min now · {diag.requestRate.averagePerMinute}/min avg · {diag.requestRate.peakPerMinute}/min peak
          </p>
        </div>
      )}

      {/* ── INTEGRATION FAILURES (read-only) ─────────────────
          Silent breakage that can lose leads — sheets sync, CAPI, SMS, email.
          Safe fields only; raw error payloads are never exposed. */}
      {failData && (
        <div className="bg-card border border-border/30 p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-sm tracking-wide text-foreground flex items-center gap-2">
              <AlertTriangle className={`w-4 h-4 ${failData.counts.leadAffectingUnresolved > 0 ? "text-red-400" : failData.counts.unresolved > 0 ? "text-amber-400" : "text-emerald-400"}`} />
              INTEGRATION FAILURES
            </h3>
            <span className="text-[11px] text-foreground/40">
              {failData.counts.unresolved} unresolved · {failData.counts.recent} recent
            </span>
          </div>

          {failData.failures.length === 0 ? (
            <div className="flex items-center gap-2 p-3 border border-emerald-500/20 bg-emerald-500/5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-[13px] text-foreground/70">No integration failures logged — sheets sync, CAPI, SMS &amp; email are clean.</span>
            </div>
          ) : (
            <>
              {failData.counts.leadAffectingUnresolved > 0 && (
                <div className="mb-3 border border-red-500/40 bg-red-500/5 p-3 text-[12px] text-red-300">
                  {failData.counts.leadAffectingUnresolved} unresolved lead-affecting failure{failData.counts.leadAffectingUnresolved === 1 ? "" : "s"} (sheets / CAPI / SMS / email) — a lead may have been lost. Review the rows below.
                </div>
              )}
              <div className="flex flex-wrap gap-2 mb-3">
                {Object.entries(failData.counts.byType).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
                  <span key={type} className="text-[11px] px-2 py-0.5 rounded bg-foreground/5 border border-border/30 text-foreground/60 capitalize">
                    {type.replace(/_/g, " ")}: {n}
                  </span>
                ))}
              </div>
              <div className="space-y-2">
                {failData.failures.map((f) => (
                  <div
                    key={f.id}
                    className={`flex items-start justify-between gap-3 p-3 border ${f.resolved ? "border-border/20 opacity-60" : f.leadAffecting ? "border-red-500/30" : "border-amber-500/30"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-semibold text-foreground capitalize">{f.failureType.replace(/_/g, " ")}</span>
                        <span className="text-[10px] text-foreground/40">{f.entityType}{f.entityId != null ? ` #${f.entityId}` : ""}</span>
                        {f.leadAffecting && !f.resolved && (
                          <span className="text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">LEAD RISK</span>
                        )}
                        {f.resolved && (
                          <span className="text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">RESOLVED</span>
                        )}
                      </div>
                      <p className="text-[12px] text-foreground/55 mt-0.5 break-words">{f.message || "—"}</p>
                    </div>
                    <span className="text-[10px] text-foreground/40 whitespace-nowrap shrink-0">{formatDateTime(f.createdAt)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── SHEETS SYNC HEALTH (read-only) ───────────────────
          Is the Google Sheets / CRM sync trustworthy or silently stale?
          server/sheets-sync.ts is fire-and-forget and logs FAILURES only (no
          last-success signal), so this derives from the same integration-failure
          feed above, filtered to sheets_sync. "Healthy" = no recent failures
          logged — never a fabricated success/timestamp. */}
      <div className="bg-card border border-border/30 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm tracking-wide text-foreground flex items-center gap-2">
            <FileSpreadsheet className={`w-4 h-4 ${sheetsSyncMeta[sheetsSync.status].icon}`} />
            SHEETS SYNC HEALTH
          </h3>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${sheetsSyncMeta[sheetsSync.status].pill}`}>
            {sheetsSyncMeta[sheetsSync.status].label}
          </span>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-foreground/50">Affected source</span>
            <span className="text-foreground/75">Google Sheets / CRM</span>
          </div>

          {/* HONESTY · sheets-sync tracks no last-success timestamp or row count. */}
          <p className="text-[12px] text-foreground/40">Last successful sync not tracked yet.</p>

          {sheetsSync.status === "unknown" && (
            <p className="text-[12px] text-foreground/50">Integration log not loaded yet — status unavailable.</p>
          )}

          {sheetsSync.lastFailure && (
            <div className={`p-3 border ${sheetsSync.lastFailure.resolved ? "border-border/20" : "border-red-500/30 bg-red-500/5"}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-semibold text-foreground">Last failure</span>
                {sheetsSync.lastFailure.resolved ? (
                  <span className="text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">RESOLVED</span>
                ) : (
                  <span className="text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">UNRESOLVED</span>
                )}
                <span className="ml-auto text-[10px] text-foreground/40 whitespace-nowrap">{formatDateTime(sheetsSync.lastFailure.createdAt)}</span>
              </div>
              <p className="text-[12px] text-foreground/55 mt-0.5 break-words">{sheetsSync.lastFailure.message || "—"}</p>
            </div>
          )}

          {/* Next action — only when the evidence supports it. */}
          {sheetsSync.status === "failing" && (
            <div className="flex items-start gap-2 p-2.5 border border-red-500/30 bg-red-500/5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <span className="text-[12px] text-red-300">Next · investigate Sheets credentials — a recent sync failed and is unresolved.</span>
            </div>
          )}
          {sheetsSync.status === "warning" && (
            <div className="flex items-start gap-2 p-2.5 border border-amber-500/30 bg-amber-500/5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span className="text-[12px] text-amber-300">Next · watch the next sync — a recent failure was marked resolved.</span>
            </div>
          )}
          {sheetsSync.status === "healthy" && (
            <div className="flex items-center gap-2 p-2.5 border border-emerald-500/20 bg-emerald-500/5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-[12px] text-foreground/70">No recent Sheets sync failures logged.</span>
            </div>
          )}

          {health.sheetsUrl && (
            <a href={health.sheetsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-primary hover:text-primary/80">
              Check Google Sheet <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      {/* ── META CAPI STATUS (read-only) ─────────────────────
          Server-side conversion tracking is DORMANT until the owner sets
          META_CAPI_ACCESS_TOKEN in Railway (docs/runbooks/CAPI-ACTIVATION.md).
          Booleans only — the token value never reaches the browser. */}
      <div className="bg-card border border-border/30 p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm tracking-wide text-foreground">META SERVER-SIDE CONVERSIONS (CAPI)</h3>
          {capi && (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${capi.tokenConfigured ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
              {capi.tokenConfigured ? "ACTIVE" : "DORMANT"}
            </span>
          )}
        </div>
        <p className="text-[12px] text-foreground/55">
          {capi?.tokenConfigured
            ? "Access token configured - Lead/Schedule events send server-side with hashed PII and pixel event-id dedup. Verify arrivals in Meta Events Manager."
            : "No access token set - zero Meta traffic is sent (ad-blocked/iOS conversions are NOT being recovered). One Railway env var activates it: see docs/runbooks/CAPI-ACTIVATION.md."}
        </p>
      </div>

      {/* Domain Status */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          DOMAINS
        </h3>
        <div className="space-y-3">
          {health.domains.map(domain => (
            <div key={domain} className="flex items-center justify-between p-3 border border-border/20">
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-[13px] text-foreground">{domain}</span>
              </div>
              <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="text-foreground/40 hover:text-primary transition-colors">
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* SEO & Sitemap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            SEO STATUS
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="text-[13px] text-foreground/70">Sitemap Pages</span>
              <span className="font-bold text-lg text-primary">{health.sitemapPageCount}+</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="text-[13px] text-foreground/70">Total Blog Posts</span>
              <span className="font-bold text-lg text-foreground">{health.totalBlogPosts}</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="text-[13px] text-foreground/70">Hardcoded Articles</span>
              <span className="text-[13px] text-foreground/50">{health.hardcodedBlogPosts}</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="text-[13px] text-foreground/70">AI-Generated Articles</span>
              <span className="text-[13px] text-foreground/50">{health.dynamicBlogPosts}</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="text-[13px] text-foreground/70">Google Search Console</span>
              <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:text-primary/80 text-[13px]">
                View <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Index Coverage Panel */}
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            INDEX COVERAGE
          </h3>
          <div className="space-y-4">
            {/* wave-187 — server returns 0 to mean "unknown · GSC not wired"
                (admin-stats.ts:getSiteHealth). `?? "—"` does NOT catch 0, so a
                fully-indexed 207-page site rendered a confident "0 Indexed" =
                reads as deindexed. Treat 0/falsy as unknown → show "—". */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 border border-emerald-500/30 bg-emerald-500/5 text-center">
                <p className="font-bold text-3xl text-emerald-400">{health.indexedPages || "—"}</p>
                <p className="text-[11px] text-foreground/50 mt-1">Indexed</p>
              </div>
              <div className="p-4 border border-amber-500/30 bg-amber-500/5 text-center">
                <p className="font-bold text-3xl text-amber-400">{health.notIndexedPages || "—"}</p>
                <p className="text-[11px] text-foreground/50 mt-1">Not Indexed</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] text-foreground/40 tracking-wide">NOT INDEXED REASONS</p>
              <div className="flex items-center justify-between p-2.5 border border-border/20">
                <span className="text-[12px] text-foreground/60">Crawled — currently not indexed</span>
                <span className="text-[13px] font-semibold text-amber-400">{health.crawledNotIndexed || "—"}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 border border-border/20">
                <span className="text-[12px] text-foreground/60">Discovered — currently not indexed</span>
                <span className="text-[13px] font-semibold text-amber-400">{health.discoveredNotIndexed || "—"}</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-2.5 border border-border/20">
              <span className="text-[12px] text-foreground/60">Validation Status</span>
              <span className="text-[12px] text-emerald-400">{(health as typeof health & { validationStatus?: string }).validationStatus ?? "Check GSC"}</span>
            </div>
            <a href="https://search.google.com/search-console/index?resource_id=https%3A%2F%2Fnickstire.org%2F" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 text-primary hover:text-primary/80 text-[12px] p-2 border border-primary/20 hover:border-primary/40 transition-colors">
              View Full Report in GSC <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Search Engine Submissions */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          SEARCH ENGINE SUBMISSIONS
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="p-4 border border-border/20">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="text-[13px] font-semibold text-foreground">Google Search Console</span>
            </div>
            <div className="space-y-1.5">
              <p className="text-[12px] text-foreground/50">Sitemap: <span className="text-emerald-400">Submitted</span></p>
              {/* wave-143 — these two lines were hardcoded ("68" pages,
                  today's date as "last read") regardless of actual GSC
                  data. Operator saw fake confidence. Until real GSC data
                  is wired through, show "—" so it's clearly placeholder. */}
              <p className="text-[12px] text-foreground/50">Pages discovered: <span className="text-foreground/40">—</span></p>
              <p className="text-[12px] text-foreground/50">Last read: <span className="text-foreground/40">—</span></p>
            </div>
          </div>
          <div className="p-4 border border-border/20">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="text-[13px] font-semibold text-foreground">Bing Webmaster Tools</span>
            </div>
            <div className="space-y-1.5">
              <p className="text-[12px] text-foreground/50">Status: <span className="text-emerald-400">Submitted</span></p>
              <p className="text-[12px] text-foreground/50">IndexNow API: <span className="text-foreground">Available</span></p>
              <a href="https://www.bing.com/webmasters" target="_blank" rel="noopener noreferrer" className="text-[12px] text-primary hover:text-primary/80 flex items-center gap-1">
                Manage <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <div className="p-4 border border-border/20">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="text-[13px] font-semibold text-foreground">Meta Pixel</span>
            </div>
            <div className="space-y-1.5">
              <p className="text-[12px] text-foreground/50">Pixel ID: <span className="text-foreground">958472373260171</span></p>
              <p className="text-[12px] text-foreground/50">Events: <span className="text-emerald-400">Lead, Schedule, Contact</span></p>
              <p className="text-[12px] text-foreground/50">CAPI: <span className="text-amber-400">Needs access token</span></p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
            <Star className="w-4 h-4 text-primary" />
            GOOGLE REVIEWS
          </h3>
          {reviews ? (
            <div className="space-y-4">
              <div className="text-center p-6 border border-border/20">
                <div className="flex items-center justify-center gap-1 mb-2">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className={`w-6 h-6 ${i < Math.round(reviews.rating || BUSINESS.reviews.rating) ? "fill-primary text-primary" : "text-foreground/20"}`} />
                  ))}
                </div>
                <p className="font-bold text-4xl text-foreground">{reviews.rating || BUSINESS.reviews.rating}</p>
                <p className="text-[13px] text-foreground/50 mt-1">
                  {typeof reviews.totalReviews === "number" && reviews.totalReviews > 0
                    ? `${reviews.totalReviews.toLocaleString("en-US")}+`
                    : BUSINESS.reviews.countDisplay}{" "}
                  reviews
                </p>
              </div>
              {reviews.reviews && reviews.reviews.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[12px] text-foreground/40 tracking-wide">Recent Reviews</p>
                  {reviews.reviews.slice(0, 3).map((review: { authorName?: string; rating?: number; text?: string }, i: number) => (
                    <div key={i} className="p-3 border border-border/20">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px] text-foreground">{review.authorName || "Customer"}</span>
                        <div className="flex gap-0.5">
                          {[...Array(review.rating || 5)].map((_, j) => (
                            <Star key={j} className="w-3 h-3 fill-primary text-primary" />
                          ))}
                        </div>
                      </div>
                      <p className="text-[12px] text-foreground/50 line-clamp-2">{review.text || ""}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <Star className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
              <p className="text-[13px] text-foreground/40">Reviews data loading...</p>
            </div>
          )}
        </div>
      </div>

      {/* Integrations */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          INTEGRATIONS
        </h3>
        {/* wave-187 — Instagram Feed + AI Content Gen previously hardcoded
            status:true → always green "Connected" with NO probe (false
            telemetry). They have no live health check, so mark them
            `unprobed` and render a neutral "Not verified" state instead of
            implying a confirmed connection. Sheets/Reviews keep their real
            boolean status. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { name: "Google Sheets CRM", status: health.sheetsConfigured, icon: <FileSpreadsheet className="w-5 h-5" />, link: health.sheetsUrl },
            { name: "Google Reviews", status: !!reviews, icon: <Star className="w-5 h-5" />, link: "https://business.google.com/" },
            { name: "Instagram Feed", status: false, unprobed: true, icon: <Eye className="w-5 h-5" />, link: "https://instagram.com/nicks_tire_euclid" },
            { name: "AI Content Gen", status: false, unprobed: true, icon: <Sparkles className="w-5 h-5" />, link: undefined },
          ].map((integration) => (
            <div key={integration.name} className="flex items-center gap-3 p-4 border border-border/20">
              <div className={`${integration.unprobed ? "text-foreground/40" : integration.status ? "text-emerald-400" : "text-red-400"}`}>
                {integration.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-foreground truncate">{integration.name}</p>
                <p className={`text-[12px] ${integration.unprobed ? "text-foreground/40" : integration.status ? "text-emerald-400" : "text-red-400"}`}>
                  {integration.unprobed ? "Not verified" : integration.status ? "Connected" : "Not configured"}
                </p>
              </div>
              {integration.link && (
                <a href={integration.link} target="_blank" rel="noopener noreferrer" className="text-foreground/30 hover:text-primary">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Database Hygiene & Cleanup Panel */}
      <DatabaseHygienePanel />
    </div>
  );
}
