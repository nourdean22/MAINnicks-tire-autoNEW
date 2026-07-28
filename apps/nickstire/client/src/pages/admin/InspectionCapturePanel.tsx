/**
 * DVI technician capture — the missing INLET for the inspection loop.
 *
 * The audit found the entire backend built (create/addItem/uploadPhoto/
 * publish + the customer decision packet) with NO admin UI calling it —
 * a complete pipeline with no entrance. This is that entrance, built to
 * the plan's bar: a tech on a phone adds a finding in under 30 seconds.
 *
 * Phone-first choices: three giant condition buttons (green/yellow/red),
 * camera capture input (HEIC accepted — uploadPhoto handles iPhone),
 * category chips, minimal typing. Publish reveals the customer link +
 * copy button; SENDING the link stays a human action through existing
 * channels (no automated sends — doctrine).
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Camera, CheckCircle, ClipboardCopy, Loader2, Plus, Trash2, Wrench, XCircle, AlertTriangle } from "lucide-react";

const CATEGORIES = ["brakes", "tires", "engine", "suspension", "electrical", "fluids", "body", "other"] as const;

const CONDITIONS = [
  { value: "green", label: "Good", cls: "border-nick-teal/50 bg-nick-teal/15 text-nick-teal", icon: <CheckCircle className="w-5 h-5" /> },
  { value: "yellow", label: "Monitor", cls: "border-primary/50 bg-primary/15 text-primary", icon: <AlertTriangle className="w-5 h-5" /> },
  { value: "red", label: "Needs repair", cls: "border-red-500/50 bg-red-500/15 text-red-400", icon: <XCircle className="w-5 h-5" /> },
] as const;

export default function InspectionCapturePanel() {
  const utils = trpc.useUtils();
  const [inspectionId, setInspectionId] = useState<number | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  const [createForm, setCreateForm] = useState({ customerName: "", customerPhone: "", vehicleInfo: "", technicianName: "", mileage: "" });
  const [item, setItem] = useState({ component: "", category: "brakes" as (typeof CATEGORIES)[number], condition: "yellow" as "green" | "yellow" | "red", notes: "", recommendedAction: "", estimatedCost: "", photoUrl: "" });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const { data: inspection } = trpc.inspection.get.useQuery(
    { id: inspectionId! },
    { enabled: inspectionId !== null },
  );

  const create = trpc.inspection.create.useMutation({
    onSuccess: (r) => {
      setInspectionId(r.id);
      setShareToken(r.shareToken);
      toast.success("Check started — add findings");
    },
    onError: (e) => toast.error(e.message),
  });
  const addItem = trpc.inspection.addItem.useMutation({
    onSuccess: () => {
      setItem({ component: "", category: item.category, condition: "yellow", notes: "", recommendedAction: "", estimatedCost: "", photoUrl: "" });
      utils.inspection.get.invalidate({ id: inspectionId! });
      toast.success("Finding added");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteItem = trpc.inspection.deleteItem.useMutation({
    onSuccess: () => utils.inspection.get.invalidate({ id: inspectionId! }),
    onError: (e) => toast.error(e.message),
  });
  const uploadPhoto = trpc.inspection.uploadPhoto.useMutation();
  const publish = trpc.inspection.publish.useMutation({
    onSuccess: () => { setPublished(true); toast.success("Published — link ready"); },
    onError: (e) => toast.error(e.message),
  });

  const onPhotoPicked = async (file: File | undefined) => {
    if (!file || !inspectionId) return;
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const mimeType = (["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type)
        ? file.type
        : "image/jpeg") as "image/jpeg";
      const { url } = await uploadPhoto.mutateAsync({ base64, filename: file.name || "finding.jpg", mimeType });
      setItem((f) => ({ ...f, photoUrl: url }));
      toast.success("Photo attached");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const reset = () => {
    setInspectionId(null);
    setShareToken(null);
    setPublished(false);
    setCreateForm({ customerName: "", customerPhone: "", vehicleInfo: "", technicianName: "", mileage: "" });
  };

  const shareLink = shareToken ? `${window.location.origin}/inspection/${shareToken}` : "";

  return (
    <section aria-label="Vehicle check capture" className="rounded-lg border border-border/40 bg-card">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-nick-yellow" />
          <h2 className="text-sm font-bold uppercase tracking-wide">Vehicle Check Capture</h2>
          {inspectionId && <span className="text-[10px] text-muted-foreground">#{inspectionId} · {inspection?.items?.length ?? 0} findings</span>}
        </div>
        {inspectionId && (
          <button onClick={reset} className="text-[11px] text-muted-foreground underline">new check</button>
        )}
      </header>

      {/* Step 1 — start the check */}
      {!inspectionId && (
        <div className="px-4 py-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input value={createForm.customerName} onChange={(e) => setCreateForm((f) => ({ ...f, customerName: e.target.value }))}
              placeholder="Customer name *" className="flex-1 min-w-[140px] text-sm rounded-md border border-border/40 bg-background px-3 py-2.5" />
            <input value={createForm.customerPhone} onChange={(e) => setCreateForm((f) => ({ ...f, customerPhone: e.target.value }))}
              placeholder="Phone" inputMode="tel" className="flex-1 min-w-[120px] text-sm rounded-md border border-border/40 bg-background px-3 py-2.5" />
          </div>
          <div className="flex flex-wrap gap-2">
            <input value={createForm.vehicleInfo} onChange={(e) => setCreateForm((f) => ({ ...f, vehicleInfo: e.target.value }))}
              placeholder="Vehicle — e.g. 2018 Honda Civic *" className="flex-1 min-w-[180px] text-sm rounded-md border border-border/40 bg-background px-3 py-2.5" />
            <input value={createForm.mileage} onChange={(e) => setCreateForm((f) => ({ ...f, mileage: e.target.value }))}
              placeholder="Miles" inputMode="numeric" className="w-24 text-sm rounded-md border border-border/40 bg-background px-3 py-2.5" />
          </div>
          <div className="flex gap-2">
            <input value={createForm.technicianName} onChange={(e) => setCreateForm((f) => ({ ...f, technicianName: e.target.value }))}
              placeholder="Tech name *" className="flex-1 text-sm rounded-md border border-border/40 bg-background px-3 py-2.5" />
            <button
              disabled={create.isPending || !createForm.customerName.trim() || !createForm.vehicleInfo.trim() || !createForm.technicianName.trim()}
              onClick={() =>
                create.mutate({
                  customerName: createForm.customerName.trim(),
                  customerPhone: createForm.customerPhone.trim() || undefined,
                  vehicleInfo: createForm.vehicleInfo.trim(),
                  technicianName: createForm.technicianName.trim(),
                  mileage: createForm.mileage ? Number(createForm.mileage) : undefined,
                })
              }
              className="text-[13px] font-bold bg-nick-yellow text-black px-5 py-2.5 rounded disabled:opacity-40 active:scale-95"
            >
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Start check"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — findings */}
      {inspectionId && !published && (
        <div className="px-4 py-3 space-y-3">
          {/* existing findings */}
          {(inspection?.items?.length ?? 0) > 0 && (
            <ul className="space-y-1.5">
              {inspection!.items.map((i: any) => (
                <li key={i.id} className="flex items-center gap-2 text-[13px]">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${i.condition === "green" ? "bg-nick-teal" : i.condition === "yellow" ? "bg-primary" : "bg-red-500"}`} />
                  <span className="text-foreground">{i.component}</span>
                  {i.photoUrl && <Camera className="w-3 h-3 text-muted-foreground" />}
                  {i.estimatedCost > 0 && <span className="text-primary">${i.estimatedCost}</span>}
                  <button onClick={() => deleteItem.mutate({ id: i.id })} className="ml-auto text-foreground/30 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* condition — three giant buttons, the primary gesture */}
          <div className="grid grid-cols-3 gap-2">
            {CONDITIONS.map((c) => (
              <button
                key={c.value}
                onClick={() => setItem((f) => ({ ...f, condition: c.value }))}
                className={`flex flex-col items-center gap-1 py-3 rounded-lg border text-[12px] font-bold ${item.condition === c.value ? c.cls : "border-border/30 text-foreground/40"}`}
              >
                {c.icon}
                {c.label}
              </button>
            ))}
          </div>

          <input value={item.component} onChange={(e) => setItem((f) => ({ ...f, component: e.target.value }))}
            placeholder="Component — e.g. front brake pads *" className="w-full text-sm rounded-md border border-border/40 bg-background px-3 py-2.5" />

          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setItem((f) => ({ ...f, category: c }))}
                className={`text-[11px] px-2.5 py-1.5 rounded-full border ${item.category === c ? "border-nick-yellow bg-nick-yellow/15 text-nick-yellow font-bold" : "border-border/40 text-foreground/60"}`}>
                {c}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex items-center gap-2 text-[12px] font-bold px-4 py-2.5 rounded-md border cursor-pointer active:scale-95 ${item.photoUrl ? "border-nick-teal/50 text-nick-teal" : "border-border/40 text-foreground/70"}`}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {item.photoUrl ? "Photo attached ✓" : "Add photo"}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => onPhotoPicked(e.target.files?.[0])} />
            </label>
            <input value={item.estimatedCost} onChange={(e) => setItem((f) => ({ ...f, estimatedCost: e.target.value }))}
              placeholder="Est. $" inputMode="numeric" className="w-24 text-sm rounded-md border border-border/40 bg-background px-3 py-2.5" />
            <input value={item.recommendedAction} onChange={(e) => setItem((f) => ({ ...f, recommendedAction: e.target.value }))}
              placeholder="Recommended fix (optional)" className="flex-1 min-w-[160px] text-sm rounded-md border border-border/40 bg-background px-3 py-2.5" />
          </div>

          <div className="flex gap-2">
            <button
              disabled={addItem.isPending || uploading || !item.component.trim()}
              onClick={() =>
                addItem.mutate({
                  inspectionId,
                  component: item.component.trim(),
                  category: item.category,
                  condition: item.condition,
                  notes: item.notes || undefined,
                  photoUrl: item.photoUrl || undefined,
                  recommendedAction: item.recommendedAction.trim() || undefined,
                  estimatedCost: item.estimatedCost ? Number(item.estimatedCost) : undefined,
                })
              }
              className="inline-flex items-center gap-1.5 text-[13px] font-bold bg-foreground text-background px-4 py-2.5 rounded disabled:opacity-40 active:scale-95"
            >
              <Plus className="w-4 h-4" /> Add finding
            </button>
            <button
              disabled={publish.isPending || (inspection?.items?.length ?? 0) === 0}
              onClick={() => publish.mutate({ id: inspectionId })}
              className="ml-auto text-[13px] font-bold bg-nick-yellow text-black px-5 py-2.5 rounded disabled:opacity-40 active:scale-95"
            >
              {publish.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Publish packet"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — link ready. Sharing stays a HUMAN action. */}
      {published && shareLink && (
        <div className="px-4 py-4 space-y-2">
          <p className="text-sm text-nick-teal font-bold">Packet published. Send the link through the usual channel — sharing stays your call.</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 text-[11px] text-foreground/70 bg-background border border-border/40 rounded px-2 py-2 overflow-x-auto whitespace-nowrap">{shareLink}</code>
            <button
              onClick={() => { navigator.clipboard?.writeText(shareLink).then(() => toast.success("Link copied")); }}
              className="inline-flex items-center gap-1.5 text-[12px] font-bold bg-nick-yellow text-black px-3 py-2 rounded active:scale-95"
            >
              <ClipboardCopy className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
