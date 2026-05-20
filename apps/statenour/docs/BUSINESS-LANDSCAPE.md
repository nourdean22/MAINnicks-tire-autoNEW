# BUSINESS LANDSCAPE · Nick's Tire & Auto — How We Run

> **Source of truth for any agent, human or AI, working on NOUR OS or nickstire.org.**
> **Read this FIRST before building anything business-facing.**
> **Updated continuously — keep it current. If behavior drifts from this doc, this doc is right.**

---

## Identity

**Company:** Nick's Tire & Auto
**Address:** 17625 Euclid Ave, Cleveland OH 44112
**Phone:** (216) 862-0005
**CRM / shop-management:** Auto Labor Guide (ShopDriver Elite)
**Payments:** Gateway (primary), Stripe (online), Snap Financing (BNPL)
**Operator:** Nour Dean — sole owner, sole operator of every system
**Sister OS:** `nickstire.org` = business side · `bdnick.info` = personal OS (statenour-os)

---

## The One-Sentence Business Model

> **Drive a LINE OF CARS to the shop EVERY SINGLE DAY via appointmentless tire repair + happy drop-off/Uber-out experience.**

Everything else — marketing, CRM, pricing, follow-up, branding — serves that sentence.

---

## The Operating DNA (Nour's words, verbatim, reinforced 2026-04-22)

> **"We can focus more on driving a line of cars to the shop every day, appointmentless tire repairs and happy people waiting for there car and happy people happily driving down to drop off there car and call a uber out of there. Thats how I built the place."**

The four pillars pulled from that sentence:

### 1. LINE OF CARS
The headline metric. Always visible. Always moving. No one thinks *"am I getting customers?"*— they *see* the line.
- Every feature asks: *does this drive another car through the bay today?*
- UI/dashboard lead element = today's car count (booked invoices + walk-ins + drop-offs) with a delta vs yesterday vs 7d avg.
- Marketing copy uses urgency + FOMO + "right now" language — we're racing daylight.

### 2. APPOINTMENTLESS / FCFS
First come, first serve. NO scheduling required. Appointments are a *nice-to-have* for fleet + oil changes; for tires, walk-ins win.
- The website, Google Business Profile, and every touch should de-emphasize booking friction.
- SMS replies always include "come now" + address + ETA, never "schedule an appointment."
- Internal queue displays: next-in-line, ETA per bay, not calendar blocks.

### 3. HAPPY WAIT
Waiting customers get treated like VIPs, not held hostage.
- Clean lobby · WiFi · device charging · cold water · snacks · clear ETAs.
- Text updates: "car on lift · 15 min remaining" rather than radio silence.
- Quick-wins: tire shine, windshield wipe, tire pressure check — free, unexpected, memorable.

### 4. DROP-OFF + UBER-OUT
Biggest flywheel. Customer drops off on the way to work / dinner / errand, calls an Uber, comes back later. Zero waiting = infinite convenience.
- Promote aggressively: "Drop it off — we'll text you when it's ready"
- Build systems that make drop-off feel safer than waiting (signed check-in sheet, photo intake, text confirmations, Venmo/Zelle/Stripe remote pay).
- Partner with Uber/Lyft — eventual ride-credit promo for tire-drop customers.

---

## Metrics That Matter (in priority order)

| Rank | Metric | Why | Where it lives |
|------|--------|-----|----------------|
| 1 | **Cars through the bay today** | The headline. Primary action signal. | `/api/nickstire/query?q=cars_today` |
| 2 | **Invoices (sales WON)** | Revenue realized. An invoice = money collected. | Auto Labor Guide / Gateway |
| 3 | **Estimates without invoice (sales LOST)** | The conversion hole. Each one is a chase call. | Auto Labor Guide |
| 4 | **Estimate → Invoice conversion %** | The critical gate metric. Not lead→booking. | Computed: invoices ÷ (invoices + open estimates aged > 48h) |
| 5 | **Drop-off ratio** | % of jobs that were drop-offs vs wait-ins | Auto Labor Guide note field |
| 6 | **Hour-of-day heat** | Staffing + marketing targeting | Timestamp on estimate creation |
| 7 | **Average time-in-bay** | Capacity + efficiency | Job start/stop timestamps |
| 8 | **Source attribution** | Where's the next car coming from? | Lead.source: gbp / walk-in / referral / web / ads / sms |

---

## Funnel (in the correct order)

**WRONG:** lead → booking → completion (this is appointment-based — NOT us)

**RIGHT (appointmentless):**
```
  ╔═══════════════════════════╗
  ║ Marketing / GBP signal    ║   ← "line of cars" driver
  ╚══════════════╤════════════╝
                 │
  ╔══════════════╧════════════╗
  ║ Car arrives (walk-in)     ║
  ║   or drops off + Ubers    ║
  ╚══════════════╤════════════╝
                 │
  ╔══════════════╧════════════╗
  ║ Estimate written          ║   ← moment of commitment
  ╚══════════════╤════════════╝
                 │
  ╔══════════════╧════════════╗
  ║ Invoice closed (SALE WON) ║   ← revenue realized
  ╚══════════════╤════════════╝
                 │
  ╔══════════════╧════════════╗
  ║ Follow-up + review + SMS  ║   ← loop back to marketing
  ╚═══════════════════════════╝
```

**Estimate without invoice = LOST SALE.** Track it, chase it, learn from it.

---

## Customer Experience Covenant

What every customer should feel at Nick's:

1. **Zero friction to start** — no phone call, no portal, no "preferred provider."
2. **Zero anxiety while waiting** — clear ETA, comfortable lobby, or they never waited at all.
3. **Zero surprise at checkout** — estimate was shown, they approved, invoice matches.
4. **A "wow" moment** — fast turnaround OR a free little thing OR knowing the tech by name.
5. **Easy return path** — text follow-up, review link, loyalty breadcrumb, remembered vehicle.

Violating any of these = write it up in the drift log. Five violations = operational review.

---

## Competitive Positioning

We're not competing with:
- **Dealership service** — they're slow, expensive, appointment-locked. We win on speed.
- **Discount Tire / Mavis** — they're big, corporate, impersonal. We win on care + flexibility.
- **Mobile / on-site** — they're expensive per job, limited capacity. We win on depth (alignment, brakes, full repair).

We're competing ON:
- Speed · convenience · drop-off culture · local relationship · fair price transparency.

---

## The Philosophy Layer (what shapes every build decision)

These are Nour's personal-operating principles woven into the business:

### POWER + CONTROL
Every dial that *can* be exposed, should be. Manual overrides on every automation. Never let the system say "you can't."

### INTERESTING DATA + CLEVER IDEAS
Boring = failure. Every dashboard should offer at least one non-obvious cross-domain insight the operator wouldn't have thought of unprompted.

### DEVASTATING LEAD
Every session reinforces, weaves, tightens. Mini-interactions compound. Daily victories build an unassailable local moat.

### NEVER ASSUME
Verify via code, logs, DB, git history before claiming anything true. "Looks like" is not "is." When in doubt, check twice.

### ALIVE + DYNAMIC
No static placeholders. No "coming soon." No dead buttons. Every surface pulses, updates, breathes. Subtle motion everywhere (150–250ms) to signal life.

### FORTUNE-500 MINIMUM
"Good enough" is not acceptable. Every release asks: would this pass a Fortune 500 CEO review?

### NO AGENTS FOR DETAIL WORK
Claude (not sub-agents) does the enriching. Sub-agents lose context + produce shallower output. Inline depth > delegated breadth.

### TASMANIAN DEVIL MODE
Controlled chaos channeled into devastating output. Pack 10 sessions into 1. When the engine is hot, don't let it cool. Deploy in big batches. Checkpoint often.

---

## Known Growth Edges

Documented so the system can compensate:

1. **Build-Drift-Reset Cycle** — Nour builds elaborate systems, runs them, boredom hits, seeks novelty. Counter: automation keeps running even during drift. Feature flags let him toggle without breaking. **System survives operator's ADHD.**

2. **Crisis execution strong, routine execution weak** — follow-up decay is real. Counter: autonomous cron coverage for the "every-day" tasks (reviews, SMS follow-ups, stale-lead pings).

3. **High novelty-seeking, low repetition tolerance** — build for variable-reward discovery moments (new insights, new correlations, counter-intuitive takeaways) so the system stays interesting over months.

---

## Business Tools Inventory (as of 2026-04-22)

### In play (actively used)
- **Auto Labor Guide / ShopDriver Elite** — CRM, estimates, invoices, customers, jobs. Source of truth for shop-side data.
- **Gateway** — payment processing, invoice reconciliation.
- **Google Business Profile** — discovery surface, reviews, posts, photos.
- **Stripe** — online payment, Snap Financing bridge.
- **Twilio** — SMS (estimates, reminders, review requests, blast campaigns).
- **Gmail** — vendor + customer email, also knowledge-ingest source.
- **Google Calendar** — limited use (fleet blocks only).
- **Instagram** — content + social proof (posts generated via Nick content tools).
- **Venice** — AI chat + content generation (Nour's primary provider, unrestricted).

### In staging / ready to activate
- **Snap Financing** — BNPL for higher-ticket sales (tires + alignment + brakes combos).
- **Resend** — transactional email (receipts, review requests).
- **Browserbase + Stagehand** — browser-use agent for Nick (pulls ShopDriver data, logs into portals, fills forms). *Blocked on Nour adding `BROWSERBASE_API_KEY` to Vercel env.*

### Retired / removed (still referenced in archives)
- Ollama (local LLM) — retired Apr 2026, Venice wins on quality + cost + features.
- DailyScore / MasteryHabit / OpenLoop — retired concept layer (Apr 17–19), replaced by Task with `loopKind=DAILY`.

---

## How to Update This Doc

**Every session that changes business logic, models, metrics, or philosophy MUST update the relevant section here.** This is versioned with the code so any agent reading the repo sees the current truth without needing access to `.claude/projects/memory/`.

**Mirror references:**
- `.claude/projects/memory/business_vision.md` — personal profile + full DNA
- `.claude/projects/memory/business_model.md` — quick-reference model rules
- `.claude/projects/memory/feedback_business_dna.md` — permanent-priority working principles

If this doc and the memory files disagree, **this doc is current** (because it's versioned). Update memory to match.

---

*Last edited: 2026-04-22 — mega-wave v11.1 kickoff. Reinforced by Nour verbatim this session.*

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
