/**
 * Settings & Sync → ShopDriver Command Center
 *
 * Nick's Tire is FCFS (first come first serve). All revenue flows through
 * ShopDriver/ALG. This page is the nerve center:
 *
 * 1. ALG connection status + last sync time
 * 2. Invoice/customer counts from mirror
 * 3. One-click sync, probe, backfill controls
 * 4. Walk-in vs website lead classification
 * 5. Declined work (ALG estimates that didn't convert) = recovery revenue
 * 6. Free inspections tracking (keeps shop busy, no charge on quick ones)
 */
import { useState, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, CheckCircle2, XCircle, Wifi, WifiOff,
  Users, FileText, TrendingUp, Search, Upload, Zap,
  AlertTriangle, Clock, DollarSign, Wrench, ArrowRight,
  ToggleLeft, ToggleRight,
  Activity, Shield, Plug, Settings,
} from "lucide-react";
import { PageHeader, SectionInsightStrip, TabBar, Panel } from "./shared";

// Lazy-loaded system tabs — Nour's request: "move all system stuff to the settings page"
// Consolidates System Health, Compliance, and Integrations into this hub so
// the sidebar stays focused on business work, not admin plumbing.
const SiteHealthSection = lazy(() => import("./SiteHealthSection"));
const ComplianceSection = lazy(() => import("./ComplianceSection"));
const IntegrationsSection = lazy(() => import("./IntegrationsSection"));

type SettingsTab = "shopdriver" | "health" | "compliance" | "integrations";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode; subtitle: string }> = [
  { id: "shopdriver", label: "ShopDriver HQ", icon: <Wrench className="w-3.5 h-3.5" />, subtitle: "ALG sync + probe + backfill" },
  { id: "health", label: "System Health", icon: <Activity className="w-3.5 h-3.5" />, subtitle: "Uptime, DB, vendor status" },
  { id: "compliance", label: "Compliance", icon: <Shield className="w-3.5 h-3.5" />, subtitle: "Audit log + TCPA + admin logins" },
  { id: "integrations", label: "Integrations", icon: <Plug className="w-3.5 h-3.5" />, subtitle: "Twilio, Google, Snap, Gateway" },
];

function StatCard({ label, value, icon, color = "text-foreground", sub }: {
  label: string; value: string | number; icon: React.ReactNode; color?: string; sub?: string;
}) {
  return (
    <div className="bg-card border border-border/30 p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{label}</span>
        <div className="text-muted-foreground/30">{icon}</div>
      </div>
      <div className={`font-bold text-2xl tracking-tight ${color}`}>{value}</div>
      {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export default function SettingsSection() {
  // Initial tab from ?settingsTab=X OR ?tab=X (legacy-route support).
  // Default: ShopDriver HQ. If Nour deep-links ?tab=health, Admin.tsx routes
  // him to this Settings page — and this resolver picks up `health` as the
  // inner tab so he lands exactly where he expected.
  const initialTab = (() => {
    if (typeof window === "undefined") return "shopdriver" as SettingsTab;
    const qp = new URLSearchParams(window.location.search);
    const raw = (qp.get("settingsTab") || qp.get("tab") || "").toLowerCase();
    const valid: SettingsTab[] = ["shopdriver", "health", "compliance", "integrations"];
    if (valid.includes(raw as SettingsTab)) return raw as SettingsTab;
    // Legacy aliases that matched AdminSection names
    if (raw === "integrations") return "integrations";
    if (raw === "settings") return "shopdriver";
    return "shopdriver";
  })();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("settingsTab", tab);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const [syncing, setSyncing] = useState<string | null>(null);
  // Sync result shape is consistent across all shopdriver mutations
  // (returns { success, synced, updated, error?, hint? }). probeResults
  // is opaque diagnostic JSON used for displaying ALG endpoint discovery,
  // so it's intentionally untyped at the consumer level.
  type SyncPayload = {
    success?: boolean;
    synced?: number;
    updated?: number;
    error?: string;
    hint?: string;
  };
  type ImportLogRow = {
    id: number;
    createdAt: string | Date;
    totalRows: number;
    newCustomers?: number | null;
    updatedCustomers?: number | null;
    status: string;
  };
  const [probeResults, setProbeResults] = useState<unknown>(null);
  const [syncResult, setSyncResult] = useState<{ type: string; data: SyncPayload } | null>(null);

  // ALG connection status
  const { data: algStatus, isLoading: algLoading } = trpc.autoLabor.status.useQuery(undefined, { staleTime: 30_000 });

  // Invoice + customer counts
  const { data: invoiceStats } = trpc.adminDashboard.stats.useQuery(undefined, { staleTime: 60_000 });

  // Sync mutations
  const syncInvoicesMut = trpc.shopdriver.syncInvoices.useMutation();
  const syncCustomersMut = trpc.shopdriver.syncCustomers.useMutation();

  // ALG probe
  const { refetch: runProbe, isFetching: probing } = trpc.autoLabor.probeEndpoints.useQuery(undefined, {
    enabled: false,
    staleTime: 0,
  });

  // Import history
  const { data: importHistory } = trpc.shopdriver.importHistory.useQuery(undefined, { staleTime: 120_000 });

  const handleSync = async (type: "invoices" | "customers") => {
    setSyncing(type);
    setSyncResult(null);
    try {
      const result = type === "invoices"
        ? await syncInvoicesMut.mutateAsync()
        : await syncCustomersMut.mutateAsync();
      setSyncResult({ type, data: result });
    } catch (err: unknown) {
      setSyncResult({ type, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
    } finally {
      setSyncing(null);
    }
  };

  const handleProbe = async () => {
    setProbeResults(null);
    const { data } = await runProbe();
    setProbeResults(data);
  };

  const connected = algStatus?.connected ?? false;
  const usingFallback = algStatus?.usingFallback ?? true;

  if (algLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings & System"
        subtitle="ShopDriver/ALG sync · system health · compliance audit · vendor integrations · feature flags"
        icon={<Settings className="w-5 h-5" />}
      />
      <SectionInsightStrip section="settings" />

      {/* Tab bar — survives page reloads via ?settingsTab URL param */}
      <TabBar
        tabs={SETTINGS_TABS}
        activeTab={activeTab}
        onChange={handleTabChange}
      />

      {/* Lazy-loaded tabs — these are the former sidebar sections */}
      {activeTab === "health" && (
        <Suspense fallback={<div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
          <SiteHealthSection />
        </Suspense>
      )}
      {activeTab === "compliance" && (
        <Suspense fallback={<div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
          <ComplianceSection />
        </Suspense>
      )}
      {activeTab === "integrations" && (
        <Suspense fallback={<div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
          <IntegrationsSection />
        </Suspense>
      )}

      {/* ─── ShopDriver HQ tab (default) ──────────────────── */}
      {activeTab === "shopdriver" && (
      <div className="space-y-6">
      <div>
        <h3 className="font-bold text-xl text-foreground tracking-wider">SHOPDRIVER COMMAND CENTER</h3>
        <p className="text-foreground/50 text-[12px] mt-1">
          ALG is the source of truth. Invoices = closed jobs. No website booking = walk-in. Estimates = declined work.
        </p>
      </div>

      {/* Connection Status Banner */}
      <div className={`flex items-center gap-3 p-4 border ${
        connected ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"
      }`}>
        {connected ? <Wifi className="w-5 h-5 text-emerald-400" /> : <WifiOff className="w-5 h-5 text-red-400" />}
        <div className="flex-1">
          <span className={`font-bold text-sm ${connected ? "text-emerald-400" : "text-red-400"}`}>
            {connected ? "ALG CONNECTED" : "ALG OFFLINE — Using Built-in Labor Guide"}
          </span>
          <p className="text-foreground/50 text-[11px] mt-0.5">
            {connected
              ? `Authenticated as ${algStatus?.accountId || "?"} • Last check: ${algStatus?.lastAuthCheck || "just now"}`
              : algStatus?.error || "No credentials configured"
            }
          </p>
        </div>
        <div className="text-right">
          <span className="font-mono text-[10px] text-foreground/30">
            {algStatus?.fallbackCategories || 0} categories • {algStatus?.fallbackJobs || 0} jobs
          </span>
          <br />
          <span className="font-mono text-[10px] text-foreground/30">
            {algStatus?.totalLookups || 0} lookups total
          </span>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="INVOICES THIS WEEK"
          value={invoiceStats?.shopFloor?.invoicesThisWeek ?? "—"}
          icon={<FileText className="w-4 h-4" />}
          sub={`$${Math.round(invoiceStats?.shopFloor?.revenueThisWeek ?? 0).toLocaleString()} revenue`}
        />
        <StatCard
          label="CUSTOMERS"
          value={invoiceStats?.shopFloor?.totalCustomers ?? "—"}
          icon={<Users className="w-4 h-4" />}
          sub={`${invoiceStats?.shopFloor?.vipCustomers ?? 0} VIP (3+ visits)`}
        />
        <StatCard
          label="AVG TICKET"
          value={`$${Math.round(invoiceStats?.shopFloor?.avgTicket ?? 0)}`}
          icon={<DollarSign className="w-4 h-4" />}
          sub="From ALG invoices"
        />
        <StatCard
          label="WEBSITE LEADS"
          value={invoiceStats?.leads?.total ?? "—"}
          icon={<TrendingUp className="w-4 h-4" />}
          color={Number(invoiceStats?.leads?.urgent || 0) > 0 ? "text-red-400" : "text-foreground"}
          sub={`${invoiceStats?.leads?.urgent ?? 0} urgent • rest = walk-ins`}
        />
      </div>

      {/* Business Model Card */}
      <div className="bg-primary/5 border border-primary/20 p-4">
        <h4 className="font-bold text-xs text-primary tracking-wide mb-2">HOW DATA FLOWS</h4>
        <div className="text-foreground/60 text-xs leading-relaxed space-y-1">
          <p><span className="text-foreground font-medium">Invoice in ALG</span> → Closed job, revenue counted. Customer auto-created/updated.</p>
          <p><span className="text-foreground font-medium">Website booking/lead</span> → Tracked as online conversion. Everything else = walk-in (FCFS).</p>
          <p><span className="text-foreground font-medium">ALG estimate (no invoice)</span> → Declined work. Customer walked. Recovery opportunity.</p>
          <p><span className="text-foreground font-medium">Quick inspection (no charge)</span> → Free service, keeps bays busy, builds trust. Not lost revenue.</p>
        </div>
      </div>

      {/* Sync Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Sync Invoices */}
        <button
          onClick={() => handleSync("invoices")}
          disabled={syncing === "invoices"}
          className="flex items-center gap-3 bg-card border border-border/30 p-4 hover:border-primary/30 transition-colors text-left group"
        >
          {syncing === "invoices" ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : <RefreshCw className="w-5 h-5 text-foreground/50 group-hover:text-primary transition-colors" />}
          <div>
            <span className="font-bold text-sm text-foreground">Sync Invoices</span>
            <p className="text-foreground/40 text-[11px]">Pull latest from ALG → DB</p>
          </div>
        </button>

        {/* Sync Customers */}
        <button
          onClick={() => handleSync("customers")}
          disabled={syncing === "customers"}
          className="flex items-center gap-3 bg-card border border-border/30 p-4 hover:border-primary/30 transition-colors text-left group"
        >
          {syncing === "customers" ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : <Users className="w-5 h-5 text-foreground/50 group-hover:text-primary transition-colors" />}
          <div>
            <span className="font-bold text-sm text-foreground">Sync Customers</span>
            <p className="text-foreground/40 text-[11px]">Merge ALG customer data</p>
          </div>
        </button>

        {/* Probe ALG Endpoints */}
        <button
          onClick={handleProbe}
          disabled={probing}
          className="flex items-center gap-3 bg-card border border-border/30 p-4 hover:border-primary/30 transition-colors text-left group"
        >
          {probing ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : <Search className="w-5 h-5 text-foreground/50 group-hover:text-primary transition-colors" />}
          <div>
            <span className="font-bold text-sm text-foreground">Probe ALG API</span>
            <p className="text-foreground/40 text-[11px]">Discover available endpoints</p>
          </div>
        </button>
      </div>

      {/* Sync Result */}
      {syncResult && (
        <div className={`p-4 border ${syncResult.data?.success !== false ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
          <div className="flex items-center gap-2 mb-1">
            {syncResult.data?.success !== false ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
            <span className="font-bold text-xs tracking-wide">
              {syncResult.type.toUpperCase()} SYNC {syncResult.data?.success !== false ? "COMPLETE" : "FAILED"}
            </span>
          </div>
          <p className="text-foreground/60 text-xs">
            {syncResult.data?.error || `${syncResult.data?.synced || 0} synced, ${syncResult.data?.updated || 0} updated`}
          </p>
          {syncResult.data?.hint && (
            <p className="text-foreground/40 text-[11px] mt-1 italic">{syncResult.data.hint}</p>
          )}
        </div>
      )}

      {/* Probe Results */}
      {probeResults && (
        <div className="bg-card border border-border/30 p-4">
          <h3 className="font-bold text-sm text-foreground tracking-wide mb-3">ALG ENDPOINT DISCOVERY</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(probeResults).map(([endpoint, result]: [string, any]) => (
              <div key={endpoint} className={`flex items-center gap-2 p-2 border ${
                result.status >= 200 && result.status < 400 ? "border-emerald-500/20 bg-emerald-500/5" : "border-border/20"
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  result.status >= 200 && result.status < 400 ? "bg-emerald-400" : "bg-foreground/20"
                }`} />
                <span className="font-mono text-[11px] text-foreground/70 flex-1 truncate">{endpoint}</span>
                <span className={`font-mono text-[10px] ${
                  result.status >= 200 && result.status < 400 ? "text-emerald-400" : "text-foreground/30"
                }`}>
                  {result.status} {result.isJson ? "JSON" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CSV Import History */}
      {importHistory && importHistory.length > 0 && (
        <div className="bg-card border border-border/30 p-4">
          <h3 className="font-bold text-sm text-foreground tracking-wide mb-3">IMPORT HISTORY</h3>
          <div className="space-y-2">
            {importHistory.slice(0, 5).map((h: ImportLogRow) => (
              <div key={h.id} className="flex items-center gap-3 text-[12px] py-2 border-b border-border/10 last:border-0">
                <Clock className="w-3.5 h-3.5 text-foreground/30" />
                <span className="text-foreground/50 w-36">{new Date(h.createdAt).toLocaleString()}</span>
                <span className="text-foreground">{h.totalRows} rows</span>
                <span className="text-emerald-400">{h.newCustomers || 0} new</span>
                <span className="text-foreground/50">{h.updatedCustomers || 0} updated</span>
                <span className={`ml-auto font-bold text-[10px] tracking-wide ${
                  h.status === "completed" ? "text-emerald-400" : h.status === "failed" ? "text-red-400" : "text-amber-400"
                }`}>
                  {h.status?.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2026-05-05 — VAPI VOICE RECEPTIONIST */}
      <VapiPanel />

      {/* 2026-05-05 — ESTIMATE ENDPOINT DIAGNOSTIC */}
      <EstimateEndpointDiagnosticPanel />

      {/* 2026-05-05 — ALG PROBE BUDGET PANEL */}
      <AlgProbeBudgetPanel />

      {/* 2026-05-05 — DECLINED RECOVERY STATUS */}
      <DeclinedRecoveryPanel />

      {/* Cron Status */}
      <Panel
        title="Autonomous Operations"
        subtitle="These run automatically. No manual action needed."
        icon={<Zap className="w-4 h-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { name: "ALG Overnight Probe", interval: "Daily 3 AM ET", desc: "Single nightly sync — shop closed, no Moe risk" },
            { name: "ALG On-Login Probe", interval: "On admin login", desc: "Fresh data when you arrive at /admin" },
            { name: "ALG Chat-Demand Probe", interval: "On Nick query", desc: "Probes when Nick asks for shop pulse" },
            { name: "Intelligence Autopilot", interval: "Every 2h", desc: "Lead scoring, revenue pacing, cross-sell" },
            { name: "No-Show Detection", interval: "Daily", desc: "Flags past-date bookings, sends SMS" },
            { name: "Declined Work Recovery", interval: "Daily", desc: "7d/30d SMS to walk-aways (DRY-RUN until env set)" },
            { name: "Review Auto-Draft", interval: "Daily", desc: "AI drafts for new Google reviews" },
            { name: "Cross-Sell Outreach", interval: "Daily", desc: "SMS recommendations from service history" },
            { name: "Stale Booking Cleanup", interval: "Daily", desc: "Auto-cancels 30+ day old bookings" },
            { name: "Callback Escalation", interval: "Every 2h", desc: "Re-alerts on unanswered callbacks >4h" },
          ].map(job => (
            <div key={job.name} className="flex items-center gap-3 p-2.5 border border-border/10">
              <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-foreground text-[12px] font-medium">{job.name}</span>
                <p className="text-foreground/40 text-[10px] truncate">{job.desc}</p>
              </div>
              <span className="font-mono text-[10px] text-primary/60 whitespace-nowrap">{job.interval}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Feature Flags */}
      <FeatureFlagsPanel />
      </div>
      )}
    </div>
  );
}

// ─── ESTIMATE ENDPOINT DIAGNOSTIC ─────────────────────────
// Pings 13 JSON endpoints + 5 HTML pages on Moe's ShopDriver tenant to
// figure out which one actually returns estimate data. Once we find a
// working endpoint, alg_estimates can populate and the recovery flow
// (7d/30d SMS, walk-away strip on Overview, brain digest) all activate.

interface EstimateProbeResult {
  endpoint: string;
  type: "json" | "html";
  status: number;
  contentType: string;
  bytes: number;
  itemCount: number | null;
  firstChars: string;
}

function EstimateEndpointDiagnosticPanel() {
  const [results, setResults] = useState<EstimateProbeResult[] | null>(null);
  const [working, setWorking] = useState<number>(0);
  const probe = trpc.shopdriver.probeEstimateEndpoints.useMutation({
    onSuccess: (data) => {
      setResults(data.results);
      setWorking(data.working);
      toast.success(`Probed ${data.total} endpoints · ${data.working} returned estimates`);
    },
    onError: (err: { message: string }) => toast.error("Probe failed: " + err.message),
  });

  return (
    <div className="bg-card border border-border/30 p-4 space-y-4">
      {/* 2026-05-05 — Prior probe finding: all 18 candidates returned 404 on
          Moe's tenant. Estimate sync is blocked at the vendor side, not
          at our code. This banner exists so we don't re-probe wastefully. */}
      <div className="bg-amber-500/[0.05] border border-amber-500/30 px-3 py-2.5 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 text-[11px] leading-relaxed text-foreground/70">
          <p className="text-amber-400 font-bold tracking-wide mb-0.5">VENDOR-BLOCKED · last probe 2026-05-05</p>
          <p>
            All 13 JSON + 5 HTML candidates returned 404 on this tenant. ShopDriver exposes /api/Customer/* and /api/Ticket/* but NOT /api/Estimate/*. To unblock walk-away recovery: <span className="text-foreground font-medium">ask ShopDriver support to expose the Estimate API on this tenant</span>, or import estimates via CSV manually.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-foreground tracking-wide">
            ESTIMATE ENDPOINT DISCOVERY
          </h3>
          <p className="text-foreground/50 text-[11px] mt-0.5 max-w-xl">
            alg_estimates table is empty because we don't know which ShopDriver endpoint Moe's tenant exposes. This pings 13 JSON + 5 HTML candidates and shows exactly what each one says. Once we find a working one, walk-away recovery activates.
          </p>
        </div>
        <button
          onClick={() => probe.mutate()}
          disabled={probe.isPending}
          className="flex items-center gap-2 bg-amber-500/15 text-amber-400 border border-amber-500/30 px-4 py-2 font-bold text-xs tracking-wide hover:bg-amber-500/25 disabled:opacity-50"
        >
          {probe.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          DISCOVER ENDPOINTS
        </button>
      </div>

      {results && results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-[11px]">
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-bold">
              {working} working
            </span>
            <span className="px-2 py-0.5 rounded bg-foreground/10 text-foreground/60 font-bold">
              {results.filter((r) => r.status === 200).length} 200 OK
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold">
              {results.filter((r) => r.status === 404).length} 404
            </span>
            <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400 font-bold">
              {results.filter((r) => r.status === 401 || r.status === 403).length} auth-failed
            </span>
          </div>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {results.map((r, i) => {
              const isWorking = r.status === 200 && r.contentType.includes("json") && (r.itemCount ?? 0) > 0;
              const isJsonOk = r.status === 200 && r.contentType.includes("json");
              const statusColor =
                isWorking ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                isJsonOk ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                r.status === 200 ? "bg-foreground/10 text-foreground/60 border-border/20" :
                r.status === 404 ? "bg-amber-500/10 text-amber-400 border-amber-500/30" :
                "bg-red-500/10 text-red-400 border-red-500/30";
              return (
                <div key={i} className={`border ${statusColor} p-2.5 text-[11px]`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-foreground/40 w-12 shrink-0">{r.type.toUpperCase()}</span>
                    <span className="font-bold w-12 shrink-0">{r.status}</span>
                    <span className="font-mono text-foreground truncate flex-1">{r.endpoint}</span>
                    {r.itemCount !== null && r.itemCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold whitespace-nowrap">
                        {r.itemCount} items
                      </span>
                    )}
                    <span className="text-foreground/40 whitespace-nowrap">{r.bytes}b</span>
                  </div>
                  {(isWorking || isJsonOk) && (
                    <p className="text-foreground/50 text-[10px] mt-1 font-mono truncate">{r.firstChars}</p>
                  )}
                </div>
              );
            })}
          </div>
          {working > 0 && (
            <div className="border-t border-emerald-500/30 pt-3 mt-3 bg-emerald-500/5 -mx-4 px-4 -mb-4 pb-4">
              <p className="text-emerald-400 text-[12px] font-bold">
                ✓ Found {working} working endpoint{working > 1 ? "s" : ""} — alg_estimates will populate on next probe!
              </p>
              <p className="text-foreground/50 text-[11px] mt-1">
                Trigger a manual refresh from the panel below to start the import.
              </p>
            </div>
          )}
          {working === 0 && (
            <div className="border-t border-amber-500/30 pt-3 mt-3 bg-amber-500/5 -mx-4 px-4 -mb-4 pb-4">
              <p className="text-amber-400 text-[12px] font-bold">
                ⚠ No working JSON endpoints — HTML scrape fallback will run on next probe.
              </p>
              <p className="text-foreground/50 text-[11px] mt-1">
                ShopDriver tenant doesn't expose any of the 13 JSON candidate names. The estimate sync will fall through to HTML scraping the portal's Estimates page (less reliable but better than nothing).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ALG PROBE BUDGET PANEL ───────────────────────────────
// Shows demand-driven probe activity. Replaces the "every 5 min cron"
// model that was kicking Moe out of ShopDriver.

function AlgProbeBudgetPanel() {
  const utils = trpc.useUtils();
  const { data: probeData } = trpc.shopdriver.recentProbes.useQuery({ limit: 12 }, { staleTime: 30_000 });
  const requestProbe = trpc.shopdriver.requestProbe.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.outcome === "success"
          ? `Probe complete · ${result.recordsProcessed} records`
          : result.outcome === "skipped_recent"
            ? "Skipped — data is already fresh (<5 min)"
            : result.outcome === "dedup"
              ? "Deduped — another probe just fired"
              : `Probe ${result.outcome}`,
      );
      utils.shopdriver.recentProbes.invalidate();
    },
    onError: (err: { message: string }) => toast.error("Probe failed: " + err.message),
  });

  const probes = probeData?.probes ?? [];
  const state = probeData?.state;
  const lastFresh = state?.lastProbeFinishedAt ? new Date(state.lastProbeFinishedAt) : null;
  const ageSec = state?.secondsSinceLastFinish ?? null;

  const outcomeColor: Record<string, string> = {
    success: "text-emerald-400",
    auth_failed: "text-red-400",
    empty: "text-amber-400",
    dedup: "text-foreground/40",
    skipped_recent: "text-foreground/40",
    error: "text-red-400",
  };
  const reasonColor: Record<string, string> = {
    admin_login: "text-blue-400",
    chat_query: "text-purple-400",
    manual_refresh: "text-primary",
    overnight: "text-emerald-400",
    health_check: "text-foreground/50",
  };

  return (
    <div className="bg-card border border-border/30 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-foreground tracking-wide">ALG PROBE BUDGET</h3>
          <p className="text-foreground/50 text-[11px] mt-0.5">
            Demand-driven probe scheduler. Probes only fire on login, chat queries, manual refresh, or 3 AM ET overnight.
          </p>
        </div>
        <button
          onClick={() => requestProbe.mutate({ reason: "manual_refresh" })}
          disabled={requestProbe.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 disabled:opacity-50"
        >
          {requestProbe.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          REFRESH FROM ALG
        </button>
      </div>

      {/* State summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Last Fresh</p>
          <p className="text-foreground font-medium">{ageSec !== null ? `${Math.round(ageSec / 60)} min ago` : "—"}</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">In Flight</p>
          <p className="text-foreground font-medium">{state?.inFlight ? "Yes" : "No"}</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Probes (24h)</p>
          <p className="text-foreground font-medium">
            {probes.filter((p: { startedAt: string | Date }) => new Date(p.startedAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)).length}
          </p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Last Outcome</p>
          <p className={`font-medium ${probes[0] ? (outcomeColor[probes[0].outcome] || "text-foreground") : "text-foreground/40"}`}>
            {probes[0]?.outcome?.toUpperCase() || "—"}
          </p>
        </div>
      </div>

      {/* Recent probes */}
      {probes.length > 0 && (
        <details className="border-t border-border/10 pt-3">
          <summary className="cursor-pointer text-[11px] font-bold tracking-wider text-foreground/50 hover:text-foreground/80">
            RECENT PROBES · LAST {probes.length}
          </summary>
          <div className="mt-2 space-y-1">
            {probes.map((p: { id: number; reason: string; outcome: string; recordsProcessed: number; durationMs: number; detail: string | null; startedAt: string | Date }) => {
              const date = new Date(p.startedAt);
              const t = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false });
              const d = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <div key={p.id} className="flex items-center gap-3 text-[11px] py-1 border-b border-border/10">
                  <span className="text-foreground/40 w-24 shrink-0">{d} {t}</span>
                  <span className={`font-bold tracking-wider w-20 shrink-0 ${reasonColor[p.reason] || "text-foreground/60"}`}>{p.reason.replace("_", " ").toUpperCase()}</span>
                  <span className={`font-bold tracking-wider w-16 shrink-0 ${outcomeColor[p.outcome] || "text-foreground/60"}`}>{p.outcome.toUpperCase()}</span>
                  <span className="text-foreground/50 w-20 shrink-0">{p.recordsProcessed} rec · {p.durationMs}ms</span>
                  {p.detail && <span className="text-foreground/40 truncate flex-1 italic">{p.detail}</span>}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── VAPI VOICE RECEPTIONIST PANEL ────────────────────────
// Connection status · one-click assistant create · recent-call log.
// The Vapi assistant answers when no human picks up — books slots,
// quotes ranges, escalates, sends recap SMS. ROI estimate ~360x.

interface VapiCallRow {
  id: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  customerNumber?: string;
  endedReason?: string;
  cost?: number;
  summary?: string;
  structuredData?: Record<string, unknown>;
  successEvaluation?: string;
}

function VapiPanel() {
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.vapi.status.useQuery(undefined, { staleTime: 60_000 });
  const { data: callsData } = trpc.vapi.recentCalls.useQuery({ limit: 10 }, {
    staleTime: 60_000,
    enabled: status?.connected ?? false,
  });
  const createAssistant = trpc.vapi.createAssistant.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Assistant created · ID ${result.assistantId?.slice(0, 12)}…`);
        utils.vapi.status.invalidate();
      } else {
        toast.error("Create failed: " + (result.error || "unknown"));
      }
    },
    onError: (err: { message: string }) => toast.error("Create failed: " + err.message),
  });
  const updateAssistant = trpc.vapi.updateAssistant.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Assistant updated · prompt + tools + settings re-pushed");
        utils.vapi.status.invalidate();
      } else {
        toast.error("Update failed: " + (result.error || "unknown"));
      }
    },
    onError: (err: { message: string }) => toast.error("Update failed: " + err.message),
  });

  const connected = status?.connected ?? false;
  const firstAssistantId = status?.assistants?.[0]?.id;

  return (
    <div className={`bg-card border ${connected ? "border-emerald-500/30" : "border-amber-500/30"} p-4 space-y-4`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-foreground tracking-wide">
            VAPI VOICE RECEPTIONIST · {isLoading ? "…" : connected ? "CONNECTED" : "OFFLINE"}
          </h3>
          <p className="text-foreground/50 text-[11px] mt-0.5 max-w-2xl">
            AI answers when no human picks up. Books slots, quotes ranges, escalates frustrated callers, sends recap SMS. Industry data: 27% of inbound auto-shop calls go unanswered during open hours; 68% after hours. Recovery target: ~$6-15k/mo at this shop's volume.
          </p>
        </div>
        <span className={`px-2.5 py-1 text-[10px] font-bold tracking-wider rounded ${connected ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
          {connected
            ? `${status?.assistantCount ?? 0} ASSISTANT${(status?.assistantCount ?? 0) === 1 ? "" : "S"}`
            : "API KEY MISSING OR INVALID"}
        </span>
      </div>

      {/* Status states */}
      {!connected && (
        <div className="border border-amber-500/30 bg-amber-500/[0.05] p-3 text-[11px] text-foreground/70 leading-relaxed">
          {status?.error
            ? <>Vapi error: <span className="font-mono text-amber-400">{status.error}</span></>
            : <>Set <span className="font-mono">VAPI_API_KEY</span> in Vercel env to connect.</>
          }
        </div>
      )}

      {connected && (status?.assistantCount ?? 0) === 0 && (
        <div className="border border-blue-500/30 bg-blue-500/[0.05] p-3 space-y-2">
          <p className="text-[12px] text-foreground/80">
            Connected but no assistant configured yet. Click below to create the production receptionist with the canonical voice + tools wired to <span className="font-mono">/api/webhooks/vapi</span>.
          </p>
          <button
            onClick={() => createAssistant.mutate({ serverUrl: "https://nickstire.org/api/webhooks/vapi" })}
            disabled={createAssistant.isPending}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 disabled:opacity-50"
          >
            {createAssistant.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            CREATE ASSISTANT
          </button>
        </div>
      )}

      {/* Assistants + Update button */}
      {status?.assistants && status.assistants.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-foreground/50">Configured Assistants</p>
            {firstAssistantId && (
              <button
                onClick={() => updateAssistant.mutate({ assistantId: firstAssistantId, serverUrl: "https://nickstire.org/api/webhooks/vapi" })}
                disabled={updateAssistant.isPending}
                className="flex items-center gap-1.5 border border-primary/30 text-primary bg-primary/5 px-3 py-1 text-[10px] font-bold tracking-wide hover:bg-primary/10 disabled:opacity-50"
              >
                {updateAssistant.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {updateAssistant.isPending ? "PUSHING..." : "PUSH LATEST CONFIG"}
              </button>
            )}
          </div>
          {status.assistants.map((a: { id: string; name: string; createdAt: string }) => (
            <div key={a.id} className="flex items-center justify-between gap-3 text-[11px] py-1.5 border-b border-border/10">
              <span className="text-foreground font-medium truncate">{a.name}</span>
              <span className="font-mono text-foreground/40 shrink-0">{a.id.slice(0, 12)}…</span>
              <span className="text-foreground/40 shrink-0">{new Date(a.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
          <p className="text-[10px] text-foreground/40 italic mt-1">
            Push Latest Config = re-deploys the optimal Vapi assistant settings (Deepgram nova-2-phonecall, GPT-4o, ElevenLabs Adam turbo, smart endpointing, voicemail detection, structured-data analysis, tire-first prompt).
          </p>
        </div>
      )}

      {/* Recent calls — enriched with structured data + success eval */}
      {connected && callsData?.calls && callsData.calls.length > 0 && (
        <details className="border-t border-border/10 pt-3" open>
          <summary className="cursor-pointer text-[11px] font-bold tracking-wider text-foreground/50 hover:text-foreground/80">
            RECENT CALLS · LAST {callsData.calls.length}
          </summary>
          <div className="mt-2 space-y-3">
            {(callsData.calls as VapiCallRow[]).map((c) => {
              const date = c.startedAt ? new Date(c.startedAt) : null;
              const day = date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
              const time = date ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";
              const dur = c.durationSeconds ? `${Math.round(c.durationSeconds)}s` : "—";
              const cost = c.cost ? `$${c.cost.toFixed(2)}` : "—";
              const sd = c.structuredData ?? {};
              const callType = sd.callType as string | undefined;
              const outcome = sd.outcome as string | undefined;
              const sentiment = sd.sentiment as string | undefined;
              const followUpNeeded = sd.followUpNeeded as boolean | undefined;
              const tireSize = sd.tireSize as string | undefined;
              const vehicle = sd.vehicle as string | undefined;

              const successColor =
                c.successEvaluation === "PASS" ? "bg-emerald-500/15 text-emerald-400" :
                c.successEvaluation === "FAIL" ? "bg-red-500/15 text-red-400" :
                "bg-foreground/10 text-foreground/40";
              const sentimentColor =
                sentiment === "positive" ? "text-emerald-400" :
                sentiment === "negative" ? "text-red-400" :
                "text-foreground/50";
              const callTypeColor =
                callType === "tire_inquiry" ? "bg-primary/15 text-primary" :
                callType === "booking" ? "bg-emerald-500/15 text-emerald-400" :
                callType === "complaint" ? "bg-red-500/15 text-red-400" :
                "bg-blue-500/15 text-blue-400";

              return (
                <div key={c.id} className="border border-border/20 p-3 space-y-2">
                  {/* Header row */}
                  <div className="flex items-center gap-3 flex-wrap text-[11px]">
                    <span className="text-foreground/40 shrink-0">{day} {time}</span>
                    <span className="font-mono text-foreground shrink-0">{c.customerNumber || "Unknown"}</span>
                    <span className="text-foreground/50 shrink-0">{dur}</span>
                    <span className="text-emerald-400/60 shrink-0">{cost}</span>
                    {callType && (
                      <span className={`px-2 py-0.5 rounded font-bold tracking-wider text-[9px] ${callTypeColor}`}>
                        {callType.replace("_", " ").toUpperCase()}
                      </span>
                    )}
                    {c.successEvaluation && (
                      <span className={`px-2 py-0.5 rounded font-bold tracking-wider text-[9px] ${successColor}`}>
                        {c.successEvaluation}
                      </span>
                    )}
                    {followUpNeeded && (
                      <span className="px-2 py-0.5 rounded font-bold tracking-wider text-[9px] bg-amber-500/15 text-amber-400">
                        FOLLOW UP
                      </span>
                    )}
                  </div>
                  {/* Summary */}
                  {c.summary && (
                    <p className="text-[12px] text-foreground/70 leading-relaxed">{c.summary}</p>
                  )}
                  {/* Structured data badges */}
                  {(tireSize || vehicle || outcome || sentiment) && (
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      {tireSize && (
                        <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">
                          {tireSize}
                        </span>
                      )}
                      {vehicle && (
                        <span className="px-2 py-0.5 rounded bg-foreground/5 text-foreground/60">
                          {vehicle}
                        </span>
                      )}
                      {outcome && (
                        <span className="px-2 py-0.5 rounded bg-foreground/5 text-foreground/60">
                          → {outcome.replace("_", " ")}
                        </span>
                      )}
                      {sentiment && (
                        <span className={`px-2 py-0.5 rounded bg-foreground/5 ${sentimentColor}`}>
                          {sentiment}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {connected && callsData?.calls && callsData.calls.length === 0 && (
        <p className="text-[11px] text-foreground/40 italic">
          No calls yet. The assistant goes live when Twilio is configured to forward unanswered calls to Vapi (one-time Twilio dashboard setup — ask vendor for SIP URL).
        </p>
      )}
    </div>
  );
}

// ─── DECLINED RECOVERY STATUS PANEL ───────────────────────
// Surfaces FEATURE_DECLINED_RECOVERY env flag state + recoverable $.

function DeclinedRecoveryPanel() {
  const { data } = trpc.shopdriver.declinedRecoveryStatus.useQuery(undefined, { staleTime: 60_000 });
  if (!data) return null;
  const live = data.featureEnabled;

  return (
    <div className={`bg-card border ${live ? "border-emerald-500/30" : "border-amber-500/30"} p-4`}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-bold text-sm text-foreground tracking-wide">
            DECLINED-WORK RECOVERY · {live ? "LIVE" : "DRY RUN"}
          </h3>
          <p className="text-foreground/50 text-[11px] mt-0.5">
            7-day + 30-day SMS follow-ups to ALG estimates that never converted to invoice.
          </p>
        </div>
        <span className={`px-2.5 py-1 text-[10px] font-bold tracking-wider rounded ${live ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
          {live ? "FEATURE ENABLED" : "FEATURE OFF"}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Eligible</p>
          <p className="text-foreground font-bold text-lg">{data.eligible ?? 0}</p>
          <p className="text-foreground/40 text-[10px]">unmatched estimates</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Recoverable</p>
          <p className="text-emerald-400 font-bold text-lg">${data.recoverableDollars ?? 0}</p>
          <p className="text-foreground/40 text-[10px]">walked-away $</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Next 7-day</p>
          <p className="text-foreground font-bold text-lg">{data.next7dSends ?? 0}</p>
          <p className="text-foreground/40 text-[10px]">due to send</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Next 30-day</p>
          <p className="text-foreground font-bold text-lg">{data.next30dSends ?? 0}</p>
          <p className="text-foreground/40 text-[10px]">due to send</p>
        </div>
      </div>

      <p className={`mt-3 text-[12px] ${live ? "text-emerald-300/80" : "text-amber-300/80"}`}>
        {data.message}
      </p>
    </div>
  );
}

// ─── FEATURE FLAG CATEGORIES ──────────────────────────
type FlagCategory = {
  label: string;
  keys: string[];
  matchFn: (key: string) => boolean;
};

const FLAG_CATEGORIES: FlagCategory[] = [
  {
    label: "Customer Intelligence",
    keys: ["engine_churn_prediction", "engine_repeat_visit_predictor", "engine_customer_risk_scores", "engine_value_trend", "engine_service_affinity"],
    matchFn: (k) => ["engine_churn_prediction", "engine_repeat_visit_predictor", "engine_customer_risk_scores", "engine_value_trend", "engine_service_affinity"].includes(k),
  },
  {
    label: "Revenue Intelligence",
    keys: ["engine_revenue_anomaly", "engine_cash_flow_forecast", "engine_profit_margins", "engine_pricing_intelligence", "engine_seasonal_demand"],
    matchFn: (k) => ["engine_revenue_anomaly", "engine_cash_flow_forecast", "engine_profit_margins", "engine_pricing_intelligence", "engine_seasonal_demand"].includes(k),
  },
  {
    label: "Operations Intelligence",
    keys: ["engine_tech_efficiency", "engine_capacity_forecast", "engine_turnaround_time", "engine_no_show_predictor"],
    matchFn: (k) => ["engine_tech_efficiency", "engine_capacity_forecast", "engine_turnaround_time", "engine_no_show_predictor"].includes(k),
  },
  {
    label: "Marketing Intelligence",
    keys: ["engine_channel_roi", "engine_review_velocity", "engine_lead_response_time", "engine_content_performance", "engine_competitor_monitor"],
    matchFn: (k) => ["engine_channel_roi", "engine_review_velocity", "engine_lead_response_time", "engine_content_performance", "engine_competitor_monitor"].includes(k),
  },
  {
    label: "SMS / Outreach",
    keys: ["sms_appointment_reminders", "sms_review_requests", "sms_retention_sequences", "sms_blast_enabled", "smart_sms_auto_reply", "sms_cross_sell_outreach", "sms_auto_quote"],
    matchFn: (k) => k.startsWith("sms_") || k === "smart_sms_auto_reply",
  },
  {
    label: "Experience",
    keys: ["fomo_ticker_enabled", "dynamic_social_proof", "smart_exit_intent", "financing_pre_approval", "drop_off_sms_flow", "uber_integration_cta"],
    matchFn: (k) => ["fomo_ticker_enabled", "dynamic_social_proof", "smart_exit_intent", "financing_pre_approval", "drop_off_sms_flow", "uber_integration_cta"].includes(k),
  },
  {
    label: "Admin / CEO",
    keys: ["live_telegram_feed", "daily_wins_digest", "master_intelligence_report", "safety_monitor_telegram"],
    matchFn: (k) => ["live_telegram_feed", "daily_wins_digest", "master_intelligence_report", "safety_monitor_telegram"].includes(k),
  },
];

function categorizeFlags(flags: Array<{ key: string; value: boolean; description: string | null }>) {
  const categorized: Array<{ label: string; flags: typeof flags }> = [];
  const claimed = new Set<string>();

  for (const cat of FLAG_CATEGORIES) {
    const matching = flags.filter(f => cat.matchFn(f.key));
    if (matching.length > 0) {
      categorized.push({ label: cat.label, flags: matching });
      matching.forEach(f => claimed.add(f.key));
    }
  }

  // Remaining flags go to "Other"
  const remaining = flags.filter(f => !claimed.has(f.key));
  if (remaining.length > 0) {
    categorized.push({ label: "Other", flags: remaining });
  }

  return categorized;
}

// ─── FEATURE FLAGS PANEL ──────────────────────────────
function FeatureFlagsPanel() {
  const utils = trpc.useUtils();
  const { data: flags, isLoading } = trpc.featureFlags.list.useQuery();
  const toggleMut = trpc.featureFlags.toggle.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.key} ${result.value ? "ENABLED" : "DISABLED"}`);
      utils.featureFlags.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="bg-card border border-border/30 p-4">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const allFlags = flags ?? [];
  const enabledCount = allFlags.filter(f => f.value).length;
  const grouped = categorizeFlags(allFlags);

  return (
    <div className="bg-card border border-border/30 p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-sm text-foreground tracking-wide">FEATURE FLAGS</h3>
          <p className="text-foreground/50 text-[11px] mt-0.5">
            {enabledCount} of {allFlags.length} enabled. Customer-contacting automations check these before executing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 font-mono text-[10px] font-bold tracking-wide px-2 py-1 border ${
            enabledCount > 0 ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" : "text-foreground/30 border-border/20"
          }`}>
            {enabledCount} ON
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold tracking-wide px-2 py-1 border text-foreground/30 border-border/20">
            {allFlags.length - enabledCount} OFF
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {grouped.map((group) => {
          const groupEnabled = group.flags.filter(f => f.value).length;
          return (
            <div key={group.label}>
              {/* Category Header */}
              <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-border/10">
                <span className="font-bold text-[11px] text-foreground/60 tracking-wider">
                  {group.label.toUpperCase()}
                </span>
                <span className="font-mono text-[10px] text-foreground/30">
                  {groupEnabled}/{group.flags.length}
                </span>
              </div>

              {/* Flag Rows */}
              <div className="space-y-1">
                {group.flags.map((flag) => (
                  <div
                    key={flag.key}
                    className={`flex items-center gap-3 p-2.5 border transition-colors ${
                      flag.value ? "border-emerald-500/20 bg-emerald-500/5" : "border-border/10"
                    }`}
                  >
                    <button
                      onClick={() => toggleMut.mutate({ key: flag.key, value: !flag.value })}
                      disabled={toggleMut.isPending}
                      className="shrink-0"
                    >
                      {flag.value ? (
                        <ToggleRight className="w-6 h-6 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-foreground/30" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="text-foreground text-[12px] font-medium font-mono">{flag.key}</span>
                      {flag.description && (
                        <p className="text-foreground/40 text-[10px] truncate">{flag.description}</p>
                      )}
                    </div>
                    <span className={`font-mono text-[10px] font-bold tracking-wide ${
                      flag.value ? "text-emerald-400" : "text-foreground/20"
                    }`}>
                      {flag.value ? "ON" : "OFF"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
