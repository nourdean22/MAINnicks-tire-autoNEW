/**
 * Tire registration panel (Q-47, 49 CFR 574.8) — lives in the work-order drawer.
 *
 * Capture each installed tire's DOT code (TIN) per position, print the registration form, and
 * record how the shop met 574.8. Nothing here contacts the customer or a manufacturer.
 *
 * empty-vs-error: a failed read renders as an error with a retry — never as "0 tires".
 * iOS PWA: no window.confirm/prompt; confirmDialog + inline inputs; 48px targets.
 */
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Printer, RefreshCw, Trash2, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import {
  checkTin, registrationLink, tinAgeYears, REGISTRATION_METHOD_LABELS, tirePositionLabel, tirePositionsForCount,
  REGISTRATION_WINDOW_DAYS, type RegistrationMethod, type TireCondition,
} from "@shared/tireTin";

const BTN = "min-h-12 min-w-12 px-3 text-xs font-medium rounded border transition-colors disabled:opacity-50";

const SUBMIT_STEPS: Array<{ method: Exclude<RegistrationMethod, "pending" | "not_required_used">; label: string; confirm: string }> = [
  { method: "form_given", label: "Form handed to customer", confirm: "The customer was given the printed registration form with every DOT code on it." },
  { method: "dealer_submitted_electronic", label: "Shop registered online", confirm: "The shop registered every new tire on the manufacturer's site (within 30 days of the sale)." },
  { method: "dealer_submitted_paper", label: "Shop mailed the form", confirm: "The shop filled in the customer's name and address and mailed the form to the manufacturer (within 30 days of the sale)." },
];

export default function TireRegistrationPanel({ workOrderId }: { workOrderId: string }) {
  const utils = trpc.useUtils();
  const reg = trpc.workOrders.tireRegistration.useQuery({ workOrderId }, { retry: 1 });
  const onDone = { onSuccess: () => utils.workOrders.tireRegistration.invalidate({ workOrderId }) };
  const capture = trpc.workOrders.captureTireTin.useMutation({
    ...onDone, onError: (e) => toast.error(`DOT code not saved: ${e.message}`),
  });
  const remove = trpc.workOrders.removeTirePosition.useMutation({
    ...onDone, onError: (e) => toast.error(`Remove failed: ${e.message}`),
  });
  const record = trpc.workOrders.recordTireRegistration.useMutation({
    ...onDone, onError: (e) => toast.error(`Not recorded: ${e.message}`),
  });

  const rows = reg.data?.rows ?? [];
  const expectedForPositions = reg.data?.expected ?? 0;
  const positionChoices = useMemo(
    () => tirePositionsForCount(Math.max(expectedForPositions, rows.length)),
    [expectedForPositions, rows.length],
  );
  const taken = new Set(rows.map((r) => r.position));
  const nextFree = positionChoices.find((p) => !taken.has(p)) ?? positionChoices[0] ?? "LF";

  const [position, setPosition] = useState<string | null>(null);
  const [tin, setTin] = useState("");
  const [brand, setBrand] = useState("");
  const [condition, setCondition] = useState<TireCondition>("new");
  const [formHtml, setFormHtml] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const tinRef = useRef<HTMLInputElement>(null);

  const livePos = position ?? nextFree;
  const live = useMemo(() => (tin.trim() ? checkTin(tin) : null), [tin]);

  const save = () => {
    if (!live || live.status === "invalid") {
      toast.error(live?.issues.join(" ") || "Enter the DOT code.");
      return;
    }
    capture.mutate(
      { workOrderId, position: livePos, tin, brand: brand.trim() || undefined, condition },
      { onSuccess: () => { setFormHtml(null); setTin(""); setPosition(null); tinRef.current?.focus(); } },
    );
  };

  const openForm = async () => {
    setFormLoading(true);
    try {
      const { html } = await utils.workOrders.tireRegistrationForm.fetch({ workOrderId });
      setFormHtml(html);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the form.");
    } finally {
      setFormLoading(false);
    }
  };

  const recordStep = async (step: (typeof SUBMIT_STEPS)[number]) => {
    const ok = await confirmDialog({
      title: `${step.label}?`,
      message: `${step.confirm} This is recorded as the shop's 49 CFR 574.8 compliance for this order.`,
      confirmLabel: "Record it",
    });
    if (ok) record.mutate({ workOrderId, method: step.method });
  };

  // ── Read states — error and loading never collapse into "0 tires" ──
  if (reg.isLoading) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-xs text-foreground/50"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading DOT codes…</div>
      </Section>
    );
  }
  if (reg.isError || !reg.data) {
    return (
      <Section>
        <div role="alert" className="bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-300 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Couldn't load tire registration — this is NOT the same as "no tires". {reg.error?.message}</span>
          </div>
          <button type="button" onClick={() => reg.refetch()} className={`${BTN} border-red-400/40 inline-flex items-center gap-1.5`}>
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      </Section>
    );
  }

  const { summary, expected } = reg.data;
  const newRows = rows.filter((r) => r.tireCondition !== "used");
  const brands = Array.from(new Set(newRows.map((r) => (r.tireBrand ?? "").trim()).filter(Boolean)));
  const pending = newRows.some((r) => r.registrationMethod === "pending");

  return (
    <Section
      badge={
        summary.state === "complete" ? (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> REGISTERED</span>
        ) : summary.state === "incomplete" ? (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
            INCOMPLETE · {summary.captured} of {Math.max(expected, rows.length)} DOT codes{summary.pendingPositions.length ? " · not registered" : ""}
          </span>
        ) : null
      }
    >
      {summary.state === "not_applicable" && (
        <div className="text-[11px] text-foreground/45">No tire lines on this work order. Capture DOT codes only if tires were installed.</div>
      )}

      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const flagged = r.tinStatus !== "valid";
            return (
              <div key={r.position} className={`bg-card border p-2.5 flex items-center gap-3 ${flagged ? "border-red-500/40" : "border-border/30"}`}>
                <div className="w-10 text-[11px] font-semibold text-foreground/60" title={tirePositionLabel(r.position)}>{r.position}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs tracking-wider truncate">{r.tin ?? "—"}</div>
                  <div className="text-[10px] text-foreground/40 flex flex-wrap gap-x-2">
                    {r.tireBrand && <span>{r.tireBrand}</span>}
                    <span>{r.tireCondition}</span>
                    {r.tinWeek != null && r.tinYear != null && <span>made wk {r.tinWeek}/{r.tinYear}</span>}
                    {(() => { const age = r.tin ? tinAgeYears(checkTin(r.tin)) : null; return age != null && age >= 6
                      ? <span className="text-amber-400">{age} years old</span> : null; })()}
                    <span>{REGISTRATION_METHOD_LABELS[r.registrationMethod as RegistrationMethod] ?? r.registrationMethod}</span>
                  </div>
                  {flagged && <div className="text-[10px] text-red-400 mt-0.5">{checkTin(r.tin ?? "").issues.join(" ")}</div>}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${r.position}`}
                  disabled={remove.isPending}
                  onClick={async () => {
                    const ok = await confirmDialog({ title: `Remove ${r.position}?`, message: `DOT code ${r.tin ?? ""} will be removed from this work order.`, confirmLabel: "Remove", tone: "danger" });
                    if (ok) remove.mutate({ workOrderId, position: r.position }, { onSuccess: () => setFormHtml(null) });
                  }}
                  className={`${BTN} border-border/40 text-foreground/50 inline-flex items-center justify-center`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {summary.missingTins > 0 && expected > 0 && (
        <div className="text-[11px] text-amber-400">{summary.missingTins} tire(s) sold on this order still need a DOT code.</div>
      )}

      {/* Capture one position */}
      <div className="bg-card border border-border/30 p-2.5 space-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tire position">
          {positionChoices.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPosition(p)}
              aria-pressed={livePos === p}
              className={`${BTN} ${livePos === p ? "border-primary text-primary bg-primary/10" : taken.has(p) ? "border-emerald-500/30 text-emerald-400/80" : "border-border/40 text-foreground/60"}`}
            >
              {p}
            </button>
          ))}
        </div>
        <label className="block text-[10px] text-foreground/40">
          DOT code for {tirePositionLabel(livePos)}{taken.has(livePos) ? " (replaces the saved one)" : ""}
          <input
            ref={tinRef}
            value={tin}
            onChange={(e) => setTin(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="e.g. 3D1 A7B2C4 2324"
            className="mt-1 w-full min-h-12 px-3 font-mono text-sm tracking-wider bg-background border border-border/40 rounded"
          />
        </label>
        {live && (
          <div className={`text-[11px] ${live.status === "valid" ? "text-emerald-400" : live.status === "legacy_date_code" ? "text-amber-400" : "text-red-400"}`}>
            {live.status === "valid" ? `Looks right — made week ${live.week} of ${live.year}.` : live.issues.join(" ")}
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex-1 min-w-[8rem] text-[10px] text-foreground/40">
            Brand
            <input value={brand} onChange={(e) => setBrand(e.target.value)} className="mt-1 w-full min-h-12 px-3 text-sm bg-background border border-border/40 rounded" />
          </label>
          <div className="flex gap-1.5" role="group" aria-label="Tire condition">
            {(["new", "used"] as const).map((c) => (
              <button key={c} type="button" aria-pressed={condition === c} onClick={() => setCondition(c)}
                className={`${BTN} ${condition === c ? "border-primary text-primary bg-primary/10" : "border-border/40 text-foreground/60"}`}>
                {c === "new" ? "New" : "Used"}
              </button>
            ))}
          </div>
          <button type="button" onClick={save} disabled={capture.isPending || !tin.trim()}
            className={`${BTN} border-primary/40 text-primary bg-primary/10 inline-flex items-center gap-1.5`}>
            {capture.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save {livePos}
          </button>
        </div>
      </div>

      {/* Registration — only once new tires are captured */}
      {newRows.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={openForm} disabled={formLoading || summary.missingTins > 0}
            className={`${BTN} w-full border-border/40 inline-flex items-center justify-center gap-1.5`}>
            {formLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
            {summary.missingTins > 0 ? "Registration form (capture every DOT code first)" : "Registration form"}
          </button>
          {pending && summary.missingTins === 0 && (
            <div className="grid gap-1.5">
              {SUBMIT_STEPS.map((s) => (
                <button key={s.method} type="button" disabled={record.isPending} onClick={() => recordStep(s)}
                  className={`${BTN} border-primary/30 text-primary`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {pending && (
            <div className="text-[10px] text-foreground/40">
              Federal rule 49 CFR 574.8: hand the customer the form, or register the tires within {REGISTRATION_WINDOW_DAYS} days of the sale.
            </div>
          )}
          {brands.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {brands.map((b) => {
                const l = registrationLink(b);
                return (
                  <a key={b} href={l.url} target="_blank" rel="noopener noreferrer"
                    className={`${BTN} border-border/40 text-foreground/60 inline-flex items-center gap-1.5`}>
                    <ExternalLink className="w-3.5 h-3.5" /> {l.verified ? `${b} registration` : `Search: ${b} tire registration`}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {formHtml && (
        <div className="border border-border/40 bg-white">
          <div className="flex justify-end gap-2 p-2 bg-background">
            <button type="button" onClick={() => frameRef.current?.contentWindow?.print()} className={`${BTN} border-border/40 inline-flex items-center gap-1.5`}>
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button type="button" onClick={() => setFormHtml(null)} className={`${BTN} border-border/40`}>Close</button>
          </div>
          <iframe ref={frameRef} title="Tire registration form" srcDoc={formHtml} className="w-full h-[28rem] bg-white" />
        </div>
      )}
    </Section>
  );
}

function Section({ children, badge }: { children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="space-y-2" data-testid="tire-registration-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold text-foreground/40 tracking-wide">TIRE REGISTRATION · DOT CODES</div>
        {badge}
      </div>
      {children}
    </div>
  );
}
