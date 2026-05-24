# Changelog

All notable changes to `@statenour/lenses` will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-23

### Added

- Initial release · 49 strategic reasoning lenses extracted from
  [statenour-os](https://autonicks.com) (the operator OS where these
  lenses were honed against ~14 months of live operator chat data).
- Public API:
  - `REGISTRY: StrategicFramework[]` — all 49 lenses as a flat array
  - `detectLenses(message, opts?)` — top-N matches by trigger score,
    with anti-trigger suppression
  - `formatLensBlock(matches)` — composes a system-prompt section
    from matched lenses
  - `hasStrategicIntent(message)` — cheap pre-filter
  - `pickFeaturedLenses()` — the ~9-lens curated baseline subset
- Types: `StrategicFramework` · `FrameworkMatch`
- 9 lenses marked `featured: true` (elon-musk · inversion · jtbd ·
  north-star-metric · opportunity-cost · pareto-principle ·
  porters-five-forces · second-order-thinking · lean-canvas) for
  compact-fallback lists.
- 3 financial lenses (financial-modeling · financial-projections ·
  unit-economics) dedupe via cross-anti-triggers to prevent slot-bloat.
- ESM-only · TypeScript types included.
- MIT license.

### Provenance

- Extracted from `apps/statenour/lib/ai/strategic-frameworks/` ·
  preserved as a re-export shim in statenour-os so consumers don't
  need to change imports.
- Each trigger has fired on a real operator question · each prompt
  block has been judged against an LLM critic for hallucination
  resistance.
