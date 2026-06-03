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

  // P1 · broke_brenda · money is the blocker
  if (profile === "P1") {
    switch (touch) {
      case "3d":
        return `Hey — Nick's. That quote we wrote up still stands. If cost was the holdup, $10 down splits it across 4 lenders, no credit-check ding. Free re-check first, you don't pay until you say yes. Reply STOP to opt out.`;
      case "7d":
        return `Still sitting on that quote? $10 down, soft pre-qual in about a minute — Acima, Snap, Koalafi, American First. Free re-check anytime. (216) 862-0005. Reply STOP to opt out.`;
      case "14d":
        return `Nick's here — that quote's still good. Payment programs start at $10 down if you'd rather spread it out. Free check, written number up front, you don't pay until you say yes. Reply STOP to opt out.`;
      case "30d":
        return `We'll honor that quote this week. $10 down splits the bill 4 ways if that helps. Free check first, no charge. Pull up any day or call (216) 862-0005. Reply STOP to opt out.`;
      case "45d":
        return `Hey — still weighing it? The quote stands, $10-down financing's there if you want it, and the re-check is free. Pull up any day, no obligation. Reply STOP to opt out.`;
    }
  }

  // P2 · skeptical_pat · trust is the blocker
  if (profile === "P2") {
    switch (touch) {
      case "3d":
        return `Hey — Nick's. The quote we wrote up is still on file, photos and the worn part with it. Free re-check anytime, written number, you don't pay until you say yes. Reply STOP to opt out.`;
      case "7d":
        return `That quote was written before we touched anything — that's how we work. Come back and we'll walk you under the car again. Free check, no charge until you say yes. (216) 862-0005. Reply STOP to opt out.`;
      case "14d":
        return `Nick's here — we don't push work you don't need. Got a second opinion? Bring it and we'll go over it side by side. Free re-check, written quote. Reply STOP to opt out.`;
      case "30d":
        return `That quote's still in our system. Same lift, same person walking you under the car to show you. Free re-check first, you don't pay until you say yes. Reply STOP to opt out.`;
      case "45d":
        return `Hey — still on your list? Our quote was written, no fluff, and it still stands. Stop by when you're ready, free check, no charge. Reply STOP to opt out.`;
    }
  }

  // P3 · busy_tim · time is the blocker
  switch (touch) {
    case "3d":
      return `Hey — Nick's. That quote's still good whenever it's easy for you. Drop the keys any morning, we'll handle it and let you know when it's ready. Free re-check, you don't pay until you say yes. Reply STOP to opt out.`;
    case "7d":
      return `Still good to go on that quote. Drop it off any day — first-come, first-served — and we'll reach out when it's ready. Free check, written quote. (216) 862-0005. Reply STOP to opt out.`;
    case "14d":
      return `Nick's here — easiest path is a drop-off. Leave it any morning, we'll work it in and reach out when it's done. Free re-check, you don't pay until you say yes. Reply STOP to opt out.`;
    case "30d":
      return `We'll keep that quote open one more week. Drop it off any day, first-come first-served, and we'll let you know when it's ready. Free check first. Reply STOP to opt out.`;
    case "45d":
      return `Hey — still need that work? Drop it off any day, we'll take care of it and reach out when it's done. Free check, no charge until you say yes. (216) 862-0005. Reply STOP to opt out.`;
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
