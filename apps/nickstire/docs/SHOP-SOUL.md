# SHOP SOUL: how Nick's Tire & Auto works and why

**Read this before any shop-facing work**: customer copy, an AI prompt, a text message, a report on shop
data, or a feature about how the shop runs. It is the one place that says how we operate. It replaces
`docs/BUSINESS-LANDSCAPE.md` and its statenour copy (April 2026), which now carry a superseded banner.

Rules for this file:

1. **Numbers are linked, never copied.** Prices, hours, review counts, coupon codes and warranty terms
   live in code: `shared/business.ts`, `shared/pricing.ts`, `shared/financing.ts`,
   `server/services/businessFacts.ts`. Import them; do not retype them here or anywhere else.
2. **Every fact carries a source**: `(Nour, date)` for his own words, a file path, or a note title.
   A fact with no source goes to "Open questions", not into the body.
3. **Newest word from Nour wins.** When he corrects a fact, change it here in the same PR and move the
   old version to "Old facts that are wrong now", so nobody brings it back from an older summary.
4. **Shop facts only.** The repo is public. Nothing about Nour's health, family, religion, money or
   contacts, and no customer or crew personal details, ever goes in this file.

All paths below are relative to `apps/nickstire/` unless they start with `apps/` or `.agents/`.

**The shop in Nour's own words** (2026-04-22, kept in `apps/statenour/docs/BUSINESS-LANDSCAPE.md`):

> "We can focus more on driving a line of cars to the shop every day, appointmentless tire repairs and
> happy people waiting for there car and happy people happily driving down to drop off there car and
> call a uber out of there. Thats how I built the place."

That sentence holds four goals, and every shop feature should serve at least one:
**a line of cars every day**, **no appointments needed**, **a happy wait (or no wait)**, and
**drop it off and get your day back**.

---

## 1. Who we are and who we come for

- **Nick's Tire & Auto**: an independent tire and auto repair shop on Euclid Ave in Cleveland (Euclid
  neighborhood). Name, address, phone, hours, service areas: `shared/business.ts` (`BUSINESS`).
- **Owner: Nour.** The crew calls him Nick. (`.agents/core/USER.md`)
- **Same shop, new name.** It was Moe's Euclid Tire & Auto. Same owner, never sold. It was renamed because
  other "Moe's" shops in the Cleveland area caused confusion. "Moe" is not a person, so never write that
  Moe runs or ran the shop, and never write "new ownership".
  (`docs/ENTITY-CONTINUITY-FILE.md`, which also cites the context file built from Nour's ChatGPT history,
  2026-04-04; `client/src/__tests__/canonical-business-truth.test.ts` enforces it)
- **Legal name on the printed invoice**: the `legal.entity` fact in `server/services/businessFacts.ts`.
- **Who walks in**: working Cleveland drivers who need the car running today. Practical, often burned
  before by a dealer or a chain, and they want a straight answer: "how long's it gonna take", "how much
  we looking at". Many cannot always afford new tires, and a good used tire that gets them safely to
  Monday matters. (statenour `apps/statenour/lib/ai/knowledge/brand-constants.ts` `CUSTOMER_PROFILE`, from
  the March 2026 brand study; `docs/BUSINESS-LANDSCAPE.md` section 2, Nour, 2026-04)
- **Bilingual**, English and Arabic. (`shared/business.ts` `languages`)
- **Cleveland problems we see every week**: pothole damage (alignment, struts, bent rims), the first-snow
  tire rush, tire-pressure lights in the cold, salt-eaten brake parts, check-engine lights and Ohio
  E-Check failures. (`brand-constants.ts` `CUSTOMER_PROFILE`)
- **Why people pick us over the others**: dealers are slow, expensive and appointment-locked, so we win on
  speed. Big chains are impersonal, so we win on care and flexibility. Mobile mechanics cannot do the
  heavy work, so we win on depth (alignment, brakes, full repair). We compete on speed, convenience,
  drop-offs, knowing our customers, and showing the price before the work.
  (`apps/statenour/docs/BUSINESS-LANDSCAPE.md` "Competitive Positioning", 2026-04-22)
- **What the shop is for, in Nour's words**: the main engine that everything else is built on. Reviews,
  repeat customers and trust are the signs that it is working. (Nour's notes vault, "Business - Shop Canon")

## 2. How a car moves through the shop

**Walk-in first.** First come, first served, 7 days a week, no appointment needed, drop-offs preferred.
Bookings are rare: 13 bookings against 280 invoices in the 90 days to 2026-10-22.
(`shared/business.ts` `model`; Nour, 2026-10-15 and 2026-10-21; agent memory `shop-data-meanings`)

1. **The car arrives.** The customer walks in, drives up, or calls first.
2. **Quick free check.** We look before we talk price. (`shared/business.ts` `model.freeInspections`)
3. **Written estimate before any work.** Beyond the fixed prices, we never quote a number blind: free
   check, written quote, you don't pay until you say yes. (`businessFacts.ts` `repair.pricing_policy`)
4. **The customer says yes or no.**
   - **Yes**: we do the work, and the counter closes it as an **invoice** in ShopDriver. An invoice is a
     closed job, a sale.
   - **No**: the estimate stays with no invoice. That customer most likely walked (declined the work).
     The counter can also record the "no" directly in /admin (Counter decline).
5. **Payment** is taken at the register, which is separate from the invoice records (see section 3).
6. **Follow-up** keys off the invoice: thank-you, review ask, the next service reminder. Never off a booking.

**Tires, the fast lane.** For a tire job the customer can stay in the car: the manager comes to the window,
the tire techs do the work outside in any weather, and the customer drives off in about 20 minutes.
(Nour, 2026-04-22, the "Pit Stop" tire experience in `docs/BUSINESS-LANDSCAPE.md` pillar 3 and
`brand-constants.ts` `SHOP_MODEL`; turnaround in `shared/business.ts` `usedTires.turnaround`)

**Longer repairs, drop it off.** For work longer than a short wait we steer people to drop the car off
so they get their day back, and we call when it is done. (`docs/BUSINESS-LANDSCAPE.md` pillar 4)

**When someone does wait**, treat them like a guest: water, coffee, a phone charger, and an honest time
that gets updated. (`docs/BUSINESS-LANDSCAPE.md` pillar 3)

**What every customer should feel** (`apps/statenour/docs/BUSINESS-LANDSCAPE.md` "Customer Experience
Covenant", 2026-04-22):

1. Nothing in the way of getting started: no portal, no hoops.
2. No worry while waiting: a clear time, or they never had to wait.
3. No surprise at checkout: the estimate was shown, they said yes, the invoice matches.
4. One good surprise: a fast turnaround, a small free extra, or knowing the tech by name.
5. An easy way back: a follow-up text, a review link, a shop that remembers their car.

**Phone calls.** The AI receptionist answers like a person at the counter. It sells coming down: walk in,
first come first served. It never invents scarcity. A caller who says "I'm coming now" (or needs a tow)
gets no booking row; the on-duty manager gets an internal text instead. A caller who asks for the manager
is transferred without being asked for a name or number. (Nour, 2026-10-21, PR #3212;
`server/routers/voiceAgent.ts`, `server/services/eventBus.ts` `manager-on-duty-sms`)

## 3. What the shop records mean

These meanings are not obvious from the database. A fresh session that skipped them reported
"0 declines ever" on 2026-10-22, which was wrong. Paste this section into every brief that reads shop data.
A short version is always loaded for Claude and Gemini sessions in `.agents/core/USER.md` (PR #3226).

| Record | What it means | Source |
|---|---|---|
| ShopDriver counter **invoice** | A closed job, a sale. Revenue and "work done" come from invoices. | Nour, 2026-10-15 and 2026-10-21 |
| **Payment status** on a counter invoice ("pending", "unpaid") | **Means nothing.** Payment is taken on a separate register. Never build an alert, card, reminder or text on it. | Nour, 2026-10-15; unpaid alerts removed in PR #3215 |
| Online tire order (made in the app, `gatewayTire.placeOrder`) | Starts as an invoice with payment "pending", and **here the payment status is real**. Card checkout exists so a tire order is paid in full before it is processed. | Nour, 2026-10-15; `server/routers/gatewayTire.ts` |
| **Estimate with no matching invoice** | Most likely the customer walked, declined the work. It is an **inference**: the matcher misses a different phone number, cash, or an invoice that never mirrored. | `shared/declineProvenance.ts` |
| **Counter-recorded decline** | An observation: the counter typed the "no" in. As of 2026-10-22 the counter has recorded 0. | table `declined_work_captures`; `client/src/pages/admin/money/CounterDecline.tsx` |
| **Booking** | Rare. Holds a place in line, not a time slot. Anything keyed to bookings misses almost every customer. | Nour, 2026-10-21; agent memory `shop-data-meanings`; `shared/business.ts` `model` |
| **Website lead** | A web form or chat, not a counter estimate. Do not count leads as estimates. | `docs/BUSINESS-LANDSCAPE.md` section 3 |

How to say it right:

- "0 declines recorded at the counter" is true today; "0 declines" is false. Say which one you mean.
- Report the inferred number and the observed number separately, never added together.
- A failed read is UNKNOWN, never a zero (repo skill `empty-vs-error`).

**Dates.** The shop runs on Cleveland time (`BUSINESS.timezone`). Timed ShopDriver tickets store UTC
digits, bulk-imported date-only tickets sit at a noon default, and imports carry the import day. Bucket
days in SQL in the shop's time zone, not in JavaScript. (agent memory `shopdriver-timestamps-are-utc`,
2026-10-15; `AGENTS.md` section 5 "Time")

## 4. What we sell, and what we never do

**Tires.** Used tires are the hook: high volume, low price, fast, and they get a car safely back on the road.
New tires: any brand, ordered in, with vehicle fitment lookup on the site. Also flat repair and plugs,
mounting, rotation, seasonal tire storage, wheel and tire packages.
(`shared/business.ts` `usedTires`, `newTires`, `prices`, `seasonalStorage`, `wheelPackages`; Nour's notes
vault, "website to do" for flats and plugs)

**Repair.** Brakes, oil changes, suspension, alignment, engine work, diagnostics, emissions and E-Check,
exhaust, battery, cooling, belts, transmission, AC. (`docs/BUSINESS-LANDSCAPE.md` section 2)

**Things we never do:**

- **No price match**, anywhere on nickstire.org. (Nour, 2026-10-18)
- **No installer networks** (SimpleTire, Tire Rack installer and the like), even when they pay per tire.
  (Nour, 2026-10-18; settled, do not re-propose)
- No unsafe tires: the shop declines them. (`shared/business.ts` `newTires` comment)
- The promises in section 6 ("we won't...") are part of the product, not slogans.

## 5. Prices, payment and warranty

- **Prices**: `shared/business.ts` and `shared/pricing.ts` are the only sources. Pages, prompts, texts and
  the receptionist read them from there.
- **Used tires have two prices on purpose.** The website shows the low starting price with its fine print
  and the typical band; the phone, text, voice and chat channels quote the typical installed price
  (`USED_TIRE_QUOTE`). Do not "fix" either one to match the other. (`AGENTS.md` section 5)
- **The new-tire number is a floor for all sizes**, never the price of one size. (Nour, 2026-10-01,
  PR #2868; agent memory `ai-referrals-2026-10-21`)
- **Diagnostics**: one fee, waived if the customer does the repair with us; the basic code scan stays free.
  (Nour, 2026-10-01; `shared/pricing.ts` `DIAGNOSTIC_PRICE`)
- **Payment Programs**: say "Payment Programs", never "financing", in customer copy. The providers are
  listed in `shared/business.ts` `financing.providers`; Kafene is first ("focus on Kafene, it's the
  best one", Nour, 2026-10-18). Each provider decides approval and amount: never promise approval, a
  payment amount or "no credit check". Describe each product as what it is (lease-to-own is not a loan).
  (`shared/financing.ts` header; `shared/business.ts` `financing`; `AGENTS.md` section 5)
- **Warranty comes from the printed invoice** (Nour, 2026-07-21): shop-installed parts and shop labor each
  have their own limited warranty, used tires have a separate short one, new tires carry the maker's
  warranty, and there is no road-hazard or mileage warranty unless it is written on the invoice. Exact
  wording: `server/services/businessFacts.ts`. Never quote the repair warranty on a used tire.
- **Refunds and storage**: no cash refunds; cars left after the job is done can be charged storage.
  Exact terms: `refund.policy` and `storage.policy` in `businessFacts.ts`.

## 6. How we talk to customers

**Voice.** Direct, calm, confident, professional, knowledgeable. No hype, no gimmicks, no slang, no emojis.
Sound like a confident mechanic explaining a repair, not a marketer. Urgency comes from real consequences
(a cheap fix now versus a bigger one later), never from fake scarcity.
(`.agents/core/USER.md`; `brand-constants.ts` `BRAND_VOICE`)

- Web pages: `docs/brand/VOICE.md`, with the word rules in `shared/voice.ts` (the brand-voice linter
  enforces them in `pnpm run verify`).
- Generated media: `shared/brandBible.ts`, "generated media, verified reality, no fake evidence". Reels
  carry no AI label, but AI footage is never shown as a real customer, car or repair.
  (Nour, 2026-10-11, in `.agents/core/USER.md`)
- Review replies: `docs/review-response-templates.md`.

**Promises we keep** (live on the About page, `client/src/pages/About.tsx`):

- We won't replace brake pads that pass inspection.
- We won't quote a fix without showing you the broken part.
- We won't add a fee at pickup that wasn't on the written estimate.
- We won't sell you new tires when used tires would last another year.
- We tell you up front if we can't do it that day.

**Never say or do:**

- Invented scarcity or wait times ("only 2 spots left"), "guaranteed", invented warranties, made-up
  reviews, made-up numbers. (`AGENTS.md` section 5 "Content and claim safety")
- "Financing" (say Payment Programs), "no credit check", "approval guaranteed".
- Doctor's-office words: "your appointment is scheduled", "arrive 15 minutes early". Say "come when you're
  ready", "your spot is held", "drop it off". (`brand-constants.ts` `SMS_VOICE`)
- Puns and cheesy lines: "tire-d of waiting", "where the rubber meets the road". (`brand-constants.ts`)
- Anything about Moe, a sale of the shop, or new ownership (section 1).
- A customer's name, phone or car in anything public.

**Settled, do not re-ask** (Nour, in `.agents/core/USER.md` and agent memory):

- Weather texts stay on. The review-flywheel idea is rejected.
- The Instagram autopost lane stays live and unattended. (Nour, 2026-10-14)
- An agent never starts a customer text, call, post, review reply or ad spend on its own; each needs
  Nour's go. (root `AGENTS.md` "Protected operations")

## 7. People and roles

Roles only. No personal details about anyone on the crew.

- **Nour**: owner. Decides spending, customer-facing sends, production changes, credentials.
  (`.agents/core/USER.md`)
- **Mash and Manny**: run day-to-day operations. (`.agents/core/USER.md`)
- **Zach**: hybrid tech. (`.agents/core/USER.md`)
- **The on-duty manager** (whoever the receptionist's live transfer number points at) gets its "coming in"
  texts and its transferred calls. (`server/services/eventBus.ts`)
- **Closing the sale is the manager's job**; the tire crew is coached to sell tires well. Mechanics knock
  out cars as they come in and help with tires when it is slow. (Nour's notes vault, 2025 goals and notes)

**Crew standards** (Nour's notes vault, "Business - Shop Canon"):

- No bad attitude, no clock-milking, smile, be hospitable, answer fast.
- Clean work, quick work, honest work. Speed matters, never at the cost of doing it right.
- Hospitality is part of the product. Follow-up is a profit activity, not a side task.
- Clear lines between what the owner decides and what the manager decides.

**Recording**: staff sign a recording consent when they are hired, and signs are posted in the shop.
Office and bay audio may run. Do not re-raise the legal question. (Nour, 2026-10-21)

## 8. Suppliers and ordering

- **New tires come from D&K (Dunlap & Kyle, the Gateway Tire B2B site)**, which also answers the "what fits
  my car" lookup.
  The paid Wheel-Size service was dropped. (Nour, 2026-10-18; `server/routers/gatewayTire.ts`)
- Every supplier line carries the purchase-order note "online order" plus our order number. (Nour, 2026-10-18)
- **A supplier order is placed by a person in /admin after the customer has paid, never automatically.**
  (Nour, 2026-10-18; `AGENTS.md` section 5 "External side effects")
- **Payment Programs** run on each provider's own site (`shared/financing.ts`). Kafene: the /admin order
  card opens the Kafene portal; a deeper hookup waits for Kafene's API keys. Do not build a portal scraper.
  (Nour, 2026-10-18; agent memory `kafene-portal-client-decisions`)

## 9. Which system does which shop job

| Shop job | System | Where to look |
|---|---|---|
| Estimates and invoices at the counter | ShopDriver Elite (Auto Labor Guide), mirrored into our database | `server/services/shopDriverMirror.ts` |
| Recording a "no" at the counter | /admin Counter decline | `client/src/pages/admin/money/CounterDecline.tsx` |
| Answering the phone | AI receptionist (VAPI) | `server/services/vapi.ts`, `server/routers/voiceAgent.ts` |
| Texting customers | Texts go out from the shop's own number through a phone gateway, falling back to Twilio; consent and quiet hours apply | `docs/SHOP_SMS_GATEWAY_SETUP.md`, `PROTECTED-CORE.md` |
| Telling Nour and the manager | Telegram alerts (once per state, no unpaid-invoice alerts) and manager texts | `server/services/eventBus.ts`; PR #3215 |
| Online tire orders and card payment | Tire finder, order flow, checkout | `server/routers/gatewayTire.ts` |
| Prices, hours, warranty, policy facts | Code constants plus the business facts store | `shared/business.ts`, `shared/pricing.ts`, `server/services/businessFacts.ts` |
| Words we use and never use | Voice kernel and linter | `shared/voice.ts` |
| Website and admin | nickstire.org, admin at /admin | `client/src/` |
| Reviews and Maps | Google Business Profile | `docs/ENTITY-CONTINUITY-FILE.md` |
| What is live right now | Current-truth docs | `truth_os.md`, `docs/CURRENT-TRUTH.md` |
| Owner-level thinking | NOUR OS (bdnick.info): Nick's Admin owns shop operations, NOUR OS owns owner intelligence | root `NOUR-COMMAND.md` "System boundary" |

## 10. Old facts that are wrong now

These keep coming back from older docs and summaries. Do not reuse them.

| Old claim | What is true now | Source |
|---|---|---|
| "36-month warranty on most repairs" | One repair promise, from the invoice; richer terms were made up and are now pinned out by tests | `server/warrantyTruth.test.ts` header, `businessFacts.ts` |
| "12 months / 12,000 miles" warranty | Not on the invoice; no mileage warranty | `shared/business.ts` `warranty` comment |
| "$0 down financing", "no credit check" | Payment Programs; each provider decides; some check credit | `shared/business.ts` `financing` comment (2026-10-01) |
| "Keep every price off the website" (April 2026) | Some prices are public on purpose and read from code | `shared/business.ts` `newTires` comment, `shared/pricing.ts` |
| One used-tire price everywhere | Two prices on purpose, web and quoting channels | section 5 |
| "Marketing copy uses urgency and FOMO" (April 2026) | Urgency from real consequences only; no invented scarcity | Nour, 2026-10-21 (receptionist wording, PR #3212) |
| Unpaid-invoice reminders and alerts | Removed; counter payment status means nothing | Nour, 2026-10-15; PR #3215 |
| Follow-ups keyed to bookings | Key them to invoices | Nour, 2026-10-22 |
| "Moe runs the shop", "under new ownership" | Same owner, renamed | section 1 |
| The old address "530 E 185th St" | 17625 Euclid Ave | `docs/BUSINESS-LANDSCAPE.md` changelog, 2026-04-26 |
| A fixed review count in copy | The live Google count wins; the code number is only a floor | `shared/business.ts` `resolveReviewDisplay` |
| A named AI provider as "the" AI | Provider chains live in code | `apps/statenour/docs/CURRENT-TRUTH.md` |

## 11. Open questions for Nour

Only Nour can answer these. When he does, write the answer into the right section with `(Nour, date)`.

1. **Founding year.** The site says 2018; the BBB listing says 2022; some older copy said 2019. Which is it?
   (`docs/ENTITY-CONTINUITY-FILE.md`)
2. **The rename.** When did Moe's become Nick's? Is "Nick's Tire & Auto" a filed trade name (DBA), or was
   the company itself renamed? (`docs/ENTITY-CONTINUITY-FILE.md`)
3. **Bays and lifts.** The About page says "4 bays: two lifts, two flat drive-on bays, about 32 jobs a day
   max" in one place and "4 lifts" in another. Which is right?
4. **Free Uber for drop-offs.** The About page offers a free Uber within 5 miles. Is that a live offer?
5. **The tire fast lane.** Is the stay-in-your-car tire service (section 2) still how tires run every day?
6. **Who closes sales.** Does only the manager close repair estimates? Who is the default on-duty manager?
7. **Drop-off cutoff.** Two pages say "drop off before 10 AM for same-day". Is 10 AM the rule?
8. **The free inspection.** The About page says a free 27-point inspection on every visit, with photos of
   worn parts. Is that what the crew does on every car?
9. **Register payment types.** The April doc listed cash, Visa, SNAP and Afterpay. What does the register
   take today?
10. **Flat repair price.** Not in `shared/pricing.ts` yet. What should the site and the receptionist quote?
11. **ChatGPT history.** The opening-the-shop chats are not read yet (see "Where the facts came from").

## 12. How to add to this doc

- **Tell any session: "add to shop soul: ..."** That session adds the fact in the right section with
  `(Nour, date)`, opens a docs PR, and merges it.
- A number (price, hours, a count) goes into `shared/business.ts` or `shared/pricing.ts`, and this file
  links to it.
- A correction moves the old line into section 10 in the same PR.
- A personal fact, a customer detail or a crew member's private detail never goes here. If a note mixes
  shop and personal, keep only the shop half.
- Read-only for production and outside accounts while gathering facts; ask Nour for anything else.

## Where the facts came from (2026-10-22)

- **Repo**: the files cited above, plus `docs/BUSINESS-LANDSCAPE.md` (2026-04-26) and the statenour knowledge
  file `apps/statenour/lib/ai/knowledge/brand-constants.ts`, which itself draws on Nour's March 2026 brand
  study, project knowledge base and marketing strategy documents.
- **Nour's own words**: dated decisions from agent sessions, kept in agent memory and `.agents/core/USER.md`.
- **Nour's notes vault**: the "Business - Shop Canon" note and his imported 2025 goal notes, shop lines only.
- **ChatGPT**: read indirectly, through a context file built on 2026-04-04 from 463 ChatGPT conversations
  (shop lines only) and the vault's history analysis, which covers chats from 2025-07-22 to 2026-03-19. That window
  starts years after the shop opened, so the opening-era chats are still unread. On 2026-10-22 ChatGPT could
  not be opened from the agent's browser (one Chrome profile was signed out; the other blocks the extension
  on chatgpt.com). Next pass: Nour runs ChatGPT Settings > Data controls > Export data, and a session reads
  the export for shop facts only.

## Change log

| Date | Change | PR |
|---|---|---|
| 2026-10-22 | First version; replaces `docs/BUSINESS-LANDSCAPE.md` | this PR |
