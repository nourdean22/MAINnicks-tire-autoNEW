// Single source of truth for oil-change pricing. Canonical: operator-confirmed 2026-06-01.
// NOTE: long-form prose in blog.ts/guides.ts/seo-pages.ts is a deferred editorial pass — not wired here.
export const OIL_PRICE = {
  conventional: 49, // also synthetic-blend
  fullSynthetic: 80,
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

