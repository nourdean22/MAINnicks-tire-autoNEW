/**
 * WarrantySection — Track and manage service warranties from admin dashboard.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Shield, AlertTriangle } from "lucide-react";

const EMPTY_FORM = {
  workOrderId: "",
  customerId: "",
  vehicleId: "",
  serviceDescription: "",
  warrantyMonths: 12,
  warrantyMiles: 0,
  mileageAtService: 0,
};

export default function WarrantySection() {
  const { data: expiring, isLoading: expiringLoading } = trpc.warranties.expiringWithValue.useQuery();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const createWarranty = trpc.warranties.create.useMutation({
    onSuccess: () => {
      utils.warranties.expiringWithValue.invalidate();
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      toast.success("Warranty created");
    },
    onError: (err) => toast.error(err.message),
  });

  function handleCreate() {
    if (!form.workOrderId || !form.customerId || !form.serviceDescription) return;
    createWarranty.mutate({
      workOrderId: form.workOrderId,
      customerId: form.customerId,
      vehicleId: form.vehicleId || undefined,
      serviceDescription: form.serviceDescription,
      warrantyMonths: form.warrantyMonths,
      warrantyMiles: form.warrantyMiles || undefined,
      mileageAtService: form.mileageAtService || undefined,
    });
  }

  const daysUntil = (dateStr: string | Date) => {
    const d = new Date(dateStr);
    const now = new Date();
    return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-xl text-foreground tracking-wider">WARRANTIES</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors"
        >
          {showForm ? "CANCEL" : "+ NEW WARRANTY"}
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border/30 p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Work Order ID *</label>
              <input
                type="text"
                value={form.workOrderId}
                onChange={(e) => setForm({ ...form, workOrderId: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Customer ID *</label>
              <input
                type="text"
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Vehicle ID</label>
              <input
                type="text"
                value={form.vehicleId}
                onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Warranty Months *</label>
              <input
                type="number"
                value={form.warrantyMonths}
                onChange={(e) => setForm({ ...form, warrantyMonths: Number(e.target.value) })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-foreground/60 text-xs mb-1">Service Description *</label>
            <textarea
              value={form.serviceDescription}
              onChange={(e) => setForm({ ...form, serviceDescription: e.target.value })}
              rows={2}
              className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none resize-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Warranty Miles</label>
              <input
                type="number"
                value={form.warrantyMiles}
                onChange={(e) => setForm({ ...form, warrantyMiles: Number(e.target.value) })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Mileage at Service</label>
              <input
                type="number"
                value={form.mileageAtService}
                onChange={(e) => setForm({ ...form, mileageAtService: Number(e.target.value) })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!form.workOrderId || !form.customerId || !form.serviceDescription || createWarranty.isPending}
            className="bg-primary text-primary-foreground px-6 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createWarranty.isPending ? "CREATING..." : "CREATE WARRANTY"}
          </button>
        </div>
      )}

      <div>
        <h3 className="font-bold text-sm text-foreground/50 tracking-wider mb-3">EXPIRING SOON (30 DAYS)</h3>
        {expiringLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (expiring ?? []).length === 0 ? (
          <div className="text-center py-12 text-foreground/40">
            <Shield className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-[13px]">No warranties expiring in the next 30 days.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(expiring ?? []).map((w: any) => {
              const days = daysUntil(w.expiresAt);
              const isUrgent = days <= 7;
              return (
                <div
                  key={w.id}
                  className={`bg-card border p-4 flex items-start gap-4 ${
                    isUrgent ? "border-red-500/40" : "border-border/30"
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-foreground text-sm tracking-wider">
                        {w.serviceDescription}
                      </span>
                      {w.isVip && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 font-semibold">VIP</span>
                      )}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 font-semibold ${
                          isUrgent
                            ? "bg-red-500/10 text-red-400"
                            : "bg-amber-500/10 text-amber-400"
                        }`}
                      >
                        {days <= 0 ? "EXPIRED" : `${days}d LEFT`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-foreground/30 text-xs">
                      <span>Customer: {w.customerId}</span>
                      <span>WO: {w.workOrderId}</span>
                      <span>Expires: {new Date(w.expiresAt).toLocaleDateString()}</span>
                      {w.totalRevenue != null && (
                        <span>Revenue: ${Number(w.totalRevenue).toLocaleString()}</span>
                      )}
                    </div>
                    {w.reminderSent && (
                      <span className="text-[10px] text-foreground/30 mt-1 inline-block">Reminder sent</span>
                    )}
                  </div>
                  {isUrgent && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-1" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
