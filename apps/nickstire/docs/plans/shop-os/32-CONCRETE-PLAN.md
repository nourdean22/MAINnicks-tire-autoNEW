# Shop OS 32: the one concrete CRM plan (v1, 2026-11-07)

Answer first: build four phases of `/system` in the nickstire app, in this order, on top of ALG as the ticket of
record. Read first (counter + board), quote second, sourcing third, approval last. Each phase ships behind a flag
with its kill read written before the build. Nothing in ALG is written to; no adapter scrapes a logged-in portal
page. Six decisions are Nour's and are listed at the end; everything else is decided here. Corrected against doc 31
on 2026-11-07: four claims of the first draft were refuted and are fixed below (mirror staleness, the D&K login
path, the buy-vs-build call, the built repair-order backend).

Deck with the screens as they would look: https://claude.ai/artifact/GFLt89EF5iyvq8kDexfmjC (private until Nour
shares it; every number on it is a placeholder). The README now points here; its older mockup link
(TWqsphTCiJFqigPcxxd1f5) no longer opens.

Receipts this plan stands on: doc 30 (portal captures, FACT/UNKNOWN per field), doc 26 s.3 (shop-owned objects),
doc 17 (ledger study; figures private), doc 10 (routes and look), doc 05 (kill-switch rule), doc 31 (claim-by-claim
audit of docs 01-30, PR 3572: where 31 and this file disagree, 31 wins and this file gets a fix; the first four
are in). A knowledge graph of docs 01-30 plus the 2026-11-06 sourcing plan (488 nodes, 878 edges, 27 communities)
was built for this plan; its two bridge nodes are the plan README and the counter screen, which is the reading
behind "the counter runs the shop".

Benchmarked against: Shopmonkey and Tekmetric (counter-first RO screen, texted approval link with line items;
doc 14), Shop-Ware (job board in arrival order; doc 14), ATD's Quotes CRM funnel and Capital's lost-sale reason
capture (docs 23, 24) · adopted: one RO screen with a money bar, approval link by text, decline reason on every
no, board in arrival order · rejected: appointment scheduling (the shop is first come, first served), a second
ticket system beside ALG (double entry), DOM scraping of supplier portals (doc 03 boundary).

## 1. The shape: buy the ledger, build the brain

| Layer | Owner | What it is | State today |
|---|---|---|---|
| Ticket of record, labor book | ALG (Real-Time Labor Guide PRO) | tickets, customers, vehicles, lines, payments, labor hours | LIVE; mirrored read-only (`shopDriverMirror.ts`) |
| Counter, quote, sourcing, approval | ours, `apps/nickstire` | six screens under `/system`, supplier adapters, shop-owned objects | Backend BUILT+UNWIRED: work orders, estimate-to-work-order and the staff side of inspections have 0 client callers; dispatch has 3 of 34 procedures wired; Customer360 shows open work orders read-only (`workOrderService.ts`, `dispatch.ts`, `Customer360Panel.tsx:586`; doc 31 item 3). `/inspection/:token` BUILT+WIRED (`App.tsx:382`). `/system` MISSING (routes and look fixed in doc 10) |
| Texts, calls, reviews, admin | ours, already live | SMS lane with daily cap and opt-out, receptionist, callbacks, `/admin` | LIVE on nickstire.org |

Doc 01 says "option A, build"; doc 05 says "buy the core, build the brain". They agree once ALG is the core being
bought: we keep paying for ALG, we read its data, and we build everything the crew touches during the day. ALG
write-back (creating or editing a ticket from our screen) stays UNKNOWN and out of scope until an endpoint and a
dry run prove it (doc 30 s.10).

## 2. The six screens, in build order

| # | Screen | Route | Reads | Writes | Phase |
|---|---|---|---|---|---|
| 1 | Counter search | `/system` | mirror (customers, vehicles, tickets), callback queue | none | 1 |
| 2 | Board + bay TV | `/system/board`, `/system/tv` | mirror ticket headers + the built work-order and dispatch rows | work-order state (existing tables) | 1 |
| 3 | Quick tire quote | `/system/quote` | fitment, `SellPriceRule`, supplier stock | `Quote`, `DeclineReason`; one text | 2 |
| 4 | Sourcing drawer | `/system/ro/:id` (ALT+S) | supplier adapters, `PartCrossRef`, `JobKit` | `SupplierOrderDraft`, `CatalogIssue` | 3 |
| 5 | Tech phone | `/system/tech` | my cars, promise times (dispatch rows) | found-work line + photo (work-order lines, staff inspection) | 4 |
| 6 | Customer approval | `/approve/:token`, extends the live `/inspection/:token` | frozen estimate lines | approve/decline + reason + timestamp | 4 |

Look and keyboard: doc 10 as written (near-black, cards, yellow accent; Barlow Condensed / DM Sans / JetBrains
Mono; Alt-key map matching the ALG counter). The money bar (cars in, promised, collected, parts due, declined
open) is pinned on screens 1 to 4 and is the owner's read; no report to open.

## 3. The four phases

| Phase | Ships | Needs before start | Build time (not calendar) |
|---|---|---|---|
| 0 prep | flip the two approved-by-default code paths (work orders start `approved`, lines approved with no pending state) and add the 10% re-approval gate (Ohio, doc 07; doc 31 item 4); turn the Google Sheet push off for `/system` (`workOrderService.ts:171`); make the adapter return UNKNOWN, not 0, when unpriced (`gatewayClient.ts:251`) | decision 0 | 1 working day |
| 1 read | counter search, board, TV, money bar | decisions 1 and 1b | 3 to 4 working days |
| 2 quote | quick tire quote, text it, 3-day reminder, `Quote`, `SellPriceRule`, `DeclineReason` | decision 5 (quote text template) | about a week |
| 3 source | sourcing drawer; live JSON behind the shop login (Gateway, O'Reilly) only if decision 2b says yes; ATD, PA, Capital and Federated are handoffs until a feed or vendor-approved export exists; PO draft | doc 30 captures re-run against fixtures; decisions 2b and 3 | depends on captures |
| 4 yes | tech phone, approval link, pickup text, decline reasons into follow-up | decision 5 (approval and pickup templates) | about a week |

Phase 3 gap order (P0 truthful arrival, spec gate, cost leak, retail-as-cost) is in doc 35 section 3.

Why this order and not doc 10's: the board needs no vendor capture, but on day one it shows the 3 AM / 8 PM mirror,
not live ALG: the mirror is headers only and every daytime probe logs the counter out (SHOP-PROTECT,
`shopDriverMirror.ts:579`), so the board is up to about 12 hours stale until decision 1b; the quote is
the call the receptionist cannot finish today; sourcing waits on proven captures; approval is the only phase with
customer sends, so it goes last and gets the most review. Doc 05's bake-off (days 8 to 12) is replaced by the
captures doc 30 already made.

Each phase is one PR series behind a flag (`SHOP_OS_PHASE_1` to `_4`), verified on the counter PC before the next
starts. A phase's kill read is written in its first PR, not after.

## 4. Proof reads and kill criteria

| Phase | Read two weeks after live | Kill if |
|---|---|---|
| 1 | counter searches per shop day; TV open during hours; fewer "where is the car" asks | under the threshold set at launch after week 2, or the crew is back on the ALG screen |
| 2 | quotes texted; quote-to-invoice within 7 days; reminders answered | quote-to-invoice no better than doc 17's baseline after 30 quotes |
| 3 | minutes from "need a part" to PO draft; cost per part vs the hand-picked supplier the week before | stock or arrival shown wrong on 3 orders, or any adapter needs a logged-in page scraped |
| 4 | approval links tapped; decline reasons recorded; found work approved vs the paper weeks before | under half of links tapped within the day, or any opt-out complaint |

Thresholds are set from the baseline read at each phase's start, never after. The baseline is doc 17's
quote-to-invoice and repeat-customer rates (private figures; read from the mirror, not copied here). A kill turns
the flag off and the next phase waits.

## 5. Data: what exists, what is new

| Piece | State | Plan |
|---|---|---|
| ShopDriver mirror | LIVE, read-only | source of truth for customers, vehicles, tickets; per-ticket detail fetch is decision 1 |
| SMS lane, receptionist, callbacks | LIVE | carries quote, approval, pickup, follow-up texts; callback queue feeds counter cards |
| Tire finder, fitment, online orders | LIVE | quick quote reuses fitment and sell rules so web and counter price the same |
| Supplier adapters | SCHEMATIC (doc 30) | one offer contract (doc 26 s.3, amended by 30): `qty` may be `{atLeast: n}`, `availabilityTiers[]` for ATD and PA, `orderableByThisAccount` UNKNOWN until an order response is captured, `arrival.at` UNKNOWN for Gateway and PA; today's adapter returns 0 when unpriced (`gatewayClient.ts:251`), fixed in phase 0 |
| Shop-owned objects | DESIGNED (doc 26 s.3) | `ShopIdentity`, `SellPriceRule`, `Quote`, `DeclineReason`, `JobKit`, `PartCrossRef`, `CatalogIssue`, `SupplierOrderDraft`; `DeclineReason` extends the existing decline table (`schema.ts:1553`, no reason column today) and `Quote` extends the existing decline tap and Text-me-this-quote path (doc 31 row 08); new TiDB tables via `nickstire-tidb-ddl` only where no table fits |
| Repair-order backend (work orders, estimate-to-WO, dispatch, staff inspection) | BUILT+UNWIRED (dispatch 3 of 34 wired; Customer360 open-work-orders table is the one read-only view) | the board, tech phone and approval page sit on these, no second model |
| Six screens | MISSING | this plan |
| Supplier-compare builds (PR 3568, PR 3571 v2) | PARKED, draft | neither merges until phase 3's adapters are proven against doc 30 fixtures; the better one is adopted then |

## 6. Rules the build does not get to relax

1. No ALG write. No supplier order placed by code; a person clicks the PO from `SupplierOrderDraft`.
2. No adapter scrapes a logged-in portal page. Live JSON behind the shop login (the D&K client already signs in with
   the shop password, `gatewayClient.ts`; O'Reilly is the same class) is decision 2b, not a given. ATD, PA, Capital
   and Federated are handoffs until a feed or vendor-approved export exists (doc 30 s.10 item 5).
3. Every figure on an offer card shows its source and its checked-at time; a cached figure never ranks first.
4. A capped stock count is a lower bound; an UNKNOWN stays UNKNOWN on screen, never a zero.
5. Every customer send is a protected operation: preview first, live only on Nour's go, inside the daily cap.
6. Written estimate on file before work (Ohio rule, doc 07); the approval page is that record.
7. Customer data stays on the ticket; no phone numbers, names or VINs in logs, PRs or docs.
8. When copy mentions warranty, storage or refunds it reads the fact keys in `server/services/businessFacts.ts`
   (the runtime source; SHOP-SOUL rule 1: linked, never retyped) with their qualifiers, never a shortened form,
   and only on the channels each fact allows: `refund.policy` and `storage.policy` are voice and web only, so no
   text message quotes them. Routine quotes, approvals, pickups and receptionist replies do not raise terms
   unasked (`buildWarrantyFactsPreamble`, quote-only-if-asked): no terms sentence in a text, a call or the body
   of a quote; the approval page keeps them in a collapsed section the customer opens, the web form of the
   printed footer (doc 33 s.3). Doc 33 is the dated verbatim capture of the
   printed forms; the seeds are checked against it, and a term that differs is fixed in ALG first, then the seed.

## 7. The six decisions only Nour can make

0. Buy the ledger or build it (doc 05 day 13-14 call). Default: buy the core, keep ALG, build the brain; this
   whole plan assumes it.
1. Per-ticket ALG fetch for the mirror (collides with the session guard, doc 30 s.2) or stay on the recent-tickets
   list. Blocks phase 1's history card.
2. CAPTURED 2026-11-07, not yet usable: the lookup is three GETs (doc 30 s.2 "Labor lookup": typeahead -> job id
   -> low / average / high hours plus suggested parts, keyed by year, model, engine, job id), but the only path seen
   runs them after the editor's `PUT ticket/updateTicketSession`, which rule 1 forbids. Whether the GETs answer on
   their own is UNKNOWN until a standalone call is proven (doc 30 s.10 item 1). Until then the board promises no hours:
   a line's hours are UNKNOWN and non-promissory, and the repo's built-in guide (`server/routers/autoLabor.ts`,
   wired at `IntegrationsSection.tsx:173-186`) is a hard-coded range per repair category with no year, model or
   engine, a rough aid and not a source. Any path through the editor is an ALG write that needs its own decision.
   1b. Daytime mirror probes: allow them (the counter gets logged out of ALG on each one) or keep the board on the
   3 AM / 8 PM mirror. Blocks a live board.
   2b. Is the D&K login-based client (and O'Reilly's JSON behind the shop login) an approved vendor path, or a
   handoff like the rest. Blocks phase 3's live sourcing.
3. Capital and Federated: ask each vendor for an export or API, or accept handoffs for now.
4. Phase order as above, or quote before read: doc 31 s.6 leans quote-first (about 70%) because the quote needs no
   daytime ALG read and makes money through the live declined-work lane. Read-first here only if decision 1b is yes.
5. Send templates: quote text, approval text, pickup text. Each is a customer send and needs a go, one by one.

Default if he says nothing: 0 buy the core, 1 stay on the list, 1b no daytime probes, 2 wait, 2b handoff until he
says yes, 3 handoffs, 4 as above, 5 drafts only.

## 8. What this plan leaves out on purpose

Appointment scheduling (first come, first served stays), a second ticket system, inventory management beyond
`inventoryStockId` pass-through, payroll and time clocks (doc 09 roles only), a local AI node on the shop PC
(doc 12: not yet), and the AI copilot panel (doc 16) until phases 1 to 4 have two weeks of reads each.
