/**
 * Fabrication rewriter · v10.0.162 · L2 defense
 *
 * When the v10.0.160 detector flags an assistant message as
 * fabricated (claimed past-tense action without a tool call),
 * this module rewrites the text to a hedged version BEFORE the
 * message is persisted to ChatMessage and BEFORE the user reads it.
 *
 * Rewrite strategy: prepend a verifier banner + keep original.
 * That way the operator still sees what was claimed (audit value)
 * but is unmistakably warned that no tool fired. The next-turn
 * conversation history loader (L3) reads the banner and tells the
 * model "this prior claim is invalid" so it can't compound.
 *
 * Why prepend rather than fully rewrite:
 *   1. The operator may want to see the original phrasing for
 *      transparency / debugging
 *   2. Fully rewriting would require an LLM call (too slow + costly
 *      for a defense layer that should be near-zero overhead)
 *   3. The action-claim-warning chip (v10.0.160) already shows the
 *      offending snippet — keeping the original lets that chip's
 *      "Nick said: '...'" quote line up with what's persisted
 *
 * Composes with:
 *   · L1 system-prompt rule (lib/ai/system-prompt.ts ANTI-FABRICATION)
 *   · L3 context correction (loader prepends [verifier note] to
 *     fabricated turns when sending history to the next call)
 */

import type { ActionClaim } from "@/lib/ai/chat/action-claim-detector";

/**
 * Banner prepended to fabricated assistant text. Marker prefix
 * `[VERIFIER · v10.0.162]` is what L3's context loader scans for so
 * it can append a system note to the next turn's history. Don't
 * change the marker without updating L3 too.
 */
const VERIFIER_MARKER = "[VERIFIER · v10.0.162]";

/**
 * 2026-07-11 review · THE single banner builder. The banner text used to
 * be hand-duplicated at three call sites (here + two inline copies in
 * persist-assistant-turn.ts), so the marker/wording could silently drift
 * and a turn tripping two enforcement layers got two stacked banners.
 * Every layer now builds through this function and guards with
 * isVerifierRewritten() first.
 */
export function buildVerifierBanner(diagnostic: string): string {
  return [
    `${VERIFIER_MARKER} ⚠ ${diagnostic} Treat the claim as **unverified**. If you want the action actually performed, ask me to retry — I'll fire the tool this time.`,
    "",
    "_Original response (unverified):_",
    "",
  ].join("\n");
}

/**
/**
 * Banner for the known-truth guard — a reply that asserts a status
 * ("deployed" / "tests passed" / "build is green") with no evidence, or
 * references retired infrastructure as current. Reuses the SAME VERIFIER_MARKER
 * so isVerifierRewritten guards against double-banners and stripVerifierBanner
 * undoes it. Wording fits a status assertion, not a missing tool call.
 */
export function buildKnownTruthBanner(kinds: string[]): string {
  const what = kinds.includes("stale_active_claim")
    ? "references retired or inactive infrastructure as if it were current"
    : "asserts a status ('deployed', 'tests passed', 'build is green') with no supporting evidence or tool receipt";
  return [
    `${VERIFIER_MARKER} ⚠ The response below ${what}. Treat the claim as **unverified** — confirm it (a receipt, a check, a real query) before relying on it.`,
    "",
    "_Original response (unverified):_",
    "",
  ].join("\n");
}

/**
 * Build the hedged-banner prefix. We name the verbs that fired no
 * tools so the operator sees the diagnostic up front.
 */
function buildBanner(claims: ActionClaim[]): string {
  const verbs = [...new Set(claims.map((c) => c.verb))].slice(0, 3);
  const verbList = verbs.join(", ");
  return buildVerifierBanner(
    `The response below claimed ${claims.length === 1 ? "an action" : "actions"} (${verbList}) but no matching tool call fired.`,
  );
}

/**
 * Rewrite an assistant message to prepend the verifier banner.
 *
 * Returns:
 *   { rewrote: false, text: original }  when no fabrication detected
 *   { rewrote: true,  text: banner+original } when fabrication present
 *
 * Pure function — no IO. Caller persists the result.
 */
export function rewriteForFabrication(
  text: string,
  fabricatedClaims: ActionClaim[],
): { rewrote: boolean; text: string; bannerLength: number } {
  if (fabricatedClaims.length === 0) {
    return { rewrote: false, text, bannerLength: 0 };
  }
  // Idempotency (2026-07-11 review) · an earlier enforcement layer
  // (receipt check / action-write verifier) may already have bannered
  // this turn — and the detector then scans banner-polluted text.
  // Stacking a second banner buries the reply; one warning is enough.
  if (isVerifierRewritten(text)) {
    return { rewrote: false, text, bannerLength: 0 };
  }
  const banner = buildBanner(fabricatedClaims);
  return {
    rewrote: true,
    text: `${banner}${text}`,
    bannerLength: banner.length,
  };
}

/**
 * Detect whether a piece of text was previously rewritten by the
 * verifier. L3 (conversation-history loader) uses this to spot
 * fabricated turns when feeding history back to the model.
 */
export function isVerifierRewritten(text: string): boolean {
  return text.startsWith(VERIFIER_MARKER);
}

/**
 * Strip the verifier banner — used when the chat surface wants to
 * render only the original text (the warning chip already conveys
 * the diagnostic visually). The banner stays in the persisted row
 * so L3 + future audits can still find it.
 */
export function stripVerifierBanner(text: string): string {
  if (!isVerifierRewritten(text)) return text;
  // Banner ends with the literal "_Original response (unverified):_"
  // line followed by a blank line. Strip everything up to and
  // including the marker line.
  const marker = "_Original response (unverified):_";
  const idx = text.indexOf(marker);
  if (idx < 0) return text;
  return text.slice(idx + marker.length).replace(/^\s+/, "");
}

export { VERIFIER_MARKER };
