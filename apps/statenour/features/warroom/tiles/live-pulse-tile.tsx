"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Play } from "lucide-react";

export function LivePulseTile() {
  const [steps, setSteps] = useState<{ label: string; kind: string; detail?: string }[]>([]);
  const [isThinking, setIsThinking] = useState(false);

  // Poll for pending approvals
  const approvalsQuery = trpc.system.getPendingApprovals.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  const pendingApprovals = (approvalsQuery.data ?? []) as any[];

  const handleSimulate = async () => {
    if (isThinking) return;
    setIsThinking(true);
    setSteps([]);

    try {
      const res = await fetch("/api/nick/reason/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "Evaluate current system state and suggest one action." }),
      });

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += value;
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? ""; // keep the last incomplete frame in buffer

        for (const frame of frames) {
          if (!frame.trim()) continue;
          const [eventLine, dataLine] = frame.split("\n");
          if (!eventLine || !dataLine) continue;

          const eventName = eventLine.replace("event: ", "").trim();
          if (eventName === "done") {
            setIsThinking(false);
            return;
          }
          if (eventName === "step") {
            try {
              const data = JSON.parse(dataLine.replace("data: ", "").trim());
              setSteps((prev) => [...prev, data]);
            } catch (e) {
              console.error("Failed to parse SSE data", e);
            }
          }
        }
      }
    } catch (err) {
      console.error("Reasoning stream failed", err);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="flex h-full flex-col p-3 space-y-3">
      {/* Pending Approvals */}
      <div className="flex flex-col gap-1.5 flex-1">
        <h4 className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
          Action Approvals ({pendingApprovals.length})
        </h4>
        {pendingApprovals.length === 0 ? (
          <div className="text-[11px] text-[var(--text-tertiary)]/50 italic py-2">
            No pending approvals
          </div>
        ) : (
          <ul className="space-y-1.5 flex-1 overflow-y-auto custom-scrollbar pr-1">
            {pendingApprovals.map((req) => (
              <li
                key={req.id}
                className="flex flex-col gap-1 rounded-md border border-amber-500/30 bg-amber-500/[0.04] p-2 shadow-[0_0_12px_rgba(253,185,19,0.06)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-amber-400 font-medium">
                    {req.toolId}
                  </span>
                  <span className="text-[9px] text-amber-500/70 uppercase">
                    {req.riskClass} risk
                  </span>
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] font-mono truncate">
                  {JSON.stringify(req.payload)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Reasoning Stream */}
      <div className="flex flex-col gap-1.5 border-t border-[var(--border-default)]/40 pt-2 flex-1">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${isThinking ? "bg-[var(--gold)] animate-pulse" : "bg-zinc-600"}`} />
            Live Reasoning
          </h4>
          <button
            onClick={handleSimulate}
            disabled={isThinking}
            className="flex items-center gap-1 text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30 disabled:opacity-50"
          >
            <Play size={10} /> {isThinking ? "Thinking..." : "Trigger"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-1 mt-1">
          {steps.length === 0 && !isThinking ? (
            <div className="text-[11px] text-[var(--text-tertiary)]/50 italic py-2">
              Engine idle
            </div>
          ) : (
            steps.map((s, i) => (
              <div key={i} className="text-[11px] text-[var(--text-secondary)] leading-snug">
                <span className="text-[var(--gold)]/80 mr-1.5 font-mono">{s.kind}</span>
                {s.label}
              </div>
            ))
          )}
          {isThinking && (
            <div className="text-[11px] text-[var(--gold)] animate-pulse font-mono mt-1">
              ...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
