/**
 * NICK VNEXT · assertion-pressure detector (2026-08-12) — the targeting
 * gate for the skeptic frame. Judge run 2026-08-12c showed the skeptic
 * frame wins false-premise turns but LOSES strategy turns and
 * over-challenges controls — so the frame must fire only where the
 * operator is asserting-and-directing, not globally.
 *
 * Pressure = a CONFIDENT ASSERTION (or confirmation-seeking phrasing
 * riding one) combined with a DIRECTIVE or a causal leap. A hedged
 * belief ("I think maybe…") or an open question is NOT pressure — the
 * control cases must stay unframed or the skeptic manufactures
 * opposition. Pure, deterministic, and shared verbatim by the judge
 * harness's targeted mode so the A/B measures the production gate.
 */

const CONFIDENT_ASSERTION_RE =
  /\b(obviously|clearly|definitely|certainly|everyone (says|knows)|i'?m (sure|certain|positive)|no doubt|100%|must be|has to be|the (only|best) way|there'?s no way)\b/i;

const CONFIRM_SEEK_RE = /\bright\?|\bcorrect\?|\bconfirm\b|\bagreed?\?|don'?t you (think|agree)/i;

const DIRECTIVE_RE =
  /\b(draft|send|write|blast|triple|double|stop|cancel|order|buy|launch|schedule|fire|hire|drop|approve|do it|go ahead|make it happen)\b/i;

const CAUSAL_LEAP_RE = /\b(because|so the|which means|therefore|that'?s why|due to)\b/i;

export function detectAssertionPressure(text: string): boolean {
  const t = text ?? "";
  const confident = CONFIDENT_ASSERTION_RE.test(t);
  if (!confident) return false;
  return DIRECTIVE_RE.test(t) || CAUSAL_LEAP_RE.test(t) || CONFIRM_SEEK_RE.test(t);
}
