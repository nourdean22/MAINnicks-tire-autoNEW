# Nick's Shop OS: plan folder (nickstire.org/system)

Job 2026-10-26-shop-os. Status: PLANNING; new `/system` screens and supplier adapters are not built, while existing shop features remain reusable. Nour asked (2026-10-26) for his own shop system to replace
ALG/ShopDriver Elite, with parts vendors, an AI copilot and everything done from the estimate and invoice screens, at
nickstire.org/system. He approved approach A on 2026-10-26, then paused. ChatGPT and Perplexity each scored the v1
plan 4/10 on 2026-10-27; after a deep-research round (v2: 6.5/10 and 7/10) and Nour's "more money, easier life" steer,
the roadmap is v3: find the money leaks, take the free money (PartsTech free plan, pricing, tire packages, finance
funnel), bake off the real tiers, then "buy the ledger, build the brain" unless the evidence says build. Mockup (sample data):
https://claude.ai/artifact/TWqsphTCiJFqigPcxxd1f5 (private until Nour shares it).

To pick it back up: read 11-REVIEW (round 2 first), then 05-ROADMAP v3 days 1-7, then 06-OPEN-QUESTIONS.

## Read in this order

| File | What it answers |
|---|---|
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

The 2026-11-05 counter screenshot and matching shop-profile bookmark metadata read identify 38 bar entries, 3 synced entries, and two screenshot-only clipped labels across labor, parts, tires, used parts, financing, payments, communications and shop operations. Section 18 is the complete shortcut register and routes each item to a CRM decision. REA has only verified selected public login/landing surfaces; authenticated workflows and saved-login behavior remain UNKNOWN until a loopback browser connection is available.

## Current status update (2026-11-06)
The new Shop OS remains planning work. Source search found no /system product routes in the nickstire client. Current D&K tire search/order code and existing customer/estimate tools are reuse candidates, not proof that the new screens or supplier adapters exist. The front-desk local-model handoff has no completion receipt in the reviewed memory; re-check before installation. The updated design is in [18](18-SUPPLIER-DESKTOP-OFFLINE-AI.md); the build sequence is in [the implementation plan](../../../../../docs/superpowers/plans/2026-11-06-shop-os-sourcing-desktop-offline-ai.md).

A full ALG reverse-engineering pass (Nour's own Real-Time Pro login, 2026-11-06, read-only) is now in
[21-ALG-UX-AUDIT](21-ALG-UX-AUDIT.md), rows added to [14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md). It corrects
"ALG/ShopDriver Elite" to "ALG (Real-Time Pro, by Dowell Systems)" - a different, lower tier than ShopDriver
Elite - and confirms real vendor names/markup model, a 14-template reminder library, package jobs, $35/mo
1-seat pricing with no MFA, and no reachable scheduling board anywhere in the product on this tier.

A full Gateway Tire/D&K B2B portal pass (Nour's own account, 2026-11-06, read-only) is now in
[22-GATEWAY-DK-UX-AUDIT](22-GATEWAY-DK-UX-AUDIT.md). It confirms D&K = Dunlap & Kyle Company Inc., explains the
2.00x cost-to-retail pattern as the shop's own 100%-markup rule (not a Gateway default) still labeled with the
stale "Moe's Tire" name, finds a Quote List safe-quote flow and an unused built-in Bay Manager scheduling board,
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
