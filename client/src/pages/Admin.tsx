/**
 * ADMIN DASHBOARD — Slim shell that composes section components.
 * Each section lives in client/src/pages/admin/<SectionName>.tsx
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useState, lazy, Suspense } from "react";
import { Link } from "wouter";
import {
  Loader2, Shield, XCircle, ArrowLeft, Menu, X, Sparkles,
} from "lucide-react";
import {
  AdminSection, NAV_ITEMS, NAV_GROUPS, SECTION_TITLES,
} from "./admin/shared";

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

function SectionSpinner() {
  return (
    <div className="flex items-center justify-center py-32">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
      {section === "autoFollowUp" && <AutoFollowUpSection />}
    </Suspense>
  );
}

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [section, setSection] = useState<AdminSection>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: stats } = trpc.adminDashboard.stats.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 60000,
  });

  // ─── AUTH GATE ───────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-nick-dark flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-nick-dark flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <Shield className="w-12 h-12 text-primary mx-auto mb-4" />
          <h1 className="font-heading font-bold text-3xl text-foreground tracking-wider mb-4">ADMIN ACCESS</h1>
          <p className="text-foreground/60 mb-8">Sign in with your admin account to manage bookings and leads.</p>
          <a href={getLoginUrl()} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase hover:bg-primary/90 transition-colors">
            SIGN IN
          </a>
        </div>
      </div>
    );
  }

  if (user.role !== "admin") {
    return (
      <div className="min-h-screen bg-nick-dark flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="font-heading font-bold text-3xl text-foreground tracking-wider mb-4">ACCESS DENIED</h1>
          <p className="text-foreground/60 mb-8">You do not have admin privileges.</p>
          <Link href="/" className="inline-flex items-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase hover:border-primary hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
            BACK TO SITE
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
    <div className="min-h-screen bg-nick-dark flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen w-64 bg-card border-r border-border/30 flex flex-col transition-transform duration-200 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      }`}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-border/30">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-9 h-9 bg-primary flex items-center justify-center rounded-sm">
                <span className="font-heading font-bold text-primary-foreground text-base">N</span>
              </div>
              <div className="flex flex-col">
                <span className="font-heading font-bold text-primary text-sm leading-tight tracking-wider">NICK'S ADMIN</span>
                <span className="text-foreground/40 text-[10px] font-mono tracking-wider">MANAGEMENT HUB</span>
              </div>
            </Link>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-foreground/50 hover:text-foreground p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Nav Items — Grouped */}
        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <span className="font-mono text-[9px] text-foreground/30 tracking-[0.2em] uppercase px-3 mb-1 block">{group.label}</span>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const isActive = section === item.id;
                  let badge = 0;
                  if (item.id === "bookings") badge = newBookings;
                  if (item.id === "leads") badge = urgentLeads + newLeads;

                  return (
                    <button
                      key={item.id}
                      onClick={() => { setSection(item.id); setSidebarOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary border-l-2 border-primary"
                          : "text-foreground/60 hover:text-foreground hover:bg-foreground/5 border-l-2 border-transparent"
                      }`}
                    >
                      {item.icon}
                      <span className="font-heading font-bold text-xs tracking-wider uppercase flex-1 text-left">{item.label}</span>
                      {badge > 0 && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                          item.id === "leads" ? "bg-red-500 text-white" : "bg-blue-500 text-white"
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
        <div className="p-4 border-t border-border/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-foreground/10 flex items-center justify-center rounded-full">
              <span className="font-heading font-bold text-foreground/60 text-xs">
                {user.name?.charAt(0)?.toUpperCase() || "A"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs text-foreground truncate">{user.name || "Admin"}</p>
              <p className="font-mono text-[10px] text-foreground/30">Admin</p>
            </div>
          </div>
          <Link href="/" className="flex items-center gap-2 mt-3 text-foreground/40 hover:text-primary transition-colors font-mono text-xs">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to site
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-nick-dark/95 backdrop-blur-md border-b border-border/30 h-14 flex items-center px-4 lg:px-8 gap-4">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-foreground/60 hover:text-foreground p-1">
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground">
            {SECTION_TITLES[section]}
          </h1>
          <div className="flex-1" />
          <Link href="/admin/content" className="flex items-center gap-1.5 bg-card border border-border/30 px-3 py-1.5 text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="font-heading font-bold text-[10px] tracking-wider uppercase hidden sm:inline">AI Content</span>
          </Link>
        </header>

        {/* Section Content */}
        <div className="p-4 lg:p-8">
          <SectionContent section={section} />
        </div>
      </main>
    </div>
  );
}
