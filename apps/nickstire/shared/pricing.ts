// Single source of truth for oil-change pricing. Canonical: operator-confirmed 2026-06-01.
// NOTE: long-form prose in blog.ts/guides.ts/seo-pages.ts is a deferred editorial pass — not wired here.
export const OIL_PRICE = {
  conventional: 49, // also synthetic-blend
  fullSynthetic: 80,
} as const;
