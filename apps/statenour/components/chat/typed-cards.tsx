/**
 * Typed card bodies for the one tool-card registry (TOOL_CONFIG in tool-result-registry.tsx).
 *
 * Started as a second registry (features/chat-v2/components/typed-tool-cards.tsx, UI-3 2026-07-28)
 * and folded in on 2026-11-01 (W6 PR 1). A typed card owns a zod output schema: ToolResultCard
 * parses the output first and an output that fails the schema draws no body, because a wrong
 * typed rendering is worse than the plain receipt row. Add a schema only for a VERIFIED shape.
 *
 * zod/mini, not zod: these schemas ship in the chat client bundle, which had no zod before.
 */
import * as z from "zod/mini";
import type { FleetTruth } from "@/lib/observability/fleet-truth";

const FleetArtifact = z.object({
  capability: z.string(),
  state: z.enum(["fresh", "stale", "never_produced", "unknown"]),
  ageH: z.nullable(z.number()),
});

export const FleetTruthOutputSchema = z.object({
  ok: z.optional(z.boolean()),
  generatedAt: z.optional(z.string()),
  statenour: z.optional(z.array(FleetArtifact)),
  nickstire: z.optional(z.array(FleetArtifact)),
  allFresh: z.optional(z.boolean()),
});
export type FleetTruthOutput = z.infer<typeof FleetTruthOutputSchema>;

/** Never called: tsc fails here when the producer's FleetTruth drifts from the schema. */
export const fleetTruthFitsSchema = (t: FleetTruth): z.input<typeof FleetTruthOutputSchema> => t;

const STATE_COLOR: Record<z.infer<typeof FleetArtifact>["state"], string> = {
  fresh: "text-emerald-300",
  stale: "text-amber-300",
  never_produced: "text-red-300",
  unknown: "text-fg-tertiary",
};

export function fleetRows(output: FleetTruthOutput) {
  return [
    ...(output.statenour ?? []).map((a) => ({ ...a, app: "statenour" })),
    ...(output.nickstire ?? []).map((a) => ({ ...a, app: "nickstire" })),
  ];
}

export function FleetTruthCard({ output }: { output: FleetTruthOutput }) {
  const rows = fleetRows(output);
  if (rows.length === 0) return null;
  return (
    <div className="mt-1" data-testid="fleet-truth-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] font-medium tracking-[0.12em] text-fg-tertiary">
          Fleet truth
        </span>
        <span
          className={`text-[11px] font-semibold ${output.allFresh ? "text-emerald-300" : "text-amber-300"}`}
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
            <span className={STATE_COLOR[r.state]}>
              {r.state.replace("_", " ")}
              {r.ageH != null ? ` · ${r.ageH}h` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The bridge reaches this app untyped. Producer contract: apps/nickstire/shared/bridgeShapes.ts
// TopDecisionsShape (id is a NUMBER there). Kept looser than it, so an older nickstire still draws.
export const TopDecisionsOutputSchema = z.object({
  ok: z.optional(z.boolean()),
  decisions: z.optional(
    z.array(
      z.object({
        id: z.optional(z.union([z.number(), z.string()])),
        urgency: z.optional(z.string()),
        state: z.optional(z.string()),
        recommendedAction: z.optional(z.string()),
        valueDollars: z.optional(z.nullable(z.number())),
        dataQuality: z.optional(z.string()),
        attempts: z.optional(z.number()),
      }),
    ),
  ),
  totalLive: z.optional(z.number()),
  excludedNoConsent: z.optional(z.number()),
  excludedSnoozed: z.optional(z.number()),
});
export type TopDecisionsOutput = z.infer<typeof TopDecisionsOutputSchema>;

const URGENCY_COLOR: Record<string, string> = {
  critical: "text-red-300",
  today: "text-amber-300",
  this_week: "text-sky-300",
  later: "text-fg-tertiary",
};
// W3b: the raw key (this_week) used to render in capitals; a word map, sentence case, one per known urgency.
const URGENCY_WORD: Record<string, string> = { critical: "Critical", today: "Today", this_week: "This week", later: "Later" };
export function urgencyWord(urgency: string | undefined): string {
  if (!urgency) return "Unranked";
  return URGENCY_WORD[urgency] ?? urgency.replace(/_/g, " ");
}

export function TopDecisionsCard({ output }: { output: TopDecisionsOutput }) {
  const rows = output.decisions ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="mt-1" data-testid="top-decisions-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] font-medium tracking-[0.12em] text-fg-tertiary">
          Decision inbox: top {rows.length}
        </span>
        <span className="text-[11px] text-fg-tertiary">
          {output.totalLive ?? 0} live
          {output.excludedSnoozed ? ` · ${output.excludedSnoozed} snoozed` : ""}
          {output.excludedNoConsent ? ` · ${output.excludedNoConsent} no-consent` : ""}
        </span>
      </div>
      <ol className="space-y-2">
        {rows.map((d, i) => (
          <li key={d.id ?? i} className="rounded-control border border-edge-subtle bg-surface-raised px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`font-mono text-[11px] font-medium tracking-[0.12em] ${URGENCY_COLOR[d.urgency ?? ""] ?? "text-fg-tertiary"}`}>
                {urgencyWord(d.urgency)}
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
      <p className="mt-2 text-[11px] text-fg-tertiary">
        Same read as the admin Decision Inbox. Decide there; this card never mutates.
      </p>
    </div>
  );
}
