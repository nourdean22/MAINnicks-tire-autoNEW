/**
 * Q-43 append-only cross-channel consent ledger.
 *
 * Existing suppression rails remain authoritative during rollout.
 * CONSENT_LEDGER_MODE: off (default) -> shadow -> enforce_holds -> enforce_grants.
 */
import { sql } from "drizzle-orm";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";
import { describeDbError, isMissingTableError } from "../lib/dbErrors";
import { normalizePhone } from "../lib/phone";

const log = createLogger("consent-ledger");
const CACHE_TTL_MS = 5 * 60 * 1000;

export type ConsentLedgerMode = "off" | "shadow" | "enforce_holds" | "enforce_grants";
export type ConsentSubjectType = "phone" | "email";
export type ConsentAction = "grant" | "revoke" | "hold" | "release";
export type ConsentScope =
  | "sms_conversational"
  | "sms_informational"
  | "sms_marketing"
  | "voice_ai_informational"
  | "voice_ai_marketing"
  | "email_marketing"
  | "all";
export type ConsentMethod =
  | "web_checkbox"
  | "web_submit_implicit"
  | "sms_reply"
  | "voice_call"
  | "email_link"
  | "email_message"
  | "in_person"
  | "paper_form"
  | "api";

export interface ConsentEventInput {
  subjectType: ConsentSubjectType;
  subjectKey: string;
  scope: ConsentScope;
  action: ConsentAction;
  source: string;
  method: ConsentMethod;
  evidenceRef: string;
  evidenceExcerpt?: string | null;
  detectorVersion?: string | null;
  disclosureId?: string | null;
  disclosureVersion?: string | null;
  disclosureSha256?: string | null;
  customerKey?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  actor: string;
  occurredAt?: Date;
  occurredAtEstimated?: boolean;
  reviewStatus?: "pending" | "revoked" | "cleared" | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
}

export interface ConsentEventRow extends Omit<ConsentEventInput, "occurredAt"> {
  id: number;
  occurredAt: Date | string;
}

export interface DerivedContactState {
  subjectKey: string;
  grants: Set<ConsentScope>;
  revokedScopes: Set<ConsentScope>;
  held: boolean;
  lastEventId: number | null;
}

export interface ConsentLedgerSnapshot {
  revokedSmsPhones: Set<string>;
  heldPhones: Set<string>;
  grantsByPhone: Map<string, Set<ConsentScope>>;
  eventCount: number;
}

export type ConsentLedgerSnapshotResult =
  | { ok: true; available: boolean; snapshot: ConsentLedgerSnapshot; stale: boolean }
  | { ok: false; reason: string };

export type AppendConsentResult =
  | { status: "disabled" | "written" | "migration_pending" }
  | { status: "rejected" | "failed"; reason: string };

const AUTOMATED_SCOPES: ConsentScope[] = [
  "sms_conversational",
  "sms_informational",
  "sms_marketing",
  "voice_ai_informational",
  "voice_ai_marketing",
  "email_marketing",
];
const SMS_SCOPES = new Set<ConsentScope>([
  "sms_conversational",
  "sms_informational",
  "sms_marketing",
]);

let snapshotCache: ConsentLedgerSnapshot | null = null;
let snapshotCacheLoadedAt = 0;
let missingTableLogged = false;

export function getConsentLedgerMode(raw = process.env.CONSENT_LEDGER_MODE): ConsentLedgerMode {
  const value = (raw ?? "off").trim().toLowerCase();
  if (value === "shadow" || value === "enforce_holds" || value === "enforce_grants") return value;
  return "off";
}

export function isConsentHoldEnforced(mode = getConsentLedgerMode()): boolean {
  return mode === "enforce_holds" || mode === "enforce_grants";
}

function normalizeConsentSubject(type: ConsentSubjectType, value: string): string | null {
  if (type === "phone") {
    const normalized = normalizePhone(value);
    if (!normalized) return null;
    const phone10 = normalized.replace(/\D/g, "").slice(-10);
    return phone10.length === 10 ? phone10 : null;
  }
  const email = value.trim().toLowerCase();
  return email && email.length <= 255 ? email : null;
}

const clip = (value: string | null | undefined, max: number): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

function prepareConsentEvent(
  input: ConsentEventInput,
): { ok: true; event: ConsentEventInput & { subjectKey: string } } | { ok: false; reason: string } {
  const subjectKey = normalizeConsentSubject(input.subjectType, input.subjectKey);
  if (!subjectKey) return { ok: false, reason: "invalid subject" };
  const evidenceRef = clip(input.evidenceRef, 191);
  if (!evidenceRef) return { ok: false, reason: "evidenceRef is required" };
  const actor = clip(input.actor, 100);
  if (!actor) return { ok: false, reason: "actor is required" };
  return {
    ok: true,
    event: {
      ...input,
      subjectKey,
      source: clip(input.source, 48) ?? "unknown",
      evidenceRef,
      evidenceExcerpt: clip(input.evidenceExcerpt, 160),
      detectorVersion: clip(input.detectorVersion, 16),
      disclosureId: clip(input.disclosureId, 64),
      disclosureVersion: clip(input.disclosureVersion, 16),
      disclosureSha256: clip(input.disclosureSha256, 64),
      customerKey: clip(input.customerKey, 64),
      ipAddress: clip(input.ipAddress, 45),
      userAgent: clip(input.userAgent, 300),
      actor,
      occurredAt: input.occurredAt ?? new Date(),
      occurredAtEstimated: Boolean(input.occurredAtEstimated),
      reviewStatus: input.reviewStatus ?? null,
      reviewedBy: clip(input.reviewedBy, 100),
      reviewedAt: input.reviewedAt ?? null,
    },
  };
}

function expanded(scope: ConsentScope): ConsentScope[] {
  return scope === "all" ? AUTOMATED_SCOPES : [scope];
}

const ACTION_RANK: Record<ConsentAction, number> = {
  grant: 0,
  release: 1,
  hold: 2,
  revoke: 3,
};

function deriveContactState(events: ConsentEventRow[]): DerivedContactState {
  const sorted = [...events].sort((a, b) => {
    const timeDiff = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    const rankDiff = ACTION_RANK[a.action] - ACTION_RANK[b.action];
    return rankDiff !== 0 ? rankDiff : a.id - b.id;
  });
  const state: DerivedContactState = {
    subjectKey: sorted[0]?.subjectKey ?? "",
    grants: new Set(),
    revokedScopes: new Set(),
    held: false,
    lastEventId: null,
  };
  for (const event of sorted) {
    const scopes = expanded(event.scope);
    if (event.action === "grant") {
      for (const scope of scopes) {
        state.grants.add(scope);
        state.revokedScopes.delete(scope);
      }
    } else if (event.action === "revoke") {
      for (const scope of scopes) {
        state.revokedScopes.add(scope);
        state.grants.delete(scope);
      }
      state.held = false;
    } else if (event.action === "hold") {
      state.held = true;
    } else {
      state.held = false;
    }
    state.lastEventId = event.id;
  }
  return state;
}

function buildConsentLedgerSnapshot(events: ConsentEventRow[]): ConsentLedgerSnapshot {
  const byPhone = new Map<string, ConsentEventRow[]>();
  for (const event of events) {
    if (event.subjectType !== "phone") continue;
    const phone10 = normalizeConsentSubject("phone", event.subjectKey);
    if (!phone10) continue;
    const rows = byPhone.get(phone10) ?? [];
    rows.push({ ...event, subjectKey: phone10 });
    byPhone.set(phone10, rows);
  }
  const snapshot: ConsentLedgerSnapshot = {
    revokedSmsPhones: new Set(),
    heldPhones: new Set(),
    grantsByPhone: new Map(),
    eventCount: events.length,
  };
  for (const [phone10, rows] of byPhone) {
    const state = deriveContactState(rows);
    if ([...state.revokedScopes].some((scope) => SMS_SCOPES.has(scope))) {
      snapshot.revokedSmsPhones.add(phone10);
    }
    if (state.held) snapshot.heldPhones.add(phone10);
    snapshot.grantsByPhone.set(phone10, new Set(state.grants));
  }
  return snapshot;
}

export async function appendConsentEvent(input: ConsentEventInput): Promise<AppendConsentResult> {
  if (getConsentLedgerMode() === "off") return { status: "disabled" };
  const prepared = prepareConsentEvent(input);
  if (!prepared.ok) return { status: "rejected", reason: prepared.reason };
  const e = prepared.event;
  const database = await db();
  if (!database) return { status: "failed", reason: "database unavailable" };
  try {
    await database.execute(sql`
      INSERT IGNORE INTO contact_consent_events (
        subject_type, subject_key, customer_key, scope, action, source, method,
        disclosure_id, disclosure_version, disclosure_sha256, evidence_ref,
        evidence_excerpt, detector_version, ip_address, user_agent, actor,
        occurred_at, occurred_at_estimated, review_status, reviewed_by, reviewed_at
      ) VALUES (
        ${e.subjectType}, ${e.subjectKey}, ${e.customerKey}, ${e.scope}, ${e.action},
        ${e.source}, ${e.method}, ${e.disclosureId}, ${e.disclosureVersion},
        ${e.disclosureSha256}, ${e.evidenceRef}, ${e.evidenceExcerpt},
        ${e.detectorVersion}, ${e.ipAddress}, ${e.userAgent}, ${e.actor},
        ${e.occurredAt}, ${e.occurredAtEstimated ? 1 : 0}, ${e.reviewStatus},
        ${e.reviewedBy}, ${e.reviewedAt}
      )
    `);
    snapshotCache = null;
    snapshotCacheLoadedAt = 0;
    return { status: "written" };
  } catch (err) {
    if (isMissingTableError(err)) {
      if (!missingTableLogged) {
        missingTableLogged = true;
        log.warn("consent ledger migration pending — existing suppression rails remain authoritative", {
          mode: getConsentLedgerMode(),
        });
      }
      return { status: "migration_pending" };
    }
    const reason = describeDbError(err);
    log.error("consent ledger write failed", { error: reason });
    return { status: "failed", reason };
  }
}

export async function loadConsentLedgerSnapshot(
  mode = getConsentLedgerMode(),
): Promise<ConsentLedgerSnapshotResult> {
  const empty = buildConsentLedgerSnapshot([]);
  if (mode === "off") return { ok: true, available: false, snapshot: empty, stale: false };
  const now = Date.now();
  if (snapshotCache && now - snapshotCacheLoadedAt < CACHE_TTL_MS) {
    return { ok: true, available: true, snapshot: snapshotCache, stale: false };
  }
  const database = await db();
  if (!database) return { ok: false, reason: "database unavailable" };
  try {
    const result = await database.execute(sql`
      SELECT
        id, subject_type AS subjectType, subject_key AS subjectKey, scope, action,
        source, method, evidence_ref AS evidenceRef, actor,
        occurred_at AS occurredAt, occurred_at_estimated AS occurredAtEstimated
      FROM contact_consent_events
      WHERE subject_type = 'phone'
      ORDER BY occurred_at ASC, id ASC
    `);
    const rows = (result[0] ?? []) as Array<Record<string, unknown>>;
    const events: ConsentEventRow[] = rows.map((row) => ({
      id: Number(row.id),
      subjectType: "phone",
      subjectKey: String(row.subjectKey ?? ""),
      scope: String(row.scope) as ConsentScope,
      action: String(row.action) as ConsentAction,
      source: String(row.source ?? ""),
      method: String(row.method ?? "api") as ConsentMethod,
      evidenceRef: String(row.evidenceRef ?? ""),
      actor: String(row.actor ?? "system:unknown"),
      occurredAt: row.occurredAt as Date | string,
      occurredAtEstimated: Boolean(row.occurredAtEstimated),
    }));
    snapshotCache = buildConsentLedgerSnapshot(events);
    snapshotCacheLoadedAt = now;
    missingTableLogged = false;
    return { ok: true, available: true, snapshot: snapshotCache, stale: false };
  } catch (err) {
    if (isMissingTableError(err)) {
      if (mode === "shadow") {
        if (!missingTableLogged) {
          missingTableLogged = true;
          log.warn("consent ledger table missing in shadow mode — source 5 skipped");
        }
        return { ok: true, available: false, snapshot: empty, stale: false };
      }
      return { ok: false, reason: "consent ledger migration pending" };
    }
    return { ok: false, reason: describeDbError(err) };
  }
}
