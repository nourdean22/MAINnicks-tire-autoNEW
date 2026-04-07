/**
 * WaitlistSection — Manage overflow booking waitlist from admin dashboard.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, ListOrdered, Bell, Crown, UserPlus } from "lucide-react";

const EMPTY_FORM = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  serviceType: "",
  preferredDate: "",
  notes: "",
};

export default function WaitlistSection() {
  const { data: queue, isLoading } = trpc.waitlist.smartQueue.useQuery();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const joinWaitlist = trpc.waitlist.join.useMutation({
    onSuccess: () => {
      utils.waitlist.smartQueue.invalidate();
      utils.waitlist.getAll.invalidate();
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      toast.success("Added to waitlist");
    },
    onError: (err) => toast.error(err.message),
  });

  const notifyCustomer = trpc.waitlist.notify.useMutation({
    onSuccess: () => {
      utils.waitlist.smartQueue.invalidate();
      utils.waitlist.getAll.invalidate();
      toast.success("Customer notified");
    },
    onError: (err) => toast.error(err.message),
  });

  function handleAdd() {
    if (!form.customerName || !form.customerPhone) return;
    joinWaitlist.mutate({
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      customerEmail: form.customerEmail || undefined,
      serviceType: form.serviceType || undefined,
      preferredDate: form.preferredDate || undefined,
      notes: form.notes || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-xl text-foreground tracking-wider">WAITLIST</h2>
        <div className="flex items-center gap-3">
          <span className="text-foreground/50 text-xs font-bold tracking-wide">
            {(queue ?? []).length} WAITING
          </span>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors"
          >
            {showForm ? "CANCEL" : "+ ADD TO WAITLIST"}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-card border border-border/30 p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Customer Name *</label>
              <input
                type="text"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Phone *</label>
              <input
                type="tel"
                value={form.customerPhone}
                onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Email</label>
              <input
                type="email"
                value={form.customerEmail}
                onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Service Needed</label>
              <input
                type="text"
                value={form.serviceType}
                onChange={(e) => setForm({ ...form, serviceType: e.target.value })}
                placeholder="e.g. oil change, tires"
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Preferred Date</label>
              <input
                type="date"
                value={form.preferredDate}
                onChange={(e) => setForm({ ...form, preferredDate: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <button
            onClick={handleAdd}
            disabled={!form.customerName || !form.customerPhone || joinWaitlist.isPending}
            className="bg-primary text-primary-foreground px-6 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {joinWaitlist.isPending ? "ADDING..." : "ADD TO WAITLIST"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (queue ?? []).length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <ListOrdered className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-[13px]">Waitlist is empty. No one waiting for a slot.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(queue ?? []).map((entry: any, idx: number) => (
            <div key={entry.id} className="bg-card border border-border/30 p-4 flex items-center gap-4">
              <div className="w-8 h-8 flex items-center justify-center bg-foreground/5 text-foreground/40 font-bold text-sm shrink-0">
                {idx + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-foreground text-sm tracking-wider">{entry.customerName}</span>
                  {entry.priority === "vip" && (
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 font-semibold flex items-center gap-0.5">
                      <Crown className="w-2.5 h-2.5" /> VIP
                    </span>
                  )}
                  {entry.priority === "returning" && (
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 font-semibold flex items-center gap-0.5">
                      <UserPlus className="w-2.5 h-2.5" /> RETURNING
                    </span>
                  )}
                  {entry.serviceType && (
                    <span className="text-xs bg-foreground/5 text-foreground/50 px-1.5 py-0.5">{entry.serviceType}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-foreground/30 text-xs">
                  <span>{entry.customerPhone}</span>
                  {entry.customerEmail && <span>{entry.customerEmail}</span>}
                  {entry.preferredDate && (
                    <span>Preferred: {new Date(entry.preferredDate).toLocaleDateString()}</span>
                  )}
                  {entry.createdAt && (
                    <span>Added: {new Date(entry.createdAt).toLocaleDateString()}</span>
                  )}
                  {entry.totalSpent > 0 && <span>Spent: ${entry.totalSpent.toLocaleString()}</span>}
                </div>
                {entry.notes && <p className="text-foreground/40 text-xs mt-1">{entry.notes}</p>}
              </div>
              <button
                onClick={() => notifyCustomer.mutate({ id: entry.id })}
                disabled={notifyCustomer.isPending}
                className="flex items-center gap-1.5 bg-foreground/5 hover:bg-primary/10 text-foreground/50 hover:text-primary px-3 py-1.5 text-xs font-bold tracking-wide transition-colors"
              >
                <Bell className="w-3.5 h-3.5" />
                NOTIFY
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
