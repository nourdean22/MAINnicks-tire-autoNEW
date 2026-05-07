# Visual Emotion Map — Nick's Tire & Auto

> Maps every visual decision to a specific target emotion using the
> arousal-valence framework from Bower et al. 2022, Liu et al. 2022,
> and Damiano et al. 2023. Generated 2026-05-07 (wave-42) via the
> visual-emotion-engineer skill.

---

## The target emotional sequence

The customer arrives in one of three states. The site has to take them
through a precise emotional progression to convert.

### Arrival state options

1. **Skeptical-burned** (most common) — got upsold at a chain last visit.
   Arousal: medium-high (mild anger). Valence: negative.
2. **Urgent-needy** (~30%) — tire blew, engine light came on, has to fix
   today. Arousal: high (mild panic). Valence: negative.
3. **Researching-curious** (~20%) — comparison shopping, weeks before
   purchase. Arousal: low. Valence: neutral.

### Target emotional progression (all three converge here)

```
ARRIVAL (skeptical/urgent/curious — varies)
   ↓
HERO LANDING: arousal stays where it is + valence flips to neutral-positive
              "this is real, this is honest, my pulse can come down a notch"
   ↓
SCROLL through trust signals (sign, reviews, prices in writing)
              valence climbs further; arousal stays moderate
   ↓
COMPARISON / SERVICE PAGE: cognitive load drops as honest tradeoffs are shown
              valence: positive. arousal: medium (now interested, not anxious)
   ↓
SCHEDULE DROP-OFF / CALL CTA: arousal spikes (decision moment)
              valence: positive. The decision feels like a relief, not a risk.
   ↓
CONVERSION: arousal-resolution + relief
```

The emotional engineering goal: **convert "I've been burned before" into
"I think this is the honest one" inside the first 8 seconds of the hero,
then ride that flipped valence through to drop-off scheduling.**

---

## Color → emotion mapping

| Color | Arousal effect | Valence effect | Where to use it | Where NOT to use it |
|---|---|---|---|---|
| `--bg-deep #0A0A0A` (cinema-black w/ cool bias) | Lowers arousal | Neutral | Page background, all sections | Anywhere we need warmth |
| `--brand-yellow #FDB913` (sodium-vapor working-class yellow) | Raises arousal moderately | Strongly positive (familiarity, craft, "real") | CTAs, sign, $60 callouts, "Don't let the problem get bigger" | Decoratively. Burns trust signal. |
| `--brand-red #ef4444` | Raises arousal sharply | Negative if overused, positive when reserved for actually-urgent | CALL NOW, EMERGENCY pill, error states | Anywhere non-urgent. Otherwise red becomes panic-fatigue. |
| `--fg-primary #F5F5F5` warm off-white | Neutral arousal | Neutral-positive (clean) | All headlines, primary copy | Pure white #FFF — too clinical |
| `--fg-mute #A0A0A0` | Lowers arousal | Calm | Microcopy, captions | Body copy that needs to be read |
| Emerald-400 (rgb 52, 211, 153) | Lowers arousal | Strongly positive | Strengths checkmarks in comparison tables | As primary or as text — feels SaaS |
| Rose-400 (rgb 251, 113, 133) | Raises arousal slightly | Negative-but-honest | Weakness/AlertCircle markers | Never as text or background — feels distressing |

### The yellow rule

`#FDB913` is the only "high-saturation" color we use, and it's reserved for
**moments of trust + moments of action**. The yellow says *both* "this is
the same yellow as the sign you've driven past" *and* "this is the button
you should press." Never use it ornamentally. Every yellow pixel is a vote
of confidence.

If a designer adds a yellow underline, a yellow background tint, a yellow
hover state — that yellow has to do *trust work* or *action work*. Otherwise
the brand-yellow's signaling power dilutes. After ~5 yellow elements in a
viewport, it stops meaning anything.

---

## Typography → emotion mapping

| Typography decision | Arousal effect | Valence effect | Reasoning |
|---|---|---|---|
| Slab-grotesque H1 (heavy, uppercase, tracking-tight) | Raises arousal moderately | Positive (industrial, capable) | Reads like a shop sign, not a marketing headline |
| `clamp(1.5rem, 3.5vw, 3.5rem)` (large but capped) | Raises arousal | Positive | Big enough to assert presence; capped so it doesn't overwhelm and read aggressive |
| 4-layer text-shadow on photo overlays | None (perceptual) | Positive (legibility = trust) | Crisp text over photo signals "considered design" |
| Multi-line H1 with yellow second line | Raises arousal on line 2 | Positive | The yellow line is the action; the white line is the context |
| Subhead `text-base sm:text-lg lg:text-xl` (one notch smaller than typical) | Lowers arousal | Neutral-positive | Reads like print, not blog. Calmer. |
| Eyebrow tags `tracking-[0.22em] uppercase 10px` | Lowers arousal | Positive (rhythm, gives breathing room before the H2) | Microscopic but present — establishes editorial calm |
| Mono for address/phone callouts | Neutral | Positive (factual, not promotional) | "These are facts, not marketing" |

### The forbidden typography signals

- Variable serif headlines → reads boutique-brunch (wrong target)
- Italic body copy in product sections → too literary
- Letter-spacing on body copy → academic feel
- Small caps on headlines → SaaS conference fingerprint
- Drop-cap on first paragraph → magazine pretension on a trade site
- Custom @font-face on body → loading-time vs ROI doesn't pencil

---

## Spacing → emotion mapping

| Spacing decision | Arousal effect | Valence effect | Reasoning |
|---|---|---|---|
| `py-20 lg:py-32` on premium sections | Lowers arousal | Strongly positive | Macro-whitespace = gallery feel. Calm, expensive, considered. |
| Tight density (`py-12`) on utility sections | Neutral | Neutral | Functional sections shouldn't compete for attention with marquee moments |
| 100vh hero | Raises arousal slightly | Positive | Asserts the brand presence with full first-screen real estate |
| Multi-section vertical scroll vs single-page-app | Lowers arousal | Positive | Each section gets focus; user controls pace |
| Sticky trust strip (existing) | Lowers arousal | Positive (always-present trust signal) | Reduces uncertainty as user scrolls deeper |

### The whitespace rule

The instinct on small-business websites is to fill every pixel with
information ("we have to convince them!"). The opposite is correct:
**whitespace IS the trust signal**. Empty space says "we don't need to
hard-sell you. We know what we are. The information is here when you want
it."

If a section feels cramped, the answer is never "make the text smaller" —
it's "double the padding."

---

## Imagery → emotion mapping

| Imagery decision | Arousal effect | Valence effect |
|---|---|---|
| Real photographed sign + storefront | Lowers arousal | Strongly positive (concrete = trust) |
| Photo grain overlay site-wide | Neutral | Positive (cinematographic) |
| Ken Burns slow drift on hero | Neutral | Positive (alive but not aggressive) |
| Vignette (radial dark falloff) | Lowers arousal | Positive (focuses attention) |
| Vertical mobile photo of just-the-sign | Lowers arousal | Strongly positive (the sign IS the trust signal) |

### The photography rule

Every image should answer one question: *would a customer who actually
visited the shop recognize this as their experience?* If yes → ship. If
the image looks generic-stock or generic-AI-generated, it actively hurts
the trust signal even if it's "pretty."

---

## Motion → emotion mapping

| Motion decision | Arousal effect | Valence effect |
|---|---|---|
| Magnetic 500ms cubic-bezier hover on CTAs | Raises arousal moderately on interaction | Positive (tactile, considered) |
| Cinematic 850ms blur-clearing reveal on entrance | Lowers arousal | Positive (cinematic, intentional) |
| `active:scale-[0.98]` press feedback | Neutral arousal | Positive (haptic affirmation) |
| Stagger-in animations (0.1s delay per item) | Lowers arousal | Positive (controlled rhythm) |
| Linear easing | Raises arousal (uncomfortable) | Negative (mechanical, not human) |
| Anything over 1s | Raises arousal | Negative (impatience) |

### The motion rule

All motion simulates real-world physics. Spring-mass curves over linear.
Things settle into place; they don't just appear. The cubic-bezier
`(0.32, 0.72, 0, 1)` is the project's signature — every transition uses it
unless there's a documented reason not to.

---

## Specific emotional checkpoints in the page flow

### Home hero (8 seconds)

- **Goal:** Skeptical → Trusting
- **Visual cues that do the work:**
  1. Yellow sign visible (mobile: photo cropped to show sign; desktop:
     anchored right; sign IS the trust signal)
  2. H1 tagline in brand voice ("Pull up. Drop off.")
  3. Sub copy that names the friction explicitly ("First-come-first-served"
     contradicts the chain-pattern of appointment-friction)
  4. 3 CTAs in priority order: SCHEDULE DROP-OFF (yellow), CALL NOW (red), GET DIRECTIONS (outline)
- **What we're avoiding:** any element that reads as marketing-spin

### Trust strip (4 seconds)

- **Goal:** Trusting → Confident
- **Visual cues:** 4.9★ rating, 1700+ review count, FCFS, $60 floor, payment programs, open 7 days
- **Format:** Mono-font numbers, micro-copy, rhythm of bullets

### Comparison hub / service pages (30-90 seconds)

- **Goal:** Confident → Convinced
- **Visual cues:** Honest matchup tables (we don't claim 100% on every dimension), strengths-and-weaknesses cards (Double-Bezel), Cleveland-specific specificity ("3-4x bent rim business of Phoenix shops")

### Booking form (15-30 seconds)

- **Goal:** Convinced → Committed
- **Visual cues:** Single CTA per visible state, no asks for info we don't need, written-estimate promise visible at top, FCFS phrasing reinforced

---

## Emotion debugging — when conversion breaks

If the bounce rate spikes on a specific page, run this diagnostic:

1. **What emotion did the visitor arrive with?** (intent + traffic source)
2. **What emotion does the page transition them to?** (look at hero +
   first-screen visuals)
3. **Is the transition aligned with the goal sequence above?**
4. **Is there visual element competing with that transition?**

The most common visual-emotion bug: a page tries to *generate* emotion
through decoration ("Look how exciting!") when it should be *containing*
emotion ("You're in the right place, here's why").

---

## Anti-patterns explicitly forbidden by this map

- ❌ **Stock photo of a smiling person** — generic positive emotion that
  doesn't bind to brand. Reads as ad.
- ❌ **Confetti / sparkle animations on success** — over-eager joy that
  doesn't match the calm-honest brand register.
- ❌ **Bright primary-gradient backgrounds** — high-arousal but
  low-valence-after-3-seconds (visual fatigue).
- ❌ **Bouncing CTAs / pulsing ring on buttons** — desperation tells.
- ❌ **Carousels of testimonials** — induces fatigue + doesn't get read.
  Use a single curated quote instead.
- ❌ **Modal pop-ups within first 30 seconds** — interrupts the trust
  build.
- ❌ **Live chat bubble that auto-opens** — same problem.
- ❌ **Cookie banner that animates aggressively** — first impression pollution.

---

## How this document gets updated

When a visual decision performs well or poorly in real conversion data,
the corresponding row in the tables above gets annotated with the
evidence. This is a living spec.

Last updated: 2026-05-07 (wave-42).
