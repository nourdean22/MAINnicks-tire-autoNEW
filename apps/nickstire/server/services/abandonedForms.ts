/**
 * Abandoned Form Recovery — Captures partial form data and triggers recovery outreach
 *
 * Frontend sends partial data on blur events when form is 50%+ filled.
 * A cron job checks for partials with no matching completed submission
 * and sends a recovery SMS.
 *
 * Durability (2026-07-12): partials are written THROUGH to both the
 * in-memory Map (synchronous, never-lost-pre-restart cache) AND the
 * `abandoned_forms` DB table (survives a Railway restart — fixes the bug
 * where a restart dropped the last ~2h of partials and their recovery SMS
 * never fired). This module is deploy-safe WITHOUT the 0079 migration: if
 * the DB is down or the table is missing, every DB op silently no-ops and
 * the Map alone carries the behavior — identical to the pre-persistence
 * version. See drizzle/0079_abandoned_forms.sql (OPERATOR-APPLIED).
 */
import { createLogger } from "../lib/logger";
import { db } from "../lib/db-helper";
import type { AbandonedForm } from "../../drizzle/schema";
import { and, eq, lte, gte, isNotNull } from "drizzle-orm";

const log = createLogger("abandoned-forms");

interface PartialFormData {
  sessionId: string;
  formType: "booking" | "lead" | "callback" | "quote" | "tire_order";
  name?: string;
  phone?: string;
  email?: string;
  service?: string;
  pageUrl?: string;
}

interface StoredPartial extends PartialFormData {
  createdAtMs: number;
  recoveryAttempted: boolean;
}

// In-memory write-through cache. Always populated synchronously so a
// partial is never lost between the beacon and the async DB write; the DB
// is the survive-restart copy.
const partials = new Map<string, StoredPartial>();
const MAX_PARTIALS = 2000;

// Recovery-eligibility window (shared by the Map drain + the DB scan).
const MIN_AGE_MS = 30 * 60 * 1000; // 30 min — give the user time to finish
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 h — past this it's cold, don't nag
const EXPIRY_MS = 24 * 60 * 60 * 1000; // drop after a day

/**
 * Pure recovery-eligibility predicate — the single source of truth for
 * "should this partial get a recovery SMS now", shared by the Map drain
 * and the DB scan so both stores behave identically. Extracted so the
 * rule is unit-tested rather than duplicated inline.
 */
export function isEligibleForRecovery(
  partial: { phone?: string | null; recoveryAttempted: boolean; createdAtMs: number },
  nowMs: number,
): boolean {
  if (partial.recoveryAttempted) return false;
  if (!partial.phone) return false;
  const age = nowMs - partial.createdAtMs;
  return age >= MIN_AGE_MS && age <= MAX_AGE_MS;
}

// Auto-cleanup every 20 minutes to prevent unbounded Map growth. The DB
// copy is pruned inside processAbandonedForms.
const abandonedCleanupInterval = setInterval(() => {
  const cutoff = Date.now() - EXPIRY_MS;
  for (const [id, p] of partials) {
    if (p.createdAtMs < cutoff) partials.delete(id);
  }
  if (partials.size > MAX_PARTIALS) {
    const sorted = Array.from(partials.entries()).sort((a, b) => a[1].createdAtMs - b[1].createdAtMs);
    const toRemove = partials.size - MAX_PARTIALS;
    for (let i = 0; i < toRemove; i++) partials.delete(sorted[i][0]);
  }
}, 20 * 60 * 1000);

// ─── DB helpers (all best-effort — never throw into the caller) ──────

async function dbUpsertPartial(data: PartialFormData): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    const { abandonedForms } = await import("../../drizzle/schema");
    const row = {
      sessionId: data.sessionId,
      formType: data.formType,
      name: data.name ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      service: data.service ?? null,
      pageUrl: data.pageUrl ?? null,
    };
    await d.insert(abandonedForms).values(row).onDuplicateKeyUpdate({
      // Refresh the captured fields on a later blur, but NEVER reset
      // recoveryAttempted or createdAt — a re-blur must not re-arm a send
      // or reset the age window.
      set: { formType: row.formType, name: row.name, phone: row.phone, email: row.email, service: row.service, pageUrl: row.pageUrl },
    });
  } catch (err) {
    // Table missing (pre-0079) or DB down — the Map still has this entry.
    log.warn("[abandonedForms] DB upsert skipped (Map covers it)", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function dbDeletePartial(sessionId: string): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    const { abandonedForms } = await import("../../drizzle/schema");
    await d.delete(abandonedForms).where(eq(abandonedForms.sessionId, sessionId));
  } catch {
    /* best-effort */
  }
}

async function dbMarkAttempted(sessionId: string): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    const { abandonedForms } = await import("../../drizzle/schema");
    await d.update(abandonedForms).set({ recoveryAttempted: true }).where(eq(abandonedForms.sessionId, sessionId));
  } catch {
    /* best-effort */
  }
}

// ─── Public API (signatures unchanged for existing callers) ──────────

/** Save partial form data (called from frontend on blur events) */
export function savePartialForm(data: PartialFormData): void {
  // Synchronous write-through cache: guarantees the partial is captured
  // the instant the beacon lands, even if the DB write is slow/failing.
  if (partials.size >= MAX_PARTIALS && !partials.has(data.sessionId)) {
    // Map is full of NEW sessions — still try the DB so it's not lost.
    void dbUpsertPartial(data);
    return;
  }
  const existing = partials.get(data.sessionId);
  partials.set(data.sessionId, {
    ...data,
    createdAtMs: existing?.createdAtMs ?? Date.now(),
    recoveryAttempted: existing?.recoveryAttempted ?? false,
  });
  void dbUpsertPartial(data);
  log.info("Partial form captured", { sessionId: data.sessionId, formType: data.formType, hasPhone: !!data.phone });
}

/** Mark a session as completed (form was submitted successfully) */
export function markFormCompleted(sessionId: string): void {
  partials.delete(sessionId);
  void dbDeletePartial(sessionId);
}

/**
 * Process abandoned forms — called by cron every 30 min. Sends one
 * recovery SMS per eligible partial (30 min–2 h old, has a phone, not yet
 * attempted). Drains the Map first, then the DB for entries the Map lost
 * to a restart; a seen-set dedups so an entry present in both is texted
 * at most once.
 */
export async function processAbandonedForms(): Promise<{ recordsProcessed: number }> {
  const now = Date.now();
  const seen = new Set<string>();
  let processed = 0;

  const send = async (p: { sessionId: string; phone?: string | null; name?: string | null; formType: string }): Promise<boolean> => {
    try {
      const { orchestrateSms } = await import("./smsOrchestrator");
      const result = await orchestrateSms({
        type: "abandoned_form_recovery",
        phone: p.phone!,
        name: p.name || "",
        formType: p.formType,
      });
      if (result.status === "sent" || result.status === "queued") {
        log.info("Abandoned form recovery processed", { sessionId: p.sessionId, phoneSuffix: p.phone!.slice(-4), status: result.status });
        return true;
      }
    } catch (err) {
      log.error("Recovery SMS failed", { error: err instanceof Error ? err.message : String(err) });
    }
    return false;
  };

  // 1) Map drain (common case + pre-migration fallback path).
  for (const [sessionId, partial] of partials) {
    if (!isEligibleForRecovery(partial, now)) continue;
    seen.add(sessionId);
    partial.recoveryAttempted = true; // dedup within this process's lifetime
    if (await send({ ...partial, sessionId })) processed++;
    void dbMarkAttempted(sessionId); // keep the durable copy in sync
  }

  // 2) DB scan for restart survivors the Map no longer holds.
  try {
    const d = await db();
    if (d) {
      const { abandonedForms } = await import("../../drizzle/schema");
      const windowStart = new Date(now - MAX_AGE_MS);
      const windowEnd = new Date(now - MIN_AGE_MS);
      const rows = await d.select().from(abandonedForms).where(and(
        eq(abandonedForms.recoveryAttempted, false),
        isNotNull(abandonedForms.phone),
        gte(abandonedForms.createdAt, windowStart),
        lte(abandonedForms.createdAt, windowEnd),
      ));
      for (const row of rows) {
        if (seen.has(row.sessionId)) continue; // already handled via the Map
        seen.add(row.sessionId);
        // Mark attempted BEFORE sending so a crash mid-send can't double-text.
        await dbMarkAttempted(row.sessionId);
        if (await send({ sessionId: row.sessionId, phone: row.phone, name: row.name, formType: row.formType })) processed++;
      }
      // Prune the durable copy of anything older than a day.
      await d.delete(abandonedForms).where(lte(abandonedForms.createdAt, new Date(now - EXPIRY_MS)));
    }
  } catch (err) {
    log.warn("[abandonedForms] DB scan skipped (Map path already ran)", { error: err instanceof Error ? err.message : String(err) });
  }

  // Map cleanup (> 24 h).
  const cutoff = now - EXPIRY_MS;
  for (const [sessionId, partial] of partials) {
    if (partial.createdAtMs < cutoff) partials.delete(sessionId);
  }

  return { recordsProcessed: processed };
}

/** Get stats for admin */
export async function getAbandonedFormStats(): Promise<{ pending: number; total: number; withPhone: number }> {
  // Prefer the durable store when available; fall back to the Map.
  try {
    const d = await db();
    if (d) {
      const { abandonedForms } = await import("../../drizzle/schema");
      const rows: AbandonedForm[] = await d.select().from(abandonedForms);
      const pending = rows.filter((r: AbandonedForm) => !r.recoveryAttempted).length;
      const withPhone = rows.filter((r: AbandonedForm) => r.phone && !r.recoveryAttempted).length;
      return { total: rows.length, pending, withPhone };
    }
  } catch {
    /* fall through to Map */
  }
  let withPhone = 0;
  for (const p of partials.values()) if (p.phone && !p.recoveryAttempted) withPhone++;
  return {
    total: partials.size,
    pending: Array.from(partials.values()).filter(p => !p.recoveryAttempted).length,
    withPhone,
  };
}

/**
 * Test-only seam: clears the in-memory write-through cache. The module
 * holds process-global state (the Map), so tests that share the process
 * (vitest singleFork) need a way to isolate. No production caller.
 */
export function __resetPartialsForTest(): void {
  partials.clear();
}
