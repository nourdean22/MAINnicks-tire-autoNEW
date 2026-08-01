/**
 * Bridge: a generated brief's factual spine → the Episode Contract's claims and
 * evidence.
 *
 * reelBriefGen already produces both halves and never connected them:
 *
 *   mechanicTruth  — the one factual assertion the episode is built on
 *   sourceNotes[]  — labelled sources, at least one of kind "proof" (enforced
 *                    by the generator's HARD REQUIREMENT prompt)
 *
 * The evidence layer already turns handles into structured, entailment-bearing
 * records. Nothing joined them, so `enqueueReelJob` received no claims and
 * every episode reported NO_CLAIMS / ENTAILMENT_MISSING. This is that join.
 *
 * WHAT IT DOES NOT DO
 * It does not invent qualifiers, upgrade verdicts, or drop inconvenient
 * evidence. A partially-supported claim arrives WITHOUT a required qualifier,
 * and preflight blocks it (QUALIFIER_DROPPED) — correctly, because nothing in
 * the brief declared how to hedge it. Manufacturing a hedge here would be this
 * system lying to its own gate.
 */
import { createLogger } from "../lib/logger";
import type { EpisodeClaim, EpisodeEvidence } from "../../shared/episodeContract";
import type { EvidenceRecord } from "./evidenceRecords";

const log = createLogger("services:episode-claims");

export interface BriefSourceNote {
  label: string;
  url?: string;
  kind: "proof" | "pain_point";
  supports: string;
}

export interface ClaimEvidenceResult {
  claims: EpisodeClaim[];
  evidence: EpisodeEvidence[];
  /** Handles the resolver refused — never silently dropped. */
  rejected: string[];
}

/**
 * Turn a source note into a handle the resolver accepts.
 *
 * Two shapes reach here. The generator's DB-provenance note carries a
 * `provenance://<type>/<id>` url and a human label ("Database Resolved
 * Provenance: ID …") that is NOT a handle — the id must be recovered from the
 * url or the strongest evidence available, an actual shop record, resolves to
 * nothing. LLM-authored notes carry a public-family label, which IS the handle.
 */
export function noteToHandle(note: BriefSourceNote): string | null {
  const url = note.url ?? "";
  const prov = /^provenance:\/\/([^/]+)\/(.+)$/.exec(url);
  if (prov) {
    const [, type, id] = prov;
    // resolveEvidenceHandles knows review / declined_work / work_order.
    const normalized = type === "reviews" ? "review" : type === "work_orders" ? "work_order" : type;
    return `${normalized}:${id}`;
  }
  const label = note.label.trim();
  return label.length ? label : null;
}

/** db_record → the row IS internal; public_registry → treated as an outside source. */
function sourceTypeOf(rec: EvidenceRecord): EpisodeEvidence["sourceType"] {
  return rec.sourceType === "db_record" ? "internal_record" : "government";
}

/**
 * Build the claim + evidence halves of an episode declaration from a brief.
 *
 * `mechanicTruth` is the claim. Only `kind: "proof"` notes become evidence —
 * a pain point is a narrative device, not a citation, and letting it ground a
 * factual claim is exactly the confusion the proof/pain_point split exists to
 * prevent.
 */
export async function buildClaimsFromBrief(
  brief: { mechanicTruth?: string; sourceNotes?: BriefSourceNote[] },
  opts: { snapshot?: boolean } = {},
): Promise<ClaimEvidenceResult> {
  const claimText = String(brief.mechanicTruth ?? "").trim();
  if (!claimText) {
    // No assertion means nothing to verify. Returning an empty packet lets
    // preflight say NO_CLAIMS rather than this file inventing one.
    return { claims: [], evidence: [], rejected: [] };
  }

  const proofNotes = (brief.sourceNotes ?? []).filter((n) => n?.kind === "proof");
  const handles = proofNotes.map(noteToHandle).filter((h): h is string => Boolean(h));
  if (!handles.length) {
    log.warn("brief has a mechanicTruth but no resolvable proof handle", { claim: claimText.slice(0, 120) });
    return { claims: [{ claimId: "claim_1", text: claimText, riskTier: "mechanical", evidenceIds: [], requiredQualifiers: [] }], evidence: [], rejected: [] };
  }

  const { resolveEvidenceRecords } = await import("./evidenceRecords");
  const { records, rejected } = await resolveEvidenceRecords(handles, claimText, opts);

  const evidence: EpisodeEvidence[] = records.map((rec) => ({
    evidenceId: rec.id,
    claimIds: ["claim_1"],
    sourceType: sourceTypeOf(rec),
    sourceRef: rec.handle,
    // The retrieved text, which is what entailment was evaluated against.
    sourceExcerpt: rec.assertion || null,
    retrievedAt: rec.retrievedAt,
    expiresAt: rec.expiresAt,
    entailment: rec.entailment,
  }));

  if (rejected.length) {
    log.warn("evidence handles rejected — claim will carry fewer citations", { rejected });
  }

  return {
    claims: [{
      claimId: "claim_1",
      text: claimText,
      riskTier: "mechanical",
      evidenceIds: evidence.map((e) => e.evidenceId),
      // Deliberately empty: nothing in the brief declares HOW to hedge a
      // partially-supported claim, and inventing a qualifier here would let
      // this system satisfy its own gate with wording no author chose.
      requiredQualifiers: [],
    }],
    evidence,
    rejected,
  };
}
