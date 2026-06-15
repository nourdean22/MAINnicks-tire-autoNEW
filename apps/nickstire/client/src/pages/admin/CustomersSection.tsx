/**
 * Customer Database Admin Section
 * View, search, filter, and manage imported customer records.
 * Now with: VIP badges, churn risk indicators, lifetime value sorting,
 * call buttons, total spent, days since last visit.
 */
import React, { useEffect, useState, lazy, Suspense } from "react";
import { PageHeader, SectionInsightStrip, TabBar } from "./shared";
import { Users, UserCheck, Crown, Hash, Loader2 } from "lucide-react";
import { type CustomerTab } from "./customers/format";
import CustomerProfile from "./customers/CustomerProfile";
import { CustomersList } from "./customers/CustomersList";

const LoyaltyAdminSection = lazy(() => import("./customers/LoyaltyAdminSection"));
const CouponsSection = lazy(() => import("./customers/CouponsSection"));

// 2026-05-19 Elon-cut · SegmentBadge component + SEGMENT_CONFIG removed.
// StatusBadge (below) is the canonical badge — VIP / LOST / AT RISK.
// SegmentBadge added a 2nd badge per card with duplicate information
// (Recent/Lapsed/Unknown/New maps cleanly to the same axes StatusBadge
// already covers). Segment filtering still works via the `Segment` type.

// wave-181.x Customers Phase 1 · DELETED JOURNEY_ICONS const.
// Was an emoji-icon system parallel to the canonical Lucide icons in
// CustomerDrawer.EVENT_CONFIG · only used inside the now-deleted
// CustomerJourney component which was only mounted inside the
// now-deleted CustomerDetail modal. Triple-dead.

// wave-181.x Customers Phase 1 · DELETED 3 dead components below
// (CustomerJourney + CustomerDetail + InlineSms · ~390 lines).
// Why each:
//   · CustomerJourney  — emoji-icon timeline · only mounted inside
//     CustomerDetail · CustomerDrawer.EVENT_CONFIG is the canonical
//     timeline pattern.
//   · CustomerDetail   — 250-line full-screen fixed modal that did the
//     same job as CustomerDrawer (the surviving side-drawer pattern) ·
//     missing the wave-100 DECLINED + BACKLOG tiles that 360Panel has.
//   · InlineSms        — duplicate SMS popover · MessageCustomerLink
//     (the canonical pattern from the wave-181.x SMS-link migration)
//     handles all admin SMS now.
// All entry points migrated:
//   · Eye button → openCustomerDrawer(id)
//   · Row SMS button → <MessageCustomerLink>
// State `selectedId` removed from CustomersList.
// wave-181.x Customers Phase 1 · DELETED 3 dead components in one block:
//   CustomerJourney  (43 lines · emoji timeline · only used by CustomerDetail)
//   CustomerDetail   (250 lines · full-screen modal duplicating CustomerDrawer)
//   InlineSms        (74 lines · SMS popover duplicating MessageCustomerLink)
// Why · the wave-181.92 admin consolidation kept TWO detail patterns
// (full-screen modal + side drawer) for the same job. CustomerDrawer is
// the surviving one (richer · already wired to event-bus from anywhere ·
// includes the wave-100 DECLINED + BACKLOG tiles). MessageCustomerLink
// is the canonical SMS-link primitive from the wave-181.x click-to-
// message migration. JOURNEY_ICONS const was already deleted above.
// All call sites in this file migrated:
//   · Eye button setSelectedId(c.id) → openCustomerDrawer(c.id)
//   · Row InlineSms button           → <MessageCustomerLink>
//   · selectedId state               → removed (drawer manages its own)

export default function CustomersSection() {
  // URL-persistent tab state (matches Settings pattern via ?customersTab=...)
  const [activeTab, setActiveTab] = useState<CustomerTab>(() => {
    if (typeof window === "undefined") return "customers";
    const raw = new URLSearchParams(window.location.search).get("customersTab");
    return raw === "loyalty" || raw === "coupons" ? raw : "customers";
  });

  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("id");
    const num = raw ? Number(raw) : null;
    return num && !isNaN(num) && num > 0 ? num : null;
  });

  const handleOpenCustomer = (id: number) => {
    setSelectedCustomerId(id);
    setActiveTab("customers");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "customers");
      url.searchParams.set("id", String(id));
      window.history.pushState({}, "", url.toString());
    }
  };

  // Keep state in sync with URL queries (e.g., when clicking back/forward, or direct event)
  useEffect(() => {
    const handleUrlChange = () => {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("id");
      const num = raw ? Number(raw) : null;
      if (raw && (num === null || isNaN(num) || num <= 0)) {
        // remove invalid id from URL
        const url = new URL(window.location.href);
        url.searchParams.delete("id");
        window.history.replaceState({}, "", url.toString());
        setSelectedCustomerId(null);
      } else {
        setSelectedCustomerId(num);
      }

      const customersTabParam = params.get("customersTab");
      if (raw && num !== null && !isNaN(num) && num > 0) {
        setActiveTab("customers");
      } else if (customersTabParam === "loyalty" || customersTabParam === "coupons") {
        setActiveTab(customersTabParam);
      } else {
        setActiveTab("customers");
      }
    };

    // Run once on mount to validate/sync initial URL state
    handleUrlChange();

    window.addEventListener("popstate", handleUrlChange);

    const handleOpenDrawer = (e: Event) => {
      const detail = (e as CustomEvent<{ customerId: number }>).detail;
      const num = detail?.customerId;
      if (typeof num === "number" && !isNaN(num) && num > 0) {
        setSelectedCustomerId(num);
        setActiveTab("customers");
      }
    };
    window.addEventListener("admin:open-customer-drawer", handleOpenDrawer);

    return () => {
      window.removeEventListener("popstate", handleUrlChange);
      window.removeEventListener("admin:open-customer-drawer", handleOpenDrawer);
    };
  }, []);

  // Keep URL in sync when tab changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (activeTab === "customers") url.searchParams.delete("customersTab");
    else url.searchParams.set("customersTab", activeTab);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab]);

  const handleBackToList = () => {
    setSelectedCustomerId(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("id");
      window.history.pushState({}, "", url.toString());
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle="Loyalty · coupons · customer drawer · spend tiers · churn risk"
        icon={<UserCheck className="w-5 h-5" />}
      />
      <SectionInsightStrip section="customers" />
      <TabBar
        tabs={[
          { id: "customers", label: "Customers", icon: <Users className="w-3.5 h-3.5" /> },
          { id: "loyalty", label: "Loyalty", icon: <Crown className="w-3.5 h-3.5" /> },
          { id: "coupons", label: "Coupons", icon: <Hash className="w-3.5 h-3.5" /> },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "loyalty" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <LoyaltyAdminSection />
        </Suspense>
      )}
      {activeTab === "coupons" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <CouponsSection />
        </Suspense>
      )}
      {activeTab === "customers" && (
        selectedCustomerId !== null ? (
          <CustomerProfile customerId={selectedCustomerId} onClose={handleBackToList} />
        ) : (
          <CustomersList onOpenCustomer={handleOpenCustomer} />
        )
      )}
    </div>
  );
}
