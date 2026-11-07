# Shop OS 37: our own ledger (the plan that replaces ALG, 2026-11-07)

Status: PLAN ONLY. Nothing here is built or started; Nour said at 14:43Z "i didnt say build yet". The last section
lists what he decides to open the build. Labels: FACT (read this pass, source named), INFERRED, NOT CHECKED.

## 0. Answer first

We build our own ledger inside `apps/nickstire`: customers, vehicles, one ticket that is an estimate and then an
invoice, typed lines, authorizations, payment records, declined work and the printed forms. It copies ALG's data
shape (doc 30 s.2, `ticket/getTicket`) and beats it in five named ways (s.2). The order is: P0 ledger objects and
the migration read, P1 the counter runs on our ledger while ALG stays the record (shadow days), then a cutover
timestamp and a two-week settle, then P2 quote and texts, P3 vendors on the screens, P4 approval and tech phone.
Cutover comes after P1, not after P4, because the parallel run is the costly part and ALG has none of P2 to P4
either (reason in s.4). Labor hours default to ranges built from our own closed invoices, with a licensed guide as
the other option (s.6). Twelve calls are Nour's; each has a default (s.11).

Why (Nour, 2026-11-07 13:30Z, verbatim): "no i dont want to keep alg thats why i wanted to reverse enginner it and
base the new crm around it and make our version of alg but way way better".

What this supersedes: doc 32 s.1 (buy the ledger, build the brain) and s.3 (four phases on top of ALG); doc 32
decisions 0, 1, 1b and 4; doc 32 rule 1 becomes "our ledger is the writer; ALG is read for migration and shadow
days only"; doc 36 s.2 (replaced by s.9 here); doc 33 s.3 row "Printed estimate and invoice stay ALG's" (our
ledger prints them, s.7). Kept as written: doc 32's six screens as build units, its rules 2 to 9, its s.4 kill
reads for P2 to P4, its s.8 leave-outs; doc 36 s.1, s.1b and s.3; docs 38 and 39.

## 1. What exists today (the reuse base)

| Piece | State | Receipt |
|---|---|---|
| `work_orders`, `work_order_items`, `work_order_transitions` | BUILT, empty in production (1 cancelled test row, doc 04 s.1) | `drizzle/schema.ts:2226`, `:2296`, `:2341` (FACT, read this pass): lines typed `labor, part, tire, fee, sublet`, `laborHours`, `laborRate`, `laborSource`, a parts pipeline (`partStatus`, `partEta`, `supplierOrderRef`), decline and recovery fields, a status transition trail |
| `payments` | BUILT, empty (doc 04) | `schema.ts:2133`: cents, `invoiceId`, Stripe link and intent ids |
| `invoices`, `alg_estimates`, `customers` | LIVE, filled by the ALG mirror | `schema.ts:1294`, `:1446`, `:1038`; `invoices.source` is `shopdriver, manual, stripe`; `paymentStatus` defaults to `paid` |
| Shop vehicle record | MISSING | `vehicles` is declared at `schema.ts:2200` but was dropped by migration 0117 (doc 04); `customer_vehicles` (`schema.ts:313`) is keyed to web `users`, not shop customers (FACT) |
| Work-order service, dispatch, staff inspection, `/inspection/:token` | BUILT, mostly unwired | doc 31 item 3, doc 32 s.5 |
| ALG mirror | LIVE, headers only | `server/services/shopDriverMirror.ts` (1,806 lines); reads `listRecentTickets` and stops (doc 30 s.2) |
| ALG writers and logins in our code | LIVE code | `refundWriteback.ts` posts refunds to ALG (doc 34 row 6); `server/routers/autoLabor.ts` logs in to the ALG API and probes `Vehicle/listVehicles`, with a hard-coded `LABOR_CATEGORIES` fallback (lines 19-139, FACT) |
| Fact keys for printed terms | LIVE | `server/services/businessFacts.ts`: `new_tire.warranty`, `used_tire.warranty`, `alignment.warranty`, `refund.policy`, `storage.policy` (FACT); one seed differs from print (doc 33 s.4) |

Two traps found this pass. Money is decimal dollars on `work_orders` and integer cents on `invoices` and
`payments` (FACT): the ledger picks cents and converts once, at the old-table boundary. `invoices.invoiceNumber` is
unique and ALG's numbers are already in it: our invoice numbers must start above ALG's last number at cutover, or
history lookups collide (INFERRED from the unique index).

## 2. The ledger objects, ALG's counterpart, and what is better

| Our object | ALG counterpart (doc 30 s.2) | Built on | Better than ALG |
|---|---|---|---|
| Customer | `customer{}`: names, company, three phone fields, `isCommercial`, `isTaxExempt`, `creditLimit`, `balanceDue`, `ticketCount` | `customers` (live) | phone is a contact, not an identity: several customers can share one number, no phone-only merge (doc 32 rule 9); tax exemption needs a reason and a certificate date (doc 07 s.3) |
| Vehicle | `vehicle{}`: year, make, model, engine ids, VIN, `mileageIn`/`mileageOut`, tag, state | reinstate the declared `vehicles` table (schema drift closed) | engine and trim kept for the labor key (s.6); mileage per visit, not one field; Y/M/M stays editable with a history row (doc 21 s.8 item 8: ALG locks it) |
| Ticket (estimate, then invoice) | one `getTicket` object with `ticketType`, `workflowStep`, `estimateNumber` + `invoiceNumber` pair, `promisedDate`, `complaint`, totals and tax split | `work_orders` | one object end to end, as ALG does, plus physical `arrivedAt` and one blocker owner (doc 34 row 2); a posted invoice is immutable and a correction is a reversal, never an edit (Odoo pattern, s.10) |
| Line | `ticketItems[]` with an opaque numeric `type`, `unitPrice`, `partMarkup`, `rate`, `technicianId`, `vendorId`, `partCode`, `coreValue` | `work_order_items` | line kind is a named type, not an unknown enum (doc 30 s.10 item 7); cost and sell both stored; hours stored, not inferred from `subTotal / rate`; tech named per labor line (Ohio, doc 07 s.2); condition new/used/rebuilt/reman per part; a supplier offer snapshot with source and checked-at time on part lines (doc 32 rule 3) |
| Authorization | header fields only: `originalEstimateAmount`, `increaseAuthorizedBy`, `authorizedContact` | new, one row per event | an immutable event per approval or decline (scope = which lines, who, how: in person, phone, link; when; amount); the 10% gate measured against the first authorized estimate, never the latest (doc 07 s.1, doc 34 row 4); a frozen estimate version per event |
| Estimate version | none seen | new | each sent or approved estimate is a frozen copy; the approval page shows exactly what was approved |
| Declined line | none: no reason field; `declined_work_captures` holds 0 rows (doc 04) | `work_order_items.declined` + doc 26 `DeclineReason` | reason on every no, a persistent recommendation id from inspection to the follow-up and to the later invoice (doc 34 row 5); follow-ups keyed to invoices, not bookings (USER.md) |
| Payment record | `ticketPayments[]` (shape UNKNOWN, doc 30 s.10 item 2), 12 pay types | `payments` | records what the separate register took (method, reference, amount, who), deposits and credits owed; migrated ALG payment statuses import as UNKNOWN, never `paid`, because a counter invoice's payment status means nothing (USER.md) |
| History | `listTicketHistory` rows with staff, action, line kind, total | `work_order_transitions`, extended to line actions | same audit trail, plus a per-person login: ALG has 1 paid seat and 3 flat roles with no MFA (doc 21 s.5); ours gives each crew member a login with a role |
| Printed estimate and invoice | ALG print with `estimateDisclaimers` / `invoiceDisclaimers` (doc 33) | new print view | terms read from fact keys (doc 33 s.3), signer from `ShopIdentity` (doc 26), a printed copy and a texted copy of anything signed (doc 07 s.2) |
| Job kit, sell rule, quote, offer | package jobs, markup table, no quote object | doc 26 s.3 objects | as designed in doc 26 and amended by docs 30 and 35 |

The five things we do better, named (the "way way better" in Nour's words, each checkable):
1. Line truth: every line's kind, cost, sell, hours, tech and supplier is stored; the mirror lost all of it (doc 17).
2. Authorization events against frozen versions, with the Ohio 10% rule enforced, not a single header number.
3. Declined work as data: reason, recommendation id, follow-up tied to the invoice that later closes it.
4. Records that cannot be quietly changed: posted invoices immutable, reversals instead of edits, per-person logins.
5. Vendors and the board on the ticket: supplier offers pop up on the line (s.8) and the board shows every car;
   ALG has neither a scheduling nor a dispatch board on this tier (doc 21 s.8 item 7).

## 3. Phases (build time, not calendar; every estimate INFERRED from doc 32's phase sizes)

| Phase | Ships | Build time | Kill read (written in the phase's first PR) |
|---|---|---|---|
| P0 ledger and migration read | the objects in s.2 as one schema PR (`nickstire-tidb-ddl`, hand-applied); the importer from ALG into the ledger (s.5); doc 32 phase 0 items (approved-by-default flip, 10% gate, writer inventory, Sheet push off, UNKNOWN adapter return); one money unit (cents) | 4 to 5 working days | stop if, on the fixtures and the first nightly import, any imported closed ticket's line sum differs from its ALG header total without a named reason, or the importer ever runs during shop hours |
| P1 counter on our ledger, shadow days | counter search, ticket editor (estimate to invoice), print view, payment record, daily close, board, bay TV, money bar, behind `SHOP_OS_PHASE_1`; read-shadow then write-shadow (s.4) | about 2 weeks (larger than doc 32's 3 to 4 days because it now writes tickets) | stop if any money difference over the write-shadow closes is unexplained, the counter is slower than ALG after the learning days (doc 05 line 66), or the crew goes back to ALG only |
| Cutover and settle | the cutover timestamp (s.4); ALG read-only from then; two weeks of fixes only (doc 05 line 69) | 1 day to switch, 2 weeks to settle | roll back to ALG (s.4) on any money, approval or data-loss failure (doc 05 kill switch row 1) |
| P2 quote and the three texts | quick tire quote, `Quote`, `SellPriceRule`, `DeclineReason`, 3-day reminder; the three texts written once (s.7); quote text live on Nour's go | about a week | doc 32 s.4 phase 2 |
| P3 vendors on the screens | D&K and O'Reilly live, Capital and Federated by REA, ATD and PA as doc 30 (s.8); PO draft a person clicks | 1 to 2 weeks, depends on captures | doc 32 s.4 phase 3 |
| P4 approval and tech phone | `/approve/:token` on frozen versions, tech phone found-work lines with photos, pickup text live on Nour's go | about a week | doc 32 s.4 phase 4, plus the owner-away day (doc 34 row 16) |

The shop PC model lane (doc 38 s.2 item 4) opens after P1 lands, on MECHANICS, as its own lane; its first jobs
write drafts into P1's ticket and P2's quote objects. Doc 39 s.2 item 2: no phase opens a production write path
before the credential closure line exists. P0's importer writes into the production database, so it waits on that
line and on Nour's go for its first run.

## 4. Parallel run, cutover and rollback

The rule (doc 11 line 101, kept): "the old system stays authoritative until a cutover timestamp; before that,
shadow days replay real transactions; after it, one system writes."

1. Read-shadow (all of P1's build): every night after close the importer rebuilds the day's tickets in our ledger
   from ALG; the counter can open our screens read-only beside ALG. No double entry.
2. Write-shadow (end of P1): for at least 7 daily closes (doc 05 line 64), one person keys each new ticket in our
   ledger too. Each night the importer compares our ticket and the day total to ALG's, to the cent; every
   difference gets a reason on the reconciliation page. This is the only double entry, and it is bounded.
3. Cutover trigger, all true at once: (a) 7 closes in write-shadow with every difference explained; (b) printed
   estimate and invoice from our ledger checked against doc 33 with the `used_tire.warranty` seed fixed; (c) the
   accountant confirmed the tax rows (doc 07 line 5); (d) the open-obligation sheet (s.5 list items 6 to 9) signed
   by the counter lead (doc 04 row 49); (e) an outage drill passed with a printed paper ticket and its re-key path;
   (f) a ledger export opened outside the app; (g) the doc 39 closure line exists; (h) the doc 36 s.4 release
   receipt for P1; (i) Nour picks the timestamp.
4. At the timestamp: new work starts only in our ledger; tickets open in ALG are finished in ALG and imported
   after they close (doc 04 row 49, build branch); `refundWriteback.ts` is retired, a Stripe refund writes a
   reversal on OUR invoice; the mirror's daily read stops after the last ALG ticket closes; the ALG login in
   `autoLabor.ts` is removed with its probe.
5. Rollback: ALG stays paid and untouched for the settle plus 30 days. If a kill fires, the counter goes back to
   ALG and the tickets made in our ledger since the timestamp are re-keyed in ALG by hand from our print view (the
   cost: minutes per ticket, a few tickets a day per doc 04 s.1). After that window, ALG history lives in our
   archive tables and the export (s.5 item 10), kept at least 4 years (ORC 5739.11, doc 07 s.3).

Why cutover after P1 and not after P4: ALG has no quote object, approval link, tech phone or supplier offers, so
none of P2 to P4 is needed to stop using it; building them on one ledger avoids a second double-entry period, and
the settle rule (doc 05 line 69) keeps the shop from absorbing new screens in the same two weeks. Doubt: about 75%
sure this order is right; the 25% is that the crew wants the quote card before giving up ALG's job search.

## 5. Day-one migration list (doc 04 rows 44-50, doc 05 line 54)

| # | What moves | From (doc 30) | Rule |
|---|---|---|---|
| 1 | Customers | mirror `customers` plus `Customer/listCustomers` | all phone fields, commercial and tax-exempt flags; no merge on phone alone |
| 2 | Vehicles | the `vehicle{}` inside each imported ticket, and `Vehicle/listVehicles` (shape UNKNOWN, doc 04 row 47) | VIN and mileage per visit; one vehicle row per VIN or per customer + Y/M/M when VIN is blank |
| 3 | Closed tickets with lines | `ticket/getTicket` per ticket, nightly after close, rate-limited | line kind imported as UNKNOWN until the `type` enum is read (doc 30 s.10 item 7); hours imported only where `rate` is present, labelled INFERRED |
| 4 | Estimates with lines | same call, estimate tickets | an estimate with no matching invoice is "most likely walked", an inference, never a recorded no (USER.md) |
| 5 | Ticket history rows | `ticket/listTicketHistory` | kept as the audit trail of the archive |
| 6 | Open tickets | none move | finished in ALG, imported after close (s.4 step 4) |
| 7 | Deposits and credits owed | the estimate `Notes:` line today (doc 33 s.1) and the counter's list | typed into `Quote.deposit` / credit rows and signed on the obligation sheet |
| 8 | Receivables | `customer.balanceDue`, `accountsReceivableId` | opening balance per customer, signed on the sheet |
| 9 | Unfunded financing, ordered parts, promised callbacks | the counter's list and the callback queue | each an open row with an owner |
| 10 | Full archive | the importer's history pass plus an ALG export (doc 21 s.8 item 4: no self-serve export on this tier) | Nour asks Dowell for an export before ALG ends (s.11) |
| 11 | Package jobs | ALG settings `packageJobs` | rebuilt as `JobKit` by hand, top 15 first (doc 05 days 4-7) |
| 12 | Technicians | none | created by hand, 3 to 5 people (doc 04 row 53) |
| - | Labor guide content | not moved | Dowell's licensed data is not ours to copy (doc 04 row 54) |

The importer is one server job with three gates: it runs only between close and open (the per-ticket read logs
the counter out of ALG, `shopDriverMirror.ts:579` per doc 32), it is idempotent per ALG ticket id, and its first
production run is Nour's go (production write). It replaces doc 32 decisions 1 and 1b: there is no daytime probe.

## 6. Labor hours: Nour's decision, two options that differ in kind

ALG's hours come from a licensed guide (doc 30 s.2 "Labor lookup"); the license ends with ALG. The repo's
`autoLabor.ts` fallback is one hard-coded range per repair category with no year, model or engine (FACT).

| Option | What it is | Cost | Covers | Weak spot |
|---|---|---|---|---|
| A. License a labor guide | MOTOR data through PartsTech or direct, or Mitchell 1 / ALLDATA (doc 04 row 54, doc 03) | monthly fee, price CLAIM until a written quote (spend: Nour's go) | every job on every vehicle, by year, model, engine | a second vendor login and terms; hours are the book's, not the shop's |
| B. Build ranges from our own closed invoices | per job family and vehicle class, low / typical / high from labor lines the shop actually billed, imported (s.5 item 3) and then our own | $0 | the jobs the shop does often; a few tickets a day means rare jobs have no range | rare jobs show UNKNOWN and the counter enters hours by hand (`laborSource = manual`) |

Default: B, because the shop prices flat-rate by job family (doc 05 days 4-7, top 15 jobs), both printed forms show
a labor price with no hours (doc 33 s.4), and B costs nothing. Kill read for B (switch to A): in a month after
cutover, more than one ticket in five has a labor line with no own range, or the counter is seen looking hours up
in another tool. Never: copying ALG's hours, or building ranges from the ALG lookup (doc 04 row 54).

## 7. The three customer texts (P2 writes all three; each goes live with its screen)

The three: the quote text (live in P2), the approval text and the pickup text (live in P4). Nour approved them at
13:30Z with this condition, verbatim: "approved but use the proper skills amking sure the texts are great and my
style too". The writing rule:
1. Written with `antislop-copywriting` and `humanizer`, in the shop voice of `docs/SHOP-SOUL.md`.
2. Terms only from fact keys and only on allowed channels: no refund or storage terms by text; the lug torque line
   from a new `lug_torque.recheck` key on wheel or tire tickets only (doc 33 s.3).
3. Shown to Nour once, all three together, before the first live send; his edits are the text.
4. The daily cap, the opt-out and the preview path of the live SMS lane stay as they are (doc 32 rule 5).
5. No text is sent by a lane or a PC; the manager sends the first live one on Nour's go.

Printed forms: our print view renders the estimate and invoice from the ledger, with the doc 33 s.1 and s.2 text
read from fact keys (one `print` channel constant beside the `web` one), the signer block from `ShopIdentity`, and
labor lines priced without hours as today. It is an HTML print view the counter prints from Chrome; a PDF copy for
texting uses the installed `puppeteer` only if the print view is not enough (INFERRED; not checked what it serves).

## 8. Vendors on the screens (P3; Nour 13:30Z: "perfeclty functional and operational and really integrated")

| Vendor | Path | Ticket line (RO) | Sourcing drawer (Alt+S) | Quote card | Done when |
|---|---|---|---|---|---|
| D&K / Gateway | live JSON with the shop login, `gatewayClient.ts` (doc 30 s.3); approved 13:30Z | offer snapshot on the part line, cost from `selling_price`, never `cost_price` (doc 35 P0) | local, regional and national tiers, regional shown but not orderable until proven (doc 30 s.0 item 4) | tire cost and stock under the sell price from `SellPriceRule` | conformance fixtures pass (doc 30 s.11) and 3 real orders arrive as shown |
| O'Reilly | live JSON behind the shop login, bearer token (doc 30 s.8); approved 13:30Z | same, with `orderBy` and `inStoreBy` from `nextRoute` | per location: store, servicing DC, linked DC | parts quotes only | same, plus the store-to-shop leg measured before `arrival.at` is shown |
| Capital | `reverse-engineer-anything` on our account, static first: bundle and the `Download Price List` export (doc 30 s.5) | offer with `Available` / `Regional` as lower bounds | home warehouse orderable, others display only | tire cost and stock | an export or JSON path is found; if only rendered HTML exists, Nour decides (s.11) |
| Federated | same REA rule: the results grid transport first (doc 30 s.10 item 4) | offer with Alt Locations | stores and warehouses, no ETA | parts quotes only | same |
| ATD | as doc 30 s.4: rendered DOM only, cutoff body UNKNOWN | visible handoff | handoff button | handoff | an approved feed exists |
| Parts Authority | as doc 30 s.7 and doc 20: the documented punchout | punchout return on the line | punchout | parts quotes only | punchout round trip proven |

REA rule for Capital and Federated (Nour 13:30Z: "reverse enginner anything then"): our own accounts only, static
first (shipped bundles, documented exports), no evasion, no key extraction, no CAPTCHA or bot-check bypass; doc 32
rule 2 (no adapter scrapes a logged-in page) stands until Nour changes it. PRs 3568 and 3571 (parked drafts) are
judged on the fixtures here; the better one is adopted. A person always clicks the PO (doc 32 rule 1).

Nour's approval covers our side. The vendor's side is still open (doc 30 s.10 item 5): Gateway's API authorization
is unverified, and O'Reilly needs an approved API or punchout. P3's first PR records each vendor's answer before a
live order path ships; until then the line shows the offer and a visible handoff (doc 10).

## 9. Replacement for doc 36 s.2 (lanes per phase, server first)

| Phase | Lane | Place | Lands | Order |
|---|---|---|---|---|
| P0 | nickstire server | NATTYNOUR for the schema PR (hand-applied DDL), cloud for code | the s.2 objects, cents, numbering above ALG's last number, the importer against doc 30 fixtures, doc 32 phase 0 items, red-first tests | first |
| P0 | docs (lane-research) | cloud | writer inventory (doc 34 row 8), the doc 36 s.1b rows this plan adds | with server |
| P0 | manager | NATTYNOUR | the refund-writeback log read; the importer's first run on Nour's go; one ticket read for the `type` enum (doc 30 s.10 item 7) | after server |
| P1 | nickstire server | cloud | ticket editor endpoints, close and reversal, print data, payment record, daily close, reconciliation page data; bdnick read of board and money bar (leg below) | first |
| P1 | nickstire client | cloud, after the server contract is on the branch | Today and Visit routes (doc 34 row 1): search, editor, print view, board, TV, money bar; `SHOP_OS_PHASE_1` | second |
| P1 | verification | MECHANICS, the crew, flag on | read-shadow, then the 7 write-shadow closes (s.4) | last |
| Cutover | manager + Nour | NATTYNOUR, MECHANICS | the trigger list (s.4 step 3); the retirements (step 4) | gate |
| P2 | nickstire server, then client | cloud | quote objects and card; the three texts drafted with the s.7 rule | first, second |
| P3 | nickstire server | NATTYNOUR for REA and captures, cloud for adapters | vendors per s.8 | first |
| P3 | nickstire client | cloud | sourcing drawer, offer on the line, quote card stock | second |
| P4 | nickstire server, then client | cloud | approval page on frozen versions, tech phone, pickup text | first, second |
| After P1 | shop PC model lane | MECHANICS | doc 38 worker and model bench | its own lane |

Legs this plan adds to doc 36 s.1b (one PR each, auth named, a canary that breaks the leg):

| Leg | Phase | Auth | Carries |
|---|---|---|---|
| bdnick reads Shop OS state | P1 | the bridge contract's shared secret, read-only route | board, money bar, open obligations |
| a PC raises an event to bdnick | P1 | the per-PC harness key | counter PC printer or browser down, importer failed |
| PC worker pulls jobs from nickstire, pushes results | after P1 (doc 38) | a per-PC key on an outbound HTTPS job route | draft size, draft line proposals; never a send or a write without code checks |
| nickstire to bdnick to PC round trip | P1 | bridge secret, then an allowlisted action with `needsGo` | a named `shop-os-smoke` action on MECHANICS added by allowlist PR |

## 10. Benchmarked against

Benchmarked against: ALG / Real-Time Labor Guide PRO via doc 30 s.2 (adopted: one ticket object for estimate and
invoice, the estimate-invoice number pair, typed lines with tech and vendor hooks, history rows with staff;
rejected: the opaque line type enum, one-seat flat roles, payment status on the ticket); Tekmetric and Shopmonkey
as scored in doc 05 and doc 11 (adopted: the authorization record per order, which Shopmonkey exposes as
`GET /v3/order/:id/authorization`, doc 11 item 6; estimate versions; inspection findings with photos; rejected:
text-to-pay in the three texts, WATCH until P4 reads come in, and any dependency on either product); Odoo
Community 17.0 (github.com/odoo/odoo, LGPLv3, read 2026-11-07, mechanisms only, no code copied; adopted: invoices
`draft -> posted -> cancel` where a posted entry in strict mode cannot be edited and is reversed with
`_reverse_moves`, an `inalterable_hash` chain over posted entries, the repair order's `under_warranty` flag that
prices comeback work at 0 but keeps it on the record; rejected: its stock-move line types `add, remove,
recycle`, inventory beyond pass-through is out of scope per doc 32 s.8).

## 11. What Nour decides to open the build

1. Open the build at all. Default: nothing starts until he says build.
2. The order: P0, P1, cutover, settle, P2, P3, P4. Default: as written.
3. Labor hours, s.6. Default: B, our own ranges.
4. Rotate the TiDB password and the Maps key (doc 39). No default: it blocks every production write.
5. The importer's first production run. Default: fixtures first, then his go once for the nightly job.
6. Capital or Federated if REA finds only rendered HTML. Default: visible handoff, rule 2 unchanged.
7. The printed forms' Moe's logo and email (doc 33 s.4). Default: keep as printed today.
8. Ask Dowell for an ALG export and set ALG's end date. Default: keep ALG paid through settle plus 30 days.
9. O'Reilly login for the server (Railway variable). Default: none until he sets it himself.
10. The three texts, shown once (s.7). Default: drafts only, nothing sent.
11. The accountant's tax read before cutover (doc 07). Default: required, cutover waits.
12. The cutover timestamp (s.4 step 3 item i). Default: none picked until the trigger list is green.

## 12. Reading order for the whole plan

1. 37-OWN-LEDGER (this file): what we build, in what order, and the calls that are Nour's.
2. 32-CONCRETE-PLAN: the six screens, the rules, the kill reads P2 to P4 keep.
3. 30-PORTAL-NETWORK-SCHEMATICS: ALG's ticket shape and every vendor's wire format.
4. 26-VENDOR-SCHEMATICS: the shop-owned objects and the supplier offer contract.
5. 33-PRINTED-TERMS: the exact terms our printed forms and approval page carry.
6. 07-COMPLIANCE: Ohio estimate, invoice, tax and tire rules as screen behaviour.
7. 36-EXECUTION-SPLIT: where work runs and every leg between computers, sites and apps.
8. 35-SUPPLIER-GAP-GATE: the supplier P0 list P3 starts from.
9. 38-OFFLINE-MODEL-GATE: the shop PC model lane after P1.
10. 39-CLOSURE-AUDIT-GATE: the security item that gates every production write.

live: not checked this pass. SHOP DATA: none read; no shop records, ticket ids or tenant ids used.
