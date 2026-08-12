import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ClipboardList, ExternalLink } from "lucide-react";
import { VAPI_LINKS, fmtPhone, fmtDuration, prettyReason } from "./format";

// ─── Drawer ─────────────────────────────────────────────────
export function CallDetailsDrawer({ callId, onClose }: { callId: string; onClose: () => void }) {
  const { data: details, isLoading } = trpc.vapi.callDetails.useQuery(
    { callId },
    { staleTime: 5 * 60_000 },
  );
  const utils = trpc.useUtils();

  // Phase 7 contextual action: creates a DRAFT in the approval queue — no
  // callback row exists until a human approves it there (trust ladder).
  const proposeCallback = trpc.proposals.create.useMutation({
    onSuccess: (r) => {
      if (r.created) toast.success("Draft created — review it in Approvals");
      else if ("deduped" in r && r.deduped) toast.message("Already drafted", { description: "A proposal for this call is in the queue." });
      else toast.error("Could not draft: " + ("error" in r ? r.error : "unknown"));
      void utils.proposals.list.invalidate();
      void utils.proposals.counts.invalidate();
    },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  // wave-181.x Voice Phase 1 · M3 fix · code-review agent caught
  // missing Escape-key close. role="dialog" aria-modal="true" without
  // an Escape listener is an a11y regression · also a real UX bug
  // (operator scanning transcripts on desktop couldn't dismiss with
  // Esc · drawer-state leaked across calls when they navigated back).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[62] flex"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/60" />
      {/* wave-181.x Voice mobile polish · was `ml-auto + max-w-2xl`
       * which on iPhone PWA left a ~100px backdrop sliver at the
       * left edge that was still clickable (closes the drawer when
       * the operator reaches for the audio scrubber mid-read).
       * Mobile gets full width (no left sliver) · tablet+ keeps the
       * right-side drawer via `sm:max-w-2xl + sm:ml-auto` clamp.
       * The parent flex puts the drawer at the right by default on
       * desktop · `w-full` on mobile fills the flex item naturally. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full sm:max-w-2xl sm:ml-auto bg-background border-l border-border/40 overflow-y-auto"
      >
        <div className="sticky top-0 bg-background/90 backdrop-blur-md border-b border-border/30 p-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold tracking-wide">Call detail</h3>
            <p className="text-[11px] text-foreground/50 font-mono">{callId.slice(0, 16)}…</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={VAPI_LINKS.callDetail(callId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.15em] uppercase text-foreground/60 hover:text-primary border border-border/40 hover:border-primary/40 rounded px-2 py-1 transition-colors"
              title="Open this call in the VAPI dashboard (recordings, raw events, etc.)"
            >
              Open in VAPI <ExternalLink className="w-3 h-3" />
            </a>
            <button
              onClick={onClose}
              className="text-foreground/50 hover:text-foreground text-xl leading-none px-2"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {isLoading || !details ? (
            <div className="space-y-2">
              <div className="h-4 w-32 bg-foreground/10 animate-pulse rounded" />
              <div className="h-3 w-full bg-foreground/8 animate-pulse rounded" />
              <div className="h-3 w-3/4 bg-foreground/8 animate-pulse rounded" />
              <div className="h-3 w-5/6 bg-foreground/8 animate-pulse rounded" />
            </div>
          ) : (
            <>
              {/* Wave-90 — TRANSCRIPT FIRST. Operator wants to read what was
                  actually said as the primary content; metadata grid is below. */}

              {/* Compact one-line strip: caller · time · duration · end reason */}
              <div className="flex items-center gap-2 text-[12px] flex-wrap pb-3 border-b border-border/20">
                <span className="font-bold text-foreground">
                  {details.customerName || fmtPhone(details.customerNumber)}
                </span>
                <span className="text-foreground/30">·</span>
                <span className="font-mono tabular-nums text-foreground/70">
                  {fmtDuration(details.durationSeconds)}
                </span>
                <span className="text-foreground/30">·</span>
                <span className={prettyReason(details.endedReason).color + " font-medium"}>
                  {prettyReason(details.endedReason).label}
                </span>
                <span className="text-foreground/30">·</span>
                <span className="font-mono tabular-nums text-foreground/50 text-[11px]">
                  {details.createdAt ? new Date(details.createdAt).toLocaleString() : "—"}
                </span>
                {details.customerNumber && (
                  <button
                    onClick={() =>
                      proposeCallback.mutate({
                        actionType: "create_callback",
                        title: `Callback: ${details.customerName || fmtPhone(details.customerNumber)} — flagged from call review`,
                        payload: {
                          name: details.customerName || "Caller",
                          phone: details.customerNumber,
                          reason: `Operator flagged VAPI call ${callId.slice(0, 12)} for a callback`,
                          sourcePage: "admin-voice",
                        },
                        entityType: "vapi_call",
                        entityId: callId.slice(0, 64),
                        context: { vapiCallId: callId },
                      })
                    }
                    disabled={proposeCallback.isPending}
                    title="Creates a DRAFT in the approval queue — nothing happens until it is approved there"
                    className="ml-auto inline-flex items-center gap-1.5 min-h-[44px] border border-violet-500/40 text-violet-500 px-3 py-2 font-bold text-[11px] tracking-wide uppercase hover:bg-violet-500/10 disabled:opacity-50 rounded"
                  >
                    <ClipboardList className="w-3.5 h-3.5" /> Flag callback
                  </button>
                )}
              </div>

              {/* Recording — keeps prime real estate so you can listen while reading */}
              {details.recordingUrl && (
                <div className="rounded border border-border/30 bg-card/40 p-2 flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.15em] text-foreground/45 shrink-0">
                    Recording
                  </span>
                  <audio controls src={details.recordingUrl} className="flex-1 h-8" />
                </div>
              )}

              {/* TRANSCRIPT — primary content. Only conversation turns
                  (caller + Nick); system prompts + tool/function messages
                  filtered out (they dominate otherwise — the system prompt
                  is the entire AI identity ~2KB of text). For raw
                  message stream incl. system + tool, use "Open in VAPI". */}
              {(() => {
                const conversation = details.messages.filter(
                  (m) => m.role === "user" || m.role === "bot" || m.role === "assistant",
                );
                if (conversation.length === 0 && !details.transcript) {
                  return (
                    <div className="text-center py-8 text-[12px] text-foreground/40">
                      No conversation captured for this call.
                      {details.messages.length > 0 && (
                        <div className="mt-1 text-[11px]">
                          ({details.messages.length} system/tool message{details.messages.length === 1 ? "" : "s"} hidden — open in VAPI for raw stream)
                        </div>
                      )}
                    </div>
                  );
                }
                if (conversation.length === 0 && details.transcript) {
                  return (
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.15em] font-medium text-foreground/60 mb-2">
                        Transcript
                      </div>
                      <pre className="text-[13px] leading-relaxed whitespace-pre-wrap font-sans bg-card/40 border border-border/30 rounded p-3">
                        {details.transcript}
                      </pre>
                    </div>
                  );
                }
                return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] uppercase tracking-[0.15em] font-medium text-foreground/60">
                        Transcript ({conversation.length} {conversation.length === 1 ? "turn" : "turns"})
                      </span>
                      <span className="text-[10px] text-foreground/30">
                        <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1 align-middle" />
                        Caller
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 ml-3 mr-1 align-middle" />
                        Nick
                      </span>
                    </div>
                    <div className="space-y-2">
                      {conversation.map((msg, i) => {
                        const isUser = msg.role === "user";
                        return (
                          <div
                            key={i}
                            className={`text-[13px] leading-relaxed rounded p-2.5 ${
                              isUser
                                ? "bg-blue-500/10 border-l-2 border-blue-500/50"
                                : "bg-emerald-500/10 border-l-2 border-emerald-500/50"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[10px] uppercase tracking-[0.12em] font-medium text-foreground/50">
                                {isUser ? "Caller" : "Nick"}
                              </span>
                              {msg.secondsFromStart !== null && (
                                <span className="text-[9px] font-mono text-foreground/30">
                                  {Math.round(msg.secondsFromStart || 0)}s
                                </span>
                              )}
                            </div>
                            {msg.message && <div className="text-foreground/90">{msg.message}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Below-transcript: secondary detail (collapsed by default) */}
              <details className="rounded border border-border/30 bg-card/30">
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium uppercase tracking-[0.15em] text-foreground/60 hover:text-foreground select-none">
                  Call detail + tool calls{details.toolCalls.length > 0 ? ` (${details.toolCalls.length})` : ""}
                </summary>
                <div className="px-3 py-3 border-t border-border/20 space-y-3">
                  {/* Metadata grid */}
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {details.cost !== null && (
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.15em] text-foreground/45">Cost</dt>
                        <dd className="font-mono tabular-nums">${details.cost.toFixed(3)}</dd>
                      </div>
                    )}
                    {details.successEvaluation && (
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.15em] text-foreground/45">VAPI Success Eval</dt>
                        <dd className="text-[12px]">{details.successEvaluation}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.15em] text-foreground/45">Call ID</dt>
                      <dd className="font-mono text-[11px] text-foreground/70 break-all">{details.id}</dd>
                    </div>
                  </dl>

                  {/* Summary (AI-generated) */}
                  {details.summary && (
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.15em] text-foreground/45 mb-1">AI Summary</div>
                      <div className="text-[12px] leading-relaxed text-foreground/80">{details.summary}</div>
                    </div>
                  )}

                  {/* Tool calls */}
                  {details.toolCalls.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-primary/80 mb-2">
                        Tool calls
                      </div>
                      <ul className="space-y-1.5">
                        {details.toolCalls.map((tc, i) => (
                          <li key={i} className="text-[12px]">
                            <span className="font-mono font-bold text-primary">{tc.name}</span>
                            {tc.time !== undefined && (
                              <span className="text-foreground/40 ml-2">@{Math.round(tc.time)}s</span>
                            )}
                            <pre className="mt-0.5 text-[11px] text-foreground/60 font-mono whitespace-pre-wrap break-all bg-background/40 rounded p-1.5">
                              {tc.args}
                            </pre>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
