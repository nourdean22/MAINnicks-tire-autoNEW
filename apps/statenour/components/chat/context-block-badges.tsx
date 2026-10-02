"use client";

/**
 * ContextBlockBadges — tiny strip under assistant messages showing
 * WHICH brain-learning blocks fed the turn.
 *
 * Makes the invisible power visible. Dots: one per block that fired
 * (chat-recall / skills / identity / ghost / qualitative / beliefs /
 * nudges / contradictions). Tap any dot → tooltip with that block's
 * content. Tap the whole strip → full inspector.
 *
 * Data source: the chat route already writes an assistant message
 * token-usage payload with `contextBlocks` flags. This component
 * reads that payload.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Brain, Target, Eye, Compass, BookOpen, Ghost, MessagesSquare, AlertTriangle } from "lucide-react";

export interface ContextBlocks {
  recall?: boolean;
  skills?: boolean;
  identity?: boolean;
  ghost?: boolean;
  qualitative?: boolean;
  beliefs?: boolean;
  nudges?: boolean;
  contradictions?: boolean;
}

const BLOCK_META: Record<keyof ContextBlocks, { icon: typeof Brain; label: string; color: string }> = {
  recall: { icon: MessagesSquare, label: "Past chat recall", color: "text-blue-400" },
  skills: { icon: Target, label: "Active skills", color: "text-fg-secondary" },
  identity: { icon: Compass, label: "Identity snapshot", color: "text-emerald-400" },
  ghost: { icon: Ghost, label: "Ghost Nick", color: "text-violet-400" },
  qualitative: { icon: Eye, label: "Qualitative identity", color: "text-amber-400" },
  beliefs: { icon: BookOpen, label: "Beliefs", color: "text-blue-300" },
  nudges: { icon: Brain, label: "Cross-system nudges", color: "text-[var(--text-primary)]" },
  contradictions: { icon: AlertTriangle, label: "Contradictions", color: "text-red-400" },
};

export function ContextBlockBadges({ blocks }: { blocks: ContextBlocks | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!blocks) return null;
  const fired = (Object.keys(BLOCK_META) as Array<keyof ContextBlocks>).filter((k) => blocks[k]);
  if (fired.length === 0) return null;

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 opacity-50 hover:opacity-100 transition-opacity"
        title={`${fired.length} brain block${fired.length > 1 ? "s" : ""} fired · tap to expand`}
      >
        {fired.slice(0, 5).map((k) => {
          const meta = BLOCK_META[k];
          const Icon = meta.icon;
          return <Icon key={k} size={8} className={meta.color} />;
        })}
        {fired.length > 5 && (
          <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
            +{fired.length - 5}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {fired.map((k) => {
            const meta = BLOCK_META[k];
            const Icon = meta.icon;
            return (
              <span
                key={k}
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-micro text-[11px] font-mono border border-[var(--border-default)] bg-[var(--bg-raised)]",
                  meta.color,
                )}
              >
                <Icon size={9} />
                {meta.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
