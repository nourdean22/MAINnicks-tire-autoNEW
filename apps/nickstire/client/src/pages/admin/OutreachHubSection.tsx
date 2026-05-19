/**
 * Outreach Hub — Unified page for all customer outreach:
 * SMS, Follow-Ups, Campaigns, Reviews, Win-Back
 *
 * Tesla-style: one clean surface, tabs to navigate, all tools in one place.
 */
import { lazy, Suspense } from "react";
import { Send, MessageSquare, Star, RotateCcw, Timer, Loader2, BarChart3 } from "lucide-react";
import { PageHeader, TabBar, useUrlFilter } from "./shared";

const SmsSection = lazy(() => import("./SmsSection"));
const FollowUpsSection = lazy(() => import("./FollowUpsSection"));
const CampaignsSection = lazy(() => import("./CampaignsSection"));
const ReviewRequestsSection = lazy(() => import("./ReviewRequestsSection"));
const WinBackSection = lazy(() => import("./WinBackSection"));
// wave-181.51 — SMS Performance read-out (reply + conversion attribution
// per outbound send, rolled up per tier). Lives in OutreachHub because
// it's the analytic counterpart to Messages/Campaigns/Follow-Ups.
const SmsPerformanceSection = lazy(() => import("./SmsPerformanceSection"));

// 2026-05-19 Elon-cut · `reengage` tab deleted. Win-Back covers the same
// cohort (lapsed customers receiving SMS); two surfaces was cognitive
// overhead. Aliases `reengage`/`reengagement` still resolve to this hub.
type OutreachTab = "sms" | "campaigns" | "followups" | "reviews" | "winback" | "performance";

// Wave-129 — SMS (1-on-1 texting) is the most-used customer-touch surface,
// so it leads. Campaigns/Follow-ups/etc. are scheduled/bulk tooling — they
// belong to the right of the primary action.
// wave-181.51 — Performance tab appended at the end. It's the analytics
// surface, not a sending surface, so it belongs after the action tabs.
const TABS: { id: OutreachTab; label: string; icon: React.ReactNode }[] = [
  { id: "sms", label: "Messages", icon: <Send className="w-3.5 h-3.5" /> },
  { id: "campaigns", label: "Campaigns", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: "followups", label: "Follow-Ups", icon: <Timer className="w-3.5 h-3.5" /> },
  { id: "reviews", label: "Reviews", icon: <Star className="w-3.5 h-3.5" /> },
  { id: "winback", label: "Win-Back", icon: <RotateCcw className="w-3.5 h-3.5" /> },
  { id: "performance", label: "Performance", icon: <BarChart3 className="w-3.5 h-3.5" /> },
];

function TabSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
    </div>
  );
}

const VALID_OUTREACH_TABS: OutreachTab[] = ["sms", "campaigns", "followups", "reviews", "winback", "performance"];

export default function OutreachHubSection() {
  // wave-129 — default tab moved from "campaigns" → "sms". Operator
  // screenshot showed they couldn't find the texting UI because Campaigns
  // (an empty broadcast manager) was loading first. Texting is the highest-
  // frequency action on this surface; it deserves the front door.
  const [tab, setTab] = useUrlFilter<OutreachTab>(
    "outreachTab",
    "sms",
    {
      validate: (raw) => (VALID_OUTREACH_TABS.includes(raw as OutreachTab) ? (raw as OutreachTab) : null),
    },
  );

  // SMS tab uses its own header (it's a chat-style surface — full bleed)
  if (tab === "sms") {
    return (
      <div className="space-y-4">
        <TabBar tabs={TABS} activeTab={tab} onChange={setTab} variant="pill" />
        <Suspense fallback={<TabSpinner />}>
          <SmsSection />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outreach Hub"
        subtitle="Campaigns · review requests · win-back · follow-ups · loyalty — scheduled and bulk customer touches."
        icon={<Send className="w-5 h-5" />}
      />
      <TabBar tabs={TABS} activeTab={tab} onChange={setTab} variant="pill" />

      {/* Content */}
      <Suspense fallback={<TabSpinner />}>
        {tab === "campaigns" && <CampaignsSection />}
        {tab === "followups" && <FollowUpsSection />}
        {tab === "reviews" && <ReviewRequestsSection />}
        {tab === "winback" && <WinBackSection />}
        {tab === "performance" && <SmsPerformanceSection />}
      </Suspense>
    </div>
  );
}
