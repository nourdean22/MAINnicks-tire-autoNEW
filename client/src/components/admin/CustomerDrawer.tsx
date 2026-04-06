/**
 * CustomerDrawer — Shows customer details + chronological timeline in a side drawer.
 */
import { trpc } from "@/lib/trpc";
import { SideDrawer } from "./SideDrawer";
import {
  Phone, Mail, MapPin, Calendar, Hash, MessageSquare, Loader2,
  CalendarClock, Users, PhoneCall, Clock, CheckCircle2, XCircle,
  Wrench, FileText, DollarSign, TrendingUp,
} from "lucide-react";
import { BUSINESS } from "@shared/business";

interface Props {
  customerId: number | null;
  onClose: () => void;
  onNavigateToSection?: (section: string, filter?: string) => void;
}

const EVENT_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string }> = {
  booking: { icon: <CalendarClock className="w-3.5 h-3.5" />, color: "text-blue-400", bgColor: "bg-blue-500/10" },
  lead: { icon: <Users className="w-3.5 h-3.5" />, color: "text-amber-400", bgColor: "bg-amber-500/10" },
  callback: { icon: <PhoneCall className="w-3.5 h-3.5" />, color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  call: { icon: <Phone className="w-3.5 h-3.5" />, color: "text-cyan-400", bgColor: "bg-cyan-500/10" },
  workOrder: { icon: <Wrench className="w-3.5 h-3.5" />, color: "text-primary", bgColor: "bg-primary/10" },
  invoice: { icon: <FileText className="w-3.5 h-3.5" />, color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
};

const STATUS_COLORS: Record<string, string> = {
  new: "text-blue-400 bg-blue-500/10",
  confirmed: "text-amber-400 bg-amber-500/10",
  completed: "text-emerald-400 bg-emerald-500/10",
  cancelled: "text-red-400 bg-red-500/10",
  contacted: "text-amber-400 bg-amber-500/10",
  booked: "text-emerald-400 bg-emerald-500/10",
  lost: "text-red-400 bg-red-500/10",
  // Work order statuses
  draft: "text-foreground/50 bg-foreground/5",
  approved: "text-blue-400 bg-blue-500/10",
  in_progress: "text-primary bg-primary/10",
  parts_needed: "text-amber-400 bg-amber-500/10",
  parts_ordered: "text-amber-400 bg-amber-500/10",
  ready_for_pickup: "text-emerald-400 bg-emerald-500/10",
  invoiced: "text-emerald-400 bg-emerald-500/10",
  picked_up: "text-emerald-400 bg-emerald-500/10",
  closed: "text-foreground/40 bg-foreground/5",
  on_hold: "text-amber-400 bg-amber-500/10",
  // Invoice statuses
  paid: "text-emerald-400 bg-emerald-500/10",
  pending: "text-amber-400 bg-amber-500/10",
  partial: "text-blue-400 bg-blue-500/10",
  refunded: "text-red-400 bg-red-500/10",
};

export function CustomerDrawer({ customerId, onClose, onNavigateToSection }: Props) {
  const { data: customer, isLoading } = trpc.customers.getById.useQuery(
    { id: customerId! },
    { enabled: !!customerId }
  );

  const { data: timeline, isLoading: timelineLoading } = trpc.customers.timeline.useQuery(
    { phone: customer?.phone || "" },
    { enabled: !!customer?.phone }
  );

  return (
    <SideDrawer isOpen={!!customerId} onClose={onClose} title="Customer Details" width="md">
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
        </div>
      ) : !customer ? (
        <div className="p-5 text-sm text-foreground/50">Customer not found.</div>
      ) : (
        <div className="p-5 space-y-5">
          {/* Name */}
          <div>
            <h3 className="text-lg font-bold text-foreground tracking-tight">
              {customer.firstName} {customer.lastName || ""}
            </h3>
            <span className={`inline-flex items-center px-2 py-0.5 mt-1 text-[10px] tracking-wider ${
              customer.segment === "recent" ? "text-emerald-400 bg-emerald-500/10" :
              customer.segment === "lapsed" ? "text-amber-400 bg-amber-500/10" :
              "text-foreground/50 bg-foreground/5"
            }`}>
              {(customer.segment || "unknown").toUpperCase()}
            </span>
          </div>

          {/* Contact info */}
          <div className="space-y-3">
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className="flex items-center gap-2.5 text-sm text-foreground hover:text-primary transition-colors">
                <Phone className="w-4 h-4 text-primary" />
                {customer.phone}
              </a>
            )}
            {customer.email && (
              <a href={`mailto:${customer.email}`} className="flex items-center gap-2.5 text-sm text-foreground hover:text-primary transition-colors">
                <Mail className="w-4 h-4 text-foreground/40" />
                {customer.email}
              </a>
            )}
            {customer.city && (
              <div className="flex items-center gap-2.5 text-sm text-foreground/60">
                <MapPin className="w-4 h-4 text-foreground/40" />
                {customer.city}
              </div>
            )}
          </div>

          {/* Stats + Revenue */}
          {(() => {
            const woEvents = timeline?.filter((e: any) => e.type === "workOrder") ?? [];
            const invoiceEvents = timeline?.filter((e: any) => e.type === "invoice") ?? [];
            const totalSpent = invoiceEvents.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
            const activeWOs = woEvents.filter((e: any) => !["invoiced", "closed", "picked_up", "cancelled"].includes(e.status));
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-background/50 border border-border/20 p-3">
                  <span className="text-[10px] text-foreground/40 tracking-wide block">Visits</span>
                  <span className="text-lg font-bold text-foreground">{customer.totalVisits ?? 0}</span>
                </div>
                <div className="bg-background/50 border border-border/20 p-3">
                  <span className="text-[10px] text-foreground/40 tracking-wide block">Total Spent</span>
                  <span className="text-lg font-bold text-emerald-400">
                    ${(totalSpent / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="bg-background/50 border border-border/20 p-3">
                  <span className="text-[10px] text-foreground/40 tracking-wide block">Invoices</span>
                  <span className="text-lg font-bold text-foreground">{invoiceEvents.length}</span>
                </div>
                <div className="bg-background/50 border border-border/20 p-3">
                  <span className="text-[10px] text-foreground/40 tracking-wide block">Active WOs</span>
                  <span className={`text-lg font-bold ${activeWOs.length > 0 ? "text-primary" : "text-foreground/30"}`}>
                    {activeWOs.length}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Quick actions */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-semibold text-foreground/40 tracking-wider uppercase">Quick Actions</h4>
            <div className="grid grid-cols-3 gap-2">
              {customer.phone && (
                <a
                  href={`tel:${customer.phone}`}
                  className="flex items-center gap-2 px-3 py-2 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5" /> Call
                </a>
              )}
              {customer.phone && (
                <a
                  href={`sms:${customer.phone}`}
                  className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Text
                </a>
              )}
              {onNavigateToSection && (
                <button
                  onClick={() => { onClose(); onNavigateToSection("workOrders"); }}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 text-blue-400 text-xs font-medium hover:bg-blue-500/20 transition-colors"
                >
                  <Wrench className="w-3.5 h-3.5" /> Work Orders
                </button>
              )}
            </div>
          </div>

          {/* Notes */}
          {customer.notes && (
            <div>
              <h4 className="text-[10px] font-semibold text-foreground/40 tracking-wider uppercase mb-2">Notes</h4>
              <p className="text-xs text-foreground/60 leading-relaxed bg-background/50 border border-border/20 p-3">
                {customer.notes}
              </p>
            </div>
          )}

          {/* ─── INTERACTION TIMELINE ─── */}
          <div>
            <h4 className="text-[10px] font-semibold text-foreground/40 tracking-wider uppercase mb-3 flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> Interaction Timeline
            </h4>
            {timelineLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-primary/60" />
              </div>
            ) : !timeline || timeline.length === 0 ? (
              <p className="text-xs text-foreground/30 py-4">No interactions recorded yet.</p>
            ) : (
              <div className="relative space-y-0">
                {/* Vertical line */}
                <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border/30" />
                {timeline.map((event, i) => {
                  const cfg = EVENT_CONFIG[event.type] || EVENT_CONFIG.call;
                  const statusCls = STATUS_COLORS[event.status] || "text-foreground/50 bg-foreground/5";
                  return (
                    <div key={i} className="relative flex items-start gap-3 py-2.5 pl-0">
                      {/* Dot */}
                      <div className={`relative z-10 w-[23px] h-[23px] flex items-center justify-center rounded-full shrink-0 ${cfg.bgColor}`}>
                        <span className={cfg.color}>{cfg.icon}</span>
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-foreground truncate">{event.title}</span>
                          <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${statusCls}`}>
                            {event.status?.replace(/_/g, " ").toUpperCase()}
                          </span>
                          {(event as any).amount > 0 && (
                            <span className="text-[10px] font-mono text-emerald-400/70">
                              ${((event as any).amount / 100).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {event.detail && (
                          <p className="text-[11px] text-foreground/40 truncate mt-0.5">{event.detail}</p>
                        )}
                        <p className="text-[10px] text-foreground/30 mt-0.5">
                          {new Date(event.date).toLocaleDateString()} {new Date(event.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cross-links */}
          {onNavigateToSection && (
            <div className="pt-3 border-t border-border/20 space-y-2">
              <button
                onClick={() => { onClose(); onNavigateToSection("bookings"); }}
                className="text-xs text-primary hover:underline"
              >
                View Bookings &rarr;
              </button>
              <button
                onClick={() => { onClose(); onNavigateToSection("sms"); }}
                className="block text-xs text-primary hover:underline"
              >
                View SMS History &rarr;
              </button>
            </div>
          )}
        </div>
      )}
    </SideDrawer>
  );
}
