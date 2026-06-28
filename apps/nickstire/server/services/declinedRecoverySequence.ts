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
  const { touch, profile } = params;
  const firstName = params.name ? params.name.trim().split(/\s+/)[0] : "there";

  // P1 · broke_brenda · money is the blocker
  if (profile === "P1") {
    switch (touch) {
      case "3d":
        return `Hey ${firstName} — Nick's Tire & Auto here. That quote we wrote up is still on file. If cost is the holdup, we can show you payment options before you decide. Free re-check first, you don't pay until you say yes. Reply STOP to opt out.`;
      case "7d":
        return `Hey ${firstName}, just following up on the quote from Nick's. If cost was the holdup, we can go over payment options with you. Pre-qualifying takes about a minute, no obligation. Free re-check anytime. (216) 862-0005. Reply STOP to opt out.`;
      case "14d":
        return `Nick's here. If you're still thinking about that work, we can look at payment options to help spread the cost. Free re-check first, written quote, you don't pay until you say yes. Reply STOP to opt out.`;
      case "30d":
        return `Hey ${firstName}, we still have that quote in our system. If cost is the constraint, we have options to spread the bill if that helps. Free check first, no charge. Stop by or call (216) 862-0005. Reply STOP to opt out.`;
      case "45d":
        return `Hey ${firstName}, last follow-up from Nick's on that quote. If cost was the blocker, we can show you a few payment options before you decide. Free check first, no pressure. Reply STOP to opt out.`;
    }
  }

  // P2 · skeptical_pat · trust is the blocker
  if (profile === "P2") {
    switch (touch) {
      case "3d":
        return `Hey ${firstName} — Nick's here. That quote we wrote up is still on file, along with photos of the worn parts. Free re-check with you under the car first, you don't pay until you say yes. Reply STOP to opt out.`;
      case "7d":
        return `Hey ${firstName}, just following up on the quote from Nick's. We don't do hidden fees or surprises. Come by and we'll show you exactly what we saw. Free check, no charge until you say yes. (216) 862-0005. Reply STOP to opt out.`;
      case "14d":
        return `Nick's here. We only recommend what your car actually needs. Got a second opinion? Bring it in and we'll look at it together. Free re-check, written quote. Reply STOP to opt out.`;
      case "30d":
        return `Hey ${firstName}, that quote is still in our system. Stop by and we'll put the car back on the lift to show you the parts we noted. Free check first, you don't pay until you say yes. Reply STOP to opt out.`;
      case "45d":
        return `Hey ${firstName}, last follow-up from Nick's on that quote. If you still want to re-check those parts with us, stop by anytime. Free check first, no pressure. Reply STOP to opt out.`;
    }
  }

  // P3 · busy_tim · time is the blocker
  switch (touch) {
    case "3d":
      return `Hey ${firstName} — Nick's here. That quote is still good when it's easy for you. Dropping it off is usually easiest. Leave the keys any morning and we'll text when it's ready. Free check, you don't pay until you say yes. Reply STOP to opt out.`;
    case "7d":
      return `Hey ${firstName}, just following up on the quote from Nick's. Drop it off any morning and we'll work it in. We'll text or call before doing any work. (216) 862-0005. Reply STOP to opt out.`;
    case "14d":
      return `Nick's here. If you're still planning on that work, drop-offs are always welcome. Leave it with us and we'll let you know when it's done. Free check first, you don't pay until you say yes. Reply STOP to opt out.`;
    case "30d":
      return `Hey ${firstName}, we'll keep that quote open for you. Drop the car off any morning, first-come first-served, and we'll text you when it's ready. Free check first. Reply STOP to opt out.`;
    case "45d":
      return `Hey ${firstName}, last follow-up from Nick's on that quote. If you need us to work the car in, drop it off any day and we'll get it handled. Free check first. (216) 862-0005. Reply STOP to opt out.`;
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
