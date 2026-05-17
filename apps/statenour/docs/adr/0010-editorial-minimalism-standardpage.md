# ADR-0010 · Editorial-minimalist aesthetic + StandardPage layout primitive

**Status:** Accepted
**Date adopted:** v10.0.352 (2026-05-06)
**Backfilled:** 2026-05-07 (v10.0.458)

## Context

By v10.0.330 the OS had reached its "operator-grade dark identity"
(`#FDB913` gold on `#0A0A0A` void) but was visually inconsistent
across the ~40 mastery surfaces. Each page had its own header
shape, its own typography scale, its own padding rhythm, its own
empty-state treatment. The shared `<Panel>` primitive enforced
some structure but didn't reach high enough to govern page-level
layout.

The visual symptoms:

- Page titles ranged from `text-2xl` to `text-4xl` to `text-lg`
  with no rule.
- Description copy stretched across 1280px-wide pages, hitting
  reading-comfort issues (line lengths >100 characters).
- Empty states were inconsistent — some had illustrations, some
  had centered text, some had nothing.
- "Eyebrow" / breadcrumb patterns existed in 3 different spellings
  (uppercase mono · uppercase Barlow · sentence-case Geist).

The strategic question was: should the OS adopt a popular
minimalist UI framework (e.g. shadcn/ui defaults · Vercel-style)
or extend its own brand?

## Decision

**Soft-adopt editorial minimalism as a quality bar — preserve the
gold-on-dark identity.**

Concretely:

1. **`<StandardPage>` layout primitive** (`components/layout/
   standard-page.tsx`) wraps every mastery page. Props:
   - `eyebrow` · breadcrumb / category label
   - `title` · page H1
   - `description` · 1-2 sentence intent
   - `rhythm` · vertical spacing scale (compact / cozy / loose)
   - `width` · container width (narrow / standard / wide)
   - children · page content

2. **`<PageHeader>` + `<PanelHeader>`** auto-mounted by
   StandardPage and Panel respectively. They carry the typography
   discipline below.

3. **Typography scale frozen** in `app/globals.css` v10.0.352:
   - Page title · Barlow Condensed 700 · uppercase ·
     `tracking-[-0.025em]` · scale 1.75rem → 2.25rem
   - Section title · Barlow Condensed 600 · uppercase ·
     `tracking-[-0.01em]` · 1.125rem
   - Body / description · Geist Sans · `tracking-[0.005em]` ·
     line-height 1.55 · **max-width 60ch** (the single biggest
     editorial upgrade)
   - Eyebrow · Barlow Condensed 600 · uppercase ·
     `tracking-[0.14em]` · `--text-tertiary`

4. **Reserved escape hatches** for editorial passages —
   Instrument Serif (`.text-display-serif` · `.text-editorial`)
   for hero quotes and editorial prose. Used sparingly.

5. **Brand identity preserved** — gold-on-dark, the violet
   accent, the `pulse-live` keyframe vocabulary, the gold-edge
   cards. Editorial discipline shapes WHERE these go; it doesn't
   replace them.

The full spec lives in `docs/aesthetic-principles.md`.

## Consequences

**Positive:**

- Every page that adopts StandardPage inherits the rhythm for
  free. The v10.0.353+ work cycled 26 pages onto StandardPage
  across 5 widths × 3 rhythms.
- Reading-width cap (60ch) is invisible until you fix it.
  Pages that hit it feel "calmly readable" instead of "stretched."
- Type-led design forces the operator to think about hierarchy
  before deciding where to put a card. Cards stop being the
  default container; they become the answer to "this content
  group needs a frame."
- Identity moat preserved. The gold-on-dark + Barlow Condensed
  +Instrument Serif combination is not a stock template — it
  reads as Nour's OS, not as another shadcn dashboard.
- Editorial primitives rejected the AI-slop visual signals
  (Inter font · purple gradients · uniform rounded corners ·
  symmetric centered hero) that the frontend-design skill in
  the top-50 floor explicitly flags as "DFII fail."

**Negative:**

- Migration cost. Pages that pre-date StandardPage need to be
  refactored individually. As of v10.0.378 ~26 pages adopted;
  others still use ad-hoc header markup.
- Discipline debt. The principles file is the source of truth
  but not enforced by lint. A new contributor (future-Nour) can
  trivially deviate. Mitigated by the always-on
  **frontend-design** skill in the top-50 floor that flags
  AI-slop, and the **baseline-ui** skill that validates animation
  + typography scale.
- Reading-width cap (60ch) constrains some surfaces — wide tables
  and dashboards need explicit `width="wide"` opt-out. Slight
  ergonomic cost for the OS-level discipline gain.

## Alternatives considered

- **Adopt shadcn/ui defaults wholesale** — rejected. The defaults
  are good but generic. The gold-on-dark identity is the moat;
  shadcn would dilute it into "another well-styled dashboard."
- **Build a bespoke design system from scratch** — rejected on
  scope. The editorial discipline + gold-on-dark identity gets
  90% of the win at 20% of the effort.
- **Pure Tailwind utility classes everywhere** (no layout
  primitives) — was the status quo before v10.0.352. Produced
  the inconsistency that motivates this ADR.
- **Adopt a heavier framework (Mantine / Radix Themes / NextUI)**
  — rejected. We use Radix Primitives (headless) where useful
  but the themed wrapper would override the identity tokens.

## References

- `components/layout/standard-page.tsx` — the primitive
- `components/layout/ui.tsx` — `<PageHeader>` + `<PanelHeader>`
- `components/panel.tsx` — section-level frame
- `app/globals.css` v10.0.352 typography scale block
- `docs/aesthetic-principles.md` — full spec (typography table ·
  rhythm scale · width tiers · examples)
- v10.0.352 commit · StandardPage introduction
- v10.0.353+ commits · 26-page adoption wave
- ADR-0007 · skill semantic recall (frontend-design + baseline-ui
  + ui-tokens skills enforce these principles on every UI task)

## Open items

- Lint rule for AI-slop visual signals (Inter import · purple
  gradient classes · rounded-* uniformity). Today it's caught
  by the frontend-design skill at write-time, not at CI-time.
- Migration progress tracker · how many pages still use ad-hoc
  headers vs StandardPage. Could power a periodic "adoption rate"
  audit similar to the schema-timestamp audit (v10.0.451).
- Decision on whether to publish the principles file as a
  public-facing brand sheet · operator-grade for now, but the
  identity could become a marketing asset if Nour ships
  external-facing OS-aware tools.

## Box-shadow → opacity-on-pseudo conversion audit (v10.0.496)

After 17 keyframes converted in v10.0.466-469 and one reverted
(`state-aura` at v10.0.474 due to the `position:relative`
containing-block trap), the remaining keyframes that animate
box-shadow are:

| Keyframe | Used by | Conversion status | Notes |
|---|---|---|---|
| `peek-pulse` | `components/layout/floating-home.tsx` | ✅ converted v10.0.496 | Tailwind already provides static glow · keyframe now opacity-only |
| `nick-cursor-shimmer` | streaming typing-cursor (currently unused but defined) | ✅ converted v10.0.502 | Pseudo-split shipped · element becomes `inline-block + position:relative` with a `::after` halo · static box-shadow + opacity-on-pseudo animation. Compositor-only. |

Goldflash / unload-pulse / drift-glow / fire-glow / critical-glow ·
all use box-shadow but at static (single-state) values inside the
keyframe · they don't animate the shadow itself, they animate
opacity or transform with a static glow that persists. Not regen
candidates. The grep was over-eager · the v10.0.466-469 wave
already handled the actual animated-shadow cases.

**Lesson banked in glitch-taxonomy.md appendix** (v10.0.484): never
add `position: relative` to a parent without auditing the subtree
for `position: fixed` descendants. The state-aura regression cost
~30 min to diagnose; the trap is now documented as Cat 7 incident
#2.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
