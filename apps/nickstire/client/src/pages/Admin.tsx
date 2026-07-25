import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import ActivityPulse from "@/components/admin/ActivityPulse";
import AdminMfaGate from "@/components/admin/AdminMfaGate";
import { AdminSSEProvider, useAdminSSE } from "@/components/admin/AdminSSEContext";
import { GbpOAuthCatcher } from "./admin/content/GbpOAuthCatcher";
import { CommandSearch } from "@/components/admin/CommandSearch";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import DegradedDataBanner from "@/components/admin/DegradedDataBanner";
import DensityToggle from "@/components/admin/DensityToggle";
import DrilldownDrawer from "@/components/admin/DrilldownDrawer";
import ThemeToggle from "@/components/admin/ThemeToggle";
import WalkInQuoteDrawer from "@/components/admin/WalkInQuoteDrawer";
import { getAdminActionableCounts, type AdminActionableCounts } from "@/lib/adminActionableCounts";
import { trpc } from "@/lib/trpc";
import type { AdminRole } from "@shared/adminPermissions";
import {
  ArrowLeft,
  ChevronRight,
  Clapperboard,
  Images,
  Loader2,
  Megaphone,
  Menu,
  Shield,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { SectionContent, useAdminNavigation } from "./admin/registry";
import {
  type AdminSection,
  NAV_GROUPS,
  SECTION_TITLES,
  openCustomerDrawer,
} from "./admin/shared";

interface TopbarAction {
  href: string;
  title: string;
  icon: React.ReactNode;
  mobileHidden: boolean;
  sectionTrigger?: AdminSection;
}

const TOPBAR_ACTIONS: TopbarAction[] = [
  { href: "/admin?tab=content", title: "AI Content", icon: <Sparkles className="w-4 h-4" />, mobileHidden: false, sectionTrigger: "content" },
  { href: "/admin/ig-studio", title: "IG Carousel Studio", icon: <Images className="w-4 h-4" />, mobileHidden: true },
  { href: "/admin/reel-studio", title: "Reel Studio", icon: <Clapperboard className="w-4 h-4" />, mobileHidden: true },
  { href: "/admin/ad-studio", title: "Ad Studio", icon: <Megaphone className="w-4 h-4" />, mobileHidden: true },
];

const ROLE_SECTIONS: Record<AdminRole, readonly AdminSection[]> = {
  owner: ["overview", "intelligence", "customers", "leads", "tireOrders", "growth", "instagram", "campaigns", "memberships", "voiceReceptionist", "opsHub", "settings", "revenue", "callTrackingView", "trafficFunnel", "content"],
  manager: ["overview", "intelligence", "customers", "leads", "tireOrders", "growth", "instagram", "campaigns", "memberships", "voiceReceptionist", "opsHub", "settings", "revenue", "callTrackingView", "trafficFunnel", "content"],
  front_desk: ["overview", "customers", "leads", "tireOrders", "voiceReceptionist", "callTrackingView"],
  tech: ["overview", "customers", "tireOrders"],
  accountant: ["overview", "revenue", "memberships", "opsHub", "trafficFunnel"],
  viewer: ["overview", "intelligence", "opsHub"],
};

/**
 * `ops` is the publishing side of the business — held reels, ambiguous publishes.
 * It was absent from this function entirely, which is the mechanical reason three
 * reels could sit blocked for 32 hours with a silent sidebar: the badge pipeline
 * was built around the SALES funnel (bookings/leads/callbacks) and the publishing
 * system grew later without ever joining it.
 *
 * It lands on BOTH "overview" and "growth": overview is where the operator starts,
 * growth is where Instagram lives, and a signal that only appears once you have
 * already navigated to the right place is not a signal.
 */
/**
 * `null` means WE COULD NOT COUNT — it is not zero, and it must not render as a
 * missing badge.
 *
 * operationsSignal returns `unknown: true` when a count failed, and its own
 * docblock says: "Callers must render that as 'unable to determine', never as
 * zero: a failed query showing 0 is a green light the system never gave." This
 * function is that only caller, and it used to do `opsSignal?.total ?? 0` —
 * so a database the sidebar could not reach looked exactly like a clean shop.
 * Three reels once sat held for 32 hours behind a silent sidebar; this is the
 * same silence arriving by a different route.
 */
function getBadgeCount(
  id: string,
  stats: any,
  counts: AdminActionableCounts,
  opsTotal: number | null,
): number | null {
  if (id === "overview") return opsTotal === null ? null : counts.total + opsTotal;
  if (id === "instagram") return opsTotal;
  if (id === "leads") return counts.newLeads;
  if (id === "tireOrders") return stats?.tires?.new ?? 0;
  if (id === "memberships") return stats?.memberships?.warning ?? 0;
  return 0;
}

export default function Admin() {
  const { user, loading: authLoading, error: authError } = useAuth();
  const { section, setSection } = useAdminNavigation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isAdmin = !!user && user.role === "admin";
  const utils = trpc.useUtils();

  const { data: security, isLoading: securityLoading } = trpc.adminSecurity.status.useQuery(undefined, {
    enabled: isAdmin,
    staleTime: 30_000,
  });
  /**
   * "READY TO LOAD ADMIN DATA" — not "has completed MFA".
   *
   * This required mfaEnabled === true unconditionally. But the server reports
   * `mfaEnabled: false, mfaVerified: true` when enforcement is OFF
   * (adminSecurity.ts:33-39), and ADMIN_MFA_REQUIRED is unset in production — so
   * `adminReady` has been FALSE for every admin session, permanently.
   *
   * What that silently disabled, all of it live:
   *   :117  the overview bundle (stats, bookings, leads, callbacks, health)
   *   :123  shop-floor work orders
   *   :247  <AdminSSEProvider enabled> — every real-time lead / booking /
   *         callback / invoice / payment / work-order / review invalidation
   *
   * The admin still LOOKED functional because individual sections fetch their
   * own data, which is exactly why this survived: the shell was half-connected
   * and nothing said so.
   *
   * The question this flag answers is whether the operator has cleared whatever
   * bar the SERVER is currently enforcing. When MFA is not required, the bar is
   * simply being an admin — so mfaRequired is the discriminator, not mfaEnabled.
   * `!!security` is required too: undefined means the status has not loaded, and
   * loading is not permission.
   */
  const adminReady =
    isAdmin && !!security && (!security.mfaRequired || (security.mfaEnabled === true && security.mfaVerified === true));

  const { data: bundle, isError: overviewUnavailable, error: overviewError } =
    trpc.adminDashboard.overviewMediumBundle.useQuery(undefined, {
      enabled: adminReady,
      refetchInterval: 30_000,
      staleTime: 25_000,
      refetchIntervalInBackground: false,
    });
  const { data: woStats } = trpc.nourOsBridge.shopFloor.useQuery(undefined, {
    enabled: adminReady,
    refetchInterval: 30_000,
    staleTime: 25_000,
    refetchIntervalInBackground: false,
  });

  const stats = bundle?.stats ?? null;
  const actionableCounts = getAdminActionableCounts({
    bookings: bundle?.bookings,
    leads: bundle?.leads,
    callbacks: bundle?.callbacks,
  });
  // Count-only, cheap by construction — see contentAdmin.operationsSignal. It
  // must never call the artifact-probing query: this runs on every page load.
  const { data: opsSignal, isError: opsFailed } = trpc.contentAdmin.operationsSignal.useQuery(undefined, {
    enabled: isAdmin,
    refetchInterval: 120_000,
    staleTime: 90_000,
    refetchIntervalInBackground: false,
  });
  // Three states, not two: a number, "still loading", and "we could not tell".
  // Only the first is a count. `undefined` while the first fetch is in flight is
  // genuinely nothing-to-show; a transport error or a server-side `unknown` is a
  // fact the operator needs, so it becomes null and renders as "?".
  const opsTotal: number | null =
    opsFailed || opsSignal?.unknown ? null : (opsSignal?.total ?? 0);

  const adminRole = (security?.adminRole ?? "viewer") as AdminRole;
  const allowedSections = ROLE_SECTIONS[adminRole];
  const visibleGroups = useMemo(
    () => NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => allowedSections.includes(item.id)) })).filter((group) => group.items.length > 0),
    [allowedSections],
  );

  useEffect(() => {
    if (security && !allowedSections.includes(section)) setSection(allowedSections[0] ?? "overview");
  }, [allowedSections, section, security, setSection]);

  if (authLoading || (isAdmin && securityLoading)) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary/60" /></div>;
  }

  /*
    "WE COULD NOT CHECK" IS NOT "YOU ARE NOT SIGNED IN".

    useAuth maps a FAILED auth.me to `user: null`, and this screen only tested
    `!user` — so any error on that one query rendered as a definitive "you are
    signed out", and the only offered action was to sign in again.

    That is exactly what happened on 2026-07-20. /api/trpc carried a 100-per-15-
    minutes anti-spam limit, the console's own polling spends ~540 in that window,
    so auth.me started returning 429. The operator signed in with Google, landed
    back on this screen, signed in again, and looped — because the session was
    never the problem and signing in could never have fixed it.

    The rate limit is fixed at the source (middleware/rateLimiters.ts), but the
    misreporting is a separate defect and outlives that one cause: a network blip,
    a cold start or a deploy would all have read as "signed out".
  */
  if (!user && authError) {
    const rateLimited = /too many requests|429/i.test(authError.message ?? "");
    return (
      <main id="main-content" className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-14 h-14 bg-amber-500/10 flex items-center justify-center rounded-xl mx-auto mb-6"><Shield className="w-7 h-7 text-amber-500" /></div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-2">Could not verify your session</h1>
          <p className="text-sm text-muted-foreground mb-2 leading-relaxed">
            This is <strong>unknown</strong>, not signed out — signing in again will not help if the check itself is failing.
          </p>
          <p className="text-xs text-muted-foreground mb-8">
            {rateLimited
              ? "The API is rate-limiting this browser. Wait a minute and retry."
              : authError.message}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => window.location.reload()} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors">Retry</button>
            <a href={getLoginUrl()} className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Sign in again<ChevronRight className="w-4 h-4" /></a>
          </div>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main id="main-content" className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-14 h-14 bg-primary/10 flex items-center justify-center rounded-xl mx-auto mb-6"><Shield className="w-7 h-7 text-primary" /></div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-2">Admin Access</h1>
          <p className="text-sm text-muted-foreground mb-8 leading-relaxed">Sign in with your admin account to manage operations.</p>
          <a href={getLoginUrl()} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors">Sign In<ChevronRight className="w-4 h-4" /></a>
        </div>
      </main>
    );
  }

  if (user.role !== "admin") {
    return (
      <main id="main-content" className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-14 h-14 bg-destructive/10 flex items-center justify-center rounded-xl mx-auto mb-6"><XCircle className="w-7 h-7 text-destructive" /></div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-2">Access Denied</h1>
          <p className="text-sm text-muted-foreground mb-8">You do not have admin privileges.</p>
          <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"><ArrowLeft className="w-4 h-4" />Back to site</Link>
        </div>
      </main>
    );
  }

  // The TOTP wall renders only when the server enforces it
  // (ADMIN_MFA_REQUIRED=1). Default is Google sign-in alone — operator
  // decision 2026-07-16; see isAdminMfaRequired in services/adminSecurity.
  if (security?.mfaRequired && (!security.mfaEnabled || !security.mfaVerified)) {
    return (
      <AdminMfaGate
        enabled={security.mfaEnabled}
        verified={security.mfaVerified}
        accountLabel={user.email || user.name || "admin"}
        onVerified={() => utils.adminSecurity.status.invalidate()}
      />
    );
  }

  return (
    <AdminSSEProvider enabled={adminReady}>
      <AdminSSEListeners />
      {/* Shell-level: Google's OAuth redirect can land on ANY tab, so the
          code exchange cannot live inside the GBP sub-tab component. */}
      <GbpOAuthCatcher />
      <div className="admin-shell min-h-screen bg-background flex">
        {sidebarOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}
        <aside className={`admin-sidebar fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen w-[260px] flex flex-col transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`} aria-label="Admin navigation">
          <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0">
            <Link href="/" className="flex items-center gap-2.5 group flex-1 min-w-0"><div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden /><div className="flex flex-col min-w-0"><span className="font-semibold text-foreground text-[13.5px] leading-tight tracking-tight group-hover:text-primary transition-colors truncate">Nick&apos;s Admin</span><span className="text-[10px] text-muted-foreground/70 tracking-[0.06em]">{adminRole.replace("_", " ")}</span></div></Link>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-muted-foreground/60 hover:text-foreground p-1.5 rounded-md" aria-label="Close sidebar"><X className="w-4 h-4" /></button>
          </div>
          <nav className="flex-1 py-4 px-2 space-y-5 overflow-y-auto" aria-label="Admin sections">
            {visibleGroups.map((group) => <div key={group.label || "_flat"}>{group.label && <div className="admin-sidebar-group-label">{group.label}</div>}<div className="space-y-0.5 mt-0.5">{group.items.map((item) => {
              const isActive = section === item.id;
              const badge = getBadgeCount(item.id, stats, actionableCounts, opsTotal);
              return <button key={item.id} onClick={() => { setSection(item.id); setSidebarOpen(false); }} aria-current={isActive ? "page" : undefined} className={`admin-sidebar-item w-full ${isActive ? "active" : ""}`}><span className={`shrink-0 ${isActive ? "text-primary" : "text-foreground/45"}`}>{item.icon}</span><span className="flex-1 text-left truncate">{item.label}</span>{badge === null ? <span className="shrink-0 text-[10px] font-semibold min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center" title="Could not read outstanding work — this is unknown, not zero" aria-label="outstanding work unknown">?</span> : badge > 0 ? <span className="shrink-0 text-[10px] font-semibold tabular-nums min-w-[18px] h-[18px] px-1 rounded-full bg-destructive/12 text-destructive flex items-center justify-center">{badge > 99 ? "99+" : badge}</span> : null}</button>;
            })}</div></div>)}
          </nav>
          <div className="px-3 py-3 border-t border-sidebar-border shrink-0 space-y-2"><div className="px-2"><p className="text-[12px] font-medium text-foreground truncate">{user.name || "Admin"}</p><p className="text-[10px] text-muted-foreground/70">{adminRole.replace("_", " ")}</p></div><Link href="/" className="px-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"><ArrowLeft className="w-3 h-3" />Back to site</Link></div>
        </aside>
        <main id="main-content" className="flex-1 min-w-0">
          <header className="admin-topbar sticky top-0 z-30 flex items-center px-3 lg:px-5 gap-1 pt-[env(safe-area-inset-top,0px)]">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden inline-flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground" aria-label="Open sidebar"><Menu className="w-4 h-4" /></button>
            <h1 className="text-[14px] font-semibold text-foreground tracking-tight px-2 truncate">{SECTION_TITLES[section]}</h1><div className="flex-1" />
            <CommandSearch onNavigate={(nextSection) => allowedSections.includes(nextSection) && setSection(nextSection)} onSelectCustomer={(id) => openCustomerDrawer(id)} />
            <DensityToggle /><ThemeToggle />
            {TOPBAR_ACTIONS.filter((action) => !action.sectionTrigger || allowedSections.includes(action.sectionTrigger)).map((action) => <Link key={action.href} href={action.href} title={action.title} aria-label={action.title} onClick={(event) => { if (action.sectionTrigger) { event.preventDefault(); window.history.replaceState({}, "", action.href); setSection(action.sectionTrigger); } }} className={`${action.mobileHidden ? "hidden lg:inline-flex" : "inline-flex"} items-center justify-center w-9 h-9 text-muted-foreground hover:text-primary`}>{action.icon}</Link>)}
          </header>
          <div className="admin-content"><div className="px-4 pt-4 space-y-3"><DegradedDataBanner stats={stats} unavailable={overviewUnavailable} unavailableMessage={overviewError?.message} /></div><SectionContent section={section} /></div>
        </main>
        <DrilldownDrawer /><ConfirmDialog /><WalkInQuoteDrawer /><ActivityPulse />
      </div>
    </AdminSSEProvider>
  );
}

function AdminSSEListeners() {
  const utils = trpc.useUtils();
  const eventSource = useAdminSSE();
  useEffect(() => {
    if (!eventSource) return;
    const overview = () => { utils.adminDashboard.overviewMediumBundle.invalidate(); utils.adminDashboard.stats.invalidate(); };
    const leads = () => { overview(); utils.lead.list.invalidate(); utils.nickActions.shopPulse.invalidate(); };
    const bookings = () => { overview(); utils.booking.list.invalidate(); };
    const callbacks = () => { overview(); utils.callback.list.invalidate(); };
    const money = () => { overview(); utils.nickActions.shopPulse.invalidate(); utils.nourOsBridge.shopFloor.invalidate(); };
    const handlers: Array<[string, () => void]> = [
      ["message", overview],
      ["lead_captured", () => { leads(); toast.info("New lead captured"); }],
      ["booking_created", () => { bookings(); toast.info("New booking"); }],
      ["callback_requested", () => { callbacks(); toast.info("Callback requested"); }],
      ["invoice_created", () => { money(); toast.info("Invoice created"); }],
      ["invoice_paid", () => { money(); toast.success("Payment received"); }],
      ["payment_received", () => { money(); toast.success("Payment received"); }],
      ["work_order_updated", money],
      ["work_order_created", () => { money(); toast.info("New work order created"); }],
      ["tire_order_placed", overview],
      ["emergency_request", () => { overview(); toast.error("EMERGENCY request!"); }],
      ["review_detected", () => { utils.adminDashboard.stats.invalidate(); utils.customers.campaignStats.invalidate(); toast.info("New review detected"); }],
    ];
    for (const [type, handler] of handlers) eventSource.addEventListener(type, handler);
    return () => { for (const [type, handler] of handlers) eventSource.removeEventListener(type, handler); };
  }, [eventSource, utils]);
  return null;
}
