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
} from "lucide-react";
import {
  AdminSection, NAV_GROUPS, SECTION_TITLES,
} from "./admin/shared";
import { CommandSearch } from "@/components/admin/CommandSearch";
import ThemeToggle from "@/components/admin/ThemeToggle";
import DensityToggle from "@/components/admin/DensityToggle";
import ActivityPulse from "@/components/admin/ActivityPulse";
import WeatherAwareBanner from "@/components/admin/WeatherAwareBanner";
import { CustomerDrawer } from "@/components/admin/CustomerDrawer";
import DrilldownDrawer from "@/components/admin/DrilldownDrawer";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
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
const CommandCenterSection = lazy(() => import("./admin/CommandCenterSection"));
const IntelligenceSection = lazy(() => import("./admin/IntelligenceSection"));
const DeclinedEstimatesSection = lazy(() => import("./admin/DeclinedEstimatesSection"));
// 2026-05-09 — ReEngagementSection no longer rendered as top-level route.
// File still exists; consumed by OutreachHubSection as the 6th tab.
const NoShowRiskSection = lazy(() => import("./admin/NoShowRiskSection"));
const WalkInCalculatorSection = lazy(() => import("./admin/WalkInCalculatorSection"));
const SnapDashboardSection = lazy(() => import("./admin/SnapDashboardSection"));
const TrafficFunnelSection = lazy(() => import("./admin/TrafficFunnelSection"));
const ConversionPreviewSection = lazy(() => import("./admin/ConversionPreviewSection"));
const VoiceReceptionistSection = lazy(() => import("./admin/VoiceReceptionistSection"));
// Settings tab sub-sections — kept because they're consumed INSIDE SettingsSection,
// but not rendered as top-level routes anymore (Settings page handles them).
// AdminContent.tsx still routes here for /admin/content.

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
        {section === "commandCenter" && <CommandCenterSection />}
        {section === "overview" && <OverviewSection />}
        {section === "leads" && <LeadsSection />}
        {section === "content" && <ContentSection />}
        {section === "customers" && <CustomersSection />}
        {section === "campaigns" && <CampaignsSection />}
        {section === "settings" && <SettingsSection />}
        {section === "revenue" && <RevenueSection />}
        {section === "callTrackingView" && <CallTrackingSection />}
        {section === "intelligence" && <IntelligenceSection />}
        {section === "declinedEstimates" && <DeclinedEstimatesSection />}
        {section === "noShowRisk" && <NoShowRiskSection />}
        {section === "walkInCalc" && <WalkInCalculatorSection />}
        {section === "snapDashboard" && <SnapDashboardSection />}
        {section === "trafficFunnel" && <TrafficFunnelSection />}
        {section === "conversionPreview" && <ConversionPreviewSection />}
        {section === "voiceReceptionist" && <VoiceReceptionistSection />}
      </Suspense>
    </AdminSectionBoundary>
  );
}

// Deep-link aliases — human-typed URL params map to real AdminSection names.
// Nour reaches for `?tab=callbacks` but the section is `callTrackingView`;
// rather than rename internals, accept both.
const TAB_ALIASES: Record<string, AdminSection> = {
  // Active aliases
  callbacks: "callTrackingView",
  calls: "callTrackingView",
  calltracking: "callTrackingView",
  dashboard: "overview",
  home: "overview",
  declined: "declinedEstimates",
  funnel: "trafficFunnel",
  traffic: "trafficFunnel",

  // 2026-05-06 Elon-deeper-cut · these 4 sections were removed from the
  // sidebar (TODAY/REVENUE/GROW/TOOLS) but kept reachable via URL.
  // resolveInitialSection() lowercases the param, so the lowercase
  // aliases below ensure direct deep-links keep working.
  walkincalc: "walkInCalc",
  walkin: "walkInCalc",
  quote: "walkInCalc",
  noshowrisk: "noShowRisk",
  noshow: "noShowRisk",
  // 2026-05-09 — Re-engagement absorbed into OutreachHub as 6th tab. All
  // legacy ReEngagement aliases now resolve to OutreachHub (`campaigns`).
  // Operator can drill to the Re-Engage tab via outreachTab=reengage.
  reengagement: "campaigns",
  reengage: "campaigns",
  conversionpreview: "conversionPreview",
  preview: "conversionPreview",

  // Voice Receptionist (VAPI) — wave-86
  voicereceptionist: "voiceReceptionist",
  voice: "voiceReceptionist",
  vapi: "voiceReceptionist",
  receptionist: "voiceReceptionist",

  // Settings sub-tabs (the old standalone sections are now Settings tabs)
  health: "settings",
  sysHealth: "settings",
  compliance: "settings",
  integrations: "settings",
  system: "settings",
  shopdriver: "settings",
  alg: "settings",

  // Deleted sections (2026-04-24 admin audit) — redirect old bookmarks
  // to the closest live section so no one hits a broken deep-link.
  bookings: "overview",
  chats: "overview",
  workorders: "overview",
  wo: "overview",
  "work-orders": "overview",
  dispatch: "overview",
  estimates: "declinedEstimates",
  activity: "overview",
  analytics: "trafficFunnel",
  analyticsview: "trafficFunnel",
  exports: "overview",
  exportview: "overview",
  financing: "snapDashboard",
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
  tireorders: "overview",
  warranty: "customers",
  inventory: "overview",
  waitlist: "customers",
  seoengine: "content",
};

function resolveInitialSection(): AdminSection {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("tab") || params.get("section") || "").toLowerCase().trim();
  if (!raw) return "overview";
  if (raw in TAB_ALIASES) return TAB_ALIASES[raw];
  // Accept exact AdminSection names too (e.g. ?section=workOrders)
  return raw as AdminSection;
}

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [section, setSection] = useState<AdminSection>(resolveInitialSection);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawerCustomerId, setDrawerCustomerId] = useState<number | null>(null);

  // Keep URL in sync with section so deep links + browser back/forward work.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = new URLSearchParams(window.location.search).get("tab");
    if (current === section) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", section);
    window.history.replaceState({}, "", url.toString());
  }, [section]);

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
      if (detail?.section) {
        setSection(detail.section as AdminSection);
        if (typeof window !== "undefined") {
          // Scroll to top so the user sees the destination section
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
    };
    window.addEventListener("admin:navigate-section", handler);
    return () => window.removeEventListener("admin:navigate-section", handler);
  }, []);

  // wave-115 — listen for direct customer-drawer requests fired from any
  // admin surface (at-risk whales row, top-spenders card, NBA actions, etc.)
  // via openCustomerDrawer(id) helper in shared.tsx.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ customerId: number }>).detail;
      if (typeof detail?.customerId === "number") {
        setDrawerCustomerId(detail.customerId);
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
      <div className="admin-shell min-h-screen bg-background flex">
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
            <div key={group.label}>
              <div className="admin-sidebar-group-label">{group.label}</div>
              <div className="space-y-0.5 mt-0.5">
                {group.items.map(item => {
                  const isActive = section === item.id;
                  let badge = 0;
                  // `bookings` is no longer a sidebar entry; urgent + new leads
                  // surface on the `leads` row. Bookings count still appears
                  // on the Overview page itself.
                  if (item.id === "leads") badge = urgentLeads + newLeads + newBookings;
                  if (item.id === "callTrackingView") badge = pendingCallbacks;
                  if (item.id === "revenue") badge = woStats?.active ?? 0;

                  // wave-129b — badge tone semantics:
                  //   leads (red dot)     — urgent / new — high priority
                  //   revenue (red/amber) — overdue/blocked work
                  //   default (subtle)    — work-in-progress count
                  const isAlert = item.id === "leads" || (item.id === "revenue" && (woStats?.overdue || woStats?.blocked));
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
          {/* Quick links */}
          <div className="flex items-center justify-between px-2 pt-1.5 border-t border-border/15">
            <a
              href="https://autonicks.com/chat"
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
            onSelectCustomer={(id) => setDrawerCustomerId(id)}
          />
          <DensityToggle />
          <ThemeToggle />
          <Link
            href="/admin/content"
            title="AI Content"
            aria-label="AI Content"
            className="inline-flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-primary hover:bg-foreground/5 rounded-md transition-colors"
          >
            <Sparkles className="w-4 h-4" />
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

      {/* Customer side drawer */}
      <CustomerDrawer
        customerId={drawerCustomerId}
        onClose={() => setDrawerCustomerId(null)}
        onNavigateToSection={(s) => setSection(s as AdminSection)}
      />

      {/* 2026-05-06 — Global drilldown drawer (event-bus triggered) */}
      <DrilldownDrawer />

      {/* wave-139 — Global brand-consistent confirm dialog (replaces
          window.confirm() which looks broken on mobile) */}
      <ConfirmDialog />

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
