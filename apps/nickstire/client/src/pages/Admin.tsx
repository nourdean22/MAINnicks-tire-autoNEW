/**
 * ADMIN DASHBOARD — Premium shell with CEO-level polish.
 * Each section lives in client/src/pages/admin/<SectionName>.tsx
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useState, useEffect } from "react";
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

import { useAdminNavigation, SectionContent, resolveSection } from "./admin/registry";

// BADGE_CONFIG mapping
const getBadgeCount = (
  id: string,
  stats: any,
  pendingCallbacks: number,
  woStats: any,
  newLeads: number,
  urgentLeads: number,
  newBookings: number
): number => {
  if (id === "overview") return urgentLeads + newLeads + newBookings + pendingCallbacks;
  if (id === "leads") return newLeads;
  if (id === "tireOrders") return stats?.tires?.new ?? 0;
  if (id === "memberships") return stats?.memberships?.warning ?? 0;
  return 0;
};

// Topbar actions configuration driven by viewport visibility rules
interface TopbarAction {
  href: string;
  title: string;
  icon: React.ReactNode;
  mobileHidden: boolean;
  sectionTrigger?: string;
}

const TOPBAR_ACTIONS: TopbarAction[] = [
  {
    href: "/admin?tab=content",
    title: "AI Content",
    icon: <Sparkles className="w-4 h-4" />,
    mobileHidden: false,
    sectionTrigger: "content",
  },
  {
    href: "/admin/ig-studio",
    title: "IG Carousel Studio",
    icon: <Images className="w-4 h-4" />,
    mobileHidden: true,
  },
  {
    href: "/admin/reel-studio",
    title: "Reel Studio",
    icon: <Clapperboard className="w-4 h-4" />,
    mobileHidden: true,
  },
  {
    href: "/admin/ad-studio",
    title: "Ad Studio",
    icon: <Megaphone className="w-4 h-4" />,
    mobileHidden: true,
  },
];

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const { section, setSection } = useAdminNavigation();
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
                  const badge = getBadgeCount(
                    item.id,
                    stats,
                    pendingCallbacks,
                    woStats,
                    newLeads,
                    urgentLeads,
                    newBookings
                  );

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
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-foreground/3 hover:bg-foreground/6 border border-border/30 hover:border-border/50 transition-colors text-left"
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
            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/4 border border-border/20 hover:border-border/40 transition-colors"
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
          {TOPBAR_ACTIONS.map((act) => (
            <Link
              key={act.href}
              href={act.href}
              title={act.title}
              aria-label={act.title}
              className={`${
                act.mobileHidden ? "hidden lg:inline-flex" : "inline-flex"
              } items-center justify-center w-9 h-9 hover:text-primary hover:bg-foreground/5 rounded-md transition-colors ${
                act.sectionTrigger && section === act.sectionTrigger
                  ? "text-primary bg-foreground/5"
                  : "text-muted-foreground"
              }`}
            >
              {act.icon}
            </Link>
          ))}
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
