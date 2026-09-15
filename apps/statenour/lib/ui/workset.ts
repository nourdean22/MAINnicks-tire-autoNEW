/**
 * Workset · "what am I actively carrying right now" · pure rules ·
 * 2026-09-15 (UI workbench slice 1).
 *
 * Not recents (those are the palette's, cap 8) and not pins (`/pins` is AI
 * prompt context with token cost). A workset entry is an EntityRef the
 * operator pinned for a bounded horizon so it follows them across pages:
 * the inspector footer, the palette's "Workset" group and the shelf all read
 * it. Nothing here is forever — every horizon but `until-resolved` expires,
 * and expiry is a pure function of `now` so it is testable.
 *
 * Persistence is localStorage (`nour:workset:v1`), n=1 operator, the same
 * decision the war-room design made for layout state (D5): no Prisma table
 * for something that is a per-device convenience.
 */

import { formatEntityRef, parseEntityRef, sameEntity, type EntityRef } from "@/lib/ui/entity-ref";

export type WorksetHorizon = "session" | "today" | "week" | "until-resolved";

export const WORKSET_HORIZONS: readonly WorksetHorizon[] = ["session", "today", "week", "until-resolved"];

export interface WorksetEntry {
  ref: EntityRef;
  /** Operator-facing label captured at pin time (the object may rename later). */
  label: string;
  horizon: WorksetHorizon;
  /** Epoch ms. */
  pinnedAt: number;
  /** Epoch ms, or null for `until-resolved`. */
  expiresAt: number | null;
}

/** A shelf wider than this stops being a working set and becomes a list. */
export const WORKSET_CAP = 7;

export const WORKSET_STORAGE_KEY = "nour:workset:v1";

const SESSION_HOURS = 8;

export const HORIZON_LABEL: Record<WorksetHorizon, string> = {
  session: "this session",
  today: "today",
  week: "this week",
  "until-resolved": "until resolved",
};

/**
 * When an entry pinned at `now` expires. Local time on purpose: "today" and
 * "this week" are the operator's day and week, not UTC's. "Week" ends next
 * Monday 06:00, the same soft morning re-entry the task-resurface presets use
 * (components/missions/mission-task-row.tsx `nextMonday6am`).
 */
export function expiryFor(horizon: WorksetHorizon, now: Date): number | null {
  switch (horizon) {
    case "session":
      return now.getTime() + SESSION_HOURS * 60 * 60 * 1000;
    case "today": {
      const d = new Date(now.getTime());
      d.setHours(24, 0, 0, 0);
      return d.getTime();
    }
    case "week": {
      const d = new Date(now.getTime());
      const dow = d.getDay(); // 0 Sun · 1 Mon · …
      const daysUntilNextMon = dow === 1 ? 7 : (8 - dow) % 7 || 7;
      d.setDate(d.getDate() + daysUntilNextMon);
      d.setHours(6, 0, 0, 0);
      return d.getTime();
    }
    case "until-resolved":
      return null;
    default:
      return null;
  }
}

export function isExpired(entry: WorksetEntry, nowMs: number): boolean {
  return entry.expiresAt !== null && entry.expiresAt <= nowMs;
}

export function pruneExpired(entries: readonly WorksetEntry[], nowMs: number): WorksetEntry[] {
  return entries.filter((e) => !isExpired(e, nowMs));
}

/**
 * Add (or re-pin) an entry. Re-pinning the same ref REPLACES it (new label,
 * horizon, time) and moves it to the front. Beyond the cap the OLDEST entries
 * fall off — a workset is what you are carrying now, not a history.
 */
export function addEntry(entries: readonly WorksetEntry[], entry: WorksetEntry): WorksetEntry[] {
  const without = entries.filter((e) => !sameEntity(e.ref, entry.ref));
  const next = [entry, ...without];
  return next.slice(0, WORKSET_CAP);
}

export function removeEntry(entries: readonly WorksetEntry[], ref: EntityRef): WorksetEntry[] {
  return entries.filter((e) => !sameEntity(e.ref, ref));
}

export function hasEntry(entries: readonly WorksetEntry[], ref: EntityRef): boolean {
  return entries.some((e) => sameEntity(e.ref, ref));
}

function isHorizon(value: unknown): value is WorksetHorizon {
  return typeof value === "string" && (WORKSET_HORIZONS as readonly string[]).includes(value);
}

/**
 * Decode stored JSON. Every entry is validated individually and bad ones are
 * dropped, so one corrupt row (or a kind removed from the registry) never
 * empties the shelf.
 */
export function parseWorkset(raw: unknown): WorksetEntry[] {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];
  const out: WorksetEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const ref = parseEntityRef(typeof o.ref === "string" ? o.ref : null);
    if (!ref) continue;
    if (typeof o.label !== "string" || !isHorizon(o.horizon)) continue;
    const pinnedAt = typeof o.pinnedAt === "number" && Number.isFinite(o.pinnedAt) ? o.pinnedAt : null;
    if (pinnedAt === null) continue;
    const expiresAt =
      o.expiresAt === null ? null : typeof o.expiresAt === "number" && Number.isFinite(o.expiresAt) ? o.expiresAt : null;
    if (o.horizon !== "until-resolved" && expiresAt === null) continue;
    out.push({ ref, label: o.label, horizon: o.horizon, pinnedAt, expiresAt });
    if (out.length >= WORKSET_CAP) break;
  }
  return out;
}

export function serializeWorkset(entries: readonly WorksetEntry[]): string {
  return JSON.stringify(
    entries.map((e) => ({
      ref: formatEntityRef(e.ref),
      label: e.label,
      horizon: e.horizon,
      pinnedAt: e.pinnedAt,
      expiresAt: e.expiresAt,
    })),
  );
}

/** "expires in 3h" · "expires tomorrow" · "until resolved" — for the chip tooltip. */
export function describeExpiry(entry: WorksetEntry, nowMs: number): string {
  if (entry.expiresAt === null) return "until resolved";
  const ms = entry.expiresAt - nowMs;
  if (ms <= 0) return "expired";
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 1) return "expires within the hour";
  if (hours < 24) return `expires in ${hours}h`;
  const days = Math.round(hours / 24);
  return `expires in ${days}d`;
}
