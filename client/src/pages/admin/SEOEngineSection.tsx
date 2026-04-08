/**
 * SEO Engine Dashboard — Bird's eye view of all programmatic SEO pages.
 * Shows tire size pages, vehicle+service combos, and total page count.
 */
import { useState, useMemo } from "react";
import { TIRE_SIZE_PAGES } from "@shared/tireSizes";
import { VEHICLE_SERVICE_PAGES } from "@shared/vehicleServicePages";
import { ALL_ROUTES } from "@shared/routes";
import { StatCard } from "./shared";
import {
  Globe, Search, Car, CircleDot, ChevronRight, ExternalLink,
  BarChart3, Target, TrendingUp, Filter,
} from "lucide-react";

type Tab = "overview" | "tire-sizes" | "vehicle-services" | "all-routes";

export default function SEOEngineSection() {
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");

  // Route group counts
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of ALL_ROUTES) {
      counts[r.group] = (counts[r.group] || 0) + 1;
    }
    return counts;
  }, []);

  const sitemapCount = useMemo(() => ALL_ROUTES.filter(r => r.sitemap).length, []);
  const totalRoutes = ALL_ROUTES.length;

  // Filtered lists
  const filteredTireSizes = useMemo(() => {
    if (!search) return TIRE_SIZE_PAGES;
    const q = search.toLowerCase();
    return TIRE_SIZE_PAGES.filter(p =>
      p.size.toLowerCase().includes(q) ||
      p.commonVehicles.some(v => v.toLowerCase().includes(q)) ||
      p.category.toLowerCase().includes(q)
    );
  }, [search]);

  const filteredVehicleServices = useMemo(() => {
    if (!search) return VEHICLE_SERVICE_PAGES;
    const q = search.toLowerCase();
    return VEHICLE_SERVICE_PAGES.filter(p =>
      p.make.toLowerCase().includes(q) ||
      p.service.toLowerCase().includes(q) ||
      p.commonModels.some(m => m.toLowerCase().includes(q))
    );
  }, [search]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "overview", label: "Overview", count: totalRoutes },
    { id: "tire-sizes", label: "Tire Sizes", count: TIRE_SIZE_PAGES.length },
    { id: "vehicle-services", label: "Make+Service", count: VEHICLE_SERVICE_PAGES.length },
    { id: "all-routes", label: "All Routes", count: totalRoutes },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-foreground tracking-tight">SEO Engine</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Programmatic page inventory. {sitemapCount} indexed pages across {Object.keys(groupCounts).length} route groups.
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 p-1 bg-card rounded-sm border border-border/30">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSearch(""); }}
            className={`flex-1 px-3 py-2 text-xs font-medium tracking-wide rounded-sm transition-colors ${
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            }`}
          >
            {t.label}
            <span className={`ml-1.5 ${tab === t.id ? "text-primary-foreground/70" : "text-muted-foreground/50"}`}>
              ({t.count})
            </span>
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Stats Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="TOTAL PAGES"
              value={totalRoutes}
              icon={<Globe className="w-4 h-4" />}
              color="text-primary"
            />
            <StatCard
              label="IN SITEMAP"
              value={sitemapCount}
              icon={<Search className="w-4 h-4" />}
              color="text-emerald-400"
            />
            <StatCard
              label="TIRE SIZE PAGES"
              value={TIRE_SIZE_PAGES.length}
              icon={<CircleDot className="w-4 h-4" />}
              color="text-blue-400"
            />
            <StatCard
              label="MAKE+SERVICE"
              value={VEHICLE_SERVICE_PAGES.length}
              icon={<Car className="w-4 h-4" />}
              color="text-amber-400"
            />
          </div>

          {/* Route Groups Breakdown */}
          <div className="bg-card rounded-sm border border-border/30 p-4">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Page Inventory by Group
            </h3>
            <div className="space-y-2">
              {Object.entries(groupCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([group, count]) => {
                  const pct = Math.round((count / totalRoutes) * 100);
                  return (
                    <div key={group} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-28 shrink-0 font-mono">{group}</span>
                      <div className="flex-1 h-5 bg-foreground/5 rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-primary/20 rounded-sm transition-all"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-foreground w-10 text-right">{count}</span>
                      <span className="text-[10px] text-muted-foreground w-10 text-right">{pct}%</span>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* SEO Coverage Summary */}
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="bg-card rounded-sm border border-border/30 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Tire Sizes</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {TIRE_SIZE_PAGES.length} pages targeting top US tire sizes.
                Categories: {[...new Set(TIRE_SIZE_PAGES.map(p => p.category))].join(", ")}.
              </p>
            </div>
            <div className="bg-card rounded-sm border border-border/30 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Car className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Make+Service</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {VEHICLE_SERVICE_PAGES.length} pages. {[...new Set(VEHICLE_SERVICE_PAGES.map(p => p.make))].length} makes x{" "}
                {[...new Set(VEHICLE_SERVICE_PAGES.map(p => p.service))].length} services.
              </p>
            </div>
            <div className="bg-card rounded-sm border border-border/30 p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Growth</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                +80 pages from programmatic SEO. Targets high-intent commercial keywords
                for tires and auto repair in Cleveland.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tire Sizes Tab */}
      {tab === "tire-sizes" && (
        <div className="space-y-4">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by size, vehicle, or category..."
              className="w-full pl-9 pr-4 py-2 bg-card border border-border/30 rounded-sm text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="bg-card rounded-sm border border-border/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider">SIZE</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider">CATEGORY</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider hidden sm:table-cell">VEHICLES</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider">LINK</th>
                </tr>
              </thead>
              <tbody>
                {filteredTireSizes.map(p => (
                  <tr key={p.slug} className="border-b border-border/10 hover:bg-foreground/[0.02]">
                    <td className="px-4 py-2.5 font-medium text-foreground">{p.size}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${
                        p.category === "Truck" ? "bg-amber-500/10 text-amber-400" :
                        p.category === "SUV/Crossover" ? "bg-blue-500/10 text-blue-400" :
                        p.category === "Performance" ? "bg-purple-500/10 text-purple-400" :
                        "bg-emerald-500/10 text-emerald-400"
                      }`}>
                        {p.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs hidden sm:table-cell">{p.commonVehicles.join(", ")}</td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/tires/${p.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                      >
                        View <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredTireSizes.length === 0 && (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">No tire sizes match your filter.</div>
            )}
          </div>
        </div>
      )}

      {/* Vehicle Services Tab */}
      {tab === "vehicle-services" && (
        <div className="space-y-4">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by make, service, or model..."
              className="w-full pl-9 pr-4 py-2 bg-card border border-border/30 rounded-sm text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="bg-card rounded-sm border border-border/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider">MAKE</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider">SERVICE</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider hidden sm:table-cell">MODELS</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider">LINK</th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicleServices.map(p => (
                  <tr key={p.slug} className="border-b border-border/10 hover:bg-foreground/[0.02]">
                    <td className="px-4 py-2.5 font-medium text-foreground">{p.make}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.service}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs hidden sm:table-cell">{p.commonModels.slice(0, 4).join(", ")}</td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/${p.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                      >
                        View <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredVehicleServices.length === 0 && (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">No vehicle services match your filter.</div>
            )}
          </div>
        </div>
      )}

      {/* All Routes Tab */}
      {tab === "all-routes" && (
        <div className="space-y-4">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by path, group, or title..."
              className="w-full pl-9 pr-4 py-2 bg-card border border-border/30 rounded-sm text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="bg-card rounded-sm border border-border/30 overflow-hidden max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/30">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider">PATH</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider hidden sm:table-cell">GROUP</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider">SITEMAP</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground tracking-wider">PRIORITY</th>
                </tr>
              </thead>
              <tbody>
                {ALL_ROUTES
                  .filter(r => {
                    if (!search) return true;
                    const q = search.toLowerCase();
                    return r.path.toLowerCase().includes(q) || r.group.toLowerCase().includes(q) || r.title.toLowerCase().includes(q);
                  })
                  .map(r => (
                    <tr key={r.path} className="border-b border-border/10 hover:bg-foreground/[0.02]">
                      <td className="px-4 py-2 font-mono text-xs text-foreground">{r.path}</td>
                      <td className="px-4 py-2 hidden sm:table-cell">
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-foreground/5 text-muted-foreground">
                          {r.group}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        {r.sitemap ? (
                          <span className="text-emerald-400 text-xs">Yes</span>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">No</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-muted-foreground">{r.priority}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
