"use client";

import React from "react";
import { Brain, Sparkles, AlertTriangle, X } from "lucide-react";

export interface MemoryHit {
  id: string;
  content: string;
  category: string;
  similarity: number;
}

export interface ContradictionLog {
  id: string;
  claim: string;
  reality: string;
  severity: string;
}

export interface MemoryInspectorSidebarProps {
  open: boolean;
  onClose: () => void;
  hits: MemoryHit[];
  contradictions: ContradictionLog[];
  /** When the recall shown here was fetched — UI-2: evidence without a
   *  timestamp is a claim, not evidence. Null = not fetched yet. */
  fetchedAt?: Date | null;
}

export const MemoryInspectorSidebar: React.FC<MemoryInspectorSidebarProps> = ({
  open,
  onClose,
  hits,
  contradictions,
  fetchedAt,
}) => {
  if (!open) return null;
  // Absolute time, not "Ns ago": render stays pure (no Date.now() during
  // render — react-compiler purity rule) and an absolute stamp is the more
  // honest receipt anyway.
  const freshness = fetchedAt
    ? `recalled at ${fetchedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
    : "not yet fetched — open state, not evidence";

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-80 md:w-96 bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col animate-fadeSlideLeft">
      <div className="flex justify-between items-center p-4 border-b border-zinc-800">
        <div className="flex items-center space-x-2">
          <Brain className="w-4 h-4 text-gold" />
          <span className="text-[12px] font-bold font-display uppercase tracking-widest text-zinc-100">
            Context &amp; Evidence
          </span>
        </div>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 bg-transparent border-none cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* UI-2: the epistemics line — memory vs evidence is the
          distinction that keeps this panel honest. */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Memory is what Nick believes · evidence is why to trust this answer.
        </p>
        <p className="text-[10px] font-mono text-zinc-600 mt-0.5">{freshness}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Memory Hits Section */}
        <div>
          <div className="flex items-center space-x-1 text-gold mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-wider font-display">
              Remembered — what Nick believes ({hits.length})
            </span>
          </div>
          {hits.length === 0 ? (
            <p className="text-[11px] text-zinc-500 italic">No semantic memory hits retrieved.</p>
          ) : (
            <div className="space-y-3">
              {hits.map((hit) => (
                <div key={hit.id} className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-lg">
                  <div className="flex justify-between text-[9px] font-mono text-zinc-500 mb-1">
                    <span>{hit.category}</span>
                    <span>{(hit.similarity * 100).toFixed(0)}% Match</span>
                  </div>
                  <p className="text-[11px] text-zinc-300 whitespace-pre-wrap">{hit.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Contradictions Section */}
        <div>
          <div className="flex items-center space-x-1 text-rose-400 mb-3">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-wider font-display">
              Evidence check — contradictions ({contradictions.length})
            </span>
          </div>
          {contradictions.length === 0 ? (
            <p className="text-[11px] text-zinc-500 italic">No contradictions detected in this turn.</p>
          ) : (
            <div className="space-y-3">
              {contradictions.map((c) => (
                <div key={c.id} className="bg-rose-950/10 border border-rose-900/20 p-3 rounded-lg">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-rose-400 px-1.5 py-0.5 bg-rose-900/20 rounded">
                    {c.severity} Severity
                  </span>
                  <div className="mt-2 space-y-1.5 text-[11px]">
                    <div>
                      <span className="text-zinc-500 font-mono text-[9px]">Stated Claim:</span>
                      <p className="text-zinc-300 font-serif italic">&ldquo;{c.claim}&rdquo;</p>
                    </div>
                    <div>
                      <span className="text-zinc-500 font-mono text-[9px]">Actual Reality:</span>
                      <p className="text-zinc-300 font-sans font-semibold">&ldquo;{c.reality}&rdquo;</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
