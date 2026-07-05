/**
 * RevenueSection — Advanced Revenue Command Center focusing on active work orders,
 * declined estimates recovery, and financing.
 * Removed ALG invoice tracking / paid revenue metrics based on operator request.
 */
import React, { lazy, Suspense } from "react";
import { Loader2, AlertTriangle, Wrench, CreditCard, Activity, Receipt } from "lucide-react";

// 2026-05-19 MONEY consolidation · Declined Work + Snap Finance pulled
// IN as tabs (they were sidebar destinations; all three answer
// "where's the money?" so one screen, three tabs).
const WorkOrdersSection = lazy(() => import("./money/WorkOrdersSection"));
const DispatchSection = lazy(() => import("./money/DispatchSection"));
const DeclinedEstimatesSection = lazy(() => import("./money/DeclinedEstimatesSection"));
const SnapDashboardSection = lazy(() => import("./money/SnapDashboardSection"));
const UnpaidInvoicesSection = lazy(() => import("./money/UnpaidInvoicesSection"));

// 2026-05-19 · PageHeader removed from import + render (Move 4 of audit ·
// reclaims ~80px of mobile viewport · topbar already shows "Money").
import { SectionInsightStrip, TabBar, useUrlFilter, navigateToAdminSection } from "./shared";

type SectionTab = "tireOrders" | "unpaid" | "declined" | "financing" | "shopPulse" | "shopStatus";

const MONEY_TABS: { id: SectionTab; label: string; icon: React.ReactNode }[] = [
  { id: "shopPulse", label: "Shop Pulse", icon: <Wrench className="w-3.5 h-3.5" /> },
  { id: "unpaid", label: "Unpaid", icon: <Receipt className="w-3.5 h-3.5" /> },
  { id: "declined", label: "Declined", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  { id: "financing", label: "Financing", icon: <CreditCard className="w-3.5 h-3.5" /> },
  { id: "shopStatus", label: "Shop Status", icon: <Activity className="w-3.5 h-3.5" /> },
];

const VALID_MONEY_TABS: SectionTab[] = ["tireOrders", "unpaid", "declined", "financing", "shopPulse", "shopStatus"];

// Compatibility wrapper for the retired Money → Tire Orders deep link:
// rewrites the URL to the surviving top-level cockpit. Full-page
// replace is fine — Admin resolves ?tab= on mount, and this path only
// fires from old bookmarks/alerts.
function LegacyTireOrdersRedirect() {
  React.useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "tireOrders");
    url.searchParams.delete("moneyTab");
    window.history.replaceState({}, "", url.toString());
    navigateToAdminSection("tireOrders");
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
    "shopPulse",
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

      {section === "tireOrders" && <LegacyTireOrdersRedirect />}
      {section === "declined" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <DeclinedEstimatesSection />
        </Suspense>
      )}
      {section === "unpaid" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <UnpaidInvoicesSection />
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
