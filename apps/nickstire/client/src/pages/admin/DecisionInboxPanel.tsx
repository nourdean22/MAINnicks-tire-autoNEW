/**
 * Owner Decision Inbox — the Wave-4 opportunity queue's tap surface.
 *
 * Top-5 evidence-backed decisions, ranked urgency-first (a value-unknown
 * critical callback outranks a mid-value inferred estimate — the queue
 * never invents dollars). Every button below maps 1:1 to a queue state
 * transition or receipt-logged action. The ONE path that contacts a customer
 * is the draft bridge (2026-07-29): a deterministic server draft the operator
 * edits and two-tap approves — ladder level 1, receipted as `attempted`,
 * riding sendSms's full gate stack. Call-first types get no draft at all.
 *
 * iOS-PWA rules: no window.confirm anywhere — destructive-ish actions
 * (Lost / Do-not-contact) go through confirmDialog (the in-DOM confirm
 * the rest of /admin uses).
 *
 * Recovery 2.0 hook: unapproved-estimate cards carry stated-concern
 * chips — one tap records what the customer actually said (source:
 * operator), which re-routes the recovery track and, for closed signals,
 * stops the sequence for that estimate.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Inbox,
  Loader2,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";

const URGENCY_STYLES: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  today: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  this_week: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  later: "bg-muted text-muted-foreground border-border/40",
};

const CONCERN_CHIPS: Array<{ value: string; label: string; closes: boolean }> = [
  { value: "price", label: "Price", closes: false },
  { value: "proof", label: "Wants proof", closes: false },
  { value: "time", label: "Timing", closes: false },
  { value: "waiting_event", label: "Payday/date", closes: false },
  { value: "repaired_elsewhere", label: "Fixed elsewhere", closes: true },
  { value: "no_longer_owns", label: "Sold the car", closes: true },
  { value: "not_interested", label: "Not interested", closes: true },
];

/** Mirrors the server's channel policy (opportunityDraft.ts) for the badge;
 *  the server remains the authority — sendOutreach refuses call-only types. */
const CALL_ONLY_SOURCES = new Set(["callback", "review_recovery", "promise_overdue"]);
const DRAFTABLE_SOURCES = new Set(["stale_lead", "unapproved_estimate", "deferred_service", "missed_call"]);

export default function DecisionInboxPanel() {
  const utils = trpc.useUtils();
  const { data, isLoading, isError } = trpc.opportunityQueue.top.useQuery(
    { n: 5 },
    { staleTime: 60_000, retry: 1 },
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [invoiceInputs, setInvoiceInputs] = useState<Record<string, string>>({});
  /** Wave 6: per-row "manual match" — the backend always supported
   *  allowManualMatch; without this toggle a legitimately-won opportunity
   *  with a mismatched phone was un-closable from the UI. */
  const [manualMatch, setManualMatch] = useState<Record<string, boolean>>({});
  /** Wave 6: snooze duration choice (was a fixed 2 days). */
  const [snoozeChoice, setSnoozeChoice] = useState<Record<string, string>>({});
  /** id whose draft editor is open + the editable text + server risk meta */
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftMeta, setDraftMeta] = useState<{ riskLabel: string; riskReasons: string[]; guardFindings: Array<{ code: string; message: string }> } | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);

  const refresh = () => utils.opportunityQueue.top.invalidate();

  const transition = trpc.opportunityQueue.transition.useMutation({
    onSuccess: (res) => {
      if (res && "ok" in res && !res.ok) toast.error(res.error);
      else toast.success("Recorded");
      refresh();
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => setBusyId(null),
  });
  const snooze = trpc.opportunityQueue.snooze.useMutation({
    onSuccess: () => { toast.success("Snoozed 2 days"); refresh(); },
    onError: (e) => toast.error(e.message),
    onSettled: () => setBusyId(null),
  });
  const outcome = trpc.opportunityQueue.recordOutcome.useMutation({
    onSuccess: (res) => {
      if (res && "ok" in res && !res.ok) toast.error(res.error);
      else toast.success("Won — invoice linked");
      refresh();
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => setBusyId(null),
  });
  const capture = trpc.opportunityQueue.captureStatedConcern.useMutation({
    onSuccess: (res) => {
      if (res && "ok" in res && !res.ok) toast.error(res.error);
      else toast.success("Stated concern recorded — recovery re-routes on next run");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const refreshQueue = trpc.opportunityQueue.refresh.useMutation({
    onSuccess: (r) => { toast.success(`Queue refreshed: ${r.details}`); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const sendOutreach = trpc.opportunityQueue.sendOutreach.useMutation({
    onSuccess: (res) => {
      if (res && "ok" in res && !res.ok) { toast.error(res.error ?? "send failed"); return; }
      toast.success(res.queued ? "Queued — sends at the next window" : "Sent");
      setDraftFor(null); setDraftText(""); setDraftMeta(null);
      refresh();
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => setBusyId(null),
  });

  /** Fetch the deterministic draft for one opportunity and open the editor. */
  const openDraft = async (id: string) => {
    setDraftLoading(true);
    setDraftFor(id);
    setDraftText("");
    setDraftMeta(null);
    try {
      const res = await utils.client.opportunityQueue.draftOutreach.query({ id });
      if (!res.ok || !("draft" in res)) {
        toast.error(("error" in res && res.error) || "draft unavailable");
        setDraftFor(null);
        return;
      }
      if (!res.draft) {
        toast.error(res.noDraftReason ?? "No SMS draft for this type — call instead.");
        setDraftFor(null);
        return;
      }
      setDraftText(res.draft);
      setDraftMeta({ riskLabel: res.riskLabel, riskReasons: res.riskReasons, guardFindings: res.guardFindings });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "draft failed");
      setDraftFor(null);
    } finally {
      setDraftLoading(false);
    }
  };

  /** Two-tap send: confirmDialog shows the EXACT text going out. */
  const confirmSend = async (id: string) => {
    const body = draftText.trim();
    if (!body) return;
    const okay = await confirmDialog({
      title: "Send this text?",
      message: body,
      confirmLabel: "Send SMS",
    });
    if (!okay) return;
    setBusyId(id);
    sendOutreach.mutate({ id, body });
  };

  const act = (id: string, to: string, note?: string) => {
    setBusyId(id);
    transition.mutate({ id, to: to as never, note });
  };

  const actDestructive = async (id: string, to: "lost" | "do_not_contact", label: string) => {
    const okay = await confirmDialog({
      title: `Mark ${label}?`,
      message:
        to === "do_not_contact"
          ? "This permanently stops all recovery contact for this opportunity."
          : "This closes the opportunity as lost. Receipts keep the history.",
      confirmLabel: label,
    });
    if (!okay) return;
    act(id, to);
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border/40 bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading decision inbox…
      </div>
    );
  }

  const decisions = data?.decisions ?? [];

  return (
    <section aria-label="Owner decision inbox" className="rounded-lg border border-border/40 bg-card">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-nick-yellow" />
          <h2 className="text-sm font-bold uppercase tracking-wide">Decision Inbox</h2>
          {/* An unreadable queue reports totalLive: 0, so "top 0 of 0 live" is the
              same false all-clear as the empty state below — a confident number
              standing in for a read that never happened. Em dash instead. */}
          <span className="text-[10px] text-muted-foreground">
            {isError || data?.queryable === false ? (
              "count unknown — queue unreadable"
            ) : (
              <>
                top {decisions.length} of {data?.totalLive ?? 0} live
                {data && data.excludedNoConsent > 0 ? ` · ${data.excludedNoConsent} excluded (no consent)` : ""}
                {data && (data as { excludedSnoozed?: number }).excludedSnoozed ? ` · ${(data as { excludedSnoozed?: number }).excludedSnoozed} snoozed` : ""}
              </>
            )}
          </span>
        </div>
        <button
          onClick={() => refreshQueue.mutate()}
          disabled={refreshQueue.isPending}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border/40"
          aria-label="Re-run queue collectors"
        >
          {refreshQueue.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </header>

      {isError && (
        <div className="px-4 py-3 text-xs text-amber-300">
          Queue unavailable — reads may be UNKNOWN rather than empty.
        </div>
      )}

      {/*
        `isError` is not enough, and this is the gap #1340 opened while closing
        exactly this class elsewhere. `topDecisions()` returns
        `{ decisions: [], queryable: false }` when the database is unreachable
        (opportunityQueue.ts:398) or the query throws (:442) — the tRPC call
        SUCCEEDS carrying that shape, so `isError` stays false, `decisions` is
        empty, and the branch below used to print "Either the queue is clear...".
        An unconsultable queue read as a clear one.

        The flag was added for this and wired only to the cron/LLM consumer
        (morningBrief.ts:235, nour-os-query.ts:117). It travels to this panel on
        the same payload and was being discarded.
      */}
      {!isError && data?.queryable === false && (
        <div role="alert" className="px-4 py-3 text-xs text-amber-300">
          Queue could NOT be read — this is not an empty queue. The decision table
          was unreachable, so anything waiting is invisible right now. Check the
          database, then tap Refresh.
        </div>
      )}

      {!isError && data?.queryable !== false && decisions.length === 0 && (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          No live decisions. Either the queue is clear, or the collectors haven't run since the
          table was applied — tap Refresh to collect now.
        </div>
      )}

      <ul className="divide-y divide-border/30">
        {decisions.map((d, i) => {
          const estimateId =
            d.sourceType === "unapproved_estimate" && d.evidence && typeof d.evidence === "object"
              ? Number((d.evidence as Record<string, unknown>).estimateId ?? d.sourceId)
              : null;
          const busy = busyId === d.id;
          return (
            <li key={d.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="text-xs font-mono text-muted-foreground mt-0.5">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${URGENCY_STYLES[d.urgency] ?? URGENCY_STYLES.later}`}>
                      {d.urgency.replace("_", " ")}
                    </span>
                    <span className="text-sm font-semibold text-foreground">{d.recommendedAction}</span>
                    {d.factors.valueDollars > 0 && (
                      <span className="text-sm font-mono text-nick-yellow">${d.factors.valueDollars.toLocaleString()}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{d.reason}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                    <span className={CALL_ONLY_SOURCES.has(d.sourceType) ? "text-amber-300/90 font-semibold" : "text-sky-300/80"}>
                      {CALL_ONLY_SOURCES.has(d.sourceType) ? "CALL-FIRST" : "call or text"}
                    </span>
                    {" · "}evidence: {d.dataQuality} · attempts: {d.attempts} · state: {d.state}
                    {d.owner ? <> · <span className="text-nick-yellow/80">owner: {d.owner}</span></> : null}
                    {d.customerPhone ? <> · <a className="underline hover:text-foreground" href={`tel:${d.customerPhone}`}>{d.customerPhone}</a></> : null}
                  </p>

                  {/* Action row — each button is a receipt-logged queue write */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {d.customerPhone && (
                      <a
                        href={`tel:${d.customerPhone}`}
                        onClick={() => act(d.id, "attempted", "tapped call in inbox")}
                        className="inline-flex items-center gap-1 text-[11px] font-bold bg-nick-yellow text-black px-2.5 py-1.5 rounded active:scale-95"
                      >
                        <Phone className="w-3 h-3" /> Call
                      </a>
                    )}
                    <button disabled={busy} onClick={() => act(d.id, "contacted")}
                      className="text-[11px] px-2.5 py-1.5 rounded border border-border/40 hover:border-emerald-500/50 text-foreground/80">
                      <CheckCircle2 className="w-3 h-3 inline mr-1" />Spoke
                    </button>
                    <button disabled={busy} onClick={() => act(d.id, "no_response")}
                      className="text-[11px] px-2.5 py-1.5 rounded border border-border/40 text-foreground/60">
                      No answer
                    </button>
                    <span className="inline-flex items-center gap-1">
                      <select
                        value={snoozeChoice[d.id] ?? "2d"}
                        onChange={(e) => setSnoozeChoice((m) => ({ ...m, [d.id]: e.target.value }))}
                        className="text-[11px] px-1.5 py-1.5 rounded border border-border/40 bg-background text-foreground/60"
                        aria-label="Snooze duration"
                      >
                        <option value="2h">2h</option>
                        <option value="1d">1d</option>
                        <option value="2d">2d</option>
                        <option value="7d">1wk</option>
                      </select>
                      <button
                        disabled={busy}
                        onClick={() => {
                          const ms = { "2h": 2 * 3600e3, "1d": 864e5, "2d": 2 * 864e5, "7d": 7 * 864e5 }[snoozeChoice[d.id] ?? "2d"] ?? 2 * 864e5;
                          setBusyId(d.id);
                          snooze.mutate({ id: d.id, untilISO: new Date(Date.now() + ms).toISOString() });
                        }}
                        className="text-[11px] px-2.5 py-1.5 rounded border border-border/40 text-foreground/60">
                        <CalendarClock className="w-3 h-3 inline mr-1" />Snooze
                      </button>
                    </span>
                    {DRAFTABLE_SOURCES.has(d.sourceType) && d.customerPhone && d.consentOk && (
                      <button
                        disabled={busy || (draftLoading && draftFor === d.id)}
                        onClick={() => (draftFor === d.id ? setDraftFor(null) : openDraft(d.id))}
                        className="text-[11px] px-2.5 py-1.5 rounded border border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
                      >
                        {draftLoading && draftFor === d.id
                          ? <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
                          : <MessageSquare className="w-3 h-3 inline mr-1" />}
                        Draft text
                      </button>
                    )}
                    <button disabled={busy} onClick={() => actDestructive(d.id, "lost", "Lost")}
                      className="text-[11px] px-2.5 py-1.5 rounded border border-border/40 text-red-400/80 hover:border-red-500/50">
                      <XCircle className="w-3 h-3 inline mr-1" />Lost
                    </button>
                    <button disabled={busy} onClick={() => actDestructive(d.id, "do_not_contact", "Do not contact")}
                      className="text-[11px] px-2.5 py-1.5 rounded border border-border/40 text-red-400/80 hover:border-red-500/50">
                      <AlertTriangle className="w-3 h-3 inline mr-1" />DNC
                    </button>
                    {/* Verified outcome — the only door to `won` */}
                    <span className="inline-flex items-center gap-1">
                      <input
                        inputMode="numeric"
                        placeholder="Invoice #"
                        value={invoiceInputs[d.id] ?? ""}
                        onChange={(e) => setInvoiceInputs((m) => ({ ...m, [d.id]: e.target.value }))}
                        className="w-20 text-[11px] px-2 py-1.5 rounded border border-border/40 bg-background"
                        aria-label="Invoice number for verified outcome"
                      />
                      <button
                        disabled={busy || !/^\d+$/.test(invoiceInputs[d.id] ?? "")}
                        onClick={() => { setBusyId(d.id); outcome.mutate({ id: d.id, invoiceId: Number(invoiceInputs[d.id]), allowManualMatch: manualMatch[d.id] === true }); }}
                        className="text-[11px] px-2.5 py-1.5 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 disabled:opacity-40">
                        Won
                      </button>
                      {/* Wave 6: explicit operator judgment for invoices the matcher
                          can't verify (mismatched phone). Recorded as `manual`,
                          never as independently verified — backend semantics. */}
                      <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 select-none">
                        <input
                          type="checkbox"
                          checked={manualMatch[d.id] === true}
                          onChange={(e) => setManualMatch((m) => ({ ...m, [d.id]: e.target.checked }))}
                          className="w-3.5 h-3.5 accent-emerald-500"
                          aria-label="Allow manual invoice match"
                        />
                        manual
                      </label>
                    </span>
                  </div>

                  {/* Draft editor — deterministic template, operator edits, two-tap send.
                      Nothing sends without the confirm showing the exact text. */}
                  {draftFor === d.id && !draftLoading && draftText && (
                    <div className="mt-2 rounded border border-sky-500/30 bg-sky-500/5 p-2">
                      {draftMeta && draftMeta.riskLabel !== "low" && (
                        <p className="text-[10px] text-amber-300 mb-1">
                          risk: {draftMeta.riskLabel}
                          {draftMeta.riskReasons.length > 0 ? ` — ${draftMeta.riskReasons.join("; ")}` : ""}
                        </p>
                      )}
                      {draftMeta && draftMeta.guardFindings.length > 0 && (
                        <p className="text-[10px] text-amber-300 mb-1">
                          guard: {draftMeta.guardFindings.map((g) => g.code).join(", ")}
                        </p>
                      )}
                      <textarea
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        rows={3}
                        maxLength={480}
                        className="w-full text-xs p-2 rounded border border-border/40 bg-background resize-y"
                        aria-label="Editable SMS draft"
                      />
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-muted-foreground">{draftText.trim().length}/480 · sends from the shop line, all gates apply</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => { setDraftFor(null); setDraftText(""); setDraftMeta(null); }}
                            className="text-[11px] px-2.5 py-1.5 rounded border border-border/40 text-foreground/60"
                          >
                            Discard
                          </button>
                          <button
                            disabled={busy || !draftText.trim() || sendOutreach.isPending}
                            onClick={() => confirmSend(d.id)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded bg-sky-600/30 border border-sky-500/50 text-sky-200 disabled:opacity-40 active:scale-95"
                          >
                            {sendOutreach.isPending && busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            Send…
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Recovery 2.0 · stated-concern capture (estimates only) */}
                  {estimateId !== null && Number.isFinite(estimateId) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-muted-foreground/70 mr-1">They said:</span>
                      {CONCERN_CHIPS.map((c) => (
                        <button
                          key={c.value}
                          onClick={() => capture.mutate({ estimateId, concern: c.value as never })}
                          className={`text-[10px] px-2 py-1 rounded-full border ${
                            c.closes
                              ? "border-red-500/30 text-red-300/80 hover:bg-red-500/10"
                              : "border-border/40 text-foreground/70 hover:border-nick-yellow/50"
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
