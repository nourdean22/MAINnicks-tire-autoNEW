import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "../shared";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import {
  Phone, Mail, MapPin, MessageSquare, Loader2,
  Car, ExternalLink, Hash, Wrench, FileWarning,
  Clock, DollarSign, Building2, Crown, AlertTriangle,
  CheckCircle2, XCircle, ArrowLeft, Edit2, Save, Undo
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { FollowUpButton } from "./FollowUpButton";
import { toast } from "sonner";
import type { CustomerHistoryInvoice, CustomerDeclinedEstimate, CustomerOpenWorkOrder } from "./format";

interface Props {
  customerId: number;
  onClose: () => void;
}

type TabType = "history" | "declined" | "backlog";

const EVENT_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string }> = {
  booking: { icon: <Clock className="w-3.5 h-3.5" />, color: "text-blue-400", bgColor: "bg-blue-500/10" },
  lead: { icon: <UsersIcon className="w-3.5 h-3.5" />, color: "text-amber-400", bgColor: "bg-amber-500/10" },
  callback: { icon: <PhoneCallIcon className="w-3.5 h-3.5" />, color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  call: { icon: <Phone className="w-3.5 h-3.5" />, color: "text-cyan-400", bgColor: "bg-cyan-500/10" },
  workOrder: { icon: <Wrench className="w-3.5 h-3.5" />, color: "text-primary", bgColor: "bg-primary/10" },
  invoice: { icon: <FileTextIcon className="w-3.5 h-3.5" />, color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  chat: { icon: <MessageSquare className="w-3.5 h-3.5" />, color: "text-purple-400", bgColor: "bg-purple-500/10" },
  vapi_call: { icon: <Phone className="w-3.5 h-3.5" />, color: "text-violet-400", bgColor: "bg-violet-500/10" },
};

function UsersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PhoneCallIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      <path d="M14.05 2a9 9 0 0 1 8 8" />
      <path d="M14.05 5.65a4.9 4.9 0 0 1 4.3 4.3" />
    </svg>
  );
}

function FileTextIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

const STATUS_COLORS: Record<string, string> = {
  new: "text-blue-400 bg-blue-500/10",
  confirmed: "text-amber-400 bg-amber-500/10",
  completed: "text-emerald-400 bg-emerald-500/10",
  cancelled: "text-red-400 bg-red-500/10",
  contacted: "text-amber-400 bg-amber-500/10",
  booked: "text-emerald-400 bg-emerald-500/10",
  lost: "text-red-400 bg-red-500/10",
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
  paid: "text-emerald-400 bg-emerald-500/10",
  pending: "text-amber-400 bg-amber-500/10",
  partial: "text-blue-400 bg-blue-500/10",
  refunded: "text-red-400 bg-red-500/10",
};

export default function CustomerProfile({ customerId, onClose }: Props) {
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<TabType>("history");
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesText, setNotesText] = useState("");

  const { data: customer, isLoading: customerLoading, isError: customerError } = trpc.customers.getById.useQuery(
    { id: customerId }
  );

  const { data: timeline, isLoading: timelineLoading } = trpc.customers.timeline.useQuery(
    { phone: customer?.phone || "" },
    { enabled: !!customer?.phone }
  );

  const { data: historyData, isLoading: historyLoading } = trpc.customers.history.useQuery(
    { phone: customer?.phone || "" },
    { enabled: !!customer?.phone }
  );

  const { data: affinityData } = trpc.intelligence.serviceAffinity.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const updateNotesMutation = trpc.customers.updateNotes.useMutation({
    onSuccess: () => {
      toast.success("Notes updated");
      setNotesEditing(false);
      void utils.customers.getById.invalidate({ id: customerId });
    },
    onError: (err) => {
      toast.error("Failed to update notes: " + err.message);
    }
  });

  const handleEditNotes = () => {
    setNotesText(customer?.notes || "");
    setNotesEditing(true);
  };

  const handleSaveNotes = () => {
    updateNotesMutation.mutate({ id: customerId, notes: notesText });
  };

  const daysAgo = useMemo(() => {
    if (!customer?.lastVisitDate) return null;
    return Math.floor((Date.now() - new Date(customer.lastVisitDate).getTime()) / 86400000);
  }, [customer?.lastVisitDate]);

  const avgTicket = useMemo(() => {
    if (!customer || customer.totalVisits === 0) return 0;
    return Math.round(customer.totalSpent / customer.totalVisits / 100);
  }, [customer]);

  const memberSince = useMemo(() => {
    if (!customer) return "Unknown";
    const date = customer.firstVisitDate || customer.createdAt;
    if (!date) return "Unknown";
    return new Date(date).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }, [customer]);

  const affinity = useMemo(() => {
    if (!affinityData?.affinities || !customer) return null;
    return affinityData.affinities.find(a => a.customerId === customerId) || null;
  }, [affinityData, customerId, customer]);

  if (customerLoading) {
    return (
      <div className="flex items-center justify-center py-24 min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (customerError || !customer) {
    return (
      <div className="bg-card border border-border/30 p-8 text-center max-w-md mx-auto my-12">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h3 className="font-bold text-lg text-foreground mb-2">CUSTOMER NOT FOUND</h3>
        <p className="text-foreground/60 text-sm mb-6">The requested customer record does not exist or could not be loaded.</p>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 font-bold text-xs tracking-wider hover:bg-primary/95 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> BACK TO LIST
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top breadcrumb */}
      <div>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Customers
        </button>
      </div>

      {/* Header Info */}
      <div className="bg-card border border-border/30 p-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-bold text-foreground tracking-tight">
                {customer.firstName} {customer.lastName || ""}
              </h2>
              <StatusBadge
                isVip={customer.isVip || customer.totalVisits >= 3}
                churnRisk={customer.churnRisk}
                daysSinceLastVisit={daysAgo}
                totalVisits={customer.totalVisits}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-foreground/50">
              <span>Member since {memberSince}</span>
              {customer.customerType === "commercial" && (
                <span className="flex items-center gap-1 text-primary">
                  <Building2 className="w-3.5 h-3.5" /> Commercial
                </span>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2">
            {customer.phone && (
              <>
                <a
                  href={`tel:${customer.phone}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5" /> CALL
                </a>
                <MessageCustomerLink
                  phone={customer.phone}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold tracking-wider bg-card border border-border/30 text-foreground/70 hover:text-blue-400 hover:border-blue-400/30 transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> SMS
                </MessageCustomerLink>
              </>
            )}
            {customer.email && (
              <a
                href={`mailto:${customer.email}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold tracking-wider bg-card border border-border/30 text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors"
              >
                <Mail className="w-3.5 h-3.5" /> EMAIL
              </a>
            )}
            {customer.alsCustomerId && (
              <a
                href={`https://shopdriver.algauto.com/customers/${customer.alsCustomerId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold tracking-wider bg-card border border-border/30 text-foreground/70 hover:text-purple-400 hover:border-purple-400/30 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" /> ALG
              </a>
            )}
            {customer.phone && (
              <FollowUpButton
                customerName={`${customer.firstName} ${customer.lastName || ""}`.trim()}
                phone={customer.phone}
              />
            )}
          </div>
        </div>

        {/* Contact details list */}
        <div className="mt-4 pt-4 border-t border-border/20 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-foreground/60">
          {customer.phone && (
            <span className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-foreground/30" /> Phone: {customer.phone}
            </span>
          )}
          {customer.phone2 && (
            <span className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-foreground/30" /> Alt Phone: {customer.phone2}
            </span>
          )}
          {customer.email && (
            <span className="flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-foreground/30" /> Email: {customer.email}
            </span>
          )}
          {(customer.city || customer.address) && (
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-foreground/30" /> Address: {[customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wider block mb-1">TOTAL SPENT</span>
          <span className={`font-bold text-xl ${customer.totalSpent > 0 ? "text-emerald-400" : "text-foreground/30"}`}>
            {customer.totalSpent > 0 ? `$${Math.round(customer.totalSpent / 100).toLocaleString()}` : "--"}
          </span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wider block mb-1">TOTAL VISITS</span>
          <span className="font-bold text-xl text-foreground">
            {customer.totalVisits || 0}
          </span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wider block mb-1">AVG TICKET</span>
          <span className={`font-bold text-xl ${avgTicket > 0 ? "text-blue-400" : "text-foreground/30"}`}>
            {avgTicket > 0 ? `$${avgTicket.toLocaleString()}` : "--"}
          </span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wider block mb-1">DAYS SINCE VISIT</span>
          <span className={`font-bold text-xl ${
            daysAgo == null ? "text-foreground/30" :
            daysAgo > 180 ? "text-red-400" :
            daysAgo > 90 ? "text-amber-400" : "text-foreground"
          }`}>
            {daysAgo != null ? daysAgo : "--"}
          </span>
        </div>
        <div className={`bg-card border p-4 ${customer.declinedValue > 0 ? "border-amber-500/30" : "border-border/30"}`}>
          <span className="font-mono text-[10px] text-foreground/40 tracking-wider block mb-1">DECLINED VALUE</span>
          {customer.declinedValue > 0 ? (
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="font-bold text-xl text-amber-400">
                ${Math.round(customer.declinedValue / 100).toLocaleString()}
              </span>
              <span className="text-[9px] text-foreground/40 tracking-wider">{customer.declinedCount || 0} EST</span>
            </div>
          ) : (
            <span className="font-bold text-xl text-foreground/30">--</span>
          )}
        </div>
        <div className={`bg-card border p-4 ${customer.backlogValueCents > 0 ? "border-blue-500/30" : "border-border/30"}`}>
          <span className="font-mono text-[10px] text-foreground/40 tracking-wider block mb-1">BACKLOG VALUE</span>
          {customer.backlogValueCents > 0 ? (
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="font-bold text-xl text-blue-400">
                ${Math.round(customer.backlogValueCents / 100).toLocaleString()}
              </span>
              <span className="text-[9px] text-foreground/40 tracking-wider">{customer.backlogCount || 0} OPEN</span>
            </div>
          ) : (
            <span className="font-bold text-xl text-foreground/30">--</span>
          )}
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wider block mb-1">SERVICE AFFINITY</span>
          {affinity ? (
            <div className="flex flex-col" title={affinity.reason}>
              <span className="text-xs font-bold text-primary truncate max-w-full block capitalize">
                {affinity.predictedNext}
              </span>
              <span className={`text-[10px] font-mono font-semibold ${
                Math.round(affinity.confidence * 100) >= 70 ? "text-emerald-400" :
                Math.round(affinity.confidence * 100) >= 50 ? "text-amber-400" : "text-foreground/40"
              }`}>
                {Math.round(affinity.confidence * 100)}% Confidence
              </span>
            </div>
          ) : (
            <span className="text-xs text-foreground/30 italic block mt-1">not enough data</span>
          )}
        </div>
      </div>

      {/* Main 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column: Notes + Timeline */}
        <div className="lg:col-span-5 space-y-6">
          {/* Notes Section */}
          <div className="bg-card border border-border/30 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-xs tracking-wider text-foreground/40 uppercase">Notes</h4>
              {notesEditing ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleSaveNotes}
                    disabled={updateNotesMutation.isPending}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
                  >
                    <Save className="w-3 h-3" /> SAVE
                  </button>
                  <button
                    onClick={() => setNotesEditing(false)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-foreground/40 hover:text-foreground/60 transition-colors"
                  >
                    <Undo className="w-3 h-3" /> CANCEL
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleEditNotes}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline transition-colors"
                >
                  <Edit2 className="w-3 h-3" /> EDIT
                </button>
              )}
            </div>

            {notesEditing ? (
              <textarea
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                maxLength={5000}
                className="w-full min-h-[120px] bg-background border border-border/50 text-xs p-3 focus:outline-none focus:border-primary/50 text-foreground leading-relaxed resize-y"
                placeholder="Enter customer notes, specific vehicle needs, follow-up preferences..."
              />
            ) : (
              <p className="text-xs text-foreground/75 leading-relaxed bg-background/30 border border-border/15 p-4 rounded-sm whitespace-pre-wrap min-h-[60px]">
                {customer.notes || "No notes on file. Click Edit to add customer notes."}
              </p>
            )}
          </div>

          {/* Vehicle Info */}
          {customer.vehicleMake && (
            <div className="bg-card border border-border/30 p-5">
              <h4 className="font-bold text-xs tracking-wider text-foreground/40 uppercase mb-3 flex items-center gap-1.5">
                <Car className="w-3.5 h-3.5" /> Vehicle
              </h4>
              <p className="text-sm font-semibold text-foreground">
                {[customer.vehicleYear, customer.vehicleMake, customer.vehicleModel].filter(Boolean).join(" ")}
              </p>
            </div>
          )}

          {/* Timeline Section */}
          <div className="bg-card border border-border/30 p-5 space-y-4">
            <h4 className="font-bold text-xs tracking-wider text-foreground/40 uppercase flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Interaction Timeline
            </h4>

            {timelineLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
              </div>
            ) : !timeline || timeline.length === 0 ? (
              <p className="text-xs text-foreground/35 py-4 italic text-center">No interactions recorded yet.</p>
            ) : (
              <div className="relative space-y-0 pl-1">
                {/* Vertical line */}
                <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border/20" />
                {timeline.map((event, i) => {
                  const cfg = EVENT_CONFIG[event.type] || EVENT_CONFIG.call;
                  const statusCls = STATUS_COLORS[event.status] || "text-foreground/50 bg-foreground/5";
                  return (
                    <div key={i} className="relative flex items-start gap-3 py-3">
                      {/* Icon Container */}
                      <div className={`relative z-10 w-[23px] h-[23px] flex items-center justify-center rounded-full shrink-0 ${cfg.bgColor}`}>
                        <span className={cfg.color}>{cfg.icon}</span>
                      </div>
                      {/* Event Details */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-foreground">{event.title}</span>
                          <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${statusCls}`}>
                            {event.status?.replace(/_/g, " ").toUpperCase()}
                          </span>
                          {event.amount !== undefined && event.amount > 0 && (
                            <span className="text-[10px] font-mono text-emerald-400 font-medium">
                              ${(event.amount / 100).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {event.detail && (
                          <p className="text-xs text-foreground/50 mt-1 leading-relaxed">{event.detail}</p>
                        )}
                        <p className="text-[10px] text-foreground/30 mt-1">
                          {new Date(event.date).toLocaleDateString()} {new Date(event.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Invoices, Declined Work, Backlog */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-card border border-border/30">
            {/* Tabs Header */}
            <div className="flex border-b border-border/20 overflow-x-auto">
              {[
                { id: "history", label: "Service History", count: historyData?.invoices?.length || 0 },
                { id: "declined", label: "Declined Work", count: historyData?.declinedEstimates?.length || 0 },
                { id: "backlog", label: "Active Backlog", count: historyData?.openWorkOrders?.length || 0 },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as TabType)}
                  className={`flex items-center gap-2 px-5 py-4 font-bold text-xs tracking-wider border-b-2 whitespace-nowrap transition-colors ${
                    activeTab === t.id
                      ? "text-primary border-primary bg-foreground/[0.01]"
                      : "text-foreground/40 border-transparent hover:text-foreground/70"
                  }`}
                >
                  {t.label}
                  <span className={`px-1.5 py-0.5 text-[9px] font-mono font-bold rounded-full ${
                    activeTab === t.id ? "bg-primary/20 text-primary" : "bg-foreground/5 text-foreground/45"
                  }`}>
                    {t.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Tab Panels */}
            <div className="p-5">
              {historyLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : (
                <>
                  {/* Service History Tab */}
                  {activeTab === "history" && (
                    <div className="overflow-x-auto">
                      {!historyData?.invoices || historyData.invoices.length === 0 ? (
                        <p className="text-xs text-foreground/40 italic py-6 text-center">No service history invoices found.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border/20 text-foreground/40 font-mono tracking-wider">
                              <th className="text-left py-2 pr-3">DATE</th>
                              <th className="text-left py-2 pr-3">INV #</th>
                              <th className="text-left py-2 pr-3">SERVICE</th>
                              <th className="text-left py-2 pr-3">VEHICLE</th>
                              <th className="text-right py-2 pr-3">AMOUNT</th>
                              <th className="text-left py-2">STATUS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyData.invoices.map((inv: CustomerHistoryInvoice) => (
                              <tr key={inv.id} className="border-b border-border/10 hover:bg-foreground/[0.01]">
                                <td className="py-2.5 pr-3 text-foreground/50 whitespace-nowrap">
                                  {formatDate(inv.invoiceDate)}
                                </td>
                                <td className="py-2.5 pr-3 text-foreground/70 font-mono">
                                  {inv.invoiceNumber || `#${inv.id}`}
                                </td>
                                <td className="py-2.5 pr-3 text-foreground/80 max-w-[200px] truncate" title={inv.serviceDescription || undefined}>
                                  {inv.serviceDescription || "--"}
                                </td>
                                <td className="py-2.5 pr-3 text-foreground/50 max-w-[120px] truncate" title={inv.vehicleInfo || undefined}>
                                  {inv.vehicleInfo || "--"}
                                </td>
                                <td className="py-2.5 pr-3 text-right font-mono text-emerald-400 font-semibold whitespace-nowrap">
                                  ${Math.round(inv.totalAmount / 100).toLocaleString()}
                                </td>
                                <td className="py-2.5 whitespace-nowrap">
                                  <span className={`text-[9px] tracking-wider font-bold px-1.5 py-0.5 rounded ${
                                    inv.paymentStatus === "paid" ? "text-emerald-400 bg-emerald-500/10" :
                                    inv.paymentStatus === "pending" ? "text-amber-400 bg-amber-500/10" :
                                    inv.paymentStatus === "partial" ? "text-blue-400 bg-blue-500/10" :
                                    "text-red-400 bg-red-500/10"
                                  }`}>
                                    {(inv.paymentStatus || "unknown").toUpperCase()}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {/* Declined Work Tab */}
                  {activeTab === "declined" && (
                    <div className="overflow-x-auto">
                      {!historyData?.declinedEstimates || historyData.declinedEstimates.length === 0 ? (
                        <p className="text-xs text-foreground/40 italic py-6 text-center">No declined estimates found.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border/20 text-foreground/40 font-mono tracking-wider">
                              <th className="text-left py-2 pr-3">DATE</th>
                              <th className="text-left py-2 pr-3">EST #</th>
                              <th className="text-left py-2 pr-3">SERVICE</th>
                              <th className="text-left py-2 pr-3">VEHICLE</th>
                              <th className="text-right py-2 pr-3">QUOTED</th>
                              <th className="text-left py-2">FOLLOW-UP</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyData.declinedEstimates.map((est: CustomerDeclinedEstimate) => (
                              <tr key={est.id} className="border-b border-border/10 hover:bg-foreground/[0.01]">
                                <td className="py-2.5 pr-3 text-foreground/50 whitespace-nowrap">
                                  {formatDate(est.estimateDate)}
                                </td>
                                <td className="py-2.5 pr-3 text-foreground/70 font-mono">
                                  {est.externalId}
                                </td>
                                <td className="py-2.5 pr-3 text-foreground/80 max-w-[200px] truncate" title={est.serviceDescription || undefined}>
                                  {est.serviceDescription || "—"}
                                </td>
                                <td className="py-2.5 pr-3 text-foreground/50 max-w-[120px] truncate" title={est.vehicleInfo || undefined}>
                                  {est.vehicleInfo || "—"}
                                </td>
                                <td className="py-2.5 pr-3 text-right font-mono text-amber-400 font-semibold whitespace-nowrap">
                                  ${Math.round(est.estimatedAmount / 100).toLocaleString()}
                                </td>
                                <td className="py-2.5 whitespace-nowrap">
                                  {est.followUp30dSent ? (
                                    <span className="text-[9px] tracking-wider font-bold px-1.5 py-0.5 text-foreground/45 bg-foreground/5 rounded">30D SENT</span>
                                  ) : est.followUp7dSent ? (
                                    <span className="text-[9px] tracking-wider font-bold px-1.5 py-0.5 text-blue-400 bg-blue-500/10 rounded">7D SENT</span>
                                  ) : (
                                    <span className="text-[9px] tracking-wider font-bold px-1.5 py-0.5 text-red-400 bg-red-500/10 rounded">PENDING</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {/* Active Backlog Tab */}
                  {activeTab === "backlog" && (
                    <div className="overflow-x-auto">
                      {!historyData?.openWorkOrders || historyData.openWorkOrders.length === 0 ? (
                        <p className="text-xs text-foreground/40 italic py-6 text-center">No active work orders found.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border/20 text-foreground/40 font-mono tracking-wider">
                              <th className="text-left py-2 pr-3">CREATED</th>
                              <th className="text-left py-2 pr-3">WO #</th>
                              <th className="text-left py-2 pr-3">SERVICE</th>
                              <th className="text-left py-2 pr-3">VEHICLE</th>
                              <th className="text-left py-2 pr-3">PROMISED</th>
                              <th className="text-right py-2 pr-3">QUOTED</th>
                              <th className="text-left py-2">STATUS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyData.openWorkOrders.map((wo: CustomerOpenWorkOrder) => (
                              <tr key={wo.id} className="border-b border-border/10 hover:bg-foreground/[0.01]">
                                <td className="py-2.5 pr-3 text-foreground/50 whitespace-nowrap">
                                  {formatDate(wo.createdAt)}
                                </td>
                                <td className="py-2.5 pr-3 text-foreground/70 font-mono">
                                  {wo.orderNumber}
                                </td>
                                <td className="py-2.5 pr-3 text-foreground/80 max-w-[180px] truncate" title={wo.serviceDescription || undefined}>
                                  {wo.serviceDescription || "—"}
                                </td>
                                <td className="py-2.5 pr-3 text-foreground/50 max-w-[120px] truncate">
                                  {[wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ") || "—"}
                                </td>
                                <td className="py-2.5 pr-3 text-foreground/50 whitespace-nowrap">
                                  {formatDate(wo.promisedAt)}
                                </td>
                                <td className="py-2.5 pr-3 text-right font-mono text-blue-400 font-semibold whitespace-nowrap">
                                  {wo.total ? `$${Math.round(Number(wo.total)).toLocaleString()}` : "—"}
                                </td>
                                <td className="py-2.5 whitespace-nowrap">
                                  <span className="text-[9px] tracking-wider font-bold px-1.5 py-0.5 text-blue-400 bg-blue-500/10 rounded">
                                    {(wo.status || "draft").replace(/_/g, " ").toUpperCase()}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
