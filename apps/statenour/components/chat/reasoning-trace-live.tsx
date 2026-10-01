"use client";

/**
 * Activity Summary — how Nick's work-in-progress reads in the conversation.
 *
 * 2026-10-01 (UI v2). Replaces the zinc "Deep Reasoning in progress…" debugger
 * card. Same data (`ReasoningStep[]` from the reasoning stream), new grammar:
 *
 *   working   ◌ Working · 11s · Comparing production          (amber, pulses — the ONLY pulsing state)
 *   done      ✓ Worked 18s · 6 steps                          (muted, one line, tap to expand)
 *   expanded  one row per step: glyph · label · elapsed       (an activity timeline, not a console)
 *   developer detail (opt-in)  the raw step payloads in mono  (never shown by default)
 *
 * It never exposes hidden chain-of-thought: the stream only carries labelled,
 * sanctioned step kinds. The component name and props are unchanged so the
 * one consumer (chat-message-list.tsx) needs no edit.
 */

import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReasoningStep, ReasoningStepKind } from "@/lib/ai/reasoning/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<ReasoningStepKind, string> = {
  classify: "Classifying",
  decompose: "Breaking down",
  plan: "Planning",
  fanout: "Fanning out",
  agent_call: "Consulting",
  tool_call: "Calling tool",
  critique: "Checking",
  refine: "Refining",
  deliver: "Writing",
};

function seconds(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function ReasoningTraceLive({ steps }: { steps: ReasoningStep[] }) {
  const [expanded, setExpanded] = useState(false);
  const [devDetail, setDevDetail] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const count = steps?.length ?? 0;
  const last = count > 0 ? steps[count - 1] : null;
  const isDone = last?.kind === "deliver";
  // elapsedMs is the step's own clock reading; the largest value is the honest
  // "worked for" figure whether the stream reports per-step or cumulative time.
  const workedMs = count > 0 ? Math.max(...steps.map((s) => s.elapsedMs ?? 0)) : 0;

  useEffect(() => {
    if (!isDone && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [count, isDone]);

  if (count === 0) return null;

  const showList = expanded || !isDone;
  const currentLabel = last ? last.label || KIND_LABEL[last.kind] : "";

  return (
    <div className="mb-3" data-activity-state={isDone ? "done" : "working"}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={showList}
        className="group inline-flex min-h-11 max-w-full items-center gap-2 rounded-control px-1 text-left font-mono text-[11.5px] text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg-secondary sm:min-h-8"
      >
        {isDone ? (
          <span aria-hidden className="text-emerald-300">✓</span>
        ) : (
          <span aria-hidden className="pulse-live inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
        )}
        <span className="truncate">
          {isDone
            ? `Worked ${seconds(workedMs)} · ${count} step${count === 1 ? "" : "s"}`
            : `Working · ${seconds(workedMs)} · ${currentLabel}`}
        </span>
        <ChevronRight
          size={12}
          aria-hidden
          className={cn("shrink-0 transition-transform duration-[var(--motion-state)]", showList && "rotate-90")}
        />
      </button>

      {showList && (
        <ol
          ref={listRef}
          aria-label="activity"
          className="mt-1 max-h-[280px] overflow-y-auto border-l border-edge-subtle pl-3"
        >
          {steps.map((step, idx) => {
            const isLast = idx === count - 1;
            const live = isLast && !isDone;
            return (
              <li key={`${step.kind}-${idx}`} className="flex items-baseline gap-3 py-1 text-[12.5px]">
                <span aria-hidden className={cn("font-mono", live ? "text-amber-300" : "text-fg-tertiary")}>
                  {live ? "◌" : "✓"}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", live ? "text-fg" : "text-fg-secondary")}>
                  {step.label || KIND_LABEL[step.kind]}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-tertiary">{seconds(step.elapsedMs)}</span>
                {devDetail && step.detail !== undefined && step.detail !== null && (
                  <pre className="basis-full overflow-x-auto whitespace-pre-wrap break-words rounded-micro bg-content px-2 py-1 font-mono text-[11px] leading-[1.45] text-fg-tertiary">
                    {typeof step.detail === "object" ? JSON.stringify(step.detail, null, 2) : String(step.detail)}
                  </pre>
                )}
              </li>
            );
          })}
          {isDone && (
            <li className="py-1">
              <button
                type="button"
                onClick={() => setDevDetail((v) => !v)}
                aria-pressed={devDetail}
                className="min-h-11 rounded-micro font-mono text-[11px] text-fg-tertiary hover:text-fg-secondary sm:min-h-6"
              >
                {devDetail ? "Hide developer detail" : "Developer detail"}
              </button>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
