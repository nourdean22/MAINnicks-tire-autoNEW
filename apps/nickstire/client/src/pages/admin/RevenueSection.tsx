/**
 * RevenueSection (Money): what the shop billed, declined estimates, financing.
 *
 * 2026-10-25: opens on Billed (the invoice mirror's figure beside the window before, and the next
 * estimate to chase). The work-order board, Shop Status and the Snap dashboard were removed: they
 * read tables the shop never uses (one cancelled work order ever, no technicians, no
 * snap_applications table), so on a phone they were a dashboard of nothing. Any old moneyTab value
 * lands on Billed.
 */
import React, { lazy, Suspense } from "react";
import { Loader2, AlertTriangle, CreditCard, Receipt } from "lucide-react";

import SalesCard from "./SalesCard";
import NextEstimate from "./money/NextEstimate";
const DeclinedEstimatesSection = lazy(() => import("./money/DeclinedEstimatesSection"));
import { FinancingAttribution } from "./money/FinancingAttribution";

import { SectionInsightStrip, TabBar, useUrlFilter } from "./shared";

type SectionTab = "billed" | "declined" | "financing";

const MONEY_TABS: { id: SectionTab; label: string; icon: React.ReactNode }[] = [
  { id: "billed", label: "Billed", icon: <Receipt className="w-3.5 h-3.5" /> },
  { id: "declined", label: "Declined", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  { id: "financing", label: "Financing", icon: <CreditCard className="w-3.5 h-3.5" /> },
];

const VALID_MONEY_TABS: SectionTab[] = ["billed", "declined", "financing"];

export default function RevenueSection() {
  // URL-persistent so deep-links + back-button + sidebar refresh land on the right inner tab.
  const [section, setSection] = useUrlFilter<SectionTab>(
    "moneyTab",
    "billed",
    {
      validate: (raw) => (VALID_MONEY_TABS.includes(raw as SectionTab) ? (raw as SectionTab) : null),
    },
  );

  return (
    <div className="space-y-6">
      <SectionInsightStrip section="revenue" />
      <TabBar
        tabs={MONEY_TABS}
        activeTab={section}
        onChange={setSection}
      />

      {section === "billed" && (
        <div className="space-y-4">
          <SalesCard variant="money" />
          <NextEstimate onOpenDeclined={() => setSection("declined")} />
        </div>
      )}
      {section === "declined" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <DeclinedEstimatesSection />
        </Suspense>
      )}
      {section === "financing" && <FinancingAttribution />}
    </div>
  );
}
