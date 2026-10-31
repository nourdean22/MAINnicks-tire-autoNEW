/**
 * lib/home/pulse-feed.ts · the Pulse sheet's read model (home-pulse W3, 2026-10-31).
 *
 * One feed: the coach channel (lib/services/coach-events.ts), which is already the single store for
 * "the system noticed something". Grouped by where it comes from, most urgent group first. Client-safe:
 * types and the pure key builder only, no prisma.
 */
import { buildCoachEventKey, type CoachEvent, type CoachEventKind, type CoachEventPriority } from "@/lib/services/coach-events-types";

export type PulseSource = "system" | "goals" | "habits" | "nick" | "held";

/** Tie-break order for groups whose most urgent items are equally urgent. */
export const PULSE_SOURCE_ORDER: readonly PulseSource[] = ["system", "goals", "habits", "nick", "held"];

export const PULSE_SOURCE_LABEL: Record<PulseSource, string> = {
  system: "System",
  goals: "Goals",
  habits: "Habits",
  nick: "Nick",
  held: "Held for later",
};

const SOURCE_OF: Record<CoachEventKind, PulseSource> = {
  "system-alert": "system",
  anomaly: "system",
  "prune-candidate": "goals",
  "goal-pace-shift": "goals",
  "mission-deadline-check": "goals",
  "drift-recovery": "habits",
  "idle-nudge": "habits",
  "proactive-nick": "nick",
  "held-notification": "held",
};

const RANK: Record<CoachEventPriority, number> = { P0: 0, P1: 1, P2: 2 };

export interface PulseItem {
  key: string;
  title: string;
  whyNow: string | null;
  href: string | null;
  level: CoachEventPriority;
  updatedAt: string;
}

export interface PulseGroup {
  source: PulseSource;
  items: PulseItem[];
}

export interface PulseFeed {
  total: number;
  groups: PulseGroup[];
}

/** Pure: active coach events to the sheet's groups. Items within a group: most urgent, then newest. */
export function pulseFeedFrom(events: readonly CoachEvent[]): PulseFeed {
  const bySource = new Map<PulseSource, CoachEvent[]>();
  for (const e of events) {
    const source = SOURCE_OF[e.kind] ?? "system";
    bySource.set(source, [...(bySource.get(source) ?? []), e]);
  }
  const byUrgency = (a: CoachEvent, b: CoachEvent) =>
    RANK[a.priority] - RANK[b.priority] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

  const groups = [...bySource.entries()].map(([source, list]) => {
    const sorted = [...list].sort(byUrgency);
    return {
      source,
      top: RANK[sorted[0].priority],
      items: sorted.map((e) => ({
        key: buildCoachEventKey(e.kind, e.subjectId),
        title: e.title,
        whyNow: e.body ?? null,
        href: e.deepLink ?? null,
        level: e.priority,
        updatedAt: e.updatedAt,
      })),
    };
  });
  groups.sort((a, b) => a.top - b.top || PULSE_SOURCE_ORDER.indexOf(a.source) - PULSE_SOURCE_ORDER.indexOf(b.source));

  return { total: events.length, groups: groups.map(({ source, items }) => ({ source, items })) };
}
