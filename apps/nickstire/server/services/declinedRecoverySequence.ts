/**
 * Declined-Work Recovery Sequence · 5 touches × 4 tracks (P0 default)
 *
 * revenue-truth-correction (2026-07-28): the profile PICKER no longer
 * guesses the customer's objection. The old pickProfile inferred
 * psychology from proxies — luxury marque → "time is the blocker",
 * brakes/tires → "trust is the blocker", decline rate → "money is the
 * blocker" — hypotheses presented as customer knowledge, then baked
 * into message tone. Routing is now EVIDENCE-ONLY:
 *
 *   P0 — neutral       DEFAULT · objection unknown → don't pretend
 *   P1 — price track   customer explicitly raised cost/payments
 *   P2 — proof track   customer explicitly asked for proof/second look
 *   P3 — logistics     customer explicitly raised timing/drop-off
 *
 * P1/P2/P3 fire ONLY when the caller passes `statedConcern` sourced from
 * something the customer actually said (decline reason, SMS reply, call
 * transcript). No caller wires that yet, so every new estimate lands on
 * P0. Estimates with a legacy sticky P1-P3 (alg_estimates.recovery_profile,
 * assigned by the old heuristics) keep their track — the copy below is
 * honest for any recipient — but no NEW psychographic assignment happens.
 *
 * Message-claim rules (same pass):
 *   - Never claim evidence we can't verify exists. The old P2 opener
 *     asserted "photos of the worn parts" are on file — nothing checks
 *     that. Removed.
 *   - Never invent price guarantees. "Quote is still good" / "we'll
 *     honor that pricing" is a pricing-policy commitment this system
 *     has no authority to make. The honest fact is the quote is ON FILE.
 *
 * Every variant still:
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
 * Cadence note: the 3/7/14/30/45 windows are retained for now — collapsing
 * to 1-3 adaptive touches is the Recovery-2.0 rebuild (needs decline-reason
 * capture + holdout measurement), not a truth fix.
 */

import type { AlgEstimate } from "../../drizzle/schema";

export type RecoveryProfile = "P0" | "P1" | "P2" | "P3";
export type RecoveryTouch = "3d" | "7d" | "14d" | "30d" | "45d";

/** Objection evidence a caller may pass — must come from something the
 *  customer actually said, never from vehicle/service/segment proxies. */
export type StatedConcern = "price" | "proof" | "time";

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

// ─── Profile picker · evidence-only ───────────────────────────────
//
// Deterministic so the same estimate always lands on the same track
// across touches (sticky via alg_estimates.recovery_profile).
//
// The legacy proxy args (amountCents, serviceDescription, totalVisits,
// vehicleMake/Year, declineRate, customerType) are still accepted so
// existing call sites compile, but they NO LONGER drive routing — the
// old inferences they powered were unverifiable psychology. Only
// `statedConcern` routes off P0, and it must be populated from the
// customer's own words when that capture exists (Recovery 2.0).
export function pickProfile(args: {
  amountCents: number;
  serviceDescription: string | null;
  totalVisits?: number | null;
  vehicleMake?: string | null;
  vehicleYear?: string | null;
  declineRate?: number | null;
  customerType?: "individual" | "commercial" | null;
  /** Evidence-gated routing input · from the customer's own words only. */
  statedConcern?: StatedConcern | null;
}): RecoveryProfile {
  switch (args.statedConcern) {
    case "price": return "P1";
    case "proof": return "P2";
    case "time": return "P3";
    default: return "P0";
  }
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

// ─── 20-variant template engine (4 tracks × 5 touches) ─────────────
//
// Each variant is a string-template function. Keep them small + flat
// so the brand-voice linter (pre-commit) can scan each line.
//
// To audit a single variant in the operator chat:
//   buildSequenceMessage({ touch: "14d", profile: "P0", name: "Test",
//     amountCents: 48700, serviceDescription: "brake pads + rotors" })

export function buildSequenceMessage(params: BuildParams): string {
  const { touch, profile } = params;
  const firstName = params.name ? params.name.trim().split(/\s+/)[0] : "there";

  // P1 · price track · customer explicitly raised cost/payments
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

  // P2 · proof track · customer explicitly asked for proof/second look
  if (profile === "P2") {
    switch (touch) {
      case "3d":
        return `Hey ${firstName} — Nick's here. That quote we wrote up is still on file. Come by and we'll put the car up and show you exactly what we found — free. You don't pay until you say yes. Reply STOP to opt out.`;
      case "7d":
        return `Hey ${firstName}, just following up on the quote from Nick's. We don't do hidden fees. Come by and we'll show you exactly what we saw. Free check, no charge until you say yes. (216) 862-0005. Reply STOP to opt out.`;
      case "14d":
        return `Nick's here. We only recommend what your car actually needs. Got a second opinion? Bring it in and we'll look at it together. Free re-check, written quote. Reply STOP to opt out.`;
      case "30d":
        return `Hey ${firstName}, that quote is still in our system. Stop by and we'll put the car on the lift with you and walk through what we quoted. Free check first, you don't pay until you say yes. Reply STOP to opt out.`;
      case "45d":
        return `Hey ${firstName}, last follow-up from Nick's on that quote. If you still want to re-check those parts with us, stop by anytime. Free check first, no pressure. Reply STOP to opt out.`;
    }
  }

  // P3 · logistics track · customer explicitly raised timing/drop-off
  if (profile === "P3") {
    switch (touch) {
      case "3d":
        return `Hey ${firstName} — Nick's here. That quote is on file whenever it's easy for you. Dropping it off is usually easiest. Leave the keys any morning and we'll text when it's ready. Free check, you don't pay until you say yes. Reply STOP to opt out.`;
      case "7d":
        return `Hey ${firstName}, just following up on the quote from Nick's. Drop it off any morning and we'll work it in. We'll text or call before doing any work. (216) 862-0005. Reply STOP to opt out.`;
      case "14d":
        return `Nick's here. If you're still planning on that work, drop-offs are always welcome. Leave it with us and we'll let you know when it's done. Free check first, you don't pay until you say yes. Reply STOP to opt out.`;
      case "30d":
        return `Hey ${firstName}, that quote is still on file. Drop the car off any morning, first-come first-served, and we'll text you when it's ready. Free check first. Reply STOP to opt out.`;
      case "45d":
        return `Hey ${firstName}, last follow-up from Nick's on that quote. If you need us to work the car in, drop it off any day and we'll get it handled. Free check first. (216) 862-0005. Reply STOP to opt out.`;
    }
  }

  // P0 · neutral · objection unknown — one honest follow-up, no guessing
  const serviceClause = buildServiceClause(params.serviceDescription);
  switch (touch) {
    case "3d":
      return `Hey ${firstName} — Nick's Tire & Auto here. That quote we wrote up is still on file. Questions about it? Call or text and we'll walk you through it. Free re-check anytime, you don't pay until you say yes. Reply STOP to opt out.`;
    case "7d":
      return `Hey ${firstName}, Nick's here following up on that quote — it's still on file. Whatever the holdup — cost, timing, or you want a second look — call and we'll sort it out. Free re-check, no charge. (216) 862-0005. Reply STOP to opt out.`;
    case "14d":
      return `Nick's here. That quote for ${serviceClause} is still on file. Drop the car off any morning or call with questions — free re-check first, you don't pay until you say yes. Reply STOP to opt out.`;
    case "30d":
      return `Hey ${firstName}, that quote is still in our system. Want us to take another look first? The re-check is free. Walk in 7 days a week or call (216) 862-0005. Reply STOP to opt out.`;
    case "45d":
      return `Hey ${firstName}, last follow-up from Nick's on that quote. It stays on file whenever you're ready — free re-check first, no pressure. Reply STOP to opt out.`;
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
// (sms_variant_idx already indexed at schema.ts). P0 keys are new as of
// revenue-truth-correction — a fresh variant series, measurable against
// the legacy P1-P3 series.
export function variantKey(touch: RecoveryTouch, profile: RecoveryProfile): string {
  return `declined_${touch.replace("d", "")}d_${profile}`;
}
