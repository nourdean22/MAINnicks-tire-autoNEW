/**
 * Resume record · 2026-09-07 (program U5).
 *
 * Park/resume shipped in #2052 with ONE free-text line ("where did you
 * stop?"). After 48 hours away that line is not enough to reconstruct a
 * mission in 30 seconds: what was I trying to get, what did I actually
 * verify, where is the evidence, what is still open, and what is the very
 * next physical action. This module is the shape of that record; it rides
 * the existing `TaskEvent(kind: "parked")` payload, so no schema change.
 *
 * A stale summary read as an instruction is the risk (the program names
 * it): every render carries the parked-at timestamp and a "verify before
 * acting" affordance — the record is a memory aid, not a plan.
 */
import { z } from "zod";

const LINE = z.string().trim().max(300);
const LINK = z.string().trim().max(500);
export const MAX_RESUME_LINKS = 5;

export const resumeRecordSchema = z.object({
  intendedOutcome: LINE.optional(),
  lastVerifiedStep: LINE.optional(),
  evidenceLinks: z.array(LINK).max(MAX_RESUME_LINKS).optional(),
  openQuestion: LINE.optional(),
  nextPhysicalAction: LINE.optional(),
});

export type ResumeRecordInput = z.infer<typeof resumeRecordSchema>;

export interface ResumeRecord {
  intendedOutcome: string | null;
  lastVerifiedStep: string | null;
  /** http(s) URLs or in-app paths starting with "/". Anything else is dropped. */
  evidenceLinks: string[];
  openQuestion: string | null;
  nextPhysicalAction: string | null;
}

const RESUME_FIELDS = ["intendedOutcome", "lastVerifiedStep", "openQuestion", "nextPhysicalAction"] as const;

function cleanLine(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, 300);
  return t.length > 0 ? t : null;
}

export function isAcceptableEvidenceLink(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  if (t.length === 0 || t.length > 500) return false;
  if (t.startsWith("/") && !t.startsWith("//")) return true;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalize an operator-entered record. Returns null when nothing survives
 * so an empty form never writes an empty object into the event payload.
 */
export function normalizeResumeRecord(input: unknown): ResumeRecord | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const links = Array.isArray(o.evidenceLinks)
    ? o.evidenceLinks.filter(isAcceptableEvidenceLink).map((l) => l.trim()).slice(0, MAX_RESUME_LINKS)
    : [];
  const rec: ResumeRecord = {
    intendedOutcome: cleanLine(o.intendedOutcome),
    lastVerifiedStep: cleanLine(o.lastVerifiedStep),
    evidenceLinks: links,
    openQuestion: cleanLine(o.openQuestion),
    nextPhysicalAction: cleanLine(o.nextPhysicalAction),
  };
  const hasContent = RESUME_FIELDS.some((k) => rec[k] !== null) || links.length > 0;
  return hasContent ? rec : null;
}

/** Read a record back from a stored `parked` payload; legacy payloads (note only) yield null. */
export function parseResumeRecord(payload: unknown): ResumeRecord | null {
  if (!payload || typeof payload !== "object") return null;
  return normalizeResumeRecord((payload as { record?: unknown }).record);
}

/** "parked 3 h ago" / "parked 2 d ago" — the freshness the reader must weigh before acting. */
export function resumeAgeLabel(parkedAt: string | Date | null | undefined, now: Date = new Date()): string | null {
  if (!parkedAt) return null;
  const t = parkedAt instanceof Date ? parkedAt.getTime() : Date.parse(parkedAt);
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  if (mins < 60) return `parked ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `parked ${hours} h ago`;
  return `parked ${Math.round(hours / 24)} d ago`;
}
