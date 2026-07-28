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

## Finding 1 update — SYNCED (operator-authorized, 2026-07-28 ~13:20 UTC)

`curl -X PUT https://bdnick.info/api/inngest` → `{"message":"Successfully registered","modified":true}` `[VERIFIED-runtime]` — **`modified:true` is the drift hypothesis confirmed by its own fix**: the Cloud manifest changed on sync. All 16 functions now registered. Watch plan: hourly `proactive-push` (first fire next :00) · `diagnose-cron-failure` 16:00 UTC · `cron-heartbeat` 12:00 UTC tomorrow · **`briefing_log` must gain its first-ever row after 10:15 UTC tomorrow** — that row is the definitive all-clear. Still open: add a deploy-time sync step so drift can't recur; extend the heartbeat to the Inngest-only tier.

## Dimension 2 (partial) — morning-brief surface, audited before its maiden delivery

- **Composer (`lib/services/morning-brief.ts`): CLEAN** on the invented-numbers axis — fully data-driven, null-guarded sections, revenue target rendered only when the payload carries one `[VERIFIED-code]`.
- **Fixed: push body showed raw HTML.** The composer emits `<b>…</b>`; the audio path strips tags, the push path didn't — caught the day before the function's first-ever delivery. `pushBodyFromBrief()` strips-then-slices (a slice-first could cut a tag in half), test-pinned.
- `compose-daily-brief.ts` (intelligence brief): grounding rule verified earlier this session — absolute, "no signal today" fallback, never invent.

## Dimension 6 — auth gates (DONE)

Ran the repo's own `check-sensitive-get-auth` (which was **not wired into any gate**): 4 flagged. Adversarial verification split them:

- **1 genuinely open** `[VERIFIED-code]`: `system/mission-surface-stats` GET dumped 14 days of telemetry with no gate → `requireSession` added.
- **3 checker blind spots**, each verified gated at source: `suggestion-loop-stats` used `await auth()` (route standardized to canonical `requireSession` — its header's "NextAuth-gated" claim was TRUE, my earlier read of the checker output was the false alarm); `brain/by-url` uses the chrome-extension bearer `validateToken` (signal added to the checker — converting would break the extension); `brain/wisdom` hides auth inside a `withTracing(handler)` wrapper (checker now resolves wrapped identifiers and scans the referenced function's scoped body — still not a file-level grep, PATCH-only auth still fails GET).
- **Gate wired**: `check:get-auth` added to `verify:hard`. Post-fix run: **✓ all 180 sensitive GET handlers have auth**.

Lesson (same class as nickstire's day): a checker that exists but isn't in the gate, with blind spots nobody measured, protects nothing — the guard needed its own audit.

## Dimension 5 — cannot-fail checks (DONE)

Swept every `check:*` script in the `verify:hard` chain for a reachable failure path. Two suspects **exonerated on precise read** (`scan-prompt-injection`, `scan-secrets` — ternary exits the count-grep missed; severity-tiered by design). One confirmed: **`audit-deps.ts` exited 0 unconditionally** — self-described "a reporter, not a gate" while sitting inside the gate chain (the nickstire "blocking dep gate had never executed" class). Fixed: **CRITICAL advisories now fail the gate**, HIGH stays advisory (reddening pushes on upstream noise is the exact 2026-07-25 dependency-PR pain), `--advisory` preserves reporter mode for cron. Validated against live deps: today's known HIGHs (brace-expansion) → exit 0; a critical → exit 1.

## Dimension 3 — dead wiring (bounded probe, CLEAN)

Probed the historic write-only class at its most famous addresses: **spar-mode is WIRED** (3 importers — the master plan's "ships in every deploy, never injected" finding was fixed since) and every operator-rule absolute **is injected** via `getOperatorPolicyLines()` — my per-export importer-grep initially claimed `DO_NOT_AUTO_TASKIFY` orphaned and was **refuted by the composer pattern** (name-greps miss wiring idioms — third false-positive shape this sweep). The one un-injected export (`BROADEN_AND_SUGGEST`) is deliberate, documented archaeology. Scope label: bounded probe, not an exhaustive zero-importer census.

## Dimension 4 — prompt self-contradictions (policy layer, CLEAN)

All 9 absolute directives in `lib/ai/prompt/policy/` checked pairwise against the prompt lib: coherent. The one apparent tension — "Never cite verbatim" (brain wisdom) vs "Cite driveViewUrl when quoting" (Drive docs) — resolves as different objects. `TRUTH_RULE_NEVER_FABRICATE` (past-tense claims require tool calls) is the strongest directive in the file and matches this audit's own doctrine. Scope label: policy layer + spot-checked static sections; the full 65K composite was not exhaustively pairwise-checked.

## Dimension 2 remainder — pulse · scoreboard (CLEAN)

`meta-scoreboard.ts` (341 lines) + pulse/intelligence surfaces: zero hits on every invented-number signature class (assumed rates, hardcoded targets, "industry standard" citations, fraction-as-percent). Combined with the brief composer's data-driven nulls and `compose-daily-brief`'s absolute grounding rule, the operator-number surfaces pass.

## Sweep closing state

Six dimensions, six source-verified verdicts: **2 P-level defects found and fixed** (Inngest fleet dead → synced live; audit-deps cannot-fail → criticals gate), **4 secondary fixes** (mega failure identity, brief HTML push, mission-surface-stats gate, checker blind spots + verify:hard wiring), **3 self-refutations recorded** (partial≠failed, NEVER_LOGGED≠dead, composer-injection vs name-grep). Bounded scopes are labeled where bounded. Follow-ups owned by runtime: `briefing_log` first row after 2026-07-29 10:15 UTC · named timeout culprits in the next mega-evening partial · heartbeat's first watch 12:00 UTC.
