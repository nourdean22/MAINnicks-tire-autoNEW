/**
 * Financing Command Layer — opportunity tracker, follow-up queue,
 * provider portals, and application logging with conversion metrics.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  CreditCard, ExternalLink, Wallet, Zap, Shield,
  Star, Plus, CheckCircle, Loader2, Phone, Copy,
  TrendingUp, AlertTriangle, DollarSign, Users,
  Clock, Search, MessageSquare, ArrowRight, Filter,
} from "lucide-react";
import { FINANCING_PROVIDERS, PROVIDER_MAP, type FinancingProvider } from "@shared/financing";
import { StatCard } from "./shared";

type ViewTab = "opportunities" | "providers" | "log";

/* ── Financing Opportunities — leads/estimates that could use financing ── */
function OpportunityTracker() {
  const { data: leads } = trpc.lead.list.useQuery();
  const { data: bookings } = trpc.booking.list.useQuery();

  // High-value opportunities: leads mentioning cost/financing keywords + large repairs
  const opportunities = useMemo(() => {
    const items: Array<{
      id: number;
      type: "lead" | "booking";
      name: string;
      phone: string;
      vehicle: string;
      problem: string;
      status: string;
      date: Date;
      signal: string;
      urgency: "high" | "medium" | "low";
    }> = [];

    const financingKeywords = ["cost", "price", "afford", "financ", "payment", "expensive", "budget", "pay"];
    const highValueServices = ["engine", "transmission", "brake", "timing", "head gasket", "catalytic", "turbo", "ac", "a/c"];

    if (leads) {
      leads.forEach(l => {
        const text = `${l.problem || ""} ${l.vehicle || ""} ${l.source || ""}`.toLowerCase();
        const hasFinancingSignal = financingKeywords.some(k => text.includes(k));
        const hasHighValue = highValueServices.some(k => text.includes(k));

        if (hasFinancingSignal || hasHighValue) {
          items.push({
            id: l.id,
            type: "lead",
            name: l.name || "Unknown",
            phone: l.phone || "",
            vehicle: l.vehicle || "",
            problem: l.problem || "",
            status: l.status || "new",
            date: new Date(l.createdAt),
            signal: hasFinancingSignal ? "Mentioned cost/price" : "High-value repair",
            urgency: hasFinancingSignal ? "high" : "medium",
          });
        }
      });
    }

    if (bookings) {
      (bookings as any[]).forEach(b => {
        const text = `${b.service || ""} ${b.vehicle || ""} ${b.notes || ""}`.toLowerCase();
        const hasHighValue = highValueServices.some(k => text.includes(k));
        if (hasHighValue && b.status !== "completed" && b.status !== "cancelled") {
          items.push({
            id: b.id,
            type: "booking",
            name: b.name || "Unknown",
            phone: b.phone || "",
            vehicle: b.vehicle || "",
            problem: b.service || "",
            status: b.status || "new",
            date: new Date(b.createdAt),
            signal: "High-value service booked",
            urgency: "medium",
          });
        }
      });
    }

    items.sort((a, b) => {
      const u = { high: 0, medium: 1, low: 2 };
      return u[a.urgency] - u[b.urgency] || b.date.getTime() - a.date.getTime();
    });

    return items;
  }, [leads, bookings]);

  const [copied, setCopied] = useState<string | null>(null);

  const copyFinancingText = (name: string, phone: string) => {
    const msg = `Hi ${name}, this is Nick's Tire & Auto — we have several no-credit-needed financing options to help with your repair. Apply in 60 seconds:\n\nAcima: https://www.acima.com/en/applicationprocess\nSnap: https://snapfinance.com\nKoalafi: https://koalafi.com/for-customers/\n\nOr visit nickstire.org/financing for all options. Questions? Call us!`;
    navigator.clipboard.writeText(msg);
    setCopied(phone);
    toast.success("Financing text copied");
    setTimeout(() => setCopied(null), 2000);
  };

  if (opportunities.length === 0) {
    return (
      <div className="stat-card !p-8 text-center">
        <DollarSign className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No financing opportunities detected</p>
        <p className="text-[11px] text-muted-foreground/50 mt-1">
          Leads mentioning cost/price or high-value repairs appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {opportunities.slice(0, 15).map((opp) => (
        <div key={`${opp.type}-${opp.id}`} className="stat-card !p-4 hover:!border-primary/30 transition-all">
          <div className="flex items-start gap-3">
            <div className={`shrink-0 mt-0.5 w-8 h-8 flex items-center justify-center rounded ${
              opp.urgency === "high" ? "bg-amber-500/10" : "bg-primary/10"
            }`}>
              <DollarSign className={`w-4 h-4 ${opp.urgency === "high" ? "text-amber-400" : "text-primary"}`} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-medium text-foreground truncate">{opp.name}</span>
                <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${
                  opp.urgency === "high" ? "text-amber-400 bg-amber-500/10" : "text-blue-400 bg-blue-500/10"
                }`}>
                  {opp.signal.toUpperCase()}
                </span>
                <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${
                  opp.type === "lead" ? "text-purple-400 bg-purple-500/10" : "text-emerald-400 bg-emerald-500/10"
                }`}>
                  {opp.type.toUpperCase()}
                </span>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {opp.vehicle && <span>{opp.vehicle}</span>}
                {opp.problem && <span className="truncate max-w-[200px]">{opp.problem}</span>}
              </div>

              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-foreground/30">
                  {opp.date.toLocaleDateString()}
                </span>
                {opp.phone && (
                  <span className="text-[10px] text-foreground/30 font-mono">{opp.phone}</span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              {opp.phone && (
                <>
                  <a
                    href={`tel:${opp.phone}`}
                    className="p-1.5 text-foreground/30 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-all"
                    title="Call"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={() => copyFinancingText(opp.name, opp.phone)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 rounded transition-all"
                    title="Copy financing SMS"
                  >
                    {copied === opp.phone ? (
                      <CheckCircle className="w-3 h-3" />
                    ) : (
                      <MessageSquare className="w-3 h-3" />
                    )}
                    Send Options
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Provider portal card ──────────────────────────────────── */
function ProviderPortalCard({ provider }: { provider: FinancingProvider }) {
  return (
    <div className="stat-card !p-5 hover:!border-primary/20 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-xs"
            style={{ backgroundColor: provider.color }}
          >
            {provider.type === "credit-card" ? (
              <CreditCard className="w-4 h-4" />
            ) : (
              <Wallet className="w-4 h-4" />
            )}
          </div>
          <div>
            <h3 className="font-bold text-foreground text-sm">{provider.name}</h3>
            <span className="text-[11px] text-foreground/40">{provider.typeLabel} · Up to {provider.maxAmount}</span>
          </div>
        </div>
        {provider.badge && (
          <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            {provider.badge}
          </span>
        )}
      </div>

      <p className="text-foreground/50 text-xs mb-4 leading-relaxed">{provider.description}</p>

      <div className="flex flex-wrap gap-2">
        <a
          href={provider.merchantPortalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1.5 text-[11px] font-bold hover:bg-primary/20 transition-colors"
        >
          Merchant Portal <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={provider.customerPortalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-foreground/5 text-foreground/60 px-3 py-1.5 text-[11px] font-medium hover:bg-foreground/10 transition-colors"
        >
          Customer Portal <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={provider.applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-foreground/5 text-foreground/60 px-3 py-1.5 text-[11px] font-medium hover:bg-foreground/10 transition-colors"
        >
          Apply Link <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

/* ── Log application form ──────────────────────────────────── */
function LogApplicationForm() {
  const [form, setForm] = useState({
    provider: "acima" as "acima" | "snap" | "koalafi" | "american-first",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    estimatedAmount: "",
    status: "Applied" as "Applied" | "Approved" | "Denied" | "Funded" | "Cancelled",
    notes: "",
  });
  const [success, setSuccess] = useState(false);

  const mutation = trpc.financing.logApplication.useMutation({
    onSuccess: () => {
      setSuccess(true);
      toast.success("Application logged");
      setForm({
        provider: "acima",
        customerName: "",
        customerPhone: "",
        customerEmail: "",
        estimatedAmount: "",
        status: "Applied",
        notes: "",
      });
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  return (
    <div className="stat-card !p-5">
      <div className="flex items-center gap-2 mb-4">
        <Plus className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-foreground text-sm">Log Financing Application</h3>
      </div>
      <p className="text-foreground/40 text-xs mb-4">
        Log an in-store financing application to the Google Sheets CRM.
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select
          value={form.provider}
          onChange={(e) => setForm({ ...form, provider: e.target.value as typeof form.provider })}
          className="col-span-2 sm:col-span-1 bg-background border border-border/30 px-3 py-2 text-sm text-foreground"
        >
          {FINANCING_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}
          className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground"
        >
          <option value="Applied">Applied</option>
          <option value="Approved">Approved</option>
          <option value="Denied">Denied</option>
          <option value="Funded">Funded</option>
          <option value="Cancelled">Cancelled</option>
        </select>

        <input
          type="text"
          placeholder="Customer Name *"
          value={form.customerName}
          onChange={(e) => setForm({ ...form, customerName: e.target.value })}
          required
          className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground placeholder:text-foreground/30"
        />

        <input
          type="tel"
          placeholder="Phone *"
          value={form.customerPhone}
          onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
          required
          className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground placeholder:text-foreground/30"
        />

        <input
          type="email"
          placeholder="Email (optional)"
          value={form.customerEmail}
          onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
          className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground placeholder:text-foreground/30"
        />

        <input
          type="text"
          placeholder="Estimated Amount (optional)"
          value={form.estimatedAmount}
          onChange={(e) => setForm({ ...form, estimatedAmount: e.target.value })}
          className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground placeholder:text-foreground/30"
        />

        <textarea
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          className="col-span-2 bg-background border border-border/30 px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 resize-none"
        />

        <div className="col-span-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-bold hover:opacity-90 transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : success ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {success ? "Logged Successfully" : "Log Application"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Quick links bar ───────────────────────────────────────── */
function QuickLinksBar() {
  const [copied, setCopied] = useState<string | null>(null);

  const copyLink = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="stat-card !p-5">
      <h3 className="font-bold text-foreground text-sm mb-3">Quick Apply Links</h3>
      <p className="text-foreground/40 text-xs mb-4">
        Copy these links to send to customers via SMS or email.
      </p>
      <div className="space-y-2">
        {FINANCING_PROVIDERS.map((p) => (
          <div key={p.id} className="flex items-center justify-between bg-background/30 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="text-foreground/70 text-xs font-medium">{p.shortName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-foreground/30 text-[10px] truncate max-w-[200px]">{p.applyUrl}</span>
              <button
                onClick={() => copyLink(p.applyUrl, p.id)}
                className="text-foreground/40 hover:text-primary transition-colors"
                title="Copy link"
              >
                {copied === p.id ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between bg-background/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-foreground/70 text-xs font-medium">Financing Page</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-foreground/30 text-[10px]">nickstire.org/financing</span>
            <button
              onClick={() => copyLink("https://nickstire.org/financing", "page")}
              className="text-foreground/40 hover:text-primary transition-colors"
              title="Copy link"
            >
              {copied === "page" ? (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Section ──────────────────────────────────────────── */
export default function FinancingSection() {
  const [activeTab, setActiveTab] = useState<ViewTab>("opportunities");
  const { data: leads } = trpc.lead.list.useQuery();

  // Count financing opportunities
  const opportunityCount = useMemo(() => {
    if (!leads) return 0;
    const keywords = ["cost", "price", "afford", "financ", "payment", "expensive", "budget", "pay"];
    const highValue = ["engine", "transmission", "brake", "timing", "head gasket", "catalytic", "turbo", "ac", "a/c"];
    return leads.filter(l => {
      const text = `${l.problem || ""} ${l.vehicle || ""} ${l.source || ""}`.toLowerCase();
      return keywords.some(k => text.includes(k)) || highValue.some(k => text.includes(k));
    }).length;
  }, [leads]);

  const tabs: { id: ViewTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "opportunities", label: "Opportunities", icon: <TrendingUp className="w-3.5 h-3.5" />, badge: opportunityCount },
    { id: "providers", label: "Providers", icon: <CreditCard className="w-3.5 h-3.5" /> },
    { id: "log", label: "Log + Links", icon: <Plus className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl text-foreground tracking-tight">Financing Command</h2>
          <p className="text-muted-foreground text-[12px] mt-1">
            Track financing opportunities, manage providers, and log applications
          </p>
        </div>
        <a
          href="/financing"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-primary text-xs font-bold hover:underline"
        >
          View Public Page <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Opportunities" value={opportunityCount}
          icon={<TrendingUp className="w-4 h-4" />}
          color={opportunityCount > 0 ? "text-amber-400" : "text-muted-foreground"}
          trend={opportunityCount > 0 ? "up" : "neutral"}
          trendLabel={opportunityCount > 0 ? "Financing leads" : "None detected"}
        />
        <StatCard
          label="Providers" value={FINANCING_PROVIDERS.length}
          icon={<CreditCard className="w-4 h-4" />} color="text-primary"
        />
        <StatCard
          label="Max Approval" value="$7,500"
          icon={<DollarSign className="w-4 h-4" />} color="text-emerald-400"
          trendLabel="Koalafi"
        />
        <StatCard
          label="No Credit Options" value={FINANCING_PROVIDERS.filter(p => p.type === "lease-to-own").length}
          icon={<Shield className="w-4 h-4" />} color="text-blue-400"
          trendLabel="Lease-to-own"
        />
      </div>

      {/* Provider quick-access row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {FINANCING_PROVIDERS.map((p) => (
          <a
            key={p.id}
            href={p.merchantPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="stat-card !p-4 text-center hover:!border-primary/30 transition-all group"
          >
            <div
              className="w-8 h-8 mx-auto rounded-lg flex items-center justify-center text-white mb-2"
              style={{ backgroundColor: p.color }}
            >
              {p.type === "credit-card" ? <CreditCard className="w-4 h-4" /> : <Wallet className="w-4 h-4" />}
            </div>
            <p className="font-bold text-foreground text-sm group-hover:text-primary transition-colors">{p.shortName}</p>
            <p className="text-foreground/40 text-[10px]">Up to {p.maxAmount}</p>
          </a>
        ))}
      </div>

      {/* Tab navigation */}
      <div className="flex items-center gap-1 border-b border-border/20 pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="text-[9px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full font-bold ml-0.5">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "opportunities" && <OpportunityTracker />}

      {activeTab === "providers" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {FINANCING_PROVIDERS.map((p) => (
            <ProviderPortalCard key={p.id} provider={p} />
          ))}
        </div>
      )}

      {activeTab === "log" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <QuickLinksBar />
          <LogApplicationForm />
        </div>
      )}
    </div>
  );
}
