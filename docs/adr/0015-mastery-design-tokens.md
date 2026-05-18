# ADR-0015 · Mastery surfaces · design tokens + StandardPage migration plan

> **Status**: Accepted (2026-05-18 PM)
> **Date**: 2026-05-18 · follow-up to ADR-0013 (Phase D) + the cross-surface
> coherence audit (`feature-dev:code-reviewer` agent · same day)
> **Decision drivers**: 4 mastery surfaces hand-rolled their own page
> shells with drifted color + tracking values that diverged from
> `apps/statenour/docs/aesthetic-principles.md` · audit caught it
> after Phase D primitives extraction · this ADR cements the
> canonical choices + plans the StandardPage adoption

---

## Context

The 4 mastery surfaces (`/goals`, `/scoreboard`, `/tasks`, `/journal`)
were each built solo across multiple phases. The cross-surface
coherence audit from 2026-05-18 found 13 drift findings · 10 closed
in the morning push (MasteryErrorView · MasterySkeleton ·
MasterySectionLabel · useAuthedFetch x5 · cross-link mesh x3). The
3 remaining were:

1. Container max-width inconsistent (`max-w-6xl` / `max-w-3xl` /
   no constraint)
2. Color tokens: `text-white` / `text-zinc-100` / `--text-primary`
3. Page-supertitle (eyebrow + title pattern) reimplemented per
   surface

A pass through `docs/aesthetic-principles.md` revealed the
canonical answers were already documented · the mastery surfaces
had simply drifted from the operator's stated standards.

## Decision

Adopt the existing canonical tokens + primitives:

### Color (per principles §3 "What's banned")

> "Pure black `#000000` text or pure white `#FFFFFF` text. We already
> enforce this via `--text-primary: #F0F0F0` — keep it that way."

The mastery primitives migrate FROM `text-white` TO
`text-[var(--text-primary)]` · the surfaces they're adopted into
follow with their own bare `text-white` replacements in a
follow-up pass.

Background follows the same pattern · `bg-[#0A0A0A]` becomes
`bg-[var(--bg-void,#0A0A0A)]` so the fallback preserves the
literal value while the variable token wins when defined.

Border-default + text-tertiary same treatment.

### Tracking (per principles §2 "Typography rules")

> `.eyebrow` · Barlow Condensed 600 · `0.14em` · uppercase ·
> `var(--text-tertiary)`

`MasterySectionLabel` realigned from 0.22em → 0.14em + adopted
`font-semibold` + `var(--text-tertiary)` color. The 0.18em variant
used in `/goals` header supertitle + `/scoreboard` card labels
collapses here too. The `tracking-wider` (~0.05em) variant used in
goal domain tags + suggestion buttons stays distinct · it's a
DIFFERENT idiom (interactive chip / button label · not
section-eyebrow) · separate tracking is correct.

### Container max-width (per `components/layout/standard-page.tsx`)

`StandardPage` already enumerates the 5 canonical widths:

| Prop | Tailwind | Pixels | Use case |
|---|---|---|---|
| `md` (default) | `max-w-3xl` | 768px | telemetry / single-column reads |
| `lg` | `max-w-4xl` | 896px | slim canvas |
| `xl` | `max-w-5xl` | 1024px | tabbed surfaces |
| `2xl` | `max-w-6xl` | 1152px | data-dense crons / tools / costs |
| `3xl` | `max-w-7xl` | 1280px | widest tables |

The mastery surfaces map to:
- `/goals` → `2xl` (ladder + sidebar grid wants the space)
- `/scoreboard` → `md` (single-column anomalies/anchors reads narrow)
- `/journal` → `2xl` (feed + 3-tier radar wants room)
- `/tasks` → `2xl` (3-mode shell carries dense per-row data)

No new container values needed · the existing 5 widths cover all
4 mastery surfaces.

### Page supertitle (per `components/layout/standard-page.tsx`)

`StandardPage` already takes `eyebrow` + `title` + `description` +
`actions` props · the canonical pattern lives in `PageHeader`
(emitted under the hood with the `.page-header` + `.page-title` +
`.eyebrow` CSS class triple).

No new `MasteryPageHeader` primitive needed · just adopt
`StandardPage`. Documented as a follow-up below.

## Migration plan · StandardPage adoption

The 4 mastery surfaces currently hand-roll:

```tsx
<main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
  <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
    <Header ... />  {/* hand-rolled */}
    ...children
  </div>
</main>
```

The canonical alternative:

```tsx
<StandardPage
  eyebrow="Mastery"
  title="Goals"
  width="2xl"
  rhythm="comfortable"
  actions={pruneCandidates > 0 ? <PruneChip count={pruneCandidates} /> : null}
>
  ...children
</StandardPage>
```

This gives the page automatically:
- Editorial typography (Barlow Condensed title · `.eyebrow` supertitle)
- `--text-primary` foreground
- `page-fade-in` mount animation
- 60ch reading-width cap on the description
- Auto back-link detection for `/system/*` and `/brain/*` routes
- Consistent rhythm via the `compact` / `comfortable` / `loose` token

### Why not this commit

Adopting StandardPage in `/goals` and `/scoreboard` requires:

1. Extracting the existing inline `Header` components into the new
   `actions` slot semantics
2. Reflowing the children to fit `RHYTHM_CLASS` (space-y-3 etc.)
3. Handling the auto-back-link (mastery surfaces aren't under
   `/system/*` or `/brain/*` so it'll just no-op · safe but worth
   verifying)
4. Visually QA'ing each surface to confirm the typography swap from
   `text-2xl font-medium` to Barlow Condensed `.page-title` doesn't
   regress the operator-grade aesthetic

That's a coordinated change worth its own commit pair and a focused
visual review · staging it for the next session keeps today's
deploy chain simple.

### What this commit DOES land

- `MasterySectionLabel` color + tracking realigned to canonical
  (`var(--text-tertiary)` + `0.14em`)
- `MasteryErrorView` background + foreground + border use token
  variables
- `MasterySkeleton` same · plus header skeleton sized to mirror
  PageHeader's eyebrow + title layout
- This ADR documenting the decisions + the deferred StandardPage
  migration

The 4 mastery surfaces continue hand-rolling their own shells for
now · BUT when their loading / error states render, the operator
sees the canonical tokens (since those code-paths flow through
the mastery primitives).

## Consequences

### Positive

- Every new mastery primitive is now anchored to the canonical
  token system instead of inventing fresh literals
- Future palette evolution (operator decides to switch
  `--text-primary` from `#F0F0F0` to something else) ripples through
  the mastery primitives automatically
- The deferred StandardPage migration is documented with a clear
  before/after example so it can be picked up cleanly in a future
  session

### Negative

- The 4 mastery surfaces themselves still have ~80 LOC each of
  hand-rolled page-shell code that drifts from the canonical
  `StandardPage` · the inconsistency persists until the deferred
  migration lands
- The `tracking-wider` chip/button idiom is now distinct from the
  eyebrow idiom · operators need to remember the two cases

### Neutral

- Existing surfaces continue to work · only the loading + error
  states pick up the new tokens immediately

## Operator action items

None for this commit · this is pure code + doc reconciliation.

For the next session:
1. Adopt `StandardPage` in `/goals` (highest leverage · most
   complex page shell currently)
2. Same in `/scoreboard` (smaller surface · should be 30min)
3. Defer `/journal` + `/tasks` (larger pages · need visual QA pass
   for the typography change)

## References

- `apps/statenour/docs/aesthetic-principles.md` · the source of
  truth for typography + color + spacing decisions
- `apps/statenour/components/layout/standard-page.tsx` · the
  canonical page-shell primitive
- `apps/statenour/app/globals.css` line 27 (`--text-primary`) +
  line 256-261 (`.eyebrow`) · the canonical CSS class definitions
- `docs/adr/0013-journal-pattern-radar.md` · Phase D ship that
  introduced the mastery primitives directory
- This morning's commit chain · `ce3cc59` → `aef905b` · the
  coherence-pass commits the audit findings drove
