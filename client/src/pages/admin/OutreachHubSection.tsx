/**
 * Outreach Hub — Unified page for all customer outreach:
 * SMS, Follow-Ups, Campaigns, Reviews, Win-Back
 *
 * Tesla-style: one clean surface, tabs to navigate, all tools in one place.
 */
import { useState, useEffect, lazy, Suspense } from "react";
import { Send, MessageSquare, Star, RotateCcw, Timer, Loader2 } from "lucide-react";
import { PageHeader, TabBar } from "./shared";

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

const VALID_OUTREACH_TABS: OutreachTab[] = ["campaigns", "sms", "followups", "reviews", "winback"];

export default function OutreachHubSection() {
  // URL-persistent ?outreachTab=...
  const [tab, setTab] = useState<OutreachTab>(() => {
    if (typeof window === "undefined") return "campaigns";
    const raw = new URLSearchParams(window.location.search).get("outreachTab");
    return raw && (VALID_OUTREACH_TABS as string[]).includes(raw) ? (raw as OutreachTab) : "campaigns";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (tab === "campaigns") url.searchParams.delete("outreachTab");
    else url.searchParams.set("outreachTab", tab);
    window.history.replaceState({}, "", url.toString());
  }, [tab]);

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
      </Suspense>
    </div>
  );
}
