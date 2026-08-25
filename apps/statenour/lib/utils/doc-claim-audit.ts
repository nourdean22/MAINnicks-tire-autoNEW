/**
 * Does a doc credit a gate with checks the gate does not perform?
 *
 * WHY THIS IS A FUNCTION AND NOT A TEST. The canary that used to enforce this
 * asserted `expect(DESIGN.md).toContain("rounded corners")` — it was hard-coded
 * to a live doc entry. That is a permanent control coupled to a temporary datum:
 * the day someone correctly retires that convention, the test cannot pass, so it
 * stands between a correct fix and a green build. One of ours was deleted for
 * exactly that reason, which is the worst outcome available — the control did
 * not merely fail, it got removed, and the rule it protected went with it.
 *
 * The durable invariant is not "the doc says X". It is:
 *
 *     a doc must not attribute a check to a gate that does not run that check
 *
 * That survives every legitimate edit. Add a convention, remove one, reword all
 * five — the rule still means the same thing, and the test only fails when the
 * doc actually starts lying again.
 *
 * Pure, so the canary drives it with SYNTHETIC docs it controls and asserts on
 * both outcomes. The live doc is then one more input, not the fixture.
 */

export interface ClaimAudit {
  /** Claims the doc attributes to the gate that the gate does not implement. */
  unbacked: string[];
  /** True when the doc is honest about what the gate covers. */
  ok: boolean;
}

/**
 * @param docText      the documentation making the claims
 * @param gateSource   the gate's own source, used to detect what it really checks
 * @param claimHeading the marker after which claims are attributed to the gate.
 *                     Everything from here to the next blank-line-separated
 *                     paragraph break is read as gate-attributed.
 * @param vocabulary   candidate check names to look for in the attributed block
 */
export function auditGateClaims(
  docText: string,
  gateSource: string,
  claimHeading: string,
  vocabulary: readonly string[],
): ClaimAudit {
  const at = docText.indexOf(claimHeading);
  if (at === -1) {
    // No attribution block at all is HONEST — a doc that claims nothing cannot
    // over-claim. Returning ok here is what lets the conventions section be
    // deleted, reworded or moved without this control objecting.
    return { unbacked: [], ok: true };
  }

  // The attributed region ends at the first blank line following the bullet run,
  // so prose further down the file is not read as a gate claim.
  const rest = docText.slice(at + claimHeading.length);
  const end = rest.search(/\n\s*\n/);
  const block = end === -1 ? rest : rest.slice(0, end);

  const unbacked = vocabulary.filter(
    (term) => block.toLowerCase().includes(term.toLowerCase()) && !gateSource.toLowerCase().includes(term.toLowerCase()),
  );

  return { unbacked, ok: unbacked.length === 0 };
}
