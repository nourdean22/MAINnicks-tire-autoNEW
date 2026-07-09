/**
 * /remind time-expression parser · AG-41 (2026-07-09)
 *
 * Deterministic, pure, ET-anchored. "remind me at 3pm" must mean 3pm
 * in the operator's world (America/New_York), not 3pm UTC on Railway —
 * same bug class the calendar proposeCalendarEvent path fixed with
 * parseOperatorDate. No LLM call: reminders are a trust surface and a
 * misparsed time is worse than a rejected one.
 *
 * Supported (case-insensitive, leading match):
 *   in 30 min / in 2h / in 2 hours / in 3 days
 *   at 3pm / at 15:30 / at 9:15am        (today ET; past → tomorrow)
 *   tomorrow / tomorrow 9am / tomorrow 14:00   (default 9am ET)
 *
 * Returns { at, text } or null when no expression matches (caller
 * shows usage — never guesses).
 */

const OPERATOR_TZ = "America/New_York";

function operatorTzOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATOR_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour === 24 ? 0 : +m.hour, +m.minute, +m.second);
  return (asUTC - instant.getTime()) / 60000;
}

/** The wall-clock date components in ET for an instant. */
function etParts(instant: Date): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATOR_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(instant);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return { y: +m.year, mo: +m.month, d: +m.day, h: +m.hour === 24 ? 0 : +m.hour, mi: +m.minute };
}

/** Instant for a given ET wall-clock (DST-correct via the offset at
 *  that approximate instant). */
function etWallClockToInstant(y: number, mo: number, d: number, h: number, mi: number): Date {
  const naive = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const offMin = operatorTzOffsetMinutes(naive);
  return new Date(naive.getTime() - offMin * 60000);
}

export interface ParsedReminder {
  at: Date;
  text: string;
}

const RE_IN = /^in\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b\s*/i;
const RE_AT = /^at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b\s*/i;
const RE_TOMORROW = /^tomorrow\b(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b)?\s*/i;

function resolveHour(hRaw: number, ampm?: string): number | null {
  if (ampm) {
    if (hRaw < 1 || hRaw > 12) return null;
    const base = hRaw % 12;
    return ampm.toLowerCase() === "pm" ? base + 12 : base;
  }
  return hRaw >= 0 && hRaw <= 23 ? hRaw : null;
}

export function parseRemindTime(input: string, now: Date = new Date()): ParsedReminder | null {
  const s = input.trim();

  const inM = RE_IN.exec(s);
  if (inM) {
    const n = parseInt(inM[1], 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = inM[2].toLowerCase();
    const ms = unit.startsWith("m") ? n * 60_000 : unit.startsWith("h") ? n * 3600_000 : n * 86_400_000;
    const text = s.slice(inM[0].length).trim();
    if (!text) return null;
    return { at: new Date(now.getTime() + ms), text };
  }

  const atM = RE_AT.exec(s);
  if (atM) {
    const h = resolveHour(parseInt(atM[1], 10), atM[3]);
    const mi = atM[2] ? parseInt(atM[2], 10) : 0;
    if (h === null || mi > 59) return null;
    const text = s.slice(atM[0].length).trim();
    if (!text) return null;
    const p = etParts(now);
    let at = etWallClockToInstant(p.y, p.mo, p.d, h, mi);
    if (at.getTime() <= now.getTime()) {
      // past today-ET → same wall-clock tomorrow
      at = new Date(at.getTime() + 86_400_000);
    }
    return { at, text };
  }

  const tmrM = RE_TOMORROW.exec(s);
  if (tmrM) {
    const h = tmrM[1] ? resolveHour(parseInt(tmrM[1], 10), tmrM[3]) : 9;
    const mi = tmrM[2] ? parseInt(tmrM[2], 10) : 0;
    if (h === null || mi > 59) return null;
    const text = s.slice(tmrM[0].length).trim();
    if (!text) return null;
    const p = etParts(now);
    const todayAt = etWallClockToInstant(p.y, p.mo, p.d, h, mi);
    return { at: new Date(todayAt.getTime() + 86_400_000), text };
  }

  return null;
}
