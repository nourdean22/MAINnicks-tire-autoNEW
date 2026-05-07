# Nick's Tire & Auto — Design Philosophy

> The aesthetic movement that anchors every visual decision on nickstire.org.
>
> Authored 2026-05-07 (wave-42) via canvas-design skill, after 18 waves of
> visual polish and 14 SEO-targeted comparison pages had landed. Codified
> here so future commits can argue from the document, not from instinct.

---

## The movement: **EUCLID GRIT**

Cleveland-tough industrial editorial. Salt-stained truth in a yellow font.
A mechanic-owned shop on a real street, photographed in real light, anchored
to a real address, told in real voice. Not Stripe. Not Linear. Not Apple.
The opposite of a startup landing page that could belong to any company in
any city. This is *this* shop, on *this* block, telling *this* story.

The design pillar that everything bends toward: **the customer is a Cleveland
driver who has been burned by a chain shop and is reading skeptically. Every
visual decision either reinforces "this is real" or it reinforces "this is
another website."** There is no middle.

---

## Visual mood board (in words)

- **Photographed at golden hour, not Photoshopped.** The hero photo of the
  storefront sign is the soul. Every other visual decision exists to not
  dilute it.
- **Brutalist Joy meets Shop Manual.** The aesthetic of a 1970s parts-store
  catalog reissued in 2026 — heavy slab-grotesque headlines, mono labels,
  clean rules, no rounded-corner politeness, but with the warmth of
  yellow-on-black-on-grit instead of black-on-white sterility.
- **Cleveland-specific texture.** Lake-effect grey skies, salt-on-asphalt
  greys, the specific yellow of construction signage and old-school auto
  warning lights. Not "primary yellow." Cleveland yellow. Sodium-vapor
  street-lamp yellow.
- **The grain is on purpose.** A 4% photo-grain overlay site-wide (shipped
  wave-32) sells the "real photo on a real street" feel against the
  rendered-perfect-too-clean trap that AI-templated sites fall into.

---

## Color system — the why behind each value

| Token | Value | Where it goes | Emotional payload |
|---|---|---|---|
| `--brand-yellow` | `#FDB913` | Sign, primary CTAs, $60 callouts, brand wordmark, eyebrow tags | Familiarity, urgency-without-panic, working-class craft. Same yellow as construction equipment, school buses, sodium lamps — signals "this is a working shop" not "this is a brand." |
| `--brand-red` | `#ef4444` (Tailwind red-500) | CALL NOW emergency CTA, error states, EMERGENCY pill | Urgency, action-this-second. Reserved for genuinely-urgent moments. |
| `--bg-deep` | `oklch(0.06 0.004 260)` | Page background | Cinema-black with cool-bias. Reads as "studio" / "after-hours garage with the bay light on" — premium without being sterile. |
| `--bg-card` | `oklch(0.055 0.003 260)` | Section backgrounds, cards | Subtle elevation difference from page bg. Hardware-tray-on-tray feel. |
| `--fg-primary` | `#F5F5F5` | Headlines, primary copy | Off-white slightly warm. Crisp without LED-clinical. |
| `--fg-body` | `#D4D4D4` | Body copy | Reads warmer than pure grey. |
| `--fg-mute` | `#A0A0A0` | Captions, microcopy | Establishes hierarchy without going invisible. |
| `--ring-yellow` | `rgba(253, 185, 19, 0.30)` | Primary card outlines (Double-Bezel) | The hairline that lets cards feel like machined hardware. |
| `--ring-neutral` | `rgba(255, 255, 255, 0.06)` | Secondary card outlines | Whisper-quiet structural cue. |

### Forbidden colors (because they read AI-templated)

- ❌ Pure `#FFFFFF` text — always slightly warm or cool off-white
- ❌ Tailwind `slate-*` greys with bluish bias — kills the warmth
- ❌ Pure `#000000` — feels OLED-cold; use the `oklch` deep instead
- ❌ Purple/violet gradients — the SaaS-AI fingerprint
- ❌ Emerald-to-blue gradients on CTAs — Linear/Stripe trope
- ❌ Brand-yellow used decoratively (without semantic intent) — burns the trust signal

---

## Typography system

### Fonts in use

- **Headings:** custom `font-heading` (currently mapped to a slab-grotesque
  via Tailwind extend). Heavy weights (700-900). Uppercase by default for
  H1/H2. Tracking tightened (`tracking-tight` = -0.025em) at large sizes
  because the slab face needs negative letter-spacing to feel like a
  shop-sign stencil and not an academic header.
- **Body:** system sans (font-sans default). Sized down 1 step from
  internet-default (16px → 15px) so the page reads like print, not blog.
- **Mono:** for eyebrow tags, address callouts, microcopy where it reinforces
  "data not decoration."

### Typography rules

1. **The H1 is the brand statement, not a generic headline.** "PULL UP FOR
   TIRES. DROP OFF FOR REPAIRS." is the tagline; everywhere it appears, it
   appears identically. Eight words. Yellow-on-the-second-line.
2. **Use clamp() for headline sizes.** `clamp(1.5rem, 3.5vw, 3.5rem)` —
   means same line-fit across phone/tablet/desktop. Wave-24 locked this.
3. **Eyebrow tags are 10-11px uppercase tracking-[0.22em].** Microscopic but
   present. Codified into `<Eyebrow>` component (wave-31). Reuse across
   every section above an H2.
4. **Multi-layer text-shadow on photo overlays.** Drop-shadow + text-shadow
   + 1px stroke + paintOrder. Wave-19 stack. Non-negotiable for any
   headline sitting over a photo.
5. **No serifs on H1.** Tested in audit consideration; Cleveland-tough
   doesn't read serif. Skip the variable-serif headline experiment forever.

---

## Spacing system

Macro-whitespace is the bourgeois move that separates portfolio-grade sites
from template sites. This is the most under-applied design principle in
small-business web design.

### Section padding scale

- **Tight:** `py-12 lg:py-16` — utility sections (legal, breadcrumbs)
- **Standard:** `py-20 lg:py-28` — most content sections
- **Premium:** `py-20 lg:py-32` — marquee moments (SignFeature, hero band, lender tiers)

The rule: **double the padding you think you need.** If it looks "tight but
balanced," it's still 50% too dense. The site should breathe like a museum
gallery, not a Shopify category page.

### Container widths

- **Default container:** Tailwind container (max-w-7xl with px-4 sm:px-6 lg:px-8)
- **Reading width:** max-w-3xl on long-form (blog posts, pillars)
- **Hub layouts:** max-w-6xl (comparison pages, financing tiers)

---

## Component vocabulary

### The Double-Bezel (codified wave-32)

Outer shell + inner core with concentric radii — cards feel like physical
hardware, not divs. Used on lender tiers, pillar callouts, FAQ accordion,
strengths/weaknesses comparison cards.

```
outer: rounded-[1.5rem] p-[3px] bg-color/[0.025] ring-1 ring-color/[0.06]
inner: rounded-[calc(1.5rem-3px)] p-6 lg:p-8 bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]
```

Primary tier (active state) gets `ring-[#FDB913]/30` instead of neutral.

### The Magnetic Button (codified wave-31)

Custom cubic-bezier `(0.32, 0.72, 0, 1)` for spring-mass simulation +
`active:scale-[0.98]` press feedback + group-hover icon micro-rotations.
Applied to every primary CTA. Linear/ease-in-out is forbidden.

### The Button-in-Button (codified wave-31)

Trailing arrow lives in a nested `36×36 rounded-md bg-black/12` island that
translates `+1px x / -1px y` on group-hover. Reserved for the conversion CTA
(SCHEDULE DROP-OFF). Wins the visual race against secondary CTAs by being
mechanically more interesting.

### The Eyebrow (codified wave-31)

10-11px uppercase tracking-[0.22em] font-bold pill above every major
section H2. Three variants: yellow (default, drop-shadow), subtle, filled.

### The Cinematic FadeIn (codified wave-31)

Opt-in mode on the existing FadeIn component: `blur(12px → 0)` +
`translate-y-64 → 0` over 850ms with the magnetic cubic-bezier. Reserved
for marquee moments (PullUpBand trust band).

---

## Motion vocabulary

- **Snappy:** 200-300ms for utility transitions (color, opacity)
- **Magnetic:** 500ms with cubic-bezier(0.32, 0.72, 0, 1) for hover/press
- **Cinematic:** 850ms for entrance reveals
- **Forbidden:** linear easing, ease-in-out, anything over 1s, anything
  under 150ms
- **Always animate via:** transform + opacity + filter (GPU-safe)
- **Never animate via:** width, height, top, left (layout-trigger, kills
  60fps)

---

## Imagery system

- **Hero photos:** real shop, real Cleveland, photographed in available
  light. The 1672×941 wide variant for desktop, 1122×1402 vertical for
  mobile (per `<picture>` swap).
- **Object-position discipline:** when a photo is panoramic and the
  container is square-ish, use `object-fit: contain` not cover. Wave-27
  established this for the brand-sign.
- **Photo grain overlay:** site-wide at 4% opacity, mix-blend overlay,
  z-index 30. The cinematographic detail that AI-templated sites skip.
- **Ken Burns drift:** subtle scale-up on hero photo (existing
  `.ken-burns-target` utility). Free movement, free depth.
- **Vignette:** radial dark falloff on hero. Pulls focus to the center.
- **No stock photography.** Every photo is either the actual shop, the
  actual sign, the actual mechanics, or a tightly-cropped detail
  (tire tread, brake rotor) shot specifically for the site.

---

## Voice + visual reinforcement

The brand voice (codified separately in `shared/blog.ts` and pillar articles)
and the visual system are inseparable. One reinforces the other.

| Visual signal | Voice analog |
|---|---|
| Yellow-on-black contrast | "The chains close. We don't." |
| Macro-whitespace | "Walk in any day we're awake." (room to breathe) |
| Photo grain | "Real photo on Euclid Ave." |
| Single-location, single-shop | "Mechanic-owned. The person quoting your work is the person doing it." |
| Honest comparison tables (not all-yes) | "Pretending Conrad's has no strengths would be a lie." |

If a visual decision could equally support a voice that's *not* Cleveland-
tough — it's the wrong decision.

---

## What this philosophy explicitly REJECTS

- ❌ **Glassmorphism / Antigravity** — wrong vibe (SaaS, futuristic, weightless when we want grounded, heavy, real)
- ❌ **3D scenes / Spline / Three.js** — over-engineered showmanship; trust signal demands earnestness
- ❌ **Variable serif headlines** — boutique-brunch feel, opposite of mechanic shop
- ❌ **Floating-island top navbar** — full-bleed nav with brand wordmark IS the trust anchor
- ❌ **Symmetric 3-column grids without whitespace** — Bootstrap fingerprint
- ❌ **Generic Lucide thin icons** — too SaaS-light; keep current weight
- ❌ **Inter, Roboto, default-system fonts on H1** — anonymous; use the slab grotesque
- ❌ **Pre-checked consent boxes / countdown urgency timers** — manipulative tropes that read as untrustworthy
- ❌ **Pop-ups within 30 seconds** — over-eager and breaks the calm

---

## How to use this document

1. **Before any visual change**, ask: does this reinforce EUCLID GRIT or
   contradict it?
2. **When in doubt about a token value**, use the table above. Don't invent
   new colors/spacing/easing.
3. **When proposing a new component**, check the component vocabulary
   first. Reuse > invent.
4. **When motion is involved**, default to magnetic (500ms cubic-bezier)
   unless one of the codified alternatives applies.
5. **Before shipping a section**, scan the EXPLICITLY REJECTED list and
   confirm the section doesn't drift toward any of those tropes.

---

## Living document

This file is the spec. Future polish work amends it. Anti-patterns added
when they're shipped-then-removed. New component idioms documented when
they're codified. Don't change the philosophy without first arguing why
the existing pillars are wrong.

Last updated: 2026-05-07 (wave-42).
Next update: when wave-43+ codifies tokens into CSS vars.
