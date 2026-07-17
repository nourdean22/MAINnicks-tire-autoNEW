/**
 * Claim-level evidence records — directive milestone 6, extending the
 * resolver (#813/#816/#822) instead of replacing it.
 *
 * A resolved handle becomes a STRUCTURED record: what source, what assertion,
 * what CLAIM it supports, when it was retrieved, a content-snapshot hash when
 * the source is fetchable, an explicit snapshot status when it is not (the
 * URL truth audit proved NHTSA and Ohio EPA block fetchers — recorded, never
 * papered over), a staleness deadline, and an entailment field that is
 * HONESTLY "not_evaluated" until a real entailment pass exists (deferred —
 * writing "verified" without checking is the exact failure this system
 * exists to prevent).
 *
 * Directors persist these records into the brief (evidenceRecords) so a
 * published asset carries claim-level provenance, not just note labels.
 */
import { createHash } from "crypto";
import { createLogger } from "../lib/logger";
import { resolveEvidenceHandles } from "./evidenceResolver";

const log = createLogger("services:evidence-records");

/** Evidence staleness horizons (days) — expired records must re-resolve. */
export const EVIDENCE_TTL_DAYS = { db: 180, public_family: 365 } as const;

export interface EvidenceRecord {
  id: string;
  handle: string;
  sourceType: "db_record" | "public_registry";
  /** the verified assertion (review text / registry title + canonical URL) */
  assertion: string;
  /** the campaign claim this evidence supports */
  claim: string;
  retrievedAt: string;
  expiresAt: string;
  /** sha256 of the fetched source content when fetchable */
  snapshotHash: string | null;
  snapshotStatus: "fetched" | "fetch_blocked" | "db_row" | "not_attempted";
  /** honest until a real entailment pass exists */
  entailment: "not_evaluated";
  confidence: number;
  sensitivity: "public" | "internal";
}

/** Fetch + hash a public source. Bot-blocks and timeouts are RECORDED, not
 *  retried into oblivion — 6s budget, one attempt. */
async function snapshotUrl(url: string): Promise<{ hash: string | null; status: "fetched" | "fetch_blocked" }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "NicksTireEvidence/1.0 (+https://nickstire.org)" },
    });
    if (!res.ok) return { hash: null, status: "fetch_blocked" };
    const buf = Buffer.from(await res.arrayBuffer());
    return { hash: createHash("sha256").update(buf).digest("hex"), status: "fetched" };
  } catch {
    return { hash: null, status: "fetch_blocked" };
  }
}

export interface EvidenceRecordResolution {
  records: EvidenceRecord[];
  rejected: string[];
}

/**
 * Resolve handles into claim-linked structured records. DB-backed handles
 * carry the row assertion (snapshotStatus db_row); public-registry handles
 * attempt a live snapshot of the canonical URL and record the outcome.
 */
export async function resolveEvidenceRecords(
  handles: string[],
  claim: string,
  opts: { snapshot?: boolean } = {},
): Promise<EvidenceRecordResolution> {
  const { resolved, rejected } = await resolveEvidenceHandles(handles);
  const now = Date.now();
  // Snapshots run CONCURRENTLY (gated assessment P2, confirmed: the serial
  // loop stacked up to 8×6s of timeout inside an operator-facing request).
  // Each fetch already fails soft into fetch_blocked; Promise.all is safe.
  const snaps = await Promise.all(
    resolved.map(async (r) => {
      if (r.origin === "db" || opts.snapshot === false) return null;
      const url = r.assertion.match(/\((https?:\/\/[^)]+)\)\s*$/)?.[1];
      return url ? snapshotUrl(url) : null;
    }),
  );
  const records: EvidenceRecord[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    const isDb = r.origin === "db";
    const ttlDays = isDb ? EVIDENCE_TTL_DAYS.db : EVIDENCE_TTL_DAYS.public_family;
    const snap = snaps[i];
    const snapshotHash: string | null = snap?.hash ?? null;
    const snapshotStatus: EvidenceRecord["snapshotStatus"] = isDb ? "db_row" : snap ? snap.status : "not_attempted";
    records.push({
      id: `evr_${createHash("sha256").update(`${r.handle}|${claim}`).digest("hex").slice(0, 16)}`,
      handle: r.handle,
      sourceType: isDb ? "db_record" : "public_registry",
      assertion: r.assertion,
      claim: claim.slice(0, 400),
      retrievedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlDays * 86_400_000).toISOString(),
      snapshotHash,
      snapshotStatus,
      entailment: "not_evaluated",
      confidence: isDb ? 0.9 : snapshotStatus === "fetched" ? 0.7 : 0.5,
      sensitivity: isDb ? "internal" : "public",
    });
  }
  if (records.length) {
    log.info("evidence records resolved", {
      records: records.length,
      rejected: rejected.length,
      snapshots: records.filter((x) => x.snapshotStatus === "fetched").length,
    });
  }
  return { records, rejected };
}

/** An expired record must not ground anything — callers re-resolve. */
export function isEvidenceRecordLive(record: EvidenceRecord, now: Date = new Date()): boolean {
  return new Date(record.expiresAt).getTime() > now.getTime();
}
