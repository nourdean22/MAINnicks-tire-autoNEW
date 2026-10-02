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
    <div className="my-3 rounded-surface border border-edge-subtle bg-content overflow-hidden max-w-2xl font-sans">
      {/* Header Banner */}
      <div className="px-4 py-3 border-b border-edge-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4.5 w-4.5 text-fg-tertiary" />
          <span className="text-[13px] font-semibold text-fg">Stitch Prompt Architect</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-edge-default bg-surface-raised px-2.5 py-0.5 text-[11px] font-medium text-fg-secondary">
          {designSystem.platform || "Web"}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Purpose */}
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">Purpose</div>
          <p className="text-sm font-medium text-fg mt-1">{data.oneLinePurpose}</p>
        </div>

        {/* Design System Tokens */}
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-2">Design System Grid</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {Object.entries(designSystem).map(([key, val]) => {
              if (!val || typeof val !== "string" || key === "platform") return null;
              const hex = extractHex(val);
              return (
                <div key={key} className="flex items-center justify-between bg-surface-raised border border-edge-subtle rounded-control px-2.5 py-1.5">
                  <span className="text-fg-tertiary capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-fg-secondary">
                    {hex && (
                      <span 
                        className="h-2.5 w-2.5 rounded-full border border-edge-strong" 
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
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-2">Layout Structure</div>
            <div className="space-y-1.5 text-xs">
              {pageStructure.map((sec, idx) => (
                <div key={idx} className="flex gap-3 bg-surface-raised border border-edge-subtle p-2 rounded-control">
                  <div className="flex-shrink-0 h-5 w-5 rounded-full bg-surface-interactive border border-edge-subtle flex items-center justify-center font-mono text-[11px] text-fg-secondary">
                    {idx + 1}
                  </div>
                  <div>
                    <span className="font-semibold text-fg block">{sec.section}</span>
                    <span className="text-fg-secondary text-[11px] mt-0.5 block">{sec.description}</span>
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
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-1.5">Constraints</div>
              <ul className="space-y-1 text-fg-secondary list-disc list-inside pl-1 text-[11px]">
                {constraints.map((c, idx) => (
                  <li key={idx}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {interactionNotes && interactionNotes.length > 0 && (
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-1.5">Interactions</div>
              <ul className="space-y-1 text-fg-secondary list-disc list-inside pl-1 text-[11px]">
                {interactionNotes.map((n, idx) => (
                  <li key={idx}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Markdown Expand Panel */}
        <div className="border border-edge-subtle rounded-control overflow-hidden bg-canvas">
          <button
            type="button"
            onClick={() => setExpandedPrompt(!expandedPrompt)}
            className="flex min-h-11 w-full items-center justify-between px-3 py-2 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
          >
            <span>Raw Markdown Prompt ({data.finalPromptMarkdown.length} chars)</span>
            {expandedPrompt ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {expandedPrompt && (
            <div className="p-3 border-t border-edge-subtle font-mono text-[11px] text-fg-secondary max-h-60 overflow-y-auto whitespace-pre-wrap select-all">
              {data.finalPromptMarkdown}
            </div>
          )}
        </div>

        {/* Copy Action */}
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "flex min-h-11 w-full items-center justify-center gap-2 rounded-control border px-4 py-2.5 text-[13px] font-medium transition-colors duration-[var(--motion-state)]",
            copied
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-content border-edge-default text-fg-secondary hover:border-edge-strong hover:text-fg"
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
