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
  // A string, not an enum: a newer server's state must not hide every row on an older cached client.
  state: z.string(),
  ageH: z.nullable(z.number()),
});

export const FleetTruthOutputSchema = z.object({
  ok: z.optional(z.boolean()),
  generatedAt: z.optional(z.string()),
  // Required, as the producer always sends them: a renamed key then fails the guard below and the parse.
  statenour: z.array(FleetArtifact),
  nickstire: z.array(FleetArtifact),
  allFresh: z.boolean(),
  queuesClean: z.optional(z.boolean()),
});
export type FleetTruthOutput = z.infer<typeof FleetTruthOutputSchema>;

/** Never called: tsc fails here when the producer's FleetTruth drifts from the schema (a renamed or retyped key). */
export const fleetTruthFitsSchema = (t: FleetTruth): z.input<typeof FleetTruthOutputSchema> => t;

const STATE_COLOR: Record<string, string> = {
  fresh: "text-emerald-300",
  stale: "text-amber-300",
  never_produced: "text-red-300",
  unknown: "text-fg-tertiary",
};

export function fleetRows(output: FleetTruthOutput) {
  return [
    ...output.statenour.map((a) => ({ ...a, app: "statenour" })),
    ...output.nickstire.map((a) => ({ ...a, app: "nickstire" })),
  ];
}

/** Fresh only when every capability is fresh AND no durable queue holds a dead row. */
export function fleetAllClear(output: FleetTruthOutput): boolean {
  return output.allFresh && output.queuesClean !== false;
}

export function FleetTruthCard({ output }: { output: FleetTruthOutput }) {
  const rows = fleetRows(output);
  const clear = fleetAllClear(output);
  if (rows.length === 0) return null;
  return (
    <div className="mt-1" data-testid="fleet-truth-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] font-medium tracking-[0.12em] text-fg-tertiary">
          Fleet truth
        </span>
        <span
          className={`text-[11px] font-semibold ${clear ? "text-emerald-300" : "text-amber-300"}`}
        >
          {clear ? "all fresh" : output.allFresh ? "dead queue rows" : "attention needed"}
        </span>
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={`${r.app}:${r.capability}`} className="flex items-center justify-between text-[11px]">
            <span className="font-mono text-fg-tertiary">
              {r.app === "nickstire" && !r.capability.startsWith("nickstire") ? `nickstire:${r.capability}` : r.capability}
            </span>
            <span className={STATE_COLOR[r.state] ?? "text-fg-tertiary"}>
              {r.state.replace(/_/g, " ")}
              {r.ageH != null ? ` · ${r.ageH}h` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The bridge reaches this app untyped. Producer: apps/nickstire/server/services/opportunityQueue.ts
// mapRow (id is String(r.id), a uuid; shared/bridgeShapes.ts says number and is wrong). Kept loose.
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

// ─── W6 PR 2 · the six reads /now needs (tasks, missions, commitments, people, calendar, habits) ───
// Loose on purpose: only the fields a row draws are required, so a new producer field never hides a card.

const DateText = z.optional(z.nullable(z.string()));

export const TasksOutputSchema = z.array(
  z.object({ title: z.string(), status: z.optional(z.string()), dueDate: DateText, mission: z.optional(z.nullable(z.object({ title: z.string() }))) }),
);
export const MissionsOutputSchema = z.array(z.object({ title: z.string(), domain: z.optional(z.nullable(z.string())) }));
export const CommitmentsOutputSchema = z.array(
  z.object({ description: z.string(), toWhom: z.optional(z.nullable(z.string())), deadline: DateText }),
);
export const RelationshipPicksOutputSchema = z.object({
  picks: z.array(z.object({ name: z.string(), why: z.optional(z.nullable(z.string())), daysQuiet: z.optional(z.nullable(z.number())) })),
});
// ok:false (not connected, grant expired) never reaches this: ToolResultCard reads it as a soft failure first.
export const ScheduleOutputSchema = z.object({
  count: z.optional(z.number()),
  events: z.array(z.object({ summary: z.string(), start: z.optional(z.nullable(z.string())), allDay: z.optional(z.boolean()), location: z.optional(z.nullable(z.string())) })),
});
export const HabitStreaksOutputSchema = z.record(z.string(), z.object({ completed: z.number(), total: z.number() }));

export interface IntentRow {
  primary: string;
  secondary?: string | null;
}

const ROW_CAP = 5;
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const etTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
};
const joinParts = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" · ") || null;

/** Each read's parsed output as rows: the one body all six share. */
export const INTENT_ROWS = {
  getTasks: (o: z.infer<typeof TasksOutputSchema>): IntentRow[] =>
    o.map((t) => ({ primary: t.title, secondary: joinParts(t.mission?.title, t.dueDate ? `due ${day(t.dueDate)}` : null) })),
  getMissions: (o: z.infer<typeof MissionsOutputSchema>): IntentRow[] => o.map((m) => ({ primary: m.title, secondary: m.domain?.toLowerCase() ?? null })),
  getCommitments: (o: z.infer<typeof CommitmentsOutputSchema>): IntentRow[] =>
    o.map((c) => ({ primary: c.description, secondary: joinParts(c.toWhom && c.toWhom !== "self" ? `to ${c.toWhom}` : null, c.deadline ? `due ${day(c.deadline)}` : null) })),
  getRelationshipPicks: (o: z.infer<typeof RelationshipPicksOutputSchema>): IntentRow[] =>
    o.picks.map((p) => ({ primary: p.name, secondary: p.why ?? (p.daysQuiet != null ? `${p.daysQuiet} days quiet` : null) })),
  getTodaySchedule: (o: z.infer<typeof ScheduleOutputSchema>): IntentRow[] =>
    o.events.map((e) => ({ primary: e.summary, secondary: joinParts(e.allDay ? "all day" : e.start ? etTime(e.start) : null, e.location) })),
  getHabitStreaks: (o: z.infer<typeof HabitStreaksOutputSchema>): IntentRow[] =>
    Object.entries(o).map(([title, s]) => ({ primary: title, secondary: `${s.completed} of ${s.total} days` })),
};

export function IntentRows({ tool, rows }: { tool: string; rows: IntentRow[] }) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, ROW_CAP);
  return (
    <ul className="mt-1 space-y-1.5" data-testid={`intent-rows-${tool}`}>
      {shown.map((r, i) => (
        <li key={`${r.primary}-${i}`} className="text-[12.5px] leading-snug">
          <span className="text-fg">{r.primary}</span>
          {r.secondary ? <span className="block text-[11.5px] text-fg-tertiary">{r.secondary}</span> : null}
        </li>
      ))}
      {rows.length > ROW_CAP && <li className="text-[11.5px] text-fg-tertiary">{rows.length - ROW_CAP} more</li>}
    </ul>
  );
}
