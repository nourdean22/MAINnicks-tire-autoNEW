/**
 * Customer Database Admin Section
 * View, search, filter, and manage imported customer records.
 * Now with: VIP badges, churn risk indicators, lifetime value sorting,
 * call buttons, total spent, days since last visit.
 */
import React, { useEffect, useState, lazy, Suspense } from "react";
import { PageHeader, SectionInsightStrip, TabBar, type AdminOpenCustomerDrawerDetail } from "./shared";
import { Users, UserCheck, Shield, PhoneCall, Loader2 } from "lucide-react";
import CustomerProfile from "./customers/CustomerProfile";
import { CustomersList } from "./customers/CustomersList";
import { CustomerIntelligence } from "./intelligence/CustomerIntelligence";
import { innerTabsForRole, resolveInnerTab } from "./innerTabs";
import { trpc } from "@/lib/trpc";
import type { AdminRole } from "@shared/adminPermissions";

const MembershipsSection = lazy(() => import("./MembershipsSection"));

const CUSTOMER_TABS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: "customers", label: "Customers", icon: <Users className="w-3.5 h-3.5" /> },
  { id: "members", label: "Members", icon: <Shield className="w-3.5 h-3.5" /> },
  { id: "calls", label: "Call list", icon: <PhoneCall className="w-3.5 h-3.5" /> },
];

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
  // 2026-10-19 (admin prune W1): Loyalty and Coupons were cut (both tables have 0
  // rows ever); Nonstop Nick moved in as Members and Intelligence HQ's call list
  // as Calls. Which tabs a role sees is innerTabs.ts: an accountant reaches this
  // section for Members ONLY, never the customer list. Until the role loads no
  // restricted tab renders.
  const { data: security, isError: securityFailed, fetchStatus: securityFetchStatus, refetch: refetchSecurity } =
    trpc.adminSecurity.status.useQuery();
  const role = (security?.adminRole ?? null) as AdminRole | null;
  // A failed or paused (offline PWA) access read is unknown, not "no tabs": say so.
  const accessUnknown = !security && (securityFailed || securityFetchStatus === "paused");
  const [requested, setRequested] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("customersTab"),
  );
  const activeTab = resolveInnerTab("customers", requested, role);
  const visibleTabs = CUSTOMER_TABS.filter((t) => innerTabsForRole("customers", role).includes(t.id));

  const setActiveTab = (next: string) => {
    setRequested(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "customers") url.searchParams.delete("customersTab");
    else url.searchParams.set("customersTab", next);
    window.history.replaceState({}, "", url.toString());
  };

  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("id");
    const num = raw ? Number(raw) : null;
    return num && !isNaN(num) && num > 0 ? num : null;
  });

  const handleOpenCustomer = (id: number) => {
    setSelectedCustomerId(id);
    setRequested("customers");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "customers");
      url.searchParams.delete("customersTab");
      url.searchParams.set("id", String(id));
      window.history.pushState({}, "", url.toString());
    }
  };

  // Keep state in sync with URL queries (back/forward, a redirect, or the drawer event)
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
      setRequested(params.get("customersTab") ?? (raw && num !== null && !isNaN(num) && num > 0 ? "customers" : null));
    };

    // Run once on mount to validate/sync initial URL state
    handleUrlChange();

    window.addEventListener("popstate", handleUrlChange);
    window.addEventListener("admin:url-sync", handleUrlChange);

    const handleOpenDrawer = (e: Event) => {
      const detail = (e as CustomEvent<AdminOpenCustomerDrawerDetail>).detail;
      const num = detail?.customerId;
      if (typeof num === "number" && !isNaN(num) && num > 0) {
        setSelectedCustomerId(num);
        setRequested("customers");
      }
    };
    window.addEventListener("admin:open-customer-drawer", handleOpenDrawer);

    return () => {
      window.removeEventListener("popstate", handleUrlChange);
      window.removeEventListener("admin:url-sync", handleUrlChange);
      window.removeEventListener("admin:open-customer-drawer", handleOpenDrawer);
    };
  }, []);

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
        subtitle="Customer list · Nonstop Nick members · call list"
        icon={<UserCheck className="w-5 h-5" />}
      />
      {activeTab === "customers" && <SectionInsightStrip section="customers" />}
      {visibleTabs.length > 1 && (
        <TabBar tabs={visibleTabs} activeTab={activeTab ?? "customers"} onChange={setActiveTab} />
      )}

      {activeTab === null && accessUnknown && (
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <span>Could not check your access.</span>
          <button
            type="button"
            onClick={() => void refetchSecurity()}
            className="min-h-12 min-w-12 px-4 rounded-md border border-border/40 text-foreground/85"
          >
            Retry
          </button>
        </div>
      )}
      {activeTab === null && !accessUnknown && (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      )}
      {activeTab === "members" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <MembershipsSection />
        </Suspense>
      )}
      {activeTab === "calls" && <CustomerIntelligence />}
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
