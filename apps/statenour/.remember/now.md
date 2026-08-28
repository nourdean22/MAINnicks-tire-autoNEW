# Session ledger — statenour

**Updated:** 2026-08-27 (Now-card scorer + run-to-empty session)

**Objective:** real ranking for the homepage Now card — measure first, transparent additive
scorer, no bandit (operator constraint, label budget single digits).

**Shipped this session (verified by content on origin/main + `/api/version`):**
#1936 ledger reconcile (#1926 entry + actualMinutes CORRECTION) · #1946 Now-card scorer —
`NOW_WEIGHTS` block (roi demoted 0.35→0.15; due/staleness/dollar/class terms), habit guards on
every focus arm, surfaces compute scores FRESH per request (P1 review fix: stored autoPriority
is never consulted by buildNextMove), one-line explanations, canary with positive control.
Deployed `691e01a9a`. Operator-authorized seeder: 102/102 AutomationPolicy rows upserted,
`check:policy-coverage` green repo-wide (was red since #1901); backup
`_bak_automation_policies_seed_20260827` (165 rows) kept until confirmed good.

**Before/after (the product):** old chain top-4 = four DAILY habits at hand-constant roi 70,
focus pick "Drink water — 6+ bottles"; deployed scorer = every business task above every habit,
focus "drop off signs — picked because: untouched 42d · roi 55", stable under both
mission-term bounds. 0 habits above the first business task (was 3).

**Last decision:** no acceptance-history term in the scorer — measured labels are 9–19 rows
per source; per the operator's anti-bandit steer that budget fits representative selection,
not learned weights. Weakest/quick lanes deliberately still admit habits.

**Blocker:** none code-side.

**Next action:** NONE code-side — the revenue-urgency fork is CLOSED. Measured 2026-08-28:
`invoices.paymentStatus` is structurally unreliable (defaults 'paid'; the ShopDriver sync
CAN write pending — shopdriver.ts:638/661/672/908 — but 0 of ~2,900 shopdriver rows are
non-paid: the feed marks everything paid; the "overdue" pool = 2 self-billed on 216-848-8888
+ 3 test rows + 3 unverifiable, all hand-entered). Operator picked lane (b): hand-curated collect tasks via Nick chat — shipped
#1967, the follow-up writer's roiScore 70 → 50 so collect tasks rank on terms ($-note +
dueDate + staleness). Do NOT build a paymentStatus importer; do NOT seed the 3 unverifiable
candidates. The operator curates: one chat line per invoice he trusts from his register.
