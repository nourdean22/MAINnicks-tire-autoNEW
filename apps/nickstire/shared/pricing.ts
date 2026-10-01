import { BUSINESS } from "./business";

// Single source of truth for oil-change pricing. Canonical: operator-confirmed 2026-06-01.
// NOTE: long-form prose in blog.ts/guides.ts/seo-pages.ts is a deferred editorial pass — not wired here.
export const OIL_PRICE = {
  conventional: 49, // also synthetic-blend
  fullSynthetic: 80,
} as const;

/**
 * Operator-confirmed high-intent quoting-channel used-tire anchor.
 *
 * WEBSITE discovery pricing stays in BUSINESS.usedTires ($25 select 12-inch
 * floor + $40–80 most-size band). Phone/SMS/voice/chat quoting uses the real
 * average anchor instead; do not collapse the two channel policies.
 */
export const USED_TIRE_QUOTE = {
  startingDollars: 60,
  display: "$60 installed",
} as const;

/**
 * The oil-change coupon customers mention at the counter, at
 * OIL_PRICE.conventional. Operator decision 2026-10-01 (the owner is the
 * source): OIL2999 ended 2026-09-30 and became NICKSOIL through the end of
 * 2026. Surfaces that name the code read it from here, so the next rename or
 * extension is one edit. shared/routes.ts has to quote it literally (two build
 * scripts parse that file as text); canonical-business-truth.test.ts keeps that
 * copy in sync.
 */
export const OIL_COUPON = {
  code: "NICKSOIL",
  /** Last valid day, in the shop's time zone (BUSINESS.timezone). */
  validThrough: "2026-12-31",
  validThroughDisplay: "December 31, 2026",
} as const;

/** True through the end of OIL_COUPON.validThrough in Cleveland. After that,
 *  copy that reads it drops the code; $49 is the regular price either way. */
export function oilCouponActive(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}` <= OIL_COUPON.validThrough;
}

export const BRAKE_PRICE = {
  padsStarting: 149,
  padsMax: 299,
  // Pads + rotors, per axle. Operator decision 2026-10-01: "starting at
  // $149.99, depending on vehicle" replaces the $250 and $279 floors different
  // pages quoted. The "depending on vehicle" condition is fine print at the
  // bottom of the page that shows the price.
  padsAndRotorsStarting: 149.99,
  caliperAndRotorReplacementEstimate: 950,
} as const;

/**
 * The full diagnostic fee. Operator decision 2026-10-01 (#2868): ONE fee, $49,
 * waived if the customer does the repair with us. The OBD-II code scan stays
 * free and is not this fee. Surfaces that quote the fee read it from here.
 */
export const DIAGNOSTIC_PRICE = {
  fee: 49,
  waiver: "waived if you do the repair with us",
} as const;

export const SERVICE_PRICE = {
  tirePatch: 35,
  eCheckFixStarting: 189,
  beltReplacementStarting: 50,
} as const;

