/**
 * InspectionsSection — extracted from Admin.tsx for maintainability.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  StatCard, UrgencyBadge, ActivityIcon, StatusDot,
  BOOKING_STATUS_CONFIG, LEAD_STATUS_CONFIG, TIME_LABELS, CHART_COLORS,
  type BookingStatus, type LeadStatus,
} from "./shared";
import {
  Loader2, ClipboardList, Eye, CheckCircle2, Camera, Phone
} from "lucide-react";

export default function InspectionsSection() {
  const { data: inspections, isLoading } = trpc.inspection.list.useQuery();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ customerName: "", customerPhone: "", vehicleInfo: "", mileage: "", technicianName: "" });

  const createInspection = trpc.inspection.create.useMutation({
    onSuccess: () => { utils.inspection.list.invalidate(); setShowForm(false); setForm({ customerName: "", customerPhone: "", vehicleInfo: "", mileage: "", technicianName: "" }); toast.success("Inspection created"); },
    onError: (err: any) => toast.error(err.message),
  });
  const publishInspection = trpc.inspection.publish.useMutation({
    onSuccess: () => { utils.inspection.list.invalidate(); toast.success("Inspection published — share link is ready"); },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-xl text-foreground tracking-wider">VEHICLE INSPECTIONS</h2>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-primary text-primary-foreground font-bold text-xs tracking-wide">
          {showForm ? "CANCEL" : "+ NEW INSPECTION"}
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border/30 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input placeholder="Customer Name" value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
            <input placeholder="Phone" value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
            <input placeholder="Vehicle (Year Make Model)" value={form.vehicleInfo} onChange={e => setForm(f => ({ ...f, vehicleInfo: e.target.value }))} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
            <input placeholder="Mileage" value={form.mileage} onChange={e => setForm(f => ({ ...f, mileage: e.target.value }))} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
            <input placeholder="Technician Name" value={form.technicianName} onChange={e => setForm(f => ({ ...f, technicianName: e.target.value }))} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
          </div>
          <button onClick={() => createInspection.mutate({ customerName: form.customerName, customerPhone: form.customerPhone, vehicleInfo: form.vehicleInfo, mileage: parseInt(form.mileage) || 0, technicianName: form.technicianName || "Technician" })} disabled={createInspection.isPending || !form.customerName} className="px-4 py-2 bg-primary text-primary-foreground font-bold text-xs tracking-wide disabled:opacity-50">
            {createInspection.isPending ? "CREATING..." : "CREATE INSPECTION"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (inspections ?? []).length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <Camera className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-[13px]">No inspections yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(inspections ?? []).map((insp: any) => (
            <div key={insp.id} className="bg-card border border-border/30 p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-bold text-foreground text-sm">{insp.customerName}</span>
                    <span className="text-[12px] text-foreground/40">{insp.vehicleInfo}</span>
                  </div>
                  <p className="text-[12px] text-foreground/50">{insp.mileage?.toLocaleString()} mi • {new Date(insp.createdAt).toLocaleDateString()}</p>
                  {insp.isPublished === 1 && insp.shareToken && (
                    <p className="text-[12px] text-nick-teal mt-1">
                      Share: {window.location.origin}/inspection/{insp.shareToken}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {insp.isPublished !== 1 && (
                    <button onClick={() => publishInspection.mutate({ id: insp.id })} className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-[12px] border border-emerald-500/30">
                      PUBLISH
                    </button>
                  )}
                  <span className={`px-2 py-1 text-xs ${insp.isPublished === 1 ? "text-emerald-400 bg-emerald-500/10" : "text-amber-400 bg-amber-500/10"}`}>
                    {insp.isPublished === 1 ? "PUBLISHED" : "DRAFT"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LOYALTY ADMIN SECTION ──────────────────────────────

