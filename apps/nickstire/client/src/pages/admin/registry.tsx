import React, { lazy, Suspense, useState, useEffect, useCallback } from "react";
import { Brain, Clapperboard, ClipboardList, Disc, DollarSign, Images, Instagram, LayoutDashboard, Megaphone, PhoneCall, Send, Settings, Shield, Sparkles, TrendingUp, UserCheck } from "lucide-react";
import type { AdminSection, NavGroup } from "./shared/types";
import type { AdminNavigateDetail, AdminOpenCustomerDrawerDetail } from "./shared/navigation";
import { ADMIN_ROLES, type AdminRole } from "@shared/adminPermissions";
import AdminSectionBoundary from "@/components/admin/AdminSectionBoundary";
import { Loader2 } from "lucide-react";

/**
 * Sidebar groups, in the order they render.
 *
 * WHY THESE NAMES: the old `group` values (Operations / Outreach / Revenue /
 * Money / Sales / System) were never rendered — `shared/nav.tsx` collapsed
 * every section into one unlabelled group — so nothing ever contradicted them
 * and they rotted. On main they had `intelligence` under "Outreach",
 * `customers` under "Revenue", `voiceReceptionist` under "Money", and both
 * `instagram` and `growth` under "Operations", plus TWO names for one concept
 * ("Revenue" and "Money"). Rendering those values as-is would have shipped a
 * visibly wrong sidebar, so every section was reassigned in the same change
 * that made the field load-bearing.
 *
 * The lesson is the reason `adminRegistryTruth.test.ts` exists: metadata that
 * nothing reads is not documentation, it is drift waiting to be trusted.
 */
export const ADMIN_NAV_GROUPS = ["Daily", "Reach", "Automation", "Truth", "System"] as const;
export type AdminNavGroup = (typeof ADMIN_NAV_GROUPS)[number];

export interface RegistrySection {
  id: AdminSection;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType<any>;
  aliases?: string[];
  keywords?: string[];
  /** Sidebar group. Required — an unassigned section cannot be placed. */
  group: AdminNavGroup;
  /** Order within the group, ascending. Ties fall back to registry order. */
  priority: number;
  /** Required: `false` means reachable only by alias, command search or deep link. */
  showInSidebar: boolean;
  /**
   * Roles that may reach this section. This is the ONLY role list — `Admin.tsx`
   * previously carried a hand-maintained `ROLE_SECTIONS` map whose `owner` and
   * `manager` entries were byte-identical 16-element arrays, so every change
   * had to be made twice and correctly or the two silently diverged.
   */
  allowedRoles: readonly AdminRole[];
}

/** Every role that can reach the whole admin. Both entries were duplicated by hand before. */
const FULL_ACCESS: readonly AdminRole[] = ["owner", "manager"] as const;

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
    group: "Daily",
    priority: 10,
    showInSidebar: true,
    allowedRoles: ADMIN_ROLES,
  },
  {
    id: "intelligence",
    label: "Intelligence HQ",
    icon: <Brain className="w-4 h-4 text-purple-400" />,
    component: IntelligenceHQSection,
    aliases: ["intell", "intelligencehq"],
    keywords: ["intelligence", "brain", "hq", "scoreboard"],
    group: "Automation",
    priority: 20,
    showInSidebar: true,
    allowedRoles: [...FULL_ACCESS, "viewer"],
  },
  {
    id: "customers",
    label: "Customers",
    icon: <UserCheck className="w-4 h-4" />,
    component: CustomersSection,
    aliases: ["referrals", "jobs", "loyalty", "warranty", "waitlist"],
    keywords: ["customer", "client", "database", "lookup", "loyalty", "winback", "referral"],
    group: "Daily",
    priority: 20,
    showInSidebar: true,
    allowedRoles: [...FULL_ACCESS, "front_desk", "tech"],
  },
  {
    id: "leads",
    label: "Sales Pipeline",
    icon: <TrendingUp className="w-4 h-4" />,
    component: LeadsSection,
    aliases: ["pipeline", "walkincalc", "walkin", "quote", "noshowrisk", "noshow"],
    keywords: ["lead", "crm", "prospect", "new customer", "no-show", "risk"],
    group: "Daily",
    priority: 30,
    showInSidebar: true,
    allowedRoles: [...FULL_ACCESS, "front_desk"],
  },
  {
    id: "tireOrders",
    label: "Tires",
    icon: <Disc className="w-4 h-4" />,
    component: TireOrdersSection,
    aliases: ["tires", "tireorders"],
    keywords: ["tires", "orders", "inventory", "stock"],
    group: "Daily",
    priority: 50,
    showInSidebar: true,
    allowedRoles: [...FULL_ACCESS, "front_desk", "tech"],
  },
  {
    // Nav-orphan fix 2026-07-25: Money was reachable ONLY via Cmd+K or an
    // Overview deep-link. The operator drives this admin from an iPhone PWA
    // where Cmd+K does not exist — the highest-value section in the app had
    // no visible door. Same fix for Content & AI below.
    id: "revenue",
    label: "Money",
    icon: <DollarSign className="w-4 h-4" />,
    component: RevenueSection,
    aliases: ["revenue", "money", "income", "sales", "declined", "walked", "snap", "financing", "acima", "koalafi"],
    keywords: ["revenue", "money", "income", "sales", "declined", "walked", "snap", "financing", "acima", "koalafi"],
    group: "Daily",
    priority: 40,
    showInSidebar: true,
    allowedRoles: [...FULL_ACCESS, "accountant"],
  },
  {
    id: "growth",
    label: "Marketing / Growth",
    icon: <TrendingUp className="w-4 h-4" />,
    component: GrowthSection,
    aliases: ["gbp", "local", "localseo", "social"],
    keywords: ["marketing", "growth", "seo", "local", "reviews", "replies"],
    group: "Reach",
    priority: 10,
    showInSidebar: true,
    allowedRoles: FULL_ACCESS,
  },
  {
    id: "content",
    label: "Content & AI",
    icon: <Sparkles className="w-4 h-4" />,
    component: ContentSection,
    aliases: ["content", "content-and-ai", "specials", "coupons", "qa", "seoengine"],
    keywords: ["content", "post", "social", "blog", "ai", "seo", "specials"],
    group: "Reach",
    priority: 20,
    showInSidebar: true,
    allowedRoles: FULL_ACCESS,
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
    group: "Reach",
    priority: 30,
    showInSidebar: true,
    allowedRoles: FULL_ACCESS,
  },
  {
    id: "campaigns",
    label: "Winback",
    icon: <Send className="w-4 h-4" />,
    component: CampaignsSection,
    aliases: ["reengagement", "reengage", "autofollowup", "reviewrequests", "reviews", "winback", "sms", "followups"],
    keywords: ["campaign", "outreach", "sms", "email", "review", "follow-up", "re-engage", "winback", "dormant", "inactive"],
    group: "Reach",
    priority: 40,
    showInSidebar: true,
    allowedRoles: FULL_ACCESS,
  },
  {
    id: "memberships",
    label: "Nonstop Nick",
    icon: <Shield className="w-4 h-4" />,
    component: MembershipsSection,
    aliases: ["membership", "member", "nonstop", "subscription"],
    keywords: ["membership", "member", "nonstop", "nick", "subscription", "plan", "vehicle", "bind", "7.99", "9.99"],
    group: "Daily",
    priority: 45,
    showInSidebar: true,
    allowedRoles: [...FULL_ACCESS, "accountant"],
  },
  {
    id: "voiceReceptionist",
    label: "Voice Receptionist",
    icon: <PhoneCall className="w-4 h-4" />,
    component: VoiceReceptionistSection,
    aliases: ["voicereceptionist", "voice", "vapi", "receptionist"],
    keywords: ["vapi", "voice", "nick", "receptionist", "ai", "agent", "incoming calls", "phone agent"],
    group: "Automation",
    priority: 10,
    showInSidebar: true,
    allowedRoles: [...FULL_ACCESS, "front_desk"],
  },
  {
    id: "opsHub",
    label: "Reports",
    icon: <ClipboardList className="w-4 h-4" />,
    component: OpsHubSection,
    aliases: ["opshub", "reports", "ops"],
    keywords: ["opshub", "reports", "ops"],
    group: "Truth",
    priority: 10,
    showInSidebar: true,
    allowedRoles: [...FULL_ACCESS, "accountant", "viewer"],
  },
  {
    id: "settings",
    label: "Settings / Safety",
    icon: <Settings className="w-4 h-4" />,
    component: SettingsSection,
    aliases: ["settings", "conversionpreview", "preview", "health", "syshealth", "compliance", "integrations", "system", "shopdriver", "alg", "nour-os-bridge", "commandcenter", "command"],
    keywords: ["setting", "config", "sync", "shopdriver", "health", "compliance", "integrations"],
    group: "System",
    priority: 10,
    showInSidebar: true,
    allowedRoles: FULL_ACCESS,
  },
  // Non-sidebar targets
  {
    id: "callTrackingView",
    label: "Call Tracking",
    icon: <PhoneCall className="w-4 h-4" />,
    component: CallTrackingSection,
    aliases: ["callbacks", "calls", "calltracking", "call-tracking"],
    keywords: ["call", "phone", "tracking", "missed", "callback"],
    group: "Automation",
    priority: 30,
    showInSidebar: false,
    allowedRoles: [...FULL_ACCESS, "front_desk"],
  },
  {
    id: "trafficFunnel",
    label: "Traffic → Revenue",
    icon: <TrendingUp className="w-4 h-4" />,
    component: TrafficFunnelSection,
    aliases: ["funnel", "traffic", "traffic-revenue"],
    keywords: ["funnel", "traffic", "seo", "conversion", "clicks"],
    group: "Truth",
    priority: 20,
    showInSidebar: false,
    allowedRoles: [...FULL_ACCESS, "accountant"],
  },
];

/**
 * Sections this role may reach, derived from the registry.
 *
 * Replaces the hand-maintained `ROLE_SECTIONS` map in `Admin.tsx`, whose
 * `owner` and `manager` entries were byte-identical 16-element arrays. Two
 * copies of one list is two chances to be wrong, and nothing compared them.
 */
export function sectionsForRole(role: AdminRole): readonly AdminSection[] {
  return ADMIN_REGISTRY.filter((s) => s.allowedRoles.includes(role)).map((s) => s.id);
}

/**
 * The sidebar, grouped and ordered — the ONLY place sidebar shape is decided.
 *
 * Groups render in `ADMIN_NAV_GROUPS` order; sections sort by `priority` within
 * a group, falling back to registry order on a tie. A group whose sections are
 * all filtered out for this role is dropped, so a role never sees an empty
 * heading.
 */
export function getSidebarGroups(role: AdminRole): NavGroup[] {
  return ADMIN_NAV_GROUPS.map((group) => ({
    label: group,
    items: ADMIN_REGISTRY.filter(
      (s) => s.showInSidebar && s.group === group && s.allowedRoles.includes(role),
    )
      .sort((a, b) => a.priority - b.priority)
      .map((s) => ({ id: s.id, label: s.label, icon: s.icon })),
  })).filter((g) => g.items.length > 0);
}

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

export interface InitialSectionResolution {
  section: AdminSection;
  /**
   * The raw `?tab=` / `?section=` slug when it matched no id, alias or compound
   * redirect — otherwise null. Note that NO slug at all resolves to `overview`
   * with `unresolvedSlug: null`: landing on Today from a bare `/admin` is the
   * correct outcome, not a failure, and must not raise a notice.
   */
  unresolvedSlug: string | null;
}

export function resolveInitialSection(): InitialSectionResolution {
  if (typeof window === "undefined") return { section: "overview", unresolvedSlug: null };
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("tab") || params.get("section") || "").toLowerCase().trim();
  if (!raw) return { section: "overview", unresolvedSlug: null };

  if (raw in COMPOUND_REDIRECTS) {
    const r = COMPOUND_REDIRECTS[raw];
    params.set("tab", r.section);
    params.set(r.innerKey, r.innerValue);
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.history.replaceState({}, "", url.toString());
    return { section: r.section, unresolvedSlug: null };
  }

  const resolved = resolveSection(raw);
  if (!resolved) {
    // The `admin:navigate-section` listener below has warned on an unknown slug
    // since it was written; this URL path stayed silent and returned `overview`,
    // so a mistyped, renamed or stale deep link was indistinguishable from the
    // operator simply opening Today. That is the all-clear-on-failure shape this
    // admin has been pulling out elsewhere — a bad link now says it is bad.
    console.warn("[admin] unknown ?tab= slug, falling back to Today:", raw);
    return { section: "overview", unresolvedSlug: raw };
  }
  return { section: resolved, unresolvedSlug: null };
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
  const [initial] = useState(resolveInitialSection);
  const [section, setSectionState] = useState<AdminSection>(initial.section);
  const [unresolvedSlug, setUnresolvedSlug] = useState<string | null>(initial.unresolvedSlug);

  /**
   * Every deliberate navigation answers the bad-link notice, so it cannot outlive
   * the moment it describes. Kept value-only (never a functional updater) because
   * every call site passes a section id directly.
   */
  const setSection = useCallback((next: AdminSection) => {
    setUnresolvedSlug(null);
    setSectionState(next);
  }, []);
  const dismissUnresolvedSlug = useCallback(() => setUnresolvedSlug(null), []);

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
      const raw = (params.get("tab") || params.get("section") || "").toLowerCase().trim();
      // No slug is the legitimate "went back to bare /admin" case, not a failure.
      if (!raw) {
        setSection("overview");
        return;
      }
      const resolved = resolveSection(raw);
      if (!resolved) {
        // Same honesty as the initial-load path: history can carry a slug that has
        // since been renamed away, and landing on Today without saying so hides it.
        // setSectionState/setUnresolvedSlug directly, because the setSection wrapper
        // clears the very notice being raised here.
        console.warn("[admin] unknown ?tab= slug on history navigation, falling back to Today:", raw);
        setSectionState("overview");
        setUnresolvedSlug(raw);
        return;
      }
      setSection(resolved);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setSection]);

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
  }, [setSection]);

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
  }, [setSection]);

  return { section, setSection, unresolvedSlug, dismissUnresolvedSlug };
}
