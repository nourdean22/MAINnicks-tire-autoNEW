/**
 * INTEGRATIONS HUB — Gateway Tire + Auto Labor Guide + Quick Estimate Builder
 * 
 * Three tabs:
 * 1. TIRE SEARCH — Search tires, see wholesale cost, calculate markup, get customer pricing
 * 2. LABOR GUIDE — Search jobs by category, get labor hours, calculate costs
 * 3. QUICK ESTIMATE — Combine tires + labor + parts into a complete estimate
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Truck, Wrench, Calculator, ExternalLink, Search, Plus, Trash2,
  ChevronRight, DollarSign, Clock, Package, Loader2, Settings2,
  CheckCircle2, AlertTriangle, Gauge, Zap, Shield, Droplets,
  ThermometerSun, Cog, CircleDot, ArrowRight, RefreshCw, XCircle,
  Activity, Wifi, WifiOff
} from "lucide-react";

// ─── TYPES ──────────────────────────────────────────────
type Tab = "tires" | "labor" | "estimate";

interface EstimateLine {
  id: string;
  type: "labor" | "tire" | "part";
  name: string;
  hours?: number;
  quantity: number;
  unitCost: number;
  total: number;
}

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
  const { data: health, isLoading } = trpc.adminDashboard.syncHealth.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const refreshMut = trpc.adminDashboard.refreshHealth.useMutation({
    onSuccess: () => toast.success("Health checks refreshed"),
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

  if (!health) return null;

  const statusColor = health.overallStatus === "all_systems_operational" ? "text-emerald-400"
    : health.overallStatus === "degraded" ? "text-amber-400"
    : "text-red-400";

  const StatusIcon = health.overallStatus === "all_systems_operational" ? Wifi
    : health.overallStatus === "degraded" ? AlertTriangle
    : WifiOff;

  const connectedCount = health.checks.filter((c: any) => c.status === "connected").length;

  return (
    <div className="bg-card border border-border/30">
      {/* Summary bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-foreground/5 transition-colors"
      >
        <StatusIcon className={`w-4 h-4 ${statusColor}`} />
        <span className="text-xs font-semibold tracking-wide flex-1">
          VENDOR HEALTH — {connectedCount}/{health.checks.length} CONNECTED
        </span>
        <span className={`text-[10px] font-mono ${statusColor}`}>
          {health.overallStatus.replace(/_/g, " ").toUpperCase()}
        </span>
        <ChevronRight className={`w-3.5 h-3.5 text-foreground/30 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/20 px-4 py-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {health.checks.map((c: any) => (
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
              RE-CHECK ALL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────
export default function IntegrationsSection() {
  const [tab, setTab] = useState<Tab>("tires");
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "tires", label: "TIRE SEARCH", icon: <Truck className="w-4 h-4" /> },
    { id: "labor", label: "LABOR GUIDE", icon: <Wrench className="w-4 h-4" /> },
    { id: "estimate", label: "QUICK ESTIMATE", icon: <Calculator className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Vendor Health Strip */}
      <VendorHealthStrip />

      {/* Tab Bar */}
      <div className="flex gap-1 bg-card border border-border/30 p-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 font-bold text-xs tracking-wide transition-colors ${
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === "tires" && <TireSearchTab />}
      {tab === "labor" && <LaborGuideTab />}
      {tab === "estimate" && <QuickEstimateTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB 1: TIRE SEARCH
// ═══════════════════════════════════════════════════════════
function TireSearchTab() {
  const [sizeQuery, setSizeQuery] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [quantity, setQuantity] = useState(4);
  const [customMarkup, setCustomMarkup] = useState<string>("");
  const [includeMount, setIncludeMount] = useState(true);
  const [includeBalance, setIncludeBalance] = useState(true);
  const [includeDisposal, setIncludeDisposal] = useState(true);
  const [includeTPMS, setIncludeTPMS] = useState(false);
  const [fet, setFet] = useState("");
  const { data: gatewayStatus } = trpc.gatewayTire.status.useQuery();
  const { data: popularData } = trpc.gatewayTire.popularSizes.useQuery();
  const { data: searchResults, isLoading: searching } = trpc.gatewayTire.searchBySize.useQuery(
    { sizeQuery, sortBy: "default" },
    { enabled: sizeQuery.length >= 5 }
  );

  const calcMargin = trpc.gatewayTire.calculateMargin.useMutation();
  const updateMarkup = trpc.gatewayTire.updateMarkup.useMutation({
    onSuccess: () => toast.success("Markup updated"),
  });

  const handleCalculate = () => {
    const cost = parseFloat(costPrice);
    if (isNaN(cost) || cost <= 0) {
      toast.error("Enter a valid cost price");
      return;
    }
    calcMargin.mutate({
      costPrice: cost,
      quantity,
      customMarkup: customMarkup ? parseFloat(customMarkup) : undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="flex items-center justify-between bg-card border border-border/30 p-4">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${gatewayStatus?.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
          <div>
            <span className="font-bold text-sm tracking-wider text-foreground">GATEWAY TIRE</span>
            <span className="text-foreground/40 text-xs ml-2">Dunlap & Kyle B2B Portal</span>
          </div>
        </div>
        <a
          href="https://b2b.dktire.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-primary hover:text-primary/80 font-bold text-xs tracking-wider"
        >
          OPEN PORTAL <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Tire Search */}
        <div className="space-y-4">
          <div className="bg-card border border-border/30 p-5">
            <h3 className="font-bold text-sm tracking-wider text-foreground mb-4">SEARCH TIRES</h3>
            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
                <input
                  type="text"
                  value={sizeQuery}
                  onChange={e => setSizeQuery(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Enter tire size (e.g. 2156017)"
                  className="w-full pl-10 pr-4 py-2.5 bg-background border border-border/30 text-foreground text-[13px] focus:border-primary/50 focus:outline-none"
                />
              </div>
            </div>

            {/* Popular Sizes */}
            {popularData && (
              <div>
                <span className="font-mono text-[10px] text-foreground/40 tracking-wide">POPULAR SIZES</span>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {popularData.sizes.slice(0, 10).map(s => (
                    <button
                      key={s.raw}
                      onClick={() => setSizeQuery(s.raw)}
                      className={`px-2.5 py-1 text-[12px] border transition-colors ${
                        sizeQuery === s.raw
                          ? "border-primary text-primary bg-primary/10"
                          : "border-border/30 text-foreground/50 hover:text-foreground hover:border-foreground/30"
                      }`}
                    >
                      {s.formatted}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Search Results / Portal Link */}
            {searching && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            )}

            {searchResults && searchResults.source === "portal" && sizeQuery.length >= 5 && (
              <div className="mt-4 p-4 bg-amber-500/5 border border-amber-500/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-foreground/80 text-sm">
                      Open Gateway Tire portal to search for <strong className="text-primary">{sizeQuery}</strong>.
                      Then enter the wholesale cost below to calculate your pricing.
                    </p>
                    <a
                      href={searchResults.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 mt-3 text-primary hover:text-primary/80 font-bold text-xs tracking-wider"
                    >
                      SEARCH ON GATEWAY TIRE <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            )}

            {searchResults && searchResults.tires.length > 0 && (
              <div className="mt-4 space-y-2">
                {searchResults.tires.map((tire, i) => (
                  <div key={i} className="p-3 bg-background border border-border/30 hover:border-primary/30 transition-colors cursor-pointer"
                    onClick={() => {
                      setCostPrice(tire.costPrice.toFixed(2));
                      setFet(tire.fet.toFixed(2));
                    }}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-bold text-sm text-foreground">{tire.brand}</span>
                        <span className="text-foreground/60 text-sm ml-2">{tire.model}</span>
                      </div>
                      <span className="font-mono text-primary font-bold">${tire.costPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex gap-4 mt-1 text-foreground/40 text-[10px]">
                      <span>LOCAL: {tire.localInventory}</span>
                      <span>REGIONAL: {tire.regionalInventory}</span>
                      <span>ETA: {tire.deliveryDate}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Margin Calculator */}
        <div className="space-y-4">
          <div className="bg-card border border-border/30 p-5">
            <h3 className="font-bold text-sm tracking-wider text-foreground mb-4">
              <Calculator className="w-4 h-4 inline mr-2" />
              TIRE MARGIN CALCULATOR
            </h3>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">WHOLESALE COST ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={costPrice}
                  onChange={e => setCostPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-background border border-border/30 text-foreground text-[13px] focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">QUANTITY</label>
                <div className="flex gap-1">
                  {[1, 2, 4].map(q => (
                    <button
                      key={q}
                      onClick={() => setQuantity(q)}
                      className={`flex-1 py-2 text-[13px] border transition-colors ${
                        quantity === q
                          ? "border-primary text-primary bg-primary/10"
                          : "border-border/30 text-foreground/50 hover:text-foreground"
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">MARKUP %</label>
                <input
                  type="number"
                  value={customMarkup}
                  onChange={e => setCustomMarkup(e.target.value)}
                  placeholder="Default (50%)"
                  className="w-full px-3 py-2 bg-background border border-border/30 text-foreground text-[13px] focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">FET ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={fet}
                  onChange={e => setFet(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-background border border-border/30 text-foreground text-[13px] focus:border-primary/50 focus:outline-none"
                />
              </div>
            </div>

            {/* Service Add-ons */}
            <div className="mb-4">
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-2">INCLUDE SERVICES</span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Mounting ($20/ea)", checked: includeMount, set: setIncludeMount },
                  { label: "Balancing ($15/ea)", checked: includeBalance, set: setIncludeBalance },
                  { label: "Disposal ($5/ea)", checked: includeDisposal, set: setIncludeDisposal },
                  { label: "TPMS ($35/ea)", checked: includeTPMS, set: setIncludeTPMS },
                ].map(s => (
                  <label key={s.label} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={s.checked}
                      onChange={e => s.set(e.target.checked)}
                      className="accent-primary"
                    />
                    <span className="text-[12px] text-foreground/60">{s.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleCalculate}
              disabled={calcMargin.isPending}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 font-bold text-sm tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {calcMargin.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              CALCULATE PRICING
            </button>

            {/* Results */}
            {calcMargin.data && (
              <div className="mt-4 space-y-3">
                <div className="bg-background border border-primary/30 p-4">
                  <div className="flex justify-between items-center mb-3">
                    <span className="font-mono text-[10px] text-foreground/40 tracking-wider">CUSTOMER PRICE PER TIRE</span>
                    <span className="font-bold text-2xl text-primary">${calcMargin.data.perTire.total.toFixed(2)}</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-foreground/50">
                      <span>Tire price ({calcMargin.data.summary.markupUsed}% markup)</span>
                      <span>${calcMargin.data.perTire.tirePrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-foreground/50">
                      <span>Service fee (mount/balance/disposal)</span>
                      <span>${calcMargin.data.perTire.serviceFee.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-background border border-emerald-500/30 p-4">
                  <div className="flex justify-between items-center mb-3">
                    <span className="font-mono text-[10px] text-foreground/40 tracking-wider">
                      TOTAL ({calcMargin.data.summary.quantity} TIRES)
                    </span>
                    <span className="font-bold text-2xl text-emerald-400">
                      ${calcMargin.data.summary.totalRevenue.toFixed(2)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <span className="font-mono text-[10px] text-foreground/30 block">YOUR COST</span>
                      <span className="text-[13px] text-foreground/60">${calcMargin.data.summary.totalCost.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="font-mono text-[10px] text-foreground/30 block">PROFIT</span>
                      <span className="text-[13px] text-emerald-400">${calcMargin.data.summary.totalProfit.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="font-mono text-[10px] text-foreground/30 block">MARGIN</span>
                      <span className="text-[13px] text-primary">{((calcMargin.data.summary.totalProfit / calcMargin.data.summary.totalRevenue) * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Save Default Markup */}
          <div className="bg-card border border-border/30 p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-xs tracking-wider text-foreground">DEFAULT MARKUP</span>
                <p className="font-mono text-[10px] text-foreground/40 mt-0.5">Applied when no custom markup is entered</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={customMarkup || "50"}
                  onChange={e => setCustomMarkup(e.target.value)}
                  className="w-20 px-2 py-1.5 bg-background border border-border/30 text-foreground text-[13px] text-center focus:border-primary/50 focus:outline-none"
                />
                <span className="text-foreground/40 text-[13px]">%</span>
                <button
                  onClick={() => {
                    const val = parseFloat(customMarkup || "50");
                    if (!isNaN(val)) updateMarkup.mutate({ markup: val });
                  }}
                  className="px-3 py-1.5 bg-foreground/10 text-foreground/60 hover:text-foreground font-bold text-[10px] tracking-wider transition-colors"
                >
                  SAVE
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
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

  const calculateLabor = trpc.autoLabor.calculateLabor.useMutation();

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
            <span className="font-bold text-sm tracking-wider text-foreground">AUTO LABOR GUIDE</span>
            <span className="text-foreground/40 text-xs ml-2">ShopDriver Elite</span>
          </div>
        </div>
        <a
          href="https://secure.autolaborexperts.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-primary hover:text-primary/80 font-bold text-xs tracking-wider"
        >
          OPEN PORTAL <ExternalLink className="w-3.5 h-3.5" />
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
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide">CATEGORIES</span>
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
              {searchQuery.length >= 2 ? `RESULTS FOR "${searchQuery.toUpperCase()}"` : selectedCategory ? categoryJobs?.category?.toUpperCase() || "JOBS" : "SELECT A CATEGORY"}
            </span>
            <span className="font-mono text-[10px] text-foreground/30">{displayJobs.length} JOBS</span>
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
            <div
              key={`${job.name}-${i}`}
              className={`bg-card border transition-colors cursor-pointer p-4 ${
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
                <span>RANGE: {job.minHours}–{job.maxHours}h</span>
                {"categoryName" in job && <span className="text-foreground/30">{(job as any).categoryName}</span>}
              </div>
              {job.notes && (
                <p className="text-foreground/30 text-xs mt-1">{job.notes}</p>
              )}
            </div>
          ))}
        </div>

        {/* Right: Labor Calculator */}
        <div className="space-y-4">
          <div className="bg-card border border-border/30 p-5">
            <h3 className="font-bold text-sm tracking-wider text-foreground mb-4">
              <DollarSign className="w-4 h-4 inline mr-2" />
              LABOR CALCULATOR
            </h3>

            {calcJob ? (
              <div className="space-y-4">
                <div className="bg-background border border-border/30 p-3">
                  <span className="font-mono text-[10px] text-foreground/40 tracking-wider block mb-1">SELECTED JOB</span>
                  <span className="font-bold text-sm text-foreground">{calcJob.name}</span>
                </div>

                {/* Difficulty */}
                <div>
                  <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-2">DIFFICULTY</span>
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
                      <span className="font-mono text-[10px] text-foreground/40 tracking-wider">LABOR COST</span>
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

// ═══════════════════════════════════════════════════════════
// TAB 3: QUICK ESTIMATE BUILDER
// ═══════════════════════════════════════════════════════════
function QuickEstimateTab() {
  const [lines, setLines] = useState<EstimateLine[]>([]);
  const [addType, setAddType] = useState<"labor" | "tire" | "part">("labor");
  const [addName, setAddName] = useState("");
  const [addHours, setAddHours] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [addCost, setAddCost] = useState("");
  const { data: categories } = trpc.autoLabor.categories.useQuery();

  const addLine = () => {
    if (!addName.trim()) {
      toast.error("Enter a name");
      return;
    }

    const qty = parseInt(addQty) || 1;
    const cost = parseFloat(addCost) || 0;
    const hours = parseFloat(addHours) || 0;

    const newLine: EstimateLine = {
      id: Date.now().toString(),
      type: addType,
      name: addName.trim(),
      hours: addType === "labor" ? hours : undefined,
      quantity: qty,
      unitCost: cost,
      total: cost * qty,
    };

    setLines(prev => [...prev, newLine]);
    setAddName("");
    setAddHours("");
    setAddCost("");
    setAddQty("1");
  };

  const removeLine = (id: string) => {
    setLines(prev => prev.filter(l => l.id !== id));
  };

  const totals = useMemo(() => {
    const labor = lines.filter(l => l.type === "labor").reduce((s, l) => s + l.total, 0);
    const tires = lines.filter(l => l.type === "tire").reduce((s, l) => s + l.total, 0);
    const parts = lines.filter(l => l.type === "part").reduce((s, l) => s + l.total, 0);
    return { labor, tires, parts, total: labor + tires + parts };
  }, [lines]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Add Line Items */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-border/30 p-5">
            <h3 className="font-bold text-sm tracking-wider text-foreground mb-4">ADD LINE ITEM</h3>

            <div className="flex gap-1 mb-4">
              {(["labor", "tire", "part"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setAddType(t)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 font-bold text-xs tracking-wide transition-colors ${
                    addType === t
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "text-foreground/50 hover:text-foreground border border-border/30"
                  }`}
                >
                  {t === "labor" ? <Wrench className="w-3.5 h-3.5" /> : t === "tire" ? <CircleDot className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
                  {t}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="col-span-2">
                <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">DESCRIPTION</label>
                <input
                  type="text"
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  placeholder={addType === "labor" ? "e.g. Front Brake Pads" : addType === "tire" ? "e.g. 215/60R17 Fortune" : "e.g. Brake Rotor"}
                  className="w-full px-3 py-2 bg-background border border-border/30 text-foreground text-[13px] focus:border-primary/50 focus:outline-none"
                />
              </div>
              {addType === "labor" && (
                <div>
                  <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">HOURS</label>
                  <input
                    type="number"
                    step="0.1"
                    value={addHours}
                    onChange={e => setAddHours(e.target.value)}
                    placeholder="1.0"
                    className="w-full px-3 py-2 bg-background border border-border/30 text-foreground text-[13px] focus:border-primary/50 focus:outline-none"
                  />
                </div>
              )}
              <div>
                <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">QTY</label>
                <input
                  type="number"
                  value={addQty}
                  onChange={e => setAddQty(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border/30 text-foreground text-[13px] focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">UNIT PRICE ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={addCost}
                  onChange={e => setAddCost(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-background border border-border/30 text-foreground text-[13px] focus:border-primary/50 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={addLine}
              className="flex items-center gap-2 bg-foreground/10 text-foreground/60 hover:text-foreground px-4 py-2 font-bold text-xs tracking-wide transition-colors"
            >
              <Plus className="w-4 h-4" />
              ADD TO ESTIMATE
            </button>
          </div>

          {/* Line Items Table */}
          {lines.length > 0 && (
            <div className="bg-card border border-border/30">
              <div className="p-4 border-b border-border/30">
                <span className="font-bold text-sm tracking-wider text-foreground">ESTIMATE LINES</span>
              </div>
              <div className="divide-y divide-border/20">
                {lines.map(line => (
                  <div key={line.id} className="flex items-center gap-4 px-4 py-3">
                    <div className={`w-6 h-6 flex items-center justify-center ${
                      line.type === "labor" ? "text-blue-400" : line.type === "tire" ? "text-primary" : "text-foreground/40"
                    }`}>
                      {line.type === "labor" ? <Wrench className="w-4 h-4" /> : line.type === "tire" ? <CircleDot className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-xs tracking-wider text-foreground block truncate">{line.name}</span>
                      <span className="font-mono text-[10px] text-foreground/40">
                        {line.type.toUpperCase()} {line.hours ? `• ${line.hours}h` : ""} • QTY {line.quantity}
                      </span>
                    </div>
                    <span className="text-[13px] text-foreground">${line.total.toFixed(2)}</span>
                    <button onClick={() => removeLine(line.id)} className="text-foreground/30 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Estimate Summary */}
        <div className="space-y-4">
          <div className="bg-card border border-border/30 p-5 sticky top-20">
            <h3 className="font-bold text-sm tracking-wider text-foreground mb-4">ESTIMATE SUMMARY</h3>

            {lines.length === 0 ? (
              <div className="text-center py-8">
                <Calculator className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
                <p className="text-foreground/40 text-sm">Add line items to build an estimate</p>
              </div>
            ) : (
              <div className="space-y-3">
                {totals.labor > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/50">Labor</span>
                    <span className="text-foreground">${totals.labor.toFixed(2)}</span>
                  </div>
                )}
                {totals.tires > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/50">Tires</span>
                    <span className="text-foreground">${totals.tires.toFixed(2)}</span>
                  </div>
                )}
                {totals.parts > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/50">Parts</span>
                    <span className="text-foreground">${totals.parts.toFixed(2)}</span>
                  </div>
                )}
                <div className="border-t border-border/30 pt-3">
                  <div className="flex justify-between">
                    <span className="font-bold text-sm tracking-wider text-foreground">TOTAL</span>
                    <span className="font-bold text-2xl text-primary">${totals.total.toFixed(2)}</span>
                  </div>
                </div>

                <div className="pt-3 space-y-2">
                  <button
                    onClick={() => {
                      const text = lines.map(l => `${l.name} (${l.type}) x${l.quantity} = $${l.total.toFixed(2)}`).join("\n") + `\n\nTOTAL: $${totals.total.toFixed(2)}`;
                      navigator.clipboard.writeText(text);
                      toast.success("Estimate copied to clipboard");
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors"
                  >
                    COPY ESTIMATE
                  </button>
                  <button
                    onClick={() => { setLines([]); }}
                    className="w-full flex items-center justify-center gap-2 bg-foreground/10 text-foreground/50 hover:text-foreground px-4 py-2 font-bold text-xs tracking-wide transition-colors"
                  >
                    CLEAR ALL
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
