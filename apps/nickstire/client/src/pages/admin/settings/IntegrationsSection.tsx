/**
 * INTEGRATIONS: vendor health + the labor guide (search jobs by category, get
 * labor hours, calculate costs).
 *
 * 2026-10-19 (admin prune W1): Tire search and Quick estimate were cut. 0 opens
 * in 14 days, and both duplicated live tools: the Tires section's search
 * (gatewayTire) and the Sales Pipeline walk-in quote.
 */
import { useState, useMemo } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

// tRPC-inferred types — replaces `any` annotations on map/filter callbacks.
type SyncHealth = RouterOutputs["adminDashboard"]["syncHealth"];
type HealthCheck = SyncHealth["checks"][number];
import {
  Truck, Wrench, Calculator, ExternalLink, Search, Plus, Trash2,
  ChevronRight, DollarSign, Clock, Package, Loader2, Settings2,
  CheckCircle2, AlertTriangle, Gauge, Zap, Shield, Droplets,
  ThermometerSun, Cog, CircleDot, ArrowRight, RefreshCw, XCircle,
  Activity, Wifi, WifiOff, Plug
} from "lucide-react";
import { PageHeader, ErrorState, TabBar } from "../shared";

// ─── TYPES ──────────────────────────────────────────────

// ─── CATEGORY ICONS ─────────────────────────────────────
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  brakes: <Shield className="w-4 h-4" />,
  engine: <Cog className="w-4 h-4" />,
  electrical: <Zap className="w-4 h-4" />,
  suspension: <Gauge className="w-4 h-4" />,
  cooling: <ThermometerSun className="w-4 h-4" />,
  exhaust: <Droplets className="w-4 h-4" />,
  maintenance: <Wrench className="w-4 h-4" />,
  tires: <CircleDot className="w-4 h-4" />,
};

// ─── VENDOR HEALTH STRIP ────────────────────────────────
function VendorHealthStrip() {
  const utils = trpc.useUtils();
  const { data: health, isLoading, isError, refetch } = trpc.adminDashboard.syncHealth.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  // 2026-05-23 · was missing both invalidate + onError. Click was
  // toasting "refreshed" while the cards on the page kept their old
  // state until the 60s refetch interval, and any 5xx silently passed.
  const refreshMut = trpc.adminDashboard.refreshHealth.useMutation({
    onSuccess: () => {
      utils.adminDashboard.syncHealth.invalidate();
      toast.success("Health checks refreshed");
    },
    onError: (err) => toast.error(`Refresh failed: ${err.message}`),
  });
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="bg-card border border-border/30 p-3 flex items-center gap-2 text-xs text-foreground/40">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking vendor integrations...
      </div>
    );
  }

  if (isError) {
    return <ErrorState message="Couldn't load vendor health checks" onRetry={() => refetch()} />;
  }

  if (!health) return null;

  const statusColor = health.overallStatus === "all_systems_operational" ? "text-emerald-400"
    : health.overallStatus === "degraded" ? "text-amber-400"
    : "text-red-400";

  const StatusIcon = health.overallStatus === "all_systems_operational" ? Wifi
    : health.overallStatus === "degraded" ? AlertTriangle
    : WifiOff;

  const connectedCount = health.checks.filter((c: HealthCheck) => c.status === "connected").length;

  return (
    <div className="bg-card border border-border/30">
      {/* Summary bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-foreground/5 transition-colors"
      >
        <StatusIcon className={`w-4 h-4 ${statusColor}`} />
        <span className="text-xs font-semibold tracking-wide flex-1">
          Vendor health · {connectedCount}/{health.checks.length} connected
        </span>
        <span className={`text-[10px] font-mono ${statusColor}`}>
          {health.overallStatus.replace(/_/g, " ").replace(/^./, (c: string) => c.toUpperCase())}
        </span>
        <ChevronRight className={`w-3.5 h-3.5 text-foreground/30 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/20 px-4 py-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {health.checks.map((c: HealthCheck) => (
              <div key={c.name} className="flex items-center gap-2 px-3 py-2 bg-background/50 border border-border/10 text-xs">
                {c.status === "connected" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : c.status === "degraded" ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{c.name}</div>
                  <div className="text-foreground/40 truncate text-[10px]">{c.details}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-foreground/30">
              Last checked: {health.checkedAt ? new Date(health.checkedAt).toLocaleTimeString() : "—"}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); refreshMut.mutate(); }}
              disabled={refreshMut.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold text-primary hover:bg-primary/10 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${refreshMut.isPending ? "animate-spin" : ""}`} />
              Re-check all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────
export default function IntegrationsSection() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        subtitle="Labor guide lookup. Live vendor health below."
        icon={<Plug className="w-5 h-5" />}
      />
      {/* Vendor Health Strip */}
      <VendorHealthStrip />

      <LaborGuideTab />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB 2: LABOR GUIDE
// ═══════════════════════════════════════════════════════════
function LaborGuideTab() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [calcJob, setCalcJob] = useState<{ name: string; hours: number } | null>(null);
  const [difficulty, setDifficulty] = useState<"standard" | "moderate" | "difficult">("standard");

  const { data: laborStatus } = trpc.autoLabor.status.useQuery();
  const { data: categories } = trpc.autoLabor.categories.useQuery();
  const { data: categoryJobs } = trpc.autoLabor.jobsByCategory.useQuery(
    { categoryId: selectedCategory || "" },
    { enabled: !!selectedCategory }
  );
  const { data: searchResults } = trpc.autoLabor.searchJobs.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.length >= 2 }
  );

  // 2026-05-23 · was bare. ALG network errors hid the failure;
  // operator just saw the result panel never render.
  const calculateLabor = trpc.autoLabor.calculateLabor.useMutation({
    onError: (err) => toast.error(`Labor calc failed: ${err.message}`),
  });

  const handleCalc = (name: string, hours: number) => {
    setCalcJob({ name, hours });
    calculateLabor.mutate({ jobName: name, hours, difficulty });
  };

  const displayJobs = searchQuery.length >= 2
    ? searchResults?.results.map(r => ({ ...r.job, categoryName: r.categoryName })) || []
    : categoryJobs?.jobs.map(j => ({ ...j, categoryName: categoryJobs.category || "" })) || [];

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="flex items-center justify-between bg-card border border-border/30 p-4">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${laborStatus?.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
          <div>
            <span className="font-bold text-sm tracking-wider text-foreground">Auto Labor Guide</span>
            <span className="text-foreground/40 text-xs ml-2">ShopDriver Elite</span>
          </div>
        </div>
        <a
          href="https://secure.autolaborexperts.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-primary hover:text-primary/80 font-bold text-xs tracking-wider"
        >
          Open portal <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Categories + Search */}
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); if (e.target.value.length >= 2) setSelectedCategory(null); }}
              placeholder="Search all jobs..."
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border/30 text-foreground text-[13px] focus:border-primary/50 focus:outline-none"
            />
          </div>

          {/* Categories */}
          <div className="bg-card border border-border/30">
            <div className="p-3 border-b border-border/30">
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide">Categories</span>
            </div>
            <div className="divide-y divide-border/20">
              {categories?.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => { setSelectedCategory(cat.id); setSearchQuery(""); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                    selectedCategory === cat.id
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"
                  }`}
                >
                  {CATEGORY_ICONS[cat.id] || <Wrench className="w-4 h-4" />}
                  <span className="font-bold text-xs tracking-wide flex-1 text-left">{cat.name}</span>
                  <span className="font-mono text-[10px] text-foreground/30">{cat.jobCount}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-foreground/20" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Middle: Job List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-sm tracking-wider text-foreground">
              {searchQuery.length >= 2 ? `Results for "${searchQuery}"` : selectedCategory ? categoryJobs?.category || "Jobs" : "Select a category"}
            </span>
            <span className="font-mono text-[10px] text-foreground/30">{displayJobs.length} jobs</span>
          </div>

          {displayJobs.length === 0 && (
            <div className="bg-card border border-border/30 p-8 text-center">
              <Wrench className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
              <p className="text-foreground/40 text-sm">
                {searchQuery.length >= 2 ? "No matching jobs found" : "Select a category to view jobs"}
              </p>
            </div>
          )}

          {displayJobs.map((job, i) => (
            // 2026-05-23 · was <div onClick> · keyboard-inaccessible
            // and screen readers didn't announce as activatable.
            // Converted to <button> · same visual treatment, proper
            // semantics + focus ring.
            <button
              type="button"
              key={`${job.name}-${i}`}
              className={`w-full text-left bg-card border transition-colors p-4 focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                calcJob?.name === job.name ? "border-primary/50 bg-primary/5" : "border-border/30 hover:border-foreground/20"
              }`}
              onClick={() => handleCalc(job.name, job.avgHours)}
            >
              <div className="flex justify-between items-start mb-2">
                <span className="font-bold text-xs tracking-wider text-foreground">{job.name}</span>
                <div className="flex items-center gap-1 text-primary">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-[13px] font-bold">{job.avgHours}h</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-foreground/40 text-[10px]">
                <span>Range: {job.minHours}–{job.maxHours}h</span>
                {"categoryName" in job && <span className="text-foreground/30">{(job as typeof job & { categoryName?: string }).categoryName}</span>}
              </div>
              {job.notes && (
                <p className="text-foreground/30 text-xs mt-1">{job.notes}</p>
              )}
            </button>
          ))}
        </div>

        {/* Right: Labor Calculator */}
        <div className="space-y-4">
          <div className="bg-card border border-border/30 p-5">
            <h3 className="font-bold text-sm tracking-wider text-foreground mb-4">
              <DollarSign className="w-4 h-4 inline mr-2" />
              Labor calculator
            </h3>

            {calcJob ? (
              <div className="space-y-4">
                <div className="bg-background border border-border/30 p-3">
                  <span className="font-mono text-[10px] text-foreground/40 tracking-wider block mb-1">Selected job</span>
                  <span className="font-bold text-sm text-foreground">{calcJob.name}</span>
                </div>

                {/* Difficulty */}
                <div>
                  <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-2">Difficulty</span>
                  <div className="flex gap-1">
                    {(["standard", "moderate", "difficult"] as const).map(d => (
                      <button
                        key={d}
                        onClick={() => {
                          setDifficulty(d);
                          handleCalc(calcJob.name, calcJob.hours);
                        }}
                        className={`flex-1 py-2 text-[12px] border transition-colors capitalize ${
                          difficulty === d
                            ? d === "difficult" ? "border-red-500 text-red-400 bg-red-500/10"
                              : d === "moderate" ? "border-amber-500 text-amber-400 bg-amber-500/10"
                              : "border-primary text-primary bg-primary/10"
                            : "border-border/30 text-foreground/50 hover:text-foreground"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <p className="font-mono text-[10px] text-foreground/30 mt-1">
                    {difficulty === "standard" ? "Normal conditions" : difficulty === "moderate" ? "+15% time (rust, tight access)" : "+30% time (severe rust, major access issues)"}
                  </p>
                </div>

                {/* Result */}
                {calculateLabor.data && (
                  <div className="bg-background border border-primary/30 p-4">
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-mono text-[10px] text-foreground/40 tracking-wider">Labor cost</span>
                      <span className="font-bold text-2xl text-primary">
                        ${calculateLabor.data.laborCost.toFixed(2)}
                      </span>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between text-foreground/50">
                        <span>Base hours</span>
                        <span>{calculateLabor.data.baseHours}h</span>
                      </div>
                      {calculateLabor.data.difficultyMultiplier > 1 && (
                        <div className="flex justify-between text-amber-400">
                          <span>Difficulty adj. (×{calculateLabor.data.difficultyMultiplier})</span>
                          <span>{calculateLabor.data.adjustedHours}h</span>
                        </div>
                      )}
                      <div className="flex justify-between text-foreground/50">
                        <span>Labor rate</span>
                        <span>${calculateLabor.data.laborRate}/hr</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <Clock className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
                <p className="text-foreground/40 text-sm">Click a job to calculate labor cost</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
