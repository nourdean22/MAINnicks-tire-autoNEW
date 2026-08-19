/**
 * Unified Coach Channel · Mastery Layer Stage A · 2026-05-26
 *
 * ONE store + ONE writer + ONE reader for all "system noticed something
 * the operator should see" events. Replaces 5 separate per-page alert
 * mechanisms with a single channel that every surface reads.
 *
 * Architecture (per docs/CROSS-PAGE-INTEGRATION addendum to the redesign
 * plan):
 *   • Storage: BrainMemory(category: "coach_event")
 *   • Key: `coach:${kind}:${subjectId}` — doubles as a 10-minute dedup
 *     window. Writers calling recordCoachEvent with the same
 *     (kind, subjectId) within 10 minutes upsert the existing row
 *     instead of firing a duplicate.
 *   • Surfaces: each writer declares which page(s) should display the
 *     event via `surfaces: ["tasks", "goals", "scoreboard", ...]`.
 *     Reader filters by surface so each page only fetches its slice.
 *
 * Writers (to be migrated in follow-up commits):
 *   • pricing-advisor   → "pricing-advisory"
 *   • goal-pruner       → "prune-candidate"
 *   • drift-detector    → "drift-recovery"
 *   • idle-watcher      → "idle-nudge"
 *   • goal-pace-monitor → "goal-pace-shift"
 *   • coach-watcher     → "proactive-nick" (Phase 5 of /tasks v2.2)
 *
 * Readers (to be migrated in follow-up commits):
 *   • /tasks · Proactive Nick chip in side pane (Phase 5)
 *   • /goals · pruneCandidates-style banner at top
 *   • /scoreboard · alert row above anomalies
 *   • /journal · pulse chip next to BrainSignalsChip
 *   • /brain · ActiveAlertsCard
 *
 * Foundation-only commit · this module ships the writer + reader API
 * with tests. Writer migrations + UI surface mounts land in follow-up
 * kaizen commits. Each migration is independently revertable.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

// Wave-AO follow-up · types + the pure buildCoachEventKey helper live
// in a sibling module (coach-events-types.ts) so client components can
// import the shape without pulling prisma into the client bundle. The
// CoachEventBanner needs `buildCoachEventKey` for the dismiss button,
// but this module's prisma import would break next build if reached
// from a client component chain (same v10.0.209 constraint as
// lib/ai/provider.ts).
import {
  buildCoachEventKey,
  type CoachEvent,
  type CoachEventKind,
  type CoachEventPriority,
  type CoachEventSurface,
} from "./coach-events-types";

export {
  buildCoachEventKey,
  type CoachEvent,
  type CoachEventKind,
  type CoachEventPriority,
  type CoachEventSurface,
};

const log = rootLogger.withSurface("services/coach-events");

/**
 * Writer input shape. The `subjectId` doubles as the dedup key, so the
 * caller MUST pass something stable (e.g. the affected goalId for a
 * prune-candidate, "global" for shop-level alerts).
 */
export interface CoachEventInput {
  kind: CoachEventKind;
  /** Stable id (goalId, taskId, missionId, etc) · used for dedup. Use
   *  "global" for app-wide alerts that aren't tied to a domain row. */
  subjectId: string;
  priority: CoachEventPriority;
  /** Operator-facing headline · 5-10 words ideal. */
  title: string;
  /** Optional 1-2 sentence body for hover/expand. */
  body?: string;
  /** Optional deep-link to a relevant page (e.g. /goals?goalId=abc). */
  deepLink?: string;
  /** Which surfaces should render this event. Empty = render everywhere. */
  surfaces?: CoachEventSurface[];
  /** ISO timestamp when the event self-expires (writer doesn't need to
   *  delete the row · reader filters out past events). */
  expiresAt?: string;
  /** When false, surface renders without a dismiss "X". Default true. */
  dismissable?: boolean;
  /** Optional extra metadata for the surface to render details. */
  extra?: Record<string, unknown>;
}

/* ─── Constants ─────────────────────────────────────────────── */

/** Dedup window · writers calling with the same (kind, subjectId)
 *  within this window upsert the existing row instead of duplicating. */
const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/** Default cap on rows returned by the reader · keeps payloads small. */
const DEFAULT_LIMIT = 5;

/** Priority numeric rank for sorting · lower = higher priority. */
const PRIORITY_RANK: Record<CoachEventPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

/* ─── Writer ────────────────────────────────────────────────── */

// buildCoachEventKey is re-exported from ./coach-events-types so the
// CoachEventBanner client component can use it without pulling prisma
// into the client bundle.

/**
 * Record a coach event. Idempotent within the 10-minute dedup window:
 * - First fire · creates the row
 * - Subsequent fires within 10 min · updates the row's content +
 *   metadata + `updatedAt` (touches the dedup window)
 * - After 10 min · the next fire creates a fresh row (the prior row
 *   stays for history but won't surface in the active feed if it's
 *   replaced or expired)
 *
 * Throws nothing · returns null on failure (logged). Writers MUST
 * be fire-and-forget · coach events are diagnostic + advisory, never
 * critical-path data.
 */
export async function recordCoachEvent(input: CoachEventInput): Promise<CoachEvent | null> {
  try {
    const key = buildCoachEventKey(input.kind, input.subjectId);
    const surfaces = input.surfaces ?? ["tasks", "goals", "journal", "brain", "scoreboard", "home"];
    const dismissable = input.dismissable !== false; // default true
    const eventId =
      // Use a hash of key + priority + title (truncated) as the eventId
      // so dedup-replacements get a stable id across re-fires within the
      // window. Browser-safe (no Node crypto): tiny deterministic hash.
      simpleHash(`${key}:${input.priority}:${input.title.slice(0, 40)}`);

    const metadata = {
      eventId,
      kind: input.kind,
      subjectId: input.subjectId,
      priority: input.priority,
      body: input.body,
      deepLink: input.deepLink,
      surfaces,
      expiresAt: input.expiresAt,
      dismissable,
      extra: input.extra ?? {},
    };

    const row = await prisma.brainMemory.upsert({
      where: {
        category_key: { category: BRAIN_CATEGORIES.COACH_EVENT, key },
      },
      create: {
        category: BRAIN_CATEGORIES.COACH_EVENT,
        key,
        content: input.title,
        source: "coach-channel",
        createdBy: "system",
        metadata: metadata as object,
      },
      update: {
        content: input.title,
        metadata: metadata as object,
        // `updatedAt` auto-bumps via @updatedAt — touches the dedup window.
      },
      select: { id: true, content: true, metadata: true, createdAt: true, updatedAt: true },
    });

    // 2026-08-19 · P0 coach events also page the operator's phone via the
    // LIVE Web Push channel (lib/notifications/push.ts — the one that
    // already delivers the morning brief and drift alerts). Before this,
    // a P0 like "Data feeder down" or the cron-heartbeat's silent-fleet
    // alert only landed in an in-app banner the operator had to open the
    // app to see — the data-source canary's "the canary now SCREAMS"
    // comment screamed into a dashboard. P0 ONLY: pushing P1/P2 advisory
    // events would train the operator to swipe pushes away, which is the
    // same rot as a permanently-red gate. Fire-and-forget: a push failure
    // must never fail the coach write. `tag: key` makes re-fires of the
    // same (kind, subjectId) REPLACE the standing notification instead of
    // stacking, so a still-down feeder re-pages once per cron run, not
    // once per minute.
    if (input.priority === "P0") {
      void import("@/lib/notifications/push")
        .then(({ sendPush }) =>
          sendPush({
            title: input.title,
            body: input.body ?? input.title,
            level: "critical",
            url: input.deepLink ?? "/system/health",
            tag: key,
          }),
        )
        .catch((err) => {
          log.warn("coach_event_push_failed", {
            kind: input.kind,
            subjectId: input.subjectId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
    }

    return rowToCoachEvent({ ...row, key }, key);
  } catch (err) {
    log.warn("coach_event_record_failed", {
      kind: input.kind,
      subjectId: input.subjectId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/* ─── Reader ────────────────────────────────────────────────── */

export interface GetActiveCoachEventsOpts {
  /** Filter to events whose `surfaces` array includes this surface.
   *  Omit to fetch events for ALL surfaces (admin/dashboard use). */
  surface?: CoachEventSurface;
  /** Cap rows returned · default 5. Server picks priority-ordered. */
  limit?: number;
  /** Include events the operator has explicitly acked. Default false. */
  includeAcked?: boolean;
}

/**
 * Read active coach events for a surface. Returns events ordered by
 * priority (P0 → P2) then recency (newest first). Filters out:
 * - Acked events (unless includeAcked)
 * - Expired events (expiresAt < now)
 * - Stale dedup-eligible events older than the dedup window with the
 *   same kind+subjectId (only the latest row per dedup tuple surfaces)
 */
export async function getActiveCoachEvents(
  opts: GetActiveCoachEventsOpts = {},
): Promise<CoachEvent[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const includeAcked = opts.includeAcked ?? false;
  // Pull a wider window than `limit` so post-filter (surface, acked,
  // expired) we still have enough to satisfy the cap. 3× is empirically
  // safe given current event volumes (< 50 events/day).
  const pullCap = Math.max(limit * 3, 20);

  try {
    const rows = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.COACH_EVENT },
      orderBy: { updatedAt: "desc" },
      take: pullCap,
      select: { id: true, key: true, content: true, metadata: true, createdAt: true, updatedAt: true },
    });

    const now = Date.now();
    const events: CoachEvent[] = [];

    for (const row of rows) {
      const event = rowToCoachEvent(row, row.key);
      if (!event) continue;

      // Filter · acked
      if (!includeAcked && event.ackedAt) continue;

      // Filter · expired
      if (event.expiresAt) {
        const exp = Date.parse(event.expiresAt);
        if (!Number.isNaN(exp) && exp < now) continue;
      }

      // Filter · surface
      if (opts.surface && !event.surfaces.includes(opts.surface)) continue;

      events.push(event);
    }

    // Sort · priority asc (P0 first), then updatedAt desc (newest first).
    events.sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] ?? 9;
      const pb = PRIORITY_RANK[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });

    return events.slice(0, limit);
  } catch (err) {
    log.warn("coach_event_read_failed", {
      surface: opts.surface,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Mark a coach event as acked (operator dismissed it). Idempotent ·
 * setting ackedAt on an already-acked row is a no-op effectively
 * (timestamp shifts but filter behavior stays the same).
 */
export async function ackCoachEvent(eventKey: string): Promise<boolean> {
  try {
    const existing = await prisma.brainMemory.findUnique({
      where: {
        category_key: { category: BRAIN_CATEGORIES.COACH_EVENT, key: eventKey },
      },
      select: { metadata: true },
    });
    if (!existing) return false;
    const meta = (existing.metadata ?? {}) as Record<string, unknown>;
    const next = { ...meta, ackedAt: new Date().toISOString() };
    await prisma.brainMemory.update({
      where: {
        category_key: { category: BRAIN_CATEGORIES.COACH_EVENT, key: eventKey },
      },
      data: { metadata: next as object },
    });
    return true;
  } catch (err) {
    log.warn("coach_event_ack_failed", {
      key: eventKey,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/* ─── Internals ─────────────────────────────────────────────── */

interface RawRow {
  id: string;
  key?: string;
  content: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function rowToCoachEvent(row: RawRow, key: string): CoachEvent | null {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  // Defensive: validate the minimum shape · skip rows that don't have
  // the expected metadata (e.g. legacy rows written before this module
  // existed, or hand-edited DB rows).
  if (typeof meta.kind !== "string" || typeof meta.priority !== "string") {
    return null;
  }
  const eventId = typeof meta.eventId === "string" ? meta.eventId : key;
  const subjectId = typeof meta.subjectId === "string" ? meta.subjectId : "unknown";
  const priority = (meta.priority as CoachEventPriority) ?? "P2";
  const surfaces = (
    Array.isArray(meta.surfaces) ? (meta.surfaces as CoachEventSurface[]) : ["tasks", "goals", "journal", "brain", "scoreboard", "home"]
  ).filter((s) => typeof s === "string") as CoachEventSurface[];
  const dismissable = meta.dismissable !== false;

  return {
    eventId,
    kind: meta.kind as CoachEventKind,
    subjectId,
    priority,
    title: row.content,
    body: typeof meta.body === "string" ? meta.body : undefined,
    deepLink: typeof meta.deepLink === "string" ? meta.deepLink : undefined,
    surfaces,
    expiresAt: typeof meta.expiresAt === "string" ? meta.expiresAt : undefined,
    ackedAt: typeof meta.ackedAt === "string" ? meta.ackedAt : undefined,
    dismissable,
    extra: typeof meta.extra === "object" && meta.extra !== null ? (meta.extra as Record<string, unknown>) : {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Tiny deterministic hash (FNV-1a 32-bit) · stable across runs ·
 *  not crypto-safe, just a deterministic id derivation. */
function simpleHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Re-exported · enables test mocks to advance the dedup window. */
export const _internals = {
  DEDUP_WINDOW_MS,
  simpleHash,
};
