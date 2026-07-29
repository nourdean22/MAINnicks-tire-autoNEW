"use client";

/**
 * QualityBar — Apr 19. Tiny strip under assistant messages that
 * surfaces the output critic + reply gate verdicts.
 *
 * Shows nothing when the reply is clean (critic overall >= 80 AND
 * gate severity is 0). That's on purpose — silence = everything's
 * fine. Low-quality replies draw a subtle red or amber hint with a
 * "regen" button that re-runs the same prompt (caller handles).
 *
 * Mount as a sibling to ContextBlockBadges inside AssistantMessageShell.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ShieldAlert, ShieldCheck, AlertCircle, RotateCcw } from "lucide-react";

export interface QualityPayload {
  critic?: {
    overall?: number;
    specificity?: number;
    cliche?: number;
    antiNour?: number;
    length?: number;
    wordCount?: number;
    shouldRegen?: boolean;
    reasons?: string[];
    // v6 · BATCH 2 · Apr 28 — 7-axis content scoring extras
    contentMode?: boolean;
    brandElement?: number;
    cta?: number;
    hashtagQuality?: number;
  };
  gate?: {
    severity?: number;
    shouldRegen?: boolean;
    reasons?: string[];
  };
  factCheck?: {
    total?: number;
    unverified?: number;
  };
  /** WP-11 (2026-07-29) · known-truth guard flags persisted with the turn. */
  truth?: {
    total?: number;
    flags?: Array<{ kind?: string; rule?: string; snippet?: string; severity?: number }>;
  };
  /** WP-11 (2026-07-29) · action-receipt verdict: were this reply's
   *  action claims backed by successful tool calls? */
  receipt?: {
    ok?: boolean;
    toolsFired?: Array<{ toolName?: string; status?: string }>;
    offenders?: Array<{ toolName?: string; status?: string; label?: string }>;
  };
}

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

  const isClean = overall >= 80 && severity === 0 && unverified === 0;
  if (isClean) return null;

  // Color: red when regen recommended, amber when warn, gold for mild hint.
  const tone = shouldRegen ? "red" : severity >= 50 || unverified >= 2 ? "amber" : "gold";
  const toneClass =
    tone === "red"
      ? "border-red-500/30 bg-red-500/5 text-red-300"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
        : "border-[var(--gold)]/20 bg-[var(--gold)]/5 text-[var(--gold)]";

  const Icon = shouldRegen ? ShieldAlert : unverified > 0 ? AlertCircle : ShieldCheck;

  return (
    <div className={cn("mt-1.5 rounded-md border px-2 py-1", toneClass)}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 text-left"
        title="Tap to toggle quality detail"
      >
        <Icon size={10} />
        <span className="text-[9px] font-mono uppercase tracking-wider">
          {shouldRegen ? "regen recommended" : unverified > 0 ? `${unverified} unverified` : "quality warn"}
          {overall < 100 ? ` · ${overall}` : ""}
        </span>
        {onRegen && shouldRegen && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRegen();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onRegen();
              }
            }}
            className="ml-auto inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider border border-current/30 rounded px-1.5 py-0.5 hover:bg-current/10 cursor-pointer"
          >
            <RotateCcw size={9} />
            regen
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-1 text-[9px] font-mono leading-[1.4] opacity-80 space-y-0.5">
          {typeof critic.overall === "number" && (
            <div>
              critic · overall={critic.overall} · spec={critic.specificity} · cliche={critic.cliche} · voice={critic.antiNour} · len={critic.length} · words={critic.wordCount}
            </div>
          )}
          {/* v6 · BATCH 2 · Apr 28 — 7-axis content score row */}
          {critic.contentMode && (
            <div>
              content · brand={critic.brandElement} · cta={critic.cta} · hashtag={critic.hashtagQuality}
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
        </div>
      )}
    </div>
  );
}
