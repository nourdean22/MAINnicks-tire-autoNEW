/**
 * RevenueSection — Advanced Revenue Command Center with KPIs, charts, projections,
 * invoice management, create invoice form, and hour-of-day heatmap.
 * AUDIT-FIXED: Added create invoice, hour heatmap, invoice table with edit/delete.
 */
import React, { useState, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import {
  DollarSign, Loader2, Activity, Plus,
  AlertTriangle, Wrench, CreditCard,
} from "lucide-react";

// 2026-05-19 Elon-cut · Specials moved to ContentSection (it's content
// management, not invoice data).
// 2026-05-19 MONEY consolidation · Declined Work + Snap Finance pulled
// IN as tabs (they were sidebar destinations; all three answer
// "where's the money?" so one screen, three tabs).
const WorkOrdersSection = lazy(() => import("./money/WorkOrdersSection"));
// wave-110 — CustomersSection removed; reachable as top-level /admin?tab=customers
const DispatchSection = lazy(() => import("./money/DispatchSection"));
const DeclinedEstimatesSection = lazy(() => import("./money/DeclinedEstimatesSection"));
const SnapDashboardSection = lazy(() => import("./money/SnapDashboardSection"));
// 2026-06-10 cockpit consolidation · the short-lived Money → Tire Orders
// tab (same-day checkout-hardening wave) is retired: PR #41's top-level
// Tire Commerce Command Center is the single surviving cockpit, with the
// tab's protection banners ported into it. "tireOrders" stays a VALID
// moneyTab value so old deep links (Overview alerts, bookmarks, Telegram
// messages) redirect to the survivor instead of 404-ing — see
// LegacyTireOrdersRedirect below.

// 2026-05-19 · PageHeader removed from import + render (Move 4 of audit ·
// reclaims ~80px of mobile viewport · topbar already shows "Money").
import { SectionInsightStrip, TabBar, useUrlFilter } from "./shared";
import { SkeletonKpiGrid, SkeletonChart } from "@/components/admin/AdminSkeletons";
// wave-181.x Money Phase 2 · MoneyBrief 3-line auto-narrative.
import { MoneyBrief } from "./money/MoneyBrief";
import { DashboardView } from "./money/DashboardView";
import { InvoiceListView } from "./money/InvoiceListView";
import { CreateInvoiceView } from "./money/CreateInvoiceView";

// 2026-05-19 MONEY consolidation · 5 tabs (Revenue · Declined · Financing
// · Shop Pulse · Shop Status). Ordering: money-flow first (where's it
// in / where's it walked away / how do we close), operational state after.
// The 5-tab cap is at the edge of mobile-acceptable but each tab earns
// its slot. Shop Pulse + Status remain because Dispatch + WorkOrders are
// distinct operational surfaces (verified Phase 3) — they don't fold
// cleanly elsewhere yet.
// 2026-06-10 cockpit consolidation · Money is back to its designed 5
// tabs: "tireOrders" is no longer a NAV entry (the top-level Tire Orders
// section is the one cockpit) but remains a valid URL value that
// redirects — never break a staff deep link.
type SectionTab = "revenue" | "tireOrders" | "declined" | "financing" | "shopPulse" | "shopStatus";

const MONEY_TABS: { id: SectionTab; label: string; icon: React.ReactNode }[] = [
  { id: "revenue", label: "Revenue", icon: <DollarSign className="w-3.5 h-3.5" /> },
  { id: "declined", label: "Declined", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  { id: "financing", label: "Financing", icon: <CreditCard className="w-3.5 h-3.5" /> },
  { id: "shopPulse", label: "Shop Pulse", icon: <Wrench className="w-3.5 h-3.5" /> },
  { id: "shopStatus", label: "Shop Status", icon: <Activity className="w-3.5 h-3.5" /> },
];

const VALID_MONEY_TABS: SectionTab[] = ["revenue", "tireOrders", "declined", "financing", "shopPulse", "shopStatus"];

// Compatibility wrapper for the retired Money → Tire Orders deep link:
// rewrites the URL to the surviving top-level cockpit. Full-page
// replace is fine — Admin resolves ?tab= on mount, and this path only
// fires from old bookmarks/alerts.
function LegacyTireOrdersRedirect() {
  React.useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "tireOrders");
    url.searchParams.delete("moneyTab");
    window.location.replace(url.toString());
  }, []);
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin text-primary" />
      Tire Orders moved — opening the Tire Orders cockpit…
    </div>
  );
}

export default function RevenueSection() {
  // URL-persistent so deep-links + back-button + sidebar refresh land on
  // the right inner tab. Replaces useState that bounced operator back to
  // Revenue every refresh.
  const [section, setSection] = useUrlFilter<SectionTab>(
    "moneyTab",
    "revenue",
    {
      validate: (raw) => (VALID_MONEY_TABS.includes(raw as SectionTab) ? (raw as SectionTab) : null),
    },
  );

  return (
    <div className="space-y-6">
      {/* 2026-05-19 · PageHeader killed · topbar already says "Money".
          Lead with content (insight strip + tabs), not a redundant title. */}
      <SectionInsightStrip section="revenue" />
      <TabBar
        tabs={MONEY_TABS}
        activeTab={section}
        onChange={setSection}
      />

      {section === "revenue" && <RevenueContent onGoToDeclined={() => setSection("declined")} />}
      {section === "tireOrders" && <LegacyTireOrdersRedirect />}
      {section === "declined" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <DeclinedEstimatesSection />
        </Suspense>
      )}
      {section === "financing" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <SnapDashboardSection />
        </Suspense>
      )}
      {section === "shopPulse" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <WorkOrdersSection />
        </Suspense>
      )}
      {section === "shopStatus" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <DispatchSection />
        </Suspense>
      )}
    </div>
  );
}

// ─── REVENUE CONTENT (previously the entire RevenueSection) ───
function RevenueContent({ onGoToDeclined }: { onGoToDeclined: () => void }) {
  const [period, setPeriod] = useState(30);
  const [intelPeriod, setIntelPeriod] = useState<"7d" | "30d" | "90d" | "6mo" | "1yr" | "all">("30d");
  // wave-111 — was useState; now URL-persistent via useUrlFilter so a
  // refresh / deep-link / back-button doesn't bounce operator off the
  // invoices or create sub-tab back to dashboard.
  const [tab, setTab] = useUrlFilter<"dashboard" | "invoices" | "create">(
    "revTab",
    "dashboard",
    {
      validate: (raw) => (raw === "dashboard" || raw === "invoices" || raw === "create" ? raw : null),
    },
  );
  const { data: stats, isLoading } = trpc.invoices.stats.useQuery({ days: period }, { refetchInterval: 60000 });
  const { data: topCustomers } = trpc.invoices.topCustomers.useQuery({ limit: 10 });
  const { data: kpi } = trpc.kpi.current.useQuery(undefined, { refetchInterval: 60000 });
  const { data: shopFloor } = trpc.nourOsBridge.shopFloor.useQuery(undefined, { refetchInterval: 30000 });
  const { data: funnel } = trpc.workOrders.conversionFunnel.useQuery({ days: period }, { refetchInterval: 120000 });
  const { data: intel } = trpc.invoices.intelligence.useQuery({ period: intelPeriod }, { refetchInterval: 120000 });
  const { data: custIntel } = trpc.customers.intelligence.useQuery(undefined, { refetchInterval: 300000 });
  const utils = trpc.useUtils();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonKpiGrid cols={4} />
        <SkeletonChart height={280} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* wave-181.x Money Phase 2 · MoneyBrief 3-line auto-narrative
       * lands above the inner TabBar so the operator's first eye-grab
       * is "what's the money state today" rather than 8 stat tiles.
       *
       * Note · the onDeclinedAction callback is the parent's setSection
       * setter (passed as onGoToDeclined prop). NOT the admin:navigate-
       * section CustomEvent · that triggers Admin.tsx's setSection, but
       * we're already ON "revenue" so React bails out and useUrlFilter
       * (mount-only-read) never re-reads ?moneyTab=declined. The direct
       * setter from useUrlFilter does write+update local state in one
       * call · the only path that actually moves the visible tab when
       * we're already inside RevenueSection. (Code-review agent caught
       * this · same useUrlFilter-mount-only bug class as wave-181.x
       * Outreach Phase 2.) */}
      <MoneyBrief period={period} onDeclinedAction={onGoToDeclined} />

      {/* Header */}
      {/* wave-112 — was 3 hand-styled <button>s; switched to canonical TabBar
          (pill variant) so revenue sub-tabs match every other admin section.
          Outer Revenue tabs already use TabBar; inner ones drifted.
          wave-181.x Money Phase 1 · subtitle "Real-time financial
          intelligence" was filler · removed. The TabBar tells the
          operator what they're looking at. */}
      <div className="flex items-center justify-end flex-wrap gap-4">
        <TabBar
          tabs={[
            { id: "dashboard" as const, label: "DASHBOARD" },
            { id: "invoices" as const, label: "INVOICES" },
            { id: "create" as const, label: "NEW", icon: <Plus className="w-3 h-3" /> },
          ]}
          activeTab={tab}
          onChange={setTab}
          variant="pill"
          size="compact"
        />
      </div>

      {tab === "dashboard" && <DashboardView stats={stats} topCustomers={topCustomers} kpi={kpi} shopFloor={shopFloor} funnel={funnel} period={period} setPeriod={setPeriod} intel={intel} intelPeriod={intelPeriod} setIntelPeriod={setIntelPeriod} custIntel={custIntel} />}
      {tab === "invoices" && <InvoiceListView onCreateNew={() => setTab("create")} />}
      {tab === "create" && <CreateInvoiceView onDone={() => { setTab("invoices"); utils.invoices.list.invalidate(); utils.invoices.stats.invalidate(); }} />}
    </div>
  );
}
