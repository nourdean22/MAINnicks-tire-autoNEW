/**
 * SpecialsSection — Manage promotions/specials from the admin dashboard.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, XCircle, Zap } from "lucide-react";

const EMPTY_FORM = {
  title: "",
  description: "",
  discountType: "percent" as "percent" | "fixed" | "free_service" | "bundle",
  discountValue: 0,
  serviceCategory: "",
  couponCode: "",
  startsAt: "",
  expiresAt: "",
  maxUses: 0,
};

export default function SpecialsSection() {
  const { data: specials, isLoading } = trpc.specials.getActive.useQuery();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const createSpecial = trpc.specials.create.useMutation({
    onSuccess: () => {
      utils.specials.getActive.invalidate();
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      toast.success("Special created");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteSpecial = trpc.specials.delete.useMutation({
    onSuccess: () => {
      utils.specials.getActive.invalidate();
      toast.success("Special deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  function handleCreate() {
    createSpecial.mutate({
      title: form.title,
      description: form.description || undefined,
      discountType: form.discountType,
      discountValue: form.discountValue || undefined,
      serviceCategory: form.serviceCategory || undefined,
      couponCode: form.couponCode || undefined,
      startsAt: form.startsAt,
      expiresAt: form.expiresAt || undefined,
      maxUses: form.maxUses || undefined,
    });
  }

  const discountLabel = (s: any) => {
    if (s.discountType === "percent") return `${s.discountValue ?? 0}%`;
    if (s.discountType === "fixed") return `$${s.discountValue ?? 0}`;
    if (s.discountType === "free_service") return "FREE";
    if (s.discountType === "bundle") return "BUNDLE";
    return s.discountType;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-xl text-foreground tracking-wider">ACTIVE SPECIALS</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors"
        >
          {showForm ? "CANCEL" : "+ NEW SPECIAL"}
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border/30 p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Coupon Code</label>
              <input
                type="text"
                value={form.couponCode}
                onChange={(e) => setForm({ ...form, couponCode: e.target.value.toUpperCase() })}
                placeholder="e.g. SPRING25"
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-foreground/60 text-xs mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none resize-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Discount Type</label>
              <select
                value={form.discountType}
                onChange={(e) => setForm({ ...form, discountType: e.target.value as any })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm"
              >
                <option value="percent">Percent Off</option>
                <option value="fixed">Dollar Off</option>
                <option value="free_service">Free Service</option>
                <option value="bundle">Bundle Deal</option>
              </select>
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Value</label>
              <input
                type="number"
                value={form.discountValue}
                onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Service Category</label>
              <input
                type="text"
                value={form.serviceCategory}
                onChange={(e) => setForm({ ...form, serviceCategory: e.target.value })}
                placeholder="e.g. tires, brakes"
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Starts At *</label>
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Expires At</label>
              <input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Max Uses</label>
              <input
                type="number"
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!form.title || !form.startsAt || createSpecial.isPending}
            className="bg-primary text-primary-foreground px-6 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createSpecial.isPending ? "CREATING..." : "CREATE SPECIAL"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (specials ?? []).length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <Zap className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-[13px]">No active specials. Create your first one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(specials ?? []).map((s: any) => (
            <div key={s.id} className="bg-card border border-border/30 p-4 flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-primary text-lg">{discountLabel(s)}</span>
                  <span className="font-bold text-foreground text-sm tracking-wider">{s.title}</span>
                  {s.couponCode && (
                    <span className="text-xs bg-foreground/5 text-foreground/50 px-1.5 py-0.5">{s.couponCode}</span>
                  )}
                  {s.serviceCategory && (
                    <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5">{s.serviceCategory}</span>
                  )}
                </div>
                {s.description && <p className="text-foreground/50 text-xs mt-1">{s.description}</p>}
                <div className="flex items-center gap-3 mt-1 text-foreground/30 text-xs">
                  {s.startsAt && <span>Starts: {new Date(s.startsAt).toLocaleDateString()}</span>}
                  {s.expiresAt && <span>Expires: {new Date(s.expiresAt).toLocaleDateString()}</span>}
                  {s.maxUses != null && s.maxUses > 0 && <span>Max uses: {s.maxUses}</span>}
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm("Delete this special?")) deleteSpecial.mutate({ id: s.id });
                }}
                className="text-foreground/30 hover:text-red-400 transition-colors"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
