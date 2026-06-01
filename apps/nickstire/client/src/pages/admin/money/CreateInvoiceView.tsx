import { useState } from "react";
import { BUSINESS } from "@shared/business";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import { FormField } from "./FormField";

// ─── CREATE INVOICE VIEW ────────────────────────────────
export function CreateInvoiceView({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    serviceDescription: "",
    vehicleInfo: "",
    totalAmount: "",
    partsCost: "",
    laborCost: "",
    taxAmount: "",
    paymentMethod: "card",
    paymentStatus: "paid",
    invoiceNumber: "",
    // wave-181.x Money Phase 1 · M1 fix · was `new Date().toISOString()
    // .split("T")[0]` which returns UTC date. Operator in Cleveland
    // (UTC-5) at 8 PM ET creating an invoice got invoiceDate ===
    // tomorrow's date in UTC. Revenue silently dated to next day · end-
    // of-month close broken. `toLocaleDateString("en-CA")` returns
    // local-tz YYYY-MM-DD.
    invoiceDate: new Date().toLocaleDateString("en-CA"),
  });

  const createInvoice = trpc.invoices.create.useMutation({
    onSuccess: () => {
      toast.success("Invoice created");
      onDone();
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!form.customerName.trim()) { toast.error("Customer name is required"); return; }
    if (!form.totalAmount) { toast.error("Total amount is required"); return; }

    // wave-181.x Money Phase 1 · M6 fix · code-review agent caught
    // parseFloat("abc") = NaN slipping past the truthy guard. iOS PWA
    // paste of malformed text gets through. Explicit Number.isFinite
    // check + dollar-value sanity guard before the cents math.
    const total = parseFloat(form.totalAmount);
    if (!Number.isFinite(total) || total < 0) {
      toast.error("Total amount must be a positive number");
      return;
    }
    const parts = form.partsCost ? parseFloat(form.partsCost) : 0;
    const labor = form.laborCost ? parseFloat(form.laborCost) : 0;
    const tax = form.taxAmount ? parseFloat(form.taxAmount) : 0;
    if (!Number.isFinite(parts) || !Number.isFinite(labor) || !Number.isFinite(tax)) {
      toast.error("Parts/labor/tax must be valid numbers");
      return;
    }

    createInvoice.mutate({
      customerName: form.customerName,
      customerPhone: form.customerPhone || undefined,
      serviceDescription: form.serviceDescription || undefined,
      vehicleInfo: form.vehicleInfo || undefined,
      totalAmount: Math.round(total * 100),
      partsCost: Math.round(parts * 100),
      laborCost: Math.round(labor * 100),
      taxAmount: Math.round(tax * 100),
      paymentMethod: form.paymentMethod as "card" | "cash" | "check" | "financing" | "other",
      paymentStatus: form.paymentStatus as "paid" | "pending" | "partial" | "refunded",
      invoiceNumber: form.invoiceNumber || undefined,
      invoiceDate: form.invoiceDate,
      source: "manual",
    });
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-[15px] font-semibold text-foreground tracking-tight">New invoice</h3>
        <button onClick={onDone} aria-label="Close" className="text-foreground/40 hover:text-foreground">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Customer Name *" value={form.customerName} onChange={(v) => setForm(f => ({ ...f, customerName: v }))} placeholder="John Smith" />
          <FormField label="Phone" value={form.customerPhone} onChange={(v) => setForm(f => ({ ...f, customerPhone: v }))} placeholder={BUSINESS.phone.placeholder} type="tel" inputMode="tel" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Vehicle" value={form.vehicleInfo} onChange={(v) => setForm(f => ({ ...f, vehicleInfo: v }))} placeholder="2019 Honda Civic" />
          <FormField label="Invoice #" value={form.invoiceNumber} onChange={(v) => setForm(f => ({ ...f, invoiceNumber: v }))} placeholder="INV-001" />
        </div>
        <FormField label="Service Description" value={form.serviceDescription} onChange={(v) => setForm(f => ({ ...f, serviceDescription: v }))} placeholder="Brake pad replacement, rotor resurfacing" />

        <div className="grid grid-cols-4 gap-4">
          <FormField label="Parts ($)" value={form.partsCost} onChange={(v) => setForm(f => ({ ...f, partsCost: v }))} placeholder="0.00" type="number" inputMode="decimal" />
          <FormField label="Labor ($)" value={form.laborCost} onChange={(v) => setForm(f => ({ ...f, laborCost: v }))} placeholder="0.00" type="number" inputMode="decimal" />
          <FormField label="Tax ($)" value={form.taxAmount} onChange={(v) => setForm(f => ({ ...f, taxAmount: v }))} placeholder="0.00" type="number" inputMode="decimal" />
          <FormField label="Total ($) *" value={form.totalAmount} onChange={(v) => setForm(f => ({ ...f, totalAmount: v }))} placeholder="0.00" type="number" inputMode="decimal" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Payment Method</label>
            <select value={form.paymentMethod} onChange={(e) => setForm(f => ({ ...f, paymentMethod: e.target.value as typeof f.paymentMethod }))} className="w-full bg-background border border-border/30 px-3 py-2 text-[12px] text-foreground">
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="financing">Financing</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Status</label>
            <select value={form.paymentStatus} onChange={(e) => setForm(f => ({ ...f, paymentStatus: e.target.value as typeof f.paymentStatus }))} className="w-full bg-background border border-border/30 px-3 py-2 text-[12px] text-foreground">
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Date</label>
            <input type="date" value={form.invoiceDate} onChange={(e) => setForm(f => ({ ...f, invoiceDate: e.target.value }))} className="w-full bg-background border border-border/30 px-3 py-2 text-[12px] text-foreground" />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={handleSubmit}
            disabled={createInvoice.isPending}
            className="px-6 py-2.5 bg-primary text-primary-foreground font-bold text-sm tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createInvoice.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "CREATE INVOICE"}
          </button>
          <button onClick={onDone} className="px-6 py-2.5 border border-border/30 text-foreground/60 font-bold text-sm tracking-wider hover:text-foreground transition-colors">
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
