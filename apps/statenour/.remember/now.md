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

**Next action (operator-gated):** the invoice→task bridge import — dollar term is armed but
mute (live: 0 $-titles, 0 overdue open tasks; the overdue invoices are nickstire/ALG data and
never enter this DB). Natural entry: `lib/ai/tools/tasks.ts` follow-up writer (hard-codes
roiScore 70 — fix it when the import lands). Until then "hydration vs $846" cannot be a real
statenour ranking contest.
