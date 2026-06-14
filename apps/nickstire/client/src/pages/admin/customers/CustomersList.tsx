import React, { useEffect, useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { StatCard, useUrlFilter, FilterChips, openCustomerDrawer } from "../shared";
import { CustomersBrief } from "./CustomersBrief";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import {
  Users, Search, ChevronLeft, ChevronRight, Phone, Mail,
  Calendar, UserCheck, AlertTriangle, Building2,
  ArrowUpDown, Filter, Eye, X, Download, Send, CheckCircle2,
  MessageSquare, StickyNote, RefreshCw, Loader2, Crown,
  Clock, ChevronDown, ChevronUp, DollarSign,
  Hash, Wrench, FileWarning
} from "lucide-react";
import { toast } from "sonner";
import {
  type ListedCustomer, type Segment, type SortDir, type SortByExt,
  daysSinceStr, formatMetricsAge,
} from "./format";
import { StatusBadge } from "./StatusBadge";
import { WinBackButton } from "./WinBackButton";
import { Customer360Panel } from "./Customer360Panel";

export function CustomersList({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  // C9 · debounce search before it hits the query. The input stays bound to
  // `search` (responsive typing); only `debouncedSearch` feeds the tRPC
  // list query + resets the page, so each keystroke no longer fires a heavy
  // LIKE scan over ~2k rows (mirrors Leads' useUrlFilter debounce behavior).
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // URL-persistent ?seg=recent|lapsed|unknown (default all not in URL)
  const [segment, setSegment] = useUrlFilter<Segment>(
    "seg", "all",
    { validate: (v) => (["all", "recent", "lapsed", "unknown"].includes(v) ? (v as Segment) : null) },
  );
  const [sortBy, setSortBy] = useState<SortByExt>("totalSpent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  // wave-181.x Customers Phase 1 · removed selectedId state · was only
  // used to drive the deleted CustomerDetail modal. Detail view now
  // uses openCustomerDrawer (the surviving side-drawer pattern) which
  // manages its own state via the event bus.
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const pageSize = 25;

  // C9 · 300ms debounce: when the user pauses typing, commit `search` to
  // `debouncedSearch` and reset to page 1. Cleared on each keystroke so the
  // query only runs once typing settles.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const [exporting, setExporting] = useState(false);
  const [minVisits, setMinVisits] = useState<number | undefined>();
  const [lastVisitDays, setLastVisitDays] = useState<number | undefined>();
  const [hasDeclined, setHasDeclined] = useState(false);
  const [hasBacklog, setHasBacklog] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const [commercialOnly, setCommercialOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const { data: stats } = trpc.customers.stats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: campaignStats } = trpc.customers.campaignStats.useQuery(undefined, { refetchInterval: 30000 });

  // wave-181.x SA v2 Wave 3 (Elon · single surface) · pull v2 service-
  // affinity predictions live · index by customerId · render inline on
  // the roster. The drawer-tile + statenour /brain panel from the
  // original Wave 3 design were redundant with the roster · one
  // surface · zero new pages.
  // intelligence.serviceAffinity returns v2 shape: customerId + name +
  // topServices + predictedNext + confidence (0-1) + reason + modelVersion.
  // 5-min stale time · matches MoneyBrief / refresh cadence.
  const { data: affinityData } = trpc.intelligence.serviceAffinity.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const affinityByCustomerId = useMemo(() => {
    const map = new Map<number, NonNullable<typeof affinityData>["affinities"][number]>();
    if (!affinityData?.affinities) return map;
    for (const a of affinityData.affinities) {
      map.set(a.customerId, a);
    }
    return map;
  }, [affinityData]);

  const { data: listData, isLoading } = trpc.customers.list.useQuery({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    segment,
    sortBy,
    sortDir,
    minVisits,
    lastVisitDays,
    hasDeclined: hasDeclined || undefined,
    hasBacklog: hasBacklog || undefined,
    hasEmail: hasEmail || undefined,
    customerType: commercialOnly ? "commercial" : undefined,
  }, { refetchInterval: 30000 });

  const enrichMutation = trpc.customers.enrich.useMutation({
    onSuccess: (result) => {
      toast.success(`Enriched: ${result.enrichment.details}`);
      utils.customers.list.invalidate();
      utils.customers.stats.invalidate();
    },
    onError: () => toast.error("Enrichment failed"),
  });

  // Wave-100: manual refresh of materialized declined+backlog aggregates.
  // Login auto-fires this — button is for operator's "the numbers look
  // stale, force a recompute" moments. Local DB only, no ALG hit.
  const refreshMetricsMutation = trpc.customers.refreshMetrics.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Recomputed ${result.customersUpdated} customer aggregates · ${result.durationMs}ms`);
        utils.customers.list.invalidate();
        utils.customers.metricsFreshness.invalidate();
      } else {
        toast.error("Metrics refresh failed");
      }
    },
    onError: () => toast.error("Metrics refresh failed"),
  });

  // wave-181.27 · materialized-metrics freshness probe. Refetches
  // every minute so the "computed Xm ago" badge tracks the table
  // state without forcing a manual reload. Auto-invalidated above
  // when the Recompute button succeeds.
  const { data: freshness } = trpc.customers.metricsFreshness.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const retryCampaign = trpc.customers.retryCampaign.useMutation({
    onSuccess: (result) => {
      toast.success(`Sent ${result.sent} texts (${result.failed} failed). ${result.remaining} remaining.`);
      utils.customers.campaignStats.invalidate();
    },
    onError: () => toast.error("Campaign retry failed"),
  });

  const totalPages = Math.ceil((listData?.total ?? 0) / pageSize);

  function toggleSort(col: SortByExt) {
    if (sortBy === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortBy(col); setSortDir("desc"); }
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* wave-181.x Customers Phase 2 · CustomersBrief header.
          3-line auto-narrative of roster · LTV · top action (lapsed).
          Composes from the same trpc.customers.stats query the
          StatCard grid below uses · no additional API calls. The
          "View" action on the lapsed line jumps the segment filter
          to "lapsed" via the parent's state setter · keeps state
          ownership inside CustomersList. */}
      <CustomersBrief
        onLapsedAction={() => {
          setSegment("lapsed");
          setPage(1);
        }}
      />

      {/* Stats Row — clickable filters. All 8 tiles now wire to server-side
          filter state: segment + minVisits + sortBy for 6, plus hasEmail and
          customerType="commercial" (added to customers.list) for the last two. */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard
          label="Total Customers"
          value={stats?.total ?? 0}
          icon={<Users className="w-4 h-4" />}
          color="text-foreground"
          onClick={() => {
            setSegment("all");
            setMinVisits(undefined);
            setLastVisitDays(undefined);
            setHasDeclined(false);
            setHasBacklog(false);
            setPage(1);
          }}
        />
        <StatCard
          label="With Visits"
          value={stats?.withVisits ?? 0}
          icon={<UserCheck className="w-4 h-4" />}
          color="text-emerald-400"
          onClick={() => { setSegment("all"); setMinVisits(1); setPage(1); }}
        />
        <StatCard
          label="VIP (3+)"
          value={stats?.vipCount ?? 0}
          icon={<Crown className="w-4 h-4" />}
          color="text-amber-400"
          onClick={() => { setSegment("all"); setMinVisits(3); setSortBy("visits"); setSortDir("desc"); setPage(1); }}
        />
        <StatCard
          label="Total Revenue"
          value={`$${Math.round((stats?.totalRevenue ?? 0) / 100).toLocaleString()}`}
          icon={<span className="text-[14px]">💰</span>}
          color="text-emerald-400"
          onClick={() => { setSegment("all"); setSortBy("totalSpent"); setSortDir("desc"); setPage(1); }}
        />
        <StatCard
          label="Recent"
          value={stats?.recent ?? 0}
          icon={<UserCheck className="w-4 h-4" />}
          color="text-emerald-400"
          onClick={() => { setSegment("recent"); setPage(1); }}
        />
        <StatCard
          label="Lapsed"
          value={stats?.lapsed ?? 0}
          icon={<AlertTriangle className="w-4 h-4" />}
          color="text-amber-400"
          onClick={() => { setSegment("lapsed"); setPage(1); }}
        />
        <StatCard
          label="With Email"
          value={stats?.withEmail ?? 0}
          icon={<Mail className="w-4 h-4" />}
          color="text-blue-400"
          onClick={() => { setSegment("all"); setHasEmail(true); setCommercialOnly(false); setPage(1); }}
        />
        {/* wave-181.x bug-fix · was text-purple-400 · purple was DELETED
            from canonical 3-signal palette in wave-181.92. Now uses
            text-foreground/60 (neutral). */}
        <StatCard
          label="Commercial"
          value={stats?.commercial ?? 0}
          icon={<Building2 className="w-4 h-4" />}
          color="text-foreground/60"
          onClick={() => { setSegment("all"); setCommercialOnly(true); setHasEmail(false); setPage(1); }}
        />
      </div>

      {/* Campaign Progress + Retry + Export */}
      <div className="flex flex-col sm:flex-row gap-3">
        {campaignStats && (
          <div className="flex-1 bg-card border border-border/30 p-4 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" />
              <span className="text-[12px] text-foreground/60 tracking-wider">SMS:</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[12px]">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">{campaignStats.sent}</span>
                <span className="text-foreground/30">sent</span>
              </span>
              <span className="flex items-center gap-1 text-[12px]">
                <span className="text-amber-400">{campaignStats.remaining}</span>
                <span className="text-foreground/30">left</span>
              </span>
            </div>
            {campaignStats.total > 0 && (
              <div className="flex-1 bg-foreground/5 h-2 hidden sm:block">
                <div className="bg-primary h-2 transition-all" style={{ width: `${Math.round((campaignStats.sent / campaignStats.total) * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {campaignStats && campaignStats.remaining > 0 && (
          <button
            onClick={async () => {
              // wave-139 — was native confirm(); now ConfirmDialog
              const ok = await confirmDialog({
                title: "Send next batch?",
                message: "Send texts to the next 50 queued customers.",
                confirmLabel: "Send 50",
              });
              if (!ok) return;
              retryCampaign.mutate({ batchSize: 50 });
            }}
            disabled={retryCampaign.isPending}
            className="flex items-center gap-2 bg-primary/10 border border-primary/30 px-4 py-2.5 text-sm text-primary hover:bg-primary/20 transition-colors whitespace-nowrap disabled:opacity-50 rounded-md"
          >
            {retryCampaign.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {retryCampaign.isPending ? "Sending..." : "Send Next 50"}
          </button>
        )}

        <button
          onClick={async () => {
            // v1.7 audit follow-up · was raw fetch() of the manually-
            // constructed tRPC URL + hand-unwrapped envelope. Bypassed
            // type-safety, the auth interceptor, and the error
            // transformer; a session expiring mid-export returned 401
            // inside an envelope that was silently swallowed into
            // "Export failed" with no re-auth flow. Now uses the
            // typed tRPC client via utils.fetch.
            setExporting(true);
            try {
              const data = await utils.customers.exportCsv.fetch({ segment });
              if (!data?.csv) { toast.error("Export failed"); return; }
              const blob = new Blob([data.csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `customers-${segment}-${new Date().toISOString().split("T")[0]}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success(`Exported ${data.count ?? 0} customers`);
              // wave-165 backend caps the export at 10k rows + returns
              // `truncated`. Surface it so the operator knows rows past the
              // cap were silently dropped (was ignored → silent data loss).
              if (data.truncated) {
                toast.warning("Export capped at 10,000 rows — narrow the segment or filters to export the rest");
              }
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Export failed");
            } finally {
              setExporting(false);
            }
          }}
          disabled={exporting}
          className="flex items-center gap-2 bg-card border border-border/30 px-4 py-2.5 text-sm text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors whitespace-nowrap"
        >
          <Download className="w-4 h-4" />
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
            <input
              type="text"
              placeholder="Search name, phone, email, city, vehicle..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-card border border-border/30 pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-foreground/30" />
            {(["all", "recent", "lapsed", "new", "unknown"] as Segment[]).map(s => (
              <button
                key={s}
                onClick={() => { setSegment(s); setPage(1); }}
                className={`px-3 py-1.5 text-xs tracking-wide transition-colors ${
                  segment === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border/30 text-foreground/50 hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`px-3 py-1.5 text-xs tracking-wide transition-colors ${showFilters ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/50 hover:text-foreground"}`}
          >
            Advanced
          </button>
          <button
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs tracking-wide bg-card border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 whitespace-nowrap"
          >
            {enrichMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Sync Data
          </button>
          <button
            onClick={() => refreshMetricsMutation.mutate()}
            disabled={refreshMetricsMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs tracking-wide bg-card border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50 whitespace-nowrap"
            title={
              freshness?.lastComputedAt
                ? `Last recomputed ${freshness.lastComputedAt} · ${freshness.rowCount} rows. Click to force a fresh DB scan (no ALG fetch).`
                : "Recompute declined-work + backlog totals from local DB. No ALG fetch. Auto-runs on login."
            }
          >
            {refreshMetricsMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Recompute
          </button>
          {/* wave-181.27 · freshness badge — shows when the materialized
              customer_metrics aggregates were last computed. If the
              numbers look wrong, the operator first checks this badge
              to know whether to recompute or look deeper. */}
          {freshness?.lastComputedAt && (
            <span
              className="hidden md:inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] font-medium text-foreground/45 bg-card/50 border border-border/25 whitespace-nowrap"
              title={`Materialized aggregates last computed at ${freshness.lastComputedAt} (${freshness.rowCount} rows)`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
              {formatMetricsAge(freshness.lastComputedAt)}
            </span>
          )}
        </div>

        {/* Advanced Filters */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 bg-card border border-border/30 p-3">
            <div>
              <label className="text-[10px] text-foreground/40 tracking-wider block mb-1">LAST VISIT WITHIN</label>
              <select
                value={lastVisitDays ?? ""}
                onChange={e => { setLastVisitDays(e.target.value ? Number(e.target.value) : undefined); setPage(1); }}
                className="bg-background border border-border/30 px-3 py-1.5 text-xs text-foreground"
              >
                <option value="">Any time</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="180">6 months</option>
                <option value="365">1 year</option>
                <option value="730">2 years</option>
                <option value="1095">3 years</option>
                <option value="1825">5 years</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-foreground/40 tracking-wider block mb-1">MIN VISITS</label>
              <select
                value={minVisits ?? ""}
                onChange={e => { setMinVisits(e.target.value ? Number(e.target.value) : undefined); setPage(1); }}
                className="bg-background border border-border/30 px-3 py-1.5 text-xs text-foreground"
              >
                <option value="">Any</option>
                <option value="1">1+</option>
                <option value="2">2+</option>
                <option value="3">3+ (VIP)</option>
                <option value="5">5+</option>
                <option value="10">10+</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-foreground/40 tracking-wider block mb-1">SORT BY</label>
              <select
                value={sortBy}
                onChange={e => { setSortBy(e.target.value as SortByExt); setPage(1); }}
                className="bg-background border border-border/30 px-3 py-1.5 text-xs text-foreground"
              >
                <option value="totalSpent">Total Spent</option>
                <option value="visits">Visit Count</option>
                <option value="lastVisit">Last Visit</option>
                <option value="firstVisit">First Visit</option>
                <option value="declined">Declined Value</option>
                <option value="backlog">Backlog Value</option>
                <option value="name">Name</option>
                <option value="created">Date Added</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-foreground/40 tracking-wider block mb-1">RECOVERY / BACKLOG</label>
              <div className="flex gap-2">
                <button
                  onClick={() => { setHasDeclined(!hasDeclined); setPage(1); }}
                  className={`px-3 py-1.5 text-[10px] tracking-wider transition-colors flex items-center gap-1 ${hasDeclined ? "bg-amber-500/10 text-amber-400 border border-amber-500/30" : "bg-background border border-border/30 text-foreground/50 hover:text-foreground"}`}
                  title="Show only customers with outstanding ALG estimates"
                >
                  <FileWarning className="w-3 h-3" /> HAS DECLINED
                </button>
                <button
                  onClick={() => { setHasBacklog(!hasBacklog); setPage(1); }}
                  className={`px-3 py-1.5 text-[10px] tracking-wider transition-colors flex items-center gap-1 ${hasBacklog ? "bg-blue-500/10 text-blue-400 border border-blue-500/30" : "bg-background border border-border/30 text-foreground/50 hover:text-foreground"}`}
                  title="Show only customers with open work orders"
                >
                  <Wrench className="w-3 h-3" /> HAS BACKLOG
                </button>
              </div>
            </div>
            {(minVisits || lastVisitDays || hasDeclined || hasBacklog) && (
              <button
                onClick={() => { setMinVisits(undefined); setLastVisitDays(undefined); setHasDeclined(false); setHasBacklog(false); setPage(1); }}
                className="self-end px-3 py-1.5 text-xs text-red-400 hover:text-red-300 tracking-wider"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {/* Active Filter Chips — auto-hides when nothing's active */}
        <FilterChips
          chips={[
            { label: "Search", value: search, default: "", onClear: () => { setSearch(""); setDebouncedSearch(""); setPage(1); } },
            { label: "Segment", value: segment, default: "all", onClear: () => { setSegment("all"); setPage(1); } },
            { label: "Min Visits", value: minVisits ? String(minVisits) : "", default: "", onClear: () => { setMinVisits(undefined); setPage(1); }, displayValue: minVisits ? `${minVisits}+` : undefined },
            { label: "Last Visit", value: lastVisitDays ? String(lastVisitDays) : "", default: "", onClear: () => { setLastVisitDays(undefined); setPage(1); }, displayValue: lastVisitDays ? `≤${lastVisitDays}d` : undefined },
            { label: "Has Declined", value: hasDeclined ? "1" : "", default: "", onClear: () => { setHasDeclined(false); setPage(1); }, displayValue: hasDeclined ? "ALG est outstanding" : undefined },
            { label: "Has Backlog", value: hasBacklog ? "1" : "", default: "", onClear: () => { setHasBacklog(false); setPage(1); }, displayValue: hasBacklog ? "Open WOs" : undefined },
            { label: "Has Email", value: hasEmail ? "1" : "", default: "", onClear: () => { setHasEmail(false); setPage(1); }, displayValue: hasEmail ? "Email on file" : undefined },
            { label: "Type", value: commercialOnly ? "1" : "", default: "", onClear: () => { setCommercialOnly(false); setPage(1); }, displayValue: commercialOnly ? "Commercial" : undefined },
            { label: "Sort", value: sortBy, default: "totalSpent", onClear: () => { setSortBy("totalSpent"); setPage(1); }, displayValue: sortBy === "totalSpent" ? undefined : sortBy },
          ]}
          onClearAll={() => {
            setSearch("");
            setDebouncedSearch("");
            setSegment("all");
            setMinVisits(undefined);
            setLastVisitDays(undefined);
            setHasDeclined(false);
            setHasBacklog(false);
            setHasEmail(false);
            setCommercialOnly(false);
            setSortBy("totalSpent");
            setSortDir("desc");
            setPage(1);
          }}
        />
      </div>

      {/* Table */}
      <div className="bg-card border border-border/30 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/20">
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">
                <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-foreground/60">
                  Name <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">Phone</th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden lg:table-cell">Status</th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">
                <button onClick={() => toggleSort("totalSpent")} className="flex items-center gap-1 hover:text-foreground/60">
                  Spent <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">
                <button onClick={() => toggleSort("visits")} className="flex items-center gap-1 hover:text-foreground/60">
                  Visits <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden md:table-cell" title="Outstanding ALG estimates — recovery opportunities">
                <button onClick={() => toggleSort("declined")} className="flex items-center gap-1 hover:text-foreground/60">
                  <FileWarning className="w-3 h-3" /> Declined <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden lg:table-cell" title="Open work orders — current backlog">
                <button onClick={() => toggleSort("backlog")} className="flex items-center gap-1 hover:text-foreground/60">
                  <Wrench className="w-3 h-3" /> Backlog <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden md:table-cell">Vehicle</th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden sm:table-cell">
                <button onClick={() => toggleSort("lastVisit")} className="flex items-center gap-1 hover:text-foreground/60">
                  Last Service <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              {/* wave-181.x · Service Affinity v2 · single read-only column.
                  v2 model writes per-customer prediction (predictedNext +
                  confidence + reason). Treatment-arm gets auto-SMS via the
                  cross-sell cron (Wave 4). This column = operator awareness
                  on desktop. Non-sortable on purpose · the cron picks the
                  highest-confidence ones · operator doesn't need to chase. */}
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden xl:table-cell" title="Predicted next service · auto-SMS fires via cross-sell cron for treatment-arm at ≥50% confidence">
                Next Service
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-foreground/30">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                </td>
              </tr>
            ) : listData?.customers.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-foreground/30 text-[12px]">
                  No customers found
                </td>
              </tr>
            ) : (
              listData?.customers.map((c: ListedCustomer) => {
                const daysAgo = c.daysSinceLastVisit ?? (c.lastVisitDate ? Math.floor((Date.now() - new Date(c.lastVisitDate).getTime()) / 86400000) : null);
                const isExpanded = expandedId === c.id;
                return (
                  <React.Fragment key={c.id}>
                  <tr
                    className={`border-b border-border/10 hover:bg-foreground/[0.02] transition-colors cursor-pointer ${isExpanded ? "bg-foreground/[0.03]" : ""}`}
                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  >
                    {/* Name + badges */}
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isExpanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-primary shrink-0" />
                          : <ChevronDown className="w-3.5 h-3.5 text-foreground/30 shrink-0" />
                        }
                        <span
                          className="text-foreground font-medium hover:text-primary transition-colors cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenCustomer(c.id);
                          }}
                        >
                          {c.firstName} {c.lastName || ""}
                        </span>
                        {c.customerType === "commercial" && <Building2 className="w-3 h-3 text-foreground/50" />}
                        {c.notes && <span title="Has notes"><StickyNote className="w-3 h-3 text-amber-400/60" /></span>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 ml-5">
                        <StatusBadge isVip={c.isVip} churnRisk={c.churnRisk} daysSinceLastVisit={daysAgo} totalVisits={c.totalVisits} />
                      </div>
                    </td>

                    {/* Phone with Call button */}
                    <td className="p-3">
                      <a
                        href={`tel:${c.phone}`}
                        className="inline-flex items-center gap-1.5 text-foreground/60 hover:text-primary transition-colors text-[12px] group"
                        title="Tap to call"
                        onClick={e => e.stopPropagation()}
                      >
                        <Phone className="w-3 h-3 text-primary group-hover:text-primary" />
                        {c.phone}
                      </a>
                    </td>

                    {/* Status */}
                    <td className="p-3 hidden lg:table-cell">
                      {c.churnRisk === "high" ? (
                        <span className="text-red-400 text-[10px] tracking-wider">HIGH RISK</span>
                      ) : c.churnRisk === "medium" ? (
                        <span className="text-amber-400 text-[10px] tracking-wider">MEDIUM</span>
                      ) : (
                        <span className="text-emerald-400 text-[10px] tracking-wider">HEALTHY</span>
                      )}
                    </td>

                    {/* Total Spent */}
                    <td className="p-3">
                      <span className={`font-mono text-[12px] ${c.totalSpent > 0 ? "text-emerald-400" : "text-foreground/30"}`}>
                        {c.totalSpent > 0 ? `$${Math.round(c.totalSpent / 100).toLocaleString()}` : "\u2014"}
                      </span>
                    </td>

                    {/* Visits */}
                    <td className="p-3">
                      <span className={c.totalVisits > 0 ? "text-foreground" : "text-foreground/30"}>
                        {c.totalVisits || "\u2014"}
                      </span>
                    </td>

                    {/* Declined work (ALG outstanding estimates) */}
                    <td className="p-3 hidden md:table-cell" title={c.declinedCount ? `${c.declinedCount} ALG estimate${c.declinedCount === 1 ? "" : "s"} never converted` : "No declined work"}>
                      {c.declinedValue > 0 ? (
                        <div className="flex flex-col">
                          <span className="font-mono text-[12px] text-amber-400">
                            ${Math.round(c.declinedValue / 100).toLocaleString()}
                          </span>
                          <span className="text-[9px] text-foreground/40 tracking-wider">
                            {c.declinedCount} EST
                          </span>
                        </div>
                      ) : (
                        <span className="text-foreground/20 text-[11px]">{"\u2014"}</span>
                      )}
                    </td>

                    {/* Active backlog (open work orders) */}
                    <td className="p-3 hidden lg:table-cell" title={c.backlogCount ? `${c.backlogCount} open work order${c.backlogCount === 1 ? "" : "s"}` : "No active backlog"}>
                      {c.backlogValueCents > 0 ? (
                        <div className="flex flex-col">
                          <span className="font-mono text-[12px] text-blue-400">
                            ${Math.round(c.backlogValueCents / 100).toLocaleString()}
                          </span>
                          <span className="text-[9px] text-foreground/40 tracking-wider">
                            {c.backlogCount} OPEN
                          </span>
                        </div>
                      ) : (
                        <span className="text-foreground/20 text-[11px]">{"\u2014"}</span>
                      )}
                    </td>

                    {/* Vehicle */}
                    <td className="p-3 hidden md:table-cell">
                      {c.vehicleMake ? (
                        <span className="text-[11px] text-foreground/50">
                          {[c.vehicleYear, c.vehicleMake, c.vehicleModel].filter(Boolean).join(" ")}
                        </span>
                      ) : (
                        <span className="text-foreground/20 text-[11px]">{"\u2014"}</span>
                      )}
                    </td>

                    {/* Last Service */}
                    <td className="p-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-foreground/30" />
                        <span className={`text-xs ${daysAgo && daysAgo > 180 ? "text-red-400" : daysAgo && daysAgo > 90 ? "text-amber-400" : "text-foreground/50"}`}>
                          {daysSinceStr(daysAgo)}
                        </span>
                      </div>
                    </td>

                    {/* Next Service · Service Affinity v2 prediction (read-only) */}
                    <td className="p-3 hidden xl:table-cell">
                      {(() => {
                        const a = affinityByCustomerId.get(c.id);
                        if (!a) return <span className="text-foreground/20 text-[11px]">{"—"}</span>;
                        const conf = Math.round(a.confidence * 100);
                        const confColor = conf >= 70
                          ? "text-emerald-400"
                          : conf >= 50
                          ? "text-amber-400"
                          : "text-foreground/40";
                        return (
                          <div className="flex flex-col" title={a.reason || `${a.predictedNext} · ${conf}% confidence`}>
                            <span className="text-[11px] text-foreground/70 capitalize">
                              {a.predictedNext}
                            </span>
                            <span className={`text-[9px] tracking-wider font-mono ${confColor}`}>
                              {conf}%
                            </span>
                          </div>
                        );
                      })()}
                    </td>

                    {/* wave-181.x Customers Phase 1 · Actions simplified.
                        WAS: InlineSms (74-line duplicate) + Eye → CustomerDetail
                             modal (250-line stale duplicate of CustomerDrawer).
                        NOW: MessageCustomerLink (canonical SMS entry) + Eye →
                             openCustomerDrawer (the surviving detail pattern). */}
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 relative" onClick={e => e.stopPropagation()}>
                        {c.phone && (
                          <MessageCustomerLink
                            phone={c.phone}
                            className="text-foreground/30 hover:text-blue-400 transition-colors p-1"
                            ariaLabel={`Text ${c.firstName || c.phone}`}
                            title="Open in-admin SMS chat"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </MessageCustomerLink>
                        )}
                        {c.phone && (c.churnRisk === "high" || (daysAgo ?? 0) > 90) && (
                          <WinBackButton customerId={c.id} firstName={c.firstName} phone={c.phone} />
                        )}
                        <button
                          onClick={() => onOpenCustomer(c.id)}
                          className="text-foreground/30 hover:text-primary transition-colors"
                          title="View full details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <Customer360Panel customer={c} />
                  )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wider">
            {listData?.total ?? 0} CUSTOMERS — PAGE {page} OF {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 bg-card border border-border/30 text-foreground/50 hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 bg-card border border-border/30 text-foreground/50 hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
