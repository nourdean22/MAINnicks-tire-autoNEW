/*
 * ADMIN DASHBOARD — Booking & Lead Management for Nick's Tire & Auto
 * Protected page accessible only to admin users.
 * Tabs: Bookings | Leads | CRM Sheet
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  Phone, Mail, Car, Calendar, Clock, MessageSquare,
  CheckCircle2, XCircle, Loader2, ArrowLeft, Shield,
  CalendarClock, Filter, Search, RefreshCw, Users,
  AlertTriangle, ExternalLink, FileSpreadsheet, Zap,
  PhoneCall, UserCheck
} from "lucide-react";

type BookingStatus = "new" | "confirmed" | "completed" | "cancelled";
type LeadStatus = "new" | "contacted" | "booked" | "closed" | "lost";
type AdminTab = "bookings" | "leads";

const BOOKING_STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  new: { label: "NEW", color: "text-blue-400", bgColor: "bg-blue-500/10 border-blue-500/30", icon: <CalendarClock className="w-4 h-4" /> },
  confirmed: { label: "CONFIRMED", color: "text-primary", bgColor: "bg-primary/10 border-primary/30", icon: <CheckCircle2 className="w-4 h-4" /> },
  completed: { label: "COMPLETED", color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30", icon: <CheckCircle2 className="w-4 h-4" /> },
  cancelled: { label: "CANCELLED", color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/30", icon: <XCircle className="w-4 h-4" /> },
};

const LEAD_STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bgColor: string }> = {
  new: { label: "NEW", color: "text-blue-400", bgColor: "bg-blue-500/10 border-blue-500/30" },
  contacted: { label: "CONTACTED", color: "text-primary", bgColor: "bg-primary/10 border-primary/30" },
  booked: { label: "BOOKED", color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30" },
  closed: { label: "CLOSED", color: "text-foreground/40", bgColor: "bg-foreground/5 border-foreground/20" },
  lost: { label: "LOST", color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/30" },
};

const TIME_LABELS: Record<string, string> = {
  morning: "Morning (8AM–12PM)",
  afternoon: "Afternoon (12PM–6PM)",
  "no-preference": "No Preference",
};

function UrgencyBadge({ score }: { score: number }) {
  const config = score >= 4
    ? { label: "URGENT", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" }
    : score >= 3
    ? { label: "MODERATE", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" }
    : { label: "ROUTINE", color: "text-foreground/50", bg: "bg-foreground/5 border-foreground/20" };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 border font-mono text-[10px] tracking-wider ${config.color} ${config.bg}`}>
      {score >= 4 && <AlertTriangle className="w-3 h-3" />}
      {config.label} ({score}/5)
    </span>
  );
}

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<AdminTab>("bookings");
  const [bookingFilter, setBookingFilter] = useState<BookingStatus | "all">("all");
  const [leadFilter, setLeadFilter] = useState<LeadStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: bookings, isLoading: bookingsLoading, refetch: refetchBookings } = trpc.booking.list.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 30000,
  });

  const { data: leadsData, isLoading: leadsLoading, refetch: refetchLeads } = trpc.lead.list.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 30000,
  });

  const { data: sheetInfo } = trpc.lead.sheetUrl.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });

  const updateBookingStatus = trpc.booking.updateStatus.useMutation({
    onSuccess: () => { refetchBookings(); toast.success("Booking status updated"); },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => { refetchLeads(); toast.success("Lead updated"); },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  // Filtered bookings
  const filteredBookings = useMemo(() => {
    if (!bookings) return [];
    let list = [...bookings];
    if (bookingFilter !== "all") list = list.filter(b => b.status === bookingFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(b =>
        b.name.toLowerCase().includes(q) || b.phone.includes(q) ||
        (b.email && b.email.toLowerCase().includes(q)) ||
        b.service.toLowerCase().includes(q) || (b.vehicle && b.vehicle.toLowerCase().includes(q))
      );
    }
    return list;
  }, [bookings, bookingFilter, searchQuery]);

  // Filtered leads
  const filteredLeads = useMemo(() => {
    if (!leadsData) return [];
    let list = [...leadsData];
    if (leadFilter !== "all") list = list.filter(l => l.status === leadFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(l =>
        l.name.toLowerCase().includes(q) || l.phone.includes(q) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.vehicle && l.vehicle.toLowerCase().includes(q)) ||
        (l.problem && l.problem.toLowerCase().includes(q))
      );
    }
    return list;
  }, [leadsData, leadFilter, searchQuery]);

  // Stats
  const bookingStats = useMemo(() => {
    if (!bookings) return { new: 0, confirmed: 0, completed: 0, cancelled: 0, total: 0 };
    return {
      new: bookings.filter(b => b.status === "new").length,
      confirmed: bookings.filter(b => b.status === "confirmed").length,
      completed: bookings.filter(b => b.status === "completed").length,
      cancelled: bookings.filter(b => b.status === "cancelled").length,
      total: bookings.length,
    };
  }, [bookings]);

  const leadStats = useMemo(() => {
    if (!leadsData) return { new: 0, contacted: 0, urgent: 0, total: 0 };
    return {
      new: leadsData.filter(l => l.status === "new").length,
      contacted: leadsData.filter(l => l.status === "contacted").length,
      urgent: leadsData.filter(l => (l.urgencyScore ?? 0) >= 4).length,
      total: leadsData.length,
    };
  }, [leadsData]);

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

  // ─── ADMIN DASHBOARD ─────────────────────────────────
  return (
    <div className="min-h-screen bg-nick-dark">
      {/* Header */}
      <header className="bg-nick-dark/95 border-b border-border/30 sticky top-0 z-50 backdrop-blur-md">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 text-foreground/60 hover:text-primary transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span className="font-mono text-xs tracking-wider uppercase hidden sm:inline">Back</span>
            </Link>
            <div className="h-6 w-px bg-border/30" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary flex items-center justify-center rounded-sm">
                <span className="font-heading font-bold text-primary-foreground text-sm">N</span>
              </div>
              <span className="font-heading font-bold text-primary text-sm tracking-wider hidden sm:inline">ADMIN</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/content" className="flex items-center gap-1.5 bg-card border border-border/30 px-3 py-2 text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors">
              <Zap className="w-3.5 h-3.5" />
              <span className="font-heading font-bold text-xs tracking-wider uppercase hidden sm:inline">Content</span>
            </Link>
            {sheetInfo?.configured && (
              <a
                href={sheetInfo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-card border border-border/30 px-3 py-2 text-foreground/60 hover:text-emerald-400 hover:border-emerald-500/30 transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span className="font-heading font-bold text-xs tracking-wider uppercase hidden sm:inline">CRM Sheet</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              onClick={() => { refetchBookings(); refetchLeads(); }}
              className="p-2 text-foreground/50 hover:text-primary transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${bookingsLoading || leadsLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </header>

      <div className="container py-8">
        {/* Tab Switcher */}
        <div className="flex gap-0 mb-8">
          <button
            onClick={() => setTab("bookings")}
            className={`flex items-center gap-2 px-6 py-3 font-heading font-bold text-sm tracking-wider uppercase transition-colors ${
              tab === "bookings" ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
            }`}
          >
            <CalendarClock className="w-4 h-4" />
            BOOKINGS
            {bookingStats.new > 0 && (
              <span className="bg-blue-500 text-white text-[10px] font-mono px-1.5 py-0.5 rounded-full">{bookingStats.new}</span>
            )}
          </button>
          <button
            onClick={() => setTab("leads")}
            className={`flex items-center gap-2 px-6 py-3 font-heading font-bold text-sm tracking-wider uppercase transition-colors ${
              tab === "leads" ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
            }`}
          >
            <Users className="w-4 h-4" />
            LEADS
            {leadStats.urgent > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-mono px-1.5 py-0.5 rounded-full">{leadStats.urgent}</span>
            )}
          </button>
        </div>

        {/* ─── BOOKINGS TAB ──────────────────────────────── */}
        {tab === "bookings" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              {[
                { label: "Total", value: bookingStats.total, color: "text-foreground" },
                { label: "New", value: bookingStats.new, color: "text-blue-400" },
                { label: "Confirmed", value: bookingStats.confirmed, color: "text-primary" },
                { label: "Completed", value: bookingStats.completed, color: "text-emerald-400" },
                { label: "Cancelled", value: bookingStats.cancelled, color: "text-red-400" },
              ].map(stat => (
                <div key={stat.label} className="bg-card border border-border/30 p-4">
                  <p className="font-mono text-xs text-foreground/50 tracking-wider uppercase">{stat.label}</p>
                  <p className={`font-heading font-bold text-3xl ${stat.color} mt-1`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
                <input
                  type="text"
                  placeholder="Search bookings..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-card border border-border/50 text-foreground pl-10 pr-4 py-3 font-mono text-sm placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Filter className="w-4 h-4 text-foreground/40" />
                {(["all", "new", "confirmed", "completed", "cancelled"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setBookingFilter(f)}
                    className={`px-3 py-2 font-mono text-xs tracking-wider uppercase transition-colors ${
                      bookingFilter === f ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Bookings List */}
            {bookingsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredBookings.length === 0 ? (
              <div className="text-center py-20 border border-border/30 bg-card">
                <CalendarClock className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
                <p className="font-heading font-bold text-xl text-foreground/40 tracking-wider">NO BOOKINGS</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredBookings.map(booking => (
                  <div key={booking.id} className="bg-card border border-border/30 p-6 hover:border-border/50 transition-colors">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-heading font-bold text-lg text-foreground tracking-wider">{booking.name}</h3>
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 border font-mono text-xs tracking-wider ${BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.color} ${BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.bgColor}`}>
                            {BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.icon}
                            {BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.label}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="flex items-center gap-2 text-foreground/70">
                            <Phone className="w-4 h-4 text-primary shrink-0" />
                            <a href={`tel:${booking.phone}`} className="font-mono text-sm hover:text-primary">{booking.phone}</a>
                          </div>
                          {booking.email && (
                            <div className="flex items-center gap-2 text-foreground/70">
                              <Mail className="w-4 h-4 text-primary shrink-0" />
                              <span className="font-mono text-sm truncate">{booking.email}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-foreground/70">
                            <Shield className="w-4 h-4 text-primary shrink-0" />
                            <span className="font-mono text-sm">{booking.service}</span>
                          </div>
                          {booking.vehicle && (
                            <div className="flex items-center gap-2 text-foreground/70">
                              <Car className="w-4 h-4 text-primary shrink-0" />
                              <span className="font-mono text-sm">{booking.vehicle}</span>
                            </div>
                          )}
                          {booking.preferredDate && (
                            <div className="flex items-center gap-2 text-foreground/70">
                              <Calendar className="w-4 h-4 text-primary shrink-0" />
                              <span className="font-mono text-sm">{booking.preferredDate}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-foreground/70">
                            <Clock className="w-4 h-4 text-primary shrink-0" />
                            <span className="font-mono text-sm">{TIME_LABELS[booking.preferredTime] || booking.preferredTime}</span>
                          </div>
                        </div>
                        {booking.message && (
                          <div className="flex items-start gap-2 text-foreground/60 bg-nick-dark/50 p-3 border border-border/20">
                            <MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                            <p className="font-mono text-sm leading-relaxed">{booking.message}</p>
                          </div>
                        )}
                        <p className="font-mono text-xs text-foreground/30">
                          Submitted {new Date(booking.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-row lg:flex-col gap-2 shrink-0">
                        {booking.status === "new" && (
                          <>
                            <button onClick={() => updateBookingStatus.mutate({ id: booking.id, status: "confirmed" })} disabled={updateBookingStatus.isPending} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/90 disabled:opacity-50">
                              <CheckCircle2 className="w-4 h-4" /> CONFIRM
                            </button>
                            <button onClick={() => updateBookingStatus.mutate({ id: booking.id, status: "cancelled" })} disabled={updateBookingStatus.isPending} className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-red-500/10 disabled:opacity-50">
                              <XCircle className="w-4 h-4" /> CANCEL
                            </button>
                          </>
                        )}
                        {booking.status === "confirmed" && (
                          <>
                            <button onClick={() => updateBookingStatus.mutate({ id: booking.id, status: "completed" })} disabled={updateBookingStatus.isPending} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-emerald-700 disabled:opacity-50">
                              <CheckCircle2 className="w-4 h-4" /> COMPLETE
                            </button>
                            <button onClick={() => updateBookingStatus.mutate({ id: booking.id, status: "cancelled" })} disabled={updateBookingStatus.isPending} className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-red-500/10 disabled:opacity-50">
                              <XCircle className="w-4 h-4" /> CANCEL
                            </button>
                          </>
                        )}
                        {(booking.status === "completed" || booking.status === "cancelled") && (
                          <button onClick={() => updateBookingStatus.mutate({ id: booking.id, status: "new" })} disabled={updateBookingStatus.isPending} className="flex items-center gap-2 border border-border/30 text-foreground/50 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:text-foreground disabled:opacity-50">
                            <RefreshCw className="w-4 h-4" /> REOPEN
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ─── LEADS TAB ─────────────────────────────────── */}
        {tab === "leads" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Total Leads", value: leadStats.total, color: "text-foreground" },
                { label: "New (Uncalled)", value: leadStats.new, color: "text-blue-400" },
                { label: "Contacted", value: leadStats.contacted, color: "text-primary" },
                { label: "Urgent (4-5)", value: leadStats.urgent, color: "text-red-400" },
              ].map(stat => (
                <div key={stat.label} className="bg-card border border-border/30 p-4">
                  <p className="font-mono text-xs text-foreground/50 tracking-wider uppercase">{stat.label}</p>
                  <p className={`font-heading font-bold text-3xl ${stat.color} mt-1`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
                <input
                  type="text"
                  placeholder="Search leads..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-card border border-border/50 text-foreground pl-10 pr-4 py-3 font-mono text-sm placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Filter className="w-4 h-4 text-foreground/40" />
                {(["all", "new", "contacted", "booked", "closed", "lost"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setLeadFilter(f)}
                    className={`px-3 py-2 font-mono text-xs tracking-wider uppercase transition-colors ${
                      leadFilter === f ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Leads List */}
            {leadsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="text-center py-20 border border-border/30 bg-card">
                <Users className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
                <p className="font-heading font-bold text-xl text-foreground/40 tracking-wider">NO LEADS</p>
                <p className="text-foreground/30 font-mono text-sm mt-2">Leads from the popup and chat will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredLeads.map(lead => (
                  <div
                    key={lead.id}
                    className={`bg-card border p-6 transition-colors ${
                      (lead.urgencyScore ?? 0) >= 4 ? "border-red-500/30 hover:border-red-500/50" : "border-border/30 hover:border-border/50"
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-heading font-bold text-lg text-foreground tracking-wider">{lead.name}</h3>
                          <UrgencyBadge score={lead.urgencyScore ?? 3} />
                          <span className={`inline-flex items-center px-2 py-0.5 border font-mono text-[10px] tracking-wider ${LEAD_STATUS_CONFIG[lead.status as LeadStatus]?.color} ${LEAD_STATUS_CONFIG[lead.status as LeadStatus]?.bgColor}`}>
                            {LEAD_STATUS_CONFIG[lead.status as LeadStatus]?.label}
                          </span>
                          <span className="font-mono text-[10px] text-foreground/30 uppercase tracking-wider">
                            via {lead.source}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="flex items-center gap-2 text-foreground/70">
                            <Phone className="w-4 h-4 text-primary shrink-0" />
                            <a href={`tel:${lead.phone}`} className="font-mono text-sm hover:text-primary">{lead.phone}</a>
                          </div>
                          {lead.email && (
                            <div className="flex items-center gap-2 text-foreground/70">
                              <Mail className="w-4 h-4 text-primary shrink-0" />
                              <span className="font-mono text-sm truncate">{lead.email}</span>
                            </div>
                          )}
                          {lead.vehicle && (
                            <div className="flex items-center gap-2 text-foreground/70">
                              <Car className="w-4 h-4 text-primary shrink-0" />
                              <span className="font-mono text-sm">{lead.vehicle}</span>
                            </div>
                          )}
                          {lead.recommendedService && (
                            <div className="flex items-center gap-2 text-foreground/70">
                              <Shield className="w-4 h-4 text-primary shrink-0" />
                              <span className="font-mono text-sm">{lead.recommendedService}</span>
                            </div>
                          )}
                        </div>

                        {lead.problem && (
                          <div className="flex items-start gap-2 text-foreground/60 bg-nick-dark/50 p-3 border border-border/20">
                            <MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                            <p className="font-mono text-sm leading-relaxed">{lead.problem}</p>
                          </div>
                        )}

                        {lead.urgencyReason && (
                          <div className="flex items-start gap-2 text-foreground/50">
                            <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                            <p className="font-mono text-xs leading-relaxed italic">{lead.urgencyReason}</p>
                          </div>
                        )}

                        {lead.contactNotes && (
                          <div className="flex items-start gap-2 text-foreground/50 bg-emerald-500/5 p-2 border border-emerald-500/20">
                            <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                            <p className="font-mono text-xs leading-relaxed">
                              <span className="text-emerald-400">Contacted by {lead.contactedBy || "staff"}: </span>
                              {lead.contactNotes}
                            </p>
                          </div>
                        )}

                        <p className="font-mono text-xs text-foreground/30">
                          Received {new Date(lead.createdAt).toLocaleString()}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-row lg:flex-col gap-2 shrink-0">
                        {lead.status === "new" && (
                          <>
                            <a
                              href={`tel:${lead.phone}`}
                              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/90"
                            >
                              <PhoneCall className="w-4 h-4" /> CALL
                            </a>
                            <button
                              onClick={() => {
                                const notes = prompt("Contact notes (what was discussed?):");
                                if (notes !== null) {
                                  updateLead.mutate({
                                    id: lead.id,
                                    status: "contacted",
                                    contacted: 1,
                                    contactNotes: notes || "Called, no notes.",
                                  });
                                }
                              }}
                              disabled={updateLead.isPending}
                              className="flex items-center gap-2 border border-primary/30 text-primary px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/10 disabled:opacity-50"
                            >
                              <UserCheck className="w-4 h-4" /> MARK CONTACTED
                            </button>
                          </>
                        )}
                        {lead.status === "contacted" && (
                          <>
                            <button
                              onClick={() => updateLead.mutate({ id: lead.id, status: "booked" })}
                              disabled={updateLead.isPending}
                              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-4 h-4" /> BOOKED
                            </button>
                            <button
                              onClick={() => updateLead.mutate({ id: lead.id, status: "lost" })}
                              disabled={updateLead.isPending}
                              className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-red-500/10 disabled:opacity-50"
                            >
                              <XCircle className="w-4 h-4" /> LOST
                            </button>
                          </>
                        )}
                        {(lead.status === "booked" || lead.status === "closed" || lead.status === "lost") && (
                          <button
                            onClick={() => updateLead.mutate({ id: lead.id, status: "new", contacted: 0 })}
                            disabled={updateLead.isPending}
                            className="flex items-center gap-2 border border-border/30 text-foreground/50 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:text-foreground disabled:opacity-50"
                          >
                            <RefreshCw className="w-4 h-4" /> REOPEN
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
