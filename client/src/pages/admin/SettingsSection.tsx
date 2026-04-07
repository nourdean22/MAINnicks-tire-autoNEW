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
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, CheckCircle2, XCircle, Wifi, WifiOff,
  Users, FileText, TrendingUp, Search, Upload, Zap,
  AlertTriangle, Clock, DollarSign, Wrench, ArrowRight,
  ToggleLeft, ToggleRight,
} from "lucide-react";

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
  const [syncing, setSyncing] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<any>(null);
  const [syncResult, setSyncResult] = useState<{ type: string; data: any } | null>(null);

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
    } catch (err: any) {
      setSyncResult({ type, data: { success: false, error: err.message } });
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
      {/* Header */}
      <div>
        <h2 className="font-bold text-2xl text-foreground tracking-wider">SHOPDRIVER COMMAND CENTER</h2>
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
          sub={`$${Math.round((invoiceStats?.shopFloor?.revenueThisWeek ?? 0) / 100).toLocaleString()} revenue`}
        />
        <StatCard
          label="CUSTOMERS"
          value={invoiceStats?.shopFloor?.totalCustomers ?? "—"}
          icon={<Users className="w-4 h-4" />}
          sub={`${invoiceStats?.shopFloor?.vipCustomers ?? 0} VIP (3+ visits)`}
        />
        <StatCard
          label="AVG TICKET"
          value={`$${Math.round((invoiceStats?.shopFloor?.avgTicket ?? 0) / 100)}`}
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
            {importHistory.slice(0, 5).map((h: any) => (
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

      {/* Cron Status */}
      <div className="bg-card border border-border/30 p-4">
        <h3 className="font-bold text-sm text-foreground tracking-wide mb-3">AUTONOMOUS OPERATIONS</h3>
        <p className="text-foreground/50 text-[11px] mb-3">These run automatically. No manual action needed.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { name: "ALG Mirror", interval: "Every 15min", desc: "Invoices + customers from ShopDriver" },
            { name: "Intelligence Autopilot", interval: "Every 2h", desc: "Lead scoring, revenue pacing, cross-sell" },
            { name: "No-Show Detection", interval: "Daily", desc: "Flags past-date bookings, sends SMS" },
            { name: "Declined Work Recovery", interval: "Daily", desc: "Identifies recoverable revenue from estimates" },
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
      </div>

      {/* Feature Flags */}
      <FeatureFlagsPanel />
    </div>
  );
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

  const enabledCount = flags?.filter(f => f.value).length ?? 0;

  return (
    <div className="bg-card border border-border/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-sm text-foreground tracking-wide">FEATURE FLAGS</h3>
          <p className="text-foreground/50 text-[11px] mt-0.5">
            {enabledCount} of {flags?.length ?? 0} enabled. Customer-contacting automations check these before executing.
          </p>
        </div>
      </div>
      <div className="space-y-1">
        {flags?.map((flag) => (
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
}
