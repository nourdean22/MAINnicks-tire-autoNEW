import React, { lazy, Suspense, useState, useEffect } from "react";
import { Brain, Clapperboard, ClipboardList, Disc, DollarSign, Images, Instagram, LayoutDashboard, Megaphone, PhoneCall, Send, Settings, Shield, Sparkles, TrendingUp, UserCheck } from "lucide-react";
import type { AdminSection, NavGroup } from "./shared/types";
import type { AdminNavigateDetail, AdminOpenCustomerDrawerDetail } from "./shared/navigation";
import AdminSectionBoundary from "@/components/admin/AdminSectionBoundary";
import { Loader2 } from "lucide-react";

export interface RegistrySection {
  id: AdminSection;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType<any>;
  aliases?: string[];
  keywords?: string[];
  group?: string;
  showInSidebar?: boolean;
}

// Lazy-load sections relative to this file's position (client/src/pages/admin/)
const OverviewSection = lazy(() => import("./OverviewSection"));
const InstagramSection = lazy(() => import("./instagram/InstagramAdmin").then((m) => ({ default: m.InstagramAdmin })));
const LeadsSection = lazy(() => import("./LeadsSection"));
const ContentSection = lazy(() => import("./ContentSection"));
const CustomersSection = lazy(() => import("./CustomersSection"));
const SettingsSection = lazy(() => import("./SettingsSection"));
const RevenueSection = lazy(() => import("./RevenueSection"));
const CallTrackingSection = lazy(() => import("./CallTrackingSection"));
const CampaignsSection = lazy(() => import("./OutreachHubSection"));
const MembershipsSection = lazy(() => import("./MembershipsSection"));
const TireOrdersSection = lazy(() => import("./TireOrdersSection"));
const OpsHubSection = lazy(() => import("./OpsHubSection"));
const GrowthSection = lazy(() => import("./GrowthSection"));
const IntelligenceHQSection = lazy(() => import("./intelligence/IntelligenceHQSection"));
const TrafficFunnelSection = lazy(() => import("./TrafficFunnelSection"));
const VoiceReceptionistSection = lazy(() => import("./VoiceReceptionistSection"));

export const ADMIN_REGISTRY: RegistrySection[] = [
  {
    id: "overview",
    label: "Today",
    icon: <LayoutDashboard className="w-4 h-4" />,
    component: OverviewSection,
    aliases: ["dashboard", "home", "today", "bookings", "chats", "workorders", "wo", "work-orders", "dispatch", "activity", "exports", "exportview"],
    keywords: ["dashboard", "overview", "home", "today"],
    group: "Operations",
    showInSidebar: true,
  },
  {
    id: "intelligence",
    label: "Intelligence HQ",
    icon: <Brain className="w-4 h-4 text-purple-400" />,
    component: IntelligenceHQSection,
    aliases: ["intell", "intelligencehq"],
    keywords: ["intelligence", "brain", "hq", "scoreboard"],
    group: "Outreach",
    showInSidebar: true,
  },
  {
    id: "customers",
    label: "Customers",
    icon: <UserCheck className="w-4 h-4" />,
    component: CustomersSection,
    aliases: ["referrals", "jobs", "loyalty", "warranty", "waitlist"],
    keywords: ["customer", "client", "database", "lookup", "loyalty", "winback", "referral"],
    group: "Revenue",
    showInSidebar: true,
  },
  {
    id: "leads",
    label: "Sales Pipeline",
    icon: <TrendingUp className="w-4 h-4" />,
    component: LeadsSection,
    aliases: ["pipeline", "walkincalc", "walkin", "quote", "noshowrisk", "noshow"],
    keywords: ["lead", "crm", "prospect", "new customer", "no-show", "risk"],
    group: "Sales",
    showInSidebar: true,
  },
  {
    id: "tireOrders",
    label: "Tires",
    icon: <Disc className="w-4 h-4" />,
    component: TireOrdersSection,
    aliases: ["tires", "tireorders"],
    keywords: ["tires", "orders", "inventory", "stock"],
    group: "Operations",
    showInSidebar: true,
  },
  {
    id: "growth",
    label: "Marketing / Growth",
    icon: <TrendingUp className="w-4 h-4" />,
    component: GrowthSection,
    aliases: ["gbp", "local", "localseo", "social"],
    keywords: ["marketing", "growth", "seo", "local", "reviews", "replies"],
    group: "Operations",
    showInSidebar: true,
  },
  {
    // Promoted out of Growth's 7th inner pill. Instagram autonomously generates,
    // spends and publishes to a live audience; burying the only surface that can
    // stop it three levels deep (Growth > Instagram > Actions) meant a held
    // publish had nowhere to announce itself. It carries the ops badge.
    id: "instagram",
    label: "Instagram",
    icon: <Instagram className="w-4 h-4 text-pink-400" />,
    component: InstagramSection,
    aliases: ["ig", "instagram", "reels", "reel", "igstudio", "ig-studio", "actions", "actioncenter", "publishing"],
    keywords: ["instagram", "ig", "reel", "post", "publish", "caption", "story", "carousel", "actions", "stuck", "held"],
    group: "Operations",
    showInSidebar: true,
  },
  {
    id: "campaigns",
    label: "Winback",
    icon: <Send className="w-4 h-4" />,
    component: CampaignsSection,
    aliases: ["reengagement", "reengage", "autofollowup", "reviewrequests", "reviews", "winback", "sms", "followups"],
    keywords: ["campaign", "outreach", "sms", "email", "review", "follow-up", "re-engage", "winback", "dormant", "inactive"],
    group: "Outreach",
    showInSidebar: true,
  },
  {
    id: "memberships",
    label: "Nonstop Nick",
    icon: <Shield className="w-4 h-4" />,
    component: MembershipsSection,
    aliases: ["membership", "member", "nonstop", "subscription"],
    keywords: ["membership", "member", "nonstop", "nick", "subscription", "plan", "vehicle", "bind", "7.99", "9.99"],
    group: "Money",
    showInSidebar: true,
  },
  {
    id: "voiceReceptionist",
    label: "Voice Receptionist",
    icon: <PhoneCall className="w-4 h-4" />,
    component: VoiceReceptionistSection,
    aliases: ["voicereceptionist", "voice", "vapi", "receptionist"],
    keywords: ["vapi", "voice", "nick", "receptionist", "ai", "agent", "incoming calls", "phone agent"],
    group: "Money",
    showInSidebar: true,
  },
  {
    id: "opsHub",
    label: "Reports",
    icon: <ClipboardList className="w-4 h-4" />,
    component: OpsHubSection,
    aliases: ["opshub", "reports", "ops"],
    keywords: ["opshub", "reports", "ops"],
    group: "Operations",
    showInSidebar: true,
  },
  {
    id: "settings",
    label: "Settings / Safety",
    icon: <Settings className="w-4 h-4" />,
    component: SettingsSection,
    aliases: ["settings", "conversionpreview", "preview", "health", "syshealth", "compliance", "integrations", "system", "shopdriver", "alg", "nour-os-bridge", "commandcenter", "command"],
    keywords: ["setting", "config", "sync", "shopdriver", "health", "compliance", "integrations"],
    group: "System",
    showInSidebar: true,
  },
  // Non-sidebar targets
  {
    id: "revenue",
    label: "Money",
    icon: <DollarSign className="w-4 h-4" />,
    component: RevenueSection,
    aliases: ["revenue", "money", "income", "sales", "declined", "walked", "snap", "financing", "acima", "koalafi"],
    keywords: ["revenue", "money", "income", "sales", "declined", "walked", "snap", "financing", "acima", "koalafi"],
    group: "Money",
    showInSidebar: false,
  },
  {
    id: "callTrackingView",
    label: "Call Tracking",
    icon: <PhoneCall className="w-4 h-4" />,
    component: CallTrackingSection,
    aliases: ["callbacks", "calls", "calltracking", "call-tracking"],
    keywords: ["call", "phone", "tracking", "missed", "callback"],
    group: "Money",
    showInSidebar: false,
  },
  {
    id: "trafficFunnel",
    label: "Traffic → Revenue",
    icon: <TrendingUp className="w-4 h-4" />,
    component: TrafficFunnelSection,
    aliases: ["funnel", "traffic", "traffic-revenue"],
    keywords: ["funnel", "traffic", "seo", "conversion", "clicks"],
    group: "Operations",
    showInSidebar: false,
  },
  {
    id: "content",
    label: "Content & AI",
    icon: <Sparkles className="w-4 h-4" />,
    component: ContentSection,
    aliases: ["content", "content-and-ai", "specials", "coupons", "qa", "seoengine"],
    keywords: ["content", "post", "social", "blog", "ai", "seo", "specials"],
    group: "Outreach",
    showInSidebar: false,
  },
];

export const COMPOUND_REDIRECTS: Record<string, { section: AdminSection; innerKey: string; innerValue: string }> = {
  declinedestimates: { section: "revenue", innerKey: "moneyTab", innerValue: "declined" },
  declined: { section: "revenue", innerKey: "moneyTab", innerValue: "declined" },
  estimates: { section: "revenue", innerKey: "moneyTab", innerValue: "declined" },
  "declined-work": { section: "revenue", innerKey: "moneyTab", innerValue: "declined" },
  snapdashboard: { section: "revenue", innerKey: "moneyTab", innerValue: "financing" },
  "snap-finance": { section: "revenue", innerKey: "moneyTab", innerValue: "financing" },
  financing: { section: "revenue", innerKey: "moneyTab", innerValue: "financing" },
  snap: { section: "revenue", innerKey: "moneyTab", innerValue: "financing" },
};

export function resolveSection(raw: string): AdminSection | null {
  const slug = (raw || "").toLowerCase().trim();
  if (!slug) return null;
  for (const entry of ADMIN_REGISTRY) {
    if (entry.id.toLowerCase() === slug) return entry.id;
  }
  for (const entry of ADMIN_REGISTRY) {
    if (entry.aliases?.some(a => a.toLowerCase() === slug)) return entry.id;
  }
  return null;
}

export function resolveInitialSection(): AdminSection {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("tab") || params.get("section") || "").toLowerCase().trim();
  if (!raw) return "overview";

  if (raw in COMPOUND_REDIRECTS) {
    const r = COMPOUND_REDIRECTS[raw];
    params.set("tab", r.section);
    params.set(r.innerKey, r.innerValue);
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.history.replaceState({}, "", url.toString());
    return r.section;
  }

  return resolveSection(raw) ?? "overview";
}

function SectionSpinner() {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
        <span className="text-xs text-muted-foreground tracking-wide">Loading...</span>
      </div>
    </div>
  );
}

export function SectionContent({ section }: { section: AdminSection }) {
  const entry = ADMIN_REGISTRY.find(s => s.id === section);
  if (!entry) return null;
  const Component = entry.component;
  return (
    <AdminSectionBoundary sectionName={section}>
      <Suspense fallback={<SectionSpinner />}>
        <Component />
      </Suspense>
    </AdminSectionBoundary>
  );
}

export function useAdminNavigation() {
  const [section, setSection] = useState<AdminSection>(resolveInitialSection);

  // Sync tab state to browser URL search params
  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = new URLSearchParams(window.location.search).get("tab");
    if (current === section) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", section);
    window.history.replaceState({}, "", url.toString());
  }, [section]);

  // Sync state on browser back/forward history navigation
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("tab") || params.get("section") || "";
      const resolved = resolveSection(raw);
      setSection(resolved ?? "overview");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Section-navigation event bridge listener
  useEffect(() => {
    const handler = (e: Event) => {
      // Partial<AdminNavigateDetail>, not AdminNavigateDetail: this listener
      // stays defensive about a malformed/stale event (detail may be
      // undefined, section may be an unresolved alias string) even though
      // navigateToAdminSection() only ever dispatches a valid shape —
      // resolveSection() below is exactly that defensive resolution step.
      const detail = (e as CustomEvent<Partial<AdminNavigateDetail>>).detail;
      if (!detail?.section) return;
      const resolved = resolveSection(detail.section);
      if (!resolved) {
        console.warn("[admin:navigate-section] unknown section slug:", detail.section);
        return;
      }
      setSection(resolved);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };
    window.addEventListener("admin:navigate-section", handler);
    return () => window.removeEventListener("admin:navigate-section", handler);
  }, []);

  // Customer drawer event bridge listener with history pollution prevention
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AdminOpenCustomerDrawerDetail>).detail;
      if (typeof detail?.customerId === "number") {
        const params = new URLSearchParams(window.location.search);
        const currentTab = params.get("tab");
        const currentId = params.get("id");

        setSection("customers");

        if (currentTab === "customers" && currentId === String(detail.customerId)) {
          // Already on customers page with the exact ID, prevent history pollution
          return;
        }

        const url = new URL(window.location.href);
        url.searchParams.set("tab", "customers");
        url.searchParams.set("id", String(detail.customerId));
        window.history.pushState({}, "", url.toString());
      }
    };
    window.addEventListener("admin:open-customer-drawer", handler);
    return () => window.removeEventListener("admin:open-customer-drawer", handler);
  }, []);

  return { section, setSection };
}
