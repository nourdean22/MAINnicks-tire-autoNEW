"use client";

import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { ReasoningStep } from "@/lib/ai/reasoning/types";

export function ReasoningTraceLive({ steps }: { steps: ReasoningStep[] }) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isDone = steps && steps.length > 0 ? steps[steps.length - 1]?.kind === "deliver" : false;

  useEffect(() => {
    if ((!isDone || expanded) && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [steps?.length, isDone, expanded]);

  if (!steps || steps.length === 0) return null;

  return (
    <div className="mb-4 mt-1 rounded-xl overflow-hidden border border-zinc-800/60 bg-zinc-950 shadow-sm">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-zinc-900/50 hover:bg-zinc-900 transition-colors text-left"
      >
        <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
          {isDone ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
          )}
          <span className="tracking-wide">
            {isDone ? "Reasoning complete" : "Deep Reasoning in progress..."}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono uppercase tracking-wider">
          <span>{steps.length} steps</span>
          <div
            className="transition-transform duration-200"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      </button>

      {(expanded || !isDone) && (
        <div className="overflow-hidden transition-all duration-300 ease-in-out">
          <div 
            ref={containerRef}
            className="p-3 bg-zinc-950 flex flex-col gap-3 max-h-[300px] overflow-y-auto"
          >
            {steps.map((step, idx) => {
              const isLast = idx === steps.length - 1;
              return (
                <div 
                  key={`${step.kind}-${idx}`} 
                  className="flex items-start gap-3 transition-opacity duration-300"
                >
                  <div className="mt-0.5 flex flex-col items-center">
                    <div className={`w-2 h-2 rounded-full ${isLast && !isDone ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
                    {!isLast && <div className="w-[1px] h-full bg-zinc-800 min-h-[16px] mt-1" />}
                  </div>
                  <div className="flex-1 pb-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12px] font-mono text-zinc-200 font-medium">
                        {step.label}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {step.elapsedMs}ms
                      </span>
                    </div>
                    {!!step.detail && (
                      <div className="mt-1 text-[12px] text-zinc-400 bg-zinc-900 border border-zinc-800/50 p-2 rounded-lg break-words whitespace-pre-wrap font-mono">
                        {typeof step.detail === "object" ? JSON.stringify(step.detail, null, 2) : String(step.detail as unknown as string)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
