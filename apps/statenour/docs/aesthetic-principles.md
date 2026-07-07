# Aesthetic Principles · NOUR OS

**v10.0.352 · 2026-05-06**

The operator-grade dark identity (`#FDB913` gold on `#0A0A0A` void) is the
moat. These principles preserve it while adopting editorial-minimalist
discipline (per the `minimalist-ui` skill, adapted for dark mode).

The intent is **soft adoption** — minimalism as a quality bar, not a
visual replacement. Every page should feel like a piece of editorial
software: type-led, restrained, generously spaced.

---

## 1. Use the editorial layout primitives

These three components are the canonical entry points. Every mastery
surface should use them — they carry the principles below for free:

- `<StandardPage eyebrow title description rhythm width>` ·
  `components/layout/standard-page.tsx`
- `<PageHeader>` (auto-mounted by StandardPage) ·
  `components/layout/ui.tsx`
- `<PanelHeader>` for sub-section heads · same file

The CSS classes they emit (`.page-header` `.page-title` `.page-copy`
`.section-head` `.section-title` `.section-copy` `.eyebrow`
`.empty-state` `.empty-title` `.empty-copy`) are now defined once in
`app/styles/base.css` (v10.0.352 · moved from globals.css in the 2026-07-07 layer split — globals.css is now an import manifest). Any page that uses these components
inherits the rhythm automatically.

---

## 2. Typography rules

| Use | Class / element | Font | Tracking | Notes |
|---|---|---|---|---|
| Page title | `.page-title` (auto from StandardPage) | Barlow Condensed 700 | `-0.025em` | uppercase, line-height 1.05, scale 1.75rem→2.25rem |
| Section title | `.section-title` (auto from PanelHeader) | Barlow Condensed 600 | `-0.01em` | uppercase, 1.125rem |
| Body / description | `.page-copy` `.section-copy` | Geist Sans | `0.005em` | line-height 1.55, **max-width 60ch** |
| Eyebrow / breadcrumb | `.eyebrow` `.text-eyebrow` | Barlow Condensed 600 | `0.14em` | uppercase, `--text-tertiary` |
| Hero / quote (opt-in) | `.text-display-serif` `.text-editorial` | Instrument Serif | `-0.025em` | reserved for editorial passages only |
| Numbers / counters | `.stat-number` | Barlow Condensed 800 | tabular-nums | for KPIs |
| Code / metadata | `font-mono` | Geist Mono | n/a | timestamps, IDs, hash refs |

**Reading width is capped at 60 characters.** Long descriptions wrap
naturally instead of stretching across a 1280px-wide page. This is the
single biggest editorial upgrade — reading width is invisible until you
fix it.

---

## 3. What's banned

Adopted from `minimalist-ui` §2 with dark-mode adjustments:

- ❌ Heavy drop shadows (`shadow-md`, `shadow-lg`, `shadow-xl`). Use
  `var(--shadow-gold-soft)` (already low-opacity) or no shadow at all.
- ❌ Pill shapes (`rounded-full`) on **large containers** — only OK on
  small status badges and tag chips.
- ❌ Decorative gradients on hero backgrounds. Subtle gradient borders
  on the gold-rule are fine.
- ❌ Emoji used as icons (e.g. 🚨 in inline copy). Use lucide icons
  (already imported across the app) or status dots (`.status-dot-*`).
  Toast emoji and ticker symbol prefixes (◆●▲◉) are OK — they're
  vocabulary, not decoration.
- ❌ AI copywriting clichés in copy: "Elevate", "Seamless", "Unleash",
  "Next-Gen", "Game-changer", "Delve". Plain specific language only.
- ❌ Generic placeholder names ("John Doe", "Acme Corp", "Lorem Ipsum").
  Use realistic contextual content.
- ❌ Pure black `#000000` text or pure white `#FFFFFF` text. We already
  enforce this via `--text-primary: #F0F0F0` — keep it that way.

---

## 4. Spacing rhythm

`StandardPage` exposes three rhythm modes:

- `compact` (default · `space-y-3` · 0.75rem) — telemetry-dense
- `comfortable` (`space-y-4` · 1rem) — wider data pages
- `loose` (`space-y-5` · 1.25rem) — 5-6 panel dashboards

**Card internal padding** is now normalized to **20px** (1.25rem) for
the standard `rounded-lg + border-[var(--border-default)]` pattern via
the v10.0.352 cascade. Per-card `p-*` utilities still win — only
unstyled cards get the bump.

For new bento-style hero cards, prefer **24-40px** internal padding
(`p-6` to `p-10`). Generous internal padding is what separates premium
from cramped.

---

## 5. Color discipline

Gold (`--gold` `#FDB913`) is the **only** brand color. Use it for:

- Active state borders (`var(--border-active)`)
- Brand-anchor top edge on cards (cascade in app/styles/effects.css)
- Focus rings (`:focus-visible`)
- Selection background
- Scrollbar thumb
- KPI gold-flash animations

**Status colors** are semantic only:
- `--status-green` — success / win / live
- `--status-yellow` — warn / pending
- `--status-red` — fatal / blocked
- `--status-blue` — info / neutral signal
- `--status-purple` — secondary signal (devices, brain)

Never use gold or status colors decoratively (e.g. accent borders on
cards that aren't carrying status meaning). The whole system reads as
visual noise the moment color stops being semantic.

---

## 6. Motion discipline

Keep:
- `pulse-live` on status dots (live indicators) · meaningful
- `gold-flash` on score checkbox (completion feedback) · meaningful
- `page-fade-in` on StandardPage mount (cinematic) · 280ms one-shot
- `AnimatedCounter` for KPIs · meaningful
- Ticker marquee scroll · ambient awareness

Drop:
- Decorative micro-motion on hover that doesn't reinforce affordance
- Multiple competing animations in the same viewport
- Animation just because

---

## 7. Enforcement

When adding a new mastery surface:

1. Use `<StandardPage>` — non-negotiable
2. Cap reading copy at 60ch — already done by `.page-copy` `.section-copy`
3. Lean on the existing tokens — `--text-primary` `--gold` etc — never
   raw hex
4. No new CSS classes for layout primitives — extend the existing
   `.page-*` `.section-*` `.empty-*` family in `app/styles/base.css`
5. Run a visual scan after — does it look type-led, generously spaced,
   restrained? If not, simplify.

When in doubt, the rule is: **delete decoration, keep meaning.** Per
the elon 5-step (question / delete / simplify / accelerate / automate),
every visual element should justify its presence.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
