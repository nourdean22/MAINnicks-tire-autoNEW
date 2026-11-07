# 31 - Plan audit: every load-bearing claim in 01-30, re-checked

Date: 2026-11-06 ET (2026-11-07 UTC). Code: origin/main 9aa61c8019. Production read 03:20Z: /api/version ok on main,
/api/health healthy, database up. Doc 30 is cited as PR 3570 merges it (claims re-checked through head e84293a201);
this PR merges only after 3570 lands. No database rows, no vendor portal, no customer data were read. Row counts
need the database, so every count below is UNKNOWN or HISTORICAL.
Method stolen from doc 30: one receipt per claim, the label says how far the evidence reaches, nothing rounds up.

## 1. Answer first

1. The plan mostly holds. Section 2 keeps 137 labelled claims (condensed from 155 helper rows plus mine): 46 FACT,
   34 HISTORICAL (portal screens Nour showed on 2026-11-06), 9 CLAIM (outside pages not opened), 6 STRONG INFERENCE,
   8 UNKNOWN, 2 MISSING, 2 open, and 30 REFUTED or stale. So 58% is checked fact or dated observation; 22% is wrong.
2. Nothing refuted breaks the direction. The refuted lines are fossils: wrong tier name and price for ALG, "12 read
   tools", "PartsTech covers everything", "Ctrl+K is new", "only PA gives cutoffs", two stale lines in 13,
   a count of 28.
3. The biggest truth: the repair-order skeleton is built but has no screen. Work orders, estimates and the staff side
   of inspections have 0 client callers for their writers; the only client read of work orders is the read-only
   open-work-orders table on Customer360 (`customers.history`, `Customer360Panel.tsx:586`), reusable, not a
   repair-order screen. Dispatch has 3 of 34 procedures wired. /system does not exist.
4. Two code defaults contradict Ohio's rule and must flip before any screen ships: work orders start `approved`, and
   every line defaults to approved with no pending state and no 10% re-approval gate.
5. The ALG mirror is headers only, by design (SHOP-PROTECT), and every probe logs the counter out.
6. Privacy defect fixed in this PR: docs 22, 23 and 25 printed vendor account numbers and a sales rep's name and mobile
   in this public repo. Git history still holds them (section 3, item 12).
7. The one plan must decide three things: buy the ledger or build it (day 13-14), whether the D&K login-based client is
   an approved vendor path, and which of PRs 3568 and 3571 becomes the sourcing contract.

## 2. Claim table (one row per doc)

Labels: F FACT, H HISTORICAL, C CLAIM, S STRONG INFERENCE, U UNKNOWN, R REFUTED. Paths are under `apps/nickstire/`.

| Doc | Claims, label, receipt |
|---|---|
| README | Fact 2 tables empty: H (doc 04, 2026-10-26). Fact 3 PartsTech covers all five suppliers: R, gated (06:72, 20:37-39). Fact 3 O'Reilly direct API: C (28:130 unverified). Fact 4 Ohio rule drives screens: F (07). Fact 5 FTC gate: R as a gate (Nour "dont worry about safeguards", 15 a2). Line 4 "ShopDriver Elite": R (21:19-36, Real-Time Pro). |
| 01 | "Approved A" 2026-10-26: H (01:54), since overtaken by the 05 default. "12 read tools": R, 9 reads + 3 propose/open (`server/routers/nick/assistant.ts:60-121`). Work order created approved: F (`server/services/workOrderService.ts:141,179`). Sheet push on create: F (`workOrderService.ts:171`). Elite $100 / 2 users: R for this shop ($35, 1 user, 21:31-36). |
| 02 | PartsTech covers five suppliers: C, superseded (03:61). MOTOR `/taxonomy/labor` in PartsTech spec: H (file not in repo). O'Reilly direct API: C. PartsTech exclusivity: C. Snap public API: R (`server/services/snapFinanceSync.ts:16` "no public REST API"). dkClient no callers: S (imported `server/routers/gatewayTire.ts:61`, never called). |
| 03 | D&K code exists and is routed: F (`server/routers.ts:175,179`). First cohort D&K, AutoZone, PA: H (03:61). "Never scrape private pages": F (03:63). D&K client is reusable code evidence: S with a risk; it logs in with the shop password to the portal's own API (`server/services/gatewayClient.ts:27-28`). |
| 04 | Repair tables 0-1 rows: H (2026-10-26; rows now U). `vehicles` dropped by 0117: H (`schema.ts:2200` still declares it; 0117 is operator-gated). Vehicles via ALG `listVehicles`: F that the call exists (`server/services/shopDriverMirror.ts:104`), shape U. No export or cutover note: stale (21.4 not applied). |
| 05 | Days 1-3 leak sheet, 13-14 decision, default "buy the core, build the brain": H (05:12-49, plan text). Days 4-7 "run PartsTech's free plan": R by 06 row 0a (no sign-up). Kill switches stand (05:88-94). No reminder floor named; ours exists: F (`drizzle/schema.ts:765`, `server/cron/index.ts:593`). |
| 06 | Decision rows 0-8 and the 2026-11-06 rows: H. MECHANICS is the PC candidate: H (06:73). Browser refusal is a hard stop: R in practice (06:109 vs logged-in audits 21-29 and 30). Vendor emails not sent: H. |
| 07 | OAC 109:4-3-13 text: F (matches `docs/VOICE-RECOVERY-AUDIT-2026-09-18.md:108`). "Effective 2026-03-21": F but editorial only (audit :106). $50 floor drives intake: R, phone path (B) has no floor; notice built (`server/services/estimateWording.ts:22`). 10% gate: MISSING. TIN registration: F (`schema.ts:2358`). Tax rows: C. |
| 08 | Tier-1 ideas reuse existing tables (plates, alg_estimates, calls, declines, reminders): F (`schema.ts:4726,1446,1734,1553,765`). Left-without-bay count built: F (`server/routers/lot.ts:811`). Live data: U. Lane-based FCFS: open (08:21). |
| 09 | Six roles, gaps for front_desk and tech: F (`shared/adminPermissions.ts:1-26,138`). setRole only updates admins, no screen: F (`server/services/adminSecurity.ts:149-152`). MFA gate off unless env set: F code, U prod (`adminSecurity.ts:26`). audit_log: F (`schema.ts:2768`). No ALG roles/MFA note: stale (21.3 not applied). |
| 10 | Screen order /system/quote first: plan text, H. /approve/:token extends `/inspection/:token`: F that the base is live (`client/src/App.tsx:382`). Roles named right: F. /system missing: F (client grep exit 1). VIN decode and storage not named for reuse: F (15 c4 open). |
| 11 | v1 scored 4/10 by both: H (11:8). v2 6.5 and 7/10: H (11:66). Data migration 2/10 is still the weak spot: S (mirror is headers only, see 17). |
| 12 | MECHANICS specs, whisper RTF 0.267: H (2026-10-22). Gemma/Ollama installed: U (12:136 no receipt). Provider switch files exist: F. Tailscale and Ollama terms: C. |
| 13 | Env key names have readers: F, except `KOALAFI_PRIVATE_API_KEY` (none, as listed) and `CRON_SECRET` (statenour only). Set-in-prod: U. Doc 12 not on main: R. `steal-like-an-artist` not in repo: R (`.claude/skills/`). "Nour signs up PartsTech free": R by 06 row 0a. ALG API and mirror exist: F. |
| 14 | Ctrl+K search is new: R (`client/src/components/admin/CommandSearch.tsx:742`). D&K price/stock reuse: F. D&K ordering "already live": U (`server/routers/gatewayOrder.ts:51` env gate). Decline table has no reason: F (`schema.ts:1553`). Inspection declines never reach recovery: F (`server/cron/jobs/declinedWorkRecovery.ts:282`). Rows 1-65: H. Header "public pages only": stale. |
| 15 | a5 probes log the counter out, Settings buttons write no log row: F (`server/services/algProbeBudget.ts:12-18`, `server/routers/shopdriver.ts:660,797`). b4 discount cap $250: F (`shared/business.ts:329,338`). a1 Sheets ruling, a3 bake-off, e1 deploy window, e2 owner-away, c1 bays: open, H. |
| 16 | statenour MCP origin check, per-client tokens, default deny: F (`apps/statenour/app/api/mcp/route.ts:12`). Read scope holds 2 tools only: F. Ask assistant owner and manager only: F. `proposeShopAction`: MISSING. Tax 0.08 in 4 places: F (`server/routers/gatewayTire.ts:745`). 605 env reads: R, now 614. |
| 17 | Tickets and estimates are mirrored: F (`shopDriverMirror.ts:1083`, `server/services/shopDriverEstimateSync.ts:802`). Split died spring 2026: F (`server/services/shopSales.ts:30-32`). Match rules 10%/30 d, 25%/45 d: F. Figures: U here (private study). Rule 9 "move syncs to 3 AM/8 PM": stale, they already run there. |
| 18 | Supplier-offer contract not on main: F. Built on drafts PR 3568 and rival 3571: F. Local model makes nothing offline: S. "Never turn missing data into zero price": R against code (`gatewayClient.ts:251` returns 0). PartsTech first in the architecture: R by 20/06. Signed-in flows unobserved (18:43): stale. |
| 19 | Reuse PWA, tRPC, roles, D&K, proposals first: F that each exists. "If browser policy blocks access, stop": superseded in practice by 21-30. Bookmark inventory 38 + 3: H. |
| 20 | D&K routers and services exist and are wired: F. Order shapes come from the portal bundle: F (`gatewaySupplierOrder.ts:6`). Writes need `GATEWAY_ORDERING_ENABLED`: F; it is ON in prod since 2026-10-19 (`truth_os.md:241`), first real order still unproven. PartsTech terms: C. AutoZone My Zone API shape: H. "No private endpoints" (20:48): F as a rule, and D&K breaks it. |
| 21 | Shop is on Real-Time Pro at $35/mo, 1 user: H (screen). "$35+/seat": R (21:34-36, seat price not captured). No MFA, 3 roles: H. No scheduling board: H. No self-serve export: H, but the ALG API exists (13:21, 30:17). Labor $125: H; our fallback is $115 (`gatewayTire.ts:732`). |
| 22 | D&K = Gateway: S (`dk_part_number` in code). Retail = 2.00x via a 100% rule: H portal, F ours (`server/lib/tireMarkup.ts:13`). "28 fields": R, the list has 31. $1 "install" placeholder: U (could be Ohio's $1 tire fee, 07:36). Public tire search fakes delivery text: F (`gatewayTire.ts:299-300`). |
| 23 | Six-tier delivery model: H. Quotes Open/Contacted/Converted/Closed: H. "Global rename sweep" for Moe's: R (both trade names current, 23:3, 26:117). Recall feed match: U (`tire_registrations` exists, no feed). |
| 24 | TCS white-label portal: H. +100% default: H. 10 warehouses, home-only ordering, no ETA: H. Method used page HTML and same-session GETs: process flag, grey zone against 14:223. |
| 25 | Alt Locations greyed except home: H, orderability inferred. Competitor pick list: H. Federated rows are 27-32: R, 27-35. Account number printed: fixed here. |
| 26 | The eight shop-owned objects do not exist: F (docs-only grep hits). Seeds exist: one global markup, `estimates_log`, `work_orders` lines, counter decline tap with no reason (`server/routers/advanced/invoices.ts:838`). PA "only vendor" with cutoffs: R (30 s.8, 28:66). Gateway "cutoff banner only": R (30, per-site days). |
| 27 | Per-location Submit By / Departure table: H. IMC punchout for Mitchell 1: C (public page, 20:136); ALLDATA C; R.O. Writer unread. "IMC will connect to Shop OS": S at best. |
| 28 | Per-SKU "In Store By / If Ordered By": H, matched by 30's JSON. 1% e-sales earn-back: H, terms U. Direct API to single shops: C, a request path only (20:26). |
| 29 | Ohio reseller exemption on the account, PO on the label, per-line receiving: H. "No Shop OS tax feature needed": loose; 14 row 63 and 26:88 keep a `purchaseUse` field. |
| 30 | ALG labor-time endpoint: U for a live vehicle-specific ShopDriver/ALG endpoint; the repo has its own built-in
labor guide (`server/routers/autoLabor.ts`: categories, searchJobs, calculateLabor) wired at `IntegrationsSection.tsx:173-186`,
so a plan extends that fallback rather than rebuilding it. Mirror stops at summary endpoints: F (`shopDriverMirror.ts:378-384,563-571`). Gateway cutoff body U: partly R, code parses `cutofftime[]` (`gatewaySupplierOrder.ts:209-215`). Ticket field names: H. |
| Plan file | Tasks 1-3 target `server/services/sourcing/*`: F that nothing exists there; the drafts use other paths. Task 5 order preview: partly built for D&K only (`gatewayOrder.ts:141,219`). Tasks 4, 6-10: not started. |

## 3. Contradictions, settled by the newest evidence

1. Ledger: 01:54 "approved A" vs 05:45 "buy the core" vs 15 a3 "alg is the prototype". Not settled by evidence;
   it is Nour's day 13-14 call. 05:107 already says the evidence decides.
2. ALG tier and price: 01:60, 02:39 "ShopDriver Elite $100, 2 users" vs 21:31-36 (own account) "Real-Time Pro, $35,
   1 user". 21 wins. "ShopDriver Elite" still appears in 01, 02, 03, 13, 14, 15 and README line 4.
3. PartsTech: 01 s.6, 05:22, 13:16 and 18:61 put it first or sign it up; 06:72 and 20:37-39 gate it on the
   exclusivity answer. 06/20 win (newer, terms-based).
4. Gateway orderability: 26 s.5 "how fast, orderable?" vs 30 s.3. 30 settles speed (3-4 est. days per regional
   site, wire capture); neither settles orderable. Rank regional stock as "not actionable" until one test order.
5. Who gives cutoffs: 26:34 and 27:100 "PA is the only one" vs 28:66 and 30 s.8 (O'Reilly and Gateway per-location
   times). 30 wins. PA is the most precise, not the only.
6. Scraping vs the portal boundary: 03:63, 14:223 and 20:48 forbid private endpoints, yet the reused D&K client logs in
   with the shop password to D&K's own portal API, and 24 read page HTML. No doc names this exception. Decide it.
7. ALG export: 21:354 "no self-serve export, call Dowell" vs 13:21 and 30:17 (an API with full tickets exists).
   30 wins on capability. Using it per ticket collides with SHOP-PROTECT logouts (CURRENT-TRUTH.md:851).
8. Line items on `listTicketSessions`: code comment `shopDriverMirror.ts:569-571` and CURRENT-TRUTH.md:851 say yes;
   17:108 and REALITY-LEDGER.md:97 (captured response, 2026-09-26) say session headers only. The capture wins.
9. Labor-time endpoint (30 s.10): UNKNOWN. Settle with one captured lookup on a ticket Edit screen, zero writes.
10. Zero price: 18:89 "never zero" vs `gatewayClient.ts:251` returning 0 when pricing is absent. Code must map 0 to
    UNKNOWN in any comparison adapter.
11. Trade names: 22-29 say Moe's and Nick's are both current (Nour, 2026-11-06); `.agents/core/USER.md:10-11` still
    says Moe's is an old name. The newer word wins; USER.md needs the fix (outside this PR's scope, flagged).
12. Privacy: 22, 23 and 25 printed vendor account and location numbers and one rep's name and mobile. This PR replaces
    them with [redacted]. The values remain in git history. None is a credential, so nothing needs rotating;
    Nour may want to tell the rep. Docs 27-30 already redact by rule.
13. Ohio framing: 07:7 and :11 present 2026-03-21 and the $50 floor as the rule; the repo's primary-text diff says
    the date was editorial and the phone path has no floor. The audit wins; 07 needs a (B) row.
14. Smaller stale lines: 22 "28 fields" (31 listed); 25:166 rows 27-32 (27-35); 14:8 "public pages only";
    13:30 and 13:64; 16 line refs and the env count; 23:13-16 rename sweep; 26 "rollup of 21-25" (covers 21-29).

## 4. Already built in nickstire

Wiring test: router key in `server/routers.ts` plus `git grep -lE "trpc\.<router>\." origin/main -- client/src`.

| Item | Receipt | State |
|---|---|---|
| Work orders (20 procedures) | `routers.ts:188`; 0 client callers | BUILT+UNWIRED |
| Estimate -> work order | `server/routers/estimates.ts` generate, convertToWorkOrder; 0 callers | BUILT+UNWIRED |
| Dispatch (bays, assign, clock, QC, comebacks) | `routers.ts:189`; `dispatch.ts` exposes 34 procedures, client calls track, expectedArrivals, phoneTireDemandToday | 3 WIRED, 31 UNWIRED |
| Staff inspection side (create, addItem, publish, photo) | `server/routers/services.ts`; no client caller | BUILT+UNWIRED |
| Customer inspection link | `App.tsx:382`; `InspectionReport.tsx` byToken, decideItem | BUILT+WIRED |
| Line defaults: order `approved`, line approved true | `workOrderService.ts:141,179`; `schema.ts:2321` | BUILT, wrong for Ohio |
| 10% re-approval gate, staff provisioning, checkout permission | greps exit 1 | MISSING |
| D&K tire search, markup, public /tires | `routers.ts:175`; 6 client files; `App.tsx:189` | BUILT+WIRED |
| D&K supplier order, cutoff read | `routers.ts:179`; `GatewayOrderPanel.tsx`; writes env-gated | BUILT+WIRED |
| Text me this quote | `routers.ts:183`; no status lifecycle | BUILT+WIRED |
| Ask assistant, approval queue | `routers.ts:194`; `server/services/proposals.ts:116` | BUILT+WIRED |
| Customer360, Ctrl+K search, /portal | `pages/admin/customers/Customer360Panel.tsx`; `CommandSearch.tsx:742`; `App.tsx:414,390` | BUILT+WIRED |
| /pay | lookup and call-to-pay wired (`PayInvoice.tsx:36,41`); online checkout unwired: `createPaymentIntent` and `confirmPayment` (`payments.ts:92`) have no client caller, the page says "Online payment coming soon" (`PayInvoice.tsx:186`) | WIRED lookup, UNWIRED checkout |
| Roles, MFA gate, audit_log | `shared/adminPermissions.ts`; `adminSecurity.ts:26`; `schema.ts:2768` | BUILT+WIRED (MFA off by default) |
| Declined-work recovery lane | `server/cron/index.ts:665`; `RevenueSection.tsx:15` | BUILT+WIRED (ALG estimates only) |
| Counter decline tap | `server/routers/advanced/invoices.ts:838`; no reason field | BUILT+WIRED (0132 applied, `truth_os.md:350`; row use U) |
| Tire registrations (TIN capture) | `schema.ts:2358`; `server/services/tireRegistration.ts`; client grep empty | BUILT+UNWIRED |
| Service reminders, lot plate visits | `schema.ts:765,4726`; `retentionSequences.ts`, `admin/lot/plainWords.ts` | BUILT+WIRED |
| ALG mirror (headers; parts, labor, tax written 0) | `shopDriverMirror.ts:579-584`; probes `algProbeBudget.ts:12-18` | BUILT+WIRED, lossy by design |
| Google Sheet push on work-order create | `workOrderService.ts:171` | BUILT; must be off for /system |
| Supplier-offer contract, sourcing router | drafts PR 3568, 3571; not on main | MISSING on main |
| Quote entity, ShopIdentity, scoped price rules, JobKit | docs-only grep hits | MISSING |
| /system routes, settings history, ALG labor client | client grep exit 1; `schema.ts:1186` updatedBy only | MISSING |
| Tables with no screen (technicians, bays, time clock, payments, inventory) | `schema.ts:966-3020`; customer_vehicles is surfaced at /my-garage (`MyGaragePage.tsx:215`, add/delete wired) and is not in this list | BUILT schema; rows U |

## 5. Open owner decisions

| Decision | Blocks | Default |
|---|---|---|
| Ledger: buy the core or build it (05 day 13-14; 15 a3 asks if the bake-off is still on) | everything past the quote screen | 05: buy the core, build the brain; evidence decides |
| Is the D&K login-based client an approved path (new, section 3 item 6) | reusing D&K in /system | portal handoff until D&K confirms |
| PR 3568 or 3571 as the sourcing contract | plan tasks 1-3 | not stated; pick one, close the other |
| PartsTech terms in writing (06:72) | any aggregator | do not sign up |
| Crew roles and logins (09:80, 09:83) | first crew login | Mash and Manny front_desk + checkout; Zach tech |
| Daytime ALG probes during the parallel run (15 a5, 17 rule 9) | counter logouts | log every login per hour, then decide |
| Per-ticket ALG import vs SHOP-PROTECT (30:98) | parts/labor history | none; operator decision with a price |
| Google Sheets ruling (15 a1) | sheet sync off or on for /system | reports yes, customer rows no |
| Owner-away matrix, bays count, deploy window (15 e2, c1, e1) | approvals, per-bay metrics, merges | 6-row table; ask; merge outside open hours |
| Gateway 100% markup intended; the $10 and $1 lines (22:165, 22:55) | price rules, fee model | keep 100%; ask Gateway |
| Vendor emails and rep questions (06, 24:279) | capability sheets | not sent |

## 6. Recommendation for the one concrete plan

1. Screens in order: /system/quote (tires first, D&K live), then the estimate screen with per-line pending and the 10%
   gate, then /approve/:token on the inspection link, then the board and the tech screen.
2. Before the first screen: flip the two approved defaults, turn the Sheet push off for /system, add a Quote status
   (open, contacted, converted, closed) and a decline reason with competitor and price.
3. ALG stays the ledger through the parallel run: at least until the day 13-14 call plus 30 days of side-by-side.
   No per-ticket pulls; keep the 3 AM and 8 PM syncs; count logins per shop hour first.
4. First thing that makes money: quote follow-up. Every tire quote becomes a Quote row; unconverted quotes and
   counter declines feed the declined-work lane that already sends. This reuses 3 built pieces.
5. Kill criterion: if /system/quote is not faster than ALG plus the D&K portal by at least 20% (doc 18 stage 3) in
   the crew's timed tests over 2 weeks, or any money or approval record is wrong once, stop building screens and
   keep ALG plus the existing admin.
