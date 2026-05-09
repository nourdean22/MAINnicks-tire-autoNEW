/**
 * Outreach Hub — Unified page for all customer outreach:
 * SMS, Follow-Ups, Campaigns, Reviews, Win-Back
 *
 * Tesla-style: one clean surface, tabs to navigate, all tools in one place.
 */
import { lazy, Suspense } from "react";
import { Send, MessageSquare, Star, RotateCcw, Timer, Loader2, Phone } from "lucide-react";
import { PageHeader, TabBar, useUrlFilter } from "./shared";

const SmsSection = lazy(() => import("./SmsSection"));
const FollowUpsSection = lazy(() => import("./FollowUpsSection"));
const CampaignsSection = lazy(() => import("./CampaignsSection"));
const ReviewRequestsSection = lazy(() => import("./ReviewRequestsSection"));
const WinBackSection = lazy(() => import("./WinBackSection"));
// Wave-2026-05-09 — ReEngagement absorbed as 6th tab (was a zombie top-level
// route per audit). Section file deleted; the page is now reachable only via
// /admin?tab=campaigns&outreachTab=reengage.
const ReEngagementSection = lazy(() => import("./ReEngagementSection"));

type OutreachTab = "campaigns" | "sms" | "followups" | "reviews" | "winback" | "reengage";

const TABS: { id: OutreachTab; label: string; icon: React.ReactNode }[] = [
  { id: "campaigns", label: "Campaigns", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: "sms", label: "SMS", icon: <Send className="w-3.5 h-3.5" /> },
  { id: "followups", label: "Follow-Ups", icon: <Timer className="w-3.5 h-3.5" /> },
  { id: "reviews", label: "Reviews", icon: <Star className="w-3.5 h-3.5" /> },
  { id: "winback", label: "Win-Back", icon: <RotateCcw className="w-3.5 h-3.5" /> },
  { id: "reengage", label: "Re-Engage", icon: <Phone className="w-3.5 h-3.5" /> },
];

function TabSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
    </div>
  );
}

const VALID_OUTREACH_TABS: OutreachTab[] = ["campaigns", "sms", "followups", "reviews", "winback", "reengage"];

export default function OutreachHubSection() {
  // wave-112 — migrated from custom useState + useEffect URL writer to
  // shared useUrlFilter (consistent with every other section). Note:
  // useUrlFilter deletes the param when value === defaultValue ("campaigns"),
  // which restores the cleaner-URL behavior wave-111 backed out of. The
  // wave-111 deep-link-strip concern is mitigated because useUrlFilter's
  // initial read still resolves to "campaigns" if the param is missing OR
  // explicitly set to "campaigns" — both render the same tab, identical UX.
  const [tab, setTab] = useUrlFilter<OutreachTab>(
    "outreachTab",
    "campaigns",
    {
      validate: (raw) => (VALID_OUTREACH_TABS.includes(raw as OutreachTab) ? (raw as OutreachTab) : null),
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outreach Hub"
        subtitle="Campaigns · SMS broadcasts · Review requests · Win-back · Follow-ups · Loyalty — every customer touch in one place."
        icon={<Send className="w-5 h-5" />}
      />
      <TabBar
        tabs={TABS}
        activeTab={tab}
        onChange={setTab}
        variant="pill"
      />

      {/* Content */}
      <Suspense fallback={<TabSpinner />}>
        {tab === "campaigns" && <CampaignsSection />}
        {tab === "sms" && <SmsSection />}
        {tab === "followups" && <FollowUpsSection />}
        {tab === "reviews" && <ReviewRequestsSection />}
        {tab === "winback" && <WinBackSection />}
        {tab === "reengage" && <ReEngagementSection />}
      </Suspense>
    </div>
  );
}
