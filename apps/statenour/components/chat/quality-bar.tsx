"use client";

/**
 * QualityBar — Apr 19. Tiny strip under assistant messages that
 * surfaces the output critic + reply gate verdicts.
 *
 * Shows nothing when the reply is clean. Important: the critic axes are
 * deterministic heuristic indices, not calibrated probabilities or claims of
 * perfect prose. Truth/receipt warnings are control-plane evidence and surface
 * even when the style critic itself is clean.
 *
 * Mount as a sibling to ContextBlockBadges inside AssistantMessageShell.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ShieldAlert, ShieldCheck, AlertCircle, RotateCcw } from "lucide-react";
import {
  CRITIC_HEURISTIC_NOTE,
  criticDiagnosticLine,
  qualityHasIssue,
  receiptHasIssue,
  truthWarningCount,
  type QualityDiagnosticPayload,
} from "@/lib/ai/chat/quality-diagnostics";

export type QualityPayload = QualityDiagnosticPayload;

interface Props {
  payload: QualityPayload | undefined;
  onRegen?: () => void;
}

export function QualityBar({ payload, onRegen }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!payload) return null;

  const critic = payload.critic ?? {};
  const gate = payload.gate ?? {};
  const fc = payload.factCheck ?? {};

  const overall = critic.overall ?? 100;
  const severity = gate.severity ?? 0;
  const shouldRegen = critic.shouldRegen || gate.shouldRegen;
  const unverified = fc.unverified ?? 0;
  const truthCount = truthWarningCount(payload);
  const receiptIssue = receiptHasIssue(payload);

  if (!qualityHasIssue(payload)) return null;

  // Receipt trouble is red because it concerns action truth, but does NOT by
  // itself enable the regen button: prose regeneration is not reconciliation.
  const tone =
    receiptIssue || shouldRegen
      ? "red"
      : truthCount > 0 || severity >= 50 || unverified >= 2
        ? "amber"
        : "gold";
  const toneClass =
    tone === "red"
      ? "border-red-500/30 bg-red-500/5 text-red-300"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
        : "border-[var(--gold)]/20 bg-[var(--gold)]/5 text-[var(--gold)]";

  const Icon =
    receiptIssue || shouldRegen
      ? ShieldAlert
      : unverified > 0 || truthCount > 0
        ? AlertCircle
        : ShieldCheck;

  const label = receiptIssue
    ? "action unverified"
    : truthCount > 0
      ? `${truthCount} truth warning${truthCount === 1 ? "" : "s"}`
      : shouldRegen
        ? "regen recommended"
        : unverified > 0
          ? `${unverified} unverified`
          : "critic warn";

  const diagnosticLine = criticDiagnosticLine(critic);
  const receiptOffenders = payload.receipt?.offenders ?? [];

  return (
    <div className={cn("mt-1.5 rounded-md border px-2 py-1", toneClass)}>
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-h-11 flex-1 items-center gap-1.5 text-left sm:min-h-8"
          title="Tap to toggle diagnostic detail"
        >
          <Icon size={10} />
          <span className="text-[9px] font-mono uppercase tracking-wider">
            {label}
            {overall < 100 ? ` · critic ${overall}` : ""}
          </span>
        </button>
        {onRegen && shouldRegen && !receiptIssue && (
          <button
            type="button"
            onClick={onRegen}
            className="inline-flex min-h-11 items-center gap-1 rounded border border-current/30 px-2 text-[9px] font-bold uppercase tracking-wider hover:bg-current/10 sm:min-h-8"
          >
            <RotateCcw size={9} />
            regen
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-1 text-[9px] font-mono leading-[1.4] opacity-80 space-y-0.5">
          {diagnosticLine && <div>{diagnosticLine}</div>}
          {diagnosticLine && <div>{CRITIC_HEURISTIC_NOTE}</div>}
          {critic.contentMode && (
            <div>
              content heuristics · brand={critic.brandElement} · cta={critic.cta} · hashtag={critic.hashtagQuality}
            </div>
          )}
          {critic.reasons && critic.reasons.length > 0 && (
            <div>{critic.reasons.join(" · ")}</div>
          )}
          {typeof gate.severity === "number" && gate.severity > 0 && (
            <div>
              gate · severity={gate.severity}
              {gate.reasons && gate.reasons.length > 0 ? ` · ${gate.reasons.join(" · ")}` : ""}
            </div>
          )}
          {unverified > 0 && (
            <div>
              fact-check · {fc.total} claim{fc.total === 1 ? "" : "s"} · {unverified} unverified (no brain-context match)
            </div>
          )}
          {truthCount > 0 && (
            <div>
              truth guard · {truthCount} flag{truthCount === 1 ? "" : "s"}
            </div>
          )}
          {receiptIssue && (
            <div>
              action receipt · unverified
              {receiptOffenders.length > 0
                ? ` · ${receiptOffenders
                    .slice(0, 3)
                    .map((o) => `${o.label || o.toolName || "action"}:${o.status || "unknown"}`)
                    .join(", ")}`
                : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
