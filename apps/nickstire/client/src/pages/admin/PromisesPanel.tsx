/**
 * Customer Promises panel — the ledger's operating surface (Today tab).
 *
 * The ledger is only as good as its logging friction, so create is
 * three taps + one sentence: type, what was promised, when it's due
 * (quick-picks). Keep REQUIRES evidence text (the service enforces it;
 * the UI just makes it fast). Cancel goes through the in-DOM two-tap
 * (no window.confirm — iOS PWA rule). Overdue rows go red with hours.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, HandHeart, Loader2, Plus, XCircle } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  callback: "Call back",
  estimate: "Send estimate",
  status_update: "Status update",
  parts_arrival: "Parts arrival",
  completion_notice: "Ready notice",
  manager_followup: "Manager follow-up",
  other: "Other",
};

const DUE_QUICK_PICKS: Array<{ label: string; hours: number }> = [
  { label: "In 2h", hours: 2 },
  { label: "End of day", hours: 6 },
  { label: "Tomorrow", hours: 24 },
];

export default function PromisesPanel() {
  const utils = trpc.useUtils();
  /**
   * `isError` is captured and rendered — it used to be dropped.
   *
   * The empty branch below tests `!open || open.length === 0`, and a FAILED
   * query leaves `open` undefined. So a dead read rendered "No open promises."
   * — a confident all-clear about the ledger that tracks every "we'll call you
   * back" this shop has made. With `retry: 1` it reached that state fast.
   */
  const { data: open, isLoading, isError } = trpc.promises.listOpen.useQuery({ limit: 50 }, { staleTime: 60_000, retry: 1 });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ promiseType: "callback", promisedAction: "", customerName: "", customerPhone: "", dueHours: 2 });
  const [keepFor, setKeepFor] = useState<string | null>(null);
  const [evidence, setEvidence] = useState("");

  const refresh = () => utils.promises.listOpen.invalidate();
  const create = trpc.promises.create.useMutation({
    onSuccess: (r) => {
      if (r && "ok" in r && !r.ok) toast.error(r.error);
      else { toast.success("Promise logged"); setShowCreate(false); setForm({ promiseType: "callback", promisedAction: "", customerName: "", customerPhone: "", dueHours: 2 }); }
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const keep = trpc.promises.keep.useMutation({
    onSuccess: (r) => {
      if (r && "ok" in r && !r.ok) toast.error(r.error);
      else { toast.success("Kept — evidence logged"); setKeepFor(null); setEvidence(""); }
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.promises.cancel.useMutation({
    onSuccess: () => { toast.success("Cancelled"); refresh(); },
    onError: (e) => toast.error(e.message),
  });

  const cancelPromise = async (id: string, action: string) => {
    const okay = await confirmDialog({
      title: "Cancel this promise?",
      message: `"${action.slice(0, 80)}" — cancelling records who cancelled; it does not tell the customer.`,
      confirmLabel: "Cancel promise",
    });
    if (okay) cancel.mutate({ id });
  };

  const now = Date.now();

  return (
    <section aria-label="Customer promises" className="rounded-lg border border-border/40 bg-card">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <HandHeart className="w-4 h-4 text-nick-yellow" />
          <h2 className="text-sm font-bold uppercase tracking-wide">Promises</h2>
          <span className="text-[10px] text-muted-foreground">{open?.length ?? 0} open</span>
        </div>
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-black bg-nick-yellow px-2.5 py-1.5 rounded active:scale-95"
        >
          <Plus className="w-3 h-3" /> Log a promise
        </button>
      </header>

      {showCreate && (
        <div className="px-4 py-3 border-b border-border/30 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setForm((f) => ({ ...f, promiseType: value }))}
                className={`text-[11px] px-2.5 py-1.5 rounded-full border ${form.promiseType === value ? "border-nick-yellow bg-nick-yellow/15 text-nick-yellow font-bold" : "border-border/40 text-foreground/60"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            value={form.promisedAction}
            onChange={(e) => setForm((f) => ({ ...f, promisedAction: e.target.value }))}
            placeholder="Exactly what was promised — e.g. 'text when the Camry is ready'"
            maxLength={500}
            className="w-full text-sm rounded-md border border-border/40 bg-background px-3 py-2.5"
          />
          <div className="flex flex-wrap gap-2">
            <input
              value={form.customerName}
              onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              placeholder="Customer (optional)"
              className="flex-1 min-w-[120px] text-sm rounded-md border border-border/40 bg-background px-3 py-2.5"
            />
            <input
              value={form.customerPhone}
              onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
              placeholder="Phone (optional)"
              inputMode="tel"
              className="flex-1 min-w-[120px] text-sm rounded-md border border-border/40 bg-background px-3 py-2.5"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground mr-1">Due:</span>
            {DUE_QUICK_PICKS.map((p) => (
              <button
                key={p.label}
                onClick={() => setForm((f) => ({ ...f, dueHours: p.hours }))}
                className={`text-[11px] px-2.5 py-1.5 rounded-full border ${form.dueHours === p.hours ? "border-nick-yellow bg-nick-yellow/15 text-nick-yellow font-bold" : "border-border/40 text-foreground/60"}`}
              >
                {p.label}
              </button>
            ))}
            <button
              disabled={create.isPending || form.promisedAction.trim().length < 5}
              onClick={() =>
                create.mutate({
                  promiseType: form.promiseType as never,
                  promisedAction: form.promisedAction.trim(),
                  dueAtISO: new Date(Date.now() + form.dueHours * 3_600_000).toISOString(),
                  customerName: form.customerName.trim() || undefined,
                  customerPhone: form.customerPhone.trim() || undefined,
                })
              }
              className="ml-auto text-[12px] font-bold bg-nick-yellow text-black px-4 py-2 rounded disabled:opacity-40 active:scale-95"
            >
              {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Log it"}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="px-4 py-4 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading promises…
        </div>
      ) : isError ? (
        <div className="px-4 py-4 text-sm text-amber-600" role="status">
          Promises unavailable — this is UNKNOWN, not zero. Open promises may exist that this panel could not read.
        </div>
      ) : !open || open.length === 0 ? (
        <div className="px-4 py-4 text-sm text-muted-foreground">
          No open promises. Log one the moment you say "we'll call you back" — the sweep escalates anything overdue into the inbox.
        </div>
      ) : (
        <ul className="divide-y divide-border/30">
          {open.map((p) => {
            const dueMs = new Date(p.dueAt).getTime();
            const overdueH = Math.floor((now - dueMs) / 3_600_000);
            const overdue = now > dueMs;
            return (
              <li key={p.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-border/40 text-foreground/60">
                    {TYPE_LABELS[p.promiseType] ?? p.promiseType}
                  </span>
                  <span className="text-sm text-foreground">{p.promisedAction}</span>
                  {p.customerName && <span className="text-[11px] text-muted-foreground">· {p.customerName}</span>}
                  <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-bold ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
                    <CalendarClock className="w-3 h-3" />
                    {overdue ? `${overdueH}h overdue` : `due ${new Date(p.dueAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  {keepFor === p.id ? (
                    <>
                      <input
                        value={evidence}
                        onChange={(e) => setEvidence(e.target.value)}
                        placeholder="What did you do? e.g. 'texted 3:10pm'"
                        maxLength={280}
                        autoFocus
                        className="flex-1 text-[12px] rounded border border-border/40 bg-background px-2 py-1.5"
                      />
                      <button
                        disabled={keep.isPending || evidence.trim().length < 3}
                        onClick={() => keep.mutate({ id: p.id, evidence: evidence.trim() })}
                        className="text-[11px] font-bold px-3 py-1.5 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 disabled:opacity-40"
                      >
                        Kept
                      </button>
                      <button onClick={() => { setKeepFor(null); setEvidence(""); }} className="text-[11px] text-foreground/40 px-1">
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setKeepFor(p.id)}
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded border border-emerald-500/30 text-emerald-300/90"
                      >
                        <CheckCircle2 className="w-3 h-3" /> Mark kept
                      </button>
                      <button
                        onClick={() => cancelPromise(p.id, p.promisedAction)}
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded border border-border/40 text-foreground/50"
                      >
                        <XCircle className="w-3 h-3" /> Cancel
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
