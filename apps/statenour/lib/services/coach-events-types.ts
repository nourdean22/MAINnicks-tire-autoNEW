/**
 * Coach Channel · client-safe types + pure helpers.
 *
 * The main `coach-events.ts` module imports prisma · cannot be pulled
 * into the client bundle without breaking next build (prisma →
 * @next/env → fs). This sibling exports JUST the types + the pure
 * key-builder so client components (CoachEventBanner) can import
 * shape definitions without dragging prisma along.
 *
 * Server callers should import from `coach-events.ts` directly — they
 * get these types AND the writer/reader functions in one import.
 * `coach-events.ts` re-exports everything below.
 */

/**
 * Closed set of event kinds. Adding a new kind requires updating both
 * this union AND a writer that fires it. Closed set = the dashboard
 * + filter UIs can enumerate without round-tripping the DB.
 */
export type CoachEventKind =
  | "pricing-advisory"
  | "prune-candidate"
  | "drift-recovery"
  | "idle-nudge"
  | "goal-pace-shift"
  | "mission-deadline-check"
  | "proactive-nick"
  | "anomaly"
  | "system-alert";

/** Priority tiers · sorted top-of-feed. */
export type CoachEventPriority = "P0" | "P1" | "P2";

/** Surfaces that read coach events. Closed set · matches the 5 daily-driver pages. */
export type CoachEventSurface = "tasks" | "goals" | "journal" | "brain" | "scoreboard" | "home";

/** Reader output shape · what each surface gets back. */
export interface CoachEvent {
  eventId: string;
  kind: CoachEventKind;
  subjectId: string;
  priority: CoachEventPriority;
  title: string;
  body?: string;
  deepLink?: string;
  surfaces: CoachEventSurface[];
  expiresAt?: string;
  ackedAt?: string;
  dismissable: boolean;
  extra: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Build the BrainMemory key for a coach event. Pure · client-safe.
 * Both the writer and the dismiss-UI button need this to be deterministic.
 */
export function buildCoachEventKey(kind: CoachEventKind, subjectId: string): string {
  return `coach:${kind}:${subjectId}`;
}
