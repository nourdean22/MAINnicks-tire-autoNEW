/**
 * ADMIN DASHBOARD — Premium shell with CEO-level polish.
 * Each section lives in client/src/pages/admin/<SectionName>.tsx
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useState, useEffect, lazy, Suspense } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Loader2, Shield, XCircle, ArrowLeft, Menu, X, Sparkles, ChevronRight,
  Images, Clapperboard, Megaphone,
} from "lucide-react";
import {
  AdminSection, NAV_GROUPS, SECTION_TITLES, openCustomerDrawer,
} from "./admin/shared";
import { CommandSearch } from "@/components/admin/CommandSearch";
import ThemeToggle from "@/components/admin/ThemeToggle";
import DensityToggle from "@/components/admin/DensityToggle";
import ActivityPulse from "@/components/admin/ActivityPulse";
import WeatherAwareBanner from "@/components/admin/WeatherAwareBanner";
import DrilldownDrawer from "@/components/admin/DrilldownDrawer";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import WalkInQuoteDrawer from "@/components/admin/WalkInQuoteDrawer";
import { AdminSSEProvider, useAdminSSE } from "@/components/admin/AdminSSEContext";
import AdminSectionBoundary from "@/components/admin/AdminSectionBoundary";

// Lazy-load each section for code splitting.
// Post-audit (2026-04-24): removed 27 dead/redundant sections that had
// empty DB tables or overlapped with consolidated pages. See commit log.
const OverviewSection = lazy(() => import("./admin/OverviewSection"));
const LeadsSection = lazy(() => import("./admin/LeadsSection"));
const ContentSection = lazy(() => import("./admin/ContentSection"));
const CustomersSection = lazy(() => import("./admin/CustomersSection"));
const SettingsSection = lazy(() => import("./admin/SettingsSection"));
const RevenueSection = lazy(() => import("./admin/RevenueSection"));
const CallTrackingSection = lazy(() => import("./admin/CallTrackingSection"));
const CampaignsSection = lazy(() => import("./admin/OutreachHubSection"));
const MembershipsSection = lazy(() => import("./admin/MembershipsSection"));
const TireOrdersSection = lazy(() => import("./admin/TireOrdersSection"));
// 2026-06-10 danger-zone-safe-build · Ops Hub: reports corpus, owner
// action registry, and PREVIEW-ONLY customer message templates. Read-only.
const OpsHubSection = lazy(() => import("./admin/OpsHubSection"));
// 2026-06-10 growth-social wiring · Growth: operator surface for the GBP
// local-growth systems + social studios. Read/copy/manual only — nothing
// on it posts, sends, or edits anything outside this app.
const GrowthSection = lazy(() => import("./admin/GrowthSection"));
// wave-181.x Intelligence Dispersal Wave 3 (2026-05-24) · Intelligence-
// Section retired entirely. Signals are dispersed to canonical surfaces:
// statenour /scoreboard (Wave 1.5 · NickHealthSection) · the various
// briefs (CustomersBrief / OutreachBrief / LeadsBrief / MoneyBrief /
// VoiceBrief) · and pending statenour /funnel + /brain extensions for
// the remaining signals. See docs/2026-05-24-intelligence-dispersal-plan.md.
// const IntelligenceSection = lazy(() => import("./admin/IntelligenceSection"));
// 2026-05-19 MONEY consolidation · DeclinedEstimatesSection +
// SnapDashboardSection are now tabs inside RevenueSection (the "Money"
// page). Lazy imports moved into RevenueSection.tsx. Old URLs redirect
// via COMPOUND_REDIRECTS in resolveInitialSection below.
// 2026-05-19 · WalkInCalculatorSection is now opened via WalkInQuoteDrawer
// (mounted globally). Lazy import lives in that drawer.
const TrafficFunnelSection = lazy(() => import("./admin/TrafficFunnelSection"));
const VoiceReceptionistSection = lazy(() => import("./admin/VoiceReceptionistSection"));
// Settings tab sub-sections — kept because they're consumed INSIDE SettingsSection,
// but not rendered as top-level routes anymore (Settings page handles them).

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

function SectionContent({ section }: { section: AdminSection }) {
  // 2026-05-05 audit follow-up · per-section ErrorBoundary so one widget's
  // failure (a tRPC error, a render bug, a malformed response) no longer
  // crashes the whole admin to the App-level fallback. The user keeps the
  // navbar + other sections, can retry the failed section in place.
  return (
    <AdminSectionBoundary sectionName={section}>
      <Suspense fallback={<SectionSpinner />}>
        {section === "overview" && <OverviewSection />}
        {section === "leads" && <LeadsSection />}
        {section === "content" && <ContentSection />}
        {section === "customers" && <CustomersSection />}
        {section === "campaigns" && <CampaignsSection />}
        {section === "settings" && <SettingsSection />}
        {section === "revenue" && <RevenueSection />}
        {section === "callTrackingView" && <CallTrackingSection />}
        {/* wave-181.x Wave 3 · intelligence section retired · operator
         * deep-links to ?tab=intelligence are redirected via TAB_ALIASES
         * below to /scoreboard (the canonical replacement). */}
        {section === "trafficFunnel" && <TrafficFunnelSection />}
        {section === "voiceReceptionist" && <VoiceReceptionistSection />}
        {section === "memberships" && <MembershipsSection />}
        {section === "tireOrders" && <TireOrdersSection />}
        {section === "opsHub" && <OpsHubSection />}
        {section === "growth" && <GrowthSection />}
      </Suspense>
    </AdminSectionBoundary>
  );
}

// Deep-link aliases — human-typed URL params map to real AdminSection names.
// Nour reaches for `?tab=callbacks` but the section is `callTrackingView`;
// rather than rename internals, accept both.
//
// 2026-05-19 MONEY consolidation · `declined` / `estimates` / `financing` /
// `snap-finance` / etc. all redirect to `revenue` (the Money page). The
// inner tab (moneyTab=declined / =financing) is set by COMPOUND_REDIRECTS
// in resolveInitialSection so old bookmarks land on the right tab inside
// Money, not just at Money's default Revenue tab.
const TAB_ALIASES: Record<string, AdminSection> = {
  // Active aliases
  callbacks: "callTrackingView",
  calls: "callTrackingView",
  calltracking: "callTrackingView",
  dashboard: "overview",
  home: "overview",
  funnel: "trafficFunnel",
  traffic: "trafficFunnel",
  tires: "tireOrders",
  pipeline: "leads",

  // wave-181.x Wave 3 (2026-05-24) · Intelligence section retired ·
  // operator bookmarks pointing to ?tab=intelligence land on overview
  // instead of a blank pane. Statenour /scoreboard is the canonical
  // home for the synthesized intelligence (see docs/2026-05-24-
  // intelligence-dispersal-plan.md).
  intelligence: "overview",

  // 2026-05-06 Elon-deeper-cut · these sections were removed from the
  // sidebar but kept reachable via URL.
  // 2026-05-19 Elon-cut · noShowRisk + conversionPreview fully deleted.
  // 2026-05-19 · walkInCalc converted to event-bus drawer (no longer a
  // route). Aliases redirect to Leads where the "Walk-In Quote" button
  // is wired to openWalkInQuote() · operator can fire from there or Cmd+K.
  walkincalc: "leads",
  walkin: "leads",
  quote: "leads",
  noshowrisk: "leads", // no-show risk = filter on Leads, not a destination
  noshow: "leads",
  // Re-engagement fully merged · all aliases now land on OutreachHub.
  reengagement: "campaigns",
  reengage: "campaigns",
  conversionpreview: "settings", // was developer sandbox · landed on Settings
  preview: "settings",

  // Voice Receptionist (VAPI) — wave-86
  voicereceptionist: "voiceReceptionist",
  voice: "voiceReceptionist",
  vapi: "voiceReceptionist",
  receptionist: "voiceReceptionist",

  // Settings sub-tabs (the old standalone sections are now Settings tabs)
  health: "settings",
  // 2026-06-10 gap-sweep · alias lookup lowercases the input, so a
  // mixed-case key could never match — staff typing ?tab=sysHealth hit
  // nothing. Lowercased so the alias actually resolves.
  syshealth: "settings",
  compliance: "settings",
  integrations: "settings",
  system: "settings",
  shopdriver: "settings",
  alg: "settings",

  // Hyphenated/spelled-out variants — match the sidebar label words so a
  // human reading "Leads & Estimates" in the sidebar and typing it into
  // the URL still lands on the right page (instead of the blank-panel
  // bug from the bare cast on line 186).
  "leads-and-estimates": "leads",
  "leadsandestimates": "leads",
  "leads-estimates": "leads",
  "call-tracking": "callTrackingView",
  "voice-receptionist": "voiceReceptionist",
  "outreach-hub": "campaigns",
  "outreach": "campaigns",
  "revenue-and-shop": "revenue",
  "money": "revenue",
  "traffic-revenue": "trafficFunnel",
  "content-and-ai": "content",
  // 2026-06-03 · CommandCenterSection (NOUR OS Bridge page) deleted — it was
  // nav-orphaned and wrapped a dead Vercel push (404 DEPLOYMENT_NOT_FOUND).
  // The live cross-ring link is the STATENOUR_SYNC_KEY-gated pull bridge
  // (server/_core/statenour-bridge-routes.ts). Old bookmarks land on Settings
  // (which houses system/health/integrations). The footer already links to
  // bdnick.info for the chat/dashboard, so no NOUR-OS visibility is lost.
  "nour-os-bridge": "settings",
  commandcenter: "settings",
  command: "settings",

  // Deleted sections (2026-04-24 admin audit) — redirect old bookmarks
  // to the closest live section so no one hits a broken deep-link.
  bookings: "overview",
  chats: "overview",
  workorders: "overview",
  wo: "overview",
  "work-orders": "overview",
  dispatch: "overview",
  activity: "overview",
  analytics: "trafficFunnel",
  analyticsview: "trafficFunnel",
  exports: "overview",
  exportview: "overview",
  // 2026-05-09 — All Outreach-style aliases redirect to OutreachHub (`campaigns`)
  // instead of the now-deleted reEngagement standalone route.
  autofollowup: "campaigns",
  reviewrequests: "campaigns",
  reviews: "campaigns",
  winback: "campaigns",
  sms: "campaigns",
  specials: "content",
  coupons: "content",
  qa: "content",
  referrals: "customers",
  jobs: "customers",
  inspections: "overview",
  loyalty: "customers",
  followups: "campaigns",
  tireorders: "tireOrders",
  opshub: "opsHub",
  reports: "opsHub",
  ops: "opsHub",
  // 2026-06-10 · growth-social wiring. NB `reviews` already aliases to
  // "campaigns" (review REQUESTS live in Outreach) — left untouched;
  // review REPLIES are the Growth tab's reviews surface.
  gbp: "growth",
  local: "growth",
  localseo: "growth",
  social: "growth",
  warranty: "customers",
  inventory: "overview",
  waitlist: "customers",
  seoengine: "content",
};

// Canonical set of valid AdminSection slugs — used to reject unknown
// `?tab=` values rather than rendering a blank main panel (the bug
// pre-2026-05-17 was that any unknown slug got cast to AdminSection
// via `as`, then every `section === "..."` check returned false,
// leaving the whole right pane empty).
// wave-181.x Wave 3 · "intelligence" removed from VALID_SECTIONS ·
// TAB_ALIASES redirects ?tab=intelligence to "overview" so legacy
// bookmarks still resolve.
const VALID_SECTIONS: ReadonlySet<AdminSection> = new Set<AdminSection>([
  "overview", "leads", "content", "customers",
  "campaigns", "settings", "revenue", "callTrackingView",
  "trafficFunnel", "voiceReceptionist", "memberships", "tireOrders",
  "opsHub", "growth",
]);

// 2026-05-19 MONEY consolidation · compound redirects for old bookmarks.
// When an operator hits `?tab=declinedEstimates` we want them to land
// on the Money page WITH the Declined tab pre-selected, not Money's
// default Revenue tab. These rewrite the URL params at boot so the
// inner-tab state is correct AND the URL stays clean for bookmarking.
const COMPOUND_REDIRECTS: Record<string, { section: AdminSection; innerKey: string; innerValue: string }> = {
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
 * 2026-05-23 · Single resolver used by every navigation entry point.
 *
 * Pre-fix: boot-time URL resolution honored TAB_ALIASES, but the
 * event-bridge (`admin:navigate-section` handler) and the CustomerDrawer
 * prop callback both did `setSection(raw as AdminSection)` — a bare
 * cast that bypassed aliases entirely. Any legacy slug dispatched at
 * runtime (e.g. `navigateToAdminSection("sms")` from a drawer button)
 * landed on an invalid section, silently blanking the right pane.
 *
 * This function is the chokepoint: every navigation request — URL,
 * event-bus, drawer callback — flows through here. Returns null only
 * when the slug is genuinely unrecognized.
 */
function resolveSection(raw: string): AdminSection | null {
  const slug = (raw || "").toLowerCase().trim();
  if (!slug) return null;
  if (slug in TAB_ALIASES) return TAB_ALIASES[slug];
  for (const valid of VALID_SECTIONS) {
    if (valid.toLowerCase() === slug) return valid;
  }
  return null;
}

function resolveInitialSection(): AdminSection {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("tab") || params.get("section") || "").toLowerCase().trim();
  if (!raw) return "overview";

  // Compound redirect: rewrite URL with the inner tab BEFORE returning the
  // outer section. RevenueSection's useUrlFilter on `moneyTab` picks it up
  // on first render.
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

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [section, setSection] = useState<AdminSection>(resolveInitialSection);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Admin theme -- opt-in "neutral" (Linear/Vercel calm) scoped to .admin-shell.
  // Default "grit" = the live look; zero change until opted in. Preview from a
  // phone via ?adminTheme=neutral (persists to localStorage); revert with =grit.
  const [adminTheme, setAdminTheme] = useState<"grit" | "neutral">(() => {
    if (typeof window === "undefined") return "grit";
    const param = new URLSearchParams(window.location.search).get("adminTheme");
    if (param === "neutral" || param === "grit") {
      window.localStorage.setItem("nickstire.adminTheme", param);
      return param;
    }
    return window.localStorage.getItem("nickstire.adminTheme") === "neutral" ? "neutral" : "grit";
  });

  // Keep URL in sync with section so deep links + browser back/forward work.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = new URLSearchParams(window.location.search).get("tab");
    if (current === section) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", section);
    window.history.replaceState({}, "", url.toString());
  }, [section]);

  // Listen for browser Back/Forward history navigation
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

  const utils = trpc.useUtils();

  const { data: stats } = trpc.adminDashboard.stats.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 30000,
  });

  const { data: callbacks } = trpc.callback.list.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 30000,
  });

  const { data: woStats } = trpc.nourOsBridge.shopFloor.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 30000,
  });

  // v1.7 audit follow-up · SSE listener registration moved into the
  // AdminSSEListeners sub-component below (rendered inside the
  // AdminSSEProvider). The provider owns the single shared EventSource
  // so ActivityPulse can read the same connection — closes the
  // double-SSE bug. Switched from `es.onmessage = ...` to
  // addEventListener("message", ...) so multiple consumers can stack
  // listeners on the shared instance without overwriting.

  // ─── Section-navigation bridge ──────────────────────
  // Any admin component (e.g. OverviewSection rows) can fire this event
  // to jump to another section. Payload: { section, highlightId? }.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { section?: string; highlightId?: number } | undefined;
      if (!detail?.section) return;
      // 2026-05-23 · run the requested slug through TAB_ALIASES before
      // setSection. Bare cast `as AdminSection` was silently blanking
      // the pane whenever a caller dispatched a legacy alias like
      // `"sms"`, `"workorders"`, or `"vapi"`.
      const resolved = resolveSection(detail.section);
      if (!resolved) {
        console.warn("[admin:navigate-section] unknown section slug:", detail.section);
        return;
      }
      setSection(resolved);
      if (typeof window !== "undefined") {
        // Scroll to top so the user sees the destination section
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };
    window.addEventListener("admin:navigate-section", handler);
    return () => window.removeEventListener("admin:navigate-section", handler);
  }, []);

  // wave-115 — listen for direct customer-drawer requests fired from any
  // admin surface (at-risk whales row, top-spenders card, NBA actions, etc.)
  // via openCustomerDrawer(id) helper in shared.tsx. Now redirects to the
  // URL-addressable Customer Profile page instead of a side drawer.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ customerId: number }>).detail;
      if (typeof detail?.customerId === "number") {
        setSection("customers");
        const url = new URL(window.location.href);
        url.searchParams.set("tab", "customers");
        url.searchParams.set("id", String(detail.customerId));
        window.history.pushState({}, "", url.toString());
      }
    };
    window.addEventListener("admin:open-customer-drawer", handler);
    return () => window.removeEventListener("admin:open-customer-drawer", handler);
  }, []);

  // Pending callback count for badge
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC returns any from untyped db
  const pendingCallbacks = (callbacks as any[] | undefined)?.filter(
    (c: any) => c.status === "new" || c.status === "pending"
  ).length ?? 0;

  // ─── AUTH GATE ───────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-14 h-14 bg-primary/10 flex items-center justify-center rounded-xl mx-auto mb-6">
            <Shield className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-2">Admin Access</h1>
          <p className="text-sm text-muted-foreground mb-8 leading-relaxed">Sign in with your admin account to manage operations.</p>
          <a
            href={getLoginUrl()}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors"
          >
            Sign In
            <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  if (user.role !== "admin") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-14 h-14 bg-destructive/10 flex items-center justify-center rounded-xl mx-auto mb-6">
            <XCircle className="w-7 h-7 text-destructive" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-2">Access Denied</h1>
          <p className="text-sm text-muted-foreground mb-8">You do not have admin privileges.</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to site
          </Link>
        </div>
      </div>
    );
  }

  // Badge counts
  const newBookings = stats?.bookings.new ?? 0;
  const urgentLeads = stats?.leads.urgent ?? 0;
  const newLeads = stats?.leads.new ?? 0;

  return (
    <AdminSSEProvider enabled={!!user && user.role === "admin"}>
      <AdminSSEListeners />
      <div className="admin-shell min-h-screen bg-background flex" data-admin-theme={adminTheme}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── SIDEBAR — wave-129b minimalist redo ───
          Header: smaller logo, refined typography, tighter mark.
          Items: thin left accent bar on active (no yellow-on-yellow).
          Badges: small circular dots, never larger than the row.
          Footer: cleaner hierarchy, less visual noise. */}
      <aside className={`admin-sidebar fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen w-[260px] flex flex-col transition-transform duration-200 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      }`}>
        {/* Header — minimalist mark */}
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0">
          <Link href="/" className="flex items-center gap-2.5 group flex-1 min-w-0">
            <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-foreground text-[13.5px] leading-tight tracking-tight group-hover:text-primary transition-colors truncate">Nick's Admin</span>
              <span className="text-[10px] text-muted-foreground/70 tracking-[0.06em]">Management</span>
            </div>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-muted-foreground/60 hover:text-foreground p-1.5 rounded-md transition-colors"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav — Grouped */}
        <nav className="flex-1 py-4 px-2 space-y-5 overflow-y-auto">
          {NAV_GROUPS.map(group => (
            <div key={group.label || "_flat"}>
              {/* 2026-05-19 · empty-label groups render flat (no header).
                  After the 12→5 sidebar reset, there's only one group and
                  the items are their own context. */}
              {group.label && <div className="admin-sidebar-group-label">{group.label}</div>}
              <div className="space-y-0.5 mt-0.5">
                {group.items.map(item => {
                  const isActive = section === item.id;
                  let badge = 0;
                  // 2026-05-19 · Today absorbs the action queue badge (was
                  // split across Leads + Calls). Surfaces total items
                  // needing attention right now.
                  if (item.id === "overview") badge = urgentLeads + newLeads + newBookings + pendingCallbacks;
                  if (item.id === "leads") badge = newLeads;
                  if (item.id === "tireOrders") badge = stats?.tires?.new ?? 0;
                  if (item.id === "memberships") badge = stats?.memberships?.warning ?? 0;

                  // wave-129b — badge tone semantics:
                  //   today (red dot)     — urgent / new — high priority
                  //   memberships (red)   — past due / incomplete
                  //   default (subtle)    — work-in-progress count
                  const isAlert = (item.id === "overview" && badge > 0) || (item.id === "memberships" && badge > 0);
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setSection(item.id); setSidebarOpen(false); }}
                      className={`admin-sidebar-item w-full ${isActive ? "active" : ""}`}
                    >
                      <span className={`shrink-0 ${isActive ? "text-primary" : "text-foreground/45"}`}>{item.icon}</span>
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {badge > 0 && (
                        <span className={`shrink-0 text-[10px] font-semibold tabular-nums leading-none flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full ${
                          isAlert
                            ? "bg-destructive/12 text-destructive ring-1 ring-destructive/20"
                            : "bg-foreground/8 text-foreground/60"
                        } ${item.id === "revenue" && (woStats?.overdue || woStats?.blocked) ? "animate-pulse" : ""}`}>
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer — refined */}
        <div className="px-3 py-3 border-t border-sidebar-border shrink-0 space-y-2.5">
          {/* Live shop pulse — subtler than wave-122 */}
          {woStats && woStats.active > 0 && (
            <button
              onClick={() => { setSection("revenue"); setSidebarOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-border/30 hover:border-border/50 transition-colors text-left"
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${woStats.overdue > 0 ? "bg-red-400 animate-pulse" : woStats.blocked > 0 ? "bg-amber-400" : "bg-emerald-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-foreground tracking-tight">
                  {woStats.active} active · {woStats.inProgress} in bay
                </div>
                <div className="text-[10px] text-muted-foreground/80 tabular-nums">
                  ${Math.round(woStats.totalValueInProgress).toLocaleString()}
                  {woStats.overdue > 0 && <span className="text-red-400 ml-1.5">· {woStats.overdue} overdue</span>}
                </div>
              </div>
            </button>
          )}
          {/* User block */}
          <div className="flex items-center gap-2.5 px-2 pt-1">
            <div className="w-7 h-7 rounded-full bg-foreground/8 flex items-center justify-center shrink-0">
              <span className="font-semibold text-foreground/70 text-[10px]">
                {user.name?.charAt(0)?.toUpperCase() || "A"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-foreground truncate leading-tight">{user.name || "Admin"}</p>
              <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">Administrator</p>
            </div>
          </div>
          {/* Admin theme toggle -- preview the opt-in neutral redesign (Linear/Vercel calm) */}
          <button
            type="button"
            onClick={() =>
              setAdminTheme((t) => {
                const next = t === "neutral" ? "grit" : "neutral";
                if (typeof window !== "undefined") window.localStorage.setItem("nickstire.adminTheme", next);
                return next;
              })
            }
            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/[0.04] border border-border/20 hover:border-border/40 transition-colors"
            title="Toggle admin theme — preview the neutral redesign"
          >
            <span className="text-[11px] text-muted-foreground">Theme</span>
            <span className="text-[10px] font-semibold tracking-wider uppercase text-foreground/70">
              {adminTheme === "neutral" ? "Neutral" : "Grit"}
            </span>
          </button>
          {/* Quick links */}
          <div className="flex items-center justify-between px-2 pt-1.5 border-t border-border/15">
            <a
              href="https://bdnick.info/chat"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-primary/85 hover:text-primary font-medium transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              Ask Nick
            </a>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to site
            </Link>
          </div>
        </div>
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <main className="flex-1 min-w-0">
        {/* Top Bar — wave-130 minimalist: 4 utility buttons normalized to
            ghost icons (h-9), single visual weight, no boxy chrome. */}
        <header className="admin-topbar sticky top-0 z-30 flex items-center px-3 lg:px-5 gap-1">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-foreground/5 rounded-md transition-colors"
            aria-label="Open sidebar"
          >
            <Menu className="w-4 h-4" />
          </button>
          <h1 className="text-[14px] font-semibold text-foreground tracking-tight px-2">
            {SECTION_TITLES[section]}
          </h1>
          <div className="flex-1" />
          <CommandSearch
            onNavigate={(s) => setSection(s)}
            onSelectCustomer={(id) => openCustomerDrawer(id)}
          />
          <DensityToggle />
          <ThemeToggle />
          <Link
            href="/admin?tab=content"
            title="AI Content"
            aria-label="AI Content"
            className={`inline-flex items-center justify-center w-9 h-9 hover:text-primary hover:bg-foreground/5 rounded-md transition-colors ${
              section === "content" ? "text-primary bg-foreground/5" : "text-muted-foreground"
            }`}
          >
            <Sparkles className="w-4 h-4" />
          </Link>
          <Link
            href="/admin/ig-studio"
            title="IG Carousel Studio"
            aria-label="IG Carousel Studio"
            className="inline-flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-primary hover:bg-foreground/5 rounded-md transition-colors"
          >
            <Images className="w-4 h-4" />
          </Link>
          <Link
            href="/admin/reel-studio"
            title="Reel Studio"
            aria-label="Reel Studio"
            className="inline-flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-primary hover:bg-foreground/5 rounded-md transition-colors"
          >
            <Clapperboard className="w-4 h-4" />
          </Link>
          <Link
            href="/admin/ad-studio"
            title="Ad Studio"
            aria-label="Ad Studio"
            className="inline-flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-primary hover:bg-foreground/5 rounded-md transition-colors"
          >
            <Megaphone className="w-4 h-4" />
          </Link>
        </header>

        {/* Section Content */}
        <div className="admin-content">
          {/* Weather-aware nudge — dismissable per-condition per-day */}
          <div className="px-4 pt-4">
            <WeatherAwareBanner />
          </div>
          <SectionContent section={section} />
        </div>
      </main>

      {/* 2026-05-06 — Global drilldown drawer (event-bus triggered) */}
      <DrilldownDrawer />

      {/* wave-139 — Global brand-consistent confirm dialog (replaces
          window.confirm() which looks broken on mobile) */}
      <ConfirmDialog />

      {/* 2026-05-19 · Walk-In Quote drawer (event-bus triggered).
          WalkInCalc was a top-level route; per audit it's a tool not a
          destination. Triggered by openWalkInQuote() from anywhere. */}
      <WalkInQuoteDrawer />

      {/* Live activity pulse — toast stream from SSE */}
      <ActivityPulse />
      </div>
    </AdminSSEProvider>
  );
}

/**
 * v1.7 audit follow-up · sub-component that lives inside AdminSSEProvider
 * and registers the global query-invalidation + toast listeners on the
 * SHARED EventSource. Pre-fix, the registration happened in Admin's
 * top-level useEffect against its OWN private EventSource. ActivityPulse
 * also held its own. Now both attach to one connection.
 */
function AdminSSEListeners() {
  const utils = trpc.useUtils();
  const es = useAdminSSE();

  useEffect(() => {
    if (!es) return;
    const invalidateAll = () => {
      utils.adminDashboard.stats.invalidate();
      utils.callback.list.invalidate();
      utils.booking.list.invalidate();
      utils.lead.list.invalidate();
      utils.nickActions.shopPulse.invalidate();
      utils.customers.campaignStats.invalidate();
      utils.nourOsBridge.shopFloor.invalidate();
    };

    const handlers: Array<[string, (e: Event) => void]> = [
      ["message", () => invalidateAll()],
      ["lead_captured", () => { invalidateAll(); toast.info("New lead captured"); }],
      ["booking_created", () => { invalidateAll(); toast.info("New booking"); }],
      ["tire_order_placed", () => { invalidateAll(); toast.info("Tire order placed"); }],
      ["invoice_created", () => { invalidateAll(); toast.info("Invoice created"); }],
      ["invoice_paid", () => { invalidateAll(); toast.success("Payment received"); }],
      ["payment_received", () => { invalidateAll(); toast.success("Payment received"); }],
      ["emergency_request", () => { invalidateAll(); toast.error("EMERGENCY request!"); }],
      ["callback_requested", () => { invalidateAll(); toast.info("Callback requested"); }],
      ["review_detected", () => { invalidateAll(); toast.info("New review detected"); }],
      ["work_order_updated", () => { invalidateAll(); }],
      ["work_order_created", () => { invalidateAll(); toast.info("New work order created"); }],
    ];

    for (const [type, fn] of handlers) {
      es.addEventListener(type, fn);
    }
    return () => {
      for (const [type, fn] of handlers) {
        es.removeEventListener(type, fn);
      }
    };
  }, [es, utils]);

  return null;
}
