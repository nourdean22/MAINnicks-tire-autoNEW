# Nick's Shop OS: plan folder (nickstire.org/system)

Job 2026-10-26-shop-os. Status: PLANNING; new `/system` screens and supplier adapters are not built, while existing shop features remain reusable. Nour asked (2026-10-26) for his own shop system to replace
ALG/ShopDriver Elite, with parts vendors, an AI copilot and everything done from the estimate and invoice screens, at
nickstire.org/system. He approved approach A on 2026-10-26, then paused. ChatGPT and Perplexity each scored the v1
plan 4/10 on 2026-10-27; after a deep-research round (v2: 6.5/10 and 7/10) and Nour's "more money, easier life" steer,
the roadmap is v3: find the money leaks, take the free money (PartsTech free plan, pricing, tire packages, finance
funnel), bake off the real tiers, then "buy the ledger, build the brain" unless the evidence says build. The concrete plan is
[32-CONCRETE-PLAN](32-CONCRETE-PLAN.md); its deck (placeholder numbers): https://claude.ai/artifact/GFLt89EF5iyvq8kDexfmjC
(private until Nour shares it). The older mockup link (TWqsphTCiJFqigPcxxd1f5) no longer opens.

To pick it back up: read 11-REVIEW (round 2 first), then 05-ROADMAP v3 days 1-7, then 06-OPEN-QUESTIONS.

## Read in this order

| File | What it answers |
|---|---|
| [32-CONCRETE-PLAN](32-CONCRETE-PLAN.md) | the one plan (2026-11-07): buy the ledger (ALG), build the brain; six screens, four phases behind flags with a kill read each, phase 0 prep, the six decisions only Nour can make, corrected against doc 31 |
| [33-PRINTED-TERMS](33-PRINTED-TERMS.md) | the exact estimate and invoice text ALG prints (2026-11-07, customer fields not kept); the approval page, pickup text and quote card read the `businessFacts.ts` fact keys; this is the dated capture the seeds are checked against, and it records the one seed that differs |
| [34-RESEARCH-GATE](34-RESEARCH-GATE.md) | the 2026-11-07 Perplexity CRM report gated claim by claim: 12 of 21 already in docs 07/31/32, 7 folded into doc 32, rule 1 corrected (the Stripe refund writeback is an existing ALG writer); the supplier reports are doc 35 |
| [36-EXECUTION-SPLIT](36-EXECUTION-SPLIT.md) | who builds each doc 32 phase where: cloud sessions for code lanes, NATTYNOUR for captures and merges, MECHANICS for on-counter verification, bdnick as the dispatch channel; starts only on Nour's go |
| [37-OWN-LEDGER](37-OWN-LEDGER.md) | the ledger is built, not bought (Nour, 2026-11-07 13:30Z): our own customers, vehicles, tickets, lines, authorizations, payments and declined work modeled on ALG's ticket shape and better in five named ways; phases P0-P4 with an early cutover after P1 and shadow days, the day-one migration list, vendors on named screens, labor hours as Nour's call (default: our own ranges), the three texts, the doc 36 s.2 replacement, and the twelve calls Nour makes to open the build; PLAN ONLY |
| [38-OFFLINE-MODEL-GATE](38-OFFLINE-MODEL-GATE.md) | the 2026-11-07 offline-model report gated against docs 12 and 18: adopted as the shop PC TEST PLAN (first pull `qwen3.5:4b-q4_K_M`, challenger `lfm3-vl:2b`, 64-case golden set, gates, Windows Ollama settings), its env-var route refuted (the vars configure the Railway server; the PC reaches the CRM through the doc 18 worker), every speed ESTIMATED until MECHANICS runs it |
| [39-CLOSURE-AUDIT-GATE](39-CLOSURE-AUDIT-GATE.md) | the 2026-11-07 closure audit gated: Shop OS rows already doc 32/34 and ruled at 13:30Z; its P0 corrected (the Neon password it names was rotated by 10-22, the still-open rotation is a different credential, Nour's); release receipt fields folded into doc 36 s.4; memory scorecard and Sentry loop parked for the statenour lane; Monday packet = the existing report skills |
| [31-PLAN-AUDIT](31-PLAN-AUDIT.md) | start here: every load-bearing claim in 01-30 re-checked with a receipt (2026-11-06), what is refuted, what is already built, the open decisions, and a recommended order for the one plan |
| [11-REVIEW](11-REVIEW.md) | what ChatGPT and Perplexity said (both 4/10), what we changed, where we disagree |
| [06-OPEN-QUESTIONS](06-OPEN-QUESTIONS.md) | the decisions waiting on Nour, the unknowns, and the vendor email to send |
| [01-DESIGN](01-DESIGN.md) | what we build, the three options and what each costs, the counter screen, parts, copilot |
| [10-UI-BUILD](10-UI-BUILD.md) | the /system screens, look and feel, how it plugs into the existing app |
| [05-ROADMAP](05-ROADMAP.md) | v3: money leaks (days 1-3), free money (4-7), bake-off (8-12), decision (13-14), configure, break it, gates, then build the brain |
| [08-IDEAS](08-IDEAS.md) | 17 ranked ideas that reuse what the shop already has (lot camera, receptionist, texts) |
| [03-VENDORS](03-VENDORS.md) | every parts, tire, labor, payment and phone vendor and how each plugs in |
| [04-DATA-MAP](04-DATA-MAP.md) | production numbers today and how ALG's data moves over |
| [07-COMPLIANCE](07-COMPLIANCE.md) | Ohio estimate, invoice, tax, tire and used-tire rules as screen behaviour |
| [09-ACCESS-AND-SECURITY](09-ACCESS-AND-SECURITY.md) | crew logins and roles, MFA, audit log, FTC and Ohio data duties |
| [02-RESEARCH](02-RESEARCH.md) | the 16 research runs with sources and labels |
| [12-LOCAL-AI-AND-MESH](12-LOCAL-AI-AND-MESH.md) | a local AI model on the shop PC, and a mesh of the three PCs: not yet, and why |
| [13-TOOLKIT](13-TOOLKIT.md) | every account, key name, API, MCP, plugin, skill and device the build needs: have, missing, Nour's call |
| [14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md) | per counter screen: ALG baseline, the best public mechanisms, ours, and the slot for Nour's screenshots |
| [15-GAPS](15-GAPS.md) | 27 gaps no plan file covers (his words, the shop's day, data, integrations, operations), top 10 by cost, 5 unrun research queries |
| [16-AI-CONTROLS-CUSTOMER360](16-AI-CONTROLS-CUSTOMER360.md) | Claude/ChatGPT in the CRM over MCP, every owner setting in /system, what a customer profile may lawfully hold |
| [17-ALG-LEDGER-STUDY](17-ALG-LEDGER-STUDY.md) | every mirrored ALG ticket and estimate: how, why, what, who, when; ten execution rules; five blind spots (figures private) |
| [18-SUPPLIER-DESKTOP-OFFLINE-AI](18-SUPPLIER-DESKTOP-OFFLINE-AI.md) | supplier comparisons, authorized portal handoffs, PC readiness, local-AI evaluation, offline boundary, and detailed flows |
| [19-CRM-BUILD-PROMPT](19-CRM-BUILD-PROMPT.md) | copy-ready lead prompt for the future plan/build session |
| [20-SUPPLIER-INTEGRATION-START](20-SUPPLIER-INTEGRATION-START.md) | provider-by-provider start for AutoZone Pro, Parts Authority/IMC, and existing D&K/Gateway Tire; evidence, REA status, PartsTech terms, and vendor gates |
| [21-ALG-UX-AUDIT](21-ALG-UX-AUDIT.md) | full ALG screen-by-screen UX audit (Nour's own Real-Time Pro login, 2026-11-06): nav, ticket wizard, package jobs, 14-template reminder library, real vendor/markup list, 3-role access + per-seat pricing, no-scheduling gap, what it changes elsewhere in the plan |
| [22-GATEWAY-DK-UX-AUDIT](22-GATEWAY-DK-UX-AUDIT.md) | full Gateway Tire/D&K B2B portal UX audit (Nour's own account, 2026-11-06): tires/supplies/wheels catalogs, 28-field tire spec schema, the shop's own 100%-markup rule explaining the 2.00x cost-to-retail pattern, Quote List, an unused built-in Bay Manager scheduling board, order history, and what it means for nickstire.org's tire page and ordering widget |
| [23-ATD-UX-AUDIT](23-ATD-UX-AUDIT.md) | full ATD Online (American Tire Distributors) B2B portal UX audit (Nour's own account, 2026-11-06): a six-tier Pickup/Today/Tomorrow/named-date/Multi-Day/National delivery model, a step-up password re-auth gate on Users/Accounting, a built-in Quotes CRM funnel (Open/Contacted/Converted/Closed), recurring-order Lists with share permissions, a paste-from-spreadsheet Stock Order screen, a VIN-to-OE-fitment flow with a wheel visualizer, and a live vendor marketing-program progress gauge |
| [24-CAPITAL-TIRE-UX-AUDIT](24-CAPITAL-TIRE-UX-AUDIT.md) | full Capital Tire wholesale portal UX audit (Nour's own account, 2026-11-06): per-warehouse stock across 10 named warehouses with home-warehouse-only ordering and ROUTE/PICKUP (no ETA), a lost-sale reason capture, a scoped markup-rule engine with an AI assistant, a Good/Better/Best customer quote printout, a hide-cost customer view, stock-out substitution, dual front/rear size search, and trim-level fitment with placard psi, TPMS and plus sizing |
| [25-FEDERATED-UX-AUDIT](25-FEDERATED-UX-AUDIT.md) | full FederatedLink (Federated Auto Parts / Fisher Auto Parts store) UX audit (Nour's own account, 2026-11-06): five-mode search, Y/M/M/Engine picker, three-pane part-type picker with Total Job kits, results with Alt Locations across 12 stores/warehouses (no ETA), interchange + buyer's guide, lost-sale and discrepancy actions, stock/list ordering with paste upload, invoices with inline lines, and a cart that builds labor quotes |
| [26-VENDOR-SCHEMATICS](26-VENDOR-SCHEMATICS.md) | rollup of audits 21-25 for the build: cross-vendor matrix, fields to add to 18's supplier-offer contract, shop-owned objects (ShopIdentity, SellPriceRule, Quote, DeclineReason, JobKit, PartCrossRef, CatalogIssue, SupplierOrderDraft), screens in build order, and the open questions that block Quickest Arrival |
| [27-PARTS-AUTHORITY-UX-AUDIT](27-PARTS-AUTHORITY-UX-AUDIT.md) | full Parts Authority / IMC Web Warehouse UX audit (Nour's own account, 2026-11-06): per-location Submit By and My Branch Departure times, a header run-cutoff clock (~every 30 min) with alarm, live delivery-run tracking, OE reference row with qty per vehicle, quality grades, Repair Jobs, exploded OE diagrams, vehicle-named carts, DoorDash/transfer/shipping branch modes, lost-sale reasons, and the existing Mitchell 1/ALLDATA punchout |
| [28-OREILLY-UX-AUDIT](28-OREILLY-UX-AUDIT.md) | full O'Reilly Pro / First Call Online UX audit (Nour's own account, 2026-11-06): plate/YMM/VIN lookup, per-SKU "Available Now" vs "In Network - In Store By / If Ordered By" ETAs, quote-per-vehicle cart with labor and return types, 4-step delivery tracker, interchange wizard with house-brand substitutes, unused Manage Customers mini-CRM, shop pricing/tax/PO/bay/fleet preferences, activity log, and a 1% electronic earn-back |

The 2026-11-05 counter screenshot and matching shop-profile bookmark metadata read identify 38 bar entries, 3 synced entries, and two screenshot-only clipped labels across labor, parts, tires, used parts, financing, payments, communications and shop operations. Section 18 is the complete shortcut register and routes each item to a CRM decision. REA has only verified selected public login/landing surfaces; authenticated workflows and saved-login behavior remain UNKNOWN until a loopback browser connection is available.

## Current status update (2026-11-06)
| [29-AMAZON-UX-AUDIT](29-AMAZON-UX-AUDIT.md) | Amazon automotive UX audit (public, signed-out, 2026-11-06): Your Garage with plate or Y/M/M and only-missing-attribute questions, conditional fit badge, per-offer delivery date with "order within" countdown, arrives-by facet, seller/shipper and new/used offers, return-by date, and sponsored results that ignore fitment; signed-in Amazon Business pass: PO printed on the box, per-line receiving, account-wide Ohio reseller exemption, punchout/e-invoicing options |
| [30-PORTAL-NETWORK-SCHEMATICS](30-PORTAL-NETWORK-SCHEMATICS.md) | wire-level pass under audits 21-29 (Nour's own logged-in tabs, fetch/XHR hook + bundle reads, 2026-11-07, read-only): ALG = Real-Time Labor Guide PRO, its tenant API and full `ticket/getTicket` line-item schema (the split the mirror lost), Gateway stock/price/regional-days fields, O'Reilly availability and pricing JSON with per-location routes and cutoffs, ATD six-tier DOM, Capital and Parts Authority DOM tiers, Federated vehicle JSON; doc 26 field-to-vendor map; UNKNOWN list with routes |
| [35-SUPPLIER-GAP-GATE](35-SUPPLIER-GAP-GATE.md) | four outside supplier reports (2026-11-07) checked claim by claim against PR 3571 and main: 45 rows (14 built, 22 new, 1 refuted, 8 unverified), P0-first gap list for the next supplier compare round, a do-not-build list, and the "Sellable Tire Offer" verdict (adapt doc 26 Quote, do not add) |
The new Shop OS remains planning work. Source search found no /system product routes in the nickstire client. Current D&K tire search/order code and existing customer/estimate tools are reuse candidates, not proof that the new screens or supplier adapters exist. The front-desk local-model handoff has no completion receipt in the reviewed memory; re-check before installation. The updated design is in [18](18-SUPPLIER-DESKTOP-OFFLINE-AI.md); the build sequence is in [the implementation plan](../../../../../docs/superpowers/plans/2026-11-06-shop-os-sourcing-desktop-offline-ai.md).

A full ALG reverse-engineering pass (Nour's own Real-Time Pro login, 2026-11-06, read-only) is now in
[21-ALG-UX-AUDIT](21-ALG-UX-AUDIT.md), rows added to [14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md). It corrects
"ALG/ShopDriver Elite" to "ALG (Real-Time Pro, by Dowell Systems)" - a different, lower tier than ShopDriver
Elite - and confirms real vendor names/markup model, a 14-template reminder library, package jobs, $35/mo
1-seat pricing with no MFA, and no reachable scheduling board anywhere in the product on this tier.

A full Gateway Tire/D&K B2B portal pass (Nour's own account, 2026-11-06, read-only) is now in
[22-GATEWAY-DK-UX-AUDIT](22-GATEWAY-DK-UX-AUDIT.md). It confirms D&K = Dunlap & Kyle Company Inc., explains the
2.00x cost-to-retail pattern as the shop's own 100%-markup rule (not a Gateway default) labeled with the shop's
Moe's trade name (a current name, not stale - Nour, 2026-11-06), finds a Quote List safe-quote flow and an unused built-in Bay Manager scheduling board,
and captures the 28-field tire spec schema, Local/Regional stock split, and delivery-cutoff banner that feed
nickstire.org's tire page and ordering widget.

A full ATD Online (American Tire Distributors) pass (Nour's own account, 2026-11-06, read-only) is now in
[23-ATD-UX-AUDIT](23-ATD-UX-AUDIT.md). It confirms ATD as Nour's second tire vendor, finds a six-tier
Pickup/Today/Tomorrow/named-date/Multi-Day/National delivery model (the strongest "best price AND quickest"
reference found this session), a step-up password re-auth gate on Users/Accounting, a built-in Quotes CRM
funnel (Open -> Contacted -> Converted/Closed), recurring-order Lists with multi-location share permissions, a
paste-from-spreadsheet Stock Order bulk-reorder screen, a VIN-to-OE-fitment flow with a wheel visualizer, and a
live vendor marketing-program progress gauge. It also feeds a new cross-cutting requirement into
[03-VENDORS](03-VENDORS.md): Shop OS's CRM must show both the best-priced and the quickest-to-arrive option
across connected suppliers whenever ordering.

A full Capital Tire wholesale pass (Nour's own account, 2026-11-06, read-only) is now in
[24-CAPITAL-TIRE-UX-AUDIT](24-CAPITAL-TIRE-UX-AUDIT.md). Capital Tire runs on a white-label TCS Technologies
portal and shows exact stock at 10 named warehouses but lets this account order only from its home warehouse
(Macedonia, OH), with ROUTE or PICKUP at checkout and no ETA anywhere - which forces a correction in
[03-VENDORS](03-VENDORS.md): supplier offers must carry location and arrival as separate fields. Its strongest
mechanisms for Shop OS are a structured lost-sale reason capture with competitor price, a rule-based markup
engine (default + scoped rules, tie-break, max-profit cap, live preview), a Good/Better/Best customer quote
printout with fees and road hazard, a one-click hide-cost customer view, stock-out substitution, and
trim-level fitment with placard psi, TPMS and plus sizing (14-STOLEN-MECHANISMS rows 18-26).

A Federated Auto Parts / Fisher Auto Parts pass (Nour's own FederatedLink account, 2026-11-06, read-only) is in
[25-FEDERATED-UX-AUDIT](25-FEDERATED-UX-AUDIT.md) - the first parts vendor. It confirms the Capital Tire
pattern (exact stock at many named locations, home-store-only ordering, no ETA) and adds job-based part kits,
graded interchange with reverse fitment, catalog discrepancy reporting, a three-pane multi-part-type picker,
and a five-mode search box (14-STOLEN-MECHANISMS rows 27-32). It also shows the vendor cart building labor
quotes - rejected for Nick's. **[26-VENDOR-SCHEMATICS](26-VENDOR-SCHEMATICS.md) rolls all five audits into
the offer fields, shop objects and screens the build must implement - read it before 21-25.** Correction from
Nour (2026-11-06): the shop also trades as Moe's, so "Moe's" on vendor accounts is current, not stale.

A Parts Authority / IMC Web Warehouse pass (Nour's own account, 2026-11-06, read-only) is in
[27-PARTS-AUTHORITY-UX-AUDIT](27-PARTS-AUTHORITY-UX-AUDIT.md) - Nour's top parts vendor. It is the first vendor
to give real arrival data: per source location a Submit By and a My Branch Departure time, runs about every 30
minutes with a cutoff clock on every page, Saturday delivery and live run tracking. It also shows the OE part
and OE price above every aftermarket option, grades every SKU Good to Ultra Premium, names carts after the
vehicle, and already supports a "vehicle in, basket back, human orders" punchout for Mitchell 1 and ALLDATA - the
integration to ask IMC for first (14-STOLEN-MECHANISMS rows 36-44).

An O'Reilly Pro pass (Nour's own account, 2026-11-06, read-only) is in [28-OREILLY-UX-AUDIT](28-OREILLY-UX-AUDIT.md).
O'Reilly shows a per-part ETA to its store with a cutoff ("In Store By tomorrow 7:30 AM if ordered by 5:25 PM"),
a four-step order tracker, returns that ride back with the delivery, bay/fleet/PO fields on orders, and a 1%
earn-back on electronic orders; like Federated it also offers customer lists and labor quotes inside the portal,
which Shop OS keeps for itself (14-STOLEN-MECHANISMS rows 45-51).

## Five facts that shape everything
1. The shop closes a few mid-to-large tickets a day (production read; exact figures stay out of this public repo).
2. The repair-order, inventory, tech and inspection tables already in the code are EMPTY in production: there is a
   skeleton, not a system.
3. One parts aggregator (PartsTech) covers all five parts suppliers the shop uses and also carries MOTOR labor times;
   O'Reilly also offers a direct API to single shops.
4. Ohio's repair rule (OAC 109:4-3-13) dictates the estimate and invoice screens: estimate choice, the 10% approval
   line, tech name on labor, replaced parts offered back.
5. Sending customers to finance programs may make the shop an FTC "financial institution": staff get their own logins
   with the app's own MFA and an audit trail from day one (09-ACCESS lists the P0 tasks that make crew logins possible).

## Labels used everywhere
FACT = read this session from code, production or the primary page. CLAIM = a research report cites a source we did not
open. INFERENCE = reasoning. UNKNOWN = not known yet; never treated as zero.

An Amazon pass (public pages, signed out, 2026-11-06, read-only) is in [29-AMAZON-UX-AUDIT](29-AMAZON-UX-AUDIT.md).
Amazon gives the clearest delivery promise of any source (a date plus an "order within" clock) and a conditional
fit badge, but its earliest promise was next day and sponsored results ignore the vehicle filter; Shop OS takes
the promise wording, the arrives-by filter and return-by dates (14-STOLEN-MECHANISMS rows 52-60). The signed-in
Amazon Business pass adds the ticket number printed on the box, and a received tap per line (rows 61-65; the resale/shop-use split in row 63 is parked - tax setup confirmed
correct).