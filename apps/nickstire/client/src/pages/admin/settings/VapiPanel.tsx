// ─── VAPI VOICE RECEPTIONIST PANEL ────────────────────────
// Connection status · one-click assistant create · recent-call log.
// The Vapi assistant answers when no human picks up — books slots,
// quotes ranges, escalates, sends recap SMS. ROI estimate ~360x.

import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { Loader2, RefreshCw, Zap } from "lucide-react";

interface VapiCallRow {
  id: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  customerNumber?: string;
  endedReason?: string;
  cost?: number;
  summary?: string;
  structuredData?: Record<string, unknown>;
  successEvaluation?: string;
}

export default function VapiPanel() {
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.vapi.status.useQuery(undefined, { staleTime: 60_000 });
  const { data: callsData } = trpc.vapi.recentCalls.useQuery({ limit: 10 }, {
    staleTime: 60_000,
    enabled: status?.connected ?? false,
  });
  // Whether the line callers dial answers with the assistant "Push Latest
  // Config" writes to. Read-only; three states, and an unread binding is
  // "unverified" rather than a green.
  const { data: routing } = trpc.vapi.assistantRouting.useQuery(undefined, { staleTime: 60_000 });
  // Lessons the receptionist prompt will absorb on the next "Push Latest Config".
  const { data: promptLessons } = trpc.vapi.promptLessons.useQuery(undefined, {
    staleTime: 60_000,
    enabled: status?.connected ?? false,
  });
  // The receptionist prompt experiment (propose-only). Polls while a run is
  // active on the server; a finished run shows its row summary here, lands in
  // Telegram and on /proof, and never changes what callers hear.
  const { data: evolution, isLoading: evolutionLoading, isError: evolutionError, error: evolutionErr } = trpc.vapi.promptEvolutionStatus.useQuery(undefined, {
    enabled: status?.connected ?? false,
    refetchInterval: (q) => (q.state.data?.active ? 30_000 : false),
  });
  const runEvolution = trpc.vapi.runPromptEvolutionNow.useMutation({
    onSuccess: (r) => {
      if (r.status === "started") toast.success("Experiment started · result in up to 45 min (Telegram, /proof, and here)");
      else if (r.status === "running") toast.message(`Already running · started ${Math.round(r.elapsedMs / 60000)} min ago`);
      else toast.error(`Not started: ${r.reason}`);
      utils.vapi.promptEvolutionStatus.invalidate();
    },
    onError: (err: { message: string }) => toast.error("Start failed: " + err.message),
  });
  const createAssistant = trpc.vapi.createAssistant.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Assistant created · ID ${result.assistantId?.slice(0, 12)}…`);
        utils.vapi.status.invalidate();
      } else {
        toast.error("Create failed: " + (result.error || "unknown"));
      }
    },
    onError: (err: { message: string }) => toast.error("Create failed: " + err.message),
  });
  const updateAssistant = trpc.vapi.updateAssistant.useMutation({
    onSuccess: (result) => {
      if (result.success && result.verified) {
        toast.success(`Assistant updated + Vapi read-back verified · ${result.behaviorHash?.slice(0, 10) ?? "hash"}…`);
        utils.vapi.status.invalidate();
      } else if (result.success) {
        toast.warning(result.warning || "Assistant update accepted, but provider read-back is unverified.");
        utils.vapi.status.invalidate();
      } else {
        toast.error("Update failed: " + (result.error || "unknown"));
      }
    },
    onError: (err: { message: string }) => toast.error("Update failed: " + err.message),
  });
  // The outbound follow-up caller is a separate Vapi assistant; its prompt only
  // changes when this pushes it (it used to need a terminal script).
  const updateFollowUp = trpc.vapi.updateFollowUpAssistant.useMutation({
    onSuccess: (result) => {
      if (result.success) toast.success("Follow-up assistant updated · prompt + tools re-pushed");
      else toast.error("Follow-up update failed: " + (result.error || "unknown"));
    },
    onError: (err: { message: string }) => toast.error("Follow-up update failed: " + err.message),
  });

  const connected = status?.connected ?? false;
  const firstAssistantId = status?.assistants?.[0]?.id;

  return (
    <div className={`bg-card border ${connected ? "border-emerald-500/30" : "border-amber-500/30"} p-4 space-y-4`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-foreground tracking-wide">
            VAPI VOICE RECEPTIONIST · {isLoading ? "…" : connected ? "CONNECTED" : "OFFLINE"}
          </h3>
          <p className="text-foreground/50 text-[11px] mt-0.5 max-w-2xl">
            AI answers when no human picks up. Books slots, quotes ranges, escalates frustrated callers, sends recap SMS. Industry data: 27% of inbound auto-shop calls go unanswered during open hours; 68% after hours. Recovery target: ~$6-15k/mo at this shop's volume.
          </p>
        </div>
        <span className={`px-2.5 py-1 text-[10px] font-medium tracking-[0.12em] rounded ${connected ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
          {connected
            ? `${status?.assistantCount ?? 0} ASSISTANT${(status?.assistantCount ?? 0) === 1 ? "" : "S"}`
            : status?.errorKind === "outage"
              ? "VAPI VENDOR OUTAGE"
              : status?.errorKind === "auth"
                ? "API KEY MISSING OR INVALID"
                : "VAPI UNREACHABLE"}
        </span>
      </div>

      {/* Status states */}
      {!connected && (
        <div className="border border-amber-500/30 bg-amber-500/[0.05] p-3 text-[11px] text-foreground/70 leading-relaxed">
          {status?.errorKind === "outage" ? (
            <>
              <span className="text-amber-400 font-semibold">VAPI vendor outage.</span> Their API
              is unreachable — this is on VAPI&apos;s side, not your key or config. The receptionist
              reconnects automatically once VAPI recovers; check{" "}
              <span className="font-mono">status.vapi.ai</span>.
              {status.error && <> <span className="font-mono text-foreground/40">({status.error})</span></>}
            </>
          ) : status?.error ? (
            <>Vapi error: <span className="font-mono text-amber-400">{status.error}</span></>
          ) : (
            <>Set <span className="font-mono">VAPI_API_KEY</span> in the Railway env to connect.</>
          )}
        </div>
      )}

      {connected && (status?.assistantCount ?? 0) === 0 && (
        <div className="border border-blue-500/30 bg-blue-500/[0.05] p-3 space-y-2">
          <p className="text-[12px] text-foreground/80">
            Connected but no assistant configured yet. Click below to create the production receptionist with the canonical voice + tools wired to <span className="font-mono">/api/webhooks/vapi</span>.
          </p>
          <button
            onClick={() => createAssistant.mutate({ serverUrl: "https://nickstire.org/api/webhooks/vapi" })}
            disabled={createAssistant.isPending}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 disabled:opacity-50"
          >
            {createAssistant.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            CREATE ASSISTANT
          </button>
        </div>
      )}

      {/* Assistants + Update button */}
      {status?.assistants && status.assistants.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-foreground/50">Configured Assistants</p>
            <div className="flex items-center gap-2 flex-wrap justify-end">
            {firstAssistantId && (
              <button
                onClick={() => updateAssistant.mutate({ serverUrl: "https://nickstire.org/api/webhooks/vapi" })}
                disabled={updateAssistant.isPending}
                className="flex items-center gap-1.5 border border-primary/30 text-primary bg-primary/5 px-3 py-1 text-[10px] font-bold tracking-wide hover:bg-primary/10 disabled:opacity-50"
              >
                {updateAssistant.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {updateAssistant.isPending ? "PUSHING..." : "PUSH LATEST CONFIG"}
              </button>
            )}
            {firstAssistantId && (
              <button
                // Overwrites the prompt of the assistant that places real outbound
                // calls, one slot from the receptionist push: two taps, in-DOM
                // confirm (window.confirm is suppressed in iOS PWA standalone).
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: "Push the follow-up caller's config?",
                    message: "Overwrites the prompt and tools of the assistant that places outbound follow-up calls. The receptionist is not touched.",
                    confirmLabel: "Push follow-up config",
                  });
                  if (ok) updateFollowUp.mutate({ serverUrl: "https://nickstire.org/api/webhooks/vapi" });
                }}
                disabled={updateFollowUp.isPending}
                className="flex items-center gap-1.5 min-h-[48px] border border-primary/30 text-primary bg-primary/5 px-3 py-1 text-[10px] font-bold tracking-wide hover:bg-primary/10 disabled:opacity-50"
              >
                {updateFollowUp.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {updateFollowUp.isPending ? "PUSHING..." : "PUSH FOLLOW-UP ASSISTANT"}
              </button>
            )}
            </div>
          </div>
          {/* DOES THE PUSH REACH THE LINE CALLERS DIAL?
              Rendered directly under the button because it is the only thing
              that makes the button's success meaningful. Three states, never
              two: an unread binding says "unverified", never "match" — the
              whole point is that a confident green here is earned. */}
          {routing && (
            <div
              className={
                routing.state === "mismatch"
                  ? "border border-red-400/40 bg-red-500/5 p-2.5"
                  : routing.state === "match"
                    ? "border border-emerald-400/25 bg-emerald-500/[0.04] p-2.5"
                    : "border border-border/30 bg-background/30 p-2.5"
              }
            >
              <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-foreground/60 mb-1">
                {routing.state === "mismatch"
                  ? "Pushes are not reaching the answering assistant"
                  : routing.state === "match"
                    ? "Push target answers the inbound line"
                    : "Routing unverified"}
              </p>
              <p className="text-[11px] text-foreground/60">{routing.detail}</p>
              {/* The OUTBOUND rail, reported beside the inbound one because
                  "is my config wired correctly" means both. Retired is red: it
                  means the follow-up rail is skipping rather than dialling. */}
              {routing.followUp && (
                <p
                  className={
                    routing.followUp.state === "retired"
                      ? "mt-1.5 text-[11px] text-red-300"
                      : "mt-1.5 text-[11px] text-foreground/45"
                  }
                >
                  {routing.followUp.detail}
                </p>
              )}
            </div>
          )}
          {promptLessons && promptLessons.length > 0 && (
            <div className="border border-primary/20 bg-primary/[0.04] p-2.5">
              <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-primary/80 mb-1">
                Learned lessons appended on next push ({promptLessons.length})
              </p>
              <ul className="space-y-1">
                {promptLessons.map((l: { content: string; confidence: number; uses: number }, i: number) => (
                  <li key={i} className="text-[11px] text-foreground/70 leading-snug">
                    · {l.content}{" "}
                    <span className="text-foreground/40 font-mono">({Math.round(l.confidence * 100)}%, {l.uses}x)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {status.assistants.map((a: { id: string; name: string; createdAt: string }) => (
            <div key={a.id} className="flex items-center justify-between gap-3 text-[11px] py-1.5 border-b border-border/10">
              <span className="text-foreground font-medium truncate">{a.name}</span>
              <span className="font-mono text-foreground/40 shrink-0">{a.id.slice(0, 12)}…</span>
              <span className="text-foreground/40 shrink-0">{new Date(a.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
          <p className="text-[10px] text-foreground/40 italic mt-1">
            Push Latest Config = re-deploys the optimal Vapi assistant settings (Deepgram nova-2-phonecall, GPT-4o, ElevenLabs Adam turbo, smart endpointing, voicemail detection, structured-data analysis, neutral-first intent prompt with strong tire handling).
          </p>
        </div>
      )}

      {/* Recent calls — enriched with structured data + success eval */}
      {connected && callsData?.calls && callsData.calls.length > 0 && (
        <details className="border-t border-border/10 pt-3" open>
          <summary className="cursor-pointer text-[11px] font-medium tracking-[0.15em] text-foreground/50 hover:text-foreground/80">
            RECENT CALLS · LAST {callsData.calls.length}
          </summary>
          <div className="mt-2 space-y-3">
            {(callsData.calls as VapiCallRow[]).map((c) => {
              const date = c.startedAt ? new Date(c.startedAt) : null;
              const day = date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
              const time = date ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";
              const dur = c.durationSeconds ? `${Math.round(c.durationSeconds)}s` : "—";
              const cost = c.cost ? `$${c.cost.toFixed(2)}` : "—";
              const sd = c.structuredData ?? {};
              const callType = sd.callType as string | undefined;
              const outcome = sd.outcome as string | undefined;
              const sentiment = sd.sentiment as string | undefined;
              const followUpNeeded = sd.followUpNeeded as boolean | undefined;
              const tireSize = sd.tireSize as string | undefined;
              const vehicle = sd.vehicle as string | undefined;

              const successColor =
                c.successEvaluation === "PASS" ? "bg-emerald-500/15 text-emerald-400" :
                c.successEvaluation === "FAIL" ? "bg-red-500/15 text-red-400" :
                "bg-foreground/10 text-foreground/40";
              const sentimentColor =
                sentiment === "positive" ? "text-emerald-400" :
                sentiment === "negative" ? "text-red-400" :
                "text-foreground/50";
              const callTypeColor =
                callType === "tire_inquiry" ? "bg-primary/15 text-primary" :
                callType === "booking" ? "bg-emerald-500/15 text-emerald-400" :
                callType === "complaint" ? "bg-red-500/15 text-red-400" :
                "bg-blue-500/15 text-blue-400";

              return (
                <div key={c.id} className="border border-border/20 p-3 space-y-2">
                  {/* Header row */}
                  <div className="flex items-center gap-3 flex-wrap text-[11px]">
                    <span className="text-foreground/40 shrink-0">{day} {time}</span>
                    <span className="font-mono text-foreground shrink-0">{c.customerNumber || "Unknown"}</span>
                    <span className="text-foreground/50 shrink-0">{dur}</span>
                    <span className="text-emerald-400/60 shrink-0">{cost}</span>
                    {callType && (
                      <span className={`px-2 py-0.5 rounded font-medium tracking-[0.12em] text-[10px] ${callTypeColor}`}>
                        {callType.replace("_", " ").toUpperCase()}
                      </span>
                    )}
                    {c.successEvaluation && (
                      <span className={`px-2 py-0.5 rounded font-medium tracking-[0.12em] text-[10px] ${successColor}`}>
                        {c.successEvaluation}
                      </span>
                    )}
                    {followUpNeeded && (
                      <span className="px-2 py-0.5 rounded font-medium tracking-[0.12em] text-[10px] bg-amber-500/15 text-amber-400">
                        FOLLOW UP
                      </span>
                    )}
                  </div>
                  {/* Summary */}
                  {c.summary && (
                    <p className="text-[12px] text-foreground/70 leading-relaxed">{c.summary}</p>
                  )}
                  {/* Structured data badges */}
                  {(tireSize || vehicle || outcome || sentiment) && (
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      {tireSize && (
                        <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">
                          {tireSize}
                        </span>
                      )}
                      {vehicle && (
                        <span className="px-2 py-0.5 rounded bg-foreground/5 text-foreground/60">
                          {vehicle}
                        </span>
                      )}
                      {outcome && (
                        <span className="px-2 py-0.5 rounded bg-foreground/5 text-foreground/60">
                          → {outcome.replace("_", " ")}
                        </span>
                      )}
                      {sentiment && (
                        <span className={`px-2 py-0.5 rounded bg-foreground/5 ${sentimentColor}`}>
                          {sentiment}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* RECEPTIONIST PROMPT EXPERIMENT · propose-only, on demand. Three
          states, never two: an unreadable latest row says "unknown", never
          "no runs yet". */}
      {connected && (
        <div data-testid="prompt-evolution" className="border border-border/40 bg-background/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-foreground/50">Prompt experiment</p>
              <p className="text-[11px] text-foreground/60">
                {evolution?.active
                  ? `Running for ${Math.round(evolution.active.elapsedMs / 60000)} min of a ${Math.round(evolution.active.budgetMs / 60000)}-minute budget. This panel refreshes every 30s.`
                  : evolution?.last
                    ? `Idle · last run ${evolution.last.status} in ${Math.round(evolution.last.durationMs / 60000)} min`
                    : "Idle · runs every Monday, or now"}
              </p>
            </div>
            <button
              onClick={async () => {
                const ok = await confirmDialog({
                  title: "Run the receptionist prompt experiment now?",
                  message: "Offline replay of real failed calls against the live prompt, up to 45 minutes. Proposes at most one candidate; nothing callers hear changes. Spends this week's sealed confirmation seeds. Result lands in Telegram, on /proof and here.",
                  confirmLabel: "Run experiment",
                });
                if (ok) runEvolution.mutate();
              }}
              disabled={runEvolution.isPending || !!evolution?.active}
              className="flex items-center gap-1.5 min-h-[48px] border border-primary/30 text-primary bg-primary/5 px-3 py-1 text-[10px] font-bold tracking-wide hover:bg-primary/10 disabled:opacity-50"
            >
              {(runEvolution.isPending || evolution?.active) && <Loader2 className="w-3 h-3 animate-spin" />}
              {evolution?.active ? "RUNNING..." : "RUN EXPERIMENT NOW"}
            </button>
          </div>
          {evolutionLoading ? (
            <p className="text-[11px] text-foreground/60">Loading experiment status.</p>
          ) : evolutionError ? (
            <p className="text-[11px] text-foreground/60">Experiment status unavailable: {evolutionErr?.message ?? "the request failed"}. Unknown, not empty.</p>
          ) : evolution?.latest.state === "unavailable" ? (
            <p className="text-[11px] text-foreground/60">Latest result unknown: the row could not be read ({evolution.latest.reason}). Unknown, not empty.</p>
          ) : evolution?.latest.state === "ok" && evolution.latest.latest ? (
            <PromptExperimentResult r={evolution.latest.latest} />
          ) : evolution?.latest.state === "ok" ? (
            <p className="text-[11px] text-foreground/60">No experiment recorded yet. The weekly run is Monday; the button runs it today.</p>
          ) : null}
        </div>
      )}

      {connected && callsData?.calls && callsData.calls.length === 0 && (
        <p className="text-[11px] text-foreground/40 italic">
          No calls yet. The assistant goes live when Twilio is configured to forward unanswered calls to Vapi (one-time Twilio dashboard setup — ask vendor for SIP URL).
        </p>
      )}
    </div>
  );
}

/** The latest experiment, in plain words: verdict, gates, candidates, one footer. Hashes stay muted. */
type ExperimentSummary = NonNullable<Extract<RouterOutputs["vapi"]["promptEvolutionStatus"]["latest"], { state: "ok" }>["latest"]>;

const VERDICT: Record<string, string> = {
  "accepted": "Proposal saved: a candidate passed every gate.",
  "accepted-unconfirmed": "Proposal saved, unconfirmed: a candidate passed the gates but the sealed set could not confirm it.",
  "rejected-train": "No proposal: no candidate beat the live prompt on the training calls.",
  "rejected-holdout": "No proposal: a candidate looked better but was not significant on the holdout calls.",
  "rejected-regression": "No proposal: the candidate broke a call the live prompt handles every time.",
  "rejected-underpowered": "No proposal: too few comparable holdout calls to decide.",
  "rejected-success-regression": "No proposal: the candidate hurt calls the live prompt wins.",
  "rejected-success-violation": "No proposal: the candidate added a compliance violation on a won call.",
  "rejected-success-degraded": "No proposal: the candidate degraded calls the live prompt wins.",
  "rejected-success-underpowered": "No proposal: too few won calls to clear the safety check.",
  "rejected-confirmation": "No proposal: the sealed confirmation set did not agree.",
  "invalid-evaluator": "Measured nothing: the judge lane was unavailable.",
  "inconclusive-budget": "Stopped at the time budget before deciding.",
  "no-candidates": "No proposal: the optimizer produced no usable edit.",
  "baseline-clean": "Nothing to fix: the live prompt passed every training call.",
};

function PromptExperimentResult({ r }: { r: ExperimentSummary }) {
  const when = r.ranAt ? new Date(r.ranAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "date unknown";
  const h = r.holdoutStats;
  const holdout = r.gates.holdout
    ? `${h?.improved ?? "?"} better, ${h?.worsened ?? "?"} worse, ${h?.tied ?? "?"} tied${h?.pValue !== null && h?.pValue !== undefined ? `, p=${h.pValue.toFixed(3)}` : ""} (${r.gates.holdout})`
    : "not run";
  const chip = "rounded bg-foreground/5 px-2 py-0.5";
  return (
    <div className="text-[11px] text-foreground/70 space-y-1.5">
      <p>
        <span className="text-foreground/50">{when} · {r.trigger === "manual" ? "manual" : r.trigger === "scheduled" ? "scheduled" : "older run"} · </span>
        {VERDICT[r.outcome ?? ""] ?? r.outcome ?? "unknown"}
      </p>
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span className={chip}>Train {r.seeds.train ?? "?"} · Holdout {r.seeds.holdout ?? "?"} · Sealed {r.seeds.confirm ?? "?"}</span>
        <span className={chip}>Holdout gate: {holdout}</span>
        <span className={chip}>Success cohort {r.gates.success ? `${r.seeds.success ?? "?"} won calls (${r.gates.success})` : "not run"}</span>
        <span className={chip}>Confirmation {r.gates.confirmation ?? "not run"}</span>
      </div>
      {r.candidates.length > 0 && (
        <ul data-testid="prompt-evolution-candidates" className="space-y-0.5">
          {r.candidates.map((c, i) => (
            <li key={c.promptHash ?? i}>
              <span className="font-mono text-foreground/50">{c.promptHash?.slice(0, 8) ?? "?"}</span>{" "}
              {c.rejectedInvariants.length > 0
                ? `not replayed, broke ${c.rejectedInvariants.join(", ")}`
                : `train ${c.train ?? "?"}${c.trainMargin !== null ? ` (margin ${c.trainMargin > 0 ? "+" : ""}${c.trainMargin}${c.trainUsable === false ? ", unusable" : ""})` : ""}`}
            </li>
          ))}
        </ul>
      )}
      <p className="text-foreground/50">
        Live prompt <span className="font-mono">{r.baselinePromptHash?.slice(0, 8) ?? "?"}</span> unchanged
        {r.experimentId ? <> · receipt <span className="font-mono">{r.experimentId.replace("prompt-evolution:", "").slice(0, 8)}</span>{r.receiptDelivered === false ? " (not delivered)" : ""}</> : " · no receipt"}
        {" "}· applying a candidate is edit + Push Latest Config.
      </p>
    </div>
  );
}
