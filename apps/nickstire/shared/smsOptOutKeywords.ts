/**
 * The opt-out vocabulary — ONE list, because it had drifted into three.
 *
 * Before this file the index query that decides who is suppressed matched ten
 * words, while the inbound handler that reacts in the moment matched five, and
 * a marketing engine matched a fourth set. Nobody was un-suppressed by that —
 * the index re-derives from raw inbound bodies and is the real safety net — but
 * a customer texting STOPALL or REVOKE got no confirmation reply, no
 * `sms.opt_out` compliance row, and stayed sendable until the 5-minute cache
 * turned over. On the one control where a miss is a federal statutory
 * violation, "eventually correct" is the wrong shape.
 *
 * WHY EXACT-MATCH ON THE WHOLE TRIMMED BODY, and not a substring search:
 * inbound spam routinely carries a "...Reply STOP" footer. Matching a substring
 * would suppress people who never asked for it, which fails in the direction
 * that costs the shop revenue and looks identical to a bug. The trade is
 * documented at the index query and is deliberate.
 *
 * NOT COVERED, and named so nobody assumes otherwise: the FCC's April 2025
 * revocation rule lets a consumer revoke by any reasonable method, including
 * plain English ("stop texting me", "take me off this list"). No list of exact
 * keywords can catch that, so it stays a human-review question rather than a
 * silent claim of completeness.
 */
export const SMS_OPT_OUT_KEYWORDS = [
  "STOP",
  "STOPALL",
  "STOP ALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
  "OPT OUT",
] as const;

/**
 * ★ THIS LIST IS FOR THE SUPPRESSION INDEX, NOT THE LIVE PARSER. Do not
 * "unify" `server/services/smsResponseParser.ts` onto it.
 *
 * That parser is the one the production webhooks actually reach
 * (smsResponseJobs -> smsOrchestrator -> parseSmsResponse) and its semantics
 * differ ON PURPOSE: it is prefix-anchored rather than whole-body, it accepts
 * "remove me", and it deliberately EXCLUDES `CANCEL`, because for an auto shop
 * a lone "cancel" means cancel-my-appointment. Applying this list there would
 * unsubscribe a customer from all SMS for cancelling one booking — a defect the
 * codebase has already seen and written down (`server/_core/index.ts`).
 *
 * The overlap that MUST hold is narrower: every word here should be reachable
 * by one path or the other, and `optOutVocabulary.test.ts` pins REVOKE in the
 * live parser for exactly that reason.
 */

/** Opt-IN vocabulary — the START side of the same door. */
export const SMS_OPT_IN_KEYWORDS = ["START", "YES", "UNSTOP"] as const;

/** True when a whole inbound message body is an opt-out request. */
export function isOptOutBody(body: string): boolean {
  const normalized = body.trim().toUpperCase().replace(/\s+/g, " ");
  return (SMS_OPT_OUT_KEYWORDS as readonly string[]).includes(normalized);
}
