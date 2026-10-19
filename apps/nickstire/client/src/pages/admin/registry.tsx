import React, { lazy, Suspense, useState, useEffect, useCallback } from "react";
import { Clapperboard, ClipboardList, Disc, DollarSign, Images, Instagram, LayoutDashboard, Megaphone, ParkingSquare, PhoneCall, Send, Settings, Sparkles, TrendingUp, UserCheck } from "lucide-react";
import type { AdminSection, NavGroup, RetiredAdminSection } from "./shared/types";
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
const ApprovalsSection = lazy(() => import("./ApprovalsSection"));
const InstagramSection = lazy(() => import("./instagram/InstagramAdmin").then((m) => ({ default: m.InstagramAdmin })));
const LeadsSection = lazy(() => import("./LeadsSection"));
const ContentSection = lazy(() => import("./ContentSection"));
const CustomersSection = lazy(() => import("./CustomersSection"));
const SettingsSection = lazy(() => import("./SettingsSection"));
const RevenueSection = lazy(() => import("./RevenueSection"));
const CampaignsSection = lazy(() => import("./OutreachHubSection"));
const TireOrdersSection = lazy(() => import("./TireOrdersSection"));
const OpsHubSection = lazy(() => import("./OpsHubSection"));
const VoiceReceptionistSection = lazy(() => import("./VoiceReceptionistSection"));
const LotSection = lazy(() => import("./LotSection"));
const ShopMediaSection = lazy(() => import("./ShopMediaSection"));

export const ADMIN_REGISTRY: RegistrySection[] = [
  {
    // 2026-09-09 · Camera visit truth. Shop operations belong in the shop's own
    // admin (ADR-0017 product boundary); StateNour gets owner summaries, not the
    // operational cockpit. Every card is driven by a discriminated `{ ok }`
    // result so a failed read renders as an explicit error, never as "0 cars".
    id: "lot",
    label: "Lot",
    icon: <ParkingSquare className="w-4 h-4" />,
    component: LotSection,
    aliases: ["cameras", "camera", "vehicles", "parking", "bays", "visits", "shopsign"],
    keywords: ["lot", "camera", "vehicle", "bay", "waiting", "arrival", "plate"],
    group: "Daily",
    priority: 12,
    showInSidebar: true,
    // NOT ADMIN_ROLES. This surface carries plate text, a customer link and who is
    // physically on the property; every other identity-bearing Daily section is
    // narrower too (`customers` excludes viewer/accountant, `revenue` excludes tech).
    // The server is the real gate -- `lot.*` resolves to settings.manage in
    // shared/adminPermissions.ts -- and this keeps the sidebar honest about it.
    allowedRoles: FULL_ACCESS,
  },
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
    // Trust ladder (2026-08-12): every AI- or one-tap-originated action lands
    // here as a draft and executes only on human approval — server-enforced in
    // services/proposals.ts. Palette + sidebar visibility come free from this
    // entry; keywords make "approve"/"queue"/"nick" land here from Cmd+K.
    id: "approvals",
    label: "Approvals",
    icon: <ClipboardList className="w-4 h-4" />,
    component: ApprovalsSection,
    aliases: ["proposals", "queue", "decide", "drafts"],
    keywords: ["approval", "approve", "proposal", "queue", "review", "draft", "nick", "decide"],
    group: "Daily",
    priority: 15,
    showInSidebar: true,
    allowedRoles: FULL_ACCESS,
  },
  {
    id: "customers",
    label: "Customers",
    icon: <UserCheck className="w-4 h-4" />,
    component: CustomersSection,
    aliases: ["referrals", "jobs", "loyalty", "warranty", "waitlist"],
    keywords: ["customer", "client", "database", "lookup", "loyalty", "winback", "referral", "membership", "nonstop", "call list"],
    group: "Daily",
    priority: 20,
    showInSidebar: true,
    // accountant added 2026-10-19 with Nonstop Nick moving in as the Members tab
    // (memberships admitted accountant). innerTabs.ts shows accountant ONLY that
    // tab; the customer list and call list stay owner/manager/front_desk/tech.
    allowedRoles: [...FULL_ACCESS, "front_desk", "tech", "accountant"],
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
    id: "content",
    /**
     * "Content & AI" read as a second, generic Instagram composer sitting beside
     * the Instagram section — the operator's own words were "which internal
     * system do you want to use?". It is nothing of the kind. Its nine
     * sub-surfaces are Articles, Notifications, AI Generator, GBP Posts, Command
     * Queue, Generation Log, Specials and Prompt Health: the OWNED properties —
     * nickstire.org/blog, the site notification ticker, Google Business Profile,
     * coupons — plus an AI-safety eval harness. It generates no Instagram posts
     * and shares no procedure, generator or table with the Instagram composer.
     *
     * So the collision was in the WORD "content", not in the function. Renamed to
     * name the job. `id` and every alias are unchanged, so deep links, the
     * command palette and ?tab=content all keep working.
     */
    label: "Website & Local",
    icon: <Sparkles className="w-4 h-4" />,
    component: ContentSection,
    // "gbp" is deliberately NOT here: the `growth` section already claims that
    // alias, and admin-registry-integrity.test.ts enforces one owner per alias.
    // Adding it broke that pre-existing test — caught by self-audit, not by me,
    // because I had only been running server/*.test.ts and never
    // client/src/__tests__/.
    aliases: ["content", "content-and-ai", "website", "specials", "coupons", "qa", "seoengine", "blog"],
    keywords: ["website", "blog", "article", "notification", "gbp", "google business", "seo", "specials", "coupons", "prompt health", "content"],
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
    // 2026-10-18 · review gate for the imported shop photo/video library. Imports land
    // quarantined with reuse off; nothing reaches a post or a reel until approved here.
    // OWNER ONLY, deliberately: shopMedia.review is not mapped in
    // permissionForAdminProcedure, so the mutation fails closed to security.manage
    // (owner). Granting manager here would show a door whose every review is FORBIDDEN,
    // the trafficFunnel failure adminRegistryTruth.test.ts records.
    id: "shopMedia",
    label: "Shop media",
    icon: <Images className="w-4 h-4" />,
    component: ShopMediaSection,
    aliases: ["shopmedia", "shop-media", "media", "photos", "videos", "library"],
    keywords: ["photo", "video", "media", "library", "quarantine", "approve", "footage", "clip"],
    group: "Reach",
    priority: 35,
    showInSidebar: true,
    allowedRoles: ["owner"],
  },
  {
    id: "campaigns",
    // 2026-09-01 (audit, artifact 3 §3): the section holds Campaigns,
    // Follow-Ups, the SMS inbox, review requests, the orchestrator AND
    // win-back. "Winback" named one tab and hid the other five; the label now
    // names the job. `id` and every alias are unchanged, so deep links and
    // ?tab=campaigns keep working.
    label: "Outreach",
    icon: <Send className="w-4 h-4" />,
    component: CampaignsSection,
    // "outreach" added 2026-10-19: the label is Outreach, and useSettingsStatus linked
    // ?tab=outreach for months while it resolved nowhere.
    aliases: ["reengagement", "reengage", "autofollowup", "reviewrequests", "reviews", "winback", "sms", "followups", "outreach"],
    keywords: ["campaign", "outreach", "sms", "email", "review", "follow-up", "re-engage", "winback", "dormant", "inactive"],
    group: "Reach",
    priority: 40,
    showInSidebar: true,
    allowedRoles: FULL_ACCESS,
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

export interface NavTarget {
  section: AdminSection;
  innerKey?: string;
  innerValue?: string;
  /** A legacy inner-tab param whose value, when present, is carried over instead of innerValue. */
  carryKey?: string;
  /** carryKey values that mean a different destination altogether (growthTab=instagram). */
  carryTo?: Record<string, NavTarget>;
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

/**
 * Sections retired 2026-10-19 (job 2026-10-19-admin-prune). Each one now lives
 * as a tab of another section; its old id and every alias it owned land there.
 * The crew opens this admin from home-screen PWAs, so these links outlive the
 * sections. Every inner value must exist in innerTabs.ts (pinned by
 * admin-prune-redirects.test.tsx and admin-registry-integrity.test.ts).
 */
const RETIRED_SECTIONS: { id: RetiredAdminSection; was: string; aliases: string[]; to: NavTarget }[] = [
  {
    id: "opportunities",
    was: "Opportunities",
    aliases: ["decisioninbox", "decisions", "openwork"],
    to: { section: "leads", innerKey: "leadsTab", innerValue: "opportunities" },
  },
  {
    id: "callTrackingView",
    was: "Call Tracking",
    aliases: ["callbacks", "calls", "calltracking", "call-tracking"],
    to: { section: "voiceReceptionist", innerKey: "voiceTab", innerValue: "calls" },
  },
  {
    id: "market",
    was: "Market",
    aliases: ["gsc", "search-console", "searchconsole", "radar", "master-report"],
    to: { section: "opsHub", innerKey: "reportsTab", innerValue: "search" },
  },
  {
    id: "trafficFunnel",
    was: "Traffic to Revenue",
    aliases: ["funnel", "traffic", "traffic-revenue"],
    to: { section: "opsHub", innerKey: "reportsTab", innerValue: "traffic" },
  },
  {
    id: "growth",
    was: "Marketing / Growth",
    aliases: ["gbp", "local", "localseo", "social"],
    to: {
      section: "content",
      innerKey: "contentTab",
      innerValue: "local",
      carryKey: "growthTab",
      // Growth forwarded ?growthTab=instagram to the Instagram section before the merge.
      carryTo: { instagram: { section: "instagram" } },
    },
  },
  {
    id: "memberships",
    was: "Nonstop Nick",
    aliases: ["membership", "member", "nonstop", "subscription"],
    to: { section: "customers", innerKey: "customersTab", innerValue: "members" },
  },
  {
    id: "intelligence",
    was: "Intelligence HQ",
    aliases: ["intell", "intelligencehq"],
    to: { section: "customers", innerKey: "customersTab", innerValue: "calls" },
  },
];

function resolveSection(raw: string): AdminSection | null {
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

/**
 * THE resolver: every way a slug arrives (first URL, back/forward, the
 * admin:navigate-section event, the /admin/* path redirect in App.tsx) goes
 * through here. Before 2026-10-19 only the first URL knew about compound
 * redirects, so a link that worked on load broke on back/forward.
 */
export function resolveNavTarget(raw: string): NavTarget | null {
  const slug = (raw || "").toLowerCase().trim();
  if (!slug) return null;
  if (slug in COMPOUND_REDIRECTS) return COMPOUND_REDIRECTS[slug];
  for (const r of RETIRED_SECTIONS) {
    if (r.id.toLowerCase() === slug || r.aliases.includes(slug)) return r.to;
  }
  const section = resolveSection(slug);
  return section ? { section } : null;
}

/** A target refined by the legacy inner param the URL carries (growthTab=instagram -> Instagram). */
function refineNavTarget(target: NavTarget, params: URLSearchParams): NavTarget {
  const carried = target.carryKey ? params.get(target.carryKey) : null;
  return (carried && target.carryTo?.[carried]) || target;
}

/** The ?query a target lands on, built over `base` (carried params survive). */
export function navTargetSearch(target: NavTarget, base: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base);
  // A leftover customer id (and its profile tab) must never beat a redirect: it
  // would open a customer over the tab the link asked for (review round 1).
  if (target.innerKey || params.get("tab") !== target.section) {
    params.delete("id");
    params.delete("profileTab");
  }
  params.delete("section");
  params.set("tab", target.section);
  if (target.innerKey && target.innerValue) {
    const carried = target.carryKey ? params.get(target.carryKey) : null;
    params.set(target.innerKey, carried || target.innerValue);
    if (target.carryKey) params.delete(target.carryKey);
  }
  return params;
}

/** Writes a target into the address bar (replaceState, no new history entry). */
function writeNavTarget(target: NavTarget): void {
  const url = new URL(window.location.href);
  url.search = navTargetSearch(target, url.searchParams).toString();
  window.history.replaceState(window.history.state, "", url.toString());
  // A mounted section re-reads its inner tab on this (useUrlFilter): a
  // replaceState fires no popstate, and a same-section move does not remount.
  window.dispatchEvent(new Event("admin:url-sync"));
}

export interface InitialSectionResolution {
  section: AdminSection;
  /**
   * The raw `?tab=` / `?section=` slug when it matched no id, alias or redirect,
   * otherwise null. NO slug at all resolves to `overview` with
   * `unresolvedSlug: null`: landing on Today from a bare `/admin` is the
   * correct outcome, not a failure, and must not raise a notice.
   */
  unresolvedSlug: string | null;
}

/** Resolves the current URL, rewriting it when the slug was an alias or a redirect. */
function resolveCurrentUrl(): InitialSectionResolution {
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("tab") || params.get("section") || "").trim();
  if (!raw) return { section: "overview", unresolvedSlug: null };
  const found = resolveNavTarget(raw);
  if (!found) return { section: "overview", unresolvedSlug: raw.toLowerCase() };
  const target = refineNavTarget(found, params);
  if (target.innerKey || raw !== target.section) writeNavTarget(target);
  return { section: target.section, unresolvedSlug: null };
}

export function resolveInitialSection(): InitialSectionResolution {
  if (typeof window === "undefined") return { section: "overview", unresolvedSlug: null };
  const r = resolveCurrentUrl();
  // A mistyped, renamed or stale deep link says it is bad instead of passing
  // for the operator simply opening Today.
  if (r.unresolvedSlug) console.warn("[admin] unknown ?tab= slug, falling back to Today:", r.unresolvedSlug);
  return r;
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
  // Read before resolution rewrites the URL: a role refusal names what was asked for.
  const [initialRaw] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab"),
  );
  const [initial] = useState(resolveInitialSection);
  const [section, setSectionState] = useState<AdminSection>(initial.section);
  const [unresolvedSlug, setUnresolvedSlug] = useState<string | null>(initial.unresolvedSlug);
  // "unknown": no section matches the slug. "role": it matched one this role cannot open.
  const [unresolvedReason, setUnresolvedReason] = useState<"unknown" | "role">("unknown");
  // The slug the latest navigation asked for, so a role refusal can name it.
  const requestedSlug = React.useRef<string | null>(initialRaw);

  /**
   * Every deliberate navigation answers the bad-link notice, so it cannot outlive
   * the moment it describes. Kept value-only (never a functional updater) because
   * every call site passes a section id directly.
   */
  const setSection = useCallback((next: AdminSection) => {
    setUnresolvedSlug(null);
    setUnresolvedReason("unknown");
    requestedSlug.current = next;
    setSectionState(next);
  }, []);
  const dismissUnresolvedSlug = useCallback(() => setUnresolvedSlug(null), []);
  /**
   * The shell found the current section outside the role's list (a viewer opening
   * ?tab=intelligence). Land on `fallback` and say why, instead of a silent Today.
   */
  const denySection = useCallback((fallback: AdminSection) => {
    setUnresolvedSlug(requestedSlug.current);
    setUnresolvedReason("role");
    setSectionState(fallback);
  }, []);

  // Sync tab state to browser URL search params
  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = new URLSearchParams(window.location.search).get("tab");
    if (current === section) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", section);
    window.history.replaceState({}, "", url.toString());
  }, [section]);

  // Sync state on browser back/forward history navigation. Same resolver as
  // the first load, so a retired slug or compound redirect in history lands
  // on its tab too (it used to land only on first load).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      const raw = new URLSearchParams(window.location.search).get("tab");
      const r = resolveCurrentUrl();
      if (r.unresolvedSlug) {
        // setSectionState/setUnresolvedSlug directly, because the setSection
        // wrapper clears the very notice being raised here.
        console.warn("[admin] unknown ?tab= slug on history navigation, falling back to Today:", r.unresolvedSlug);
        setSectionState("overview");
        setUnresolvedSlug(r.unresolvedSlug);
        setUnresolvedReason("unknown");
        return;
      }
      setSection(r.section);
      requestedSlug.current = raw;
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
      const found = resolveNavTarget(detail.section);
      const target = found && refineNavTarget(found, new URLSearchParams(window.location.search));
      if (!target) {
        console.warn("[admin:navigate-section] unknown section slug:", detail.section);
        return;
      }
      if (target.innerKey) writeNavTarget(target);
      setSection(target.section);
      requestedSlug.current = detail.section;
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

  return { section, setSection, unresolvedSlug, unresolvedReason, dismissUnresolvedSlug, denySection };
}
