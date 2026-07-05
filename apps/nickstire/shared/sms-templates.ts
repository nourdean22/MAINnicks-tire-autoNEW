/**
 * Canonical operator SMS templates — wave-181.75.
 *
 * Short, Nick's-voice presets the operator can fire from the admin SMS
 * composer with one tap. Texts come from the F25e on the shop's public
 * line (BUSINESS.phone in shared/business.ts) so the recipient already
 * sees the shop's real number · templates DON'T need to re-state the
 * phone number in every body (less spam-y, more conversational).
 * (2026-07-05 · digits removed from this comment: lint:pii's area-code
 * heuristic flagged them; it was the shop's own public number, not PII,
 * but the constant reference is truer anyway.)
 *
 * Placeholder substitution:
 *   {{name}}    · customer first name (fallback: "there")
 *   {{vehicle}} · year+make+model on file (fallback: "your car")
 *
 * Length budget · under 160 chars where possible (single SMS segment).
 * Over 160 = concatenated SMS (still delivered · slightly higher cost on
 * Twilio, free on F25e). All templates here are single-segment except
 * `quote_followup` which carries the Repair Haiku promise.
 *
 * Brand-voice anchor (wave-181.43+): "Free check. Written quote. You
 * don't pay until you say yes." — repeated where it serves the message.
 */

export interface SmsTemplate {
  /** Stable key for analytics + persistence */
  key: string;
  /** Operator-facing button label (≤ 16 chars · fits chip) */
  label: string;
  /** One-line description for tooltips / settings views */
  description: string;
  /** Template body with {{name}} / {{vehicle}} placeholders */
  body: string;
}

export const SMS_TEMPLATES: SmsTemplate[] = [
  {
    key: "quick_checkin",
    label: "Check-in",
    description: "Light touch — just saying hi, no specific ask",
    body: "Hey {{name}} — just checking in. Anything you need for the car? — Nick",
  },
  {
    key: "vehicle_ready",
    label: "Ready for pickup",
    description: "Vehicle is done, come pick it up",
    body: "Hey {{name}} — {{vehicle}} is ready. Come by anytime, we close at 6. — Nick",
  },
  {
    key: "quote_followup",
    label: "Quote follow-up",
    description: "Circling back on a walked-away estimate",
    body: "Hey {{name}} — circling back on that quote. We'll honor it. Free re-check first. You don't pay until you say yes. — Nick",
  },
  {
    key: "tire_in_stock",
    label: "Tires in",
    description: "Matching tires for their vehicle arrived",
    body: "Hey {{name}} — got matching tires for {{vehicle}} in today. Drop by or call when you're ready. — Nick",
  },
  {
    key: "appt_confirm",
    label: "Confirm appt",
    description: "Confirm tomorrow's appointment",
    body: "Hey {{name}} — confirming we're seeing you tomorrow. Reply C to confirm, R to reschedule. — Nick",
  },
  {
    key: "late_pickup",
    label: "Still here",
    description: "Vehicle was done but not picked up",
    body: "Hey {{name}} — {{vehicle}} is still here. We close at 6. Let me know if you need a different pickup window. — Nick",
  },
  {
    key: "referral_ask",
    label: "Referral ask",
    description: "Post-service · ask for referrals from happy customer",
    body: "Hey {{name}} — glad we got you handled. If you know anyone needing tires or a repair, send 'em our way. Thanks. — Nick",
  },
  {
    key: "price_match",
    label: "Price match",
    description: "We'll match a competitor's quote",
    body: "Hey {{name}} — we match local prices on tires. Send the other quote and we'll work it out. — Nick",
  },
];

/**
 * Render a template body with placeholders filled in. Missing context falls
 * back to friendly defaults rather than leaving raw `{{name}}` in customer-
 * facing text.
 */
export function renderSmsTemplate(
  body: string,
  ctx: { name?: string | null; vehicle?: string | null },
): string {
  const name = (ctx.name || "").trim().split(/\s+/)[0] || "there";
  const vehicle = (ctx.vehicle || "").trim() || "your car";
  return body
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*vehicle\s*\}\}/gi, vehicle);
}
