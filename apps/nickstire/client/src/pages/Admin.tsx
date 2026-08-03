import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import ActivityPulse from "@/components/admin/ActivityPulse";
import AdminMfaGate from "@/components/admin/AdminMfaGate";
import { AdminSSEProvider, useAdminSSE } from "@/components/admin/AdminSSEContext";
import { GbpOAuthCatcher } from "./admin/content/GbpOAuthCatcher";
import { CommandSearch } from "@/components/admin/CommandSearch";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import DegradedDataBanner from "@/components/admin/DegradedDataBanner";
import UnknownSectionNotice from "@/components/admin/UnknownSectionNotice";
import DensityToggle from "@/components/admin/DensityToggle";
import DrilldownDrawer from "@/components/admin/DrilldownDrawer";
import ThemeToggle from "@/components/admin/ThemeToggle";
import WalkInQuoteDrawer from "@/components/admin/WalkInQuoteDrawer";
import { getAdminActionableCounts } from "@/lib/adminActionableCounts";
import { buildAdminSignals } from "@/lib/adminSignals";
import { trpc } from "@/lib/trpc";
import { describeBadge, foldSignals, signalsForSection } from "@shared/adminSignal";
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
  getSidebarGroups,
  sectionsForRole,
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

// ROLE_SECTIONS lived here until 2026-08-03. It was a Record<AdminRole, ...>
// whose `owner` and `manager` values were byte-identical 16-element arrays
// maintained by hand — two copies of one list, so every change had to be made
// twice and correctly, and nothing compared them. Role access now comes from
// `allowedRoles` on each registry entry via sectionsForRole(); the sidebar
// comes from getSidebarGroups(). One source, and adminRegistryTruth.test.ts
// fails if a routable section becomes unreachable for owner or manager.

/**
 * getBadgeCount() stood here until 2026-08-03. It was a five-branch switch whose
 * fallback was `return 0` for the other 11 sections — and its own docblock said a
 * count that could not be read "must not render as zero: a failed query showing 0
 * is a green light the system never gave". The doctrine was stated and violated in
 * the same function.
 *
 * It also never received `overviewUnavailable`, so when the overview bundle failed
 * getAdminActionableCounts turned undefined into [] and leads / tireOrders /
 * memberships / overview rendered confident zeros beside the DegradedDataBanner
 * announcing that the data was degraded.
 *
 * Badges now come from buildAdminSignals() + foldSignals(), which carry three
 * states instead of a nullable number: counted (incl. a real 0), unknown ("?"),
 * and not_measured (NO badge — the case `return 0` was faking). See
 * shared/adminSignal.ts for why that third state is the load-bearing one.
 *
 * The publishing signal still lands on BOTH overview and instagram: overview is
 * where the operator starts, and a signal you only see after navigating to the
 * right place is not a signal. Three reels once sat held for 32 hours behind a
 * silent sidebar.
 */

export default function Admin() {
  const { user, loading: authLoading, error: authError } = useAuth();
  const { section, setSection, unresolvedSlug, dismissUnresolvedSlug } = useAdminNavigation();
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
  /**
   * Three states, not two: a number, "still loading", and "we could not tell".
   * Only the first is a count. A transport error or a server-side `unknown` is a
   * fact the operator needs, so it becomes "?" rather than a zero.
   *
   * `overviewUnavailable` is passed in for the same reason and used to be
   * missing: the shell knew the bundle had failed (it renders the
   * DegradedDataBanner from exactly this flag) but never told the badges, so
   * `getAdminActionableCounts` turned undefined into [] and leads / tireOrders /
   * memberships / overview showed confident zeros right beside the banner.
   */
  const signals = useMemo(
    () =>
      buildAdminSignals({
        bundleFailed: overviewUnavailable,
        // Per-SLICE, not per-query. A leads-only failure resolves the tRPC query
        // fine, so `overviewUnavailable` stays false and the banner never fires —
        // adminBundle.ts:85-92 records that exact case rendering a clean queue.
        slices: bundle?.slices,
        counts: actionableCounts,
        stats,
        opsFailed,
        opsUnknown: opsSignal?.unknown === true,
        opsTotal: opsSignal?.total,
        opsVideoProviderBlocked: opsSignal?.videoProviderBlocked,
      }),
    [overviewUnavailable, bundle?.slices, actionableCounts, stats, opsFailed, opsSignal],
  );

  const adminRole = (security?.adminRole ?? "viewer") as AdminRole;
  const allowedSections = useMemo(() => sectionsForRole(adminRole), [adminRole]);
  const visibleGroups = useMemo(() => getSidebarGroups(adminRole), [adminRole]);

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
      {/* min-h-dvh, not min-h-screen. Scoped claim, because the obvious rationale
          is wrong: manifest.json:7 is `display: standalone`, and true iOS standalone
          has no retractable browser chrome, so there 100vh === 100dvh and this
          changes nothing. It bites in the cases that DO have moving chrome — Safari
          as a tab, the `minimal-ui` fallback declared at manifest.json:8, and
          installed Android PWAs — where min-h-screen overshoots by the toolbar
          height and leaves a dead scroll region under every section. dvh is a
          strictly smaller minimum, so it can only remove spurious height, never
          clip content. */}
      <div className="admin-shell min-h-dvh bg-background flex">
        {/* No backdrop-blur here: this scrim is full-screen and renders ONLY on the
            `lg:hidden` breakpoint, i.e. exclusively on the weakest device that ever
            opens this admin. bg-black/60 already carries the contrast a scrim needs;
            the blur bought nothing and cost a full-viewport filter pass per frame of
            the 200ms sidebar transition. */}
        {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}
        {/* h-dvh carries the real fix, not the min-h-dvh above. On mobile this aside
            is `fixed top-0 h-screen`; the nav below is `flex-1 overflow-y-auto` and
            the footer block is `shrink-0`, so when 100vh exceeds the visible viewport
            the overflow lands exactly on that footer — the user name, role and "Back
            to site" link render under the browser toolbar and cannot be tapped.
            h-dvh tracks the visible viewport so the footer stays reachable. On `lg`
            the aside is `sticky` on a chrome-less desktop viewport where dvh === vh,
            so desktop is unaffected. */}
        <aside className={`admin-sidebar fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-dvh w-[260px] flex flex-col transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`} aria-label="Admin navigation">
          <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0">
            <Link href="/" className="flex items-center gap-2.5 group flex-1 min-w-0"><div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden /><div className="flex flex-col min-w-0"><span className="font-semibold text-foreground text-[13.5px] leading-tight tracking-tight group-hover:text-primary transition-colors truncate">Nick&apos;s Admin</span><span className="text-[10px] text-muted-foreground/70 tracking-[0.06em]">{adminRole.replace("_", " ")}</span></div></Link>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-muted-foreground/60 hover:text-foreground p-1.5 rounded-md" aria-label="Close sidebar"><X className="w-4 h-4" /></button>
          </div>
          <nav className="flex-1 py-4 px-2 space-y-5 overflow-y-auto" aria-label="Admin sections">
            {visibleGroups.map((group) => <div key={group.label || "_flat"}>{group.label && <div className="admin-sidebar-group-label">{group.label}</div>}<div className="space-y-0.5 mt-0.5">{group.items.map((item) => {
              const isActive = section === item.id;
              const sectionSignals = signalsForSection(signals, item.id);
              const badge = foldSignals(sectionSignals);
              // Every number on screen names its source, so a badge can be traced
              // without reading the code that produced it.
              const badgeTitle = describeBadge(badge, sectionSignals);
              return <button key={item.id} onClick={() => { setSection(item.id); setSidebarOpen(false); }} aria-current={isActive ? "page" : undefined} className={`admin-sidebar-item w-full ${isActive ? "active" : ""}`}><span className={`shrink-0 ${isActive ? "text-primary" : "text-foreground/45"}`}>{item.icon}</span><span className="flex-1 text-left truncate">{item.label}</span>{badge.state === "unknown" ? <span className="shrink-0 text-[10px] font-semibold min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center" title={badgeTitle} aria-label="outstanding work unknown">?</span> : badge.state === "counted" && badge.count > 0 ? <span className="shrink-0 text-[10px] font-semibold tabular-nums min-w-[18px] h-[18px] px-1 rounded-full bg-destructive/12 text-destructive flex items-center justify-center" title={badgeTitle}>{badge.count > 99 ? "99+" : badge.count}</span> : null}</button>;
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
          <div className="admin-content"><div className="px-4 pt-4 space-y-3"><UnknownSectionNotice slug={unresolvedSlug} onDismiss={dismissUnresolvedSlug} /><DegradedDataBanner stats={stats} unavailable={overviewUnavailable} unavailableMessage={overviewError?.message} /></div><SectionContent section={section} /></div>
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
