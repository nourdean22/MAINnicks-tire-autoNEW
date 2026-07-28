"use client";

/**
 * Typed tool-result renderers (UI-3, 2026-07-28).
 *
 * The registry pattern the audit asked for, started deliberately small:
 * ONE card, backed by a tool whose output shape shipped today and is
 * fully known (getFleetTruth). The registry keys on the message part's
 * tool name; anything unregistered keeps the existing generic receipt
 * row — a wrong typed rendering is worse than prose, so cards are added
 * one verified shape at a time (approval card and decision card are the
 * named next two).
 */

import Link from "next/link";
import type { UIMessage } from "ai";

interface FleetArtifact {
  capability: string;
  state: "fresh" | "stale" | "never_produced" | "unknown";
  ageH: number | null;
}
interface FleetTruthOutput {
  ok?: boolean;
  generatedAt?: string;
  statenour?: FleetArtifact[];
  nickstire?: FleetArtifact[];
  allFresh?: boolean;
}

const STATE_COLOR: Record<FleetArtifact["state"], string> = {
  fresh: "text-emerald-300",
  stale: "text-amber-300",
  never_produced: "text-red-300",
  unknown: "text-zinc-400",
};

function FleetTruthCard({ output }: { output: FleetTruthOutput }) {
  if (output.ok === false) return null; // errors keep the generic receipt row
  const rows = [
    ...(output.statenour ?? []).map((a) => ({ ...a, app: "statenour" })),
    ...(output.nickstire ?? []).map((a) => ({ ...a, app: "nickstire" })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 rounded-xl border border-edge bg-void/60 p-3" data-testid="fleet-truth-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
          Fleet truth
        </span>
        <span
          className={`text-[10px] font-semibold ${output.allFresh ? "text-emerald-300" : "text-amber-300"}`}
        >
          {output.allFresh ? "all fresh" : "attention needed"}
        </span>
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={`${r.app}:${r.capability}`} className="flex items-center justify-between text-[11px]">
            <span className="font-mono text-fg-tertiary">
              {r.app === "nickstire" && !r.capability.startsWith("nickstire") ? `nickstire:${r.capability}` : r.capability}
            </span>
            <span className={STATE_COLOR[r.state] ?? "text-zinc-400"}>
              {r.state.replace("_", " ")}
              {r.ageH != null ? ` · ${r.ageH}h` : ""}
            </span>
          </div>
        ))}
      </div>
      <Link href="/system/fleet" className="mt-2 inline-block text-[10px] text-gold hover:underline">
        open fleet page
      </Link>
    </div>
  );
}

interface DecisionRow {
  id?: string;
  urgency?: string;
  state?: string;
  recommendedAction?: string;
  valueDollars?: number;
  dataQuality?: string;
  attempts?: number;
}
interface TopDecisionsOutput {
  ok?: boolean;
  decisions?: DecisionRow[];
  totalLive?: number;
  excludedNoConsent?: number;
  excludedSnoozed?: number;
}

const URGENCY_COLOR: Record<string, string> = {
  critical: "text-red-300",
  today: "text-amber-300",
  this_week: "text-sky-300",
  later: "text-zinc-400",
};

function TopDecisionsCard({ output }: { output: TopDecisionsOutput }) {
  if (output.ok === false) return null;
  const rows = output.decisions ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 rounded-xl border border-edge bg-void/60 p-3" data-testid="top-decisions-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
          Decision inbox — top {rows.length}
        </span>
        <span className="text-[10px] text-fg-tertiary">
          {output.totalLive ?? 0} live
          {output.excludedSnoozed ? ` · ${output.excludedSnoozed} snoozed` : ""}
          {output.excludedNoConsent ? ` · ${output.excludedNoConsent} no-consent` : ""}
        </span>
      </div>
      <ol className="space-y-2">
        {rows.map((d, i) => (
          <li key={d.id ?? i} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${URGENCY_COLOR[d.urgency ?? ""] ?? "text-zinc-400"}`}>
                {d.urgency ?? "unranked"}
              </span>
              <span className="text-[11px] tabular-nums text-fg-secondary">
                {d.valueDollars && d.valueDollars > 0 ? `$${d.valueDollars.toLocaleString()}` : "value unknown"}
                {d.dataQuality ? ` · ${d.dataQuality}` : ""}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] leading-snug text-fg">{d.recommendedAction ?? "(no action text)"}</p>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10px] text-fg-tertiary">
        Same read as the admin Decision Inbox — decide there; this card never mutates.
      </p>
    </div>
  );
}

/** tool name → renderer. Add entries only for VERIFIED output shapes. */
const RENDERERS: Record<string, (output: unknown) => React.ReactNode> = {
  getFleetTruth: (output) => <FleetTruthCard output={(output ?? {}) as FleetTruthOutput} />,
  getTopDecisions: (output) => <TopDecisionsCard output={(output ?? {}) as TopDecisionsOutput} />,
};

export function TypedToolCards({ message }: { message: UIMessage }) {
  const parts = (message.parts ?? []) as Array<{ type: string; state?: string; output?: unknown }>;
  const cards = parts
    .filter((p) => p.type.startsWith("tool-") && p.state === "output-available")
    .map((p, i) => {
      const toolName = p.type.slice("tool-".length);
      const render = RENDERERS[toolName];
      if (!render) return null;
      return <div key={`${toolName}-${i}`}>{render(p.output)}</div>;
    })
    .filter(Boolean);
  if (cards.length === 0) return null;
  return <>{cards}</>;
}
