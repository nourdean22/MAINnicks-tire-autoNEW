"use client";

/**
 * EvidenceMark · PROOF as a slot, not a badge wall · 2026-09-15.
 *
 * Every important claim can reveal its proof (UI Constitution #9). Default:
 * a single chip with the evidence class ("you stated" / "inferred" / ...) and
 * the full provenance in a tooltip. With Reality Mode on (persisted store
 * flag, toggled from the command palette) the full provenance renders INLINE
 * everywhere the mark appears — developer tools for your own life model,
 * without plastering grades on every screen by default.
 *
 * Vocabulary is the commit-gateway ladder via lib/brain/evidence-label.ts —
 * one taxonomy, shared with recall and the graph panel. Renders nothing when
 * the record carries no provenance at all: silence, not a default.
 */

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { describeProvenance, evidenceLabel, type ProvenanceInput } from "@/lib/brain/evidence-label";
import { useInspectorStore } from "@/lib/state/inspector-store";

export interface EvidenceMarkProps {
  provenance: ProvenanceInput;
  /** Force inline rendering (the inspector's PROOF section). */
  inline?: boolean;
  now?: Date;
  className?: string;
}

export function EvidenceMark({ provenance, inline, now, className }: EvidenceMarkProps) {
  const realityMode = useInspectorStore((s) => s.realityMode);
  const lines = describeProvenance(provenance, now);
  if (lines.length === 0) return null;
  const label = evidenceLabel(provenance.evidence);
  const showInline = inline || realityMode;

  if (showInline) {
    return (
      <span
        data-evidence-mark="inline"
        className={cn("font-mono text-[11px] leading-relaxed text-fg-tertiary", className)}
      >
        {label ? (
          <span className={cn("mr-1.5 rounded border px-1 py-px text-[10px] uppercase tracking-wide", label.cls)}>
            {label.text}
          </span>
        ) : null}
        {lines.filter((l) => l !== label?.text).join(" · ")}
      </span>
    );
  }

  const chipText = label?.text ?? lines[0];
  const chipCls = label?.cls ?? "border-edge text-fg-tertiary";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-evidence-mark="chip"
            className={cn(
              "inline-flex cursor-help items-center rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide",
              chipCls,
              className,
            )}
          />
        }
      >
        {chipText}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-[11px] leading-relaxed">
        {lines.join(" · ")}
      </TooltipContent>
    </Tooltip>
  );
}
