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
  Users, FileText, TrendingUp, Search,
  DollarSign, Wrench,
  Activity, Shield, Plug, Settings,
} from "lucide-react";
// wave-181.x Phase 1 cleanup · removed imports: Upload, AlertTriangle,
// Clock — used only by deleted EstimateEndpointDiagnosticPanel +
// Import History panel.
import { PageHeader, SectionInsightStrip, TabBar, Panel, StatCard, ErrorState } from "./shared";
import DegradedDataBanner from "@/components/admin/DegradedDataBanner";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
// wave-181.x decomposition · the 5 inlined sibling panels + the cron
// catalog were extracted into ./settings/* (pure verbatim move). This
// file is now a lean tab host.
import { LlmSpendPanel } from "./intelligence/LlmSpendPanel";
import DeclinedRecoveryPanel from "./settings/DeclinedRecoveryPanel";
import FeatureFlagsPanel from "./settings/FeatureFlagsPanel";

// Lazy-loaded system tabs — Nour's request: "move all system stuff to the settings page"
// Consolidates System Health, Compliance, and Integrations into this hub so
// the sidebar stays focused on business work, not admin plumbing.
const SettingsStatusTab = lazy(() => import("./settings/SettingsStatusTab"));
const SiteHealthSection = lazy(() => import("./settings/SiteHealthSection"));
const ComplianceSection = lazy(() => import("./settings/ComplianceSection"));
const IntegrationsSection = lazy(() => import("./settings/IntegrationsSection"));

// wave-181.x Phase 2 · "status" tab added as the new DEFAULT landing.
// The shopdriver tab still exists for sync controls + cron list ·
// will collapse into "Integrations" + "Automations" in Phase 3/4.
type SettingsTab = "status" | "shopdriver" | "health" | "compliance" | "integrations";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode; subtitle: string }> = [
  { id: "status", label: "Status", icon: <Activity className="w-3.5 h-3.5" />, subtitle: "What needs attention today" },
  { id: "shopdriver", label: "ShopDriver HQ", icon: <Wrench className="w-3.5 h-3.5" />, subtitle: "ALG sync + probe + backfill" },
  { id: "health", label: "System Health", icon: <Activity className="w-3.5 h-3.5" />, subtitle: "Uptime, DB, vendor status" },
  { id: "compliance", label: "Compliance", icon: <Shield className="w-3.5 h-3.5" />, subtitle: "Audit log + TCPA + admin logins" },
  { id: "integrations", label: "Integrations", icon: <Plug className="w-3.5 h-3.5" />, subtitle: "Twilio, Google, Snap, Gateway" },
];

// wave-110 — local StatCard removed; canonical imported from ./shared.
// `sub` prop (caption under value) maps cleanly onto canonical `trendLabel`
// with no `trend` (renders muted, no arrow). Identical visual.

export default function SettingsSection() {
  // Initial tab from ?settingsTab=X OR ?tab=X (legacy-route support).
  // Default: ShopDriver HQ. If Nour deep-links ?tab=health, Admin.tsx routes
  // him to this Settings page — and this resolver picks up `health` as the
  // inner tab so he lands exactly where he expected.
  const initialTab = (() => {
    if (typeof window === "undefined") return "status" as SettingsTab;
    const qp = new URLSearchParams(window.location.search);
    const raw = (qp.get("settingsTab") || qp.get("tab") || "").toLowerCase();
    const valid: SettingsTab[] = ["status", "shopdriver", "health", "compliance", "integrations"];
    if (valid.includes(raw as SettingsTab)) return raw as SettingsTab;
    // wave-181.x · Phase 2 · default is now "status" instead of "shopdriver".
    // Legacy alias: ?tab=settings → Status tab (the new home).
    if (raw === "settings") return "status";
    return "status";
  })();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const handleTabChange = (tab: SettingsTab, anchor?: string) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("settingsTab", tab);
      url.hash = anchor ?? "";
      window.history.replaceState({}, "", url.toString());
      // The target tab renders on the next commit; scroll once it is in the DOM.
      if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }), 0);
    }
  };

  // Same query (and cache entry) as the Status tab; here it only counts the jobs for the pointer line.
  const { data: cronSummary } = trpc.nickActions.cronHealthSummary.useQuery(undefined, { staleTime: 30_000 });

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
  // wave-181.x Phase 1 cleanup · removed ImportLogRow type + probeResults
  // state · both were consumed only by the deleted Import History +
  // Probe Results display panels. handleProbe still fires the probe but
  // result lands as a toast/server log instead of in-page panel.
  const [syncResult, setSyncResult] = useState<{ type: string; data: SyncPayload } | null>(null);

  // ALG connection status
  const { data: algStatus, isLoading: algLoading, refetch: refetchAlg } = trpc.autoLabor.status.useQuery(undefined, { staleTime: 30_000 });

  // Invoice + customer counts
  const { data: invoiceStats, isError: statsError, fetchStatus: statsFetchStatus } = trpc.adminDashboard.stats.useQuery(undefined, { staleTime: 60_000 });
  // A paused query (offline PWA) has no data, no error and is not loading: it never ran, so it is unknown.
  const statsNote = statsError ? "Unable to determine" : statsFetchStatus === "paused" ? "Offline, not checked" : "Loading";

  // Sync mutations · 2026-05-23 · added onSuccess invalidation so the
  // invoice/customer count cards on this same page refresh immediately
  // instead of staying stale until full nav. Errors are already handled
  // by the try/catch in handleSync.
  const utilsForSync = trpc.useUtils();
  const syncInvoicesMut = trpc.shopdriver.syncInvoices.useMutation({
    onSuccess: () => utilsForSync.adminDashboard.stats.invalidate(),
  });
  const syncCustomersMut = trpc.shopdriver.syncCustomers.useMutation({
    onSuccess: () => utilsForSync.adminDashboard.stats.invalidate(),
  });

  // ALG probe
  const { refetch: runProbe, isFetching: probing } = trpc.autoLabor.probeEndpoints.useQuery(undefined, {
    enabled: false,
    staleTime: 0,
  });

  // wave-181.x Phase 1 cleanup · removed importHistory query (was only
  // consumed by the deleted Import History panel).

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
    // A direct ALG probe authenticates against ALG and can briefly kick the
    // shop counter out of ShopDriver — the whole probe-budget system exists to
    // prevent exactly that. Gate behind an explicit (iOS-PWA-safe) confirm so
    // it can't be tapped reflexively mid-shift. For routine refreshes use the
    // budget-gated "Refresh from ALG" panel below.
    const ok = await confirmDialog({
      title: "Probe ALG endpoints directly?",
      message: "This logs in to ALG directly and can briefly log the shop counter out of ShopDriver. Only run it to diagnose a sync problem, for routine data, use the budget-gated Refresh from ALG panel instead.",
      confirmLabel: "Probe anyway",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    // wave-181.x · result lands in server log + toast (via tRPC error handler)
    // The in-page Probe Results panel was deleted in Phase 1.
    // wave-181.x bug-fix · was async/await with no try/catch · auth
    // expiry or network blip silently dropped feedback · now wrapped
    // matching handleSync's pattern.
    try {
      const { data } = await runProbe();
      if (data) {
        const okCount = Object.values(data as Record<string, { status: number }>).filter(
          (r) => r.status >= 200 && r.status < 400,
        ).length;
        const totalCount = Object.keys(data as Record<string, unknown>).length;
        toast.success(`ALG probe complete · ${okCount}/${totalCount} endpoints OK`);
      } else {
        toast.warning("ALG probe returned no data");
      }
    } catch (err) {
      toast.error(`ALG probe failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const connected = algStatus?.connected ?? false;
  const usingFallback = algStatus?.usingFallback ?? true;

  // wave-181.x bug-fix · loading guard previously blocked the ENTIRE
  // page including the new Status tab (which only uses ALG status as
  // signal, not as a hard dependency). Result: opening Settings on a
  // slow ALG response showed a blank page for 3-5 seconds.
  // Now: Status tab renders immediately · only shopdriver / health /
  // integrations branches wait for ALG below in their own renders.

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings & System"
        subtitle="ShopDriver/ALG sync · system health · compliance audit · vendor integrations · feature flags"
        icon={<Settings className="w-5 h-5" />}
      />
      <DegradedDataBanner stats={invoiceStats} />
      <SectionInsightStrip section="settings" />

      {/* Tab bar — survives page reloads via ?settingsTab URL param */}
      <TabBar
        tabs={SETTINGS_TABS}
        activeTab={activeTab}
        onChange={handleTabChange}
      />

      {/* wave-181.x Phase 2 · Status tab · new default · scannable
          "what needs attention today" surface · severity-tagged open
          issues + connection health + KPI strip. */}
      {activeTab === "status" && (
        <Suspense fallback={<div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
          <SettingsStatusTab onOpenPauseSwitches={() => handleTabChange("shopdriver", "pause-switches")} />
        </Suspense>
      )}

      {/* Lazy-loaded tabs — these are the former sidebar sections */}
      {activeTab === "health" && (
        <Suspense fallback={<div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
          <SiteHealthSection />
        </Suspense>
      )}
      {/* LLM spend moved here 2026-10-19 when Intelligence HQ was cut. */}
      {activeTab === "health" && (
        <div className="mt-4"><LlmSpendPanel /></div>
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
        <h3 className="font-bold text-xl text-foreground">ShopDriver command center</h3>
        <p className="text-foreground/50 text-[12px] mt-1">
          ALG is the source of truth. Closed jobs = completed work. No website booking = walk-in. Estimates = declined work.
        </p>
      </div>

      {/* Connection Status Banner. No status read means unknown, never "offline" or zero counts. */}
      {!algStatus ? (
        algLoading ? (
          <div className="p-4 border border-border/30 text-foreground/50 text-[12px]">Checking the ALG connection...</div>
        ) : (
          <div className="border border-amber-500/20 bg-amber-500/5">
            <ErrorState
              message="ALG status couldn't load. The connection and lookup counts are unknown, not zero."
              onRetry={() => void refetchAlg()}
            />
          </div>
        )
      ) : (
      <div className={`flex items-center gap-3 p-4 border ${
        connected ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"
      }`}>
        {connected ? <Wifi className="w-5 h-5 text-emerald-400" /> : <WifiOff className="w-5 h-5 text-red-400" />}
        <div className="flex-1">
          <span className={`font-bold text-sm ${connected ? "text-emerald-400" : "text-red-400"}`}>
            {connected ? "ALG connected" : "ALG offline: using the built-in labor guide"}
          </span>
          <p className="text-foreground/50 text-[11px] mt-0.5">
            {connected
              ? `Authenticated as ${algStatus.accountId || "?"} • Last check: ${algStatus.lastAuthCheck || "just now"}`
              : algStatus.error || "No credentials configured"
            }
          </p>
        </div>
        <div className="text-right">
          <span className="font-mono text-[10px] text-foreground/30">
            {algStatus.fallbackCategories || 0} categories • {algStatus.fallbackJobs || 0} jobs
          </span>
          <br />
          <span className="font-mono text-[10px] text-foreground/30">
            {algStatus.totalLookups || 0} lookups total
          </span>
        </div>
      </div>
      )}

      {/* Stats Row. A failed or missing read shows "?" and says so, never 0. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatCard
          label="Customers"
          value={invoiceStats?.shopFloor?.totalCustomers ?? "?"}
          icon={<Users className="w-4 h-4" />}
          trendLabel={invoiceStats ? `${invoiceStats.shopFloor?.vipCustomers ?? 0} VIP (3+ visits)` : statsNote}
        />
        <StatCard
          label="Website leads"
          value={invoiceStats?.leads?.total ?? "?"}
          icon={<TrendingUp className="w-4 h-4" />}
          color={Number(invoiceStats?.leads?.urgent || 0) > 0 ? "text-red-400" : "text-foreground"}
          trendLabel={invoiceStats ? `${invoiceStats.leads?.urgent ?? 0} urgent • rest = walk-ins` : statsNote}
        />
      </div>

      {/* wave-181.x · removed "HOW DATA FLOWS" tutorial block.
          The 4-line explainer ("Invoice in ALG → closed job...") was
          read-once tutorial content occupying prime real estate. Operator
          knows the data model after first visit. Moved to /admin/help
          (TODO · not built yet) where help content belongs. */}

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
            <span className="font-bold text-sm text-foreground">Sync Jobs</span>
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
              {syncResult.type.charAt(0).toUpperCase() + syncResult.type.slice(1)} sync {syncResult.data?.success !== false ? "complete" : "failed"}
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

      {/* wave-181.x · removed in-page Probe Results display (Phase 1).
          Operators opened it once and never re-opened · the button at
          the top still triggers a probe · result lands in a toast +
          server log. Keeps the visible page state stable. */}

      {/* wave-181.x · removed Import History panel (Phase 1).
          CSV imports were a one-time bulk-load tool · no imports
          have happened in months · the panel was just empty space. */}

      {/* wave-181.x · removed EstimateEndpointDiagnosticPanel (Phase 1).
          Vendor-blocked since 2026-05-05 (19+ days) · ShopDriver
          exposes /api/Customer/* and /api/Ticket/* but NOT
          /api/Estimate/* on this tenant. Probing was useless.
          When ShopDriver unblocks the API, we'll know via the
          existing daily probe in cron · admin can rebuild the
          surface then. Carrying dead code costs more than rebuild. */}

      {/* 2026-05-05 — DECLINED RECOVERY STATUS */}
      <DeclinedRecoveryPanel />

      {/* 2026-10-26 · the static "Autonomous Operations" catalog (20 hand-written crons, stale text) is gone;
          the live per-job list is the Status tab's Scheduled work panel. */}
      <div className="flex items-center justify-between gap-3 flex-wrap border border-border/30 bg-card p-3">
        <p className="text-[13px] text-foreground/70">
          {cronSummary ? `Scheduled work (${cronSummary.jobs.length} jobs in the last 24 h) is on the Status tab.` : "Scheduled work is on the Status tab."}
        </p>
        <button
          type="button"
          onClick={() => handleTabChange("status")}
          className="min-h-[44px] px-4 text-[13px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 border border-primary/30 transition-colors"
        >
          Open Status
        </button>
      </div>

      {/* Feature Flags */}
      <FeatureFlagsPanel />
      </div>
      )}
    </div>
  );
}
