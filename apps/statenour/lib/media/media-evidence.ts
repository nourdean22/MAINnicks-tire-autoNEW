/**
 * Media as evidence (BDN-313) — media plan item #4.
 *
 * THE GATE RESULT THAT SHAPED THIS FILE
 * The plan asked for provenance/status cards carrying source, freshness,
 * analysis state and a confidence read — i.e. a small evidence model for
 * media. That model already exists, in full, at
 * lib/ai/vnext/truth/claims.ts:
 *
 *   · `ClaimLedger`        — the literal type name the plan proposed
 *   · CLAIM_VERIFICATION   — SUPPORTED / PARTIAL / CONTRADICTED / UNKNOWN
 *   · EvidenceRef          — sourceRef + observedAt + trust + contentHash
 *   · EVIDENCE_STRENGTH    — an 8-rung ladder compile-time-locked to the
 *                            memory commit gateway's own vocabulary
 *   · `volatility`         — "how fast the fact can change", which is
 *                            precisely the freshness axis
 *
 * Building a second media-shaped evidence vocabulary beside that would
 * have been the parallel-taxonomy mistake claims.ts's own header warns
 * against. So this module produces EvidenceRef values FOR that ledger
 * instead.
 *
 * ★ AND claims.ts HAS ZERO IMPORTERS. It is built, typed, tested and
 * completely unwired — the BUILT-TESTED-UNWIRED shape this repo has hit
 * four times before. Media is a good first producer precisely because
 * attaching a file is an unambiguous, operator-initiated observation:
 * there is no modelling judgment to get wrong on the way in.
 *
 * WHAT IS GENUINELY NEW HERE
 * Media has CAPABILITY states the claim ledger has no opinion about —
 * whether a clip is playable, transcribed, analyzed, cited, saved. Those
 * are not evidence classes and must not be mapped onto the ladder; a
 * transcribed video is not "better evidence" than an untranscribed one,
 * it is merely more USABLE. Keeping the two axes separate is the whole
 * design.
 *
 * Pure: no I/O, no clock (timestamps are passed in), no DOM.
 */

import {
  EVIDENCE_STRENGTH,
  type EvidenceRef,
} from "@/lib/ai/vnext/truth/claims";

/**
 * Capability states for a media item. ORTHOGONAL to evidence class —
 * see the header. Ordered by pipeline progression so a UI can render
 * them as a ladder without inventing its own ordering.
 */
export const MEDIA_STATES = [
  "playable",
  "transcribed",
  "analyzed",
  "cited",
  "saved",
] as const;

export type MediaState = (typeof MEDIA_STATES)[number];

/** How the media entered the system. Drives trust, and nothing else. */
export type MediaOrigin =
  /** The operator attached it themselves. */
  | "operator_upload"
  /** Captured by an instrument we run (screen/session capture). */
  | "system_capture"
  /** A URL or file that arrived via tool output, scrape, or a document. */
  | "external_fetch";

export interface MediaProvenanceInput {
  /** Stable id — message part id, videoId, or session id. */
  id: string;
  origin: MediaOrigin;
  /** Capability states currently true of this item. */
  states: readonly MediaState[];
  /** Optional content hash, when the pipeline computed one. */
  contentHash?: string;
}

/**
 * `observedAt` is deliberately NOT part of MediaProvenanceInput.
 *
 * The display path does not need it, and a caller that lacks a real
 * observation time would be pushed into inventing one — an epoch or a
 * render-time `new Date()`. Both are fabricated provenance, which is the
 * failure BDN-310's migration refuses to commit at the schema level
 * (no backfill of valid_from = created_at) and which
 * react-hooks/purity forbids in a render besides. So the timestamp is
 * required only where it is genuinely used: minting an EvidenceRef.
 */

/**
 * Trust is decided by ORIGIN alone, never by how processed the media is.
 *
 * A scraped video that has been transcribed and analyzed is still
 * untrusted content — running our own pipeline over hostile input does
 * not launder it. claims.ts enforces the consequence: untrusted evidence
 * can INFORM a claim but can never SUPPORT one. This is the same
 * fenced-content discipline the system prompt applies to tool output.
 */
export function trustForOrigin(origin: MediaOrigin): EvidenceRef["trust"] {
  return origin === "external_fetch" ? "UNTRUSTED" : "TRUSTED";
}

/**
 * Map origin → evidence class on the incumbent ladder.
 *
 *   operator_upload → operator_stated    (strength 6, the top rung)
 *   system_capture  → direct_observation (4 — an instrument we run)
 *   external_fetch  → external_source    (3, and UNTRUSTED besides)
 *
 * Deliberately NOT influenced by MediaState: transcription does not
 * promote a clip up the ladder. It changes what we can DO with it, not
 * where it came from.
 */
export function evidenceClassForOrigin(origin: MediaOrigin): EvidenceRef["evidenceClass"] {
  switch (origin) {
    case "operator_upload":
      return "operator_stated";
    case "system_capture":
      return "direct_observation";
    case "external_fetch":
      return "external_source";
  }
}

/** `media:<id>` — the sourceRef namespace for media, beside brain:/receipt:. */
export function mediaSourceRef(id: string): string {
  return `media:${id}`;
}

/**
 * Build the EvidenceRef a claim would cite when it rests on this media.
 *
 * Returns a value for the INCUMBENT ledger — this module deliberately
 * owns no schema of its own.
 */
export function toEvidenceRef(input: MediaProvenanceInput, observedAt: string): EvidenceRef {
  return {
    id: input.id,
    evidenceClass: evidenceClassForOrigin(input.origin),
    sourceRef: mediaSourceRef(input.id),
    observedAt,
    trust: trustForOrigin(input.origin),
    ...(input.contentHash ? { contentHash: input.contentHash } : {}),
  };
}

/**
 * Can a claim rest on this media ALONE?
 *
 * Mirrors claims.ts's SUPPORT_THRESHOLD (external_source, rung 3) and
 * its trust rule, rather than re-deciding either. Untrusted media never
 * qualifies regardless of ladder position.
 */
export function canSupportAlone(input: MediaProvenanceInput): boolean {
  if (trustForOrigin(input.origin) === "UNTRUSTED") return false;
  return EVIDENCE_STRENGTH[evidenceClassForOrigin(input.origin)] >= EVIDENCE_STRENGTH.external_source;
}

export interface MediaProvenanceView {
  /** States in pipeline order, for rendering as a ladder. */
  states: MediaState[];
  /** States NOT yet reached — rendered as absent, never as failed. */
  missing: MediaState[];
  trust: EvidenceRef["trust"];
  evidenceClass: EvidenceRef["evidenceClass"];
  /** True when a claim may rest on this media alone. */
  canSupportAlone: boolean;
  /**
   * Plain-language caveats for display. An empty array means the item is
   * unremarkable — never render a reassuring "verified" badge from it.
   */
  caveats: string[];
}

/**
 * Assemble the display model.
 *
 * Honest-state contract, matching house doctrine: a state that has not
 * been reached is reported as MISSING, never as failed and never
 * silently omitted. "No transcript" and "transcription failed" are
 * different facts and this view refuses to conflate them — it only ever
 * claims the first, because the second is not knowable from these inputs.
 */
export function buildMediaProvenance(input: MediaProvenanceInput): MediaProvenanceView {
  const present = new Set(input.states);
  const states = MEDIA_STATES.filter((s) => present.has(s));
  const missing = MEDIA_STATES.filter((s) => !present.has(s));

  const trust = trustForOrigin(input.origin);
  const caveats: string[] = [];

  if (trust === "UNTRUSTED") {
    caveats.push("External source — can inform an answer but never support one on its own.");
  }
  if (!present.has("transcribed")) {
    caveats.push("No transcript — nothing in this item has been read, only played.");
  }
  if (present.has("cited") && !present.has("transcribed")) {
    // The highest-value caveat in the set: a citation with no transcript
    // means the model referred to media it could not have read.
    caveats.push("Cited without a transcript — the reference is not grounded in its contents.");
  }

  return {
    states,
    missing,
    trust,
    evidenceClass: evidenceClassForOrigin(input.origin),
    canSupportAlone: canSupportAlone(input),
    caveats,
  };
}
