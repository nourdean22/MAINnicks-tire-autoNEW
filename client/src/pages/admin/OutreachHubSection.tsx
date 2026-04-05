/**
 * Outreach Hub — Unified page for all customer outreach:
 * SMS, Follow-Ups, Campaigns, Reviews, Win-Back
 *
 * Tesla-style: one clean surface, tabs to navigate, all tools in one place.
 */
import { useState, lazy, Suspense } from "react";
import { Send, MessageSquare, Star, RotateCcw, Timer, Loader2 } from "lucide-react";

const SmsSection = lazy(() => import("./SmsSection"));
const FollowUpsSection = lazy(() => import("./FollowUpsSection"));
const CampaignsSection = lazy(() => import("./CampaignsSection"));
const ReviewRequestsSection = lazy(() => import("./ReviewRequestsSection"));
const WinBackSection = lazy(() => import("./WinBackSection"));

type OutreachTab = "campaigns" | "sms" | "followups" | "reviews" | "winback";

const TABS: { id: OutreachTab; label: string; icon: React.ReactNode }[] = [
  { id: "campaigns", label: "Campaigns", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: "sms", label: "SMS", icon: <Send className="w-3.5 h-3.5" /> },
  { id: "followups", label: "Follow-Ups", icon: <Timer className="w-3.5 h-3.5" /> },
  { id: "reviews", label: "Reviews", icon: <Star className="w-3.5 h-3.5" /> },
  { id: "winback", label: "Win-Back", icon: <RotateCcw className="w-3.5 h-3.5" /> },
];

function TabSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
    </div>
  );
}

export default function OutreachHubSection() {
  const [tab, setTab] = useState<OutreachTab>("campaigns");

  return (
    <div className="space-y-6">
      {/* Tab Bar */}
      <div className="flex items-center gap-1 bg-card border border-border/30 p-1 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold tracking-wider whitespace-nowrap transition-all ${
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <Suspense fallback={<TabSpinner />}>
        {tab === "campaigns" && <CampaignsSection />}
        {tab === "sms" && <SmsSection />}
        {tab === "followups" && <FollowUpsSection />}
        {tab === "reviews" && <ReviewRequestsSection />}
        {tab === "winback" && <WinBackSection />}
      </Suspense>
    </div>
  );
}
