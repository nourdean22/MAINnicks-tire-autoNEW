/*
 * ADMIN DASHBOARD — Booking Management for Nick's Tire & Auto
 * Protected page accessible only to admin users.
 * Allows viewing, confirming, completing, and cancelling appointments.
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
  CalendarClock, Filter, Search, RefreshCw
} from "lucide-react";

type BookingStatus = "new" | "confirmed" | "completed" | "cancelled";

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  new: {
    label: "NEW",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/30",
    icon: <CalendarClock className="w-4 h-4" />,
  },
  confirmed: {
    label: "CONFIRMED",
    color: "text-primary",
    bgColor: "bg-primary/10 border-primary/30",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  completed: {
    label: "COMPLETED",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/30",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  cancelled: {
    label: "CANCELLED",
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/30",
    icon: <XCircle className="w-4 h-4" />,
  },
};

const TIME_LABELS: Record<string, string> = {
  morning: "Morning (8AM–12PM)",
  afternoon: "Afternoon (12PM–6PM)",
  "no-preference": "No Preference",
};

function StatusBadge({ status }: { status: BookingStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 border font-mono text-xs tracking-wider ${config.color} ${config.bgColor}`}>
      {config.icon}
      {config.label}
    </span>
  );
}

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [filter, setFilter] = useState<BookingStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: bookings, isLoading, refetch } = trpc.booking.list.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const updateStatus = trpc.booking.updateStatus.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Booking status updated");
    },
    onError: (err) => {
      toast.error("Failed to update: " + err.message);
    },
  });

  // Filter and search bookings
  const filteredBookings = useMemo(() => {
    if (!bookings) return [];
    let list = [...bookings];

    if (filter !== "all") {
      list = list.filter((b) => b.status === filter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.phone.includes(q) ||
          (b.email && b.email.toLowerCase().includes(q)) ||
          b.service.toLowerCase().includes(q) ||
          (b.vehicle && b.vehicle.toLowerCase().includes(q))
      );
    }

    return list;
  }, [bookings, filter, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    if (!bookings) return { new: 0, confirmed: 0, completed: 0, cancelled: 0, total: 0 };
    return {
      new: bookings.filter((b) => b.status === "new").length,
      confirmed: bookings.filter((b) => b.status === "confirmed").length,
      completed: bookings.filter((b) => b.status === "completed").length,
      cancelled: bookings.filter((b) => b.status === "cancelled").length,
      total: bookings.length,
    };
  }, [bookings]);

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
          <p className="text-foreground/60 mb-8">Sign in with your admin account to manage bookings.</p>
          <a
            href={getLoginUrl()}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase hover:bg-primary/90 transition-colors"
          >
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
          <p className="text-foreground/60 mb-8">You do not have admin privileges. Contact the shop owner for access.</p>
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
              <span className="font-mono text-xs tracking-wider uppercase hidden sm:inline">Back to Site</span>
            </Link>
            <div className="h-6 w-px bg-border/30" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary flex items-center justify-center rounded-sm">
                <span className="font-heading font-bold text-primary-foreground text-sm">N</span>
              </div>
              <span className="font-heading font-bold text-primary text-sm tracking-wider">ADMIN DASHBOARD</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/admin/content" className="flex items-center gap-2 bg-card border border-border/30 px-4 py-2 text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors">
              <span className="font-heading font-bold text-xs tracking-wider uppercase">Content Manager</span>
            </Link>
            <span className="font-mono text-xs text-foreground/40">{user.name || user.email}</span>
            <button
              onClick={() => refetch()}
              className="p-2 text-foreground/50 hover:text-primary transition-colors"
              title="Refresh bookings"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </header>

      <div className="container py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {[
            { label: "Total", value: stats.total, color: "text-foreground" },
            { label: "New", value: stats.new, color: "text-blue-400" },
            { label: "Confirmed", value: stats.confirmed, color: "text-primary" },
            { label: "Completed", value: stats.completed, color: "text-emerald-400" },
            { label: "Cancelled", value: stats.cancelled, color: "text-red-400" },
          ].map((stat) => (
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
              placeholder="Search by name, phone, service, vehicle..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-card border border-border/50 text-foreground pl-10 pr-4 py-3 font-mono text-sm placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-foreground/40" />
            {(["all", "new", "confirmed", "completed", "cancelled"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 font-mono text-xs tracking-wider uppercase transition-colors ${
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Bookings List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="text-center py-20 border border-border/30 bg-card">
            <CalendarClock className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
            <p className="font-heading font-bold text-xl text-foreground/40 tracking-wider">
              {filter === "all" && !searchQuery ? "NO BOOKINGS YET" : "NO MATCHING BOOKINGS"}
            </p>
            <p className="text-foreground/30 font-mono text-sm mt-2">
              {filter === "all" && !searchQuery
                ? "Bookings from the website will appear here."
                : "Try adjusting your filters or search query."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredBookings.map((booking) => (
              <div key={booking.id} className="bg-card border border-border/30 p-6 hover:border-border/50 transition-colors">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  {/* Customer Info */}
                  <div className="flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-heading font-bold text-xl text-foreground tracking-wider">{booking.name}</h3>
                      <StatusBadge status={booking.status as BookingStatus} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="flex items-center gap-2 text-foreground/70">
                        <Phone className="w-4 h-4 text-primary shrink-0" />
                        <a href={`tel:${booking.phone}`} className="font-mono text-sm hover:text-primary transition-colors">
                          {booking.phone}
                        </a>
                      </div>
                      {booking.email && (
                        <div className="flex items-center gap-2 text-foreground/70">
                          <Mail className="w-4 h-4 text-primary shrink-0" />
                          <a href={`mailto:${booking.email}`} className="font-mono text-sm hover:text-primary transition-colors truncate">
                            {booking.email}
                          </a>
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
                      <div className="flex items-start gap-2 text-foreground/60 mt-2 bg-nick-dark/50 p-3 border border-border/20">
                        <MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <p className="font-mono text-sm leading-relaxed">{booking.message}</p>
                      </div>
                    )}

                    <p className="font-mono text-xs text-foreground/30">
                      Submitted {new Date(booking.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-row lg:flex-col gap-2 shrink-0">
                    {booking.status === "new" && (
                      <>
                        <button
                          onClick={() => updateStatus.mutate({ id: booking.id, status: "confirmed" })}
                          disabled={updateStatus.isPending}
                          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          CONFIRM
                        </button>
                        <button
                          onClick={() => updateStatus.mutate({ id: booking.id, status: "cancelled" })}
                          disabled={updateStatus.isPending}
                          className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" />
                          CANCEL
                        </button>
                      </>
                    )}
                    {booking.status === "confirmed" && (
                      <>
                        <button
                          onClick={() => updateStatus.mutate({ id: booking.id, status: "completed" })}
                          disabled={updateStatus.isPending}
                          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-emerald-700 transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          COMPLETE
                        </button>
                        <button
                          onClick={() => updateStatus.mutate({ id: booking.id, status: "cancelled" })}
                          disabled={updateStatus.isPending}
                          className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" />
                          CANCEL
                        </button>
                      </>
                    )}
                    {(booking.status === "completed" || booking.status === "cancelled") && (
                      <button
                        onClick={() => updateStatus.mutate({ id: booking.id, status: "new" })}
                        disabled={updateStatus.isPending}
                        className="flex items-center gap-2 border border-border/30 text-foreground/50 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:text-foreground hover:border-border/50 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className="w-4 h-4" />
                        REOPEN
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
