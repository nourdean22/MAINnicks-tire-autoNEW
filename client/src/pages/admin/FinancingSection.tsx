/**
 * Admin Financing Section — Provider portals, quick links, and application logging.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CreditCard, ExternalLink, Wallet, Zap, Shield,
  Star, Plus, CheckCircle, Loader2, Phone, Copy,
} from "lucide-react";
import { FINANCING_PROVIDERS, type FinancingProvider } from "@shared/financing";
import { BUSINESS } from "@shared/business";

/* ── Provider portal card ──────────────────────────────────── */
function ProviderPortalCard({ provider }: { provider: FinancingProvider }) {
  return (
    <div className="bg-[oklch(0.08_0.004_260/0.6)] border border-border/20 rounded-xl p-5 hover:border-primary/20 transition-colors">
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
          className="inline-flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1.5 rounded-md text-[11px] font-bold hover:bg-primary/20 transition-colors"
        >
          Merchant Portal <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={provider.customerPortalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-foreground/5 text-foreground/60 px-3 py-1.5 rounded-md text-[11px] font-medium hover:bg-foreground/10 transition-colors"
        >
          Customer Portal <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={provider.applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-foreground/5 text-foreground/60 px-3 py-1.5 rounded-md text-[11px] font-medium hover:bg-foreground/10 transition-colors"
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
    provider: "acima" as "acima" | "snap" | "koalafi" | "synchrony",
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
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  return (
    <div className="bg-[oklch(0.08_0.004_260/0.6)] border border-border/20 rounded-xl p-5">
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
          className="col-span-2 sm:col-span-1 bg-background border border-border/30 rounded-md px-3 py-2 text-sm text-foreground"
        >
          {FINANCING_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}
          className="bg-background border border-border/30 rounded-md px-3 py-2 text-sm text-foreground"
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
          className="bg-background border border-border/30 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground/30"
        />

        <input
          type="tel"
          placeholder="Phone *"
          value={form.customerPhone}
          onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
          required
          className="bg-background border border-border/30 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground/30"
        />

        <input
          type="email"
          placeholder="Email (optional)"
          value={form.customerEmail}
          onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
          className="bg-background border border-border/30 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground/30"
        />

        <input
          type="text"
          placeholder="Estimated Amount (optional)"
          value={form.estimatedAmount}
          onChange={(e) => setForm({ ...form, estimatedAmount: e.target.value })}
          className="bg-background border border-border/30 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground/30"
        />

        <textarea
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          className="col-span-2 bg-background border border-border/30 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 resize-none"
        />

        <div className="col-span-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-bold hover:opacity-90 transition-colors disabled:opacity-50"
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
          {mutation.error && (
            <p className="text-red-400 text-xs mt-2">{mutation.error.message}</p>
          )}
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
    <div className="bg-[oklch(0.08_0.004_260/0.6)] border border-border/20 rounded-xl p-5">
      <h3 className="font-bold text-foreground text-sm mb-3">Quick Apply Links</h3>
      <p className="text-foreground/40 text-xs mb-4">
        Copy these links to send to customers via SMS or email.
      </p>
      <div className="space-y-2">
        {FINANCING_PROVIDERS.map((p) => (
          <div key={p.id} className="flex items-center justify-between bg-background/30 rounded-md px-3 py-2">
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
        <div className="flex items-center justify-between bg-background/30 rounded-md px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-foreground/70 text-xs font-medium">Financing Page</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-foreground/30 text-[10px]">autonicks.com/financing</span>
            <button
              onClick={() => copyLink("https://autonicks.com/financing", "page")}
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
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl text-foreground tracking-tight">Financing Providers</h2>
          <p className="text-foreground/40 text-xs mt-1">Manage financing options, log applications, and access merchant portals</p>
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

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {FINANCING_PROVIDERS.map((p) => (
          <div key={p.id} className="bg-[oklch(0.08_0.004_260/0.6)] border border-border/20 rounded-xl p-4 text-center">
            <div
              className="w-8 h-8 mx-auto rounded-lg flex items-center justify-center text-white mb-2"
              style={{ backgroundColor: p.color }}
            >
              {p.type === "credit-card" ? <CreditCard className="w-4 h-4" /> : <Wallet className="w-4 h-4" />}
            </div>
            <p className="font-bold text-foreground text-sm">{p.shortName}</p>
            <p className="text-foreground/40 text-[10px]">Up to {p.maxAmount}</p>
          </div>
        ))}
      </div>

      {/* Provider portals */}
      <div>
        <h3 className="text-foreground/60 text-xs font-bold tracking-wide mb-3">PROVIDER PORTALS</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {FINANCING_PROVIDERS.map((p) => (
            <ProviderPortalCard key={p.id} provider={p} />
          ))}
        </div>
      </div>

      {/* Quick links + Log form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QuickLinksBar />
        <LogApplicationForm />
      </div>
    </div>
  );
}
