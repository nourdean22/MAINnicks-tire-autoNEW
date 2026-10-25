/**
 * OpsHubSection: the admin "Reports" section. Two views:
 *   - Search: the former Market section (Google Search Console, owner/manager only)
 *   - Traffic: the former Traffic to Revenue section (owner/manager only)
 * The hand-maintained Owner Actions registry and the doc-link list were cut 2026-10-25: the registry
 * had gone stale for 4.5 months, and the capability ledger (docs/operations/REALITY-LEDGER.md) is the record.
 *
 * SAFETY: Search performs zero mutations. Traffic can take two actions: draft SEO fix suggestions
 * (seoTools.generateSeoFixDrafts) and submit the sitemaps to Google Search Console (seoTools.submitSitemaps).
 */
import { lazy, Suspense } from "react";
import { Wrench, Loader2, Search, TrendingUp } from "lucide-react";
import { Section, TabBar, useUrlFilter } from "./shared";
import { innerTabsForRole, resolveInnerTab } from "./innerTabs";
import type { AdminRole } from "@shared/adminPermissions";
import { trpc } from "@/lib/trpc";

const MarketSection = lazy(() => import("./MarketSection"));
const TrafficFunnelSection = lazy(() => import("./TrafficFunnelSection"));

const HUB_TABS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: "search", label: "Search", icon: <Search className="w-3.5 h-3.5" /> },
  { id: "traffic", label: "Traffic", icon: <TrendingUp className="w-3.5 h-3.5" /> },
];

const tabFallback = <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

export default function OpsHubSection() {
  // Role decides which tabs show (innerTabs.ts): both tabs need marketing/customers permissions,
  // which accountant and viewer lack, so those roles see no tab here.
  const { data: security, isError: securityFailed, fetchStatus: securityFetchStatus, refetch: refetchSecurity } =
    trpc.adminSecurity.status.useQuery();
  const role = (security?.adminRole ?? null) as AdminRole | null;
  // A failed or paused (offline PWA) access read is unknown: say so, as Customers does.
  const accessUnknown = !security && (securityFailed || securityFetchStatus === "paused");
  const [requested, setTab] = useUrlFilter<string>("reportsTab", "search");
  const tab = resolveInnerTab("opsHub", requested, role);
  const visibleTabs = HUB_TABS.filter((t) => innerTabsForRole("opsHub", role).includes(t.id));

  return (
    <Section
      title="Reports"
      subtitle={tab === "traffic" ? "Traffic can take two actions: draft SEO fix suggestions, and submit the sitemaps to Google Search Console. Nothing else here sends, posts, refunds, or orders." : tab === "search" ? "Google search, last 28 days. Read-only: nothing here sends, posts, refunds, or orders." : "Read-only: nothing here sends, posts, refunds, or orders."}
      icon={<Wrench className="w-5 h-5 text-primary" />}
    >
      {accessUnknown && (
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground mb-3">
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
      {role && !tab && <p className="text-[13px] text-muted-foreground">Reports has nothing for your role.</p>}
      {!role && !accessUnknown && tabFallback}
      {tab && <TabBar tabs={visibleTabs} activeTab={tab} onChange={setTab} variant="pill" size="compact" />}

      {tab === "search" && <div className="mt-4"><Suspense fallback={tabFallback}><MarketSection /></Suspense></div>}
      {tab === "traffic" && <div className="mt-4"><Suspense fallback={tabFallback}><TrafficFunnelSection /></Suspense></div>}
    </Section>
  );
}
