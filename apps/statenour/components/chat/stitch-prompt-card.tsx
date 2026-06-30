/**
 * apps/statenour/components/chat/stitch-prompt-card.tsx
 *
 * Rich card component for displaying and copying Stitch-enhanced prompts.
 * Rendered inline inside the chat flow when an output matches the
 * Stitch Prompt JSON schema.
 */

"use client";

import * as React from "react";
import { useState } from "react";
import { Sparkles, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EnhancedPromptOutput } from "@nour/ai-capabilities";

interface StitchPromptCardProps {
  data: EnhancedPromptOutput;
}

export function StitchPromptCard({ data }: StitchPromptCardProps) {
  const [copied, setCopied] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.finalPromptMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  // Helper to extract hex value if present in string
  const extractHex = (val: string): string | null => {
    const match = val.match(/#([0-9a-fA-F]{3,6})\b/);
    return match ? match[0] : null;
  };

  const { designSystem, pageStructure, interactionNotes, constraints } = data;

  return (
    <div className="my-3 rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden shadow-xl max-w-2xl font-sans">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-amber-500/10 via-yellow-500/5 to-transparent px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4.5 w-4.5 text-[#e5a93b] animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200">Stitch Prompt Architect</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium text-[#e5a93b] border border-amber-500/20">
          {designSystem.platform || "Web"}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Purpose */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono font-semibold">Purpose</div>
          <p className="text-sm font-medium text-zinc-100 mt-1">{data.oneLinePurpose}</p>
        </div>

        {/* Design System Tokens */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono font-semibold mb-2">Design System Grid</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {Object.entries(designSystem).map(([key, val]) => {
              if (!val || typeof val !== "string" || key === "platform") return null;
              const hex = extractHex(val);
              return (
                <div key={key} className="flex items-center justify-between bg-white/[0.01] border border-white/[0.03] rounded-md px-2.5 py-1.5">
                  <span className="text-zinc-500 capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-300">
                    {hex && (
                      <span 
                        className="h-2.5 w-2.5 rounded-full border border-white/20" 
                        style={{ backgroundColor: hex }} 
                      />
                    )}
                    <span>{val}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Page Structure */}
        {pageStructure && pageStructure.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono font-semibold mb-2">Layout Structure</div>
            <div className="space-y-1.5 text-xs">
              {pageStructure.map((sec, idx) => (
                <div key={idx} className="flex gap-3 bg-white/[0.01] border border-white/[0.03] p-2 rounded-md">
                  <div className="flex-shrink-0 h-5 w-5 rounded-full bg-zinc-800 border border-white/5 flex items-center justify-center font-mono text-[10px] text-[#e5a93b]">
                    {idx + 1}
                  </div>
                  <div>
                    <span className="font-semibold text-zinc-200 block">{sec.section}</span>
                    <span className="text-zinc-400 text-[11px] mt-0.5 block">{sec.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Constraints & Interaction Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-1">
          {constraints && constraints.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono font-semibold mb-1.5">Constraints</div>
              <ul className="space-y-1 text-zinc-400 list-disc list-inside pl-1 text-[11px]">
                {constraints.map((c, idx) => (
                  <li key={idx}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {interactionNotes && interactionNotes.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono font-semibold mb-1.5">Interactions</div>
              <ul className="space-y-1 text-zinc-400 list-disc list-inside pl-1 text-[11px]">
                {interactionNotes.map((n, idx) => (
                  <li key={idx}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Markdown Expand Panel */}
        <div className="border border-white/5 rounded-lg overflow-hidden bg-black/25">
          <button
            type="button"
            onClick={() => setExpandedPrompt(!expandedPrompt)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.02] transition-colors"
          >
            <span>Raw Markdown Prompt ({data.finalPromptMarkdown.length} chars)</span>
            {expandedPrompt ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {expandedPrompt && (
            <div className="p-3 border-t border-white/5 font-mono text-[10px] text-zinc-400 max-h-60 overflow-y-auto whitespace-pre-wrap select-all">
              {data.finalPromptMarkdown}
            </div>
          )}
        </div>

        {/* Copy Action */}
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold transition-all duration-200 border",
            copied
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-[#e5a93b]/10 border-[#e5a93b]/30 text-[#e5a93b] hover:bg-[#e5a93b]/15"
          )}
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              <span>Copied to Clipboard!</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              <span>Copy Stitch-Enhanced Prompt</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
