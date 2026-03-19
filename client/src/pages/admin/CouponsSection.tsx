/**
 * CouponsSection — extracted from Admin.tsx for maintainability.
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
  Calendar, CheckCircle2, Loader2, Star, XCircle, Zap
} from "lucide-react";

export default function CouponsSection() {
  const { data: coupons, isLoading } = trpc.coupons.all.useQuery();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", code: "", discountType: "dollar" as "dollar" | "percent" | "free",
    discountValue: 0, applicableServices: "all", terms: "", isFeatured: 0 as number,
    expiresAt: "",
  });

  const createCoupon = trpc.coupons.create.useMutation({
    onSuccess: () => { utils.coupons.all.invalidate(); setShowForm(false); setForm({ title: "", description: "", code: "", discountType: "dollar", discountValue: 0, applicableServices: "all", terms: "", isFeatured: 0, expiresAt: "" }); toast.success("Coupon created"); },
  });
  const deleteCoupon = trpc.coupons.delete.useMutation({
    onSuccess: () => { utils.coupons.all.invalidate(); toast.success("Coupon deleted"); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-bold text-xl text-foreground tracking-wider">ACTIVE COUPONS</h2>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/90 transition-colors">
          {showForm ? "CANCEL" : "+ NEW COUPON"}
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border/30 p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs font-mono mb-1">Title *</label>
              <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs font-mono mb-1">Code</label>
              <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. SAVE20" className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-foreground/60 text-xs font-mono mb-1">Description *</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none resize-none" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs font-mono mb-1">Discount Type</label>
              <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as any })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm">
                <option value="dollar">Dollar Off</option>
                <option value="percent">Percent Off</option>
                <option value="free">Free Service</option>
              </select>
            </div>
            <div>
              <label className="block text-foreground/60 text-xs font-mono mb-1">Value</label>
              <input type="number" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs font-mono mb-1">Expires</label>
              <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs font-mono mb-1">Applicable Services</label>
              <input type="text" value={form.applicableServices} onChange={(e) => setForm({ ...form, applicableServices: e.target.value })} placeholder="all" className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs font-mono mb-1">Terms</label>
              <input type="text" value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={!!form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked ? 1 : 0 })} id="featured" />
            <label htmlFor="featured" className="text-foreground/60 text-sm">Featured (shown prominently)</label>
          </div>
          <button
            onClick={() => createCoupon.mutate({ ...form, expiresAt: form.expiresAt || undefined, code: form.code || undefined, terms: form.terms || undefined })}
            disabled={!form.title || !form.description || createCoupon.isPending}
            className="bg-primary text-primary-foreground px-6 py-2 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createCoupon.isPending ? "CREATING..." : "CREATE COUPON"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (coupons ?? []).length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <Zap className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="font-mono text-sm">No coupons yet. Create your first one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(coupons ?? []).map((c: any) => (
            <div key={c.id} className="bg-card border border-border/30 p-4 flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-heading font-bold text-primary text-lg">
                    {c.discountType === "dollar" ? `$${c.discountValue}` : c.discountType === "percent" ? `${c.discountValue}%` : "FREE"}
                  </span>
                  <span className="font-heading font-bold text-foreground text-sm tracking-wider">{c.title}</span>
                  {c.isFeatured ? <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 font-mono">FEATURED</span> : null}
                  {c.code && <span className="text-xs bg-foreground/5 text-foreground/50 px-1.5 py-0.5 font-mono">{c.code}</span>}
                </div>
                <p className="text-foreground/50 text-xs mt-1">{c.description}</p>
                {c.expiresAt && <p className="text-foreground/30 text-xs font-mono mt-1">Expires: {new Date(c.expiresAt).toLocaleDateString()}</p>}
              </div>
              <button onClick={() => { if (confirm("Delete this coupon?")) deleteCoupon.mutate({ id: c.id }); }} className="text-foreground/30 hover:text-red-400 transition-colors">
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Q&A MANAGEMENT ────────────────────────────────────

