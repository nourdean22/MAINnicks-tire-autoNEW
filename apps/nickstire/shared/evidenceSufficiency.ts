/**
 * Is there enough CONCRETE, TRUTHFUL material here to write something specific?
 *
 * WHY THIS EXISTS
 * `source_grounding` scored a draft by asking whether the operator had TYPED
 * ANYTHING: `input.source.detail?.trim() || input.source.recordId?.trim() ? 8 : 6`
 * (services/instagramStudio.ts). One character in the context box earned 8/10
 * and silenced the warning that would otherwise have held the draft at `warn`.
 * The dimension therefore measured string non-emptiness and reported it as
 * grounding — a proxy that cannot fail, which is the same class of defect as a
 * search that returns HTTP 200 with zero results.
 *
 * WHAT IT IS AND IS NOT
 * This is a DETERMINISTIC assessor over RESOLVED FACTS, not a model call and
 * not a field count. Counting fields was the tempting rule and it is wrong: one
 * real customer sentence ("Mike showed me exactly why the tire couldn't be
 * patched") is stronger evidence than three weak metadata fields, because a
 * verbatim human quote cannot be produced by a model that lacks it. So the rule
 * grades by what a fact can DO for the copy, via `role`:
 *
 *   quote     — verbatim human words. Publishable on its own.
 *   anchor    — the specific thing (a vehicle, a named service, an offer title).
 *   temporal  — a specific when.
 *   magnitude — a number with meaning (price, mileage, rating, discount).
 *   context   — supporting but non-specific. Never sufficient alone.
 *
 * BASIS IS SEPARATE FROM ROLE, and it is the safety half. A fact that was
 * INFERRED must never be asserted as recorded truth. The live declined-work
 * lane is exactly this case: `alg_estimates` has no `declined` column, so a
 * decline is derived from `matched_invoice_id IS NULL` — an estimate the fuzzy
 * matcher merely failed to clear is indistinguishable from a customer refusal.
 * Publishing "this customer declined the brakes" from that is fabrication, so
 * `inferred` facts can support a THIN assessment but never a sufficient one on
 * their own, and they are reported back by key so the caller can qualify them.
 */

export type EvidenceFactRole = "quote" | "anchor" | "temporal" | "magnitude" | "context";

/**
 * How a fact was established. This is a TRUTH grade, deliberately independent
 * of `role`, which is a USEFULNESS grade.
 *
 * recorded — a stored value that means what it says (review text, estimate date).
 * inferred — derived from the absence or shape of other data. Qualify, never assert.
 * operator — typed by a human this turn. Honest intent, but nothing verified it.
 */
export type EvidenceFactBasis = "recorded" | "inferred" | "operator";

export interface EvidenceFact {
  /** stable machine key, e.g. "vehicle" | "declined_service" | "review_quote" */
  key: string;
  /** operator-facing label — also what the prompt sees, so it must read as prose */
  label: string;
  value: string;
  role: EvidenceFactRole;
  basis: EvidenceFactBasis;
}

export type EvidenceSufficiency = "sufficient" | "thin" | "insufficient";

export interface EvidenceAssessment {
  sufficiency: EvidenceSufficiency;
  /** Deterministic, operator-safe explanation. Shown verbatim in the UI. */
  reason: string;
  /** 0–10 for the `source_grounding` dimension. */
  groundingScore: number;
  /** Keys whose basis is `inferred` — copy must qualify these, never assert them. */
  inferredKeys: string[];
  /** What would raise the verdict, named concretely. */
  missing: string[];
}

/**
 * A quote shorter than this is a fragment, not a story. 60 chars is roughly one
 * full spoken sentence — long enough that it carries its own specificity.
 */
export const QUOTE_MIN_CHARS = 60;

/**
 * Operator prose below this is a label, not a brief. Chosen because the failure
 * being fixed is a one-word context box scoring 8/10.
 */
export const OPERATOR_SUBSTANCE_MIN_CHARS = 40;

/**
 * Does this prose name something specific?
 *
 * The first version was a digit OR a non-leading capitalised word, which
 * rejected most of this shop's actual vocabulary: measured against ten realistic
 * operator briefs it called six legitimate ones insufficient, because
 * "customer came in with a bad TPMS sensor" has no digit and no
 * capital-then-lowercase token — TPMS is all caps. Forcing those briefs to
 * "produce only general education" is the opposite of the intent.
 *
 * Now: a digit, OR a word-boundary ALL-CAPS acronym of 3+ letters (TPMS, ABS,
 * TPS, DVI, VIN, AWD, ECHECK) — three not two, so "OK" and "IT" cannot make
 * filler read as specific —
 * OR a capitalised word that is not merely the first character of the sentence.
 */
function hasConcreteToken(text: string): boolean {
  if (/\d/.test(text)) return true;
  if (/\b[A-Z]{3,}\b/.test(text)) return true;
  return /\s[A-Z][a-z]{2,}/.test(text);
}

const GROUNDING_SCORE: Record<EvidenceSufficiency, number> = {
  // A resolved record whose facts can carry specific copy.
  sufficient: 10,
  // Real material, nothing verified — honest mid score. Deliberately 7, not 6:
  // 7 stays at/above the dimension's warning threshold so a legitimate
  // operator-authored brief does not permanently warn, while still landing
  // BELOW the 8 that typing a single character used to earn.
  thin: 7,
  // Nothing concrete. MUST land in the WARN band, not below it.
  //
  // This was 3, which was a real regression: scoreStatus treats < 5 as "block",
  // and the evaluator's warning loop collects only dimensions whose status is
  // exactly "warn". A score of 3 therefore produced NEITHER a blocker NOR a
  // warning, so a completely ungrounded draft could reach gate "pass" — where the
  // old rule's 6 held it at "warn". Aiming for severity made the gate weaker.
  // 5 is the floor of the warn band: strictly below the 8 that typing one
  // character used to earn, and still loud.
  insufficient: 5,
};

function has(facts: EvidenceFact[], role: EvidenceFactRole): boolean {
  return facts.some((f) => f.role === role);
}

/**
 * Assess resolved evidence.
 *
 * `operatorText` is the free-text context box. It is assessed separately from
 * `facts` because it is unverified by construction and must not be able to
 * reach `sufficient` — otherwise typing prose would again be indistinguishable
 * from resolving a record, which is the defect this module exists to close.
 */
export function assessEvidence(
  facts: EvidenceFact[],
  operatorText?: string | null,
): EvidenceAssessment {
  const inferredKeys = facts.filter((f) => f.basis === "inferred").map((f) => f.key);
  // Only recorded facts can establish sufficiency. Inferred and operator facts
  // are real inputs but cannot license an assertion of fact.
  const recorded = facts.filter((f) => f.basis === "recorded");

  const strongQuote = recorded.find(
    (f) => f.role === "quote" && f.value.trim().length >= QUOTE_MIN_CHARS,
  );
  if (strongQuote) {
    return {
      sufficiency: "sufficient",
      reason: `Verbatim quote from a stored record (${strongQuote.label}) — specific enough to write from directly.`,
      groundingScore: GROUNDING_SCORE.sufficient,
      inferredKeys,
      missing: [],
    };
  }

  const anchor = has(recorded, "anchor");
  const temporal = has(recorded, "temporal");
  const magnitude = has(recorded, "magnitude");

  if (anchor && (temporal || magnitude)) {
    const pair = temporal ? "a specific date" : "a specific figure";
    return {
      sufficiency: "sufficient",
      reason: `Resolved record names a specific subject plus ${pair} — enough to be concrete without inventing detail.`,
      groundingScore: GROUNDING_SCORE.sufficient,
      inferredKeys,
      missing: [],
    };
  }

  // Below sufficiency. Establish whether there is real material to degrade to.
  const text = (operatorText ?? "").trim();
  const operatorHasSubstance =
    text.length >= OPERATOR_SUBSTANCE_MIN_CHARS && hasConcreteToken(text);
  const anyConcreteFact = facts.some((f) => f.role !== "context");

  if (anchor) {
    return {
      sufficiency: "thin",
      reason:
        "A subject is resolved but nothing dates or quantifies it — copy will stay general unless a date or figure is added.",
      groundingScore: GROUNDING_SCORE.thin,
      inferredKeys,
      missing: ["a date for the event", "or a figure (price, mileage, rating)"],
    };
  }

  if (operatorHasSubstance || anyConcreteFact) {
    return {
      sufficiency: "thin",
      reason: anyConcreteFact
        ? "Only unverified or inferred facts are available — usable as direction, not as a stated fact."
        : "Operator-written context with real detail, but no stored record backs it — treat as a brief, not as proof.",
      groundingScore: GROUNDING_SCORE.thin,
      inferredKeys,
      missing: ["a stored record (review, estimate, offer) to verify the specifics"],
    };
  }

  return {
    sufficiency: "insufficient",
    reason:
      "No concrete evidence — not enough here to say anything specific that is also true.",
    groundingScore: GROUNDING_SCORE.insufficient,
    inferredKeys,
    missing: [
      "select a real record, or",
      `write at least ${OPERATOR_SUBSTANCE_MIN_CHARS} characters naming what actually happened`,
    ],
  };
}

/**
 * The instruction the generator gets. Weak evidence must produce an explicit
 * "stay general" order, because the observed failure mode is a model handed a
 * category label and filling the specificity gap with plausible invention.
 */
export function evidenceDirective(assessment: EvidenceAssessment): string {
  const qualify = assessment.inferredKeys.length
    ? ` These facts are INFERRED, not recorded — qualify them ("hasn't come back in", "still open") and never state them as a customer's decision: ${assessment.inferredKeys.join(", ")}.`
    : "";

  switch (assessment.sufficiency) {
    case "sufficient":
      return `EVIDENCE: strong. Build the piece around the specific facts listed above and add NO detail that is not among them.${qualify}`;
    case "thin":
      return `EVIDENCE: thin — ${assessment.reason} Write something useful and GENERAL. Do NOT invent a customer, a vehicle, a date, a price, or an outcome to make it feel specific.${qualify}`;
    case "insufficient":
      return `EVIDENCE: insufficient — ${assessment.reason} Produce only general education that would be true on any day at any shop. Invent NOTHING.${qualify}`;
  }
}
