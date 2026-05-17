# Design system · statenour-os

**Aesthetic stance:** Dark Industrial Command Center · void black · gold accents · glass depth · information density.

**Anti-slop verified at push time** via `scripts/check-anti-slop.sh` (gate [13/13]):
- ❌ No Inter as primary (Inter exists only as a fallback after Geist Sans)
- ❌ No Roboto / Arial as primary
- ❌ No purple-on-white SaaS gradients (gold-on-dark is the brand)
- ❌ No uniform rounded corners (rounded-2xl on cards, lg on rails, full on dots — intentional contrast)
- ❌ No symmetrical centered layouts (asymmetric weight is the rule)

---

## Color tokens (CSS variables · single source of truth)

Defined in `app/globals.css :root`. Never hardcode hex; always reference via `var(--token-name)`.

### Backgrounds (layered depth)

| Token | Color | Use case |
|-------|-------|----------|
| `--bg-void` | `#050505` | Page root · darkest layer |
| `--bg-base` | `#0A0A0A` | Body |
| `--bg-raised` | `#111111` | Cards on body |
| `--bg-elevated` | `#1A1A1A` | Modals / elevated panels |
| `--bg-surface` | `#222222` | Inputs / hover states |
| `--bg-card` | (alias) | Card surfaces — use this in components |

### Text (information hierarchy)

| Token | Use case |
|-------|----------|
| `--text-primary` | Headlines · interactive |
| `--text-secondary` | Body copy |
| `--text-tertiary` | Metadata · captions |
| `--text-quaternary` | Disabled |

### Brand (the gold)

| Token | Use case |
|-------|----------|
| `--gold` | Primary brand · highlights · CTAs |
| `--gold-ghost` | 10% gold on dark · ghost buttons · subtle accents |
| `--gold-glow` | Glow shadows for high-emphasis surfaces |

### Borders + dividers

| Token | Use case |
|-------|----------|
| `--border-soft` | Default card / panel borders |
| `--border-strong` | Active state · focus |
| `--border-divider` | Hairlines between sections |

### Status

| Token | Use case |
|-------|----------|
| `--success` | Positive · confirmed |
| `--warn` | Attention · review needed |
| `--danger` | Failure · destructive |
| `--info` | Neutral signal |

---

## Type scale

```
display    Barlow Condensed       weight 600-800 · uppercase · -0.01em letter-spacing
body       Geist Sans             weight 400-500 · normal case
mono       Geist Mono             weight 400-500 · tabular-nums for data
section-label  display 11px       weight 600 · uppercase · 0.08em letter-spacing
stat-number    display weight 800 · tabular-nums · used for big numbers
```

Inter exists in `--font-body` ONLY as a fallback after Geist Sans. Never load Inter directly. Same for Roboto Mono after Geist Mono.

---

## Spatial rhythm

- Page padding · 12-16px mobile · 16-24px desktop
- Card padding · `px-4 sm:px-6 py-5`
- Section gap · `space-y-3` for related cards · `space-y-6` for major sections
- Asymmetric weight · prefer `[1fr_auto_1fr]` over `grid-cols-3`. The middle column is the anchor.

---

## Motion philosophy

**Sparse · purposeful · high-impact.**

- One entrance per route (stagger fade-up, 40ms cascade, max 8 cards)
- Per-action departure (directional · approve slides right, reject slides left, snooze fades up)
- 240ms timeout before state mutation so animation can't get stuck mid-frame
- No hover micro-motion spam · single transition on color/border per element

Implemented via `<style jsx>` blocks scoped to the component (link-review pattern). No global motion library.

---

## Reusable primitives

### `<DecisionSpread />` (`components/ui/decision-spread.tsx`)

The DFII-15 editorial-spread layout from `/brain/link-review`, promoted to a reusable primitive.

**Differentiation anchor** · cosine/score connecting bar between two columns. The score becomes a felt thing, not a number to read.

**Use when** the operator is making a paired-content decision: link this to that, accept this over that, reconcile this with that.

**Don't use for** simple lists, forms, or single-entity views. Wrong tool.

```tsx
<DecisionSpread
  leftLabel="conversation"
  leftTitle={c.conversationTitle}
  leftBody={c.summary}
  leftMeta={c.tags}
  score={c.similarity}
  scoreLabel="cosine"
  rightLabel="mission"
  rightTitle={c.missionTitle}
  rightBody="Approve to file this conversation under the mission."
  actions={
    <div className="grid grid-cols-3 gap-2">
      <button onClick={onApprove}>Approve</button>
      <button onClick={onReject}>Reject</button>
      <button onClick={onSnooze}>Snooze</button>
    </div>
  }
/>
```

Adoption candidates next:
- `/brain/critique` — current critique ↔ alternative interpretation
- `/system/anti-patterns` — anti-pattern ↔ working alternative
- `/decisions/{id}` — decision ↔ outcome

---

## What we deliberately did NOT do

- ❌ **Tailwind theme extends** for the same colors. Would create a fork between `var(--gold)` (used everywhere today) and `bg-gold-500` (new), and existing components would have to migrate. CSS vars are the single source.
- ❌ **Component library / Storybook**. Single-operator system. The `components/` directory + this doc are sufficient.
- ❌ **Token names like `gold-50` through `gold-900`**. We have `--gold`, `--gold-ghost`, `--gold-glow`. That's three tokens. Three is enough; nine creates decision fatigue.
- ❌ **Decimal opacity utilities** (`bg-gold/20`, etc.). We use `color-mix(in oklab, ...)` directly because it composes better with CSS vars and the dark background. More expressive, less Tailwind-template-feeling.

---

## Anti-slop checklist (if you build a new page)

Before opening a PR with a new page, verify:

- [ ] No `from-purple-` / `to-purple-` / `via-purple-` Tailwind classes
- [ ] No `import { Inter } from "next/font/google"` (the gate blocks this; just don't try)
- [ ] No `import { Roboto } from "next/font/google"`
- [ ] Asymmetric layout where appropriate · grid `[1fr_auto_1fr]` over `grid-cols-3`
- [ ] One memorable design anchor (the link-review connector bar; pick something specific to the page)
- [ ] DFII score (Aesthetic Impact + Context Fit + Feasibility + Performance − Consistency Risk) ≥ 8
- [ ] Mobile-first · stacks below `md` breakpoint
- [ ] Section labels in tracked tiny caps (industrial signature)

The pre-push gate will fail if you forget the first two. The rest are operator-judged.

---

## Adding a new color token

If a real need surfaces (e.g. a "trust" semantic that's distinct from `--success`), the canonical place is `app/globals.css :root` and the dark-mode override block. Then document here under the appropriate section.

Don't add tokens speculatively. Three gold variants and four text levels covered every page in 30+ versions of this codebase. New tokens should clear the same bar.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
