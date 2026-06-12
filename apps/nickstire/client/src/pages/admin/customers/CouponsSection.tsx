/**
 * CouponsSection — extracted from Admin.tsx for maintainability.
 */
import { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";

type Coupon = NonNullable<RouterOutputs["coupons"]["all"]>[number];
import {
  Calendar, CheckCircle2, Loader2, Power, Star, XCircle, Zap, Gift, TicketCheck
} from "lucide-react";
import { PageHeader, LoadingState } from "../shared";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

/**
 * Derives disabled state and label for the Mark Redeemed button.
 * Pure function — safe to call in render and test independently.
 *
 * maxRedemptions = 0 → unlimited; active + unexpired coupons stay enabled.
 * maxRedemptions > 0 → hard cap; disabled once currentRedemptions >= maxRedemptions.
 */
export function getRedeemState(c: Pick<Coupon, "isActive" | "expiresAt" | "maxRedemptions" | "currentRedemptions">, now = new Date()): {
  disabled: boolean;
  label: string;
  badge: string | null;
} {
  if (c.isActive !== 1) {
    return { disabled: true, label: "Inactive", badge: null };
  }
  if (c.expiresAt !== null && new Date(c.expiresAt) < now) {
    return { disabled: true, label: "Expired", badge: null };
  }
  if (c.maxRedemptions > 0 && (c.currentRedemptions ?? 0) >= c.maxRedemptions) {
    return { disabled: true, label: "Fully Claimed", badge: null };
  }
  if (c.maxRedemptions === 0) {
    return { disabled: false, label: "Mark Redeemed", badge: "Unlimited" };
  }
  const remaining = c.maxRedemptions - (c.currentRedemptions ?? 0);
  return { disabled: false, label: "Mark Redeemed", badge: `${remaining} left` };
}

export default function CouponsSection() {
  const { data: coupons, isLoading } = trpc.coupons.all.useQuery();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", code: "", discountType: "dollar" as "dollar" | "percent" | "free",
    discountValue: 0, applicableServices: "all", terms: "", isFeatured: 0 as number,
    maxRedemptions: 0, expiresAt: "",
  });

  // 2026-05-23 · added onError to all three. Money-impacting toggle
  // (homepage hero promo) previously failed silently — same class as
  // the updateMarkup fix.
  const createCoupon = trpc.coupons.create.useMutation({
    onSuccess: () => { utils.coupons.all.invalidate(); setShowForm(false); setForm({ title: "", description: "", code: "", discountType: "dollar", discountValue: 0, applicableServices: "all", terms: "", isFeatured: 0, maxRedemptions: 0, expiresAt: "" }); toast.success("Coupon created"); },
    onError: (err) => toast.error(`Create failed: ${err.message}`),
  });
  const toggleCoupon = trpc.coupons.update.useMutation({
    onSuccess: () => { utils.coupons.all.invalidate(); toast.success("Coupon updated"); },
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  });
  const deleteCoupon = trpc.coupons.delete.useMutation({
    onSuccess: () => { utils.coupons.all.invalidate(); toast.success("Coupon deleted"); },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });

  // Track which coupon ID is mid-redeem to disable that row's button only.
  const [redeemingId, setRedeemingId] = useState<number | null>(null);
  const redeemCoupon = trpc.coupons.redeem.useMutation({
    onSuccess: (_data, variables) => {
      utils.coupons.all.invalidate();
      setRedeemingId(null);
      toast.success("Redemption recorded.");
    },
    onError: (err, variables) => {
      setRedeemingId(null);
      const msg = err.message;
      if (msg.includes("inactive") || msg.includes("INACTIVE")) {
        toast.error("Coupon is inactive.");
      } else if (msg.includes("expired") || msg.includes("EXPIRED")) {
        toast.error("Coupon has expired.");
      } else if (msg.includes("cap") || msg.includes("CAP") || msg.includes("fully") || msg.includes("claimed")) {
        toast.error("Redemption cap reached — offer is fully claimed.");
      } else if (msg.includes("not found") || msg.includes("NOT_FOUND")) {
        toast.error("Coupon not found.");
      } else {
        toast.error(`Redemption failed: ${err.message}`);
      }
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coupons"
        subtitle="Promo codes redeemable at checkout · dollar/percent/free service · featured-coupon flag for hero placement"
        icon={<Gift className="w-5 h-5" />}
        actions={
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors">
            {showForm ? "CANCEL" : "+ NEW COUPON"}
          </button>
        }
      />

      {showForm && (
        <div className="bg-card border border-border/30 p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Title *</label>
              <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Code</label>
              <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. SAVE20" className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-foreground/60 text-xs mb-1">Description *</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none resize-none" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Discount Type</label>
              <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as typeof form.discountType })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm">
                <option value="dollar">Dollar Off</option>
                <option value="percent">Percent Off</option>
                <option value="free">Free Service</option>
              </select>
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Value</label>
              <input type="number" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Expires</label>
              <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Applicable Services</label>
              <input type="text" value={form.applicableServices} onChange={(e) => setForm({ ...form, applicableServices: e.target.value })} placeholder="all" className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Terms</label>
              <input type="text" value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Max redemptions (0 = unlimited)</label>
              <input type="number" min={0} value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: Math.max(0, Number(e.target.value)) })} className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={!!form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked ? 1 : 0 })} id="featured" />
            <label htmlFor="featured" className="text-foreground/60 text-sm">Featured (shown prominently)</label>
          </div>
          <button
            onClick={() => createCoupon.mutate({ ...form, expiresAt: form.expiresAt || undefined, code: form.code || undefined, terms: form.terms || undefined })}
            disabled={!form.title || !form.description || createCoupon.isPending}
            className="bg-primary text-primary-foreground px-6 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createCoupon.isPending ? "CREATING..." : "CREATE COUPON"}
          </button>
        </div>
      )}

      {isLoading ? (
        <LoadingState label="Loading coupons..." />
      ) : (coupons ?? []).length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <Zap className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-[13px]">No coupons yet. Create your first one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(coupons ?? []).map((c: Coupon) => (
            <div key={c.id} className="bg-card border border-border/30 p-4 flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-primary text-lg">
                    {c.discountType === "dollar" ? `$${c.discountValue}` : c.discountType === "percent" ? `${c.discountValue}%` : "FREE"}
                  </span>
                  <span className="font-bold text-foreground text-sm tracking-wider">{c.title}</span>
                  {c.isFeatured ? <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5">FEATURED</span> : null}
                  {c.code && <span className="text-xs bg-foreground/5 text-foreground/50 px-1.5 py-0.5">{c.code}</span>}
                </div>
                <p className="text-foreground/50 text-xs mt-1">{c.description}</p>
                <div className="flex items-center gap-3 mt-1">
                  {c.expiresAt && <span className="text-foreground/30 text-xs">Expires: {new Date(c.expiresAt).toLocaleDateString()}</span>}
                  {c.maxRedemptions > 0 && (
                    <span className="text-foreground/30 text-xs">
                      Redeemed: {c.currentRedemptions ?? 0}/{c.maxRedemptions}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* ── Mark Redeemed ─────────────────────────────────────────────
                    Counter staff tap this when a customer presents a coupon
                    at the counter. Calls coupons.redeem → enforces the
                    maxRedemptions cap atomically on the server.
                    Disabled when: loading · inactive · expired · fully claimed.
                */}
                {(() => {
                  const rs = getRedeemState(c);
                  const isLoading = redeemingId === c.id;
                  return (
                    <button
                      id={`redeem-btn-${c.id}`}
                      disabled={rs.disabled || isLoading}
                      title={
                        rs.disabled
                          ? rs.label
                          : `Record one redemption for "${c.title}"`
                      }
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: "Record redemption?",
                          message: `Record one redemption for "${c.title}". This cannot be undone.`,
                          confirmLabel: "Record",
                        });
                        if (!ok) return;
                        setRedeemingId(c.id);
                        redeemCoupon.mutate({ id: c.id });
                      }}
                      className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold tracking-wide border transition-colors ${
                        rs.disabled
                          ? "text-foreground/25 border-border/20 bg-transparent cursor-not-allowed"
                          : "text-blue-400 border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 cursor-pointer"
                      }`}
                    >
                      {isLoading
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <TicketCheck className="w-3 h-3" />
                      }
                      <span className="ml-0.5">
                        {isLoading ? "RECORDING..." : rs.label.toUpperCase()}
                      </span>
                      {!rs.disabled && rs.badge && (
                        <span className="ml-1 text-[9px] text-blue-400/70 font-normal normal-case tracking-normal">
                          {rs.badge}
                        </span>
                      )}
                    </button>
                  );
                })()}
                <button
                  onClick={() => toggleCoupon.mutate({ id: c.id, isActive: c.isActive === 1 ? 0 : 1 })}
                  disabled={toggleCoupon.isPending}
                  className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold tracking-wide border transition-colors ${
                    c.isActive === 1
                      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
                      : "text-foreground/40 border-border/30 bg-foreground/5 hover:bg-foreground/10"
                  }`}
                  title={c.isActive === 1 ? "Click to deactivate" : "Click to activate"}
                >
                  <Power className="w-3 h-3" />
                  {c.isActive === 1 ? "ACTIVE" : "INACTIVE"}
                </button>
                <button onClick={async () => { if (await confirmDialog({ title: "Delete coupon?", message: `Remove "${c.code}". Customers can no longer redeem it.`, confirmLabel: "Delete", tone: "danger" })) deleteCoupon.mutate({ id: c.id }); }} className="text-foreground/30 hover:text-red-400 transition-colors">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

