"use client";

/**
 * Judge calibration panel — Wave-5 (2026-07-29).
 *
 * The judge-eval harness had NO calibration surface: judgments accrued
 * with nobody measuring judge-vs-operator agreement. This panel is the
 * label loop: the operator blind-labels A/B comparisons (the judge's
 * pick stays hidden until after the tap — position/anchoring-bias
 * mitigation), and the agreement report tells us when the judge can be
 * trusted (30+ labels per practice guidance).
 */

import { useState } from "react";
import { Panel } from "@/components/panel";
import { trpc } from "@/lib/trpc/client";

/** Wave-6 (2026-07-29) · triage adoption from spine-5's own audit
 *  events — measures the ritual, adds no new contract. */
export function TriageAdoptionStrip() {
  const adoption = trpc.system.triageAdoption.useQuery({ windowDays: 14 });
  if (adoption.isLoading) return null;
  return (
    <Panel>
      <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-1">
        triage ritual — decisions in 14d
      </p>
      {adoption.isError || !adoption.data ? (
        <p className="text-[12px] text-zinc-400">adoption unreadable — state UNKNOWN</p>
      ) : adoption.data.total === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">
          Zero triage decisions in 14 days — the flow exists (spine-5); the ritual isn&apos;t
          happening. That is an adoption fact, not a build request.
        </p>
      ) : (
        <div className="flex items-center gap-3 text-[12px] tabular-nums flex-wrap">
          <span className="text-emerald-300">{adoption.data.total} decisions</span>
          {adoption.data.decisions.map((d) => (
            <span key={d.decision} className="text-fg-secondary/70">
              {d.decision}: {d.count}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function JudgeCalibrationPanel() {
  const utils = trpc.useUtils();
  const recent = trpc.system.judgeRecent.useQuery({ take: 15 });
  const calibration = trpc.system.judgeCalibration.useQuery();
  const label = trpc.system.judgeLabel.useMutation({
    onSuccess: () => {
      void utils.system.judgeRecent.invalidate();
      void utils.system.judgeCalibration.invalidate();
    },
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const unlabeled = (recent.data ?? []).filter((r) => r.operatorWinner === null);
  const next = unlabeled[0];
  const cal = calibration.data;

  return (
    <Panel>
      <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-1">
        judge calibration — does the judge agree with you?
      </p>

      {calibration.isLoading ? (
        <div className="h-4 w-40 rounded bg-white/5 animate-pulse" />
      ) : cal ? (
        <div className="text-[12px] tabular-nums flex items-center gap-4 py-1">
          <span className="text-fg-secondary/70">{cal.labeled} labeled</span>
          <span className={cal.trusted ? "text-emerald-300" : "text-amber-300"}>
            {cal.agreement != null ? `${Math.round(cal.agreement * 100)}% agreement` : "no labels yet"}
          </span>
          <span className="text-fg-secondary/50">
            {cal.trusted
              ? "enough labels to trust the numbers"
              : `${cal.minTrustedLabels - cal.labeled} more labels until trustworthy`}
          </span>
        </div>
      ) : (
        <p className="text-[12px] text-zinc-400">calibration unreadable — state UNKNOWN</p>
      )}

      {recent.isLoading ? null : !next ? (
        <p className="text-[11px] text-zinc-500 italic mt-2">
          No unlabeled comparisons waiting — new ones accrue as chat turns get judged.
        </p>
      ) : (
        <div className="mt-2 border border-white/10 rounded-lg p-3">
          <p className="text-[10px] font-mono text-zinc-500 mb-1">
            blind A/B — the judge&apos;s pick reveals after you label
          </p>
          <p className="text-[12px] text-zinc-300 mb-2">&ldquo;{next.prompt}&rdquo;</p>
          <button
            onClick={() => setExpanded(expanded === next.id ? null : next.id)}
            className="text-[11px] text-fg-secondary underline mb-2"
          >
            {expanded === next.id ? "hide replies" : "show replies A/B"}
          </button>
          {expanded === next.id && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2 text-[11px]">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded p-2">
                <p className="text-[9px] font-mono text-zinc-500 mb-1">A</p>
                <p className="text-zinc-300 whitespace-pre-wrap">{next.v1Reply}</p>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-800 rounded p-2">
                <p className="text-[9px] font-mono text-zinc-500 mb-1">B</p>
                <p className="text-zinc-300 whitespace-pre-wrap">{next.v2Reply}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            {(["v1", "v2", "tie"] as const).map((w) => (
              <button
                key={w}
                disabled={label.isPending}
                onClick={() => label.mutate({ id: next.id, winner: w })}
                className="rounded px-3 py-1 text-[11px] border border-white/15 text-fg-secondary hover:text-fg disabled:opacity-50"
              >
                {w === "v1" ? "A is better" : w === "v2" ? "B is better" : "tie"}
              </button>
            ))}
            <span className="text-[10px] text-zinc-500">{unlabeled.length} waiting</span>
          </div>
          {label.isError && (
            <p className="mt-1 text-[11px] text-red-400">label failed: {label.error.message}</p>
          )}
        </div>
      )}
    </Panel>
  );
}
