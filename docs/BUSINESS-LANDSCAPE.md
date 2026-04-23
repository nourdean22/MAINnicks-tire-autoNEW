# Business Landscape — Nick's Tire & Auto

> **This document is the mirror.** When the business model, metrics hierarchy,
> philosophy, or customer experience covenant changes, update this file **in the
> same commit as the code change**. If a memory file (`~/.claude/projects/.../memory/*.md`)
> and this doc disagree, **this doc wins** — it's versioned with the code.

Last updated: 2026-04-22

---

## 1. The Four Operating Pillars

Every business-facing feature — admin, public site, SMS, AI prompt, email copy,
cron job, metric — must serve at least one of these. If a feature doesn't serve
any of them, it doesn't belong in the system.

### Pillar 1 — **LINE OF CARS**

> "Create a line of cars to the shop every single day."

- **Headline metric.** Always visible, always moving.
- Measured as: drive-ups + drop-offs + bookings received → cars actually in the
  bays that day.
- Goal: never empty. Momentum compounds. A line signals social proof to
  passing traffic.
- Where it shows: admin Overview top card, daily brief, morning push, public
  "shop status" widget (lower-key: "busy today / light today").

### Pillar 2 — **APPOINTMENTLESS / FCFS**

> "First come, first serve. Drop off early, done same day."

- No appointment dance. Walk-ins welcome 7 days a week, 8am–6pm Mon–Sat,
  9am–4pm Sun.
- Web "booking" language is actually "Schedule Your Drop-Off" or "Skip the
  Line" — it holds a place, not a slot.
- The website reduces friction, never imposes it. Every form field is a tax.
- SMS confirmations never sound like doctor appointments. They sound like
  "thanks, we got you — come when you're ready, your spot is held."

### Pillar 3 — **HAPPY WAIT (or no wait at all)**

> "Happy people waiting for their car — or no one waiting at all because
> they dropped off."

- **The Pit Stop Tire Experience** is the secret weapon: customer doesn't
  leave the car. Manager walks up to the window. 4–5 techs attack the tires
  outside, rain or shine. In and out in 20 minutes. Zero waiting-room
  paperwork.
- For longer repairs: drop-off + Uber-out is the default play. We never hold
  the customer hostage in our waiting room if we can help it.
- For the unavoidable wait: premium treatment — water, coffee, phone chargers,
  loaner book, honest time estimate updated live.

### Pillar 4 — **DROP-OFF + UBER-OUT (the killer flywheel)**

> "Happy people driving down to drop off their car and calling an Uber out of
> there."

- Customer arrives → we take the keys → customer one-taps an Uber from
  nickstire.org → we work at our own pace → we call when done → they Uber
  back (or we run a ride at no cost for regulars).
- This is the flywheel: it frees the customer's whole day, which buys their
  loyalty, which feeds referrals, which fills the line.
- **Devastating because no competitor does it.** Most shops make you wait. We
  give you your day back.
- Every customer touch (website, SMS, email, AI chat) should know whether
  this customer is a drop-off candidate and steer them that direction.

---

## 2. Revenue Engine

### Bread and Butter — Used Tires

- **50+ used tires per day.** ~$60 per tire. In-and-out in under 20 minutes.
- This is the **hook** — the "too-good-to-be-true" deal that gets the door
  open. Everything else upsells from here.
- Why it works: working-class Cleveland customer can't always afford new
  rubber. A $60 used tire that gets them safely to Monday is a hero product.

### Full-Service Auto Repair (the margin)

Brakes · oil changes · suspension · alignment · engine · diagnostics ·
emissions · exhaust · battery · cooling · belts · transmission · AC.

- Avg ticket: ~$150–250 (from ALG data).
- 36-month warranty on most repairs.
- $50 inspection fee for deep inspections — credits toward the repair if the
  customer accepts.

### Pricing Strategy

- **Keep specific prices OFF the public site** (creates curiosity → they
  call or walk in → conversion).
- **Exceptions that stay public**:
  - Used tires: $60 (the hook)
  - Financing: $0 down
  - Free inspection under 1 hour
  - Everything else: "competitive pricing" / "affordable."

### Free Inspections = Strategy, Not Charity

Under 1 hour = free. Goal: get the car on the lift, find the problem, present
the solution, offer financing. **Maximum opportunities to close.**

---

## 3. The Correct Funnel

```
Lead → Estimate → INVOICE (the win)
```

- **Invoice = sale WON** (money collected).
- **Estimate without invoice = LOST SALE** (customer walked, recovery
  opportunity).
- The critical conversion metric is **estimate → invoice**, NOT lead →
  booking. Bookings are an early signal, not a sale.

### Data gap as of 2026-04-22 — ALG estimates NOT YET synced

What "estimate" means in ALG: customer **walked in**, shop wrote a
physical quote, customer **did not** get the work done. That is a
declined sale.

What "estimate" counts in our current dashboards: **website leads** with
an AI-classified `recommendedService` field. **Not the same thing.**

The real ALG-conversion rate — `matched_invoices / total_alg_estimates`
— cannot be computed today because the ALG estimate endpoint (`/api/
Estimate/listEstimates`) is probed but never fetched. The declined-work
recovery flywheel documented in the "Revenue Decay Points" table below
is therefore **blocked on this sync**.

Sprint plan (~7 hr): `docs/operations/ALG-ESTIMATE-SYNC-PLAN.md`.
Ship trigger: endpoint shape confirmed + staging env exists.

UI disclosure (2026-04-22): the admin "AUTO LABOR GUIDE — SHOP FLOOR"
panel was renamed "INVOICES (WINS)". The "CONVERSION" pill is marked
"Funnel (rough)" with a tooltip explaining it's not a true ALG
conversion rate. A warning line appears when the ALG-estimate sync is
offline so nobody confuses a 0 with "no declined work this week."

### Revenue Decay Points (known loss triggers)

| Stage | Decay Trigger | Threshold |
|---|---|---|
| New lead | Not contacted | > 24 h |
| Contacted lead | No follow-up on quote | > 48 h |
| Callback request | Not returned | any delay |
| Estimate given | No invoice created | > 48 h (aggressive at 7d + 30d) |
| One-time customer | No retention outreach | > 90 days |

Every decay point gets its own automation: stale-lead-followup (nickstire cron),
win-back SMS (8 segments / 22 templates), retention sequences (45/90/180/365d
tiers).

---

## 4. Competitive Advantages (the devastating lead)

1. **4.9 stars, 1,700+ Google reviews** — highest in the area.
2. **7 days a week.** No Sundays-closed excuse.
3. **36-month warranty** on most repairs.
4. **No appointments needed** (FCFS).
5. **Bilingual** — English + Arabic.
6. **$0 down financing** — Acima · Snap · Koalafi · American First Finance ·
   AFTERPAY.
7. **Free inspection under 1 hour.**
8. **The Pit Stop tire experience** — customer never leaves the car.
9. **Drop-off + Uber-out workflow** — frees the customer's day.
10. **AI-powered ops** no independent competitor can match.

---

## 5. Customer Experience Covenant

Non-negotiable promises the system must keep for every customer:

1. **Under 60 seconds to book / drop off** from landing the site.
2. **Under 5 minutes to a human** if they call the shop during open hours.
3. **Real-time status** — they always know where their car is (status tracker,
   SMS updates per stage).
4. **No waiting-room torture** — drop-off is the default recommended path for
   anything over 30 minutes of work.
5. **No surprise prices** — estimate before work starts, period.
6. **Warranty-backed** — 36 months, honored without drama.
7. **Respect + speed** — no upsell trap, no guilt trip, no "come back
   tomorrow" when we can do it today.

---

## 6. The Philosophy Layer

### Operating Energy — Tasmanian Devil Mode

Controlled chaos, channeled into devastating output. Pack 10 sessions of work
into 1 marathon session. Momentum is everything — when the engine is hot,
don't let it cool. Every session reinforces, weaves, tightens, adds power and
stability. Little mini-interactions that compound into wins. Always give the
operator (Nour) the opportunity and tools for success. Build a devastating
lead and maintain it ruthlessly.

### Build-Drift-Reset — the ADHD design constraint

Nour builds elaborate systems, runs them days/weeks, then novelty hits. The
system is designed to **survive its operator's drift periods**:
- Automated crons keep running even when Nour isn't looking.
- Feature flags let Nour turn things on/off without breaking anything.
- Every critical flow has a self-healing layer (AI gateway breaker, DB auto-
  reconnect, health monitor).
- Memory compounds: everything learned is written so the next session picks
  up where the last left off.

### The Three Non-Negotiables

1. **Power + control** — every dial exposed, every automation overridable,
   every switch in the admin.
2. **Interesting data + clever ideas** — boring = failure. Inside AND outside
   the box.
3. **Dynamic + alive** — no static placeholders; everything breathes.

---

## 7. Shop Ops — Physical Reality

| | |
|---|---|
| Location | 17625 Euclid Ave, Cleveland, OH 44112 (Euclid neighborhood) |
| Phone | (216) 862-0005 |
| Hours | Mon–Sat 8am–6pm · Sun 9am–4pm |
| Founded | 2018 |
| Languages | English + Arabic |
| Bays | (document actual count in `shared/business.ts`) |
| Techs | 4–5 dedicated tire techs + full-service mechanics |
| Rating | 4.9★ · 1,700+ Google reviews |
| GBP managed by | `moeseuclid@gmail.com` |
| Revenue target | $20k+/month consistently |
| Payment | Cash · Visa · SNAP · AFTERPAY · Acima · Snap Finance · Koalafi · American First Finance |

Shop cameras: V380, GeoVision 16ch DVR, Ring, Eufy.

---

## 8. Tool Inventory (what powers this)

**Production stack:**
- **nickstire.org** — Railway · Express 4 · tRPC 11 · React 19 · Vite 7 ·
  Drizzle ORM · TiDB/MySQL
- **autonicks.com / statenour-os** — Vercel · Next.js · Neon Postgres
  (CEO brain, separate from shop systems)
- **Bridge** — cross-system sync via `BRIDGE_API_KEY`

**Integrations:**
- **Payments**: Stripe (live, 231 events)
- **Messaging**: Twilio SMS · Resend email · Facebook Messenger
- **Storage**: AWS S3
- **AI**: Venice (primary, full power + custom fetch) · OpenAI gpt-4o-mini
  (fallback) — task-adaptive 12 profiles
- **Shop CRM**: Auto Labor Guide / ShopDriver Elite (JWT session, fragile)
- **Tire ordering**: Gateway Tire (DK Tire B2B) — authenticated scraping
- **Attribution**: Google Ads (GCLID capture), Meta CAPI (Pixel + server),
  Google Sheets CRM sync
- **SEO**: Google Search Console (436 URLs indexed, 3 sitemaps) · Google
  Business Profile (4.9★)
- **Operational**: Web Push (VAPID), Telegram bot, Apollo, Fireflies

**Critical constraints:**
- ShopDriver / ALG session kicks out when a new login happens → probes that
  log in are **only safe to run while Nour is on the admin page**. See
  `T7.1` in the roadmap.
- Venice is single-provider for primary AI path; OpenAI is the only fallback.
- DB pool = 5 connections with unbounded queue → spike risk; see `T7.4`.

---

## 9. Success Profile

**What a great day looks like:**
- Line of cars stretching down the street.
- Admin Overview showing 15+ active tickets before noon.
- 3 customers dropped off with Uber, 2 Pit-Stop tire changes in under 20min.
- Zero unanswered leads > 24h.
- Zero estimates > 48h without follow-up.
- 1 new Google review (or admin confirmed AI drafted a reply).
- At least one "I didn't think of that" insight surfaced by the system.

**What failure looks like:**
- Admin Overview empty at 11am on a weekday.
- Lead from 2 days ago still uncontacted.
- Estimate from last week without an invoice or a follow-up SMS.
- Customer in the waiting room for > 45 minutes because no one told them
  about drop-off.
- A static "No data" empty state with no explanation.
- Any feature building up but not wired.

---

## 10. Changelog (selected)

| Date | Change |
|------|--------|
| 2026-04-22 | **v1.3 round-3 (2 more commits)**: First monster-file shard executed — `advanced.ts` (966 LOC) → `advanced/{jobs,invoices,kpi,portal}.ts`. Route registry validator — hard-fail CI if App.tsx routes drift from registry (found + fixed /guides, /womens-safety SEO misses). Internal linking engine (`shared/internalLinks.ts`) with service + blog + city link graph. Weather-aware admin banner (7 conditions, ops nudges). Live activity pulse (SSE toast stream). |
| 2026-04-22 | **v1.2 round-2 mega-wave (5 more commits)**: 555 console → createLogger sweep; custom `lint:source` enforcing no-console-in-server; Dependabot + Husky pre-commit + CI test-gating; SSR-evaluation doc; **No-Show Prediction** engine + admin section; **Compliance** admin panel (login audit + TCPA trail); **ShopFloorMobile** thumb-driven queue; admin light-mode toggle; export `DB` type + gradual typing; 50+ cast sites hardened through unknown; leads.source enum fixed (+sms, +careers); Monster-file + Schema-migration design docs for deferred sprints. |
| 2026-04-22 | **v1.1 mega-wave (7 commits)**: ShopDriver/ALG probes shop-protected; BUSINESS.timezone unhardcoded; shared db/phone/csvSafe helpers (+28 files cleaned); `docs/BUSINESS-LANDSCAPE.md` created (this doc); LineOfCars + ShopStatus widgets on public homepage; Uber/Lyft deep-link drop-off flywheel; main bundle 228 → 43KB gzip (5.3× smaller); Sentry opt-in via SENTRY_DSN; cron inventory + uptime monitoring docs; **Re-engagement Engine** — service memory + 12 categories + admin send UI; TCPA opt-in log + admin login audit trail. 0 tests broken. |
| 2026-04-22 | Landscape doc created (T1.2 of v1.1 roadmap). Four pillars + covenant + philosophy layer codified. |
| 2026-04-14 | Ollama fully removed. Venice + OpenAI the only providers. |
| 2026-04-14 | GSC URL-prefix fix. 436 URLs indexed. |
| 2026-04-13 | Win-back expanded 3 → 8 segments / 22 templates. |
| 2026-04-13 | ALG JWT keep-alive retrofit. |
| 2026-04-08 | Vercel Pro upgrade. VAPID push notifications wired. |
| 2026-04-02 | Deploy target corrected: nickstire.org = Railway, NOT Vercel. |
