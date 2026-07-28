# Nick's Tire & Auto — Brand Voice

**Last updated:** 2026-05-05
**Owner:** Nour
**Companion to:** `docs/audits/PUBLIC_SITE_SEO_2026-05-05.md`

This is how we write. Every page, every email, every SMS, every push
notification, every error message. When something on the site doesn't
match these rules, that's a bug — file it.

---

## The recipe (every line that lands does these three at once)

1. **Surprises** — phrasing the reader didn't expect from an auto-shop
2. **Specifies** — there's a concrete point underneath the wordplay
3. **Reveals** — sounds like a person thinking, not a brand "communicating"

When a line fails, it's because one of the three is missing.

- Surprise without specificity = obnoxious.
- Specificity without surprise = forgettable.
- Both without revealing voice = corporate-trying-to-be-cute.

---

## The 7 patterns (deploy any of these; never the same one twice on a page)

### 1. Mundane comparisons
Replace abstract speed/quality with weirdly-specific real-world units.

> "faster than your phone finds a signal"
> "before your Uber driver gives up"
> "in less time than the McDonald's drive-thru"
> "before your podcast hits the next ad break"

### 2. Anti-promises
Auto shops compete on what they DO. The shortcut is naming what we WON'T.

> "We won't replace pads that pass inspection."
> "We won't quote a fix without showing you the broken part."
> "We won't add a fee at pickup that wasn't on the written estimate."

### 3. Tricolon escalation
Three-item lists where item 3 breaks the pattern.

> "Free install · free coffee · free opinions."
> "Same-day service · written estimate · the part you actually needed."
> "Acima · Snap · Koalafi · whichever says yes first."

### 4. Math-as-argument
Two numbers, a contrast, a punchline.

> "$50 belt prevents a $500 tow."
> "$39 oil change. Or $4,000 engine. Pick one."
> "$79 alignment. Or replace tires twice as fast. Math is brutal."

### 5. Footnote asterisks
The most underused punctuation in marketing. Use it for honest caveats
that sound like a friend whispering.

> "Same-day service*"
> "* Unless the part has to come from Cincinnati. We'll call."

> "4.9★ from 1,700+ reviews*"
> "* Yes, all real. Google catches fakes faster than we do."

### 6. Generational pivots
Span 50+ years in 12 words and land on competence.

> "your grandfather would've trusted, with the diagnostic gear your kid's Tesla actually needs"
> "We've serviced cars older than YouTube and newer than your phone."
> "Your '92 Buick had 50 wires. Your '24 Bronco has 3,000. We trace both."

### 7. Mock-formal in unexpected places
Dignified tone where you'd expect breezy = funny + memorable.

> Cookie banner: "We use cookies. Browsers do that. Carry on."
> 404 page: "This page does not exist. Like the muffler on a Civic with a fart can."
> Newsletter: "One email per month, fewer if nothing's worth saying."

---

## The cliché kill list

**The list lives in code: [`shared/voice.ts`](../../shared/voice.ts) — the Voice Kernel.**

It used to live here as a markdown table, and in six other places besides: the
linter, a stale duplicate of the linter, the IG generator prompt, the IG critic
prompt, the compliance test, and `.claude/brand-voice-guidelines.md`. No two
agreed. "Reliable" was killed by this document and banned in both IG prompts but
had no pattern in the CI linter, so it shipped to the live site; "comprehensive"
was the same drift running the other way.

So the table is gone on purpose. Every rule now carries its `why`, its `fix`, its
severity, its allowlisted exceptions and the list of sources that asserted it —
as data, in one file, imported by everything that writes or checks copy.

- Reading the rules: open `shared/voice.ts`, or run `pnpm run lint:brand-voice --audit`
- Adding or changing a rule: edit `shared/voice.ts`. Nowhere else.
- Re-adding a word list to this document fails `voiceKernelParity.test.ts`.

The positive half of this document — the recipe, the 7 patterns, the 1:3 ratio,
the surface rules and the CTA library — is in the kernel too, so generators are
told what a GOOD line looks like and not only which words are forbidden. The
prose below stays because humans write copy from it; the machine reads the
kernel.

---

## The 1:3 ratio rule

**At most one absurd line per three paragraphs of straight copy.**

More than that and the voice becomes a parody of itself. The Home page,
Booking, and Financing get away with denser voice because they're
high-stakes conversion pages. Service pages should have ONE strong line
in the hero, then plain English in the body, then maybe one more in
the closer.

---

## Where NOT to deploy voice (hard rules)

| Surface | Rule |
|---|---|
| Pricing pages | Clear > clever. Customers comparing prices need them readable. |
| Booking confirmation flow | Post-form, the customer is committed. Don't break the moment. |
| FAQ answers | Question can be playful. The answer cannot. |
| Error / payment failures | Never. Frustration + humor = anger. |
| Service warranty terms | Legal text. Boring on purpose. |
| Phone, address, hours | Always plain. Never style. |
| `<title>` / meta description | SEO is robotic. Save voice for body copy. |
| Schema / JSON-LD | Same — robotic. |

---

## Page archetypes (what voice looks like in context)

### Hero (any page)
- 1 line H1 with a verb or a stand-alone observation
- 2-4 line subhead in plain English
- 1 or 2 numbers (price, count, time)
- 2 CTAs, microcopy varies (see below)

### Service detail (brakes, tires, etc.)
- H1 in voice (one of the 7 patterns above)
- Body copy: plain English, no marketing
- 1 anti-promise per page max
- Footnote asterisk on a key claim
- Plain pricing table — no voice in numbers

### Trust / About
- Anti-promises section (5-7 lines)
- "What we give you free" section (concrete list)
- Owner/named person signature block
- Photos of the actual shop, named team

### Booking / Lead capture
- Reciprocity-loaded headline ("Hold your spot.")
- 60-second-promise as subhead
- Dollar number AND time number
- CTA reads as the customer would say it

---

## CTA microcopy library

Replace generic "BOOK NOW" / "CALL NOW" with what the customer would say:

| Context | Generic | Voice-led |
|---|---|---|
| Hero on /brakes | BOOK NOW | "Hold a bay" |
| Hero on /tires | ORDER NOW | "See my size" |
| Hero on /diagnostics | BOOK NOW | "Read my codes" |
| Bottom of FAQ | GET IN TOUCH | "Talk to a real human" |
| Sticky mobile bar | CALL NOW | "Call (216) 862-0005" (show the number) |
| Financing | APPLY NOW | "See if I qualify" |
| Booking form submit | SUBMIT | "Hold my spot" |
| Newsletter capture | SUBSCRIBE | "Send me one email a month" |

---

## How to grade a piece of copy

Before shipping any new line, ask:

1. **Could any other auto shop in Cleveland write this?** If yes, rewrite.
2. **Is there a number?** If a quantity, time, or price applies, include it.
3. **Is there a verb?** Static descriptive phrases die fast.
4. **Does it claim something instead of showing it?** Cut "trusted", "expert", "quality".
5. **Did the cliché kill list catch anything?** Search the line.
6. **Is this the one absurd line on the page?** If page already has one, keep this one straight.

Pass all six = ship.

---

## When voice goes too far (fail-modes)

- **Self-aware about being self-aware.** "Yes, I know this sounds clever..." → cringe.
- **Stacked jokes.** Two jokes in one line cancel each other out.
- **Punching down.** Never make the customer the butt of a joke.
- **Politics, religion, partisan shibboleths.** Off-limits forever.
- **Faux-British or faux-formal as the BASE voice.** Mock-formal works in surprising contexts (cookie banner). Not as the house voice.
- **Inside jokes.** Voice should land for someone who's never been to Cleveland.

---

## Living document

This file gets updated when a new pattern proves itself or an old one
fails. Don't ship copy without checking against it. If you have a line
that breaks one of these rules but you're sure it works — make the case
in PR, get a second opinion, then update the doc.
