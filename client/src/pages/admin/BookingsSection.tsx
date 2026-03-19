/**
 * BookingsSection — extracted from Admin.tsx for maintainability.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { BUSINESS } from "@shared/business";
import {
  StatCard, UrgencyBadge, ActivityIcon, StatusDot,
  BOOKING_STATUS_CONFIG, LEAD_STATUS_CONFIG, TIME_LABELS, CHART_COLORS,
  type BookingStatus, type LeadStatus,
} from "./shared";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Calendar, CalendarClock, Camera, Car, CheckCircle2, Clock, Eye, FileText, Filter, Hash, Loader2, Mail, MessageSquare, Phone, RefreshCw, Search, Wrench, X, XCircle
} from "lucide-react";

function BookingNotesEditor({ bookingId, initialNotes }: { bookingId: number; initialNotes: string | null }) {
  const [notes, setNotes] = useState(initialNotes || "");
  const [editing, setEditing] = useState(false);
  const utils = trpc.useUtils();
  const updateNotes = trpc.booking.updateNotes.useMutation({
    onSuccess: () => {
      setEditing(false);
      utils.booking.list.invalidate();
      toast.success("Notes saved");
    },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-start gap-2 w-full text-left p-2 border border-dashed border-border/30 hover:border-primary/30 transition-colors group"
      >
        <FileText className="w-3.5 h-3.5 text-foreground/30 group-hover:text-primary shrink-0 mt-0.5" />
        <span className={`font-mono text-xs leading-relaxed ${notes ? "text-foreground/60" : "text-foreground/30 italic"}`}>
          {notes || "Add admin notes..."}
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        autoFocus
        className="w-full bg-background/60 border border-primary/30 text-foreground px-3 py-2 font-mono text-xs focus:outline-none focus:border-primary/50 resize-none"
        placeholder="Internal notes about this booking..."
      />
      <div className="flex gap-2">
        <button
          onClick={() => updateNotes.mutate({ id: bookingId, notes })}
          disabled={updateNotes.isPending}
          className="px-3 py-1.5 bg-primary text-primary-foreground font-mono text-xs tracking-wider uppercase hover:bg-primary/90 disabled:opacity-50"
        >
          {updateNotes.isPending ? "Saving..." : "Save"}
        </button>
        <button
          onClick={() => { setNotes(initialNotes || ""); setEditing(false); }}
          className="px-3 py-1.5 border border-border/30 text-foreground/50 font-mono text-xs tracking-wider uppercase hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function PrioritySelector({ bookingId, currentPriority }: { bookingId: number; currentPriority: number }) {
  const utils = trpc.useUtils();
  const updatePriority = trpc.booking.updatePriority.useMutation({
    onSuccess: () => {
      utils.booking.list.invalidate();
      toast.success("Priority updated");
    },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  const priorities = [
    { value: 0, label: "Normal", color: "text-foreground/40", bg: "bg-foreground/5 border-foreground/20" },
    { value: 1, label: "High", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
    { value: 2, label: "Urgent", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" },
  ];


  return (
    <div className="flex items-center gap-1.5">
      {priorities.map(p => (
        <button
          key={p.value}
          onClick={() => updatePriority.mutate({ id: bookingId, priority: p.value })}
          disabled={updatePriority.isPending}
          className={`px-2 py-1 border font-mono text-[10px] tracking-wider uppercase transition-all ${
            currentPriority === p.value
              ? `${p.color} ${p.bg} ring-1 ring-current/20`
              : "border-border/20 text-foreground/20 hover:text-foreground/50"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function BookingPhotoThumbnails({ photoUrlsJson }: { photoUrlsJson: string | null }) {
  if (!photoUrlsJson) return null;
  try {
    const urls: string[] = JSON.parse(photoUrlsJson);
    if (!urls.length) return null;
    return (
      <div className="flex gap-2 mt-2">
        {urls.map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block w-16 h-16 border border-border/30 overflow-hidden hover:border-primary/50 transition-colors">
            <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
          </a>
        ))}
      </div>
    );
  } catch {
    return null;
  }
}

export default function BookingsSection() {
  const [bookingFilter, setBookingFilter] = useState<BookingStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "priority">("date");

  const { data: bookings, isLoading, refetch } = trpc.booking.list.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const updateBookingStatus = trpc.booking.updateStatus.useMutation({
    onSuccess: () => { refetch(); toast.success("Booking status updated"); },
    onError: (err) => toast.error("Failed: " + err.message),
  });

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
    // Sort by priority (urgent first) or date
    if (sortBy === "priority") {
      list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }
    return list;
  }, [bookings, bookingFilter, searchQuery, sortBy]);

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

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Total", value: bookingStats.total, color: "text-foreground", icon: <Hash className="w-4 h-4" /> },
          { label: "New", value: bookingStats.new, color: "text-blue-400", icon: <CalendarClock className="w-4 h-4" /> },
          { label: "Confirmed", value: bookingStats.confirmed, color: "text-primary", icon: <CheckCircle2 className="w-4 h-4" /> },
          { label: "Completed", value: bookingStats.completed, color: "text-emerald-400", icon: <CheckCircle2 className="w-4 h-4" /> },
          { label: "Cancelled", value: bookingStats.cancelled, color: "text-red-400", icon: <XCircle className="w-4 h-4" /> },
        ].map(stat => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} color={stat.color} />
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
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
          <div className="h-6 w-px bg-border/30 mx-1" />
          <button
            onClick={() => setSortBy(sortBy === "date" ? "priority" : "date")}
            className={`px-3 py-2 font-mono text-xs tracking-wider uppercase transition-colors border ${
              sortBy === "priority" ? "border-amber-500/30 text-amber-400 bg-amber-500/10" : "border-border/30 text-foreground/60 hover:text-foreground"
            }`}
          >
            {sortBy === "priority" ? "⚡ Priority" : "📅 Date"}
          </button>
          <button onClick={() => refetch()} className="p-2 text-foreground/50 hover:text-primary transition-colors ml-2">
            <RefreshCw className="w-4 h-4" />
          </button>
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
          <p className="font-heading font-bold text-xl text-foreground/40 tracking-wider">NO BOOKINGS</p>
          <p className="text-foreground/30 font-mono text-sm mt-2">Bookings from the website will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredBookings.map(booking => {
            const priorityLevel = booking.priority || 0;
            const borderColor = priorityLevel >= 2 ? "border-red-500/30" : priorityLevel >= 1 ? "border-amber-500/30" : "border-border/30";

            return (
              <div key={booking.id} className={`bg-card border ${borderColor} p-6 hover:border-border/50 transition-colors`}>
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="flex-1 space-y-3">
                    {/* Header: Name + Status + Priority */}
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-heading font-bold text-lg text-foreground tracking-wider">{booking.name}</h3>
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 border font-mono text-xs tracking-wider ${BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.color} ${BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.bgColor}`}>
                        {BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.icon}
                        {BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.label}
                      </span>
                      {priorityLevel > 0 && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 border font-mono text-[10px] tracking-wider ${
                          priorityLevel >= 2 ? "text-red-400 bg-red-500/10 border-red-500/30" : "text-amber-400 bg-amber-500/10 border-amber-500/30"
                        }`}>
                          <AlertTriangle className="w-3 h-3" />
                          {priorityLevel >= 2 ? "URGENT" : "HIGH"}
                        </span>
                      )}
                    </div>

                    {/* Contact + Vehicle Info Grid */}
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
                        <Wrench className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-mono text-sm">{booking.service}</span>
                      </div>
                      {(booking.vehicleYear || booking.vehicleMake || booking.vehicle) && (
                        <div className="flex items-center gap-2 text-foreground/70">
                          <Car className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-mono text-sm">
                            {booking.vehicleYear && booking.vehicleMake
                              ? `${booking.vehicleYear} ${booking.vehicleMake} ${booking.vehicleModel || ""}`.trim()
                              : booking.vehicle}
                          </span>
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

                    {/* Customer Message */}
                    {booking.message && (
                      <div className="flex items-start gap-2 text-foreground/60 bg-nick-dark/50 p-3 border border-border/20">
                        <MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <p className="font-mono text-sm leading-relaxed">{booking.message}</p>
                      </div>
                    )}

                    {/* Customer Photos */}
                    <BookingPhotoThumbnails photoUrlsJson={booking.photoUrls} />

                    {/* Priority Selector */}
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[10px] text-foreground/30 tracking-wider uppercase">Priority:</span>
                      <PrioritySelector bookingId={booking.id} currentPriority={booking.priority || 0} />
                    </div>

                    {/* Admin Notes */}
                    <BookingNotesEditor bookingId={booking.id} initialNotes={booking.adminNotes} />

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
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LEADS SECTION ──────────────────────────────────────

