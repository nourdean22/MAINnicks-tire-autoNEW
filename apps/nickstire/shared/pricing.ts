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

export const BRAKE_PRICE = {
  padsStarting: 149,
  padsMax: 299,
  caliperAndRotorReplacementEstimate: 950,
} as const;

export const SERVICE_PRICE = {
  tirePatch: 35,
  eCheckFixStarting: 189,
  beltReplacementStarting: 50,
} as const;

