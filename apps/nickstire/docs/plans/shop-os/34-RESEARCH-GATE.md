# Shop OS 34: research gate (2026-11-07)

Answer first: of the 21 claims in the Perplexity Deep Research report Nour pasted on 2026-11-07 ("Shop OS 33:
Earn More, Interrupt Less", 208 sources, repo pinned at 68c057f186), 12 are already in docs 07, 31 or 32, 7 are
small additions now folded into doc 32, and 2 are refuted or corrected. The one finding that changes a rule: "no
ALG write" is a rule for the CRM, not a repo-wide fact, because the Stripe refund writeback already posts to
ShopDriver (row 6). The four supplier reports (ChatGPT audit, Supplier Intelligence Report, Compare Suppliers Gap
Review, ChatGPT 10 gaps) are gated separately in doc 35 by the supplier-compare session, against PR 3571.

Method: `plan-gate` (re-verify the report's own facts first, then UPSTREAMS, CURRENT-TRUTH, git log, memory).
Verdicts: BUILT = in code or already in the plan with a receipt; NEW = folded into doc 32 this PR; WATCH = real
value, missing prerequisite, revisit trigger named; REFUTED = the code contradicts it; CLAIM = external fact not
read on a primary page this pass.

Ruling after this doc was written (Nour, 2026-11-07 13:30Z): the ledger is BUILT, not bought; ALG is the model to
beat, not the system of record. Doc 32 s.1 and its phase table are superseded by doc 37; rows here that assume
ALG stays (board freshness, daytime probes, the mirror as source) are history, kept as the research receipt.

## 1. Claim by claim

| # | Report claim | Verdict | Receipt and what changed |
|---|---|---|---|
| 1 | Shop OS should be two internal surfaces (Today, Visit) plus one customer link, not six daily apps; the bay TV is a read-only render of Today | NEW (pattern) | doc 32 s.2 keeps six screens as the build units; they now ship as sections of two routes, Today (screens 1-3) and Visit (4-6 from a ticket). Ruling by the manager, reversible: it removes navigation, not scope |
| 2 | A live shop-owned visit record independent of the ALG mirror, with arrival, readiness, blocker, owner and completion events | BUILT + NEW | the board already writes work-order state on the built tables, not the mirror (doc 32 s.2 screen 2; doc 31 item 3). New: a physical `arrivedAt` apart from the expected arrival, and one blocker owner per car (s.2 screen 2 row) |
| 3 | Fix authorization semantics before any screen: work orders and lines default to approved | BUILT | doc 31 item 4; doc 32 phase 0 flips both defaults and adds the 10% gate (`workOrderService.ts:141,179`, `schema.ts:2321`) |
| 4 | Versioned estimate plus an immutable authorization event (scope, actor, method, time); telephone revisions recorded | BUILT + NEW | screen 6 freezes the estimate lines (doc 32 s.2); new wording in phase 0: the 10% gate compares every revision to the originally authorized estimate, never the latest one |
| 5 | Give recommendations a persistent identity from inspection to estimate, decline, recovery text and later invoice | NEW | doc 31 says inspection declines never enter recovery; doc 32 phase 4 has `DeclineReason` only. Screen 5 found-work lines now carry a recommendation id that `DeclineReason` and the recovery lane keep to the invoice |
| 6 | "ALG is read-only" is an intention, not a repo-wide invariant: the refund service contains a ShopDriver writeback | REFUTED (rule 1 as written) | FACT: `server/services/refundWriteback.ts` posts to the ShopDriver ticket refund endpoint; called from the Stripe webhook (`server/_core/index.ts:1034`) and the admin refund (`server/routers/advanced/invoices.ts:1238`); tests `__tests__/refundWriteback.test.ts`, `triggerRefund.test.ts`. Whether it fires in production: UNKNOWN until a log read. Rule 1 now says the CRM adds no ALG write and names this one existing writer, inventoried and never extended |
| 7 | Measure paid contribution, minutes saved, displacement, refunds and comebacks, never activity (taps, replies, opens) | BUILT + NEW | doc 32 s.4 reads are quote-to-invoice and repeat rates (doc 17). New line in s.4: taps, replies and opens alone never keep a phase alive |
| 8 | First seven days: pin the deployed commit, inventory every writer (invoices, payments, refunds, supplier orders, sends), trace one visit, observe interruptions | NEW (partly) | phase 0 gains the writer inventory (receipt: this doc, row 6, plus the supplier order gate in `gatewayClient.ts` and the SMS send boundary). The interruption observation is doc 32 s.4's baseline read, already required |
| 9 | 14 to 90 day roadmap: one live loop, then receiving, quote recovery, versioned approval, exception brief, then decide what to own | BUILT | the same order as doc 32 phases 1-4 (read, quote, source, yes) with the kill reads of s.4 |
| 10 | Keep the transaction-system bake-off (ALG + overlay vs one full system such as Tekmetric, from $179/mo CLAIM, or Shopmonkey) | WATCH | doc 32 decision 0 already holds buy-or-build; the bake-off runs only if phase 1 measures ALG duplication the crew feels, in minutes. Price and API limits are CLAIM until a written quote |
| 11 | Deletion candidates: Google Sheet push, zero fallbacks for price or stock, duplicate queues, unused API procedures, separate holdout framework | BUILT | phase 0 turns the Sheet push off for `/system` and makes the adapter return UNKNOWN (`gatewayClient.ts:251`); `contactExperiment.ts` is the one holdout system; dispatch exposes only what the loop needs (doc 32 s.5) |
| 12 | Ohio: face-to-face intake above $50, disclosures, five-day binding quotation; do not make one simplified 10% rule the whole design, and never let percentage logic reset the original estimate | BUILT + NEW | doc 07 rows 11, 12, 15, 27 carry the rule text (OAC 109:4-3-13, read 2026-10-26). New: the never-reset wording in phase 0 (row 4). Counsel review of the templates is Nour's call |
| 13 | A household phone can carry several customers and vehicles; no phone-only merge | NEW | doc 32 rule 9: a phone number is not a customer |
| 14 | Tire registration obligations are not the same as storing a TIN | BUILT | doc 07 TIN registration row (`schema.ts:2358`, doc 31 row 07) |
| 15 | Public repository history may still hold exposed account information | BUILT (known) | memory `security-public-repo-credential-leak` 2026-10-19; not a CRM item |
| 16 | Owner-away operating exercise before declaring adoption | NEW | doc 32 s.4 phase 4 read: one shop day run by the crew with Nour off the counter |
| 17 | Do not build: a second ledger, a generic CRM, a second SMS platform, predictive wait times, an optimization engine, AI diagnosis or urgency, a loyalty program, appointment slots, a general procurement or payroll system | BUILT + NEW | doc 32 s.8 had scheduling, a second ticket system, inventory, payroll, the local AI node and the copilot; it now also names AI-written diagnosis or urgency, predictive wait times, a loyalty program and a second SMS platform |
| 18 | Work-order service, dispatch (3 of 34 wired), staff inspection and `/inspection/:token` are the reuse base | BUILT | doc 31 item 3 and doc 32 s.5, same receipts |
| 19 | The expected-arrival reconciliation and attribution services exist but their precision is unknown | BUILT (as stated) | `revenueAttribution.ts` and the arrival-to-invoice matching are in code; precision is read in doc 32 s.4, not assumed |
| 20 | Supplier offer normalization: preserve both parked drafts, choose by fixtures and account tests | BUILT | doc 32 s.5 last row says the same; doc 35 gates the four supplier reports against PR 3571 |
| 21 | Report labels: proposed, built, wired, tested, deployed, operationally verified, financially proven | BUILT | the kernel's state ladder (`docs/agent-os/NOUR-RUNTIME-KERNEL.md`) and doc 31's labels already separate these |

Percent: 12 of 21 built or already planned, 7 folded in as small additions, 2 refuted or corrected (rows 6 and
1's "six apps" reading). No new table, screen, service or dependency comes out of this gate.

## 2. What doc 32 changed in this PR

1. Rule 1 names the one existing ALG writer (row 6) and scopes "no ALG write" to the CRM build.
2. Phase 0 gains the writer inventory and the never-reset 10% wording (rows 4, 8, 12).
3. Screens 2 and 5 carry `arrivedAt` plus a blocker owner, and a persistent recommendation id (rows 2, 5).
4. s.2 says the six screens ship as two routes, Today and Visit (row 1).
5. s.4 adds the paid-outcome rule and the owner-away read; s.8 adds four more things not built (rows 7, 16, 17).
6. Rule 9: a phone number is not a customer (row 13). Decision 0 keeps the bake-off as a conditional (row 10).

## 3. Still owed from the report

- Row 6: one production read of whether the refund writeback has ever fired (Railway log or `cron_log`), on the
  next log read; until then its runtime state is UNKNOWN, not "dormant".
- Row 10: a written Tekmetric or Shopmonkey quote only if phase 1's minutes read says ALG duplication hurts.
- Row 12: Ohio counsel review of the intake and approval templates before phase 4 goes live (Nour's call, spend).
- The report's coder-ready work packages A to G (evidence lock, authorization repair, live visit, recommendation
  chain, supplier contract, financial reconciliation, interface consolidation) map onto phases 0 to 4 and are not
  copied; the phase rows are the spec.

Not checked this pass: the report's 208 sources beyond the repository claims above; its Tekmetric and Shopmonkey
statements stay CLAIM. live: not checked this turn.
