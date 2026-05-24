/**
 * Declined-Work Recovery Sequence · 5 touches × 3 profiles = 15 variants
 *
 * Replaces the wave-181.59 2-touch (7d/30d) blast with a profile-aware
 * sequence: 3d → 7d → 14d → 30d → 45d.
 *
 * Profiles (sticky per estimate · cached in alg_estimates.recovery_profile):
 *   P1 — broke_brenda    money is the blocker → lead with financing
 *   P2 — skeptical_pat   trust is the blocker → lead with proof/transparency
 *   P3 — busy_tim        time is the blocker → lead with drop-off + Uber
 *
 * Every variant:
 *   - Ends with the canonical Repair Haiku close ("you don't pay until
 *     you say yes" or "no charge until you say yes")
 *   - Carries STOP opt-out keyword (TCPA)
 *   - Uses customer language (per .claude/brand-voice-guidelines.md §4):
 *     fix not repair · check not inspection · today not same-day · drop
 *     it off not leave it with us
 *   - ≤320 chars (≤2 SMS segments via shop gateway)
 *   - No kill-list words (trusted/expert/quality/premium/comprehensive/
 *     hassle-free/state-of-the-art/top-notch/inspection/diagnostic/
 *     approval/no surprises)
 *
 * Integration · called by server/cron/jobs/declinedWorkRecovery.ts which
 * iterates touch order (30d > 14d > 7d > 45d > 3d) and respects the
 * existing at-most-once claim pattern + sms.ts rails.
 *
 * Sequence design rationale per agent #1 research report:
 *   D3 · friendly check-in (caller's still warm)
 *   D7 · practical reminder + value reframe
 *   D14 · cost-of-waiting math (real, not scary)
 *   D30 · final invitation, lowered urgency
 *   D45 · long-tail soft touch
 */

import type { AlgEstimate } from "../../drizzle/schema";

export type RecoveryProfile = "P1" | "P2" | "P3";
export type RecoveryTouch = "3d" | "7d" | "14d" | "30d" | "45d";

interface BuildParams {
  touch: RecoveryTouch;
  profile: RecoveryProfile;
  name: string;
  amountCents: number;
  serviceDescription: string | null;
  customer?: {
    totalVisits?: number | null;
    vehicleYear?: string | null;
    vehicleMake?: string | null;
    vehicleModel?: string | null;
  } | null;
}

// ─── Profile picker ───────────────────────────────────────────────
//
// Deterministic so the same estimate always lands on the same profile
// across touches. Order matters · busy_tim short-circuits luxury vehicle
// (commuters drive luxury too); broke_brenda short-circuits decline rate
// (price-sensitive trumps everything else).
//
// Inputs are limited to what alg_estimates + customers already exposes
// at query time · no extra joins needed.
export function pickProfile(args: {
  amountCents: number;
  serviceDescription: string | null;
  totalVisits?: number | null;
  vehicleMake?: string | null;
  vehicleYear?: string | null;
  // declineRate is computed by caller from customer_metrics if available
  declineRate?: number | null;
  customerType?: "individual" | "commercial" | null;
}): RecoveryProfile {
  const {
    amountCents,
    serviceDescription,
    totalVisits = 0,
    vehicleMake,
    declineRate,
    customerType,
  } = args;

  // Commercial fleet → busy_tim (drop-off + Uber framing fits)
  if (customerType === "commercial") return "P3";

  // High decline rate → broke_brenda (price-sensitive trumps else)
  if (typeof declineRate === "number" && declineRate >= 0.5) return "P1";

  // Repeat customer (3+ visits) + work historically declined →
  // skeptical_pat (they came back but didn't say yes — trust gap)
  if ((totalVisits ?? 0) >= 3 && (declineRate ?? 0) >= 0.3) return "P2";

  // Luxury vehicle marque → busy_tim by default (income proxy → time
  // is the constraint, not money)
  const luxury = /\b(lexus|bmw|mercedes|audi|acura|infiniti|porsche|cadillac|lincoln)\b/i;
  if (vehicleMake && luxury.test(vehicleMake)) return "P3";

  // Large declined ticket on infrequent customer → broke_brenda
  // (sticker shock is the blocker for occasional drivers)
  if ((totalVisits ?? 0) <= 1 && amountCents >= 100000) return "P1";

  // Service-category cue: safety items (brakes/tires) skew skeptical
  // (they want proof before spending), maintenance skews busy
  const svc = (serviceDescription || "").toLowerCase();
  if (/\b(brake|tire|caliper|rotor|suspension|alignment)\b/.test(svc)) {
    return "P2";
  }

  // Default fallback · busy_tim (most Cleveland drivers are time-
  // constrained, not money-constrained · default to the gentlest
  // message track)
  return "P3";
}

// ─── Vehicle + service clause builders (shared with all variants) ──

function buildVehicleClause(customer?: BuildParams["customer"]): string {
  const year = customer?.vehicleYear?.trim();
  const make = customer?.vehicleMake?.trim();
  const model = customer?.vehicleModel?.trim();
  const parts = [year, make, model].filter(Boolean).join(" ").toLowerCase();
  const sanitized = parts.replace(/\bnull\b/g, "").trim();
  return sanitized ? `your ${sanitized}` : "your car";
}

function buildServiceClause(serviceDescription: string | null): string {
  const svc = (serviceDescription || "").toLowerCase();
  if (/\b(brake|caliper|rotor|pad)\b/.test(svc)) return "brake job";
  if (/\b(tire|alignment|rotation)\b/.test(svc)) return "tire work";
  if (/\b(suspension|strut|shock|control arm|ball joint)\b/.test(svc)) return "suspension work";
  if (/\b(oil|filter|fluid|coolant)\b/.test(svc)) return "maintenance";
  if (/\b(transmission|engine|catalytic)\b/.test(svc)) return "the fix";
  if (serviceDescription && serviceDescription.length > 0 && serviceDescription.length < 40) {
    return serviceDescription.toLowerCase();
  }
  return "the work we quoted";
}

function formatMoney(amountCents: number): string {
  const dollars = Math.round(amountCents / 100);
  return `$${dollars.toLocaleString()}`;
}

// ─── 15-variant template engine ────────────────────────────────────
//
// Each variant is a string-template function. Keep them small + flat
// so the brand-voice linter (pre-commit) can scan each line.
//
// To audit a single variant in the operator chat:
//   buildSequenceMessage({ touch: "14d", profile: "P2", name: "Test",
//     amountCents: 48700, serviceDescription: "brake pads + rotors" })

export function buildSequenceMessage(params: BuildParams): string {
  const { touch, profile, name, amountCents, serviceDescription, customer } = params;
  const money = formatMoney(amountCents);
  const vehicle = buildVehicleClause(customer);
  const service = buildServiceClause(serviceDescription);

  // P1 · broke_brenda · money is the blocker
  if (profile === "P1") {
    switch (touch) {
      case "3d":
        return `Hey ${name} — Nick's. That ${money} ${service} on ${vehicle}? $10 down splits it across 4 lenders, no FICO ding. Free re-check first. You don't pay until you say yes. Reply STOP to opt out.`;
      case "7d":
        return `${name}, the ${money} ${service} quote is still good. Soft pre-qual in 60s — Acima, Snap, Koalafi, American First. One says no, the next says yes. (216) 862-0005. STOP to opt out.`;
      case "14d":
        return `${name} — heads up. ${money} now is usually 60-90% cheaper than the same fix after it gets worse. $10 down + payment programs. Free re-check, written quote, you don't pay until you say yes. STOP to opt out.`;
      case "30d":
        return `${name}, last nudge — we'll honor the ${money} quote on ${vehicle} this week. $10 down splits the bill 4 ways. Free check first, no charge. Reply or call (216) 862-0005. STOP to opt out.`;
      case "45d":
        return `${name} — that ${vehicle} still doing OK? If the ${service} is still on your mind, 4 lenders + $10 down still works. Just pull up, free check, no obligation. STOP to opt out.`;
    }
  }

  // P2 · skeptical_pat · trust is the blocker
  if (profile === "P2") {
    switch (touch) {
      case "3d":
        return `Hey ${name} — Nick's. That ${money} ${service} quote on ${vehicle}? The photos + the worn part are still on file. Free re-check anytime. You don't pay until you say yes. STOP to opt out.`;
      case "7d":
        return `${name}, that ${service} quote: written before any wrench moved. We walked you under the car last time — same setup if you come back. Free check, no charge until you say yes. (216) 862-0005. STOP to opt out.`;
      case "14d":
        return `${name} — we don't push fixes you don't need. The ${money} ${service} on ${vehicle} was real. If you got a second opinion that says otherwise, bring it. We'll compare side-by-side. Free re-check. STOP to opt out.`;
      case "30d":
        return `${name}, the ${money} ${service} quote on ${vehicle} is in our system through next week. Same lift, same tech walking you under the car. Free re-check first. You don't pay until you say yes. STOP to opt out.`;
      case "45d":
        return `${name} — checking in on ${vehicle}. ${service} still on the list? Our quote was ${money}, written, no fluff. Stop by when ready, free re-check, no charge. STOP to opt out.`;
    }
  }

  // P3 · busy_tim · time is the blocker
  switch (touch) {
    case "3d":
      return `Hey ${name} — Nick's. The ${money} ${service} on ${vehicle}? Drop the keys before work, Uber to office, we text when done. Free re-check, no charge until you say yes. STOP to opt out.`;
    case "7d":
      return `${name}, that ${service} quote is still good. Drop-off + free Uber both ways. Most done same day. (216) 862-0005 to lock the slot. Free check, written quote, you don't pay until you say yes. STOP to opt out.`;
    case "14d":
      return `${name} — quick note. Waiting on ${service} usually turns 1 trip into 3 (now → tow → worse fix later). Drop ${vehicle} off this week, we Uber you back. Free re-check. STOP to opt out.`;
    case "30d":
      return `${name}, last call before we close the file on the ${money} ${service}. Drop-off + same-day on most jobs + we text when ready. Free re-check first. You don't pay until you say yes. STOP to opt out.`;
    case "45d":
      return `${name} — ${vehicle} still need that ${service}? Walk in 7 days. Drop the keys, Uber home, we handle it. Free check. (216) 862-0005. STOP to opt out.`;
  }
}

// ─── Touch order (priority for the cron loop) ───────────────────────
//
// Process touches in this order each cron run · descending urgency.
// The first claim wins per run (per-run cap), so older touches get
// priority on a busy day. 45d is bottom because it's the soft tail.
export const TOUCH_ORDER: RecoveryTouch[] = ["30d", "14d", "7d", "45d", "3d"];

// ─── Touch-day windows (cron uses these to gate selection) ─────────
//
// Returns the SQL DATE_SUB INTERVAL value as a day count. The cron's
// WHERE clause becomes:
//   estimate_date <= NOW() - INTERVAL <days> DAY
//     AND follow_up_<touch>_attempted_at IS NULL
//     AND matched_invoice_id IS NULL
export function touchToDays(touch: RecoveryTouch): number {
  switch (touch) {
    case "3d": return 3;
    case "7d": return 7;
    case "14d": return 14;
    case "30d": return 30;
    case "45d": return 45;
  }
}

// ─── Variant key for sms_messages.variantKey (A/B attribution) ─────
//
// Format: declined_<touch>_<profile> · 50-char field, fits comfortably.
// Powers the SMS Performance tile per-touch + per-profile breakouts
// (sms_variant_idx already indexed at schema.ts).
export function variantKey(touch: RecoveryTouch, profile: RecoveryProfile): string {
  return `declined_${touch.replace("d", "")}d_${profile}`;
}
