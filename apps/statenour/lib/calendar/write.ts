/**
 * Calendar r2 W3 (2026-10-31): the one way bdnick writes to his Google calendar.
 *
 * Nour 2026-10-30: "vice versa from bdnick it will change in google calander so controlls work
 * both ways". Every write goes through his calendar-of-record slot (CALENDAR_ACCOUNT_KEY) and
 * refuses, without calling Google, when that slot is not connected, expired or holds the shop's
 * account. Every write is read back and compared: a mismatch is a failure, never a success.
 * Nothing invites anyone: no attendees, sendUpdates=none (an invite is a send).
 */

import { getAccessToken } from "@/lib/services/google-oauth";
import { resolveCalendarAccount } from "@/lib/calendar/day-events";

export type WriteOp =
  | { kind: "create"; title: string; start: string; end: string; location?: string; description?: string }
  | { kind: "move"; eventId: string; start: string; end: string }
  | { kind: "delete"; eventId: string };

export type WriteResult =
  | { ok: true; kind: WriteOp["kind"]; eventId: string; readBack: "match"; link?: string }
  | {
      ok: false;
      reason: "not_connected" | "shop_account" | "expired" | "invalid_time" | "write_failed" | "read_back_mismatch";
      detail?: string;
      eventId?: string;
    };

export interface WriteDeps {
  account(): Promise<{ state: "ok"; accountKey: string } | { state: "not_connected" | "shop_account" | "expired" }>;
  request(
    accountKey: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; json?: unknown }>;
}

const OPERATOR_TZ = "America/New_York";

interface GEvent {
  id?: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
}

export async function writeCalendarEvent(op: WriteOp, deps: WriteDeps = googleWriteDeps): Promise<WriteResult> {
  let times: { start: Date; end: Date } | null = null;
  if (op.kind !== "delete") {
    const start = parseOperatorDate(op.start);
    const end = parseOperatorDate(op.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      return { ok: false, reason: "invalid_time", detail: "end must be after start" };
    }
    times = { start, end };
  }

  const account = await deps.account();
  if (account.state !== "ok") return { ok: false, reason: account.state };
  const key = account.accountKey;
  const events = "/calendars/primary/events";
  const slot = (d: Date) => ({ dateTime: d.toISOString(), timeZone: OPERATOR_TZ });

  if (op.kind === "create" && times) {
    const body: Record<string, unknown> = { summary: op.title, start: slot(times.start), end: slot(times.end) };
    if (op.location) body.location = op.location;
    if (op.description) body.description = op.description;
    const res = await deps.request(key, "POST", `${events}?sendUpdates=none`, body);
    const made = res.json as GEvent | undefined;
    if (res.status >= 300 || !made?.id) return { ok: false, reason: "write_failed", detail: `Google ${res.status}` };
    const back = await readBack(deps, key, made.id);
    const same = back?.summary === op.title && sameInstant(back.start, times.start) && sameInstant(back.end, times.end);
    return same
      ? { ok: true, kind: "create", eventId: made.id, readBack: "match", link: back?.htmlLink ?? made.htmlLink }
      : { ok: false, reason: "read_back_mismatch", eventId: made.id };
  }

  if (op.kind === "move" && times) {
    const path = `${events}/${encodeURIComponent(op.eventId)}`;
    const res = await deps.request(key, "PATCH", `${path}?sendUpdates=none`, { start: slot(times.start), end: slot(times.end) });
    if (res.status >= 300) return { ok: false, reason: "write_failed", detail: `Google ${res.status}`, eventId: op.eventId };
    const back = await readBack(deps, key, op.eventId);
    const same = sameInstant(back?.start, times.start) && sameInstant(back?.end, times.end);
    return same
      ? { ok: true, kind: "move", eventId: op.eventId, readBack: "match", link: back?.htmlLink }
      : { ok: false, reason: "read_back_mismatch", eventId: op.eventId };
  }

  if (op.kind === "delete") {
    const path = `${events}/${encodeURIComponent(op.eventId)}`;
    const res = await deps.request(key, "DELETE", `${path}?sendUpdates=none`);
    if (res.status >= 300 && res.status !== 410) {
      return { ok: false, reason: "write_failed", detail: `Google ${res.status}`, eventId: op.eventId };
    }
    const back = await deps.request(key, "GET", path);
    const gone = back.status === 404 || back.status === 410 || (back.json as GEvent | undefined)?.status === "cancelled";
    return gone
      ? { ok: true, kind: "delete", eventId: op.eventId, readBack: "match" }
      : { ok: false, reason: "read_back_mismatch", eventId: op.eventId };
  }

  return { ok: false, reason: "invalid_time" };
}

async function readBack(deps: WriteDeps, accountKey: string, eventId: string): Promise<GEvent | null> {
  const res = await deps.request(accountKey, "GET", `/calendars/primary/events/${encodeURIComponent(eventId)}`);
  return res.status < 300 ? ((res.json as GEvent | undefined) ?? null) : null;
}

function sameInstant(slot: GEvent["start"] | undefined, want: Date): boolean {
  const at = slot?.dateTime ? new Date(slot.dateTime).getTime() : NaN;
  return at === want.getTime();
}

// forensic-audit HIGH (moved from calendar-api.ts) · the operator's calendar zone. A time with no
// zone ("block 2pm") is his Eastern wall time, not the server's UTC.
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

export function parseOperatorDate(iso: string): Date {
  const s = iso.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  if (hasZone) return new Date(s); // explicit offset → unambiguous instant
  const asUtc = new Date(s.endsWith("Z") ? s : s + "Z"); // naive components as UTC
  if (isNaN(asUtc.getTime())) return asUtc;
  const offMin = operatorTzOffsetMinutes(asUtc);
  return new Date(asUtc.getTime() - offMin * 60000);
}

// ── Live Google wiring (default deps) ─────────────────────────────────────────────────────

const GCAL = "https://www.googleapis.com/calendar/v3";

const googleWriteDeps: WriteDeps = {
  account: resolveCalendarAccount,
  async request(accountKey, method, path, body) {
    const token = await getAccessToken(accountKey);
    const res = await fetch(`${GCAL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text().catch(() => "");
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  },
};
