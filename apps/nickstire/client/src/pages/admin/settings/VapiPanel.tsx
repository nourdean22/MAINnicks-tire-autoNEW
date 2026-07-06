// ─── VAPI VOICE RECEPTIONIST PANEL ────────────────────────
// Connection status · one-click assistant create · recent-call log.
// The Vapi assistant answers when no human picks up — books slots,
// quotes ranges, escalates, sends recap SMS. ROI estimate ~360x.

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
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
  // Lessons the receptionist prompt will absorb on the next "Push Latest Config".
  const { data: promptLessons } = trpc.vapi.promptLessons.useQuery(undefined, {
    staleTime: 60_000,
    enabled: status?.connected ?? false,
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
      if (result.success) {
        toast.success("Assistant updated · prompt + tools + settings re-pushed");
        utils.vapi.status.invalidate();
      } else {
        toast.error("Update failed: " + (result.error || "unknown"));
      }
    },
    onError: (err: { message: string }) => toast.error("Update failed: " + err.message),
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
          </div>
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
            Push Latest Config = re-deploys the optimal Vapi assistant settings (Deepgram nova-2-phonecall, GPT-4o, ElevenLabs Adam turbo, smart endpointing, voicemail detection, structured-data analysis, tire-first prompt).
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

      {connected && callsData?.calls && callsData.calls.length === 0 && (
        <p className="text-[11px] text-foreground/40 italic">
          No calls yet. The assistant goes live when Twilio is configured to forward unanswered calls to Vapi (one-time Twilio dashboard setup — ask vendor for SIP URL).
        </p>
      )}
    </div>
  );
}
