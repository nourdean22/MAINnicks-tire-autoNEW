"use client";

import { Check, Copy, ExternalLink, Network, Terminal } from "lucide-react";
import { useState } from "react";

const GRAPH_REPORT_URL =
  "https://github.com/nourdean22/MAINnicks-tire-autoNEW/blob/main/graphify-out/GRAPH_REPORT.md";
const REFRESH_COMMAND = "graphify update .";

export function GraphifySnapshotCard() {
  const [copied, setCopied] = useState(false);

  const copyCommand = async () => {
    await navigator.clipboard.writeText(REFRESH_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="group relative overflow-hidden rounded-2xl border border-glass bg-elevated p-5 shadow-2xl flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-glass pb-4 gap-3">
        <div className="space-y-1">
          <span className="text-[10px] text-fg-secondary font-mono uppercase tracking-wider flex items-center gap-1.5">
            <Network size={12} className="text-cyan-400" />
            Graphify code graph snapshot
          </span>
          <p className="text-[10px] text-fg-secondary">Developer architecture map · not runtime memory</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-cyan-500/20 bg-cyan-500/5 text-[9px] font-mono uppercase tracking-wider text-cyan-400">
          snapshot only
        </span>
      </div>

      <div className="rounded border border-glass bg-raised p-3 space-y-2 text-[10px] font-mono">
        <p className="text-fg">The committed report maps repository files, symbols, edges and communities for coding agents.</p>
        <p className="text-fg-secondary">It does not update automatically, answer production questions, or write into BrainMemory. Treat it as stale until regenerated from a reachable current commit.</p>
      </div>

      <a
        href={GRAPH_REPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 rounded border border-cyan-500/20 bg-cyan-500/5 px-3 py-2.5 text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400 hover:bg-cyan-500/10"
      >
        <ExternalLink className="h-3 w-3" />
        Open graph report
      </a>

      <div className="border-t border-glass pt-3 space-y-2">
        <span className="text-[8px] font-mono uppercase tracking-wider text-fg-secondary">Developer refresh</span>
        <div className="flex items-center justify-between gap-3 p-1.5 rounded border border-glass bg-raised font-mono text-[10px]">
          <div className="flex items-center gap-1.5 truncate text-fg">
            <Terminal size={10} className="text-fg-secondary shrink-0" />
            <span className="truncate">{REFRESH_COMMAND}</span>
          </div>
          <button
            type="button"
            onClick={copyCommand}
            className="shrink-0 p-1 hover:bg-white/10 rounded text-fg-secondary"
            aria-label="Copy Graphify refresh command"
          >
            {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
          </button>
        </div>
      </div>
    </section>
  );
}
