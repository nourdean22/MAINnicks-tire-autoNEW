/**
 * CustomerDrawer — Shows customer details in a side drawer.
 */
import { trpc } from "@/lib/trpc";
import { SideDrawer } from "./SideDrawer";
import { Phone, Mail, MapPin, Calendar, Hash, MessageSquare, Loader2 } from "lucide-react";
import { BUSINESS } from "@shared/business";

interface Props {
  customerId: number | null;
  onClose: () => void;
  onNavigateToSection?: (section: string, filter?: string) => void;
}

export function CustomerDrawer({ customerId, onClose, onNavigateToSection }: Props) {
  const { data: customer, isLoading } = trpc.customers.getById.useQuery(
    { id: customerId! },
    { enabled: !!customerId }
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

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-background/50 border border-border/20 p-3">
              <span className="text-[10px] text-foreground/40 tracking-wide block">Visits</span>
              <span className="text-lg font-bold text-foreground">{customer.totalVisits ?? 0}</span>
            </div>
            <div className="bg-background/50 border border-border/20 p-3">
              <span className="text-[10px] text-foreground/40 tracking-wide block">Last Visit</span>
              <span className="text-sm font-medium text-foreground">
                {customer.lastVisitDate
                  ? new Date(customer.lastVisitDate).toLocaleDateString()
                  : "Never"}
              </span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-semibold text-foreground/40 tracking-wider uppercase">Quick Actions</h4>
            <div className="grid grid-cols-2 gap-2">
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
