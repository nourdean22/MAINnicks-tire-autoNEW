/**
 * VAPI call archive pass — the durable vault for artifacts VAPI purges at 14
 * days (transcript, message array, recording URLs). Runs at the top of the
 * daily vapi-eval cron, independently of evaluation state, so outbound and
 * deferred calls are vaulted too.
 *
 * Two properties this pass must not lose:
 *
 *  · SELF-BACKFILLING AND IDEMPOTENT. The selection is "calls from the last 14
 *    days with no archived transcript yet" — the first run after deploy vaults
 *    the entire surviving retention window with no manual backfill, and a call
 *    whose transcript wasn't ready upstream is retried daily until the call
 *    ages past retention. Rows with a captured transcript are never reselected,
 *    so the upsert can never overwrite good data with a later empty fetch.
 *
 *  · IT DEGRADES WITHOUT BREAKING EVAL. If the 0109 table has not been applied
 *    yet, the pass logs loudly and returns instead of throwing — the archive is
 *    additive, and a missing vault must never block call evaluation.
 */
import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const log = createLogger("services:vapi-archive");

/** VAPI's upstream retention window — after this the artifacts are gone. */
const RETENTION_DAYS = 14;
/** Bounds one run. First post-deploy run backfills the window across ≤2 runs. */
const DEFAULT_LIMIT = 500;

interface VapiArchiveDetail {
  type?: string;
  startedAt?: string;
  endedAt?: string;
  transcript?: string;
  summary?: string;
  messages?: unknown[];
  recordingUrl?: string;
  stereoRecordingUrl?: string;
  cost?: number;
  analysis?: Record<string, unknown>;
  artifact?: {
    transcript?: string;
    messages?: unknown[];
    recordingUrl?: string;
    stereoRecordingUrl?: string;
  };
}

export interface ArchiveSourceRow {
  vapiCallId: string;
  phoneNumber: string | null;
  durationSeconds: number | null;
  endedReason: string | null;
  createdAt: Date;
}

export interface ArchivePayload {
  phoneNumber: string | null;
  callType: string | null;
  endedReason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  transcript: string | null;
  messagesJson: unknown[] | null;
  recordingUrl: string | null;
  stereoRecordingUrl: string | null;
  summary: string | null;
  analysisJson: Record<string, unknown> | null;
  costTotal: string | null;
  transcriptCapturedAt: Date | null;
}

export interface ArchiveRunResult {
  scanned: number;
  archived: number;
  captured: number;
  errors: number;
  skippedReason?: string;
  details: string;
}

/** STRICT_TRANS_TABLES rejects over-width writes and LOSES the row — clip
 *  every varchar to its column width instead of trusting upstream lengths. */
function clip(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Pure mapping from a VAPI call detail + the local log row to the archive row.
 * Transcript/messages fall back to the artifact envelope — VAPI reports them in
 * either place depending on call age and API version.
 */
export function buildArchivePayload(detail: VapiArchiveDetail, row: ArchiveSourceRow, now: Date = new Date()): ArchivePayload {
  const transcript = nonEmpty(detail.transcript) ?? nonEmpty(detail.artifact?.transcript);
  const messagesSource = Array.isArray(detail.messages) && detail.messages.length > 0
    ? detail.messages
    : Array.isArray(detail.artifact?.messages) && detail.artifact.messages.length > 0
      ? detail.artifact.messages
      : null;
  return {
    phoneNumber: clip(row.phoneNumber, 30),
    callType: clip(detail.type, 32),
    endedReason: clip(row.endedReason, 64),
    startedAt: parseDate(detail.startedAt) ?? row.createdAt,
    endedAt: parseDate(detail.endedAt),
    durationSeconds: row.durationSeconds,
    transcript,
    messagesJson: messagesSource,
    recordingUrl: clip(detail.recordingUrl ?? detail.artifact?.recordingUrl, 500),
    stereoRecordingUrl: clip(detail.stereoRecordingUrl ?? detail.artifact?.stereoRecordingUrl, 500),
    summary: nonEmpty(detail.summary) ?? nonEmpty(detail.analysis?.summary as string | undefined),
    analysisJson: detail.analysis && typeof detail.analysis === "object" ? detail.analysis : null,
    costTotal: typeof detail.cost === "number" && Number.isFinite(detail.cost) ? detail.cost.toFixed(4) : null,
    transcriptCapturedAt: transcript ? now : null,
  };
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const errno = (error as { errno?: number })?.errno;
  const message = error instanceof Error ? error.message : String(error);
  return code === "ER_NO_SUCH_TABLE" || errno === 1146 || /doesn't exist/i.test(message);
}

export async function archiveRecentVapiCalls(options?: { limit?: number }): Promise<ArchiveRunResult> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return { scanned: 0, archived: 0, captured: 0, errors: 0, skippedReason: "no_db", details: "no DB" };

  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    return { scanned: 0, archived: 0, captured: 0, errors: 0, skippedReason: "no_api_key", details: "VAPI_API_KEY unset — nothing vaulted" };
  }

  const { vapiCallArchives, vapiCallLogs } = await import("../../drizzle/schema");
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);

  let rows: ArchiveSourceRow[];
  try {
    rows = await db
      .select({
        vapiCallId: vapiCallLogs.vapiCallId,
        phoneNumber: vapiCallLogs.phoneNumber,
        durationSeconds: vapiCallLogs.durationSeconds,
        endedReason: vapiCallLogs.endedReason,
        createdAt: vapiCallLogs.createdAt,
      })
      .from(vapiCallLogs)
      .leftJoin(vapiCallArchives, eq(vapiCallArchives.vapiCallId, vapiCallLogs.vapiCallId))
      .where(and(
        gte(vapiCallLogs.createdAt, cutoff),
        or(isNull(vapiCallArchives.id), isNull(vapiCallArchives.transcript)),
      ))
      .orderBy(desc(vapiCallLogs.createdAt))
      .limit(limit);
  } catch (error) {
    if (isMissingTableError(error)) {
      // Deploy-before-DDL ordering: code shipped ahead of migration 0109. Loud,
      // daily, and non-fatal — apply scripts/apply-0109-vapi-call-archives.mjs.
      log.warn("[vapi-archive] vapi_call_archives table missing — migration 0109 not applied; transcripts are still being lost daily", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { scanned: 0, archived: 0, captured: 0, errors: 0, skippedReason: "table_missing", details: "table missing (apply 0109)" };
    }
    throw error;
  }

  let archived = 0;
  let captured = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const response = await fetch(`https://api.vapi.ai/call/${row.vapiCallId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        errors++;
        continue;
      }
      const detail = await response.json() as VapiArchiveDetail;
      const payload = buildArchivePayload(detail, row);
      await db.insert(vapiCallArchives)
        .values({ vapiCallId: row.vapiCallId, ...payload })
        .onDuplicateKeyUpdate({ set: payload });
      archived++;
      if (payload.transcript) captured++;
    } catch (error) {
      errors++;
      log.warn("[vapi-archive] archive failed for call", {
        callId: row.vapiCallId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result: ArchiveRunResult = {
    scanned: rows.length,
    archived,
    captured,
    errors,
    details: `${rows.length} scanned · ${archived} archived · ${captured} transcripts captured · ${errors} errors`,
  };
  log.info("[vapi-archive] pass complete", { ...result });
  return result;
}
