/**
 * IntelligenceSection — All 50 engines across 7 category tabs.
 * Lazy-loaded per tab. 2min stale cache. No "use client".
 */
import { useState } from "react";
import {
  Brain, TrendingUp, Users, Wrench, Target, Rocket, Shield,
} from "lucide-react";
import { PageHeader } from "./shared";
import OverviewTab from "./intelligence/OverviewTab";
import RevenueTab from "./intelligence/RevenueTab";
import CustomersTab from "./intelligence/CustomersTab";
import OperationsTab from "./intelligence/OperationsTab";
import MarketingTab from "./intelligence/MarketingTab";
import GrowthTab from "./intelligence/GrowthTab";
import SafetyTab from "./intelligence/SafetyTab";

type Tab = "overview" | "revenue" | "customers" | "operations" | "marketing" | "growth" | "safety";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "OVERVIEW", icon: <Brain className="w-3.5 h-3.5" /> },
  { id: "revenue", label: "REVENUE", icon: <TrendingUp className="w-3.5 h-3.5" /> },
  { id: "customers", label: "CUSTOMERS", icon: <Users className="w-3.5 h-3.5" /> },
  { id: "operations", label: "OPERATIONS", icon: <Wrench className="w-3.5 h-3.5" /> },
  { id: "marketing", label: "MARKETING", icon: <Target className="w-3.5 h-3.5" /> },
  { id: "growth", label: "GROWTH", icon: <Rocket className="w-3.5 h-3.5" /> },
  { id: "safety", label: "SAFETY", icon: <Shield className="w-3.5 h-3.5" /> },
];

export default function IntelligenceSection() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intelligence"
        subtitle="50 engines · 7 categories · revenue forecasting · churn prediction · cross-sell · capacity · seasonal demand"
        icon={<Brain className="w-5 h-5" />}
      />
      {/* Tab bar */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-1 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] tracking-wider transition-colors ${
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
              }`}
            >
              {t.icon}
              <span className="hidden md:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Active tab */}
      {tab === "overview" && <OverviewTab />}
      {tab === "revenue" && <RevenueTab />}
      {tab === "customers" && <CustomersTab />}
      {tab === "operations" && <OperationsTab />}
      {tab === "marketing" && <MarketingTab />}
      {tab === "growth" && <GrowthTab />}
      {tab === "safety" && <SafetyTab />}
    </div>
  );
}
