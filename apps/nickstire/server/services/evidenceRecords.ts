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
import { evaluateEntailment, selectSupportingPassage, entailAgainstPassage, type EntailmentVerdict } from "../../shared/claimEntailment";

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
  /**
   * Does the source actually SAY the claim?
   *
   * Was hardcoded "not_evaluated" — honest, but it meant a record could prove a
   * URL was fetched and hashed while proving nothing about whether that URL
   * supports the sentence being published. Now carries a real verdict from
   * shared/claimEntailment when an excerpt exists to evaluate against, and
   * stays "not_evaluated" when only provenance is available (a title or a
   * canonical URL is not a statement). Publication treats anything below
   * "supported" as needing a qualifier or a human.
   */
  entailment: EntailmentVerdict;
  /** Why the verdict came out that way — so a hold can explain itself. */
  entailmentReasons?: string[];
  /**
   * The passage entailment was actually judged against — the retrieved
   * sentences for a public source, the row text for an internal record. This
   * is what a reviewer should read; `assertion` is only a title for public
   * sources and was never quotable evidence.
   */
  excerpt?: string;
  confidence: number;
  sensitivity: "public" | "internal";
}

/**
 * Evaluate entailment where there is something to evaluate against.
 *
 * A public-registry record's `assertion` is the source TITLE, not its body —
 * entailing a claim against a title would be theatre, so those stay
 * `not_evaluated` until real document retrieval exists. Internal db_row
 * evidence carries the actual text (review body, work record) and can be
 * checked now.
 */
function entail(
  assertion: string,
  claim: string,
  isDb: boolean,
  documentText?: string | null,
): { entailment: EntailmentVerdict; entailmentReasons?: string[]; excerpt?: string } {
  if (isDb) {
    // The row IS the retrieved text — a real review body or work record.
    const res = evaluateEntailment(claim, assertion);
    return { entailment: res.verdict, entailmentReasons: res.reasons, excerpt: assertion };
  }

  if (!documentText) {
    return {
      entailment: "not_evaluated",
      entailmentReasons: ["source document not retrieved (blocked, failed, or client-rendered) — provenance only"],
    };
  }

  // Scope to the passage that bears on the claim BEFORE entailing. Checking
  // against the whole page would find this claim's vocabulary somewhere in
  // ~10k characters of guidance and return `supported` for statements the page
  // never makes.
  const passage = selectSupportingPassage(documentText, claim);
  if (!passage) {
    return {
      entailment: "not_supported",
      entailmentReasons: ["retrieved the source, but no passage in it is topically close to this claim"],
    };
  }
  const res = entailAgainstPassage(claim, passage);
  return {
    entailment: res.verdict,
    entailmentReasons: [...res.reasons, `matched passage (${Math.round(passage.overlap * 100)}% term overlap)`],
    excerpt: passage.passage,
  };
}

// snapshotUrl (hash-only fetch) was removed here: it kept a content hash and
// discarded the body, which is precisely why every public-source record was
// stuck at entailment "not_evaluated". services/documentRetrieval.ts replaces
// it and keeps the text. Leaving both would mean two fetch paths with
// different user-agents and timeouts against the same sources.

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
  // Retrieve the DOCUMENT, not just a hash. A hash proves the page exists and
  // has not changed; it says nothing about what the page says, which is why
  // every public-source record used to stay `not_evaluated`.
  const { retrieveDocument } = await import("./documentRetrieval");
  const snaps = await Promise.all(
    resolved.map(async (r) => {
      if (r.origin === "db" || opts.snapshot === false) return null;
      const url = r.assertion.match(/\((https?:\/\/[^)]+)\)\s*$/)?.[1];
      if (!url) return null;
      const doc = await retrieveDocument(url);
      return {
        hash: doc.hash,
        // snapshotStatus describes the FETCH, not the readability of what came
        // back: a 200 whose prose is too thin to judge was still fetched, and
        // calling it "fetch_blocked" would report the source as hostile when it
        // answered fine. Whether the text supports the claim is entailment's
        // job, and it says so separately. Hash presence is the honest signal —
        // we only have one if a body arrived.
        status: doc.hash ? ("fetched" as const) : ("fetch_blocked" as const),
        text: doc.text,
        reason: doc.reason,
      };
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
      // `assertion` is the retrieved text for a db_row (a real review body, a
      // real work record) and only a registry TITLE for a public source. The
      // checker refuses to entail against a title, so public-registry records
      // stay not_evaluated until document retrieval lands — which is the
      // truthful answer, not a downgrade.
      ...entail(r.assertion, claim, isDb, snap?.text ?? null),
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
