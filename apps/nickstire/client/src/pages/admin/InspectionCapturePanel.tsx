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
 *
 * 2026-10-07 (migration 0143):
 *  - MEASUREMENTS. Tread per corner in 32nds, pad mm, rotor mm against its
 *    spec, battery V / CCA, fluid condition — structured, graded by the
 *    shop-guidance bands in shared/inspectionMeasurements.ts. Adding one
 *    pre-selects the condition; the tech's own tap still wins.
 *  - MANY PHOTOS per finding (up to MAX_ITEM_PHOTOS); the first is the cover.
 *  - VERIFY WORK. A second mode: pick a recent published check, and for each
 *    flagged item record the AFTER photo + AFTER measurement once the repair
 *    is done. That is the proof the customer page shows, and it closes the
 *    deferral in the opportunity queue.
 * No confirm()/alert(): iOS standalone swallows them (nickstire-ios-pwa-primitives).
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Camera, CheckCircle, ClipboardCopy, Loader2, Plus, Ruler, Trash2, Wrench, X, XCircle, AlertTriangle, BadgeCheck } from "lucide-react";
import {
  MAX_ITEM_MEASUREMENTS,
  MAX_ITEM_PHOTOS,
  MEASUREMENT_SPECS,
  formatMeasurement,
  gradeMeasurement,
  metricsForCategory,
  suggestCondition,
  type Grade,
  type InspectionMeasurement,
  type MeasurementMetric,
} from "@shared/inspectionMeasurements";

const CATEGORIES = ["brakes", "tires", "engine", "suspension", "electrical", "fluids", "body", "other"] as const;
type Category = (typeof CATEGORIES)[number];
type Condition = "green" | "yellow" | "red";

const CONDITIONS = [
  { value: "green", label: "Good", cls: "border-nick-teal/50 bg-nick-teal/15 text-nick-teal", icon: <CheckCircle className="w-5 h-5" /> },
  { value: "yellow", label: "Monitor", cls: "border-primary/50 bg-primary/15 text-primary", icon: <AlertTriangle className="w-5 h-5" /> },
  { value: "red", label: "Needs repair", cls: "border-red-500/50 bg-red-500/15 text-red-400", icon: <XCircle className="w-5 h-5" /> },
] as const;

const GRADE_DOT: Record<Grade, string> = { green: "bg-nick-teal", yellow: "bg-primary", red: "bg-red-500" };
const PHOTO_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
type PhotoMime = (typeof PHOTO_MIME)[number];

/** Reads a File as base64 and uploads it through the admin-only uploadPhoto procedure. */
function usePhotoUploader() {
  const uploadPhoto = trpc.inspection.uploadPhoto.useMutation();
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File | undefined): Promise<string | null> => {
    if (!file) return null;
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const mimeType = (PHOTO_MIME as readonly string[]).includes(file.type) ? (file.type as PhotoMime) : "image/jpeg";
      const { url } = await uploadPhoto.mutateAsync({ base64, filename: file.name || "finding.jpg", mimeType });
      return url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo upload failed");
      return null;
    } finally {
      setUploading(false);
    }
  };
  return { upload, uploading };
}

/** Thumbnails + one camera button; the list is capped at MAX_ITEM_PHOTOS. */
function PhotoStrip({ urls, onAdd, onRemove, uploading, label }: { urls: string[]; onAdd: (f: File | undefined) => void; onRemove: (i: number) => void; uploading: boolean; label: string }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const full = urls.length >= MAX_ITEM_PHOTOS;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {urls.map((u, i) => (
        <span key={u + i} className="relative inline-block">
          <img src={u} alt={`${label} ${i + 1}`} className="w-12 h-12 rounded object-cover border border-border/40" />
          <button type="button" onClick={() => onRemove(i)} aria-label={`Remove photo ${i + 1}`}
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-background border border-border/60 text-foreground/70 flex items-center justify-center">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <label className={`inline-flex items-center gap-2 text-[12px] font-bold px-4 min-h-12 rounded-md border cursor-pointer active:scale-95 ${full ? "opacity-40 pointer-events-none" : urls.length ? "border-nick-teal/50 text-nick-teal" : "border-border/40 text-foreground/70"}`}>
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
        {urls.length ? `${label} ${urls.length}/${MAX_ITEM_PHOTOS} · add` : `Add ${label.toLowerCase()}`}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" disabled={full || uploading}
          onChange={(e) => { onAdd(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = ""; }} />
      </label>
    </div>
  );
}

/**
 * One measurement at a time: metric (filtered by category) → position → value
 * (→ spec when the grade needs one) → Add. Recorded entries show as chips with
 * the grade dot the customer will see.
 */
function MeasurementEditor({ category, value, onChange }: { category: Category; value: InspectionMeasurement[]; onChange: (next: InspectionMeasurement[]) => void }) {
  const specs = metricsForCategory(category);
  const [metric, setMetric] = useState<MeasurementMetric | "">(specs[0]?.metric ?? "");
  const [position, setPosition] = useState("");
  const [raw, setRaw] = useState("");
  const [spec, setSpec] = useState("");
  // The category chips can change under us; keep the metric valid for the category.
  useEffect(() => {
    if (!specs.some((s) => s.metric === metric)) {
      setMetric(specs[0]?.metric ?? "");
      setPosition("");
      setRaw("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);
  const active = metric && specs.some((s) => s.metric === metric) ? MEASUREMENT_SPECS[metric] : null;
  if (specs.length === 0) return null;

  const add = () => {
    if (!active) return;
    const m: InspectionMeasurement = active.kind === "number"
      ? { metric: active.metric, value: Number(raw) }
      : { metric: active.metric, value: raw };
    if (position) m.position = position;
    if (active.specLabel && spec) m.spec = Number(spec);
    if (active.kind === "number" && (!Number.isFinite(m.value as number) || (m.value as number) < active.min || (m.value as number) > active.max)) {
      toast.error(`${active.label}: enter ${active.min}–${active.max} ${active.unit}`);
      return;
    }
    if (active.kind === "choice" && !active.choices?.includes(String(m.value))) {
      toast.error(`${active.label}: pick a condition`);
      return;
    }
    if (value.length >= MAX_ITEM_MEASUREMENTS) { toast.error(`Limit of ${MAX_ITEM_MEASUREMENTS} measurements per finding`); return; }
    onChange([...value, m]);
    setRaw("");
  };

  return (
    <div className="space-y-2 rounded-md border border-border/30 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground/60"><Ruler className="w-3.5 h-3.5" /> Measurements</div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((m, i) => {
            const g = gradeMeasurement(m);
            return (
              <span key={i} className="inline-flex items-center gap-1.5 text-[12px] rounded-full border border-border/40 pl-2 pr-1 py-1">
                {g && <span className={`w-2 h-2 rounded-full ${GRADE_DOT[g]}`} />}
                {formatMeasurement(m)}
                <button type="button" aria-label={`Remove ${formatMeasurement(m)}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="w-6 h-6 rounded-full text-foreground/40 hover:text-red-400 flex items-center justify-center"><X className="w-3 h-3" /></button>
              </span>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <select value={metric} onChange={(e) => { setMetric(e.target.value as MeasurementMetric); setPosition(""); setRaw(""); }} aria-label="Measurement"
          className="text-sm rounded-md border border-border/40 bg-background px-2 min-h-12">
          {specs.map((s) => <option key={s.metric} value={s.metric}>{s.label}{s.unit ? ` (${s.unit})` : ""}</option>)}
        </select>
        {active?.positions && (
          <select value={position} onChange={(e) => setPosition(e.target.value)} aria-label="Position"
            className="text-sm rounded-md border border-border/40 bg-background px-2 min-h-12">
            <option value="">{active.metric === "fluid_condition" ? "Which fluid" : "Position"}</option>
            {active.positions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {active?.kind === "number" ? (
          <input value={raw} onChange={(e) => setRaw(e.target.value)} inputMode="decimal" placeholder={active.unit || "value"} aria-label={`${active.label} value`}
            className="w-24 text-sm rounded-md border border-border/40 bg-background px-3 min-h-12" />
        ) : active ? (
          <select value={raw} onChange={(e) => setRaw(e.target.value)} aria-label="Condition" className="text-sm rounded-md border border-border/40 bg-background px-2 min-h-12">
            <option value="">Condition</option>
            {active.choices?.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : null}
        {active?.specLabel && (
          <input value={spec} onChange={(e) => setSpec(e.target.value)} inputMode="decimal" placeholder={active.specLabel} aria-label={active.specLabel}
            className="w-32 text-sm rounded-md border border-border/40 bg-background px-3 min-h-12" />
        )}
        <button type="button" onClick={add} disabled={!active || !raw}
          className="inline-flex items-center gap-1 text-[12px] font-bold px-3 min-h-12 rounded-md border border-border/40 text-foreground/80 disabled:opacity-40 active:scale-95">
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </div>
  );
}

type ItemRow = {
  id: number; component: string; category: string; condition: string; decision: string | null;
  estimatedCost: number | null; photoUrl: string | null;
  photoUrls?: string[]; measurements?: InspectionMeasurement[];
  verification?: { verifiedAt: string | Date; verifiedBy: string | null; note: string | null; photoUrls: string[]; measurements: InspectionMeasurement[] } | null;
};

export default function InspectionCapturePanel() {
  const [mode, setMode] = useState<"capture" | "verify">("capture");
  return (
    <section aria-label="Vehicle check capture" className="rounded-lg border border-border/40 bg-card">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-nick-yellow" />
          <h2 className="text-sm font-bold uppercase tracking-wide">Vehicle Check</h2>
        </div>
        <div className="flex rounded-md border border-border/40 overflow-hidden" role="tablist" aria-label="Vehicle check mode">
          {([["capture", "New check"], ["verify", "Verify work"]] as const).map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`text-[11px] font-bold px-3 min-h-10 ${mode === m ? "bg-nick-yellow text-black" : "text-foreground/60"}`}>
              {label}
            </button>
          ))}
        </div>
      </header>
      {mode === "capture" ? <CaptureFlow /> : <VerifyFlow />}
    </section>
  );
}

function CaptureFlow() {
  const utils = trpc.useUtils();
  const [inspectionId, setInspectionId] = useState<number | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  const [createForm, setCreateForm] = useState({ customerName: "", customerPhone: "", vehicleInfo: "", technicianName: "", mileage: "" });
  const emptyItem = (category: Category) => ({ component: "", category, condition: "yellow" as Condition, notes: "", recommendedAction: "", estimatedCost: "", photoUrls: [] as string[], measurements: [] as InspectionMeasurement[] });
  const [item, setItem] = useState(emptyItem("brakes"));
  const { upload, uploading } = usePhotoUploader();

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
    onSuccess: (r) => {
      setItem(emptyItem(item.category));
      utils.inspection.get.invalidate({ id: inspectionId! });
      if (r.degraded === "measurements_unavailable") {
        toast.warning("Finding saved, but its measurements and extra photos were NOT stored — database migration 0143 is still pending.");
      } else {
        toast.success("Finding added");
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteItem = trpc.inspection.deleteItem.useMutation({
    onSuccess: () => utils.inspection.get.invalidate({ id: inspectionId! }),
    onError: (e) => toast.error(e.message),
  });
  const publish = trpc.inspection.publish.useMutation({
    onSuccess: () => { setPublished(true); toast.success("Published — link ready"); },
    onError: (e) => toast.error(e.message),
  });

  const onPhotoPicked = async (file: File | undefined) => {
    if (!inspectionId) return;
    const url = await upload(file);
    if (url) setItem((f) => ({ ...f, photoUrls: [...f.photoUrls, url].slice(0, MAX_ITEM_PHOTOS) }));
  };

  // A measurement pre-selects the condition from the shop bands; the tech's
  // own tap on the three buttons still overrides it.
  const onMeasurementsChange = (measurements: InspectionMeasurement[]) => {
    const suggested = suggestCondition(measurements);
    setItem((f) => ({ ...f, measurements, condition: suggested ?? f.condition }));
  };

  const reset = () => {
    setInspectionId(null);
    setShareToken(null);
    setPublished(false);
    setCreateForm({ customerName: "", customerPhone: "", vehicleInfo: "", technicianName: "", mileage: "" });
    setItem(emptyItem("brakes"));
  };

  const shareLink = shareToken ? `${window.location.origin}/inspection/${shareToken}` : "";
  const items = (inspection?.items ?? []) as ItemRow[];

  return (
    <>
      {inspectionId && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/20 text-[10px] text-muted-foreground">
          <span>#{inspectionId} · {items.length} findings</span>
          <button onClick={reset} className="underline min-h-10 px-2">new check</button>
        </div>
      )}

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
              className="text-[13px] font-bold bg-nick-yellow text-black px-5 min-h-12 rounded disabled:opacity-40 active:scale-95"
            >
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Start check"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — findings */}
      {inspectionId && !published && (
        <div className="px-4 py-3 space-y-3">
          {items.length > 0 && (
            <ul className="space-y-1.5">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-[13px]">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${i.condition === "green" ? "bg-nick-teal" : i.condition === "yellow" ? "bg-primary" : "bg-red-500"}`} />
                  <span className="text-foreground">{i.component}</span>
                  {(i.photoUrls?.length ?? (i.photoUrl ? 1 : 0)) > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Camera className="w-3 h-3" />{i.photoUrls?.length ?? 1}</span>
                  )}
                  {(i.measurements?.length ?? 0) > 0 && (
                    <span className="text-[11px] text-foreground/60 truncate">{i.measurements!.map(formatMeasurement).join(" · ")}</span>
                  )}
                  {(i.estimatedCost ?? 0) > 0 && <span className="text-primary">${i.estimatedCost}</span>}
                  <button onClick={() => deleteItem.mutate({ id: i.id })} aria-label={`Remove ${i.component}`} className="ml-auto w-10 h-10 flex items-center justify-center text-foreground/30 hover:text-red-400">
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
                className={`text-[11px] px-2.5 min-h-10 rounded-full border ${item.category === c ? "border-nick-yellow bg-nick-yellow/15 text-nick-yellow font-bold" : "border-border/40 text-foreground/60"}`}>
                {c}
              </button>
            ))}
          </div>

          <MeasurementEditor category={item.category} value={item.measurements} onChange={onMeasurementsChange} />

          <PhotoStrip urls={item.photoUrls} uploading={uploading} label="Photo"
            onAdd={onPhotoPicked} onRemove={(i) => setItem((f) => ({ ...f, photoUrls: f.photoUrls.filter((_, j) => j !== i) }))} />

          <div className="flex flex-wrap gap-2">
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
                  photoUrl: item.photoUrls[0] || undefined,
                  photoUrls: item.photoUrls.length ? item.photoUrls : undefined,
                  measurements: item.measurements.length ? item.measurements : undefined,
                  recommendedAction: item.recommendedAction.trim() || undefined,
                  estimatedCost: item.estimatedCost ? Number(item.estimatedCost) : undefined,
                })
              }
              className="inline-flex items-center gap-1.5 text-[13px] font-bold bg-foreground text-background px-4 min-h-12 rounded disabled:opacity-40 active:scale-95"
            >
              <Plus className="w-4 h-4" /> Add finding
            </button>
            <button
              disabled={publish.isPending || items.length === 0}
              onClick={() => publish.mutate({ id: inspectionId })}
              className="ml-auto text-[13px] font-bold bg-nick-yellow text-black px-5 min-h-12 rounded disabled:opacity-40 active:scale-95"
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
              className="inline-flex items-center gap-1.5 text-[12px] font-bold bg-nick-yellow text-black px-3 min-h-10 rounded active:scale-95"
            >
              <ClipboardCopy className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Verify work: after the approved repair, record the proof. One item at a
 * time; the AFTER measurement uses the same editor and bands as the finding.
 */
function VerifyFlow() {
  const utils = trpc.useUtils();
  const [inspectionId, setInspectionId] = useState<number | null>(null);
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [verifiedBy, setVerifiedBy] = useState("");
  const [note, setNote] = useState("");
  const [afterPhotos, setAfterPhotos] = useState<string[]>([]);
  const [afterMeasurements, setAfterMeasurements] = useState<InspectionMeasurement[]>([]);
  const { upload, uploading } = usePhotoUploader();

  const { data: list } = trpc.inspection.list.useQuery();
  const { data: inspection } = trpc.inspection.get.useQuery({ id: inspectionId! }, { enabled: inspectionId !== null });
  const verify = trpc.inspection.verifyItem.useMutation({
    onSuccess: () => {
      utils.inspection.get.invalidate({ id: inspectionId! });
      setOpenItemId(null); setNote(""); setAfterPhotos([]); setAfterMeasurements([]);
      toast.success("Verified — the customer page now shows the completed work");
    },
    onError: (e) => toast.error(e.message),
  });

  const recent = ((list ?? []) as Array<{ id: number; customerName: string; vehicleInfo: string; isPublished: number; createdAt: string | Date }>)
    .filter((i) => i.isPublished === 1)
    .slice(0, 25);
  const flagged = ((inspection?.items ?? []) as ItemRow[]).filter((i) => i.condition !== "green");
  const openItem = (id: number) => { setOpenItemId(id); setNote(""); setAfterPhotos([]); setAfterMeasurements([]); };

  return (
    <div className="px-4 py-3 space-y-3">
      <p className="text-[12px] text-foreground/60">After the approved repair is done, attach the after-photo and the after-measurement. The customer's page shows it as completed and verified.</p>
      <select value={inspectionId ?? ""} onChange={(e) => { setInspectionId(e.target.value ? Number(e.target.value) : null); setOpenItemId(null); }} aria-label="Published check"
        className="w-full text-sm rounded-md border border-border/40 bg-background px-3 min-h-12">
        <option value="">Pick a published check…</option>
        {recent.map((i) => (
          <option key={i.id} value={i.id}>#{i.id} · {i.customerName} · {i.vehicleInfo} · {new Date(i.createdAt).toLocaleDateString()}</option>
        ))}
      </select>

      {inspectionId !== null && flagged.length === 0 && <p className="text-[12px] text-foreground/50">No yellow or red items on this check.</p>}

      <ul className="space-y-2">
        {flagged.map((i) => {
          const isOpen = openItemId === i.id;
          return (
            <li key={i.id} className="rounded-md border border-border/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-[13px]">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${i.condition === "yellow" ? "bg-primary" : "bg-red-500"}`} />
                <span className="font-bold text-foreground">{i.component}</span>
                <span className="text-[11px] text-foreground/50">{i.decision ?? "no decision yet"}</span>
                {i.verification ? (
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-nick-teal font-bold"><BadgeCheck className="w-3.5 h-3.5" /> verified {new Date(i.verification.verifiedAt).toLocaleDateString()}</span>
                ) : (
                  <button onClick={() => (isOpen ? setOpenItemId(null) : openItem(i.id))}
                    className="ml-auto text-[12px] font-bold px-3 min-h-10 rounded border border-nick-teal/50 text-nick-teal active:scale-95">
                    {isOpen ? "cancel" : "Verify"}
                  </button>
                )}
              </div>
              {(i.measurements?.length ?? 0) > 0 && (
                <p className="text-[11px] text-foreground/60">Found: {i.measurements!.map(formatMeasurement).join(" · ")}</p>
              )}
              {isOpen && (
                <div className="space-y-2 pt-1">
                  <input value={verifiedBy} onChange={(e) => setVerifiedBy(e.target.value)} placeholder="Tech who did the work *"
                    className="w-full text-sm rounded-md border border-border/40 bg-background px-3 min-h-12" />
                  <MeasurementEditor category={(CATEGORIES as readonly string[]).includes(i.category) ? (i.category as Category) : "other"} value={afterMeasurements} onChange={setAfterMeasurements} />
                  <PhotoStrip urls={afterPhotos} uploading={uploading} label="After photo"
                    onAdd={async (f) => { const url = await upload(f); if (url) setAfterPhotos((p) => [...p, url].slice(0, MAX_ITEM_PHOTOS)); }}
                    onRemove={(idx) => setAfterPhotos((p) => p.filter((_, j) => j !== idx))} />
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note for the customer (optional) — e.g. new pads and rotors, road tested"
                    className="w-full text-sm rounded-md border border-border/40 bg-background px-3 min-h-12" />
                  <button
                    disabled={verify.isPending || uploading || !verifiedBy.trim() || (afterPhotos.length === 0 && afterMeasurements.length === 0)}
                    onClick={() => verify.mutate({ id: i.id, verifiedBy: verifiedBy.trim(), note: note.trim() || undefined, photoUrls: afterPhotos.length ? afterPhotos : undefined, measurements: afterMeasurements.length ? afterMeasurements : undefined })}
                    className="inline-flex items-center gap-1.5 text-[13px] font-bold bg-nick-teal text-black px-4 min-h-12 rounded disabled:opacity-40 active:scale-95">
                    {verify.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />} Mark verified
                  </button>
                  <p className="text-[11px] text-foreground/40">Needs at least one after-photo or after-measurement — a claim with no evidence is not a verification.</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
