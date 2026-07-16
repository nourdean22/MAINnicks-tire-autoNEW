/**
 * ADMIN DASHBOARD — operator shell.
 *
 * Wave 2 consolidates shell data onto the same overview bundle used by Today,
 * uses canonical non-overlapping action counts, surfaces degraded data globally,
 * and narrows SSE invalidation to the domains touched by each event.
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import ActivityPulse from "@/components/admin/ActivityPulse";
import { AdminSSEProvider, useAdminSSE } from "@/components/admin/AdminSSEContext";
import { CommandSearch } from "@/components/admin/CommandSearch";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import DegradedDataBanner from "@/components/admin/DegradedDataBanner";
import DensityToggle from "@/components/admin/DensityToggle";
import DrilldownDrawer from "@/components/admin/DrilldownDrawer";
import ThemeToggle from "@/components/admin/ThemeToggle";
import WalkInQuoteDrawer from "@/components/admin/WalkInQuoteDrawer";
import WeatherAwareBanner from "@/components/admin/WeatherAwareBanner";
import { getAdminActionableCounts, type AdminActionableCounts } from "@/lib/adminActionableCounts";
import { trpc } from "@/lib/trpc";
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
import { useEffect, useState } from "react";
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

function getBadgeCount(
  id: string,
  stats: any,
  counts: AdminActionableCounts,
): number {
  if (id === "overview") return counts.total;
  if (id === "leads") return counts.newLeads;
  if (id === "tireOrders") return stats?.tires?.new ?? 0;
  if (id === "memberships") return stats?.memberships?.warning ?? 0;
  return 0;
}

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const { section, setSection } = useAdminNavigation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isAdmin = !!user && user.role === "admin";

  const {
    data: bundle,
    isError: overviewUnavailable,
    error: overviewError,
  } = trpc.adminDashboard.overviewMediumBundle.useQuery(undefined, {
    enabled: isAdmin,
    refetchInterval: 30_000,
    staleTime: 25_000,
    refetchIntervalInBackground: false,
  });

  const { data: woStats } = trpc.nourOsBridge.shopFloor.useQuery(undefined, {
    enabled: isAdmin,
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
          <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
            Sign in with your admin account to manage operations.
          </p>
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

  return (
    <AdminSSEProvider enabled={isAdmin}>
      <AdminSSEListeners />
      <div className="admin-shell min-h-screen bg-background flex">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={`admin-sidebar fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen w-[260px] flex flex-col transition-transform duration-200 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0">
            <Link href="/" className="flex items-center gap-2.5 group flex-1 min-w-0">
              <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />
              <div className="flex flex-col min-w-0">
                <span className="font-semibold text-foreground text-[13.5px] leading-tight tracking-tight group-hover:text-primary transition-colors truncate">
                  Nick&apos;s Admin
                </span>
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

          <nav className="flex-1 py-4 px-2 space-y-5 overflow-y-auto">
            {NAV_GROUPS.map((group) => (
              <div key={group.label || "_flat"}>
                {group.label && <div className="admin-sidebar-group-label">{group.label}</div>}
                <div className="space-y-0.5 mt-0.5">
                  {group.items.map((item) => {
                    const isActive = section === item.id;
                    const badge = getBadgeCount(item.id, stats, actionableCounts);
                    const isAlert =
                      (item.id === "overview" && badge > 0) ||
                      (item.id === "memberships" && badge > 0);

                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setSection(item.id);
                          setSidebarOpen(false);
                        }}
                        className={`admin-sidebar-item w-full ${isActive ? "active" : ""}`}
                      >
                        <span className={`shrink-0 ${isActive ? "text-primary" : "text-foreground/45"}`}>
                          {item.icon}
                        </span>
                        <span className="flex-1 text-left truncate">{item.label}</span>
                        {badge > 0 && (
                          <span
                            className={`shrink-0 text-[10px] font-semibold tabular-nums leading-none flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full ${
                              isAlert
                                ? "bg-destructive/12 text-destructive ring-1 ring-destructive/20"
                                : "bg-foreground/8 text-foreground/60"
                            } ${
                              item.id === "revenue" && (woStats?.overdue || woStats?.blocked)
                                ? "animate-pulse"
                                : ""
                            }`}
                          >
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

          <div className="px-3 py-3 border-t border-sidebar-border shrink-0 space-y-2.5">
            {woStats && woStats.active > 0 && (
              <button
                onClick={() => {
                  setSection("revenue");
                  setSidebarOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-foreground/3 hover:bg-foreground/6 border border-border/30 hover:border-border/50 transition-colors text-left"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    woStats.overdue > 0
                      ? "bg-red-400 animate-pulse"
                      : woStats.blocked > 0
                        ? "bg-amber-400"
                        : "bg-emerald-400"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-foreground tracking-tight">
                    {woStats.active} active · {woStats.inProgress} in bay
                  </div>
                  <div className="text-[10px] text-muted-foreground/80 tabular-nums">
                    ${Math.round(woStats.totalValueInProgress).toLocaleString()}
                    {woStats.overdue > 0 && (
                      <span className="text-red-400 ml-1.5">· {woStats.overdue} overdue</span>
                    )}
                  </div>
                </div>
              </button>
            )}

            <div className="flex items-center gap-2.5 px-2 pt-1">
              <div className="w-7 h-7 rounded-full bg-foreground/8 flex items-center justify-center shrink-0">
                <span className="font-semibold text-foreground/70 text-[10px]">
                  {user.name?.charAt(0)?.toUpperCase() || "A"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-foreground truncate leading-tight">
                  {user.name || "Admin"}
                </p>
                <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">Administrator</p>
              </div>
            </div>

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

        <main className="flex-1 min-w-0">
          <header className="admin-topbar sticky top-0 z-30 flex items-center px-3 lg:px-5 gap-1 pt-[env(safe-area-inset-top,0px)]">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-foreground/5 rounded-md transition-colors shrink-0"
              aria-label="Open sidebar"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="text-[14px] font-semibold text-foreground tracking-tight px-2 truncate min-w-0">
              {SECTION_TITLES[section]}
            </h1>
            <div className="flex-1 min-w-0" />
            <CommandSearch
              onNavigate={(nextSection) => setSection(nextSection)}
              onSelectCustomer={(id) => openCustomerDrawer(id)}
            />
            <DensityToggle />
            <ThemeToggle />
            {TOPBAR_ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                title={action.title}
                aria-label={action.title}
                onClick={(event) => {
                  if (!action.sectionTrigger) return;
                  event.preventDefault();
                  window.history.replaceState({}, "", action.href);
                  setSection(action.sectionTrigger);
                }}
                className={`${
                  action.mobileHidden ? "hidden lg:inline-flex" : "inline-flex"
                } items-center justify-center w-9 h-9 hover:text-primary hover:bg-foreground/5 rounded-md transition-colors shrink-0 ${
                  action.sectionTrigger && section === action.sectionTrigger
                    ? "text-primary bg-foreground/5"
                    : "text-muted-foreground"
                }`}
              >
                {action.icon}
              </Link>
            ))}
          </header>

          <div className="admin-content">
            <div className="px-4 pt-4 space-y-3">
              <DegradedDataBanner
                stats={stats}
                unavailable={overviewUnavailable}
                unavailableMessage={overviewError?.message}
              />
              <WeatherAwareBanner />
            </div>
            <SectionContent section={section} />
          </div>
        </main>

        <DrilldownDrawer />
        <ConfirmDialog />
        <WalkInQuoteDrawer />
        <ActivityPulse />
      </div>
    </AdminSSEProvider>
  );
}

function AdminSSEListeners() {
  const utils = trpc.useUtils();
  const eventSource = useAdminSSE();

  useEffect(() => {
    if (!eventSource) return;

    const invalidateOverview = () => {
      utils.adminDashboard.overviewMediumBundle.invalidate();
      utils.adminDashboard.stats.invalidate();
    };
    const invalidateLeads = () => {
      invalidateOverview();
      utils.lead.list.invalidate();
      utils.nickActions.shopPulse.invalidate();
    };
    const invalidateBookings = () => {
      invalidateOverview();
      utils.booking.list.invalidate();
    };
    const invalidateCallbacks = () => {
      invalidateOverview();
      utils.callback.list.invalidate();
    };
    const invalidateMoney = () => {
      invalidateOverview();
      utils.nickActions.shopPulse.invalidate();
      utils.nourOsBridge.shopFloor.invalidate();
    };
    const invalidateWorkOrders = () => {
      invalidateMoney();
    };

    const handlers: Array<[string, (event: Event) => void]> = [
      ["message", invalidateOverview],
      ["lead_captured", () => {
        invalidateLeads();
        toast.info("New lead captured");
      }],
      ["booking_created", () => {
        invalidateBookings();
        toast.info("New booking");
      }],
      ["tire_order_placed", () => {
        invalidateOverview();
        toast.info("Tire order placed");
      }],
      ["invoice_created", () => {
        invalidateMoney();
        toast.info("Invoice created");
      }],
      ["invoice_paid", () => {
        invalidateMoney();
        toast.success("Payment received");
      }],
      ["payment_received", () => {
        invalidateMoney();
        toast.success("Payment received");
      }],
      ["emergency_request", () => {
        invalidateOverview();
        toast.error("EMERGENCY request!");
      }],
      ["callback_requested", () => {
        invalidateCallbacks();
        toast.info("Callback requested");
      }],
      ["review_detected", () => {
        utils.adminDashboard.stats.invalidate();
        utils.customers.campaignStats.invalidate();
        toast.info("New review detected");
      }],
      ["work_order_updated", invalidateWorkOrders],
      ["work_order_created", () => {
        invalidateWorkOrders();
        toast.info("New work order created");
      }],
    ];

    for (const [type, handler] of handlers) {
      eventSource.addEventListener(type, handler);
    }

    return () => {
      for (const [type, handler] of handlers) {
        eventSource.removeEventListener(type, handler);
      }
    };
  }, [eventSource, utils]);

  return null;
}
