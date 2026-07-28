# Cron-truth audit · 2026-07-28 (adversarial sweep, dimension 1)

> **Epistemic key:** `[VERIFIED-runtime]` = read from prod Neon `cron_job_logs` / prod Railway env this date · `[VERIFIED-code]` = read in source · `[INFERRED]` = labeled reasoning, not proven.

## Finding 1 — the Inngest-scheduled fleet does not run (P0, operator decision required)

**Evidence chain:**

- 21 manifest-`active` crons have **zero `cron_job_logs` rows ever** `[VERIFIED-runtime]`. Most Inngest functions don't write CronJobLog by convention, so that alone proves little — but:
- **`briefing_log` is EMPTY — zero rows ever** `[VERIFIED-runtime]`. `intelligence-daily-brief` (10:15 UTC daily) writes it **unconditionally** on every completion. It has therefore **never completed once**.
- Every jobName that DOES log (38 in the 7-day census) traces to a mega fan-out child or a worker job `[VERIFIED-runtime + code]`.
- The megas themselves ARE fired by Inngest: `INNGEST_MEGA_V2=true` in prod `[VERIFIED-runtime]`, and the observed failure fingerprint (nameless `"timeout ; timeout"`) matches the Inngest composer's output, not the legacy route's structured detail `[VERIFIED-code]`.

**Conclusion `[INFERRED, high confidence]`:** Inngest Cloud invokes the mega functions but none of the other ~16 cron-triggered functions — **function-set drift**: Railway has no Inngest deploy-sync hook, so functions added/renamed after the last manual PUT sync are invisible to the Cloud app. Alternative (registered-but-failing-preflight) is disfavored: `onInngestFailure` → Telegram would have paged the operator hourly.

**What is silently not happening** (each `mode:"active"` in the manifest, each Inngest-only scheduled):
`operator-morning-brief` (daily 10:00) · `proactive-push-cron` (hourly) · `approval-sweeper` (*/5 — **the durability backstop for approved tool execution, incl. real customer SMS**) · `cron-heartbeat` (**the watchdog built after the 2026-05-30 fan-out outage — the postmortem's exact blind spot is back**) · `diagnose-cron-failure` (*/4h) · `goal-pruner` · `goal-drift-detector` · `journal-convergence-scan` · `journal-thread-dormancy` · `industry-pull` · `intelligence-daily-brief` · `intelligence-weekly-brief` · `customer-preferences-recompute` · `crm-weekly-followups` · `content-performance-weekly` · `audit-todays-leads`.

**The fix is one operator action, deliberately NOT executed by this audit:** re-sync the app (`curl -X PUT https://bdnick.info/api/inngest` with the signing key, or "Sync" in the Inngest dashboard) — **and know the blast radius: all 16 start firing**, including hourly proactive pushes, daily briefs, and the approval sweeper (its 48h age-floor + `expiresAt` bounds limit resurrection risk `[VERIFIED-code]`). Recommendation: sync during waking hours and watch the first cycle. Longer-term: add a deploy-time sync step so drift can't recur, and extend `cron-heartbeat` to cover the Inngest-only tier (its own header names this as future work — this incident is that future).

**Also:** `check:crons` [6/6] "active must be reachable from the fan-out" did not catch 16 unreachable actives — it validates against `jobs.ts` + filesystem, not against function-level Inngest triggers' *deliverability*. A manifest can therefore claim `active` for a function no scheduler will ever invoke.

## Finding 2 — mega-evening logs `partial` every night, and the error names nobody (FIXED this PR)

Seven consecutive nights `[VERIFIED-runtime]`: `mega-evening | partial | "The operation was aborted due to timeout ; The operation was aborted due to timeout"`. Two children exceed `dispatchChild`'s 90s abort **every night** — but `summarizeSettled` kept only `reason.message`, discarding which children `[VERIFIED-code]`. The likely pair — `consolidate` (logs until ~03:23) and `mastery-xp` (~03:17) `[INFERRED from child log timestamps]` — keep running server-side after the parent aborts its await, and complete: the "partial" is a **parent-visibility artifact, nightly noise, normalized failure**.

**Fixed here:** failures now carry the index-aligned child path (`/api/cron/<name>: <message>`), test-pinned. The next nightly partial names its culprits; THEN decide whether to raise the per-child ceiling for the named pair or accept-and-silence. (Timeout policy deliberately unchanged — that's a measurement-informed operator call, not a truth fix.)

## Corrections to this audit's own first pass

- Initial classifier counted `partial` as failure and reported "7 fails / lastSuccess NEVER" for mega-evening — the status vocabulary is success/partial/failed; the honest phrase is "partial nightly."
- "NEVER_LOGGED = dead" was wrong as a rule (logging is opt-in per route); it took the unconditional-side-effect probe (`briefing_log`) to make the death claim properly.

## Not yet covered (later loop iterations)

Dimensions 2-6 of the sweep: invented numbers on operator surfaces · dead wiring · prompt self-contradictions · cannot-fail checks · auth gates.
