# Shop OS 01: design (DRAFT v3 for Nour's approval)

Job 2026-10-26-shop-os. v3 replaces `../2026-10-26-SHOP-OS-DESIGN-DRAFT.md` (v1/v2). Nothing is built. Evidence for each
claim is in 02-RESEARCH (research), 04-DATA-MAP (production and code facts) and 07-COMPLIANCE (Ohio rules).

## 1. What Nour asked for (2026-10-26, condensed, his words)

"build my own crm for the shop, one specially built for us and how we run, transfering all data" / "even easier to use
[than] the alg" / "a built in ai that helps whoevers operating it with anything they might miss, pointers with the job
or notes about the customer ... quirky and most of all helpful" / "make more money" / "built in all our venders like
autozone, oriellys, parts authority ... best prices plus fastest delivery ... time, traffic" / "do it all from on the
invoice or estimate screens" / "steal bits and pieces of all the best systems". Then: "do more searching and organizing
and planing" before deciding.

Ruling: this overrides the 2026-10-17 note "do not build a ShopDriver replacement" and the 2026-09-23 master doc's
"keep ShopDriver" recommendation (`docs/research/2026-09-23-estate-master-architecture.md:489-492`).

Ruling (Nour, 2026-10-26: "i dont want it in the admin i want it nickstire.org/system"): the shop system lives at
nickstire.org/system with its own screens and its own home-screen app for the crew. /admin stays Nour's owner console.
Same login, same database, same role checks (09-ACCESS-AND-SECURITY). UI plan and mockup: 10-UI-BUILD.

## 2. Starting point (FACT, read 2026-10-26)

- The shop closes a few mid-to-large tickets a day (04-DATA-MAP section 1; exact figures kept out of this public repo).
- Real assets in nickstire: customer records in the low thousands; mirrored ALG invoices (headers only); ALG estimates; the
  estimate-to-invoice matcher; declined-work texts; the Ask assistant (12 read tools, propose-only); a customer
  inspection page that already lets customers approve or decline items (`/inspection/:token`); pay-invoice page and
  customer portal; online tire orders with D&K ordering (`gatewayClient.ts`, `gatewaySupplierOrder.ts`).
- Server code with NO screen and NO data: work orders (`workOrderService.ts`: lifecycle, blockers, part ETA),
  dispatch (`dispatch.ts`: bay claim, tech assign, clock in/out), technicians, bays, inventory, tire registration,
  warranties. In production these tables are empty (1 cancelled work order, 0 items, 0 techs, 0 bays, 0 inventory).
  We reuse the code where it fits and reshape the tables freely: there is no data in them to protect.
  Two defaults must change before reuse: a work order is created `status: "approved"` (`workOrderService.ts:141,179`)
  and each line defaults to `approved = true` (`drizzle/schema.ts:2321`). /system needs draft/pending defaults and an
  approval receipt per line (who approved, when, how: in person, phone or link, and the exact total shown); the Ohio
  rules in 07-COMPLIANCE depend on it. Creating a work order also pushes it to a Google Sheet when
  `GOOGLE_SHEETS_CRM_ID` is set (`workOrderService.ts:171`); that sync is off for /system (section 9).
- The ALG mirror throws away line items, parts/labor/tax split, techs, VINs, mileage, notes, canned jobs and
  inventory. Getting them needs per-ticket calls that kick the counter's ALG login, so that work runs after hours
  with Nour's go (code comment `shopDriverMirror.ts:579-581`).

## 3. Options

| | A. Build it in nickstire (approved 2026-10-26, under re-evaluation) | B. Buy Shopmonkey, put our AI on top | C. Keep ALG, improve around it |
|---|---|---|---|
| What | Our own RO screen, parts and tire ordering, copilot, on our database | Shopmonkey Basic as the counter system; its API feeds nickstire | Keep ShopDriver ($100/month + $17.50 per user per master doc); fix the mirror, add decline capture |
| Cost | build time + PartsTech/MOTOR fees (UNKNOWN until quoted) | $239/month Basic (CLAIM, master doc :481) + build of the bridge | lowest |
| Counter speed | ours to make as fast as we want (keyboard-first, quick quote) | good, but their screens | unchanged |
| Data we own | everything, line by line | through their API (per-line decline status exists) | headers only unless the nightly line pull runs |
| AI on the estimate screen | native panel | side panel outside their screen | none at the counter |
| Risk | biggest build; must beat ALG at the counter | vendor lock-in, monthly fee, their roadmap | stays "basic", which is what Nour wants to leave |
| Kill switch | if after 3 weeks of parallel run our screen is slower than ALG for a tire sale or a repair ticket, stop and take B | if their API cannot give per-line approvals and parts | n/a |

Status: Nour approved A on 2026-10-26. Both outside reviews (11-REVIEW) and roadmap v3 (05-ROADMAP) now default to
buying the core ledger and building our layer on top (A-hybrid); the call is made on days 13-14 with the bake-off
results, and nothing is built before it. If the call is A, it is built in phases that each pay off alone, with ALG
kept running until our screen wins the timed counter tests.

What the alternatives cost per month (CLAIM, vendors' pricing pages via research R16, thread 69890fcb; annual billing):
ShopDriver Elite $100 (2 users, +$17.50 each; no parts-supplier ordering per its own FAQ); Tekmetric Grow $309 + Tire
Suite $39; Shopmonkey Basic $215 (3 users); Shop-Ware Pro $350; AutoLeap Pro $309. Three years of a mid-tier system
runs about $11,000-16,000 before payments and add-ons; that is the budget line approach A has to beat in value.

## 4. The counter screen (one Repair Order record: quote -> estimate -> work order -> invoice)

Stolen mechanisms: Mitchell keyboard map, Tekmetric Quick Quote and Smart Jobs, Shop-Ware approval link, Shopmonkey
command search, retail POS cart.
- One search box (also Ctrl+K): phone, last name, plate, VIN or RO number -> customer-and-vehicle rows -> Enter opens
  or starts the ticket. Multiple vehicles are never auto-picked.
- Keys (Mitchell's idea, browser-safe letters because Chrome owns F3, F7, F10 and F11): Alt+Q quick tire quote,
  Alt+F find customer, Alt+H history, Alt+E quick estimate, Alt+N new RO, Alt+I invoice, Alt+J canned jobs; Esc closes
  a picker without losing the draft. Every action also has a visible button, so phones work the same.
- Quick tire quote: size or vehicle in, installed price out (tire, mount and balance, TPMS kit if needed, fees, tax)
  from D&K and the other tire sources, with stock and arrival, before any customer record exists. One tap turns it
  into an RO.
- Jobs are cards (front brakes, 4 tires) that keep their identity from estimate to invoice; canned jobs fill parts and
  labor for this vehicle; labor shows MOTOR guide time, our past billed time and actual tech time side by side.
- Money bar always visible: approved / proposed / deferred, tax, fees, margin vs target, balance.
- Safe by design: Saved / Not synced indicator; drafts survive refresh and interruptions; a double click never makes a
  second line; closeout errors point at the exact field.
- Ohio rules are built in (07-COMPLIANCE): estimate choice, frozen original estimate, the 10% block, tech name per
  labor line, part condition, replaced-part disposition, tire TIN and used-tire safety checklist.

## 5. The board, the techs, the customer

- Job board in ARRIVAL ORDER (first come, first served stays intact); each car shows separate blockers: waiting
  approval, waiting part (with ETA), needs bay, waiting pickup. Moving a car up needs a reason.
- Tech phone view: assigned cars, clock on/off per job, photos and measurements tied to a finding, voice note to text.
  Three clocks kept apart: on shift, on this job, hours billed.
- Customer link (extends the existing `/inspection/:token`): photos per finding, job prices, approve or decline per
  job, questions; each approval stored against a frozen estimate version. Opening the link is not approval.

## 6. Parts and tires drawer (price + speed + traffic)

- Sources: PartsTech punchout first (covers AutoZone, O'Reilly, Parts Authority/IMC, Federated, Car Parts Warehouse),
  O'Reilly direct if it adds invoicing, Nexpart as backup; tires from D&K (live), PartsTech/Tireweb/TireConnect for
  ATD, Capital, TireHub and others, Wheel Pros direct for wheels (03-VENDORS).
- Ranking: only offers that fit and arrive before the car needs the part, then lowest total =
  price + fees + core cost + getting-it cost (store delivery, or our driver's round trip in live traffic from the
  Google Routes API, only if a driver is free) + waiting cost (minutes late x what that bay would earn RIGHT NOW,
  near zero when no other car is waiting).
- One reason line per pick: "Car Parts Warehouse Euclid pickup: $42, 3 in stock, back in 14 min. Saves $9 over
  AutoZone delivery." Missing stock is UNKNOWN, not zero; "dispatch" is not "arrives".
- Learns each store's real lateness from promised vs actual arrival. A person taps to order; never automatic.

## 7. The copilot ("pointers" panel, extends the Ask assistant)

- At most 3 pointers visible; "No pointers" is a valid state. Order: 1) something wrong on this ticket (wrong vehicle,
  missing input, duplicate line, price under cost); 2) a tech-confirmed finding not yet on the estimate; 3) the
  customer's complaint not yet covered; 4) maintenance due by MOTOR schedule (missing history says "verify", not
  "overdue"); 5) deferred work from past visits; 6) optional extras. Never ranked by dollars.
- Each pointer: one line, why it applies to THIS car, the source and its date, one action (review / draft job /
  ask customer). Dismiss in one tap with an optional reason that changes what happens next.
- Rules decide what is due; the AI only words it and drafts. It never invents a labor time, torque, interval or price,
  never sends to a customer, never orders, never edits the estimate without a tap.
- Customer notes card on every ticket: last visits, declines and why, how they like to be reached, comebacks,
  budget notes; recalls shown as "possible recall for this model, check VIN".
- Personality: short and a little dry; never pushy. Proof of value: 50/50 holdout by customer, measured on collected
  dollars, not clicks.

## 8. Money, phone, books

- Card payments stay on Maverick for now; ask Maverick if our terminal can take an amount pushed from the invoice.
  Until then: record the terminal approval number on the invoice and reconcile daily.
- Payment programs: start one with a real API (Koalafi or Snap) from the invoice total; the rest keep their links.
- Phone screen pop: forward the shop line through Twilio (already used for the receptionist) so a ringing call opens
  the customer card; test caller-ID pass-through before any port.
- QuickBooks (only if the shop uses QBO): send finalized invoices and payments; parts purchases as bills.
- Outages: phone hotspot, numbered paper intake forms, entered once when back. No fake "offline mode".

## 9. Never cut
Customer data stays in our database (no copy to Google Sheets or any outside store from /system; the work-order sheet
sync is off for it); no customer text, supplier order or payment without a person's tap; ALG keeps
running until cutover; no copying of ALG's or MOTOR's licensed content beyond what the license allows.
