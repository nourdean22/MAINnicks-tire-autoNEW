# Copy Audit & Engineering Notes

> Output of the copywriting-psychologist + loss-aversion-designer + ux-copy
> skill pass. Generated 2026-05-07 (wave-46) on top of the design-foundation
> docs (DESIGN_PHILOSOPHY.md, EMOTION_MAP.md, JOURNEY.md).

---

## Summary

The customer-facing site's copy is **already strong** in brand voice. The
two prior session waves of voice work (codified in shared/blog.ts comment
header + the brand-voice notes embedded across pages) established the
register: Cleveland-tough, plainspoken, slightly sardonic, anti-corporate,
specificity-inflation operators applied.

This audit found **no major voice failures** — the site doesn't sound
generic. It found **micro-leverage opportunities** in 6 specific surfaces
where psychological framing would sharpen what's already there.

---

## Brand voice — codified for reference

The voice operates on five evolution operators (formalized in
shared/blog.ts header):

1. **SPECIFICITY INFLATION** — "Free brake check" → "rotor thickness measured to .001 inch"
2. **CONCESSION-FIRST PERSUASION** — "We're great" → "Cheaper than the dealer. More honest than the chain."
3. **USEFUL ABSURD COMPARISON** — "Same-day repair" → "out the door before lunch"
4. **ANTI-PATTERN NAMING** — "Honest pricing" → "The chain advertises a tire price. They don't advertise the $289 they tack on at the register."
5. **INSIDER VOCABULARY** — "Diagnostic" → "code pull"; mechanic-shop colloquialism

Also enforced (codified in voice-compliance.test.ts):
- metaTitle ≤ 60 chars
- metaDescription ≤ 170 chars
- KILL_LIST clichés banned: "top-rated", "trusted", "premier"

---

## Six surfaces with copy leverage

### 1. 404 page (`/404`) — SHIPPED wave-46

**Was:**
- "This page does not exist."
- "Like the muffler on a Civic with a fart can. We're better at finding
  car problems than missing ones — pull up to the homepage."

**Now:**
- "Wrong page. Same shop."
- "We can't find this URL. We can probably find what's wrong with your
  car, though. Pull up to the homepage — or describe your symptom and
  we'll match it to a likely fix."

**Why the change:**
- Loss-aversion frame: names the friction user just hit (wrong page =
  wasted click) immediately, doesn't make them figure it out
- Concession-first: "Same shop" reframes the failure as continuity, not
  a dead end
- Concrete recovery: two specific options (homepage, symptom-match) vs
  generic "go home"
- Brand voice preserved: still Cleveland-tough plainspoken, less joke-
  reliant (the "fart can" line was funny but didn't drive recovery
  behavior)
- Magnetic button physics + brand-yellow shadow added (matches wave-31
  hero CTA pattern; previously this page was using older button style)

### 2. Booking page hero CTAs — review pending wave-47

The booking page is the conversion endpoint. Wave-47 (CRO pass) will
audit the form fields, validation copy, success states. Voice-wise the
H1 is already in register ("DROP IT OFF.") but the field labels and
error states need a sweep.

### 3. UrgencyWidget popup copy — defer

The wave-32 work codified the urgency widget into PageLayout. Copy
review of the popup itself (when shown, what it says, how to dismiss)
is a wave-47 task because urgency-without-aggression is a CRO pattern,
not a copy pattern.

### 4. ExitIntentModal copy — defer to wave-47

Same as #3 — exit-intent is a CRO concern, not a pure-copy concern.

### 5. Footer CTA stripe — keep

Current copy: "Car acting up? We can usually fix it same day. Call
(216) 862-0005 or Schedule Drop-Off"

Already in voice. Specificity ("usually fix it same day"), concrete
recovery options, bracketed by phone + form. Don't touch.

### 6. EmailNewsletterCapture component — defer

Newsletter capture copy is a separate vertical (subject-line-psychologist
skill territory). Defer to a future session.

---

## Banned phrases discovered + replaced (none on customer-facing)

The voice-compliance test enforces a KILL_LIST. Audited customer-facing
pages for residual instances:

| Banned phrase | Customer-facing instances | Status |
|---|---|---|
| "top-rated" | 0 | ✅ Clean |
| "trusted" | 0 | ✅ Clean |
| "premier" | 0 | ✅ Clean |
| "world-class" | 0 | ✅ Clean |
| "best-in-class" | 0 | ✅ Clean |
| "cutting-edge" | 0 | ✅ Clean |
| "leverage" (verb) | 0 | ✅ Clean |
| "synergy" | 0 | ✅ Clean |

The site genuinely doesn't sound generic. The voice work paid off.

---

## What I didn't change but considered

- **Hero subhead** — "Cleveland's first-come-first-served shop on Euclid
  Ave. Walk in 7 days. Used tires from $60 installed. Written estimate
  before any wrench moves. Payment programs on the spot. Don't let the
  problem get bigger." Already in register. Touching it risks regressing
  the wave-22 polish.

- **Trust strip** — already mono-fact rhythmic. Touching adds risk.

- **Service page H1s** — each is in register ("WHEEL ALIGNMENT
  CLEVELAND OH", "SYNTHETIC OIL CHANGE CLEVELAND" etc.) and the meta
  fields were just GSC-tuned in wave-40. Don't double-touch.

- **Pillar article body copy** — 8,300 words shipped tonight in waves
  35-37. All in voice. Audit later when conversion data informs which
  passages convert.

---

## Future copy work (next session candidates)

1. **Booking flow microcopy** — wave-47 territory
2. **Service-page bottom-of-page upsell copy** — currently FocusedServicePage
   template uses generic "related services" links; could be voice-styled
3. **Form validation error states** — "Please enter a valid email" → "We
   need an email so we can send the estimate. Format like name@example.com."
4. **Empty states** (when search returns nothing, when reviews query fails,
   etc.) — currently mostly generic
5. **Loading microcopy** — "Loading..." → "Pulling the latest from the
   shop..." or similar voice-aligned variants
6. **Email subject lines** (Twilio/Resend templates) — separate skill
   (subject-line-psychologist)

---

## Why this audit shipped a smaller change set

The user's prior work on voice (codified in voice-compliance.test.ts +
brand voice operators in blog.ts header) was thorough. Most surfaces
that would have warranted copy refactor are already in good shape.

The high-leverage win in this audit was the 404 page — high-traffic
fallback surface (any broken link, any GSC indexing error, any old
backlink to a removed URL → lands here). Sharper recovery copy = less
bounce = more retained intent.

Last updated: 2026-05-07 (wave-46).
