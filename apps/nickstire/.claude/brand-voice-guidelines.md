# Nick's Tire & Auto — Brand Voice Guidelines

**Last updated:** 2026-05-18 (wave-181.45)
**Source documents:**
- `server/services/vapi.ts` — `ASSISTANT_SYSTEM_PROMPT` (19,553 chars ≈ 4,888 tokens, 144 lines · measured 2026-07-26 · canonical voice)
- `client/src/pages/ServicesOverview.tsx` + `About.tsx` — page voice in production
- `apps/nickstire/CLAUDE.md` — operator brand directive
- 82 VAPI call transcripts (May 15-17) — voice-of-customer validation

**Canonical authority:** when this file disagrees with anything else, **the VAPI prompt's `# HOW YOU TALK` section wins.** It's been audited against ~3,000 lifetime calls.

---

## 1. Who We Are — in one sentence

Nick's Tire & Auto is the **Cleveland walk-in tire-and-repair shop where you don't pay until you say yes** — family-owned on Euclid Ave since 2018, first-come-first-served, 4.9★ from 1,700+ Google reviews.

---

## 2. Voice Constants — "We Are / We Are Not"

| We Are | We Are Not |
|---|---|
| Direct | Wordy |
| Calm | Hyped |
| Cleveland-warm (gentle dry humor when it fits) | Folksy or theatrical |
| Real-person | Customer-service-bot |
| Specific (numbers, sizes, dollars) | Generic ("great service") |
| Honest "I don't know" | Confident bluffing |
| Plain-spoken | Corporate-template |
| Working-class voice | Aspirational / luxury voice |

**Confidence:** HIGH. Distilled from explicit prompt rules + observed in 82 transcripts.

---

## 3. The Kill List (NEVER use these — they sound fake)

**The list lives in code: [`shared/voice.ts`](../shared/voice.ts) — the Voice Kernel.**

This section used to hold its own bullet list, and `docs/brand/VOICE.md` held a
different one. Both called themselves canonical and they disagreed on 17 of the
24 union entries — which is how "reliable" reached the public site while
"comprehensive" was blocked in copy but never mentioned to the IG generator.

Every entry from this section survives in the kernel with its provenance
recorded (`sources: ["brand-voice-guidelines.md", ...]`), including the four
wave-181.43 audit additions. Two of them were deliberately narrowed when they
moved, and the narrowing is recorded on the rule:

- bare "inspection" -> `bot.free-inspection` ("free inspection"), because Ohio
  safety-inspection language is legitimate elsewhere on the site.
- bare "diagnostic" -> `bot.diagnostic-fee` ("diagnostic fee"), because the shop
  runs a real `/diagnostics` route and diagnostic service pages.
- bare "approval" -> `bot.without-your-approval`.

To read the rules: open `shared/voice.ts`, or run `pnpm run lint:brand-voice --audit`.
To change one: edit `shared/voice.ts`. Re-adding a word list here fails
`voiceKernelParity.test.ts`.

---

## 4. Customer Language — Mirror, Don't Translate

These phrases came **from actual callers** in the May 15-17 audit. Use these words, not synonyms:

| Customer says | Use this verbatim |
|---|---|
| "how much does it cost" | "what it costs" |
| "fix" | "fix" (not "repair", not "service") |
| "check" | "check" (not "inspection", not "diagnostic") |
| "today" | "today" (not "same-day") |
| "drop it off" | "drop it off" (not "leave it with us") |
| "the chains" / "Pep Boys" / "Big O" | "the chains" (collective) |
| "no charge if I walk away" | "you don't pay until you say yes" |

**Confidence:** HIGH. Sourced directly from production transcripts.

---

## 5. The Brand Haikus (Repeatable Position Anchors)

A "haiku" is a concrete, price-led, customer-repeatable line. We have two — every new piece of copy should ladder to one of them.

### 5.1 The Tire Haiku
> "Used tires from $60 installed — includes mount, balance, valve stems, alignment check, and free 20-point safety inspection."

**Where it lives:** VAPI prompt FLOW 1, `/tires` hero, GBP listing, SMS templates.

### 5.2 The Repair Haiku (wave-181.43, NEW)
> **"Free check. Written quote. You don't pay until you say yes."**

**Where it lives (cross-touchpoint per wave-181.44):**
- ✅ VAPI prompt FLOW 3, Beat 1 (Brian's voice)
- ✅ `/services` hero subhead (yellow accent on relief clause)
- ✅ `/services` SEO title + meta description
- ✅ `/about` "Written estimate before any work" tile

**Rule:** when writing repair-related copy for ANY new surface (email, SMS, banner, GBP post, ad), this is the close. Lead with it OR end with it — never bury it in the middle.

---

## 6. Tone Matrix — Flex by Context

The voice constants are fixed. Tone flexes by audience and channel:

| Context | Formality | Energy | Length | Example |
|---|---|---|---|---|
| **Phone — Nick (VAPI)** | Low | Medium | 3 beats ≤25 spoken words each | "Free check. Written quote. You don't pay until you say yes. *...* Sooner the better — squealing turns to metal-on-metal fast." |
| **SMS — booking confirm** | Low | Low | 1-2 sentences | "Got you down for a brake check today. We're at 17625 Euclid Ave, open till 6 PM. — Nick's" |
| **SMS — recovery (declined work)** | Low | Low | 1 sentence + offer | "Hey {{name}}, the $487 brake job we quoted in March — still on your radar? Walk in this week, we'll re-check, you decide." |
| **Page hero (h1)** | Low | Medium-High | All caps acceptable, ≤8 words | "COMPLETE AUTO REPAIR SERVICES" |
| **Page subhead** | Low | Medium | 1-3 sentences, lead with relief | "Free check. Written quote. You don't pay until you say yes." |
| **SEO title** | Low | Medium | 50-60 chars, primary kw first 3 words | "Cleveland Auto Repair · You Don't Pay Until You Say Yes" |
| **SEO meta description** | Low | Medium | 140-155 chars, end with CTA verb | "Cleveland auto repair without the surprise. Free check, written quote, you don't pay until you say yes. 4.9★ from 1,700+ drivers. Walk in 7 days." |
| **Google Business Profile post** | Low | Medium | 100-200 chars | "Brakes squealing? Free check. Written quote. You don't pay until you say yes. Walk in any day this week — 17625 Euclid Ave." |
| **Email — operator transactional** | Low | Low | Short, action-led | "Heads up — Sasha Robin called about her Camry. Coming in today. Drop-off, brake-check intent." |
| **Operator/internal (admin UI labels)** | Low | Low | 1-3 words, no jargon | "Drop off · Walk-in · Declined work" not "Pending Appointment · Walk-In Customer · Lost Opportunity" |

**Confidence:** HIGH on phone, page, SEO (all have shipped examples). MEDIUM on SMS, GBP (less ground-truth data).

---

## 7. Critical Rules (NEVER break — these are absolute)

Sourced from VAPI prompt `# CRITICAL RULES`, applied to ALL surfaces:

1. **NEVER quote a price for repair work.** The ONLY 3 prices we say anywhere are:
   - Used tires from $60 installed
   - Conventional oil change from $50
   - Synthetic oil change from $80
   Everything else: "free check, written quote, you don't pay until you say yes."

2. **NEVER promise a specific person** ("Nick will personally inspect it") — could be wrong on the day.

3. **NEVER commit to "same day"** without checking capacity. Use "first-come, first-served — pull up today."

4. **NEVER make up stock.** If a specific tire size isn't confirmed, say "we usually have most common sizes — walk in and we'll check the rack."

5. **NEVER promise a text/SMS** that depends on the gateway being up. Always have a verbal fallback.

6. **Numbers > adjectives.** "$60 installed" beats "great prices on quality tires." Always.

**Confidence:** HIGH. These are the load-bearing rules — violating any of them creates legal/trust risk.

---

## 8. Visual Voice (when copy travels with design)

Sourced from `apps/nickstire/CLAUDE.md` + `frontend-design` (DFII ≥ 8) skill:

- **One dominant aesthetic direction.** Working-class Cleveland confidence — not luxury, not budget-chain, not Apple-clean.
- **Brand yellow `#FDB913`** is for emphasis (the relief clause, CTAs, prices). Never the background of large blocks.
- **Black/dark surfaces** (`oklch(0.05_0.004_260)` family) dominate; yellow accents punctuate.
- **No AI-slop visuals:** no Inter font, no purple gradients, no perfectly-symmetric grids, no uniformly-rounded everything.
- **Photos > illustrations.** Real shop photos > stock auto-repair imagery > illustrated "mechanic guy with wrench" icons.

**Confidence:** HIGH (encoded in `aesthetic-principles` doctrine + audited by frontend-design skill).

---

## 9. Open Questions (need operator decision)

Each open question carries a **recommendation** + **the specific decision needed** so you can confirm or override in seconds, not re-debate from scratch.

### ✅ Resolved this session (May 18, wave-181)

| # | Question | Resolution |
|---|---|---|
| 1 | Should the Repair Haiku appear on `/contact`? | **Yes — shipped wave-181.48.** Yellow-accent block below existing subhead. SEO description also updated. |
| 2 | Should the kill list be enforced via CI lint? | **Yes — shipped wave-181.49.** Pre-commit hook scans only ADDED lines in `git diff --cached` (pre-existing 241 violations don't block; only new ones do). Audit mode (`--audit`) surfaces full count. |

### ⏸️ Deferred by operator · 2026-05-18 (wave-181.53)

All three open below were reviewed and explicitly deferred — not blocking, not open, just parked. Recommendations preserved so when one of these surfaces as a real need, the answer is already on the shelf.

**#3 — Tone for Spanish-language copy (if/when launched)** · DEFERRED
- Recommendation when revisited: re-localize don't translate. Tú-form, shop-floor cadence, native Cleveland Spanish speaker for re-cast samples. Same haiku structure, native phrasing. Budget ~$200-400 for 4-6 sample re-casts.
- Re-open trigger: multilingual ships on the roadmap.

**#4 — Monthly refresh cadence for §4 (Customer Language) from new VAPI transcripts** · DEFERRED
- Recommendation when revisited: `/loop` or scheduled task pulls last-30-days transcripts, runs `/brand-voice:guideline-generation`, Telegrams proposed §4 diffs for approve/skip. No auto-merge. ~15 min to wire.
- Re-open trigger: operator wants to stop manually re-extracting customer language, OR transcripts surface a sustained vocabulary shift (e.g. a new common-symptom phrase appearing in 10+ calls).

**#5 — Tone for legal / compliance copy** · DEFERRED
- Recommendation when revisited: keep formal. Legal language IS a trust signal here. Don't flip-brand the privacy policy. Only re-cast if a SPECIFIC piece (SMS opt-out line, payment disclosure) is causing friction.
- Re-open trigger: a specific piece of legal copy is identified as off-brand or hurting conversion.

**Confidence:** HIGH that these are real decisions to remain deferred. Operator's explicit call; no further action expected unless a trigger fires.

---

## 10. How to Use This File

### For human copywriters
1. Read Sections 2-7 before writing any new public copy.
2. Run new copy past the kill list (Section 3) and customer-language list (Section 4).
3. End every repair-related piece with — or lead with — the Repair Haiku (Section 5.2).
4. If unsure on tone, check the matrix (Section 6).

### For Claude / AI agents
1. When invoked via `/brand-voice:enforce-voice` on a content request, load this file from `apps/nickstire/.claude/brand-voice-guidelines.md`.
2. Generate content applying Sections 2-7 as hard constraints, Section 6 as soft constraints.
3. Validate against Section 3 (kill list) and Section 7 (critical rules) before presenting.
4. If the content type isn't in Section 6 matrix, ask the operator before guessing tone.

### For future audits
Re-extract from the VAPI prompt every ~30 days. The VAPI prompt evolves faster than this doc — when they drift, the prompt wins, then this doc gets re-synced.

---

*This file is the canonical brand voice for customer-facing nickstire surfaces. It does not cover the admin / operator interface (different audience, different voice — covered by `apps/nickstire/CLAUDE.md`'s operator directive). It does not cover statenour-OS (different brand entirely).*

---

## 11. Amendment · 2026-05-23 · the Eagerness Beat (operator-explicit)

Operator confirmation in this session surfaces a beat that was **implicit
in the existing exemplars** but never named as a principle. Naming it
now so future copy edits anchor here.

### The principle

> **Confident operator + visibly eager to help.**

The two beats run together — never one without the other:
- **Confidence** = "we know what we're doing" (already documented in §2)
- **Eagerness** = "and we actually want you here" *(this amendment)*

The eagerness beat is what separates Nick's from every other shop in
Cleveland. Other shops gatekeep with appointment walls, "we're booked
till Monday," "you should have called ahead." Nick's voice signals,
through copy: **yes, come in, we'll figure it out.** Friction goes on
our side, not the customer's.

### Why this matters

The kill list (§3) tells you what to avoid. The customer language list
(§4) tells you how to phrase things. The eagerness beat tells you what
the line should make the customer **feel** — leaned-toward, welcomed,
zero-friction.

A line can pass every other check in this doc and still be wrong if it
fails the eagerness beat. Example:

| Line | Voice constants ✓? | Kill-list ✓? | Eagerness ✓? | Verdict |
|---|---|---|---|---|
| "Walk-ins welcome." | ✓ | ✓ | ✓ | Ships. |
| "Appointments recommended for best service." | ✓ | ✓ | ❌ | Reject — gatekeepy. |
| "We schedule around you, not the other way around." | ✓ | ✓ | ✓ | Ships. |
| "Please call ahead during peak hours." | ✓ | ✓ | ❌ | Reject — friction on customer's side. |
| "Just show up — we'll make it work." | ✓ | ✓ | ✓ | Ships. |

### Signals that carry the eagerness beat

Use these phrasings (and family-of) to signal eagerness explicitly:

- "Walk-ins welcome" / "Walk in any day" / "Just show up"
- "We'll figure it out" / "Bring it in, we'll work it out"
- "Call us · text us · just show up" *(multiple low-friction options)*
- "Open 7 days" *(never "by appointment only")*
- "Same-day install" / "Done today" *(when it's actually true)*
- "First-come-first-served — pull up today" *(already in VAPI prompt)*
- "We're at 17625 Euclid · come in any time during business hours"
- "Got a weird symptom? Drive it over, we'll listen to it together"

### Signals that BREAK the eagerness beat (kill-list addition)

In addition to the kill list in §3, the following phrasings break the
eagerness beat and should be avoided:

- ❌ "Appointment required" / "Appointments only"
- ❌ "We recommend calling ahead" *(as a hedge, not as info)*
- ❌ "Currently booked" / "First availability"
- ❌ "We'll get back to you within X hours" *(without specifying X under 1)*
- ❌ "Standard business hours" *(say the actual hours, every time)*
- ❌ "Please be patient" / "Thank you for your patience"
- ❌ Any framing that puts the customer's question into a queue

### Where to apply

This amendment doesn't change the haikus, kill list, customer language
list, tone matrix, or critical rules — those all stand. It adds one
filter on top: **every customer-facing line, every channel, every
context, also gets checked for the eagerness beat.**

If a line is dry-confident but reads as friction-on-the-customer's-side
(even subtly), rewrite it to signal "we want you here."

**Confidence:** HIGH. Operator-explicit · 2026-05-23 session · cross-
verified against existing exemplars that already carry the beat
implicitly (Repair Haiku · "Walk-ins always welcome" · "First-come-
first-served").
