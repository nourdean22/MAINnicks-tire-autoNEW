/**
 * Obligation mirror · ADR-0020 phase 1 (Q-22), SHADOW ONLY.
 *
 * `customer_promises` becomes the one index of what the shop owes a customer.
 * The operational stores stay authoritative for their own work; this reconciler
 * READS them and writes exactly one ledger row per open item:
 *
 *   callback_requests  status 'new'           -> source_kind 'callback_request', promise_type 'callback'
 *   sms_response_jobs  status 'human_pending' -> source_kind 'owed_reply',       promise_type 'reply'
 *   emergency_requests status 'new'           -> source_kind 'emergency',        promise_type 'emergency_response'
 *
 * WHAT IT NEVER DOES. It changes no source row, sends nothing to a customer or
 * the operator, and raises no Decision Inbox item: promiseLedger leaves every
 * MIRROR_SOURCE_KINDS row out of the sweep, the open list and the kept-rate
 * until phase 2/3 lift that per reader. OFF (`obligation_mirror_enabled`, the
 * default) touches no table at all.
 *
 * IDEMPOTENT BY THE INDEX, NOT BY A READ. The pre-read of existing keys only
 * saves writes; `uq_promise_source (source_kind, source_id, promise_type)`
 * (0125) is what makes a concurrent second run write nothing, and its
 * duplicate-key rejection is counted as "already mirrored".
 *
 * CLOSES ON AN OUTCOME, NEVER ON AN ATTEMPT (ADR §5). A person-set callback
 * 'no-answer' or a failed staff send leaves the obligation open.
 */
import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger";
import { isDuplicateKeyError, isMissingTableError } from "../lib/dbErrors";
import { nextCloseAt, nextOpenAt } from "@shared/shopState";
import type { MirrorSourceKind, PromiseType } from "./promiseLedger";

const log = createLogger("obligation-mirror");

/** A source row older than this is counted, never mirrored (ADR §4 rule 3). */
const MIRROR_WINDOW_DAYS = 7;
/** Rows examined per kind per run; the report says when a kind has more. */
const PAGE = 500;
const CALLBACK_WINDOW_MS = 2 * 60 * 60_000;
const EMERGENCY_WINDOW_MS = 30 * 60_000;
const MIRROR_OWNER = "Front Counter";
const MIRROR_CREATED_BY = "obligation-mirror";
/** hygiene's close marker, dbCleanup.ts: the one no-answer that is not a person's attempt. */
const STALE_CLOSE_MARKER = "[SYSTEM: Closed as stale]";

// ─── Pure: due times ─────────────────────────────────────────────────────────

/**
 * When a response to a request is owed. Created while open: the earlier of
 * `createdAt + window` and that day's close. Created while closed: the next
 * opening plus the window. Null when the configured hours yield no instant; the
 * caller writes nothing then, because an invented deadline manufactures a
 * breach the shop never agreed to (the same refusal as createVoicePromise).
 */
export function responseDueAt(
  createdAt: Date,
  windowMs: number,
  timezone: string,
  hours: Record<string, string>,
): Date | null {
  const openAt = nextOpenAt(createdAt, timezone, hours);
  if (!openAt) return null;
  if (openAt.getTime() > createdAt.getTime()) return new Date(openAt.getTime() + windowMs);
  const closeAt = nextCloseAt(createdAt, timezone, hours);
  if (!closeAt) return null;
  return new Date(Math.min(createdAt.getTime() + windowMs, closeAt.getTime()));
}

/**
 * The Vapi call id a voice-captured callback row carries in `context`. Both
 * voice writers (`escalate`, `scheduleCallback` in routers/voiceAgent.ts) put it
 * right after the bracketed tag; nothing else links the row to its call.
 * A stopgap with a pinned test (ADR §4 rule 2) until a column replaces it.
 */
export function voiceCallIdFromContext(context: string | null | undefined): string | null {
  if (!context) return null;
  const m = /^\[VOICE-AGENT[^\]]*\] callId=(\S+)/.exec(context);
  return m ? m[1] : null;
}

// ─── Pure: source row -> ledger insert ───────────────────────────────────────

export interface MirrorInsert {
  sourceKind: MirrorSourceKind;
  sourceId: string;
  promiseType: PromiseType;
  customerName: string | null;
  customerPhone: string | null;
  promisedAction: string;
  dueAt: Date;
}

export interface CallbackSource {
  id: number;
  name: string;
  phone: string;
  context: string | null;
  status: string;
  calledAt: Date | null;
  calledBy: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface OwedReplySource {
  id: number;
  customerPhone: string;
  body: string;
  status: string;
  dueAt: Date;
  createdAt: Date;
}

export interface EmergencySource {
  id: number;
  name: string;
  phone: string;
  problem: string | null;
  status: string | null;
  createdAt: Date | null;
}

type Hours = { timezone: string; hours: Record<string, string> };

const valid = (d: Date | null): d is Date => d != null && Number.isFinite(d.getTime());

export function mapCallback(src: CallbackSource, h: Hours): MirrorInsert | null {
  if (!valid(src.createdAt)) return null;
  const dueAt = responseDueAt(src.createdAt, CALLBACK_WINDOW_MS, h.timezone, h.hours);
  if (!dueAt) return null;
  return {
    sourceKind: "callback_request",
    sourceId: String(src.id),
    promiseType: "callback",
    customerName: src.name || null,
    customerPhone: src.phone || null,
    promisedAction: `Call ${src.name || "the customer"} back${src.context ? ` about: ${src.context}` : ""}`.slice(0, 500),
    dueAt,
  };
}

/** The SLA clock is the job's own `dueAt`: the ledger never starts a second one. */
export function mapOwedReply(src: OwedReplySource): MirrorInsert | null {
  if (!valid(src.dueAt)) return null;
  const excerpt = src.body.replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    sourceKind: "owed_reply",
    sourceId: String(src.id),
    promiseType: "reply",
    customerName: null,
    customerPhone: src.customerPhone || null,
    promisedAction: `Reply to the customer's text${excerpt ? `: "${excerpt}"` : ""}`,
    dueAt: src.dueAt,
  };
}

function mapEmergency(src: EmergencySource, h: Hours): MirrorInsert | null {
  if (!valid(src.createdAt)) return null;
  const dueAt = responseDueAt(src.createdAt, EMERGENCY_WINDOW_MS, h.timezone, h.hours);
  if (!dueAt) return null;
  return {
    sourceKind: "emergency",
    sourceId: String(src.id),
    promiseType: "emergency_response",
    customerName: src.name || null,
    customerPhone: src.phone || null,
    promisedAction: `Respond to ${src.name || "the customer"}'s emergency request${src.problem ? `: ${src.problem}` : ""}`.slice(0, 500),
    dueAt,
  };
}

// ─── Pure: source state -> ledger transition ─────────────────────────────────

/** null = the obligation is still open. */
export type Closure = { to: "kept" | "cancelled"; evidence: string } | null;

const GONE: Closure = { to: "cancelled", evidence: "source row no longer exists" };

export function closeCallback(src: CallbackSource | undefined): Closure {
  if (!src) return GONE;
  if (src.status === "called" || src.status === "completed") {
    const at = src.calledAt ? ` at ${src.calledAt.toISOString().slice(0, 16).replace("T", " ")}Z` : "";
    return { to: "kept", evidence: `callback #${src.id} ${src.status} by ${src.calledBy || "unknown"}${at}`.slice(0, 280) };
  }
  // Hygiene closing a stale row is the system giving up, not a call placed.
  if (src.status === "no-answer" && src.notes?.includes(STALE_CLOSE_MARKER)) {
    return { to: "cancelled", evidence: "closed as stale by hygiene" };
  }
  // 'new', and a person's 'no-answer': an attempt is not an outcome.
  return null;
}

export function closeOwedReply(src: OwedReplySource | undefined): Closure {
  if (!src) return GONE;
  // Gateway acceptance, not delivery: resolveHumanPendingForConversation runs
  // on result.success (routers/smsConversations.ts).
  if (src.status === "human_replied") return { to: "kept", evidence: `staff reply accepted by gateway, job #${src.id}` };
  if (src.status === "no_reply_required") return { to: "cancelled", evidence: `marked no reply needed, job #${src.id}` };
  // human_pending, and a failed/dead send: nobody has replied yet.
  return null;
}

/** No writer ever changes emergency_requests.status; the close path is phase 2. */
export function closeEmergency(src: EmergencySource | undefined): Closure {
  return src ? null : GONE;
}

// ─── Effectful: the reconciler ───────────────────────────────────────────────

export interface KindReport {
  kind: MirrorSourceKind;
  /** Open source rows inside the window. */
  sourceOpen: number;
  /** Open source rows older than the window: counted, not mirrored. */
  tooOld: number;
  /** sourceOpen exceeded PAGE, so only the oldest PAGE were examined. */
  truncated: boolean;
  mirrored: number;
  alreadyMirrored: number;
  undatable: number;
  /** Voice callbacks the voice promise already covers. */
  voiceCovered: number;
  kept: number;
  cancelled: number;
  /** Mirrorable source rows that end the run WITHOUT an open ledger row. */
  parityMismatch: number;
}

type Row = Record<string, unknown>;
type Db = { execute: (q: unknown) => Promise<unknown> };

function rows(value: unknown): Row[] {
  if (Array.isArray(value) && Array.isArray(value[0])) return value[0] as Row[];
  if (Array.isArray(value)) return value as Row[];
  return [];
}

function affected(value: unknown): number {
  const raw = (Array.isArray(value) && value[0] && typeof value[0] === "object" ? value[0] : value) as { affectedRows?: number };
  return raw?.affectedRows ?? 0;
}

/**
 * Every instant crosses the driver as epoch SECONDS: read with UNIX_TIMESTAMP(),
 * written with FROM_UNIXTIME(). The pool sets no `timezone`, so a DATETIME the
 * driver parses into a Date is shifted by the process/session offset (+4h on
 * Eastern, apps/nickstire/AGENTS.md "Time"). A shifted createdAt would move a
 * 3 pm callback to 7 pm, after close, and date it from the next opening.
 */
const epoch = (v: unknown): Date | null => (v == null ? null : new Date(Number(v) * 1000));
const str = (v: unknown): string | null => (v == null ? null : String(v));

function toCallback(r: Row): CallbackSource {
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    phone: String(r.phone ?? ""),
    context: str(r.context),
    status: String(r.status),
    calledAt: epoch(r.calledAt),
    calledBy: str(r.calledBy),
    notes: str(r.notes),
    createdAt: epoch(r.createdAt) ?? new Date(NaN),
  };
}

function toOwedReply(r: Row): OwedReplySource {
  return {
    id: Number(r.id),
    customerPhone: String(r.customerPhone ?? ""),
    body: String(r.body ?? ""),
    status: String(r.status),
    dueAt: epoch(r.dueAt) ?? new Date(NaN),
    createdAt: epoch(r.createdAt) ?? new Date(NaN),
  };
}

function toEmergency(r: Row): EmergencySource {
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    phone: String(r.phone ?? ""),
    problem: str(r.problem),
    status: r.status == null ? null : String(r.status),
    createdAt: epoch(r.created_at),
  };
}

/** One kind's source-table access; everything else in the run is shared. */
interface KindSpec<S extends { id: number }> {
  kind: MirrorSourceKind;
  promiseType: PromiseType;
  /** Open rows inside the window, oldest first, plus the two counts. */
  readOpen: (db: Db) => Promise<{ open: S[]; total: number; tooOld: number }>;
  readByIds: (db: Db, ids: number[]) => Promise<S[]>;
  map: (src: S) => MirrorInsert | null;
  close: (src: S | undefined) => Closure;
  /** Callback rows only: the call id whose voice promise already covers the row. */
  voiceCallId?: (src: S) => string | null;
}

async function inList(ids: Array<string | number>) {
  const { sql } = await import("drizzle-orm");
  return sql.join(ids.map((id) => sql`${id}`), sql`, `);
}

async function specs(h: Hours): Promise<[KindSpec<CallbackSource>, KindSpec<OwedReplySource>, KindSpec<EmergencySource>]> {
  const { sql } = await import("drizzle-orm");
  const count = (r: Row[]) => Number(r[0]?.n ?? 0);
  return [
    {
      kind: "callback_request",
      promiseType: "callback",
      readOpen: async (db) => ({
        open: rows(await db.execute(sql`
          SELECT id, name, phone, context, status, UNIX_TIMESTAMP(calledAt) AS calledAt, calledBy, notes, UNIX_TIMESTAMP(createdAt) AS createdAt FROM callback_requests
          WHERE status = 'new' AND createdAt >= NOW() - INTERVAL ${MIRROR_WINDOW_DAYS} DAY ORDER BY createdAt ASC LIMIT ${PAGE}
        `)).map(toCallback),
        total: count(rows(await db.execute(sql`SELECT COUNT(*) AS n FROM callback_requests WHERE status = 'new' AND createdAt >= NOW() - INTERVAL ${MIRROR_WINDOW_DAYS} DAY`))),
        tooOld: count(rows(await db.execute(sql`SELECT COUNT(*) AS n FROM callback_requests WHERE status = 'new' AND createdAt < NOW() - INTERVAL ${MIRROR_WINDOW_DAYS} DAY`))),
      }),
      readByIds: async (db, ids) => rows(await db.execute(sql`
        SELECT id, name, phone, context, status, UNIX_TIMESTAMP(calledAt) AS calledAt, calledBy, notes, UNIX_TIMESTAMP(createdAt) AS createdAt FROM callback_requests
        WHERE id IN (${await inList(ids)})
      `)).map(toCallback),
      map: (src) => mapCallback(src, h),
      close: closeCallback,
      voiceCallId: (src) => voiceCallIdFromContext(src.context),
    },
    {
      kind: "owed_reply",
      promiseType: "reply",
      readOpen: async (db) => ({
        open: rows(await db.execute(sql`
          SELECT id, customerPhone, body, status, UNIX_TIMESTAMP(dueAt) AS dueAt, UNIX_TIMESTAMP(createdAt) AS createdAt FROM sms_response_jobs
          WHERE status = 'human_pending' AND createdAt >= NOW() - INTERVAL ${MIRROR_WINDOW_DAYS} DAY ORDER BY createdAt ASC LIMIT ${PAGE}
        `)).map(toOwedReply),
        total: count(rows(await db.execute(sql`SELECT COUNT(*) AS n FROM sms_response_jobs WHERE status = 'human_pending' AND createdAt >= NOW() - INTERVAL ${MIRROR_WINDOW_DAYS} DAY`))),
        tooOld: count(rows(await db.execute(sql`SELECT COUNT(*) AS n FROM sms_response_jobs WHERE status = 'human_pending' AND createdAt < NOW() - INTERVAL ${MIRROR_WINDOW_DAYS} DAY`))),
      }),
      readByIds: async (db, ids) => rows(await db.execute(sql`
        SELECT id, customerPhone, body, status, UNIX_TIMESTAMP(dueAt) AS dueAt, UNIX_TIMESTAMP(createdAt) AS createdAt FROM sms_response_jobs WHERE id IN (${await inList(ids)})
      `)).map(toOwedReply),
      map: mapOwedReply,
      close: closeOwedReply,
    },
    {
      kind: "emergency",
      promiseType: "emergency_response",
      readOpen: async (db) => ({
        open: rows(await db.execute(sql`
          SELECT id, name, phone, problem, status, UNIX_TIMESTAMP(created_at) AS created_at FROM emergency_requests
          WHERE COALESCE(status, 'new') = 'new' AND created_at >= NOW() - INTERVAL ${MIRROR_WINDOW_DAYS} DAY ORDER BY created_at ASC LIMIT ${PAGE}
        `)).map(toEmergency),
        total: count(rows(await db.execute(sql`SELECT COUNT(*) AS n FROM emergency_requests WHERE COALESCE(status, 'new') = 'new' AND created_at >= NOW() - INTERVAL ${MIRROR_WINDOW_DAYS} DAY`))),
        tooOld: count(rows(await db.execute(sql`SELECT COUNT(*) AS n FROM emergency_requests WHERE COALESCE(status, 'new') = 'new' AND (created_at < NOW() - INTERVAL ${MIRROR_WINDOW_DAYS} DAY OR created_at IS NULL)`))),
      }),
      readByIds: async (db, ids) => rows(await db.execute(sql`
        SELECT id, name, phone, problem, status, UNIX_TIMESTAMP(created_at) AS created_at FROM emergency_requests WHERE id IN (${await inList(ids)})
      `)).map(toEmergency),
      map: (src) => mapEmergency(src, h),
      close: closeEmergency,
    },
  ];
}

async function reconcileKind<S extends { id: number }>(db: Db, spec: KindSpec<S>): Promise<KindReport> {
  const { sql } = await import("drizzle-orm");
  const report: KindReport = {
    kind: spec.kind, sourceOpen: 0, tooOld: 0, truncated: false, mirrored: 0, alreadyMirrored: 0,
    undatable: 0, voiceCovered: 0, kept: 0, cancelled: 0, parityMismatch: 0,
  };

  // 1 · Mirror: one ledger row per open, datable source row.
  const { open, total, tooOld } = await spec.readOpen(db);
  report.sourceOpen = total;
  report.tooOld = tooOld;
  report.truncated = total > open.length;

  const ledgerStatus = new Map<string, string>();
  if (open.length > 0) {
    for (const r of rows(await db.execute(sql`
      SELECT source_id, status FROM customer_promises
      WHERE source_kind = ${spec.kind} AND promise_type = ${spec.promiseType}
        AND source_id IN (${await inList(open.map((s) => String(s.id)))})
    `))) ledgerStatus.set(String(r.source_id), String(r.status));
  }

  const coveredCalls = new Set<string>();
  const callIds = spec.voiceCallId ? open.map(spec.voiceCallId).filter((c): c is string => !!c) : [];
  if (callIds.length > 0) {
    for (const r of rows(await db.execute(sql`
      SELECT source_id FROM customer_promises
      WHERE source_kind = 'voice' AND promise_type = 'callback' AND source_id IN (${await inList(callIds)})
    `))) coveredCalls.add(String(r.source_id));
  }

  let matched = 0;
  let mirrorable = 0;
  for (const src of open) {
    const callId = spec.voiceCallId?.(src);
    if (callId && coveredCalls.has(callId)) {
      report.voiceCovered++;
      continue;
    }
    const ins = spec.map(src);
    if (!ins) {
      report.undatable++;
      continue;
    }
    mirrorable++;
    const existing = ledgerStatus.get(ins.sourceId);
    if (existing) {
      report.alreadyMirrored++;
      if (existing === "open") matched++;
      continue;
    }
    try {
      await db.execute(sql`
        INSERT INTO customer_promises
          (id, promise_type, customer_name, customer_phone, source_kind, source_id,
           promised_action, owner, due_at, created_by)
        VALUES
          (${randomUUID()}, ${ins.promiseType}, ${ins.customerName}, ${ins.customerPhone},
           ${ins.sourceKind}, ${ins.sourceId}, ${ins.promisedAction}, ${MIRROR_OWNER}, FROM_UNIXTIME(${Math.floor(ins.dueAt.getTime() / 1000)}), ${MIRROR_CREATED_BY})
      `);
      report.mirrored++;
      matched++;
    } catch (err) {
      // A concurrent run inserted the same key first: its row, not a failure.
      // Its status is unread here, so it is left out of `matched` and shows as
      // a mismatch this run rather than being assumed open.
      if (!isDuplicateKeyError(err)) throw err;
      report.alreadyMirrored++;
    }
  }
  report.parityMismatch = mirrorable - matched;

  // 2 · Close: every open ledger row of this kind whose source reached an outcome.
  const openLedger = rows(await db.execute(sql`
    SELECT id, source_id FROM customer_promises
    WHERE source_kind = ${spec.kind} AND status = 'open'
    ORDER BY due_at ASC LIMIT ${PAGE}
  `));
  if (openLedger.length > 0) {
    const ids = openLedger.map((r) => Number(r.source_id)).filter((n) => Number.isInteger(n));
    const byId = new Map<string, S>();
    if (ids.length > 0) for (const s of await spec.readByIds(db, ids)) byId.set(String(s.id), s);
    for (const l of openLedger) {
      const c = spec.close(byId.get(String(l.source_id)));
      if (!c) continue;
      // Compare-and-swap on the row just read: an operator Keep/Cancel landing
      // in between wins, and this run counts nothing for it.
      const res = await db.execute(sql`
        UPDATE customer_promises
        SET status = ${c.to}, kept_at = ${c.to === "kept" ? sql`NOW()` : sql`NULL`}, kept_evidence = ${c.evidence}
        WHERE id = ${String(l.id)} AND status = 'open'
      `);
      if (affected(res) === 1) report[c.to]++;
    }
  }
  return report;
}

function renderMirrorReport(reports: KindReport[]): string {
  return reports
    .map((r) =>
      `${r.kind}: ${r.sourceOpen} open${r.truncated ? ` (only ${PAGE} examined)` : ""} · +${r.mirrored} mirrored · ${r.alreadyMirrored} already`
      + ` · ${r.undatable} undatable · ${r.voiceCovered} voice-covered · ${r.tooOld} older than ${MIRROR_WINDOW_DAYS}d`
      + ` · closed ${r.kept} kept/${r.cancelled} cancelled · parity mismatch ${r.parityMismatch}`,
    )
    .join(" | ");
}

/**
 * The cron entry. Throws on a failed read (so cron_log records a failure, never
 * a healthy zero); degrades only when customer_promises itself is missing.
 */
export async function runObligationMirror(): Promise<{ recordsProcessed: number; details: string }> {
  const { isEnabled } = await import("./featureFlags");
  if (!(await isEnabled("obligation_mirror_enabled"))) {
    return { recordsProcessed: 0, details: "disabled (obligation_mirror_enabled is OFF)" };
  }
  const { getDb } = await import("../db");
  const db = (await getDb()) as Db | null;
  if (!db) throw new Error("obligation mirror: DB unavailable");

  const { BUSINESS } = await import("@shared/business");
  const [callbacks, replies, emergencies] = await specs({ timezone: BUSINESS.timezone, hours: BUSINESS.hours.structured });

  const reports: KindReport[] = [];
  try {
    reports.push(await reconcileKind(db, callbacks));
    reports.push(await reconcileKind(db, replies));
    reports.push(await reconcileKind(db, emergencies));
  } catch (err) {
    if (isMissingTableError(err)) {
      return { recordsProcessed: 0, details: "UNKNOWN · a table is missing (customer_promises needs 0102/0125) · mirror wrote nothing more" };
    }
    throw err;
  }

  const mismatches = reports.reduce((n, r) => n + r.parityMismatch, 0);
  const details = renderMirrorReport(reports);
  if (mismatches > 0) log.warn("obligation mirror parity mismatch", { mismatches, details });
  return {
    recordsProcessed: reports.reduce((n, r) => n + r.mirrored + r.kept + r.cancelled, 0),
    details,
  };
}
