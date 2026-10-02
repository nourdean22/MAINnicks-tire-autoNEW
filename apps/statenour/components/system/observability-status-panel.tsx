"use client";

/**
 * ObservabilityStatusPanel (2026-08-25) — the dormant-is-visible rule.
 *
 * Braintrust's wrapper sat "shipped" for three months with a key in prod
 * and zero callers, and NOTHING on any operator surface said so — the
 * status existed in the health payload and rendered nowhere. A dormant
 * integration that looks identical to a working one is this repo's
 * recurring defect class. This panel makes the tracing lane's REAL state
 * a first-class chip on /system:
 *
 *   started  → tracing live (green)
 *   skipped  → DORMANT, keys unset — with the exact activation step
 *   failed   → init threw (red) — key present but pipeline dead
 *   inactive/uninitialized → never initialized on this boot
 *
 * Data: trpc.system.healthSummary (buildSystemHealth), which reports the
 * measured wrap/init OUTCOME, never key-presence.
 */

import { trpc } from "@/lib/trpc/client";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type LaneState = {
  label: string;
  tone: "live" | "dormant" | "dead" | "unknown";
  detail: string;
};

function langfuseState(status: string | undefined): LaneState {
  switch (status) {
    case "started":
      return { label: "tracing live", tone: "live", detail: "spans flow to Langfuse on every non-private chat turn" };
    case "skipped":
      return {
        label: "DORMANT — keys unset",
        tone: "dormant",
        detail: "wired + deployed; set LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY (+ LANGFUSE_BASE_URL) on Railway statenour-web to activate",
      };
    case "failed":
      return { label: "init FAILED", tone: "dead", detail: "keys present but the OTel pipeline did not start — check boot logs (langfuse_init_failed)" };
    default:
      return { label: "not initialized", tone: "unknown", detail: "no init outcome reported on this boot" };
  }
}

// Static truth, not live data: the wrapper was DELETED 2026-08-25 after
// three months with zero call sites (key set in prod the whole time).
// There is nothing to poll — rendering the retirement is the honest state.
const BRAINTRUST_RETIRED: LaneState = {
  label: "wrap removed 2026-08-25",
  tone: "unknown",
  detail:
    "braintrust-wrap.ts deleted — zero call sites since Wave-200; the prod key never produced a trace. Eval-dataset scripts (manual upload) are Braintrust's only remaining surface.",
};

const TONE_CLASSES: Record<LaneState["tone"], string> = {
  live: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  dormant: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  dead: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  unknown: "border-edge-subtle bg-surface-interactive text-fg-secondary",
};

export function ObservabilityStatusPanel() {
  const healthQ = trpc.system.healthSummary.useQuery(undefined, { staleTime: 60_000 });
  const payload = healthQ.data as { langfuse?: { status?: string } } | undefined;

  const lanes: Array<{ name: string; state: LaneState }> = [
    { name: "Langfuse", state: langfuseState(payload?.langfuse?.status) },
    { name: "Braintrust", state: BRAINTRUST_RETIRED },
  ];

  return (
    <section
      aria-label="observability-status"
      className="rounded-surface border border-edge-subtle p-4 space-y-2"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-fg-secondary" /> LLM Observability
      </p>
      {healthQ.isError ? (
        <p className="text-[11px] text-red-400">
          Health read failed — observability state unknown, not healthy.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lanes.map(({ name, state }) => (
            <li key={name} className="flex items-start gap-2 flex-wrap">
              <span className="text-[11px] font-mono text-fg w-20 shrink-0">{name}</span>
              <span
                className={cn(
                  "text-[11px] font-mono border rounded px-1.5 py-px",
                  TONE_CLASSES[state.tone],
                )}
              >
                {healthQ.isLoading ? "…" : state.label}
              </span>
              {!healthQ.isLoading && (
                <span className="text-[11px] text-fg-tertiary leading-snug basis-full">
                  {state.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
