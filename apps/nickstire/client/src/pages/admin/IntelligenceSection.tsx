/**
 * IntelligenceSection — Operator decision loop · 4 tabs.
 * Lazy-loaded per tab. 2min stale cache. No "use client".
 *
 * 2026-05-19 Elon-cut · Marketing/Growth/Safety tabs deleted.
 *   - Marketing: dupe of TrafficFunnel + SmsPerformance (channelROI,
 *     reviewVelocity, competitorGap, contentPerformance · vanity for
 *     a 1-location shop)
 *   - Growth: marketShare/geoRevenue are computed fiction for one
 *     location · referralNetwork already on OverviewTab
 *   - Safety: compliance score wraps a TCPA counter · Settings
 *     Compliance tab covers it with detail
 * Remaining 4 = the 4 questions a shop owner actually asks:
 *   Overview (am I healthy?) · Revenue (making money?) ·
 *   Customers (who's at risk?) · Operations (bay running?)
 */
import {
  Brain, TrendingUp, Users, Wrench,
} from "lucide-react";
import { PageHeader, TabBar, useUrlFilter } from "./shared";
import OverviewTab from "./intelligence/OverviewTab";
import RevenueTab from "./intelligence/RevenueTab";
import CustomersTab from "./intelligence/CustomersTab";
import OperationsTab from "./intelligence/OperationsTab";

type Tab = "overview" | "revenue" | "customers" | "operations";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "OVERVIEW", icon: <Brain className="w-3.5 h-3.5" /> },
  { id: "revenue", label: "REVENUE", icon: <TrendingUp className="w-3.5 h-3.5" /> },
  { id: "customers", label: "CUSTOMERS", icon: <Users className="w-3.5 h-3.5" /> },
  { id: "operations", label: "OPERATIONS", icon: <Wrench className="w-3.5 h-3.5" /> },
];

const VALID_TABS: Tab[] = ["overview", "revenue", "customers", "operations"];

export default function IntelligenceSection() {
  // wave-112 — was useState; URL-persistent so refresh / deep-link / back
  // doesn't bounce operator off the active intelligence tab.
  const [tab, setTab] = useUrlFilter<Tab>(
    "intelligenceTab",
    "overview",
    {
      validate: (raw) => (VALID_TABS.includes(raw as Tab) ? (raw as Tab) : null),
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intelligence"
        subtitle="Revenue · churn · cross-sell · capacity · seasonal demand"
        icon={<Brain className="w-5 h-5" />}
      />
      <TabBar
        tabs={TABS}
        activeTab={tab}
        onChange={setTab}
        variant="pill"
      />

      {/* Active tab */}
      {tab === "overview" && <OverviewTab />}
      {tab === "revenue" && <RevenueTab />}
      {tab === "customers" && <CustomersTab />}
      {tab === "operations" && <OperationsTab />}
    </div>
  );
}
