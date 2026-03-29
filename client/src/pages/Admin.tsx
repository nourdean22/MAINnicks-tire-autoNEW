/**
 * ADMIN DASHBOARD — Premium shell with CEO-level polish.
 * Each section lives in client/src/pages/admin/<SectionName>.tsx
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useState, lazy, Suspense } from "react";
import { Link } from "wouter";
import {
  Loader2, Shield, XCircle, ArrowLeft, Menu, X, Sparkles, ChevronRight,
} from "lucide-react";
import {
  AdminSection, NAV_GROUPS, SECTION_TITLES,
} from "./admin/shared";
import { CommandSearch } from "@/components/admin/CommandSearch";
import { CustomerDrawer } from "@/components/admin/CustomerDrawer";

// Lazy-load each section for code splitting
const OverviewSection = lazy(() => import("./admin/OverviewSection"));
const BookingsSection = lazy(() => import("./admin/BookingsSection"));
const LeadsSection = lazy(() => import("./admin/LeadsSection"));
const ContentSection = lazy(() => import("./admin/ContentSection"));
const ChatSessionsSection = lazy(() => import("./admin/ChatSessionsSection"));
const SiteHealthSection = lazy(() => import("./admin/SiteHealthSection"));
const CouponsSection = lazy(() => import("./admin/CouponsSection"));
const QASection = lazy(() => import("./admin/QASection"));
const ReferralsSection = lazy(() => import("./admin/ReferralsSection"));
const JobBoardSection = lazy(() => import("./admin/JobBoardSection"));
const InspectionsSection = lazy(() => import("./admin/InspectionsSection"));
const LoyaltyAdminSection = lazy(() => import("./admin/LoyaltyAdminSection"));
const FollowUpsSection = lazy(() => import("./admin/FollowUpsSection"));
const SmsSection = lazy(() => import("./admin/SmsSection"));
const ReviewRequestsSection = lazy(() => import("./admin/ReviewRequestsSection"));
const CustomersSection = lazy(() => import("./admin/CustomersSection"));
const WinBackSection = lazy(() => import("./admin/WinBackSection"));
const AutoFollowUpSection = lazy(() => import("./admin/AutoFollowUpSection"));
const ShopDriverSection = lazy(() => import("./admin/ShopDriverSection"));
const SettingsSection = lazy(() => import("./admin/SettingsSection"));
const EstimatesSection = lazy(() => import("./admin/EstimatesSection"));
const ActivitySection = lazy(() => import("./admin/ActivitySection"));
const RevenueSection = lazy(() => import("./admin/RevenueSection"));
const IntegrationsSection = lazy(() => import("./admin/IntegrationsSection"));
const TireOrdersSection = lazy(() => import("./admin/TireOrdersSection"));
const AnalyticsSection = lazy(() => import("./admin/AnalyticsSection"));
const CallTrackingSection = lazy(() => import("./admin/CallTrackingSection"));
const ExportSection = lazy(() => import("./admin/ExportSection"));
const CampaignsSection = lazy(() => import("./admin/CampaignsSection"));
const FinancingSection = lazy(() => import("./admin/FinancingSection"));

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
  return (
    <Suspense fallback={<SectionSpinner />}>
      {section === "overview" && <OverviewSection />}
      {section === "bookings" && <BookingsSection />}
      {section === "leads" && <LeadsSection />}
      {section === "content" && <ContentSection />}
      {section === "chats" && <ChatSessionsSection />}
      {section === "health" && <SiteHealthSection />}
      {section === "coupons" && <CouponsSection />}
      {section === "qa" && <QASection />}
      {section === "referrals" && <ReferralsSection />}
      {section === "jobs" && <JobBoardSection />}
      {section === "inspections" && <InspectionsSection />}
      {section === "loyalty" && <LoyaltyAdminSection />}
      {section === "followups" && <FollowUpsSection />}
      {section === "sms" && <SmsSection />}
      {section === "reviewRequests" && <ReviewRequestsSection />}
      {section === "customers" && <CustomersSection />}
      {section === "winback" && <WinBackSection />}
      {section === "campaigns" && <CampaignsSection />}
      {section === "financing" && <FinancingSection />}
      {section === "autoFollowUp" && <AutoFollowUpSection />}
      {section === "shopdriver" && <ShopDriverSection />}
      {section === "settings" && <SettingsSection />}
      {section === "estimates" && <EstimatesSection />}
      {section === "activity" && <ActivitySection />}
      {section === "revenue" && <RevenueSection />}
      {section === "integrations" && <IntegrationsSection />}
      {section === "tireOrders" && <TireOrdersSection />}
      {section === "analyticsView" && <AnalyticsSection />}
      {section === "callTrackingView" && <CallTrackingSection />}
      {section === "exportView" && <ExportSection />}
    </Suspense>
  );
}

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [section, setSection] = useState<AdminSection>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawerCustomerId, setDrawerCustomerId] = useState<number | null>(null);

  const { data: stats } = trpc.adminDashboard.stats.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 60000,
  });

  const { data: callbacks } = trpc.callback.list.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 60000,
  });

  // Pending callback count for badge
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
    <div className="min-h-screen bg-background flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── SIDEBAR ─── */}
      <aside className={`admin-sidebar fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen w-[260px] flex flex-col transition-transform duration-200 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      }`}>
        {/* Sidebar Header */}
        <div className="h-14 flex items-center px-5 border-b border-sidebar-border shrink-0">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 bg-primary flex items-center justify-center rounded-md">
              <span className="font-bold text-primary-foreground text-xs">N</span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-foreground text-[13px] leading-tight tracking-tight group-hover:text-primary transition-colors">Nick's Admin</span>
              <span className="text-[10px] text-muted-foreground tracking-wide">Management Hub</span>
            </div>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden ml-auto text-muted-foreground hover:text-foreground p-1 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav Items — Grouped */}
        <nav className="flex-1 py-3 px-3 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <div className="admin-sidebar-group-label">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const isActive = section === item.id;
                  let badge = 0;
                  if (item.id === "bookings") badge = newBookings;
                  if (item.id === "leads") badge = urgentLeads + newLeads;
                  if (item.id === "callTrackingView") badge = pendingCallbacks;

                  return (
                    <button
                      key={item.id}
                      onClick={() => { setSection(item.id); setSidebarOpen(false); }}
                      className={`admin-sidebar-item w-full ${isActive ? "active" : ""}`}
                    >
                      <span className={isActive ? "text-primary" : ""}>{item.icon}</span>
                      <span className="flex-1 text-left">{item.label}</span>
                      {badge > 0 && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none ${
                          item.id === "leads"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-info/15 text-info"
                        }`}>{badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="px-4 py-3 border-t border-sidebar-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-muted flex items-center justify-center rounded-full shrink-0">
              <span className="font-semibold text-muted-foreground text-[10px]">
                {user.name?.charAt(0)?.toUpperCase() || "A"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{user.name || "Admin"}</p>
              <p className="text-[10px] text-muted-foreground">Administrator</p>
            </div>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 mt-2.5 text-muted-foreground hover:text-primary transition-colors text-xs font-medium"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to site
          </Link>
        </div>
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <main className="flex-1 min-w-0">
        {/* Top Bar */}
        <header className="admin-topbar sticky top-0 z-30 flex items-center px-4 lg:px-6 gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-muted/50 transition-colors"
          >
            <Menu className="w-4 h-4" />
          </button>
          <h1 className="text-sm font-semibold text-foreground tracking-tight">
            {SECTION_TITLES[section]}
          </h1>
          <div className="flex-1" />
          <CommandSearch
            onNavigate={(s) => setSection(s)}
            onSelectCustomer={(id) => setDrawerCustomerId(id)}
          />
          <Link
            href="/admin/content"
            className="flex items-center gap-1.5 bg-muted/50 border border-border px-3 py-1.5 rounded-md text-muted-foreground hover:text-primary hover:border-primary/30 transition-all text-xs font-medium"
          >
            <Sparkles className="w-3 h-3" />
            <span className="hidden sm:inline">AI Content</span>
          </Link>
        </header>

        {/* Section Content */}
        <div className="admin-content">
          <SectionContent section={section} />
        </div>
      </main>

      {/* Customer side drawer */}
      <CustomerDrawer
        customerId={drawerCustomerId}
        onClose={() => setDrawerCustomerId(null)}
        onNavigateToSection={(s) => setSection(s as AdminSection)}
      />
    </div>
  );
}
