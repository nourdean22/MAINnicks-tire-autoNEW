# Nick's Tire & Auto — Brand Voice Guidelines

**Last updated:** 2026-05-18 (wave-181.45)
**Source documents:**
- `server/services/vapi.ts` — `ASSISTANT_SYSTEM_PROMPT` (40k chars · canonical voice)
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

Source: VAPI prompt lines 142-148.

- ❌ "trusted" / "expert" / "quality" *(as adjective labels)*
- ❌ "rest assured" / "hassle-free" / "state-of-the-art"
- ❌ "comprehensive" / "premium" / "top-notch"
- ❌ "Per your inquiry" / "How may I assist"
- ❌ Generic "have a great day" *(be specific instead: "drive safe")*

**Add (from this session's audit, wave-181.43):**
- ❌ "inspection" *(say "check")*
- ❌ "diagnostic" *(say "we'll tell you what's wrong")*
- ❌ "approval" *(say "until you say yes")*
- ❌ "no surprises" *(passive — say "we tell you the cost before we touch anything")*

**Confidence:** HIGH on the original 5 (in production prompt). MEDIUM on the 4 audit additions (logged from today's transcripts but not yet enforced in prompt).

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

### 🟡 Still open · with recommendations

**#3 — Tone for Spanish-language copy (if/when launched)**
- **What's known:** No Spanish copy ships today. Cleveland Latino working-class population is real and growing in Euclid/Slavic Village neighborhoods. A literal translation of the current voice would land as overly formal in Spanish ("you don't pay until you say yes" → "usted no paga hasta que usted diga sí" reads as a legal contract, not a shop guy).
- **Recommendation:** Re-localize, don't translate. Hire a native Cleveland-area Spanish speaker (one of your customers, or someone at the shop) to listen to a sample of English VAPI calls and re-cast Brian's lines in natural conversational Spanish. Target: tú-form (informal), shop-floor cadence, mirror local Spanglish where natural ("free check" stays in English because Cleveland Latinos use it). Same haiku structure, native phrasing.
- **Need from you:** (a) is multilingual on the roadmap in the next 6 months? If no → defer the question. If yes → green-light a $200-400 budget to record 4-6 sample re-casts with a local Spanish speaker, then I can synthesize a Spanish §6 row.

**#4 — Cadence for refreshing §4 (Customer Language mirror) from new VAPI transcripts**
- **What's known:** New customer phrases surface in transcripts every week. The VAPI prompt itself evolves (we audit weekly). This doc was distilled once, on May 18, from 82 calls.
- **Recommendation:** Monthly refresh, automated. Set up a `/loop` or scheduled task that on the 1st of each month: pulls the last 30 days of VAPI transcripts, runs `/brand-voice:guideline-generation` against them, diffs the §4 (Customer Language) table, and Telegrams you the proposed adds/removes. You approve or skip — no auto-merge. ~15 min to wire, then runs forever.
- **Need from you:** Green-light a monthly automated refresh (vs ad-hoc as-needed). I'll wire it as wave-181.52 if you say go.

**#5 — Tone for legal / compliance copy (privacy policy, terms, disclaimers)**
- **What's known:** Currently formal. Privacy policy reads like a privacy policy. No customer complaints about it.
- **Recommendation:** Keep formal — don't flip-brand the legal copy. Two reasons: (a) legal language IS a trust signal in this context; a "hey friend, here's what we do with your phone number lol" privacy policy would look unprofessional + reduce conversion + risk regulator side-eye. (b) The customer who reads the privacy policy at all is already in a different mode than the one calling about brakes. Match their mode.
- **Need from you:** Confirm "keep formal" so we close this question. (Or: identify the SPECIFIC piece of legal copy that bothers you — sometimes a SMS opt-out line or a payment disclosure could ladder up to brand voice without the full legal copy flipping.)

**Confidence:** HIGH that these are real open decisions. Recommendations are MEDIUM-confidence — they're informed guesses, your call to confirm or override.

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
