/**
 * Evidence resolver — Reel Director hardening.
 *
 * Closes the trust gap found in #811 review: `withGenomeProof` attached raw
 * genome proof-handle STRINGS as `kind:"proof"` source notes, so a handle
 * like "review:rev_123" satisfied the quality gate's grounding check without
 * anyone verifying the review exists. This module makes proof handles TYPED
 * and RESOLVED:
 *
 *   review:<id>        -> resolveSourceProvenance("review")        (5-star row must exist)
 *   declined_work:<id> -> resolveSourceProvenance("declined_work") (declined row must exist)
 *   work_order:<id>    -> same declined_work resolution path (covers workOrders)
 *   <accepted public family text, e.g. "NHTSA tire pressure guidance">
 *                      -> allowed as a public proof source (the existing
 *                         PROOF_SOURCE_FAMILIES standard for reels+carousels)
 *   anything else      -> REJECTED (never becomes a proof note)
 *
 * The resolved ASSERTION (actual review text / work-order line), not the raw
 * handle, is what lands in the source note — so the approval gate reviews
 * real evidence.
 */
import { PROOF_SOURCE_FAMILIES } from "../../client/src/lib/facelessReelStudio";
import { createLogger } from "../lib/logger";

const log = createLogger("services:evidence-resolver");

/**
 * Curated public-source records. A family NAME alone must not satisfy
 * grounding ("NHTSA says so" is recognition, not evidence) — a label only
 * resolves when it maps to a specific curated record, and the resolved
 * assertion carries the record's title + canonical URL. Records are
 * audit found the ORIGINAL urls were written from model memory and 2 of 3
 * were WRONG (404). Current urls were re-verified 2026-07-17 by live fetch
 * or search-index confirmation, as recorded per record. Full document
 * retrieval + excerpt entailment remains the Wave-B upgrade.
 */
export interface PublicSourceRecord {
  id: string;
  family: (typeof PROOF_SOURCE_FAMILIES)[number];
  title: string;
  canonicalUrl: string;
  /** how the canonical URL was last verified */
  retrievalStatus: "fetch_verified" | "search_confirmed" | "fetch_blocked_search_confirmed";
  /** at least one topic keyword must appear in the label for a match */
  topics: string[];
  curatedAt: string;
}

export const PUBLIC_SOURCE_REGISTRY: PublicSourceRecord[] = [
  {
    id: "nhtsa_tires",
    family: "NHTSA",
    title: "NHTSA vehicle tire safety guidance",
    canonicalUrl: "https://www.nhtsa.gov/vehicle-safety/tires",
    retrievalStatus: "fetch_blocked_search_confirmed",
    topics: ["tire", "tread", "pressure", "psi", "tpms", "inflation", "aging", "blowout", "rotation"],
    curatedAt: "2026-07-17",
  },
  {
    id: "ohio_echeck",
    family: "Ohio E-Check",
    title: "Ohio EPA E-Check program requirements",
    canonicalUrl: "https://epa.ohio.gov/divisions-and-offices/air-pollution-control/e-check",
    retrievalStatus: "fetch_blocked_search_confirmed",
    topics: ["e-check", "echeck", "emission", "inspection", "test"],
    curatedAt: "2026-07-17",
  },
  {
    id: "carcare_maintenance",
    family: "Car Care Council",
    title: "Car Care Council preventative maintenance guidance",
    canonicalUrl: "https://www.carcare.org/car-care-tips/",
    retrievalStatus: "fetch_verified",
    topics: ["battery", "wiper", "fluid", "brake", "maintenance", "winter", "inspection", "belt", "hose"],
    curatedAt: "2026-07-17",
  },
];

export type ParsedEvidenceHandle =
  | { type: "review"; id: string }
  | { type: "declined_work"; id: string }
  | { type: "public_source"; record: PublicSourceRecord; label: string }
  | { type: "family_without_record"; family: string; label: string }
  | { type: "unrecognized"; label: string };

export function parseEvidenceHandle(handle: string): ParsedEvidenceHandle {
  const trimmed = handle.trim();
  const typed = trimmed.match(/^(review|declined_work|work_order)\s*:\s*(.+)$/i);
  if (typed) {
    const kind = typed[1].toLowerCase();
    const id = typed[2].trim();
    if (kind === "review") return { type: "review", id };
    // work_order handles resolve through the same declined-work path, which
    // checks both work_order_items and work_orders.
    return { type: "declined_work", id };
  }
  const lower = trimmed.toLowerCase();
  const record = PUBLIC_SOURCE_REGISTRY.find(
    (r) => lower.includes(r.family.toLowerCase()) && r.topics.some((t) => lower.includes(t)),
  );
  if (record) return { type: "public_source", record, label: trimmed };
  const family = PROOF_SOURCE_FAMILIES.find((f) => lower.includes(f.toLowerCase()));
  if (family) return { type: "family_without_record", family, label: trimmed };
  return { type: "unrecognized", label: trimmed };
}

export interface ResolvedEvidence {
  handle: string;
  /** the verified assertion the proof note should carry */
  assertion: string;
  origin: "db" | "public_family";
}

export interface EvidenceResolution {
  resolved: ResolvedEvidence[];
  /** handles that could NOT be verified — these never become proof notes */
  rejected: string[];
}

export async function resolveEvidenceHandles(handles: string[]): Promise<EvidenceResolution> {
  const resolved: ResolvedEvidence[] = [];
  const rejected: string[] = [];
  for (const handle of handles) {
    const parsed = parseEvidenceHandle(handle);
    if (parsed.type === "public_source") {
      resolved.push({
        handle,
        assertion: `${parsed.record.title} (${parsed.record.canonicalUrl})`,
        origin: "public_family",
      });
      continue;
    }
    if (parsed.type === "family_without_record" || parsed.type === "unrecognized") {
      rejected.push(handle);
      continue;
    }
    try {
      const { resolveSourceProvenance } = await import("./reelBriefGen");
      const res = await resolveSourceProvenance(parsed.type, parsed.id);
      if (res.isVerified && res.evidence) {
        resolved.push({ handle, assertion: res.evidence, origin: "db" });
      } else {
        rejected.push(handle);
      }
    } catch (err) {
      log.warn("evidence resolution failed — handle rejected", {
        handle,
        err: err instanceof Error ? err.message.slice(0, 120) : String(err),
      });
      rejected.push(handle);
    }
  }
  if (rejected.length) {
    log.info("evidence handles rejected (unresolvable)", { rejected });
  }
  return { resolved, rejected };
}
