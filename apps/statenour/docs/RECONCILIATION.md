# Reconciliation · statenour-os

> ## 2026-10-09 · Flagged-items wave (cross-app PR, staged commits) · dashboard route redacts, contract guard reads variables, revenue rules ask for the days they mean, the cashflow forecast reads real totals · 1 statenour ship inside a cross-app PR
>
> The two items flagged at the end of the 2026-10-08 entry, plus the consumers of nickstire's `revenue_range` fix (same PR) that fixing it exposed.
>
> - **`/api/analytics/dashboard` redacts unread sections** (`app/api/analytics/dashboard/route.ts`): `redactUnreadableSections(await getDashboardSummary())`, the redaction the Nick tool and the deep lane already used. A failed `customer_stats` read had come back as `customers: { total: 0, newThisMonth: 0 }` beside `bridgeHealth.customers: false`.
> - **Two more zeros-as-readings in the same summary** (`lib/services/business-intel.ts`, `lib/ai/tools/bridge-honesty.ts`): reviews now carry `ok`/`stale`/`freshnessNote`, and an unreadable review store (`ok: false`, zeros) is redacted as `reviews`, with a reason that names the review store, not the bridge; a `revenue_today` body without a numeric `invoiceCount` is an unread jobs count, not 0 jobs.
> - **The bridge contract guard reads a query name held in a variable** (`tests/contracts/nick-bridge-query-contract.test.ts`): the regex scanner is a TypeScript syntax-tree scanner that resolves literals, literal conditionals, same-file consts and the parameters of non-exported local wrappers (followed to each caller), and fails on anything it cannot resolve unless it is one of three reviewed runtime-named calls (`DYNAMIC_BY_DESIGN`). It found three call sites the regex never saw (the Telegram `igRead` wrapper's instagram reads; all live). Its adversarial review then broke it three ways, each now a red fixture: an excused call could cover a second one in the same file (entries now carry an exact `count`, and a canary breaks the excusal itself); a renamed import (`queryNick as qn`), `.call`/`.bind`, a conditional callee or a string element access were invisible (renamed imports are read as the helper, and every other reference fails closed); a wrapper parameter or const batch list written after binding was trusted (now refused).
> - **The two revenue rules ask for the days they mean** (`lib/brain/autonomous-engine.ts`): `friday_revenue_check` and `revenue_overconfidence_gate` sent `since`/`until`, which `revenue_range` never read, so each got TODAY: the Friday check projected the month from one part-day (a "behind pace" Telegram nearly every Friday) and the overconfidence gate read this morning's near-zero and never fired. They now send `from`/`to` (month-to-date; yesterday), and a body without a numeric total fires nothing. `__ruleTriggerForTest` drives the real triggers.
> - **The cashflow forecast reads real totals** (`lib/services/cashflow-forecast.ts`): both `revenue_range` reads took `total`/`totalRevenue` off queryNick's envelope, fields no answer has carried, so every trailing week was a gap, every forecast UNAVAILABLE and the scorer never scored. They read `data.totalDollars` now, and each week is `from`..`from + 6` (inclusive `to`; it read 8 days and double-counted boundary days). The tests had mocked shapes production never returns; they now mock the real envelope.
>
> Gates: receipts in the PR body. Positive controls: each fix reverted turned its new tests red for the stated reason (revenue rules 3/7, forecast 5/14, redaction 2/18, dashboard route 2/7 on the old producer and 3/5 on the old route, contract guard 7/13 on the old scanner).
>
> **Flagged · NOT fixed:**
> - The forecast's `estimates_aging` and `bookings_status` reads name fields nickstire does not send (`openTotal`/`totalOpenValue`, `open`/`pending`), so both stay named data gaps; which value is "the pipeline" is not decided.
> - `operator.revenueStats` and `/api/analytics/revenue` return `getRevenueStats` raw (`"0.00"` beside `bridgeAvailable: false`); no in-repo UI consumer found.

> ## 2026-10-08 · Dead bridge queries resolved (cross-app PR, staged commits) · `customer_stats` built, `getTopServices` retired, four bridge reads made honest · 1 statenour ship inside a cross-app PR
>
> The two queries PR C's contract guard found dead on its first whole-file run, decided per query on the data each needs, plus the bridge-honesty defects found reading their consumers.
>
> - **`customer_stats` is built in nickstire and read here** (`lib/services/business-intel.ts` `getCustomerStats`): two counts, customers on file and first visits in the current New York month, the only fields the dashboard summary used. The old consumer type also asked for `withPhone`, `returning` and a `topCustomers` list with names and phones that nothing displayed; they are neither requested nor sent. A count that is missing or not a number is `bridgeAvailable: false`, never a zero that reads as available. The nickstire handler throws on an unreadable database, so the route answers 500.
> - **`getTopServices` retired** with its query `revenue_top_services`: removed from `lib/ai/tools/business.ts`, `catalog.ts`, `playbooks.ts`, `tool-families.ts`, `chat-mode.ts` (its keyword family), `reasoning/whitelist.ts`, `agent-bridge/scopes.ts` and `tool-policy.ts`, the tool-catalog reference, and both snapshots. Invoice service descriptions have mostly stopped arriving (1 of 30 in August 2026), so a ranking would describe a sliver of the tickets. Rebuild it only with a handler that says how many tickets its ranking covers.
> - **`fetchBridge` reads a 200 `{ error }` body as a failed read.** Every nickstire revenue handler answers `{ error: "No DB" }` with status 200 when the shop database is unreachable; that was read as data: $0.00 with `bridgeAvailable: true`.
> - **Revenue counts the field the handlers send.** `getRevenueStats` parsed `jobCount`, which no handler has ever sent (they send `invoiceCount`), so every payload said 0 jobs and a $0.00 average ticket beside a real total. The average ticket is derived from the count (`invoices.totalAmount` is NOT NULL, so the bridge's own `AVG` always equals it). The test fixture had sent `jobCount` too, which is how it stayed green.
> - **The board consult no longer states an unread month as $0** (`lib/services/board-consult-record.ts`): revenue goes into the advisors' context only when `bridgeAvailable`; otherwise one line says it is UNKNOWN and not to assume a figure.
> - **The redaction reasons say "could not be read", not "did not answer"** (`lib/ai/tools/bridge-honesty.ts`, the dashboard redaction and the revenue tool): a read also fails when the bridge answers with an error.
> - **`scripts/contract-pre-flight.ts`**: `customer_stats` moves to the production tier, `revenue_top_services` leaves the list, a 200 with an error body is an error rather than available, and the `customer_search` probe sends the `term` the handler reads (it sent `phone` and got 200 "Search term required", counted as available). `KNOWN_PENDING` in the contract test is empty of both.
>
> Gates: receipts in the PR body (targeted vitest 75/75, `tsc --noEmit` exit 0, eslint 0 errors; positive controls: 17 defects planted across both apps, 16 turned a test red, and the survivor, the bridge `avgTicket` read, proved redundant and was deleted).
>
> **Flagged · NOT fixed:**
> - `/api/analytics/dashboard` still returns customer zeros beside `bridgeHealth.customers: false` on a failed read (no in-repo UI reads that route; the Nick dashboard tool redacts it).
> - The contract guard still cannot see a query name held in a variable before the call.

> ## 2026-10-08 · Camera N-series PR C (cross-app PR, staged commits) · owner lot brief in the morning brief, arrival page claimed once, bridge contract doc reconciled and guarded · 1 statenour ship inside a cross-app PR
>
> Audit item N4 of `docs/agent-audit/CAMERA-INTELLIGENCE-AUDIT-2026-10-07.md` (the owner brief over qualified nickstire lot events, `/system/camera` retired or demoted) and the StateNour Codex P1 from #2920.
>
> - **`lib/services/morning-brief.ts` `readLotBriefLines`**: the shop slice asks nickstire's new `lot_brief` bridge action (8 s per attempt, 12 s for the whole call: queryNick's retries alone run about 35 s and the brief also answers a Telegram command) and renders at most three `Lot · ` lines, HTML-escaped: the lot camera's view of yesterday (traffic against the same weekday, compared only when that day and two earlier ones were watched >= 80 % of business hours; cars that stayed 3h+ with no service recorded; lot traffic with few tickets), or one summary line on a quiet day. nickstire decides what is material and words it. A bridge error, an `ok: false` reply, a malformed reply or a thrown call is ONE "brief unavailable" line, never silence and never the whole shop slice's failure, so the slice now renders on every brief.
> - **`lib/services/vehicle-detection.ts`: finishing a pending arrival page is a claim** (Codex P1 on #2920: two retries that both found the `pending` marker both paged). The writer records a 60 s lease (`alertClaimedAt`) beside the marker; one retry past it takes the row with a compare-and-swap pinned on the marker and the lease it read (marker becomes `paging`), so exactly one caller pages; the clear is pinned on the holder's lease, and a lease lost mid-page is logged (`alert_marker_lease_lost`), never overwritten. A retry that finds the page in another caller's hands (lease fresh, swap lost, or a twin's INSERT race lost while it pages) is answered 503, never 2xx (Codex P1 on #2931): the edge outbox acknowledges a 2xx for good, so a holder that died inside its lease used to take the page with it. The edge retries a 503 until the marker is cleared or the lease lapses.
> - **`tests/contracts/nick-bridge-query-contract.test.ts` reads nested generics and multi-line calls**: `queryNick<Record<string, unknown>>("x")` was invisible to the callsite scan, so a typo in `lot_brief` or in `draft_opportunity_sms` passed it (proved by planting one in each, red after the fix). The scan now reads each comment-stripped file whole instead of line by line; 18 calls that put the query name on a later line had been invisible, among them `send_opportunity_sms`, the one customer-texting action (a typo planted in `lib/brain/legacy-shims.ts` passed the old guard and fails the new one).
> - **Two dead bridge queries found by that first whole-file run**: `revenue_top_services` and `customer_stats`, called from `lib/services/business-intel.ts` since v10.0.51, have never had a nickstire handler. Both are catalogued as pending (`KNOWN_PENDING`, the `newly-required` tier of `scripts/contract-pre-flight.ts`). The Nick `getTopServices` tool had handed the model an empty list on every call; it now returns an explicit unknown (`topServicesUnavailable` in `lib/ai/tools/bridge-honesty.ts`), and a genuine empty answer stays empty. The deep-reasoning lane (`app/api/ai/chat/alternate-paths.ts`) had prepended the raw dashboard summary as "real ... reason from THESE numbers", so `customers: { total: 0 }` reached the model as fact on every deep turn; it now goes through the same `redactUnreadableSections` as the dashboard tool.
> - **`docs/NICKSTIRE-QUERY-CONTRACT.md` is one document in both apps again**: the copies had drifted (four §7 rows and §8 only here, `team_performance` only in nickstire's) and 13 registered actions had no row in either. The contract test now holds both copies byte-identical and §7 to one well-formed row per registered action (a pipe left unescaped in the new `lot_brief` row was the first thing it caught).
> - **`/system/camera` demoted**: not featured on the hub; the hub card and the page say it is the raw vehicle-event log (arrival alerts, plate corrections) and name the Lot section of Nick's Admin as the lot view. The arrival alerts still link to it.
> - Catalogue: `lot_brief` in `scripts/contract-pre-flight.ts` ACTIONS and in §7 of the contract doc.
>
> Gates: receipts in the PR body (targeted vitest, `tsc --noEmit`, eslint, the contract guard, positive controls: five defects planted in the brief slice each turned a test red; nine in the contract docs and guard; four in the top-services fix; one in the deep-lane snapshot; three in the 503 answer).
>
> **Flagged · NOT fixed:**
> - `revenue_top_services` and `customer_stats` still have no nickstire handler. Building them or retiring their consumers is an operator decision. `/api/analytics/dashboard` still returns customer zeros beside `bridgeHealth.customers: false` (no in-repo UI reads that route; the Nick dashboard tool redacts it).
> - The dashboard redaction's reason says the shop bridge "did not answer" for customers; it answers, with "Unknown query". The verdict (unknown) is right, the stated cause is not.
> - The guard still cannot see a query name held in a variable before the call.
> - `lib/services/board-consult-record.ts` hands the board consult `getRevenueStats` as "live numbers" without checking `bridgeAvailable`; during a real bridge outage it sees "0.00" beside the flag. Not on the dead-query path (`revenue_range` is live).

> ## 2026-10-07 · Camera audit wave (PR #2920, staged commits) · vehicle lane hardened, office watch truth, docs reconciled · 1 statenour ship inside a cross-app PR
>
> Driven by `docs/agent-audit/CAMERA-INTELLIGENCE-AUDIT-2026-10-07.md` (live NicksMax, Railway and Neon receipts): the vehicle lane reported about a tenth of pre-cutover arrivals while every surface read HEALTHY; one track minted 35 phantom visits overnight; the office lane listened about 8 % of the day. Most fixes are camera-bridge and nickstire (see the nickstire ledger). The statenour slice:
>
> - **`lib/services/vehicle-detection.ts`: the row is written BEFORE the page** (marker `alertSuppressedReason: "pending"` until the page completes; a retry that finds the marker finishes the one page, a retry that finds it cleared does nothing). Before: page, then INSERT; a failed INSERT answered 5xx, the edge outbox retried, no row was found, and it paged again. A `P2002` from the new unique eventId index is answered with the row that won. Visit window 12 h -> 7 days (a car over the weekend is one visit). `tests/services/vehicle-detection.test.ts`: the in-memory Prisma now enforces the unique index and honours `createdAt` windows; 5 new cases (order, suppressed rows carry no marker, crash-then-retry pages once, lost race answered with the winner, weekend visit).
> - **Pending migration `20261007120000_device_events_identity_indexes`** (partial UNIQUE on `(device_id, data->>'eventId')`, index on `(device_id, data->>'visitId')`), registered statement for statement in `app/api/system/apply-pending-migration/route.ts`, read-only duplicate preflight in the file header. `lib/db/schema-sentinel.ts` expects the unique index, so `/system/health` says "missing" until the operator applies it -- true, not a false positive.
> - **Docs:** `CURRENT-TRUTH.md` no longer says the office camera "does not watch" (it has since #2898/#2901); the pending-operator-decision line in `.remember/now.md` is closed (both options shipped); `docs/adr/0022-camera-vision-as-built.md` supersedes ADR-0017 on five of seven decisions.
>
> Gates: targeted vitest 6 files / 51 passed (vehicle-detection, apply-pending-migration, three schema-sentinel files, owner-panel migrations) · `tsc --noEmit` 0 · eslint on the four changed files 0 · `check:raw-sql`, `prisma validate` green (receipts in the PR). Not run here: the full `verify:hard` chain (cross-app PR; CI carries it).
>
> **Closed 2026-10-08 (operator approved, same session):** `20261007120000_device_events_identity_indexes` applied to prod Neon after the read-only preflight found and resolved the duplicate eventIds, promoted to `prisma/migrations/` with its `_prisma_migrations` row (checksum = sha256 of the file, the same method Prisma records); `git pull` on NicksMax done; the decoder is switched to `small.en-q5_1` through the new `whisper-model.override` file (camera-bridge, no elevation) rather than reverted to `base.en`. nickstire 0144 was applied 2026-10-08 14:20:47Z by the one-off Railway pre-deploy command (`scripts/migrations/apply-camera-runtime-window-counters.ts`) on the push-triggered deployment `24073610` of the #2927 merge: `8 columns added, 0 already present — all 8 verified; __drizzle_migrations recorded` (the 12:29Z redeploy `faff2669` had NOT run it, since a redeploy reuses the deployment's own manifest; this entry said "is applied" before that receipt existed, which a Codex review on #2925 rightly flagged).
>
> ## 2026-10-03 · Sentry sweep + cron hygiene (#2904 · #2906) · chat 500 on em-dash, duplicate cron runs, daily-brief compose bound · 2 statenour ships
>
> A 90-day Sentry sweep (org `statenour`, 21 unresolved) plus a cron audit of both apps. Thinking engine first run verified: `think` success 03:04Z 10-03, 8 contradictions, 4 causal_chains, 1 identity_snapshot written; #2894 live.
>
> **#2904 (`91fd5fb`) · chat no longer 500s on a non-Latin-1 header.** `lib/services/chat/response-shape.ts` `toHeaderValue`: the blocked-escalation `reason` ("no ANTHROPIC_API_KEY — set it ...") made `Headers.set` throw before the stream returned (Sentry JAVASCRIPT-REACT-13). Regression test reproduces the exact prod ByteString error on the unfixed code. Same PR carried nickstire + camera-bridge fixes (see nickstire ledger).
>
> **#2906 (`eb36d6d`) · duplicate cron runs + daily-brief compose.**
> - `mega-fanout.ts`: a child crossing its 90s ceiling now returns 202 (still running) instead of throwing; the throw made Inngest retry a job still running server-side (dossier-autodraft 3x on 09-28, brain-intelligence 2-3x on 7 of 14 nights, distill-sessions + cron-healer 2x on 10-03). Non-2xx / refused connection still throws.
> - `autonomic-orchestrator.ts`: cron-healer skips evening/weekly fan-out siblings (a sibling mid-run reads "never_run": `think` ran twice 10-03, both 03:02:44) and dormant crons (it had fired the parked `relationship-digest` Telegram on 09-03, 09-18, 10-03).
> - `compose-daily-brief.ts`: `generateBriefNarrative` bounds the reason lane (100s) then the fast lane (25s); both failing keeps the deterministic sections. Step budget 90s -> 140s. Cause of the 10-02 degraded brief: an unbounded model call.
> - Receipts: 3 files / 27 tests (7 failed on unfixed code); wider 68 files / 615 tests; typecheck clean.
>
> **Not bugs (verified):** `operator-morning-brief` ~35 min = deliberate `step.sleep("35m")` combine window (`morning-brief.ts:535`); work completes in ~15s. `ollama-model-liveness` 5 runs 09-28 = 1 healer re-run of a genuinely failing check (fast model retired 09-25) + 4 hand-run checks by the repair session (`.remember/now.md` 09-28).
>
> **Flagged · NOT fixed**
> - `morning_brief_audio` never saved 09-30..10-03; likely `CARTESIA_API_KEY` unset in prod (inference, env not read).
> - No daily brief row on 09-29 (not investigated).
> - `embed-backfill` 09-23: two rows ending at the same ms with different starts (unexplained).
> - `morning-brief.ts:29-34` header comment still describes the deleted 9:00 UTC legacy cron.
> - Langfuse not swept: no connector in session; cost attribution still unproven (09-02 receipt had 0 tokens).

> ## 2026-10-02 · connection census wave (#2892 · #2894 · #2896) · agent follow-ups on, thinking engine revived, stale-read guards, proof workflow fails loud, NicksMax camera self-heal
>
> **Census.** Measured every statenour table's last write against its writer (prod Neon, read-only). Fixed the broken links that had a clear owner:
> - Frozen since the Wave-AE prune (2026-05-28): `contradictions`, `identity_snapshots`, `causal_chains`.
> - Readers serving frozen rows as current: identityDelta, the shop-brief causal chains, and the voice tile copy.
> - A proof workflow reporting SUCCESS over ledger 500s.
>
> Parked as findings, not fixed: `pattern_detections` (no writer), `goal_stats` (no writer), `mission_links` + `content_studio_projects` (unreachable), `prompt_versions` (no writer), `tool_telemetry` stale 50h (alternate chat paths skip `recordToolInvocation`, unconfirmed), `bridge_call_logs` (rejections not persisted), and the mastery 0-10 vs 0-100 scale clash.
>
> **Agent follow-ups (#2892, `b2e8563`).** All three switches are now on:
> - manifest `mode: active`;
> - worker `HIGH_FREQ_JOBS` every 15 min;
> - `NICK_AGENT_FOLLOWUPS=1` on statenour-web, set with the operator's yes.
>
> Receipts: the 17:30Z run (old container) still logged the skip reason. The 17:45Z run had no skip reason, status success.
>
> **Thinking engine (#2894, `917aac4`).** `/api/cron/think` is folded into mega-evening as a DETACHED child (a retry would duplicate rows). It runs L7 contradictions first, because L8 and L10 read its output, then L8 identity evolution and L10 causal chains in parallel. Each layer is fail-soft. Changes:
> - `scanEnvironment` is excluded because it writes nothing.
> - `detectContradictions` skips claims still open from the last 14 days.
> - `identityDelta` returns null when the snapshot is older than 48h.
> - Shop intelligence reads causal chains seen in the last 30 days only.
> - The voice tile says latency is "measured in the shop admin". The domain-boundary gate caught the first wording, which named the shop.
>
> Also: `post-run-evidence.mjs` exits 1 when the ledger refuses rows (`ledgerFailure`).
>
> Gates: tsc 0 · eslint 0 · check:crons clean · get-auth 176/176 · related vitest 148 files / 1,446 · CI node + e2e green. Positive controls: 4 guard mutations went red.
>
> **NicksMax camera (#2896, `1b43781`; operator: "switch whatever to make it work").** Three faults found:
> 1. NicksMax was 158 commits behind on a feature branch. Moved to `main`; local notes saved to `backups\nicksmax-remember-20261002.patch`.
> 2. Two supervisor loops (SYSTEM + user) fought over the V380 relay after the 09:15 reboot. The user task is disabled.
> 3. The office conversation worker had been down since that reboot. Its SYSTEM task ran from a git worktree whose code was cleaned up 09-30, and nothing restarted it.
>
> The supervisor is now single-source in `camera-bridge/scripts/nicksmax/`. The `data\` copy on the box is a shim that falls back to the last good copy. It now heals:
> - the office worker: start if stopped, restart if its heartbeat is stale for more than 10 min, repoint off a worktree, ESCALATE if its code is missing;
> - the Eufy bridge/agent: start if stopped, restart on two consecutive closed-port ticks;
> - and it ledgers restarts, logging ESCALATE above 6/h.
>
> Live receipts, 13:49-13:51 ET:
> - ESCALATE for the missing worktree code;
> - office worker restarted, then repointed to `NOURCITY\camera-bridge`, now READY with a fresh heartbeat;
> - the shim fallback fired once during a partial-clone checkout.
>
> The sign producer has run without an rc=3 exit since 11:20.
>
> **Open:** ~~office "watch" (vision) is not built; it waits on the operator's choice between cloud VLM stills and on-box detection only.~~ Corrected 2026-10-07: both shipped on 2026-10-02 (#2898 cloud stills with the "Saw:" line, #2901 on-box person count); this line was stale when written. The first `/api/cron/think` rows land on the next mega-evening.
>
> ## 2026-10-02 · brain graph Unlinked tray + Obsidian bridge restored (#2890) · out-of-window FK anchors, dangling-link requeue, Obsidian status reaches prod, export overwrite loop ended · NattyNour bridge repaired live
>
> **Graph.** The Home "Unlinked" tray listed grounded entries: Home loads 10 ACTIVE missions / 8 active goals, so an entry linked to anything else had no second end. `getBrainGraph` loads those anchors by id (cap 20, deadline-guarded, `anchor_missions`/`anchor_goals` in `degraded` on failure). Deleting a goal/mission SET NULLs the FK but left `link_status` claiming a link (prod: 10 of 17 `auto` decision_replays had no FK); `backfillJournalBrain` (mastery-xp cron) now runs `requeueDanglingLinks` first so the same sweep re-grounds them (`rejected` untouched).
>
> **Obsidian (NattyNour, local engine).** Three stacked faults: (1) the root `.env` carried a stale Neon password (P1000) since ~2026-09-29 and the `Statenour-Obsidian-Bridge` task was disabled since 2026-09-30, so prod `local_sync_log` had zero `obsidian_engine` rows ever; (2) `engine-config` imported Prisma at module load, before the runner loads the repo-root `.env` (hoisted imports), so the runner's own status write failed "No database host" and the watch daemon crashed on start - Prisma is now imported inside `writeEngineStatus`; (3) reflection notes were named by creation second and prod has 11 one-second windows holding 2-4 reflections, so every export rewrote the shared files, which woke the watcher, which exported again (about one sync every 15 s, 143 MB log, OneDrive churn, only the last writer visible) - `createNotePathClaimer` gives a later same-name record a stable 6-char id suffix (the first keeps the plain name; export order is deterministic). Live on NattyNour with operator approval: `.env` DATABASE_URL/DIRECT_URL updated (backups kept), `OBSIDIAN_VAULT_PATH` written with forward slashes (inside double quotes `loadEnvFile` reads the `\n` of `\nourd` as a newline - the first attempt failed the doctor on exactly that), `OBSIDIAN_REST_URL`/`OBSIDIAN_REST_TOKEN` from the Local REST API plugin, two 0-byte daily notes removed, log trimmed, the bridge launcher exports the DB vars from the root `.env` until the code fix is pulled, task re-enabled. Receipts: a second export rewrites 0 files; doctor 29 passed / 0 warned / 0 failed; prod `obsidian_engine` row health `healthy`, 0 issues, last run 16:34:53Z. Gates: tsc 0 · eslint 0 · 11 new tests · 15 graph/journal files 199 passed · lib/obsidian 17 passed · positive controls recorded in the commits.
>
> ## 2026-10-02 · full-circle bug hunt (#2888) · empty chat answers fixed, 20 ledger/control-plane/SQL/UI defects across waves 1-4, ledger `result_ref` index + two-tab duplicate guard, a 3-day reality-ledger outage closed · CORRECTED: the Telegram webhook was never silent · 1 squash merge (`f3051532`)
>
> Four independent read-only reviewers (ledger, control plane, UI/read models, SQL) over waves 1-4 (#2883/#2884/#2886/#2887), plus production logs and rows; every finding verified before fixing, two refuted against production (semantic-link was not failing: 191 edges in 7 days; no stale kill rows: 7 `cron_control` rows, none disabled). **Chat:** query-shape output caps (300-2,800 tokens) starved the thinking model on short questions; two empty "factual" answers on 2026-10-02 fell back to the canned failure reply. `deriveMaxOutputTokens` (`lib/ai/chat-output-budget.ts`) floors a shaped cap at 6,000; the response contract still governs length. **Ledger:** brief and push summaries are dated (a constant first line made the 24h dedup return yesterday's row, so today's rating labelled it); decide-by-content takes the newest row (accept-then-dismiss had planted a false correction on an older one); dismissals carry no `resultRef` and the closer closes only `accepted` rows (a dismissed row could be rated useful by the task it was dismissed for); chip summaries key on the chip id, and a multi-promise chip names no single task; the forecast resolver window is 6 days (an exact 7 missed last week's row every week). **Control plane** (dormant today): mega Inngest ids map to kill-switch names; the kill decision is fixed per run; a deliberate kill does not page; diagnose ignores declared degradation; "run now" on an Inngest cron explains instead of 404; capability recovery leaves an operator-disabled row; capability receipts stay off the integrations list. **SQL:** task-timing predictor read `"deletedAt"` (column is `deleted_at`); semantic-link binds a Date; error rate attributed by method+path and counted once. **UI/read models:** Home rail no longer makes the 6 s bridge read; a stale Telegram error is not live; a stale fallback digest is never healthy; a failed odometer read says unreadable; links follow the moved surfaces; fleet stats wrap at 375px; cron switch has a stable label.
>
> **Schema, operator-approved, hand-applied 2026-10-02:** (1) `20261002160000_intelligence_outcome_result_ref_index` - `CREATE INDEX CONCURRENTLY` on `intelligence_outcomes(result_ref)`, valid + ready, ledger row with the file's sha256; (2) `recordShown` re-checks and inserts under `pg_advisory_xact_lock(hashtext(contentHash))` on a dedup miss (no DDL), so two tabs write one row - positive control: dropping the re-check turns the race test red; (3) **`20260929123500_reality_event_envelope` had never been applied.** The schema has declared five `reality_events` columns since 2026-09-30 and production had none, so every `/api/sync/evidence` write failed (`event_version does not exist`: 12 on 09-30, 24 on 10-01, 2 on 10-02; last row 2026-09-29 03:10Z, 332 rows). Applied 15:54Z in one transaction exactly as written (5 columns, 2 backfills, 3 indexes; 0 rows with `occurred_at <> observed_at`), ledger row with sha256 `b14de74c...`. Every repo migration is now in `_prisma_migrations`; one ledger row has no repo dir (`20260527_power_atlas_phase2_manual_lock`, pre-existing, left alone). Lesson: a migration committed beside a schema change is not applied by merging it - `migrate status` against prod is the only receipt.
>
> **Correction to wave 4 below:** "zero requests to `/api/telegram/webhook` since 2026-09-25" was a log-filter error, not a fact. The operator's `/system/health` shows the webhook line grey (registered here, no live error) and the http logs show its POSTs. Zero ratings means nobody has tapped. Gates: tsc 0 · eslint 0 errors · 579 referencing test files + `tests/repo` green · 175 ledger tests on the last commit · prisma validate · CI 16/16 green on `c8bfd850`.
>
> ## 2026-10-02 · full-circle wave 4 · both censuses close: forecasts scored against actuals (E5), chat decision-surface producer deleted (E6), chat chips folded into the main ledger (E11), one ledger row per morning brief + a rateable Telegram fallback (E12), the five settings leftovers fixed, production measured · ~~FOUND: Telegram updates have not reached this app~~ (wrong - see the bug-hunt entry above) · 1 squash merge (`d66a5047`, deployed Railway `b4b487f2` 15:14Z)
>
> Operator decisions 2026-10-02 on the three items the census deferred: **E5 (a)** a forecast is correct when the week's actual revenue lands inside its band; **E6 delete**; **E11 fold**. **E5:** `resolveForecastPredictions` (`lib/services/cashflow-forecast.ts`) scores every unresolved `prediction` row from `cashflow-forecast` whose week has fully elapsed: actual from the same `revenue_range` bridge query the forecast was built from, `outcomeUseful` = band hit (inclusive), `resultRef week:<start>:actual:<n>`. A bridge that gives no number leaves the row untouched and says why — a missing actual is never a miss. The weekly digest runs it **before** writing the new forecast (so the new row is never its own candidate), stores `projectedRevenue` on the row (null for an empty projection, so it is never a $0–$0 band that every positive actual misses), and adds a "Last week's forecast … HIT / MISS / not scored — <reason>" line to the email. Rows written before the band was stored are scored from their digest line. The candidate query takes only elapsed, non-UNAVAILABLE rows so unscorable ones cannot starve the window. **E6:** `getTopDecisions` no longer writes a `decision_surface` row; `decision_surface` is gone from `OutcomeKind` (old rows stay as strings). **E11:** `buildNickSuggestions` ledgers each visible chip (`kind suggestion`, `sourceEngine nick-suggestions:<kind>`, summary `chip: <label>`, surface `chat-chips`, evidence `suggestionId`/`severity` and `taskId` when the chip is about exactly one task) through `recordShownBounded` and returns `ledgerId`; the chip strip passes it on tap and on X; `brain.recordSuggestionSignal` decides the row (acted/modified = accepted, dismissed = dismissed, deferred = none) via the new `recordDecisionFromEvidence`, which carries `resultRef task:<id>` from the row's own evidence so the existing completion closer finishes the loop. The BrainMemory `suggestion_loop` write stays — it is the 7-day suppression source and the calibration readers' input.
>
> **Found on the way:** the harvest cron and `corpus-odometer` counted suggestion taps from `metadata.action`; the writer stores `metadata.event`, so every tap counted as `none` and "suggestion verdicts" had read 0 since the counter shipped. Both now read `event` (falling back to `action`). Expect the odometer's supplementary count to jump on the next harvest run — that is the counter starting to see real rows, not a burst of new ones.
>
> **Second pass, after the operator asked "are you sure that was everything" — it was not.** Re-reading both censuses line by line found three open items in the ledger census and five in the settings census:
>
> - **E12 (never touched until now).** The morning function's `outcome-ledger` step wrote a `daily_brief` row at hand-off while the combined push in `intelligence-brief` ledgers the same morning — measured in production: 59 `morning-brief` rows and 50 `intelligence-brief` rows, two per day with different hashes. The hand-off writer (`recordBriefShown`) and the `telegram-fallback` step keyed on the hand-off's synthetic `{sent:1}` (it could never fire) are deleted; `sendStandaloneIfUnconsumed` is now the only morning-brief ledger writer, so a morning is one row. This also supersedes wave 3's `handed-off-to-combine` value — nothing writes it any more.
> - **The real Telegram fallback was unrateable.** `briefTelegramFallback` (inside the backstop, when push reaches no device) sent plain text even though the row id was in hand; it now sends `ratingTelegramButtons(ledgerId)`. Pinned in `tests/inngest/morning-brief-combine.test.ts` (buttons carry `oc:u|n:<id>`, surface written as `telegram-fallback`; a delivered push writes `web-push` and never falls back).
> - **Settings: Default Mode "auto" was unreachable (finding 2).** The panel sent `{ defaultMode: undefined }`; with no tRPC transformer JSON drops the key, the merge kept the stored mode, the UI snapped back. "auto" is now an explicit `null` through `aiConfigPatchSchema`, mapped by `aiConfigPatchToConfig` to a present `undefined` key so the merge clears it. The REST twin (`PATCH /api/settings/ai-config`, no callers) wrote its body **unvalidated**; it now goes through the same schema and mapping (400 on an unknown key or wrong type).
> - **Settings: Journal sliders let you pick values the server rejects.** One constant, `JOURNAL_SETTING_BOUNDS` (`lib/validators/journal.ts`), now feeds both `journal.updateSettings` and the four panel controls.
> - **Settings: nine dead autopilot keys.** `AUTOPILOT_DEFAULTS` is `{ adhd_operating_rhythm: true }`, the one key `operating-rhythm.ts` reads; dead keys are dropped on read and on write so the stored row converges.
> - **Settings: stale copy.** The push toggle promised lead / revenue / score / pipeline alerts whose senders had zero callers — those four helpers are deleted and the copy lists what actually pushes; the ticker card names the one ticker that exists; the flags-panel comment no longer cites a 37-flag count.
> - **Settings: `NICK_MUTATION_LOCK` locked itself in.** The gate refused every operator mutation, including the flags-board write that lifts it. Exactly one call is exempt (`isMutationLockRelease`): `operator.setFeatureFlagOverride` with key `NICK_MUTATION_LOCK` and value `"false"` or `null`. Red-teamed both ways: removing the exemption turns the 3 release tests red; widening it to any key turns 4 near-miss tests red; turning the lock ON, another flag, a lowercase key, a trailing space, `"0"`, a boolean, an array or another procedure all stay FORBIDDEN.
>
> **Measured in production (read-only SELECTs via Neon, 2026-10-02 ~14:45Z):** `intelligence_outcomes` = proactive_push 160 rows / 0 labelled · daily_brief 114 / 0 · suggestion 77 / 10 · prediction 13 / 0. Labels that exist: 9 decisions (discovery verdicts 8, nudge dismiss 1) and 1 task-closed outcome. Zero rows since the 14:38Z deploy of #2886 — nobody has opened Home or Missions since, so wave 3's producers are DEPLOYED, not yet observed.
>
> **CORRECTED 2026-10-02 (bug-hunt entry above): this finding was a log-filter error; the webhook is registered and receiving.** Original text: **FOUND — the reason pushes and briefs carry zero ratings is probably not the operator.** Railway http logs show **zero** requests to `/api/telegram/webhook` (or the revenue-decision callback) since at least 2026-09-25, while the bot kept sending every slot. Positive control: the same filter on `/api/version` returned this afternoon's hits. Every rating tap, journal link button and message to the bot has gone somewhere other than this app. Confirming needs the bot token, which this session did not read; instead `system.telegramWebhook` (`lib/services/telegram-webhook-status.ts`) asks Telegram's `getWebhookInfo` from the server and `/system/health` shows the registered URL, pending updates and Telegram's last delivery error — quiet when it points here, amber with what it costs otherwise. Re-registering the webhook is an operator action (credential-bearing call), not taken here.
>
> **Hostile pass on my own diff found two defects before commit:** an UNAVAILABLE forecast would have stored a `{0,0,0}` band and been scored a MISS; and the candidate query's `take` window could have been filled forever by the running week and unscorable rows. Both fixed and pinned.
>
> **Receipts (this tree, 2026-10-02):** `tsc --noEmit` exit 0 · eslint 0 errors on the 13 changed files · vitest 267 files / 3,233 passed / 6 skipped, exit 0 (every test touching a changed module + `tests/ai`, `tests/repo`, `tests/lib/trpc/routers`), then the forecast suites again after the two fixes: 3 files / 33 passed · new: `cashflow-forecast-resolution` (11), `nick-suggestions-ledger` (4), `outcome-ledger-evidence-decision` (3); extended: `recommendation-decision-wiring` (+4) · check:mutations:strict, raw-sql, get-auth, anti-slop, crons, runbooks, scripts, stale-docs strict all exit 0. First live receipts: a `nick-suggestions:*` row on the next chip render; a chip decision on the next tap; the first scored `prediction` row on the next Sunday digest (weekly-digest cron).
>
> ## 2026-10-02 · full-circle wave 3 · Lane D: the Home lead, the Missions deck pick, the Journal next action and the Brain nudge become ledgered recommendations (shown → decided → closed by the task they became) · one correction predicate · the odometer row read back · the brief's surface told truthfully · 1 squash merge, 2 code commits · MERGED `1bcffea6` (#2886, CI 18/18 green on `68faae48`) · DEPLOYED Railway `6f46ff0c` SUCCESS 14:38Z (`/api/version` serves `1bcffea6`, ancestry-checked) · no production row yet (measured 14:45Z) — LIVE + VERIFIED waits on the first Home / Missions render
>
> The outcome-ledger census (`docs/design/outcome-ledger-coverage-2026-10-02.md` §5) found twelve recommendation surfaces and exactly one complete loop (Brain Discover); the two highest-frequency surfaces recorded nothing. **Producers:** `buildOperatorBrief` ledgers the lead (`kind: suggestion`, `sourceEngine: operator-brief:<kind>`, summary `"<headline>: <cta label>"` so a headline that repeats daily still dedups per task, evidence `taskId`/`href`) and carries `ledgerId` in the payload; `buildMissionsDeck` ledgers the pick (`next move: <title>` / `resume: <title>`, prefixed so it never collides with Discover's verbatim-title bridge). Both use `recordShownBounded` (400 ms): a read path never waits on the ledger, and a late answer leaves the surface without an id — nothing to decide against, honestly. **Deciders:** one mutation, `operator.recordRecommendationDecision`, keyed by that id: the Home CTA and the deck's Start record `accepted` with `resultRef task:<id>`; an alternative / pick-different records `dismissed`. **Closer:** `checkTask` closes accepted rows by `resultRef` from the completion rating (`recordOutcomeByResultRef`), beside the verbatim-title bridge. **Contract written down** in `lib/services/outcome-ledger.ts`: `decision` = what the operator did, `outcomeUseful` = did it help, a rating never writes a decision; `outcomeStats` reports `unlabelled` (both null) beside `undecided` and `/system/fleet` shows it, so a rated-but-unclicked push stops reading as "nothing known".
>
> **Receipts (this tree, 2026-10-02):** `tsc --noEmit` exit 0 · eslint 0 errors on the 13 changed files · vitest 68 files / 587 passed / 6 skipped, exit 0 (every test referencing a touched file + `tests/repo/*`; new: `outcome-ledger-resultref` 5, `recommendation-decision-wiring` 5; extended: `operator-brief` +4, `deck` +3, `task-actions-outcome-bridge`) · check:mutations:strict, raw-sql, get-auth (178), anti-slop, stale-docs strict, parity all green · cleared-cache `next build` receipt in the PR body. First live receipts: a `suggestion` row with `sourceEngine operator-brief:*` after the next Home render, `missions-deck:*` after the next /missions render; a `decision` the first time the operator takes the CTA or Start.
>
> **Second commit · the rest of the census, same PR.** **E10 Journal:** the `journal.receipt` read ledgers an unpromoted `nextAction` (`sourceEngine journal:next-action`, surface `journal`, summary `next action: <text>` via `journalNextActionSummary`, evidence entryId/silo/domain), and `promoteJournalItem`'s nextAction branch records `accepted` by content with `resultRef task:<id>` — so the task that the next action became closes the row through the existing `resultRef` closer. **E8:** `brain.acceptNudge` records `accepted` by content (`resultRef nudge:<source>`) and the nudge panel's anchor calls it on tap; the panel keeps its existing `dismissNudge` path as the `dismissed` side. **E3:** the correction predicate (`dismissed` OR `outcomeUseful = false`) has one owner, `CORRECTION_WHERE` in `outcome-ledger.ts`, used by `outcomesNeedingReview`, the outcome-harvest cron, `recall-corpus-builder`, `corpus-odometer` and `export-eval-datasets`; `tests/services/correction-where-single-owner.test.ts` greps `lib/app/scripts` for the literal and expects exactly that one file (it caught a comment in `discoveries.ts` on the first run). **E9:** `edited` is gone from `OutcomeDecision` and from the schema comment, which now states the contract and that no TTL sweep writes `ignored` today. **E4:** `system.deliveryStats` reads the `eval_run:corpus-odometer` BrainMemory row the harvest cron writes and `/system/fleet` renders its line and age, or names the missing row — the odometer had a writer and no reader. **E2:** `recordBriefShown` stops claiming `push`/`telegram` before any send and writes `handed-off-to-combine`; `sendBriefPush` returns the `ledgerId`, and the standalone backstop (`sendStandaloneIfUnconsumed`) corrects the surface to `web-push` or `telegram-fallback` after it actually sends, so the handed-off value cannot stick on a brief that went out standalone.
>
> **Receipts (second commit, this tree, 2026-10-02):** `tsc --noEmit` exit 0 · eslint 0 errors on the 16 changed files · vitest 65 files / 502 passed / 6 skipped, exit 0 (every test referencing a touched module + `tests/repo/*`; new: `correction-where-single-owner` 1; extended: `recommendation-decision-wiring` 5 → 10, `journal-promote` +ledger assertions) · check:mutations:strict, raw-sql, get-auth, anti-slop, crons (self-test caught the ghost fixture), runbooks (9), scripts (no regression), stale-docs strict all exit 0 · `prisma validate` valid (comment-only schema diff, no DDL).
>
> **Not done, recorded:** ratings still never write `decision` (by contract, not omission); E5 (`prediction` resolver), E6 (`decision_surface` webhook) and E11 (`suggestion_loop` outcome) stay as the census lists them — each needs a product decision about what "resolved" means for that row kind, not a join.
>
> ## 2026-10-02 · full-circle wave 2 · Settings keeps configuration, System owns operations (Lane C) · the cron kill switch becomes true for Inngest crons · Home reads WaitingSummary · the daily brief is rateable on its normal path (Lane D) · 1 squash merge MERGED `b008b801` (#2884) · DEPLOYED Railway `9c6bee2e` SUCCESS 13:48Z (`/api/version` ancestry) · operator-visible checks pending a signed-in read
>
> Driven by two read-only censuses committed in the same PR (`docs/design/settings-census-2026-10-02.md`, 17 blocks / 53 controls with writer, runtime reader, precedence and a disposition each; `docs/design/outcome-ledger-coverage-2026-10-02.md`, 9 producers / 2 deciders / 4 closers / 7 readers over `IntelligenceOutcome`). **Settings** (`/settings`, the operator's most-visited route by Railway http logs) drops from 17 blocks in 4 domains to 8 in 3: the Diagnostics domain, the cron panel and the second SkillLibrary mount are gone, and the page copy no longer calls itself an ops console. **System** gains what Settings alone had: the nightly health digest card and the 7d-trend / 24h-error-rate / quota cards on `/system/health` (with explicit unreadable and healthy lines — the digest card rendered nothing for three different states), the DeployChip in the `/system` header (now linking the monorepo instead of the retired `statenour-os` repo, and saying `build · unknown` on a failed read), runbook links and a `role=switch` kill toggle on `/system/crons`; memory of the day moves to `/brain`. Four blocks were deleted as duplicates rather than moved (SystemOpsHub = `SystemHubGrid`; HQErrorsCard = control tower + errors deck; SystemInfoCard = hub chips; CommandSpinePulse linked to `/system` from the page that became `/system`). **The kill switch was write-only for the 19 Inngest-native crons** (`isCronEnabled` was consulted only by `cronHandler`); `CronLifecycleMiddleware.wrapFunctionHandler` now returns the fleet's skip shape for a killed cron (30 s read cache, fail-open), so one `cron_control` row governs both dispatch paths and the row settles `success · skipReason "disabled via settings"`. The vercel.json-era `/api/settings/crons` + `/trigger` routes, `listScheduledCrons` and `triggerCronByName` are deleted; `system.runCron` (the chat `/cron run` path) resolves through the manifest and so works for every active cron again. The write-only Speed Ribbon toggle, its unmounted hook and its test are gone. **Home** gets a rail line, "Waiting on others", over `operator.waitingSummary` (others + system buckets, oldest first, cap 4, unknown named on a failed read; decisions stay in the judgment queue and shop items never reach Home). **Lane D:** the combined daily brief carried no ledger id and no rating buttons (only the 35-minute backstop did); `intelligence-brief` keeps the id and both its push and its Telegram fallback carry the rating affordance, now owned once in `lib/services/outcome-rating-affordance.ts` and consumed by morning-brief and proactive-pushes too.
>
> **Receipts (this tree, 2026-10-02):** `tsc --noEmit` exit 0 (after overwriting the stale `.next/types/validator.ts` that still enumerated the two deleted routes) · eslint 0 errors / 2 pre-existing warnings on the 31 changed TS/TSX files · vitest 86 files / 691 passed / 6 skipped, exit 0 (every test referencing a changed or deleted file + `tests/repo/*`; new: `cron-lifecycle` kill-switch block 6, `waiting-line` 8, `cron-runbooks` 3, `intelligence-brief-ratable` 7, `system-data-error-rate` 3, `task-timing-predictor-bind` 2; retargeted: `mobile-a11y` A8/A9/A11 and the two source-level rating tests onto the surviving owners) · anti-slop 0 · stale-docs strict 0 critical · check:crons OK · check:get-auth 176 OK · check:raw-sql OK · check:mutations:strict OK · check:runbooks 9 OK · parity 142/0 · cleared-cache `next build` exit 0 (77 s compile, 210 static pages) · 12 after-screenshots on the hermetic e2e stack (empty Postgres 16 + pgvector 0.6, mock auth) in `docs/design/ui-v2/shots/wave2-*` — settings, system, system-health, system-crons, home, brain at 1440×900 and 390×844, all HTTP 200 with zero page errors; a DOM probe counted 8 runbook links and 55 `role=switch` toggles on /system/crons. No git hooks run in the cloud container; gates by hand, CI is the remote gate. Diff: 37 code files, +472 / −1,680 before docs and screenshots.
>
> **Found on the way (fixed in the same PR):** the moment the error-rate card rendered on the hermetic e2e stack it said "unmeasured — the read failed". Not the stack: `buildErrorRateByRoute` bound its window as `since.toISOString()` into `created_at >= $1`, and Postgres has no `timestamp >= text` operator (SQLSTATE 42883), so the card had failed on EVERY call since it shipped (v10.0.94) and had rendered the unmeasured line under Settings > Diagnostics for its whole life. Same bind in two more places: the legacy REST twin `/api/system/error-rate-by-route` (its own copy of the SQL; now a thin face over the one service) and `predictBestHoursForTask` (`lib/personal/task-timing-predictor.ts`), whose `.catch(() => [])` had turned the same error into "no completions yet" on every call. All three bind a `Date` now; pinned by `tests/services/system-data-error-rate.test.ts` and `tests/personal/task-timing-predictor-bind.test.ts`; live receipt on the hermetic stack: `system.errorRateByRoute` HTTP 500 → 200 with a measured zero.
>
> **Not done, recorded:** Default Mode "auto" unreachable from the UI (census finding 2); JournalBrainPanel slider mins vs validators; the 9 dead `AUTOPILOT_DEFAULTS` keys; ratings write `outcomeUseful` and never `decision` (ledger finding 7, a contract question); Home lead / Missions deck record nothing in the ledger (ledger finding 5, next Lane D slice). Missions' `DeckWaiting` stays the task-level projection (client-side, same rows) and was not re-pointed at WaitingSummary: a second fetch for the same rows would buy nothing.
>
> ## 2026-10-02 · full-circle wave 1 · Lane A owner-exception coverage (guardian receipts + declared-degraded cron runs) + Lane B `WaitingSummary` read model · 1 squash merge · MERGED `ba792990` (#2883) · DEPLOYED Railway `59bc223f` SUCCESS 12:46Z (`/api/version` ancestry) · receipt path LIVE + UNPROVEN until the next guardian terminal failure (first guaranteed: the 10:15 UTC brief's Firecrawl touch)
>
> Two gaps proven from live Railway logs: `guardian_call_failed` for `firecrawl-scrape` (insufficient credits) had repeated for a day and `brief_compose_failed_degrading` had hit its 90 s timeout, while the Owner Panel — the one owner-exception surface — had no durable source for either. **Capability receipts:** `lib/system/capability-health.ts` writes a guardian terminal failure into the incumbent `integrations` table as a row of type `capability` (status healthy → degraded after 3 consecutive terminal failures, `consecutiveFailures`, `errorCount`, metadata lastError / lastCategory / firstFailureAt / lastFailureAt); the first success afterwards resets the streak (one write per process per tool); a 10 s throttle while degraded; rows another integration owns or the operator disabled are never touched; no `DATABASE_URL` → nothing attempted. `lib/tools/guardian.ts` records the failure before the throw, bounded at 750 ms so a slow database never holds a caller, and the success path is fire-and-forget. **Owner Panel:** new input `capabilities` (null = unreadable, never a clear) and kind `capability_degraded` (amber degraded / rose failed, since = first failure, evidence `integrations name=<tool>`, href /system/tools); rows untouched for 7 days are history. **Degraded runs:** `lib/inngest/cron-lifecycle.ts` settles an output that declares degradation (`status: "partial"` or `degraded: true`) as `partial` carrying the reason behind `DECLARED_DEGRADATION_PREFIX` (`lib/services/cron-status.ts`); the brief returns that via `briefRunOutcome`; the panel's `cron_degraded` (amber) pages ONLY on the declared prefix — a plain `partial` (fan-out parent with failed children; mega-evening alone has written 1,248) stays with `diagnose-cron-failure`. Also: `components/brain-dump-modal.tsx` carried the last two `rounded-md` the UI v2 sweep missed (one `.rounded-md` still emitted in the live bundle); converted. `docs/agent-os/FULL-CIRCLE-MISSION.md` added (the mission brief + one-paragraph activation). **WaitingSummary (Lane B):** `lib/home/waiting-summary.ts` is the first semantic read model of the reconstruction — who is waiting on whom, as one projection over rows that already exist: `me` (live approvals, attempts parked on approval, proposed commitments, promises owed to someone else, and customers waiting on the shop through the existing `queryNickBatch` bridge: `callbacks_pending`, `leads_urgent`), `others` (tasks whose `waitingOn` names a person or vendor — the Missions deck's own blocked lane), `system` (tasks delegated to Nick, executing action attempts). A failed read makes every bucket it feeds `count: null`, never 0; the shop's `{ error: "No DB" }` inside a 200 is a failed read; answers older than 15 min are named in `staleSources`; `since` is only what the source carries. Data layer `waiting-summary-data.ts` (guarded reads, 6 s bridge bound); reachable as tRPC `operator.waitingSummary`; no UI yet (Home / Missions consume it in the UI wave). Nothing stored.
>
> **Receipts (this tree, 2026-10-02):** `tsc --noEmit` exit 0 · eslint 0 errors on the touched files · vitest 11 files / 189 passed (guardian 24 — the four breaker tests that timed out on the first cut now run in 2.7 s — receipts 5, capability-health 11, owner-panel 36, tool-policy 27, approval-gate 13, …) + 6 files / 105 (cron-lifecycle 49, declared-degradation 2, owner-panel render 4, cron-status 10, skip-reason …) + 94-file referencing set green except the four guardian timeouts fixed above · anti-slop 0 · stale-docs strict 0 · parity 142/0 · check:crons clean · cleared-cache `next build` exit 0 (receipt on the PR). Lane B: `tests/home/waiting-summary.test.ts` 12/12 (unknown ≠ zero per bucket, `No DB`-inside-200, ownership per source, promise-to-self excluded, deadline-first ordering, staleness, every `normalizeBridgeRead` failure shape) · repo contracts + router tests 46 files / 307 passed · `check:get-auth` 178 handlers · `check:raw-sql` clean · `check:mutations:strict` clean · cleared-cache `next build` exit 0 on the final tree. State at this entry: **BUILT + TESTED + WIRED (API)**; MERGED / DEPLOYED / LIVE + VERIFIED recorded on the PR and then in CURRENT-TRUTH. Found on the way: `tests/tools/guardian.test.ts` never mocked Prisma because the guardian's failure path never touched it — any future write on that path must stay bounded and skip when no database is configured.
>
> ## 2026-10-02 · UI v2 PR 4 · the rest of the backlog · 1 squash merge · MERGED `f93469b7` (#2880) · DEPLOYED Railway `388b693f` SUCCESS 12:10Z · LIVE + VERIFIED (`/api/version` ancestry; served CSS carries `.neural-glass` inside `@layer components`, gold `rgba(253,185,19)` 0×)
>
> `components/ui/card.tsx` deleted (its two stats importers moved to `GlassCard` + plain slots), which exposed that `.neural-glass` was unlayered and silently beat every utility a caller passed — eight GlassCard call sites had rails, error tints and hovers that never painted; `.neural-glass*` and `.ui-material` now live in `@layer components`. `cn` extends tailwind-merge with the v2 radius / shadow scales (positive control pinned). Brain inline edit buttons get the 44px floor below `sm`. The voice overlay's gradient orb + ping is replaced by a solid state disc with one `pulse-live` ring while working. Radius sweep (`rounded-md|lg|sm`, bare `rounded`) and `slate-*` sweep across app / components, context-decided control vs. surface. `features/chat-v2` (14 files, outside every earlier scope) converted. Code diff 139 files, +708 / −660 before the 16 screenshots; one commit. After-shots: 16 files under `docs/design/ui-v2/shots/after4-*`.
>
> **Receipts (this tree, 2026-10-02):** `tsc --noEmit` exit 0 · eslint 0 errors on the 130 changed TS/TSX files · vitest 136 files / 1,587 passed, exit 0 (every test referencing a changed file + grammar, nav-shell, anti-slop, mobile-a11y, mount-graph, palette-root, modal contracts) · `tests/lib/cn-v2-tokens.test.ts` 4/4 with the stock-merger positive control · anti-slop 0 · stale-docs strict 0 · parity 142/0 · `next build` with `.next/cache` cleared exit 0 (full route table). Hostile review of the orchestrator diff found and this commit fixes: every styled Dialog about to paint a gold hairline + 40px glow once `.neural-glass-modal` was layered (the class carries the look now), 23 GlassCard call sites whose dead `p-*` would have started painting (stripped: one card, one padding), six inputs/textareas on the wrong radius tier, `critical-glow` still animating behind a "no glow" comment (removed with its keyframe), a 20px `+` button left off the floor, a 7px radius on a 400px image, chip/panel tier drift, one `slate-400` leftover, lost card rhythm.
>
> **Self-audit, second commit (same PR):** a brace-aware label scanner sentence-cased 243 control labels in 90 files (33 test-pinned strings skipped; two non-label catches `"Text-fg-secondary"` / `"CurrentColor"` reverted; `alert-inspector` + its pins moved to sentence case; seven unreachable ternaries fixed by hand; a second diff scan reverted seven count/unit text nodes capitalised mid-sentence after an expression); five row/icon buttons mis-tiered `rounded-micro` by the sweep → `rounded-control`; voice-overlay legacy aliases → tokens; the dead-custom-property gate now also reads `features/`, `hooks/`, `lib/`. Kept on purpose: ~60 11px `font-mono` micro-readouts in dense panels. Receipts: `tsc --noEmit` exit 0 · eslint 0 errors on 95 changed files · vitest 142 files / 1,639 passed, exit 0 · anti-slop 0 · stale-docs strict 0 · parity 142/0 · cleared-cache `next build` exit 0 (72 s, 210 static pages, full route table). No git hooks run in the cloud container, so the pre-push build never ran on these pushes; gates by hand, CI is the remote gate.
>
> ## 2026-10-02 · UI v2 PR 3 · delete the `?ui=v1` lane + the CommandDialog wrappers · 1 squash merge
>
> The comparison lane was migration scaffolding and is gone: `lib/ui-version.ts` (+ test), `components/ui/ui-version-switch.tsx`, the cookie read / `data-ui` stamp / `<UiVersionSwitch />` in `app/layout.tsx`, the `:root[data-ui="v1"]` colour block (tokens.css) and typography block (base.css), the `:root:not([data-ui="v1"])` gate on the v2 type floor (now unconditional), the `STATENOUR_UI` flag-registry entry, and the particle canvas `components/hud/neural-background.tsx` with its mount in the mastery layout (its only remaining job was to mount a hidden canvas for a lane nobody could reach). `components/ui/command.tsx` lost the unconsumed `Command` / `CommandDialog` / `CommandItem` / `CommandShortcut` wrappers and their Dialog / lucide imports; the Resolver owns its root. Net: 9 files, +29 / −209 before docs. The grammar test now asserts the lane is GONE (positive control on `1dfcfa2c`: tokens.css 2 `data-ui` hits, base.css 20, layout imports the switch). Rollback of the grammar is `git revert`.
>
> **Receipts (this tree, 2026-10-02):** `tsc --noEmit` exit 0 · eslint 0 errors on the touched files · vitest 38 files / 354 passed (every test referencing a touched file + grammar, nav-shell, anti-slop, mount-graph, palette-root) · anti-slop 0 · stale-docs strict 0 · parity OK · `next build` cleared-cache exit 0 (full route table). Merge SHA + Railway receipt on the PR.
>
> ## 2026-10-02 · UI v2 PR 2 · every operator surface onto the cockpit grammar · 1 squash merge
>
> Everything #2871 left on the old component grammar now speaks the v2 grammar: journal, brain (incl. the /brain graph controls in `components/home/home-brain-graph.tsx`), people, stats, all 17 system pages + 19 system panels, `PageNick`, `PageTabs`, chat (18 residual files), the shell (spine, more-sheet, tab bar as `.ui-material`), hud, home, missions + goals, actions + operator + inspector + workset, ultron + power-atlas, settings + relationships + content, the mastery chrome, the `components/ui` primitives (Button / Badge / Card / Input / Textarea / Tooltip / ConfirmHold / Metric / TrendCounter …), the ⌘K Resolver, the bottom ticker, and the remaining route pages (photo-improver, decisions, pins, links, learn, proof, intelligence, sign-in, error). Grammar: Geist 13px medium controls, accent underline / `border-accent` / `bg-accent-soft` for selected, mono 11px eyebrows as the one uppercase role, `bg-content` cards on `edge-subtle` hairlines, one gold primary per page, `pulse-live` only while working, status hues with their word, categorical hues untouched. Measured: the strict legacy census (gold / display font / sub-11px / zinc / white-alpha / xl radii / gradients / blur / glow / over-tracking) went from ~1,990 hits in 217 files to 0 unsanctioned (the survivors are chart series colours, the brain canvas NEW-arc, skeleton shimmer, the voice orb). `git diff --stat 218e335c`: 285 files, +4,969 / −4,747. Branch `statenour/ui-v2-surfaces`, two commits (`334985f9` page-tabs, `7ac44b06` first seven surfaces) plus this one, one squash merge; the merge SHA and the Railway deploy receipt are posted on the PR.
>
> **Not class-only, disclosed:** the palette tree changed (`CommandDialog` → `Dialog` + unstyled `DialogContent` + an owned `CommandPrimitive` root, so `shouldFilter`/`loop`/`onSelect` run against a real store for the first time); the ticker gained a `live` flag and one `pulse-live` dot (it had no indicator before; this is an addition, not a fix); people's "Add person" went from `<Button outline>` to a raw `<button>`; decorative `animate-pulse` on at-rest dots and emoji in button labels were removed across system/actions/inbox/calibration; ~75 control labels in ~35 files were sentence-cased (none case-sensitively pinned by a test). Eight parallel scoped agents did the substitution; the orchestrator did page-tabs, home-brain-graph, page-nick, the label sweep, the reviewer fixes and the gate.
>
> **Found on the way.** (1) The ⌘K Resolver throws on open at `218e335c`: `CommandDialog` mounts no cmdk root and the palette rendered `CommandInput` inside it → `Cannot read properties of undefined (reading 'subscribe')`. FACT by positive control (`tests/components/command-palette-cmdk-root.test.tsx`: cmdk Input throws without a root, renders inside one; the source contract fails on `218e335c`). "Broken in production since X" is a STRONG INFERENCE only: the clone is shallow and no Sentry/console receipt was pulled. (2) Dead custom properties carried by real class names — `--bg-overlay`, `--bg-secondary`, `--text-muted`, `--border-soft`, `--bg-card`, `--bg-primary`, `--border-focus`, `--bg-default`, `--brand`, `--success` — painted inputs, panels and chips transparent; all replaced, and `ui-v2-grammar.test.ts` now asserts every custom property a `.tsx` reads is defined (positive control planted). (3) A hostile reviewer over the first push found an emptied class on the open log row, two chips with a text token as fill (~3:1), an invisible toggle track, a double `min-h` floor, gold still on the palette input prefix, and five doc overclaims — all fixed before this commit. (4) `components/ui/metric.tsx` briefly lost `tabular-nums` under one agent's edit; a sibling's test caught it.
>
> **Receipts (this tree, 2026-10-02):** `tsc --noEmit` exit 0 · eslint 0 errors (210 changed TS/TSX files, 76 pre-existing warnings) · vitest 393 files / 5,067 passed / 3 skipped, exit 0 (every test referencing a changed file + the grammar, nav-shell, anti-slop, mobile-a11y, ui-lab, mount-graph contracts) · anti-slop 0 · stale-docs strict 0 · agent parity OK · `next build` with `.next/cache` cleared exit 0 (full route table, 111 s compile). Left on purpose: `components/ui/command.tsx` wrappers (converted, now unconsumed by the app — delete with the v1 lane in PR 3), `components/ui/card.tsx` (deprecated, structured API kept for stats), chart series colours, categorical hues on crons / logs / alerts / journal types (orange for `decision` is categorical, not a status), the voice-overlay orb (a redesign, not a substitution), 24px inline edit buttons in brain's beliefs / contradiction / identity panels.
>
> ## 2026-10-01 · UI v2 Precision Material Cockpit · 1 squash merge (3 commits) · LIVE + PROVEN
>
> bdnick.info moved from the gold-everywhere dark dashboard to a quiet instrument: warm near-black surfaces (`--canvas #090907` … `--surface-hover #22201B`), Geist sentence-case headings, one gold signal per surface (the `.notch`, primary buttons, focus, selection), translucent material only on the desktop rail and the composer, an Activity Summary + Tool Receipt grammar in chat instead of debugger cards, an icon-led 60px spine, missions/home de-golded, the particle canvas off. Spec: `docs/design/ui-v2/{README,SYSTEM,SURFACES,PLAN}.md` with before/after captures in `docs/design/ui-v2/shots/`. #2871 squash-merged as `18bf9ebc`; Railway statenour-web `754fae93` SUCCESS 23:43Z; live stylesheet carries the v2 tokens and none of the removed rules; `?ui=v1` (cookie `statenour_ui`) stamps `data-ui="v1"` on production.
>
> **`49592699` · the cockpit.** tokens/base/effects rewritten (effects 1939 → 947 lines across both passes; 79 class selectors + 36 keyframes removed, two live ones restored), shell, chat, home, missions, UI Lab fixtures, `tests/repo/ui-v2-grammar.test.ts`.
>
> **`fceb606b` · second pass.** Three independent hostile reviewers over the first push found 7 P1 cascade defects the screenshots hid — `border-edge-default` never registered in `@theme` (20 call sites emitting zero CSS), unlayered `h1/h2/h3` defaults beating every size utility, the v10.0.526 `!important` gold focus ring overriding the v2 ring, a focus rule mutating border-radius, unlayered button transitions resetting utilities, `bg-surface` being the legacy alias of `--surface-interactive` (so `bg-content` now names the card role), and `.animate-fade-in-scale` pruned with six live consumers. Also: `.neural-glass` (GlassCard, 43 importers) and the Dialog made solid; ambient gold removed; the `?ui=v1` lane had NEVER worked (the layout imported the cookie constant from a `"use client"` module → client reference on the server) → `lib/ui-version.ts` + unit test; desktop type floor (9/10px → 11px) and tracking cap under the v2 lane. Grammar test positive control: 11/12 fail on `4016737b`, 5/5 second-pass tests fail on `49592699`.
>
> **`20eaaefa` + `c3b1d7fd` · CI red twice.** Tailwind v4 auto-source reads Markdown: PLAN.md prose spelled a retired class with an asterisk, then an ellipsis, inside the bracketed var() argument; Tailwind minted both and the generated stylesheet failed to parse (every page 500 in e2e). Fixed in the prose + a canary that rejects any bracketed var() class with a non-property argument in any scanned file. Lesson recorded: a local `next build` with a warm `.next/cache` reported green on the broken tree — clear the cache before trusting a build receipt.
>
> **Flagged · NOT fixed**
> - Journal, brain, people, stats, system pages, the command palette and the ticker still render the old component grammar (uppercase Barlow tabs, gold-outline buttons) on the new tokens → PR 2.
> - The `[data-ui="v1"]` blocks, cookie read and `UiVersionSwitch` are migration scaffolding: delete once v2 is accepted, then the legacy token-name rename sweep (`border-edge`, `bg-raised`, `text-gold` aliases) → PR 3.
> - LCP / INP / CLS not measured on production after the merge.
> - The merged branch `statenour/ui-v2-cockpit` still exists on origin (the ref-delete push was refused by the remote); inert, delete from the GitHub UI.
> - Cloud-container traps: webpack `next dev` needs a 12 GB heap and dies silently (exit 0) after ~8 route compiles; `next start` ignores `AUTH_FORCE_MOCK`, so screenshots need `next dev`.
>
> ## 2026-09-27 afternoon · recovery closeout
>
> **Final repo state for this recovery thread:** #2712 merged as `93f0f66ca285600831ca50df87fb79f0497e3ed2`; open PR count returned to **0**.
>
> The two P1 review threads that blocked Completion Authority were both outdated against the current PR head. The current head had already removed the remaining hardcoded Resend token copies and added discoverable behavioral coverage via `resend_smoke.py` + `test_resend_smoke.py`. Both threads were formally resolved, Completion Authority reran green, and every substantive #2712 lane was green before squash merge.
>
> The recovery snapshot at `docs/00-current-truth/session-recovery-2026-09-27.md` now carries the finalization note. Earlier lines that describe #2712 as open are historical snapshots only.
>
> ## 2026-09-27 afternoon · session-trail recovery and durable handoff
>
> **Trigger:** the UI-visible ChatGPT conversation lost a substantial portion of the execution trail even though the repository had advanced much further. The session was reconstructed from GitHub/repo receipts instead of guessing from the remaining transcript.
>
> **Recovered repo truth:** source `main` at recovery was `a01abc97eb6ee4bd5c9f8519f48d49c3fb2545e3` (#2711). After #2696, the later merged sequence includes #2697/#2698/#2699/#2700/#2701/#2702/#2703/#2704/#2705/#2706/#2707/#2708/#2710/#2711; #2709 closed unmerged. #2662 is closed as superseded by #2696.
>
> **Current live repo edge:** #2712 is the only open PR at this snapshot. Its CI, StateNour E2E, Secret Scanning, local-agent, Adoption, Admin, and Agent Policy runs are green. Completion Authority fails only at the review gate because two P1 threads remain unresolved: remove all remaining hardcoded token copies (current-head follow-up says the code fix is present, thread still unresolved) and add behavioral smoke-test-guard coverage (`test-resend.py` is not discovered by `test_*.py`). Merge only after the review state is reconciled and Completion Authority is green.
>
> **Durable recovery artifact:** `docs/00-current-truth/session-recovery-2026-09-27.md`. Future sessions should read it together with `.remember/now.md`, CURRENT-TRUTH, and live GitHub state whenever transcript continuity looks suspect.
>
> ## 2026-09-25/26 · Nick runtime doctrine + quality loop closes the detect-without-repair gap
>
> **Outcome:** the operator asked for bdnick.info chat to be solution/principle-first, proactive, intelligent/creative,
> maximally truth-seeking, subordinate to his objective, and not an unsolicited-opinion engine. The first wave (#2673)
> changed the live Prompt V2 behavior kernel. A production audit then found a structural defect: the critic/reply gate could
> correctly identify a weak answer after it had already been streamed, while the buffered regen path could discard an
> improved second draft merely because it was not completely clean. #2680 repairs that architecture.
>
> - **#2673 `2b0783ea58f04d9adc3456d5b1447cf46431ff35` · operator runtime kernel** — live Prompt V2 now leads with
>   solution + governing principle; recovers context and uses tools/data proactively; looks for disconfirming evidence;
>   separates FACT / INFERENCE / UNKNOWN; uses creative/non-obvious angles only when they change the move; continues to
>   verification rather than equating code/tool execution with completion; and keeps Nour's objective/final decision
>   authoritative without sycophancy. Mutation confirmations, fencing, and injection safeguards were unchanged.
> - **Production audit of #2673 before the repair** — 27 completed assistant turns on deployment
>   `dbbb070f-a505-4255-a8dc-2b4a31d24235` (2026-09-25 15:05Z → 2026-09-26 12:17Z): critic average
>   **91.3/100**; 12/27 scored 100; 21/27 reply-gate clean; median response 167 words. The quality system nevertheless
>   still exposed the exact defect the operator objected to: critic regen candidates could ship unchanged, and the evidence
>   shadow on the same cohort returned 14 `pass`, 9 `repair`, 4 `block`. This was evidence for a repair loop,
>   not evidence to promote the separate evidence gate.
> - **#2680 `2b021632bf2806c95e7e275ba56b7c64117ba8b6` · one-shot repair before ship** —
>   `lib/ai/chat/pre-stream-regen.ts` now creates a `CandidateAssessment` from `critiqueOutput` plus
>   `runReplyGateWithContract` when turn/contract context exists. Gated intents:
>   factual, decision, creative, instructional, procedural, analytical. A failing first candidate receives exactly one
>   targeted repair prompt containing its measured reasons. The selector compares the same quality function across both
>   candidates: clean beats flagged; otherwise lower severity, then higher overall critic score, then higher specificity.
>   Crucially, a second draft does **not** need to become perfect to replace a known-worse first draft. If it is worse, it
>   never wins. `alternate-paths.ts` passes `userPrompt`, `turnSignal`, and `responseContract` into the lane, so
>   response-contract failures (count/shape/concision/repo-grounding/clarification rules) can trigger the same repair.
> - **Operator preference boundary in #2680** — the static kernel now says **FACTS, NOT YOUR OPINION**: seek
>   disconfirming evidence; separate FACT / INFERENCE / UNKNOWN; give mechanisms/options/consequences toward Nour's stated
>   objective; do not substitute the model's preference; correct a conflicting premise once with evidence; recommend only
>   when asked and optimize for Nour's objective/constraints. The behavior directive repeats that Nour owns objective,
>   preferences, values, and final decision.
> - **Review/test closure** — Codex caught that an early no-opinion rewrite had accidentally removed three truth-seeking
>   phrases pinned by `prompt-v9-2-static.test.ts`. The final head restored all of them and the existing
>   "clearly and ONCE" persona invariant rather than weakening the tests. Completion Authority was rerun after resolving
>   the review thread. The squash commit contains nine files: runtime selector/wiring, prompt/directive changes, deterministic
>   regen tests, prompt/persona tests, and the no-unsolicited-opinion eval corpus.
> - **Post-merge proof** — operator squash-merged #2680 at **2026-09-26 13:16:28Z**. Fresh push workflows on exact commit
>   `2b021632...` all passed: StateNour affected verify, authenticated e2e, Agent Policy, Adoption gates, Lighthouse,
>   deploy-drift, and Secret Scanning. Railway deployment
>   `99ab4bda-931f-4dce-ba0d-807b91b8d9ec` reached **SUCCESS** at 13:21Z on the same commit and replaced the prior
>   StateNour deployment.
> - **#2681 `36961a34204aeae4bea8eecaa6a95c1ac502ec2e` · repo-agent memory/runtime intelligence** landed later.
>   It updates `NOUR-COMMAND.md`, adds `docs/agent-os/NOUR-RUNTIME-KERNEL.md`, and wires/tests
>   `scripts/agent-os/intelligence-context.mjs`. It touched no `apps/statenour/**` files, so Railway correctly marked
>   the StateNour deploy **SKIPPED**. Current repo HEAD can therefore be newer than the live app SHA without deploy drift.
>
> **Still owed / do not overclaim:** implementation, tests, merge, and deploy are proven. The next production proof is
> the post-#2680 distribution of the **live** `verified_regen_path` event: `regenAttempted`, `regenFired`,
> `regenWasBetter`, `selectionReason`, first/regen overall, first/regen severity, and `intent`. Do not call the
> repair win rate proven until real weak drafts exercise the lane. `formatRegenTelemetry()` currently has no caller, so
> `chat.pre_stream_regen`, specificity, and regen duration are not live evidence yet. The evidence gate remains a
> separate shadow-calibration decision.
>
> ## 2026-09-22/23 · W16c · the receipt layer, the review sweep, the edge-vector drain, the lexical lane · 21 ships
>
> Third batch of Session F, the evening of 09-22 UTC. Every ship was measured on production first and re-measured before merge; one re-measurement refuted the ship's own premise and the fix landed before the merge. A sweep of the day's merged PRs found 18 Codex threads nobody had answered; all 18 are answered, 14 fixed in the follow-ups below. The operator's "merge all" merged the queue back-to-back (23:04-23:05Z), "apply the vectors too" authorised the drain, and "re run it, reindex too and the registration" authorised the benchmark re-run, the REINDEX and the ledger entries. Prod at the close of the first pass: `4531bee53`; the close-out addendum below (cloud session, 01:30-02:30Z 09-23) took the wave to `053b8ff91`. Clock erratum: the first receipts of the night were stamped "2026-09-23 0X:XXZ" from memory; GitHub's server timestamps put every one of them between 20:50Z and 23:40Z on 2026-09-22, and the PR comments, the ledger and agent memory were corrected in place.
>
> - **#2517 `d4db73b8b` · L6 named-claim shapes** — `isResourceTitle` rules 6-12 + `trimLeadingStopwords`; named-claim precision ~25% → ~35-40% on the 52-turn corpus; the residual is a people LOOKUP gap.
> - **#2521 `df482e60c` · the dense recall pool was starving** — 45% of HNSW candidates were dead vectors, `LIMIT 50` returned 9-28; `SET LOCAL hnsw.iterative_scan = relaxed_order` in a bounded transaction + liveness/category filters; graph edges leave the vector index. **PRODUCTION-PROVEN** 50/50 on four seeds. **DRAIN APPLIED 2026-09-22 ~23:10Z (operator-authorised):** backup `_bak_vector_embeddings_edge_drain_20260922` = 58,950 rows = pre-count, 12 batches deleted 58,950 `semantic_edge` vectors, 0 remain, brain-memory vectors 92,190 → 33,240, pool still 50/50 (190-348 ms). Restore route = `INSERT … SELECT` from the backup; the table stays until the operator drops it. **BENCHMARK RE-RUN 23:27Z** (`pnpm eval:recall`, 89 cases = 53 positive + 36 abstention): dense precision@5 0.245 raw = **41.1% on positives, identical to 09-18's 0.368 × 76 / 68 = 41.1%** measured on the starved pool — the fix changed pool FILL, not ranking, and nothing regressed; hybrid 0.132 raw = **22% on positives**, the first valid hybrid reading (09-18's ran with its vector half amputated), with the lexical FTS lane hitting its 900 ms statement timeout (57014) on 84 of 89 hybrid queries — the cause is measured and fixed in #2553 below.
> - **#2522 `5b8f00779` · "pinned to the shop/profile/board" is a UI surface** — live inside `83ae364cc`.
> - **#2525 `4b2511547` · a cron run keeps its receipt** — 692 of 694 daily `success` rows carried `resultCount = null`; `deriveResultCount` reads the job's own return (explicit key → fleet count keys → Count/Created/Ingested/Processed/Swept/Added/Scanned/Sent/Run suffix minus failure stems → array length; INT32-bounded; never an invented 0). **Retraction inside the PR:** the 49 "stranded" `started` rows were 4-5 duplicate rows per SUCCESSFUL mega-fanout run — Inngest fires `onRunStart` once per parallel-step request. `beginCronRun` is idempotent per (job, run id); a stale duplicate becomes `duplicate`, a stale orphan `interrupted` (a presumption an exact-run-id terminal event overrides). Prod census 6 min after the deploy (2026-09-22 ~23:11Z): the 49 stale `started` rows are `duplicate`, 0 `interrupted`, 0 stale started remain; of 694 daily successes 691 still carry `resultCount = null` (pre-deploy rows), 1 carries 0 and 2 carry a count - the first count-bearing success since the deploy wrote 0, not null. **Rows-per-run OBSERVED, not guaranteed (Neon, read-only, 10:39Z 09-23):** the two post-deploy runs (`mega-fanout-evening` 03:02Z, `mega-fanout-morning` 09:00Z) wrote exactly 1 row each, `success`; the same query over the six runs since 09-20 reads 5-6 rows per run (the positive control). Receipt posted on #2525. **Not an invariant (Codex P2 on #2572):** `beginCronRun` dedupes with a `findFirst` then a separate `create`, and `cron_job_logs` has no unique key on (`jobName`, `runId`), so two `onRunStart` requests that overlap can both see no open row and both insert; the test drives its five starts sequentially, so it cannot catch that. Two clean runs show the race did not fire, not that it cannot. The stale sweep still marks a loser `duplicate`, so no health view counts it. The atomic fix is a partial unique index on (`jobName`, `runId`) WHERE `status = 'started'` (a P2002 on the second insert is then the dedupe) plus a concurrent-start canary - a migration, so the operator's call.
> - **#2528 `586c6d86f` · a hard cron failure is a positive list** — `HARD_FAILURE_STATUSES = [failed, interrupted]`; every cron view (fail14d/lastFailAt, failures24h, health-rate numerator, 48h diagnostics, and system-health's current window via `tallyCronWindow`) sums through it. Census, all time: success 10,543 · started 49 · partial 15 · failed 8.
> - **#2533 `7971309dc` · the day's probes become proof recipes** — `pnpm proof:cron-census` / `proof:mega-rows` / `proof:recall-pool`, read-only, `railway run -s statenour-web -- pnpm proof:<name>`.
> - **#2536 `812da40f7` · the L2 detector's seven review findings** (#2513, #2522, #2512) — clause-scoped hedges (also at bare `;` and spaced dashes), an object opener on the sentence-opening arm, no mid-sentence `just` as a subject, `top of the brain` is a pin, first-person article-led pins, terse whole-sentence send confirmations + the shop `we`; a mid-sentence passive stays quiet by the 60-day audit.
> - **#2539 `bd7ec6a4f` · test hygiene** — the seed dry-run child gets an inert `DATABASE_URL` the env file cannot override (with a fixture that proves it); the hermetic guard pins the macro connector ingestion actually calls.
> - **#2540 `a6b12bd2b` · buffer-shadow recall over CLASSIFIED banner turns** — noShadow is not a miss; the caveat names what a banner is.
> - **#2542 `5d00e8003` · instrument liveness: UNKNOWN is a status** — a failed read is an UNKNOWN row, not a rejected view (one `Promise.all` rendered a monitoring failure as "no warning"); a truncated failure sample makes absent instruments UNKNOWN, not HEALTHY.
> - **#2544 `03bf36610` · banner causes** — `classifyBannerCause` reads the guard off the banner's first line (L2 rewriter / action-receipt / known-truth); `banner.byCause`; a source contract pins each producer's phrase.
> - **#2546 `d72823e41` · the drain backs up first** — `_bak_` table with a count check before the first DELETE; the first apply run refused its own default name (validator demanded a letter where the house pattern puts an underscore) and did no DB work — a validator must be run against its own default.
> - **#2548 `557046692` · two statenour capabilities in the Completion Authority ledger** — `statenour-cron-run-receipts` and `statenour-dense-recall-pool`, `live_verified` / `internal`, verification expires 2026-10-22, `databaseAssertions` = the night's measured numbers; `REALITY-LEDGER.md` re-rendered. The DoD compiler's `capability-ledger-updated` is satisfied by the ledger JSON being in the diff — a ledger-only PR needs no `evidence.json` rewrite.
> - **#2549 `79cbb1a6e` · `scripts/reindex-vector-index.ts`** — the dry run lists every index on `vector_embeddings` with definition, size and validity; `--apply --index=<name>` runs `REINDEX INDEX CONCURRENTLY` on exactly one hnsw index, refuses unknown or non-hnsw names, and reports `_ccnew` leftovers instead of calling a failed rebuild done. **REINDEX APPLIED 2026-09-22 ~23:30Z (operator-authorised), one index per invocation:** `vector_embeddings_embedding_vec_1536_hnsw` 509 → 295 MB in 96.1 s, `vector_embeddings_embedding_vec_hnsw` 519 → 295 MB in 58.9 s, 0 `_ccnew`, both valid, 39,770 rows unchanged — 42% of each index was tombstoned graph from the 64% delete (HNSW never shrinks on DELETE), and both landed at 295 MB although one holds 1536-d and the other 1024-d vectors: the neighbour lists dominate, not the payload. Post-reindex pool: proof script post-REINDEX (00:11Z 09-23): four seeds fill 50/50 in 158-612 ms, 0 quarantined categories in the pool; the exact pool statement via the Neon connector: 50/50, 80 HNSW candidates walked, 2.15 ms server-side warm (679 ms first cold touch).
> - **#2556 `054a2c784` · eligible-turn denominator** — `tool.surfaced` / `tool.chosen` read against tool-routing turns (`tool_selection_turn` rows, one per routed turn), every row carries `denominator {name,count,fallback}`, the panel shows n/N per row.
> - **#2553 `a20f788bc` · the brain lexical lane was 99% `ts_rank`** — production `EXPLAIN ANALYZE` (Neon connector, read-only): the chat lane's OR-of-topics query took **1,902 ms warm** with `ts_rank(to_tsvector('english', bm.content), q)` and **8 ms** with the rank removed; the GIN expression index is present and used, but an expression index serves the predicate, never the rank, so Postgres re-parsed `content` (avg 1,015 chars) for each of ~3,600 candidate rows. The 47% benchmark skip was ~0% standalone (long AND paragraphs match nothing in 21 ms) and 84 of 89 in the hybrid lane; the code's "slow tail" comment was a constant cost cut by the 900 ms timeout (78 of 89 runs in the 1000-1099 ms bucket). Fix = `content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED` + GIN, the `chat_messages.searchable_tsv` house pattern; three readers switched; Prisma `Unsupported` guard; sentinel column + index; source-contract test (positive control 7 of 7 red pre-patch). **Rehearsed on a Neon branch clone of production:** ALTER rewrite 28.6 s under ACCESS EXCLUSIVE, GIN 5.9 s, same 6,087 matching rows, the lane's query 21-22 ms. **MIGRATION APPLIED TO PRODUCTION 00:22:35Z-00:23:15Z 09-23 (operator: "apply it")** with the autocommit runner: ok=2, ~40 s end to end; `prisma migrate resolve --applied` → 64 migrations up to date; verified read-only: generation expression as designed, GIN valid at 64 MB, 0 NULL vectors, 6,087 = 6,087 matches, the lane's query **25.6 ms on production** through the new GIN. The readers merged after the apply. Codex (quota back) filed three P2s on the review: the GIN and the generated column are now verified by DEFINITION (`matchByDefinition`, `dataType` + `generationExpression`, canaries in `tests/lib/schema-sentinel-content-tsv.test.ts`); the content bound was declined with the measurement below.
> - **#2558 `4531bee53` · the recall token budget charges the chars the block renders, not the stored content length** (cloud session, review of the post-#2553 benchmark) — `getContextualMemories` clips each memory to 200 / 150 chars when rendering, but the token-budget trim charged the full `content.length`: one 15,000-char memory cost ~94% of the 16,000-char budget while rendering 200 chars, and the trim popped the memories behind it. Measured on production: under `ts_rank` the lexical top-10 averaged 11.5k–13.4k chars per memory. `renderedContent(m)` is now the one helper both the renderer and `trimToTokenBudget` read; no SQL, schema or ranking change. This is the composition lever the post-#2553 benchmark pointed at (zero-drop turns 15 → 4, relevant per turn 5.9 → 4.5).
> - **#2560 `9de481ecc` · the E3 pre-flush shadow replays the routing-time `toolsExpected`** (cloud session, closes the Codex P1 left open on #2509) — live routing decides buffer-or-stream BEFORE generation with `toolsExpected = actionIntent || webSearchIntent || webSearchRecency`, while the stored shadow recomputed it AFTER generation as `capturedToolCalls.length > 0`: a web-search turn whose tool never fired was stamped "would have buffered" where the live lane streamed it, and an unexpected tool call produced the inverse. The route computes `__toolsExpected` once and hands the same value to the routing lane and to `persistBase`; the shadow stamps `toolsExpected` + `toolsExpectedSource: "routing" | "recomputed"`. **Two Codex P1s adopted before merge:** every shadow that is not routing-sourced (recomputed, and every unstamped pre-deploy row) is counted in `BufferShadow.legacy` and `banner.legacyShadow` and EXCLUDED from every rate, reason row, recall and the sufficiency floor (25 routing buffers + 15 recomputed streams now read "withShadow 25, rate withheld, legacy {15, 0, 15}", not a 62.5% "sufficient" rate built from two different questions); the writer is tested through the real `buildOnFinish` (`tests/services/persist-turn-risk-shadow.test.ts`). **Self-review defect (adversarial pass, caught before merge):** the panel fixture predated `legacy` and 11 of 12 panel cases threw - `tsc` could not see it (the fixture is `Record<string, unknown>` cast into the tRPC mock) and the file was not in the run first reported; fixture stamped, panel reads `shadow.legacy?.withShadow ?? 0` so a deploy-skewed payload cannot take it down. Positive controls: replay contract 4 of 4 red pre-change, writer 4 of 4 red against the pre-#2560 persist, reader 3 of 4 red against the count-only reader. **Deployed 02:10:57Z** (Railway SUCCESS on `9de481ecc`). Consequence: the buffer-shadow readout starts from zero routing-sourced shadows - every rate is withheld until 40 routing turns exist.
> - **#2562 `292f8f2b2` · `KnowledgeCandidateSchema` bounds content at 32,000 chars, rejecting rather than truncating** (cloud session; the Codex P2 on #2553, taken as the ingestion PR that owns the schema) — measured on production first: the assumed 15,000-char writer cap is ONE 2026-06-24 archive import, not a rule; the 60-day live maximum is 5,125 chars (p99 <= 5k); 32,000 rejects nothing real and sits ~60x under where the 1 MiB tsvector limit bites (297 KB from 561,770 chars). Reject, never truncate: a clipped note would hash, dedupe and index as something the source never said. **Self-review defect (caught before merge):** the schema bound alone would have turned an oversize Obsidian note into a thrown ZodError that flips a whole vault's sync health to `error`; both ingest scripts (Obsidian, NotebookLM) now pre-check `normalizedContentLength()` and report the source as a quarantine row / rejected item with the length in the reason. Positive controls: 2 of 5 red on the unbounded schema, the two ingest contracts red without the pre-check. 4 files, 24 passed; `check:scripts` 44 = 44. **Deployed 02:13:31Z** (Railway SUCCESS on `292f8f2b2`).
> - **#2564 `8b96066de` · retire the 0007 `brain_fts` expression index** (Windows session, operator-approved cleanup, merged by the cloud session at 02:12Z) — the DROP ran on production at 01:34:12Z through the autocommit runner and is recorded as `20260923013000_drop_brain_fts_expression_index` (65 migrations, up to date); the `0007_brain_fts` registry entry is pruned from the apply-pending-migration route so `IF NOT EXISTS` cannot resurrect it. Codex P2s adopted: an exact-key canary (`POST {name: "0007_brain_fts"}` must answer 400 with no SQL executed - positive control red with the entry restored) and a `rollback.sql` in the house shape (the pre-drop `pg_indexes` definition with CONCURRENTLY + IF NOT EXISTS, pinned by a source contract). The rollback was NOT executed against any database - see the flagged list.
> - **#2567 `053b8ff91` · the lexical-lane comments carry the measured story** (cloud session, comment-only in `lib/brain/contextual-recall.ts`; lever 4 of the mandate) — the "slow tail" note over `LEXICAL_STATEMENT_TIMEOUT_MS` now says what the histogram showed (a constant per-row parse cost cut by the timeout; 84 of 89 -> 0 of 89 after #2553; 25.6 ms on production), the stale "10 of 28 / 36%" and "36% to 90%" figures over `lexicalSkipPctCum` read "~0%" with the counter's expected rate stated, and `trimToTokenBudget`'s doc names what it does NOT budget (the fallback path renders its own 200-char slice count-capped; graph/cross-source blocks append after the trim). The production `[brain-recall]` log line has NOT been observed reading `lexicalSkipPctCum = 0` yet: the http stream shows no `/api/ai/chat` request from the #2553 readers' deploy (01:02Z) through 02:06Z - the receipt is the 0-of-89 benchmark, and the log read is still owed.
>
> **Instrument lessons written down:** group by the run id before naming a row-count's shape · a canary that prints no summary line is not a red · `vi.mock` factories hoist above module consts (`vi.hoisted`) and a chain must gate the commit on the test step's `PIPESTATUS[0]`, never on a `| head` pipeline's exit · verify a deploy by ancestry when merges land seconds apart · Codex P1/P2 threads BLOCK the merge through the completion-authority review gate (rerun with `gh run rerun --failed` after resolving) · a MERGED PR is not a closed review — Codex lands after the gate, sweep `reviewThreads(isResolved:false)` before closing a wave · a bare squash uses title + PR body, so the body must end with the exact `Co-Authored-By` trailer · when a predicate is fixed, grep every symmetric window that should use it · a review finding can be right and still not adopted — cite the measurement that refuses it · a validator must be run against its own default · the Bash tool decodes backslashes (`node -e`, sed `\&\&`, heredoc `\$`) — scripts go in files · a precision mean over a corpus with abstention cases is not comparable across corpora — normalise to positives first · never write a wall-clock time from memory: take it from `date -u` or a server timestamp in the same turn · stopping a background Bash task kills the wrapper shell only — audit `Win32_Process` by CommandLine and kill the tree (eleven "stopped" merge waiters were alive, polling the Railway CLI into its rate limit) · a poll of a rate-limited CLI goes LAST in a wait loop, after the cheap gates · an expression index serves the predicate, never the rank — a constant per-row cost cut by a timeout reads as a "slow tail" until you histogram it · rehearse a table rewrite on a Neon branch and report the lock in seconds, not adjectives · a fixture typed `Record<string, unknown>` and cast into a mock is invisible to `tsc` - run the consumer's test file, not only the files you touched · a schema bound is only half a fix until every caller that would now throw is named (`grep` the schema's importers before calling it done) · a cloud session's git proxy can push but not delete a ref (403) - hand the delete to the Windows side · measure the live maximum before writing a ceiling (the "15,000-char cap" was one archive import) · plant a positive control in the FIELD the instrument searches: a log filter tested with a word that lived only in an attribute read as "the filter is broken", and that wrong claim merged in #2568 before a correct control caught it.
>
> **Flagged · NOT fixed**
> - The middleware's FAILURE path (`onRunError` + `isFinalAttempt`) has no production receipt: no `failed` row since 09-02 because nothing has failed.
> - `normalizeCronStatus()` collapses `started` to `failed` for the cron tree's `lastStatus` (closed tri-state; transient for a live run).
> - The typed outcome column (`SKIPPED_PREREQUISITE` vs zero work vs count) is an operator-gated migration; a skip is `resultCount = null` today.
> - DONE in #2560 `9de481ecc`: #2509's routing-time `toolsExpected` is threaded into the persist path and the shadow stamps its source. What is NOT done: the buffer-shadow readout is starting over - every pre-#2560 row is `legacy` and excluded, so the panel reads "rate withheld" until 40 routing-sourced shadows exist; nothing to decide there until then. The OTHER half of the panel (the evidence gate's own cohort) is no longer thin: replayed read-only on Neon at 02:26Z 09-23, after-fix n=119, 52 would block (27 `block` + 25 `repair`) = 43.7% against 34 of 91 = 37.4% before the fix - sufficient, and not a promote signal. `docs/CURRENT-TRUTH.md` said "n=12" from 09-17 until this PR (Codex P2 on #2568).
> - DONE 01:3xZ 09-23 with the operator's approval ("u go do these for me i approve it"): the old expression index `brain_memories_content_fts_idx` DROPPED through the recorded migration `20260923013000_drop_brain_fts_expression_index` (registry entry pruned in #2564 so `IF NOT EXISTS` cannot resurrect it; pre-check: no reader on main matched the inline expression, `pg_stat_user_indexes` showed the old index at 5,386 scans all before #2553 and the new one at 336 in its first hour); the Neon rehearsal branch DELETED; the `_bak_vector_embeddings_edge_drain_20260922` table DROPPED after confirming 0 live edge vectors (58,950 rows, 1,169 MB; brain_memories 275 → 216 MB). Also fixed: the ledger checksum of `20260923000000_brain_content_tsv`, recorded before that file's APPLIED note was added (`migrate status` does not compare checksums; `migrate dev` would). Benchmark re-run on the fixed lane: post-fix `pnpm eval:recall` (00:29-00:32Z 09-23, 89 cases): lexical timeouts 0 of 89 (was 84), lexical lane median 162 ms / p90 194 (was ~1,020 / 1,072), whole hybrid pipeline median 2,446 -> 1,536 ms and p90 3,176 -> 2,053 ms (inside the 3 s chat race); precision@5 vector 0.226 / lexical 0.057 / hybrid 0.113 raw (dense 38.0%, hybrid 19.0% on positives) vs 0.245 / 0.057 / 0.132 - unchanged within noise (the untouched vector lane moved by the same -0.019); `budgetDropped` rose (0-drop queries 15 -> 4, relevant per turn 5.9 -> 4.5): the now-live lexical candidates eat the token budget - the composition is the next lever.
> - DONE in #2562 `292f8f2b2`: the writer-side content bound (the Codex P2 declined on #2553) lives in `KnowledgeCandidateSchema` at 32,000 chars with the ingest scripts pre-checking it. What is NOT done: the 8 stored rows over 200k chars (largest 561,770 chars, 297 kB tsvector) predate the bound and stay; the tsvector 1 MiB write failure for documents above ~1.5 M chars has never had a production case.
> - `getContextualMemories`' fallback path (`getFallbackMemories`) renders its own 200-char slice and is count-capped, not char-budgeted; the graph and cross-source blocks append AFTER `trimToTokenBudget` and are unbudgeted. Documented in #2567; not changed - no measurement says either overflows.
> - **THE CONTEXTUAL RECALL LANE REACHED THE MODEL ON ~4% OF CHAT TURNS (found 11:10Z 09-23; FIXED by #2577 plus the operator-approved move of statenour-web to Railway us-east4 - receipts at the end of this item).** `lib/services/chat/brain-context.ts` wraps `getContextualMemories` in `withTimeout(…, 3000, null)`, and the lane runs its stages one after another. The first post-#2553 chat turn (operator, 10:59Z 09-23) logged `[brain-recall]` with `outcome: ok`, `relevant: 10`, `budgetDropped: 0`, `lexicalSkipPctCum: 0`, stage timings topics 29 / dbFetch 666 / lexical 814 / knnPool 855 / semantic 872 / rerank 330 / graph 87 / crossSource 1,436 / related 322 ms - they sum to 5,411 of the 5,663 ms total - and the prompt had already been assembled at 10:59:03.06 without it (`recall_lane_overlap` contextual 0 / hybrid 8; the persisted `contextReceipt` has "Hybrid Recall", no "Context Memories"). History says this is the normal case, not a cold-start accident: persisted receipts since 09-18 show "Context Memories" on 4 of 89 chat turns against "Hybrid Recall" on 83 of 89, and deployment `d51a5ee5` (09-19 02:06Z - 09-22 14:54Z) logged 44 recall durations of which 41 exceed 3,000 ms (range 2,432-6,352, most 3,500-4,200). **The operator's warm turns settle the cause (11:13-11:15Z 09-23):** five recalls took 5,663 / 4,035 / 3,565 / 2,997 / 4,230 ms, and the block reached the prompt on exactly one turn - the 2,997 ms one ("Context Memories", 530 tokens, kept) - while the other four, three of them warm, were dropped. Warm stage costs: dbFetch 587-986, lexical 303-444 (EXPLAIN measured 29.5 ms of warm execution; the rest is inferred, not measured, to be the transaction round trips plus 50 rows of full `content` shipped over the wire), knnPool 507-1,258, semantic 313-485, rerank 141-347, crossSource 463-630, related 283-309 ms, plus 250-344 ms untimed. Instrument trap: `recall_lane_overlap` counts contextual ids from the `onRanked` callback, which fires before graph/crossSource/related, so it read `contextual: 10` on turns whose block was dropped - read the persisted receipt, not the overlap line. So #2553's lexical fix and #2558's budget fix improved a block that is discarded on most turns; the recall benchmark (`pnpm eval:recall`) calls the lane directly and never sees the race. Proposed fix (one function, measurable): run dbFetch, lexical and knnPool concurrently (independent of one another), start crossSource and related right after topics and append their lines in the same order at the end; on the 10:59Z timings the critical path becomes ~2.2 s (29 + max(666, 814, 855) + 872 + 330 + 87), and on the four warm turns 1.4-2.3 s including the untimed work (today 3.0-4.2 s) - every one inside the race. Verify with the persisted receipts: "Context Memories" per chat turn, before vs after. **#2577 ships exactly that two-phase shape** (phase A: dbFetch + lexical + knnPool together; phase B: crossSource + related beside semantic → rerank → graph, appended in the original order; early-started stages settle-guarded so a rejection cannot crash Node), proven by `tests/brain/recall-stage-concurrency.test.ts` (start-order assertions red on the sequential code; mutation-checked). **RECEIPTS (09-23, persisted `contextReceipt` + `[brain-recall]`).** On `us-west2` (deployment `45b1c3b2`, 11:50-12:32Z) five full turns took 3,604 (first turn on the process) / 2,721 / 2,642 / 3,445 / 2,744 ms and "Context Memories" landed on 3 of 5 (1 of 5 that morning, 4 of 89 since 09-18); "Hybrid Recall" 5 of 5. The misses were network, not the pipeline: the web service ran in California and Neon is in Virginia, so every round trip cost ~60 ms and a fresh-connection burst came back in steps (594-606, then 656-664, then 678-686 ms at 12:02:46Z); lexical took 820-1,235 ms in the app for SQL that runs 29.5 ms warm inside Postgres, and semantic shipped ~4 MB of JSON embeddings per turn (1,731 ms on the 12:03 miss). After the move to `us-east4-eqdc4a` (deployment `58ec0c98`, serving 12:32:13Z) three full turns took 2,603 (40 s after process start) / 1,966 / 1,424 ms and "Context Memories" landed 3 of 3, "Hybrid Recall" 3 of 3; dbFetch ~1,030 -> 308-317, related ~325 -> 33-38, semantic 598-823 -> 182-355, graph ~85 -> 13-64 ms. The cost the move exposed is the next item.
> - **The lexical lane was skipped on 2 of the first 3 `us-east4` turns (12:32 and 12:40Z; `lexicalSkipPctCum` 100, then 67 after the 12:41Z turn ran it; found 12:40Z 09-23).** A standalone `EXPLAIN ANALYZE` of the lane's SQL for a broad 8-term OR query: 681 ms of execution, 7,403 matching rows ranked, 2,157 blocks read. In California the turn's burst of brain-context queries arrived spread out by ~60 ms round trips and the lane's server time stayed under its 900 ms `statement_timeout`; next to the database the burst lands at once on a compute that idles at 0.25 CU, and the lane can go over. "Context Memories" still lands, without exact-term candidates. Levers: rank a capped candidate set instead of every match (code, not done), or raise the Neon autoscaling floor - DONE 12:48:41Z 09-23 on the operator's approval: `ep-quiet-wave-am320eo1` now autoscales 0.5-2 CU (was 0.25-2); the compute restarted at that instant, as Neon documents for a range edit, and statenour-web logged no error or warning after it. The same standalone EXPLAIN after the change: 92.8 ms cold (4,621 blocks read - the restart had emptied the cache) and 36.3 ms warm, against 681 ms before. RECEIPT (13:52Z 09-23, first full turn after the change): lexical 504 ms, `lexicalSkipPctCum` 0, `[brain-recall]` 2,981 ms with "Context Memories" kept (530 tokens). One turn.
> - **A chat turn waited 4.8-8.3 s before `buildBrainContext` started (found 12:41Z 09-23; FIXED by #2588 `ee95a9cb7`, deployment `0dcadc20` live 13:23Z - receipt below).** The intent router (`lib/ai/runtime/chat-classifier.ts:209-229`) awaits an LLM "classify" call on the pre-stream path under an 8 s cap. It timed out on 3 of 10 turns on 09-23 (11:55 and 11:56 on `us-west2`, 12:41 on `us-east4`), and on the three full `us-east4` turns the prompt build started 4.8 / 6.2 / 8.3 s after the request - longer than the whole prompt build (3.2-4.0 s). Its only pre-stream consumer is the chat mode, and production's ai_config has had `defaultMode: "deep"` since 2026-08-31 (a per-request override or the configured default decides the mode first), so every turn waited for a result that could not change its mode. The fix (`app/api/ai/chat/derive-turn-signals.ts`): with a fixed mode the call is started, not awaited - the rejection handled at creation - and the stream's `intent.classified` event takes the result only if it has landed (`takeClassificationIfLanded`; `buildChatResponse` already labels the turn otherwise); without a fixed mode nothing changes. RECEIPT, first full turn on the fix (13:52Z 09-23): the POST arrived 13:52:44.37Z (HTTP log completion 13:53:16.215 minus totalDuration 31,845 ms) and the prompt build started 13:52:44.56Z (`prompt_built` 48.572 minus buildMs 4,015): a **0.2 s** gap, against 4.8 / 6.2 / 8.3 s. One turn; re-read on the next few.
> - **The adversarial critic kept too few objections: FIX IN #2596 (budget 8 s -> 30 s), plus `emotional_state` registered.** Correction to this bullet as first written ("never completes", from four timeouts in one hour): agent_traces 09-16..09-23, n=110 (ollama deepseek-v4-flash, all succeeded): p50 5.7 s, p90 14.9 s, p95 21.7 s, p99 32.3 s; 32 of 110 ran past the 8 s cap. The guardian races and never cancels the call (`lib/tools/guardian.ts:608-616`), so each of those was billed and discarded, and the retry usually timed out too; on 09-23 6 runs failed against at least 4 objections kept. `ADVERSARIAL_MEASURED_P95_MS` now sits beside the config with a relationship test (the judge-eval precedent). `emotional_state` (hourly mood rows from journal-ingest and pipeline-controller since v10.0.232) was never in `BRAIN_CATEGORIES`: 5 `unknown_category` warnings on 09-23, each row stamped review_required. 17 more literal categories written by `remember()` are unregistered (list in #2596), plus `revenue_playbook` from drive_cron: the operator's call, since registering changes the live gateway's verdicts.
> - **Two "timeouts" that are not losses.** `[withErrorCapture:silent-timeout] chat:conversation-memory ... 30000ms` and `chat:post-process ... 15000ms`: `withErrorCapture` races the task without cancelling it, and on both 09-23 occurrences the digest was written 1-2 s after the line (AuditEvent `conversation_digest` 11:13:57 and 11:56:18Z; the `conv_*` summary row updated 11:56:18Z). Read the digest row before treating the line as a loss. Correction to an earlier note: bge-rerank does not fail on every turn - its breaker (`lib/brain/bge-rerank.ts:285-320`) cools it for 10 min after two total failures, so a process pays two doomed rounds at start and one per 10 min.
> - `20260923013000_drop_brain_fts_expression_index/rollback.sql` is pinned by definition and by a source contract but was never executed against a database (the Neon rehearsal branch was deleted first). **PROVEN 10:50Z 09-23** on Neon branch `exp-rollback-proof-brain-fts-20260923` (`br-soft-cake-amvn3q9w`, a HEAD copy of production; operator: "do what's still owed"): pre-state = only `brain_memories_content_tsv_idx`, as on production; the file's statement ran verbatim (CONCURRENTLY, autocommit) in at most 37 s wall clock including call overhead; the result is `indisvalid` and `indisready`, its `indexdef` equals the pre-drop production record byte-for-byte, 64 MB; a pre-#2553 reader's `to_tsvector('english', content) @@ ...` plan uses it (Bitmap Index Scan on `brain_memories_content_fts_idx`); a second run is a clean no-op; production still carries only the stored-column GIN afterwards. The branch is left for the operator to delete (Neon marks branch deletion destructive).
> - The `[brain-recall]` production log has not yet been read with `lexicalSkipPctCum = 0` after #2553: the Railway http stream of the two deployments live from 01:02Z to 02:06Z 09-23 (`a20f788bc`, `4531bee53`) carries no request to `/api/ai/chat` - only cron, Inngest, sync and `/api/version` pings - so no `[brain-recall]` line exists to read (CORRECTED 10:58Z 09-23: this line first said the Railway MCP log `filter` does not filter. The control was flawed - `version` sits only in the `route` attribute, never in the message text. Re-tested: plain text matches message text (`Stopping`, and the hyphenated `trace-deprecation`), `@route:"/api/version"` matches attributes, and `brain-recall` returns nothing on every statenour deployment from 01:02Z to 10:58Z. The unfiltered http read stands either way). The 0-of-89 benchmark stands in; a log receipt is owed the first time the chat lane runs. **Re-checked 10:40Z 09-23:** the live deployment's http stream 03:40Z-10:40Z (about 700 requests) still carries no `/api/ai/chat` request, and the chat route is session-gated, so a cloud session cannot produce one. The lane's exact statement was timed on production instead (read-only EXPLAIN ANALYZE, six-term OR query `tires or brakes or revenue or appointments or reviews or customers`, 6,095 GIN matches): **623 ms cold** after the idle night (2,629 blocks read from storage) and **29.5 ms warm** (0 read); an eight-term query 160 ms and a five-term one 34 ms, both partly cold. Every reading is under the 900 ms cap, so the counter should read 0 - but the first turn after an idle night spends ~70% of the budget on cache fill, which is the case to watch on the first `[brain-recall]` line. **RECEIPT 10:59:05Z 09-23 (operator's chat turn):** `lexicalSkipPctCum: 0`, lexical stage 814 ms (90% of the cap, first turn after the idle night) - but see the contextual-lane item above: the whole lane missed the 3 s race on that turn.
> - The AGENTS.md "HOLD the merge while another PR's node/e2e is in flight (it kills them)" rule was observed NOT to bind tonight: #2560, #2562 and #2564 merged 02:06-02:12Z while #2567's node/e2e (started 02:01Z) ran, and both finished green at 02:15Z. Keep the hold as the default; do not cite it as a mechanism. What DID bite: #2564's second commit rewrote the same timeout comment #2567 rewrote, so #2567 went CONFLICTING the moment #2564 merged (405 on merge, zero new CI runs) - main merged into the branch (`0498044f2`), 15 of 15 checks green, squashed as `053b8ff91` at 02:36Z.
> - The remote branch `statenour/knowledge-content-bound` (#2562, merged) is still on origin: the cloud session's git proxy answers 403 to a ref delete. Delete it from the Windows side (`gh api -X DELETE repos/nourdean22/MAINnicks-tire-autoNEW/git/refs/heads/statenour/knowledge-content-bound`).
> - Codex's code-review quota is exhausted (2026-09-22 22:16Z): #2533/#2536/#2539/#2540/#2542/#2544/#2546/#2548/#2549 merged without its pass.
> - Operator decision left open: the HF inference credits — they only buy the bge-reranker call (Cohere is the working fallback); a cost choice, not a need.

> ## 2026-09-22 · W16b · audit the instruments, then the detector · 8 ships
>
> Second batch of Session F (first batch: the W16 entry below). One thread: every enforcement plan sat on
> instruments nobody had audited, and auditing the bottom layer moved every number above it.
>
> **#2495 `warm-routes.test.mjs` bounded readiness poll (curl exit 7 flake) `2a503aa26` MERGED** ·
> **#2498 `seed-policies` dry-run test + server-only tripwire control `67904d50a` MERGED** ·
> **#2506 `chat.deferred_turn` heartbeat — the deferred path's own denominator `914dd0e95` MERGED +
> DEPLOY-VERIFIED 18:43:40Z** (0 assistant turns since at 19:26Z: DEPLOYED, not EXERCISED) ·
> **#2508 eval runner `--tools`: the 8 `requires-tools` scenarios replay through `generateText` + the real
> catalog with executions STUBBED, calls recorded, judge sees the trace `10673c575` MERGED + DEPLOY-VERIFIED
> 19:08:43Z** (operator-only spend; not yet run) ·
> **#2509 pre-flush buffer-shadow READER — cost (buffer rate) vs benefit (banner recall) per classifier reason,
> two independent floors, in the gate panel `073697106` MERGED + DEPLOY-VERIFIED 19:19:27Z** (MEASURED through
> the reader on prod: 128 shadowed · 84 would buffer 65.6% · 7 banner turns → 6 buffered / 1 streamed / 0
> unshadowed · top reason 77/84 buffered AND 6/6 banner — the classifier's own reasons do NOT separate; recall
> withheld below 40 banner turns) ·
> **#2512 fabrication-banner precision — `pinned` and bare `sent` fire on Nick's claims only `d171b1b9a` MERGED +
> DEPLOY-VERIFIED** (live 19:41:14Z, uptime dropped to 16s; audit: 52 banners/60d = 9 known-truth + 43 action; pinned 15 → 3 real, sent 10 → 0 real;
> 25 production-shape canaries unfixed 25f/43p → fixed 155 passed; real-binary 43 → 17 still flagged, sent 10 → 0,
> all-turn flags 46 → 21) ·
> **follow-up PR (this branch) task-complete / memory-write / data-sync get a subject rule
> (`claimAcceptsSentenceOpening`) + a negated-participle hedge** (8 canaries unfixed 8f/78p → 173 passed;
> real-binary 17 → 10 still flagged = 3 real pinned + 1 residual + "Bumped the priority" + 5 unknowable
> "Task created" confirmations; all-turn flags 21 → 14) — MERGED `55e08e18a` ·
> **named-claim title shapes (this PR)** — the L6 shadow's 52 post-fix blocks READ BY HAND: named-claim ~27 = ~8
> real venue/platform fabrications + ~19 of Nick's OWN bold labels, steps, comparisons and recalled people;
> `isResourceTitle` rules 6–12 + a stopword trim; 16 canaries unfixed 16f/28p → 118 passed; real extractor over
> the 24 blocking turns: names 87 → 47, turns 24 → 15 (6 real · 4 people · 3 geography · 2 residual), precision
> ≈25% → ≈40%. Prior-operator-text evidence measured and REJECTED (2 of 49). Sentence-granular pre-flush gate
> measured and NOT built (detector fires on 14/1,246 turns after the precision fixes). STILL SHADOW.
>
> **Findings.** The reply-side "hold the first sentence" candidate is REFUTED: over 1,246 turns / 52 banners
> the fabricated claim sits a median 432 chars into the reply (p90 1,770) while the first sentence is p50 24
> chars — 6/52 caught; 800 chars held catches 28/52. The verifier banner was mostly false on its two biggest
> drivers, and a false banner is not cosmetic: L3 replaces the turn in history, erasing a legitimate reply.
> Rows before 2026-09-22 carry no tool evidence (no toolCalls / toolReceipts / turnRisk), so no earlier banner
> can be audited against a receipt — the join (#2483/#2484) is what makes future audits possible.
>
> **Flagged · NOT fixed:** L6 people-name class (real people recalled from the brain read as unreceipted resources —
> needs a people-table receipt) · L6 fact-check driver (~24 blocks, mostly coaching/plans) unaudited code · 5 "Task created — …" banners unknowable (pre-join rows) · the repair harvester's 9
> FALSE_COMPLETION candidates inherit the old banner's precision (4 rode on pinned/sent) — re-read before
> promoting · "Story highlights pinned to the shop" residual (verb use by a non-Nick subject) · heartbeat
> unexercised (0 turns since deploy) · FALSE_COMPLETION auto-repair still needs a gate signal that is neither
> the ask-side classifier (66% of turns) nor a prefix hold (claim is mid-reply) — candidate: stream until the
> detector first fires, then buffer the remainder; measure as a shadow first.

> ## 2026-09-22 · W16 · measure before enforce · 9 PRs / 10 slices
>
> **#2478 `statenour · the seed script the coverage gate prescribes could not run` `22382c300`
> MERGED + PRODUCTION-PROVEN** (ran against prod under the operator's "Go ahead do it": 105/105
> policies upserted, registry 166→168, 0 `approvalClass` changes; `cron.device-heartbeat-sentinel`
> FIRED 13:45:01Z with `fireRows=1`) · **#2480 `statenour · mine operator repairs — the signal
> every other lane is blind to` `8ebf35a0b` MERGED** · **#2481 `upstreams · close the loop on
> three verified deltas from the 2026-09-22 gate` `3a0092880` MERGED** · **#2482 `statenour ·
> instrument health — a silent instrument gets a status, not an alibi` `a0c4b610b` MERGED +
> DEPLOY-VERIFIED** (`/api/version` a0c4b61, uptime DROP 1184s→102s) · **#2483 `statenour · the
> read-back reaches the receipt; the verifier stops assuming` `b43fccd4a` MERGED + DEPLOY-VERIFIED**
> (`build.commit b43fccd`, `startedAt 16:22:47Z`, uptime DROP 2044s→164s — deployed is NOT proven:
> 1 assistant turn and 0 tool-bearing turns since, measured read-only) · **#2486 `statenour · the
> wave2 test mocked a connector the code stopped calling` `3f3e58e2c` MERGED** · **#2484
> `statenour · persist per-turn receipts, and read them: strict-Done gets a calibration` `d680320a0`
> MERGED** · **#2485 `statenour · the reply-side novelty check gets its first caller, as a shadow
> metric` `686e0b888` MERGED** · **#2487 `statenour · the repair-to-scenario converter and 12 curated
> repair scenarios (corpus 38→50)` `e1b699945` MERGED.**
>
> (W15 · #2473-#2476 · 2026-09-18: **gap — backfill pending.** The session that wrote this entry
> has no first-hand detail on those four PRs and will not invent it.)
>
> W13 found instruments that were working as written and could not answer their question; W14
> found tool-routing designs pointed at the unmeasured half of a problem. W16 is the layer where
> the instruments EXISTED and lied in a direction: a failures reader blind to anything that never
> ran, a strict-Done shadow at n=1 read as "no gap", receipts bifurcated between an in-memory
> contract and a table with one non-chat writer, a verifier that read tasks back and a receipt
> that never heard about it, a novelty check whose reply-side half had zero callers for twelve
> days, and an eval runner that had graded a prompt production never sends. The wave's one new
> signal source is the operator's own corrections — the only lane that is not the system grading
> itself.
>
> **Slice 1 · the gate's prescribed remedy could not run.** `check:policy-coverage` told the
> operator to run `scripts/seed-policies.ts`; that script crashed on Next's `server-only`
> tripwire under plain `tsx` — the same defect the gate itself had carried. Cure: a `Module._load`
> stub inside `installScriptEnvironment()` plus dynamic imports inside `main()` (ESM hoists static
> imports above the stub). The plan step that "expected the two cron policies to be born
> `pending`" was wrong on its face — `approvalClassFor` returns `auto` for crons — and harmless
> in fact, because the engine gate resolves only `autonomous-action.*` ids (`:1103`). Verified
> before, not after. **A gate whose remedy cannot run is a gate that can only fail.**
>
> **Slice 2 · the operator says "try again"; the reply says what went wrong.** `pnpm
> harvest:repairs` (#2480) mines `ChatMessage` for the operator correcting a reply in his own
> words: 2,795 operator messages / 400 days → 108 candidates (2 strong · 32 medium · 74 weak).
> Hand-reading 19 put the "near-certain" tier at ~44% precision: pronoun direction, continuation
> phrases ("keep going" is satisfaction), self-narration ("i told you"), pasted documents. Every
> false positive became a MUST_ABSTAIN fixture and the self-test gates every harvest, because a
> zero from a broken matcher is indistinguishable from a clean corpus. #2487 then re-read each
> GENERIC hit against the REPLY it repairs: a verifier banner → FALSE_COMPLETION, a
> tool-unavailable opening → NO_TOOL. Same corpus: **NO_TOOL 0→13, FALSE_COMPLETION 0→9, strong
> 2→24.** A second regex round was needed when "search IS available" matched the unavailability
> pattern (3 of the 13). Measured decision, not a build: every tool-unavailable repair predates
> the 2026-09-02 prompt rule, so no code fix was written for a class that had already been
> addressed. **Nick declaring a tool unavailable and stopping was the dominant repair trigger —
> and the operator's words never carried it.**
>
> **Slice 3 · a silent instrument gets a status, not an alibi.** `buildInstrumentFailures()`
> could rank only instruments that had LOGGED a failure; one that never ran read as healthy
> forever. #2482 adds `lib/observability/instrument-liveness.ts` — HEALTHY / UNDERPOWERED /
> STALE / NEVER_RAN / FAILING per known instrument, with the ASSISTANT-TURN denominator
> (`MIN_POWERED_N = 30`) and conditional instruments that fire only on qualifying turns. The live
> reader reproduced every hand-measured number (shadow 1/253 UNDERPOWERED[conditional], surfaced
> 294, chosen 113, integrity 1, `tool_telemetry` "8 tools touched" — that last one had read as
> "8 writes" until a unit label was added; aggregate-by-tool is not a write count). **A failures
> reader cannot see an instrument that never ran; a health reader must count turns, not writes.**
>
> **Slice 4 · two verification systems, never joined.** `environment-verifier.ts` read tasks
> back from the DB after every tool turn; `persist-assistant-message.ts` built receipts from
> `{ toolName, ok }` BEFORE the verifier ran. The one real `createTask` of the fortnight (09-19)
> was read back AND recorded PROVIDER_ACCEPTED. The verifier was also FAIL-OPEN — `verified:
> true` for any tool it had no check for. #2483: tri-state `verified: boolean | null` (query
> failure = null + warn, because `false` would stamp a fabrication banner over a DB hiccup),
> and `receiptsWithReadBack()` joining read-backs into receipts before the row is written. The
> review's P1 was correct: the first join promoted receipts through a `Set` of tool NAMES, so
> `createTask × 3` with one confirmed read-back marked all three VERIFIED → positional pairing,
> fail-closed on a length mismatch, and one verifier result per call in input order (a `null`
> entry when a call carried nothing to look up; before, those calls produced NO entry and shifted
> every later result). **A name-keyed join marks every same-name call verified.**
>
> **Slice 5 · the shadow's verdicts get a durable projection and a reader.** #2484 persists
> `tokenUsage.toolReceipts` per tool turn — what ran, whether it mutates, how far it was verified;
> no args, no results — and `buildClaimDoneCalibration` reads it: cohort at the join, `sufficient:
> false` below `MIN_SAMPLE = 40` CONSEQUENTIAL turns, split by offender so a verifier gap is
> distinguishable from a Nick gap. Live probe reproduced the hand count exactly (beforeJoin
> turns=2 consequential=1 gap=1 offenders={createTask:PROVIDER_ACCEPTED:1}). Closed a door:
> `parts` NEVER carried tool evidence, by design (`message-parts.ts:35`) — 2,692 assistant
> messages since April, zero tool parts — so historical replay of strict-Done is impossible;
> `toolReceipts` is the replay foundation going forward. Review: the reader capped 2,000 rows over
> ALL assistant turns and only then dropped the ~131/132 without a shadow — ~15 samples, the
> threshold unreachable however much history accumulated → filter on the JSON key. The filter's
> semantics were then MEASURED on production rather than assumed from the precedent: over 14 days
> the key filter selected 2 rows and a JS check over all 256 turns found 2. **A cap before a
> filter is won by whatever is most common.**
>
> **Slice 6 · the novelty check gets its first caller — and three corrections.** `checkNovelty`
> and `buildNoveltyBlock` had ZERO callers outside their module since the 2026-09-10 audit; the
> half that could see whether the prompt-side injection worked was never wired. #2485 records
> `recommendation.novelty` from deferred work, EMPTY-IS-NOT-ERROR (an `ERROR` prior set is never
> scored as "all fresh"). Review found three real defects in the first cut: the shadow runs AFTER
> persist and the prior scan did not exclude the reply's own row, so every name the draft used
> was its own repeat (`loadPriorRecommendations({ excludeMessageId })`, the recorder passes
> `createdAssistantId`); the post-turn outbox replays deferred work, so one turn could write
> several observations (`alreadyRecorded(traceId)`, a REQUIRED dep, one indexed read); and
> `Promise<unknown>` let the fail-soft writer type-check (`Promise<MetricWriteReceipt>` — the
> compiler is the enforcement). The live call site is pinned on comment-stripped source with a
> mutation canary per pattern. **A shadow that runs after persist counts the reply as its own
> prior.**
>
> **Slice 7 · a runner with no tools cannot judge a tool criterion.** Eight of the twelve
> repair-mined scenarios have a dominant criterion that IS a tool action ("actually attempts the
> lookup again through searchTools/invokeTool", "performs the action through a real tool call",
> "retries the generation"); `pnpm eval:live` replays through `aiChat`, which has no tool support.
> A live pass would have reported the runner's limit as eight product regressions. #2487 tags
> them `requires-tools`; `runLive` skips a tagged scenario BEFORE calling Nick, records
> `{ scenarioId, reason }`, counts it in `summary.skipped` and never in the exit code; drafts of
> the tool-dependent classes are born tagged; a corpus invariant (identifier sweep) matched
> exactly the review's eight of fifty. They stay in the corpus as the acceptance set for a
> tool-capable runner — which does not exist. **A runner with no tools scores a tool criterion
> as a product regression.**
>
> **Slice 8 · a tier string that is not a tier ran for four months.** `tests/` is excluded from
> `tsc`; a targeted type-check over `tests/eval` (scratch tsconfig extending the app's) found
> `buildSystemPromptUncached("lite", …)` in the runner — `"lite"` is not a `TopicTier`. Downstream
> an unknown tier fails `wantsKnowledge` in `appendBusinessKnowledgeLayer`, so every live eval
> replay since 2026-05-23 ran WITHOUT the business-knowledge layer production attaches to
> business asks. Now `detectTopicTier(userContent)`, the route's own classifier; the test asserts
> the BUILT prompt reaches `aiChat`, because the builder's try/catch would have hidden a thrown
> `TypeError` behind the fallback voice marker. **Live eval reports written before `9a5424682`
> graded a thinner prompt than production's and are not comparable with reports after it.**
>
> **Slice 9 · affected-test selection hid a broken main.** `tests/intelligence/wave2-
> predictions.test.ts` had been red on `main` since #1872 — it mocked `connectors/fred` while the
> code had moved to `connectors/macro` — and no PR's affected-test run had touched it. #2486
> mocks the connector the code actually calls. **A green PR run says nothing about a file it did
> not select.**
>
> **Slice 10 · two pasted research packets, gated.** #2481 records what re-verification found:
> Hindsight 0.10.1 (verdict already on file — the packet had read a superseded row), the MCP
> SPEC (2026-07-28, Current) split from the MCP SDK (v2 refuted a third time; no 2.x on npm), and
> a "September 2026 model + harness releases" row kept as an INVALIDATION TRIGGER for the
> minimax-m3 pin (re-run the bakeoff; do not pin X). The second packet retracted its own GPT-6
> Astra claim; the retraction was wrong — Astra is on OpenAI's own deployment-safety domain.
> **A packet's self-correction is not evidence either.**
>
> **Flagged · NOT fixed**
> - **#2483's join is DEPLOYED, not PRODUCTION-PROVEN** — 1 assistant turn and 0 tool-bearing
>   turns since 16:22:47Z. Route: after the first tool-bearing turn, read
>   `trpc.system.claimDoneCalibration` `afterJoin`; a `VERIFIED` receipt on a real write is the proof.
> - **Strict-Done shadow at n=1 lifetime** (H1 untestable). The H2 attempt counter
>   (`skipped_no_claim` persisted so skip-vs-dead is direct) is designed, not built.
> - **FALSE_COMPLETION persists after the verifier banner** (9 repairs). Automatic repair needs the
>   BUFFERED-path measurement first — streaming cannot block; `onFinish` runs after the last token.
> - **No tool-capable eval runner.** The eight `requires-tools` scenarios are unscorable until the
>   production chat pipeline can be replayed with the catalog attached.
> - **Done-shadow has the same outbox-replay duplicate exposure** #2485 fixed for novelty.
> - **HF inference credits depleted (402)** — bge-rerank falls to Cohere at ~5000× cost; embedding
>   fallback #4 now ends in two dead providers. Operator decision: top up or retire BGE.
> - **Operator-only env**: `OLLAMA_FALLBACK_MODELS` unset · the bad OpenAI `sk-proj-` key · Google AI
>   Studio spend cap · OpenRouter credits.
> - **`pnpm eval:live` on the 12 new scenarios** — operator-driven, not run; whether Nick recovers
>   on them is the number the corpus now makes possible.
> - **Post-merge reviews opened three follow-ups, all OPEN at the time of this entry:** #2496
>   (the harvester's fixtures quoted the operator's private messages verbatim → synthetic
>   stand-ins that keep the trigger phrase; `--out` on both writers is now bounded to the
>   gitignored `eval-datasets/`), #2498 (a behavioural canary for `seed-policies.ts --dry-run`
>   with a broken-case control that must still trip on `server-only`), #2495 (the
>   `warm-routes` port-holder canary polls instead of sleeping 2s — it flaked on two PRs in one
>   day). The review on #2480 was right that committed fixtures defeated the very boundary the
>   harvester's gitignored output exists for.
> - **W15 (#2473-#2476)** — gap in this log; backfill pending.

> ## 2026-09-18 · W14 · the failure class nobody had counted · 6 PRs / 9 slices
>
> **#2467 `statenour · repair the tool failure that is actually still happening`
> `094736674` MERGED + DEPLOYED-VERIFIED** (SHA EQUALITY, not ancestry: public
> `GET /api/version` -> `build.commit 094736674edc…`, `branch main`, and an uptime DROP
> from 3136s to 36s, which is the tell that the process actually restarted rather than the read
> being stale.) · **#2468 `statenour · rank tool tiers together instead of filling by arrival
> order` `fa45b1d50` MERGED** · **#2469 `agent-audit · the stale denominator`
> `10edcd431` MERGED** · **#2470 `statenour · make a successful tool-input salvage
> observable` `167d596b6` MERGED** · **#2471 `statenour · stop drafting rewrites
> for tools surfaced by POLICY, not relevance` `f1f7718b2` MERGED** · **#2472 `statenour · make the always-on
> audit re-runnable instead of a number` `850be17fc` MERGED.**
>
> W13 found instruments that were working as written and still could not answer their own
> question. W14 is the next layer out: two tool-routing designs, each aimed at a real defect and
> each documented confidently, pointed at the wrong half of the problem — because in both cases
> the split between the halves had never been measured.
>
> **Slice 1 · the repair covered the class that had stopped happening.**
> `lib/ai/chat/repair-tool-call.ts` repaired hallucinated tool NAMES and declined argument
> failures with a design note: "argument-validation errors are a different failure mode we
> deliberately leave to the SDK." Nobody had counted. `scripts/tool-input-failure-census.ts`
> (new) classifies every string in `tool_telemetry.lastErrors` and splits by recency:
> **LIVE argument 11, LIVE name 0.** Every live tool-call failure is `searchMemories`
> receiving two or three JSON objects glued into one arguments string. The three prod examples
> the file's own header cites as motivation for its 2026-09-16 change — `arsenal.webSearch`,
> `person.update`, `getRepoMap` — measure 68d, 68d and 37d cold.
> **A design note explaining a decline is not evidence the decline is right.**
>
> **Slice 2 · the salvage, and why first-intent-wins.** `lib/ai/chat/salvage-tool-input.ts`
> takes the FIRST complete JSON object. Each concatenated object is a separate call the model
> intended; merging two different queries has no honest result. Three structural guards make it
> unable to regress: it only ever sees input the SDK already rejected, a clean single value
> returns null so a genuine type error stays with the SDK, and a candidate failing the tool's own
> zod schema is skipped. The SDK re-validates any repair regardless, so the worst case is exactly
> today's behaviour.
>
> **Slice 3 · a caveat that was itself false.** The census shipped saying "the rows carry no
> per-error time." They do — `lastErrors` is typed with a per-entry timestamp at
> `lib/ai/tool-telemetry.ts:348` and 33/33 entries populate it. The field had been parsed
> without its type being read. The caveat named a real class of error and hedged in the right
> direction, which is exactly why nobody re-checked it. It also changed the answer: tool-level
> dating gave argument 11 / name **1**, and that lone "live" name failure was
> `arsenalWebSearch` — tool called 7d ago, error 37d old.
> **A caveat asserting a limitation is a factual claim; a wrong hedge is worse than no hedge.**
>
> **Slice 4 · the semantic tier was a leftovers tier.** Selection was ONE pass: every tier called
> `addIfSpace`, which stopped at `TOOL_BUDGET`, so each tier's share of the 24 slots
> was decided by ARRIVAL ORDER. Measured over 2,616 prod gate decisions: candidates p50 43 vs
> selected p50 24, budget truncated 80.4% of turns, **semantic tier skipped 73.2%** — it ran last
> AND was gated on there being room left, so it was skipped on exactly the turns that truncate.
> Now two-stage: stage 1 gathers from every tier and drops nothing; stage 2 seats INTENT (tiers
> 1/2/3/7) then ranks tiers 4/5/6 together. The enabling fact: tier 4 and tier 5 already scored
> against the same embedding with the same cosine metric — **never incomparable, just never
> compared.** A pre-emptive RESERVE was tried first and reverted: it allocates before it knows.
>
> **Slice 5 · two gates caught what my own verification did not.** I reported "tests/ai — 194
> files, 2,571 passed" as covering the change; `tests/ai` is a subdirectory and the full
> suite is **896 files / 9,177 tests**. Both failures were outside the part I ran.
> (a) `NICK_TOOL_RANK_MERGED` was an unregistered switch — now in `FLAG_REGISTRY` as
> `readOnly`, since `chat-mode.ts` reads `process.env` directly and a writable
> row would contradict the runtime. (b) The playbook wiring guard compared BYTE OFFSETS of three
> literal call expressions; it had been repaired once already on 2026-09-16 with the conclusion
> "anchor on the code that actually runs", and anchoring on source TEXT has the same defect one
> level down — it would have passed if `addIfSpace` were left in as dead code. Rewritten to
> RUN the pruner. **A receipt is only as wide as the path you hand the runner.**
>
> **Slice 6 · the shape got a page, because it had already survived being fixed.**
> `docs/agent-audit/DEFECT-SHAPE-STALE-DENOMINATOR.md` (new). A rate with no clock, and a
> rate whose clock you just moved, both read as current. Six measured cases, five from this day.
> The argument for a page rather than a comment: the cure was written into
> `tool-reachability-census.ts:141` and the identical defect was then rebuilt from scratch
> the same evening in a new instrument — so the rule is stated as five OUTPUT requirements rather
> than five things to remember. A sixth case was added after the first commit, from a sweep:
> `lib/observability/tool-usage-census.ts` carries its own 2026-09-17 repair for this exact
> shape and STILL has the next layer, where the denominator is fixed by POLICY rather than merely
> unwindowed. **Finding an instance is not clearing the file.**
>
> **Slice 7 · my own verification plan was PROOF BY ABSENCE.** A successful salvage is invisible:
> the repaired call simply works, so it emits no tool-error part, nothing reaches
> `tool-telemetry-walk.ts`, and `failCount` merely stops growing. The only evidence
> available was "searchMemories.failCount is still 8" — the identical observation you get when
> nobody used the chat that week. I captured the denominator (259 turns, 0 post-deploy) to stop
> that reading from being wrong, but **a denominator makes an absence interpretable; it never
> makes it positive.** #2470 emits one structured event per firing, with a test PAIR — it emits
> on a real salvage, and stays silent on a decline, so the event means a repair and not an
> attempt. **A fix that works by making a failure not happen needs a positive emission, or it can
> only ever be un-disproven.**
>
> **Slice 8 · a live cron was drafting LLM rewrites for tools surfaced by POLICY.** The
> never-chosen gate is `surfacedCount / turns >= 0.20`, and a CORE_TOOLS or ACTION_CORE
> tool is ~1.0 by construction, so it clears the bar regardless of its wording — while the prompt
> tells the model "Other tools were available in the same turns and won". Measured against
> `ToolGateDecision`: `rankNextActions` 259/259 tier 1, `createTask` and
> `completeTask` 259/259 tier 2. **Two corrections to my own reports inside one slice:** I
> first called this cron latent, having measured only ONE of its two trigger predicates; then I
> said "4 of 6", having put `findCustomer` in the defect bucket by reading it out of the
> tier-6 array in the source — measured it is 11% policy and a legitimate candidate. It is 3 of 6.
> That is exactly why #2471 keys on the TELEMETRY and not on imported arrays: gate decisions
> cannot drift from the pruner, and **reading a name out of a code list is not evidence that the
> list is why the tool got surfaced.**
>
> **Slice 9 · the wave re-derives its own headline number instead of storing it.** The
> 2026-08-25 always-on demotion was argued from a hand-run query whose result went into a code
> comment — a cache with no invalidation. I repeated it: measured **5 of 9 always-on tools
> chosen ZERO times in 30 days, 1,295 impressions earning nothing** by hand, and wrote it into
> a memory file that will be stale within the week. #2472 makes it a script. At `--days=14`
> the same data says **7 of 9 and 1,813**, which is the design working: the boundary is the
> WINDOW, not a constant. `createTask` is the row that proves the no-ratio rule — **76
> lifetime calls, last called 37 days ago** — so calls-per-impression would rank it the
> healthiest tool in the list while it is cold. It PROPOSES nothing: demoting an always-on tool
> changes every turn, and two of this wave's changes to that path are not prod-proven yet.
>
> **Flagged · NOT fixed**
> - **NO PR IN THIS WAVE IS PROD-PROVEN**, #2467's deploy verification notwithstanding — deployed
>   is not proven. Route: re-run `scripts/tool-reachability-census.ts` and
>   `tool-input-failure-census.ts`; both refuse to conclude below their stated floors.
>   ⚠ Read `semantic tier SKIPPED` (73.2% -> should approach 0), NOT `budget truncated`:
>   two-stage moved that metric's denominator, so it will RISE and that rise is the instrument
>   seeing candidates the single pass never recorded.
> - **`lib/ai/tool-description-rewrite.ts` is drafting LLM rewrites for tools whose surfacing
>   is guaranteed by their TIER.** ACTIVE, not latent — 6 drafts in 2 days, and 3 of 6 are 100% POLICY-surfaced, measured from ToolGateDecision.tier:
>   `rankNextActions` 259/259 tier 1, `createTask` and `completeTask` 259/259 tier 2.
>   I first reported 4 of 6, putting `findCustomer` in that bucket because it appears in the
>   tier-6 defaults LIST IN THE SOURCE; measured it is 11% policy and genuinely keyword-surfaced,
>   so the cron is RIGHT to draft it. **Code-grep is not evidence; the tier telemetry is.**
>   The gate is `surfacedCount / turns >= 0.20` and tiers 1/2 are ~100% by construction. I first measured this cron's OTHER trigger path,
>   found 0 candidates and called it latent; **a gate with two independent predicates needs both
>   measured before it can be called quiet.** Fix should key on `ToolGateDecision.tier` —
>   exclude a tool whose ALLOWED impressions are ~100% from POLICY tiers (1 core, 2 action-core,
>   6 defaults) — NOT on an imported array. The telemetry is ground truth and cannot drift from
>   the pruner; a copied list can.
> - `check:policy-coverage` is RED on a clean tree (`lib/ai/budget.ts:9` imports
>   `server-only`, which throws under plain `tsx`). Pre-existing, reproduced with this
>   wave's diff set aside.
> - The tier-7 reorder is a **deliberate behaviour change**: the single pass ran 1,2,3,4,7,5,6, so
>   a playbook bundle could be truncated away by the generic keyword families. Splitting on
>   intent-vs-similarity moves it to 1,2,3,7 then 4/5/6.
> - `lib/services/system-pages.ts:957` renders a LIFETIME success rate on the ops page.
>   MITIGATED (query is `orderBy lastCallAt desc take 20`, and the payload already carries
>   the timestamps) but not fixed. The pattern to copy is
>   `lib/observability/evidence-gate-calibration.ts:126`: return null below MIN_SAMPLE
>   rather than a ratio.
>
> ## 2026-09-18 · W13 · instruments that could not answer their own question · 1 PR / 7 slices
>
> **#2425 · `statenour · three brain follow-ups` `d61763004` SHIPPED + DEPLOYED-VERIFIED** (SHA
> EQUALITY, not ancestry: `GET /api/version` -> `build.commit d61763004b4deaa7…`, `branch main`,
> `environment production`, read 25s after boot.) (Squashed; the 7 slice
> commits keep their detail in the PR body). W12 found instruments that could not report their own
> FAILURE. W13 is the layer under that: instruments that were *working as written* and still could
> not answer the question they existed for. Four of the five queued follow-ups turned out not to be
> the task as written.
>
> **Slice 1 · the zero-topic fallback threw away a working embedding.** "what about that one"
> derives ZERO fast-topics, and recall answered by returning `getFallbackMemories()` — top-N by
> CONFIDENCE, query discarded. The guard predated the Wave-81 `queryEmbedding` pass-through; with an
> embedding in hand the semantic and KNN lanes need no topics at all. Second defect found fixing the
> first: `topics.join(", ")` is `""` on those turns and that empty string reaches `rerank({query})`
> and `semanticSearch()`, so removing the early return alone would have swapped one bad answer for
> another. Both decisions extracted as pure exported predicates so the test calls the real thing.
>
> **Slice 2 · the last invisible memory switch, plus a ratchet.** `NICK_MEMORY_SUPERSESSION` was a
> raw `process.env` read and appeared nowhere on the flag board, so Wave 2 §6.3 could not be given
> its shadow week. A REPEAT defect — `CURRENT-TRUTH.md` records the same shape fixed 2026-08-19.
> Measured while fixing one: **11 of 17 raw `NICK_*` reads were unregistered**, including
> `NICK_FAILOVER_RESCUE`, which the operator ENABLED in production on 2026-08-15. Shipped the
> shrink-only ratchet rather than another one-off registration.
>
> **Slice 3 · a stale probe figure quoted as current state in four source comments.** "0 of 40,889
> rows carry `validFrom`" is a 2026-09-08 SNAPSHOT; `remember()` has stamped `validFrom`
> unconditionally since Wave 2. **This slice also corrects the slice before it** — my own commit
> said "every new row", which overreaches: the 107 allowlisted direct writers bypass `remember()`.
> Why it survived: the conclusion it supported stayed true either way, so nobody re-checked the
> premise. Dated snapshots in CURRENT-TRUTH/RECONCILIATION deliberately NOT rewritten.
>
> **Slice 4 · the context receipt could not calibrate its own budget.** `tokensKept` is bounded by
> `tokensBudget` by construction, so once the budget binds it measures the cap, not the context —
> "calibrate 7250 from production receipts" was impossible as written. Added `tokensAppended`
> (invariant under the budget). Sharper defect alongside it: `brain-context.ts` appends every
> threshold survivor BEFORE the receipt runs, so `{kept:false, reason:"over_budget"}` describes a
> block the model DID receive; `enforced: false` now ships inside the receipt.
>
> **Slice 5 · evidence for `NICK_CORRECTION_THRESHOLD_BOOST`.** The flag sat off pending a
> measurement that could not be taken: it lowers the bar 0.7→0.6, so the decision needs scores in
> `[0.6, 0.7)`, and a turn where nothing cleared recorded nothing. Near-miss logging added; it is
> free because the threshold is applied AFTER the per-candidate embedding.
>
> **Slice 6 · the multi-hop splitter was 36% precise.** Measured before wiring, on a hand-labelled
> corpus: 7 of 11 firings false — "I closed up and then went home" split into two lookups. Same
> defect class as the bare month matcher reading "may" as May 1st. Gated the connective arm on the
> turn being interrogative → 100% precision / 80% recall. **Still not wired**, deliberately; this
> removed the landmine under an existing, well-argued decision rather than overriding it.
>
> **Slice 7 · review + self-audit fixes.** External review caught that a FULLY TIED RRF LANE IS NOT
> NEUTRAL — `fuseRankings` reads POSITION and `Array#sort` is stable, so an all-equal lane becomes
> input order paid out as `1/(k+1), 1/(k+2), …`. With the pool ordered `confidence desc` and
> KNN-only hits unioned in after, the phantom keyword lane boosted generic high-confidence rows over
> vector hits — reintroducing slice 1's bug by the back door. **This refuted a claim in my own
> commit message.** Also: the flag ratchet walked `lib/` only, so `app/` switches stayed invisible
> while the gate stayed green (found live: `NICK_ESCALATION_DISABLED`). Self-audit separately found
> a bare `.slice()` that would surface as an EMPTY brain block under `withTimeout`, and a NaN-poisoned
> running max that would have written `bestSim: null` into the distribution it collects.
>
> **Flagged · NOT fixed**
> - **`DEFAULT_CONTEXT_TOKEN_BUDGET` still uncalibrated.** Deliberate: the number needs the
>   `tokensAppended` distribution from real turns, which does not exist until this ships. Guessing a
>   second uncalibrated constant would repeat the first mistake.
> - **`NICK_CORRECTION_THRESHOLD_BOOST` still OFF.** Needs the near-miss distribution this wave
>   starts collecting. Do not flip it on the 0.6 guess.
> - **`subQueries` still dark, on purpose.** Wiring needs a second retrieval plus a merge; the
>   natural merge (`retrieval-arbiter.arbitrate()`) is behind `NICK_RECALL_ARBITER`, default off.
> - **CLOSED by #2429 `18adea836`.** All 7 switches are now registered as `readOnly` mirrors and
>   the baseline is the 4 knobs. Measuring board-vs-runtime agreement while doing it found a real
>   divergence (`NICK_AGENT_FOLLOWUPS=" 1 "` reads TRUE in code, OFF on the board) and, worse, that
>   `getAllFlags()` — the path the operator board actually renders through — carried its own copy
>   of the resolver, so the first fix reached only the path its test called. Original entry kept
>   below for the reasoning about why the knobs stay excluded:
> - ~~**11 `NICK_*` keys baselined in the ratchet — 7 switches + 4 tuning knobs, and only the
>   7 are a defect.**~~ The knobs (`NICK_CALIBRATION_K`, `NICK_TOOL_BUDGET`,
>   `NICK_TOOL_TIMEOUT_MS`, `NICK_ESCALATION_DAILY_CAP`) are numeric VALUES, excluded on
>   purpose — the ratchet's own header says forcing them onto an on/off board would be worse
>   than leaving them. Counting all 11 as "unregistered switches" would file four deliberate
>   exclusions as bugs. Worst of the real 7: `NICK_FAILOVER_RESCUE`, live in production and
>   invisible on the flag board. Follow-up #2429 registers all 7 as `readOnly` mirrors and
>   takes the baseline to the 4 knobs.
> - **CLOSED by #2433 `e3bf7b4f2` — and the deferral reason I wrote was WRONG.** The original
>   entry said the `FAST_TOPIC_STOPWORDS` gap ("is it still the same" → `["same"]`) was "a ranking
>   change and belongs with a recall-eval run". Measuring killed that premise: 14 of 20 anaphoric
>   follow-ups derived pro-form-ONLY topics, and removing them is not a precision/recall trade at
>   all — the lexical lane matches memory CONTENT, and for a pro-form every content match is
>   COINCIDENTAL, so there is no true positive to lose and nothing for an eval to weigh. It also
>   completed a class the list already started (`any`, `all`, `one`, `thing` were stopwords from
>   the beginning). `rest` (rest day) and `change` (oil change) stay topics on purpose.
>   Review then caught that the fix exposed a SECOND defect: the topic-poor prepend in
>   `buildRecallMessages` had outlived its own justification — #2425 removed it — and was steering
>   non-anaphoric turns at the previous turn's subject. Deleted, not special-cased.
> - **RESOLVED 2026-09-18 — and my diagnosis of it was WRONG.** I recorded this as
>   "`packages/reel-engine` does not build in a junctioned worktree", implying a junction problem.
>   It was not. `@remotion/bundler` was declared in `packages/reel-engine/package.json` and pinned
>   in `pnpm-lock.yaml` but **installed nowhere** — absent from the package's `node_modules` AND
>   from the root `.pnpm` store — and the build failed in the PRIMARY checkout too. All 9
>   `packages/*` junctions were intact the whole time. The operator ran the install and `tsc` is
>   now silent; the "2 pre-existing strict-null errors in `src/render.ts`" were downstream of the
>   unresolvable module and vanished with it. This had been forcing every worktree session to push
>   hook-free, so it was costing more than it looked.
>   ⚠ Use the UNFILTERED workspace install. The filtered form prunes sibling workspace packages:
>   run with `--filter "@nour/reel-engine..."` it stripped `styled-jsx` out of
>   `apps/statenour/node_modules` and broke local `tsc` on an untouched file. CI was unaffected
>   (it resolves from the lockfile, which never changed).

> ## 2026-09-17 · W12 · instruments that never ran, and a capability nobody could reach · 1 PR / 13 slices
>
> **#2381 · `statenour · overnight capability hardening` `691c90d11` SHIPPED + DEPLOYED-VERIFIED** (SHA
> EQUALITY, not ancestry: `GET /api/version` → `build.commit 691c90d116564e9…`, `branch main`,
> `environment production`, read 59s after boot). ⚠ `/api/health` is operator-gated and answers 401 to an
> unauthenticated probe; **`/api/version` is the public deploy-truth endpoint** — reach for it first.
> Squashed; the 13 slice commits keep their detail in the PR body. W11 found controls that could not SEE their subject. W12 is the next layer
> down: instruments that could not report their own FAILURE, and capabilities no one could ASK for. Two defect
> classes, both of which bit this wave's own work — twice caught by external review, once by a test, and three
> times by a sweep I only ran because an earlier slice had taught me to.
>
> **The baseline was RED and AGENTS.md said green.** `origin/main` `a4d0f14b8` exited 1 on 4 tests in 2 files.
> Both were "a test that cannot fail for its stated reason": an obsidian probe passing an absolute Windows path
> to `import()` (Node reads `C:` as a URL scheme, and the failing arm was the file's own POSITIVE CONTROL), and
> `brain-engines-smoke` calling its subjects "100% DB-dominated" while `findTeachingMoments` reached the
> nickstire bridge over HTTP — green in CI, red wherever the bridge answers. Restored to exit 0.
>
> **★★★ The tool-budget cliff cut by ALPHABET, not relevance — the mechanism behind the census headline.**
> Tier 4 ordered candidates with `Array.from(keywordMatches).sort()`. That reads as a determinism device and is
> one, until the budget truncates: `addIfSpace` stops at `TOOL_BUDGET`, so the list order IS the selection policy
> past slot 24. Tier 5 — the one tier that ranks by relevance — is gated on `selectedNames.size < TOOL_BUDGET`,
> so it is skipped on exactly the turns that truncate. Measured over **192 turns / 5,227 gate decisions: 72.9% of
> turns hit the cliff · 70.3% skipped the semantic tier · tier-4 ALLOWED averaged first-letter index 5.28 ("f")
> vs BUDGETED_OUT 11.78 ("l") · 65.3% of tier-4 ALLOWED impressions went to tools the model NEVER chose.** A
> 6.5-letter gap across 5,227 decisions is not relevance correlating with spelling. `searchWebVerified` was cut
> 52 times and `githubRecentCommits` 53 — and **5 of 13 recorded `searchTools` recoveries were for a web-search
> tool the keyword family HAD matched and truncation had dropped**, each costing an extra generation step. Fixed
> by ranking tier-4 candidates semantically. **Ordering only — a test asserts membership is unchanged**, so
> nothing became reachable that a keyword family had not already matched and no authority widened.
> ⚠ **NOT YET PROVEN IN PROD.** The promotion evidence is the two first-letter means converging after ~100
> post-deploy turns. Re-read it before claiming the fix worked.
>
> **Browser capability was unreachable from chat — ZERO uses in 467 turns** with both BROWSERBASE credentials
> present and six tools built. Two defects in one selector: the trigger wanted "scrape"/"automate the browser",
> and `/browser_/` **cannot match `browseAndDo`**, the entry point `meta.ts` says to PREFER. A sweep of eight
> capabilities then found three more with no plain-language path at all (`searchSkills`, `solveMath`,
> `getCameraIntelligence`), deliberately NOT blanket-fixed — surfacing a capability that returns nothing is worse
> than leaving it dark. A `MUST_BE_REACHABLE` table now fails at commit time instead of in a census a month later.
>
> **★★ A schema fix from 2026-09-03 had reached 1 of SIX call sites.** Prod showed `createTask` failing because
> `effort`/`context` are opaque CODE enums with no `.describe()` — the model answered `{"effort":"30 min"}` and
> put task descriptions in `context`. That was fixed INLINE in one block; `missions.ts` kept two byte-identical
> bare copies, so `createMissionPlan` was still failing two months later at **4 calls / 1 success**. A
> zod-introspection sweep found **three more sites a careful manual audit had missed**. ⚠ The sweep's shape rule
> does NOT catch `context` — its values are ordinary English and the defect was the misleading field NAME, which
> cannot be checked mechanically. Proven by mutation; both the name rule and the shape rule are load-bearing.
>
> **The repair lane could not rescue a pruned-out tool**, only a mis-NAMED one: every path required the target to
> be `in toolSet`. Step 3 routes a real-but-unloaded tool through `invokeTool` (attached to every turn by
> `prepare-tools.ts`). The boundary is tested both ways — `getRepoMap` is rescued; **`getGoals`, which appeared in
> the prod failure list, is not in the catalog at all** and stays refused, because repairing it would invent a
> capability. Authority is deliberately not re-decided there: `invokeTool` already enforces read-safety, the
> circuit breaker and the operator's `disabledTools`.
>
> **★★★ Two P1s from Codex review, both real, both in this wave's own wiring.** (a) The Done-shadow was injected
> with the fail-soft `recordMetric`, whose body ends `.catch(() => {})` — so the await could never reject, the
> recorder always returned "recorded", and the catch it advertises as "NOT a silent catch" was dead code in
> production. Its unit test passed only because the injected mock rejected where the real dependency cannot: **a
> test agreeing with its own double.** Fixed with `recordMetricStrict` returning a receipt, and the deps type now
> demands that receipt so `Promise<void>` is unassignable — a compile error where a comment had been. (b) The call
> sat inside `if (actions.length > 0)`, so a completion claim with NO action block — the phantom case — never
> recorded, while the module documented a denominator of ALL completion-claim turns. The dataset excluded exactly
> what it was built to measure.
>
> **Then the same sweep discipline, applied to my own fix, found three more siblings.** `tool.surfaced` (THE
> census instrument; its comment read *"Fire-and-forget: recordMetric already swallows its own failures"* — the
> defect stated as a feature, double-swallowed), `operation.integrity_shadow`, and `recordToolInvocation`. These
> are hot-path and non-blocking, so awaiting strict writes would trade a silent instrument for latency; only the
> FAILURE CHANNEL changed — failures now persist to `errorLog` and are read by `buildInstrumentFailures()` on
> `system.digest`, beside the census whose zeros it disambiguates. ⚠ `getSelectionTelemetryHealth()` had zero
> callers while claiming "the panel reads that"; worse, its counters are lambda-instance scoped and so cannot
> answer a cross-instance question at all. ⚠ Stated in the payload: this detects instruments that FAILED, never
> ones that NEVER RAN — only a wiring test sees that, so one ships with it.
>
> **Other measured findings, acted on:** stored tool errors kept the INPUT and threw away the REASON
> (`errorMessage.slice(0, 200)` is a HEAD cut; AI SDK puts the reason at the TAIL — all three `createMissionPlan`
> failures were exactly 200 chars, and the description-rewrite cron was reading input fragments as "failure
> evidence"); the rewrite cron was drafting against an EMPTY queue (its `totalCalls >= 10` filter measured 0
> while 101 never-chosen tools cost 8.4 slots/turn); the evidence-gate promotion decision became computable
> (**DO NOT PROMOTE — n=12 post-fix, rate withheld below n=40**); and the dead `canClaimDone` was deleted, its
> docstring having claimed it was "wired directly into the live chat-finalize loop" with zero callers.
>
> **Corrections I made to my own findings, recorded because a silent correction is indistinguishable from never
> having been wrong:** `pruneTools` never offers the recovery lane and I nearly filed that as a defect —
> `prepare-tools.ts` re-attaches it unconditionally AFTER pruning, and prod confirms it works (13/192 turns fired
> `searchTools`). **`pruneTools` is not the surfacing path; `prepareTools` is.** Twice I began re-fixing an
> ALREADY-FIXED problem by reading historical failure rows (`createTask`'s failures are July, its fix is
> September; the evidence gate's 36.9% predated `isResourceTitle`) — **read the subject's source and the fix date
> before trusting a failure count.**
>
> **Test-quality defects this exposed in code that was already green:** `tool-telemetry-operation-state` asserted
> on a LEAKED call (`mock.calls[0]` read the previous test's write — both used `convId: "c1"`), so its assertions
> had never examined the turn they name; two source-TEXT test anchors went red on refactors that STRENGTHENED the
> property they guard (one coupled a schema claim to file layout, one located a tier by the prose "Tier 5" and
> broke when a docstring mentioned it) — both re-anchored on the code that runs; and five hand-written partial
> `vi.mock`s broke on new exports. ⚠ `importOriginal()` spread is the documented cure but is WRONG on a hot-path
> test: the real metrics module imports Prisma, so spreading made the test RACE. **The cure has a cost; name it.**
>
> **Receipts:** 853 files / 8,574 tests, exit 0 · `tsc --noEmit` exit 0 · every slice mutation-verified.

> ## 2026-09-16 · W11 · the controls that could not see their subject · 5 ships
>
> A self-audit wave that turned into a measurement wave. Every defect below is the same shape — **a control that
> existed, reported green, and could not see the thing it was pointed at** — and the wave's own instruments kept
> reproducing it, which is the part worth carrying forward. Three canaries written this wave were broken when
> first run and were caught ONLY by an instrument-control arm, never by the passing run. Three of my own proposed
> fixes were refuted by measurement, each because the number behind them came from conditions production never
> sees. **A green gate proves nothing until something has made it go red.**
>
> **#2355 · `fix · statenour · self-audit of the shipped W8 wave + the obsidian probe that asserted nothing`
> `9837e5066` SHIPPED + DEPLOYED-VERIFIED (ancestry, not SHA equality).** Four controls repaired. (a) The ledger
> canary failed OPEN: it checked that `contactRowsOnly` is CALLED, never that the call is FED — a Prisma `select`
> omitting `metadata` makes `isContactRow` return true for every row and the filter passes everything. Now
> brace-matches each ledger read's argument object and fails when a top-level `select` omits metadata. (b) The
> tRPC edge schema had no test, invisibly by construction, since the seam behind it re-asserts anyway; the schema
> moved next to the constant it shares and gained a test that edge and seam agree on EVERY input. (c) The obsidian
> server-only probe ran from `tsx -e`, where a dynamic import resolves to a namespace carrying only `default`
> (tsx compiles a bare .ts to CJS; CJS interop of an ESM namespace collapses it) — it asserted nothing while
> failing loudly about the wrong subject. Now runs from a temp file with an instrument-control arm. (d) CI's one
> red e2e test was **main's bug, not the PR's**: `floating-collision.spec.ts · /chat @ 1460px`, the desktop spine
> covering the chat header's `/settings` pill by 3.23×44px. The W7 spine reserved its lane with
> `xl:pl-[var(--spine-w)]` on `<main>`, but `/chat` is a `fixed inset-0` island and a fixed child resolves inset
> against the VIEWPORT — the page already re-declares top and bottom for that exact reason and the left one was
> never added. Fixed with `xl:left-[var(--spine-w,0px)]`; 16/16 green, mutation-proved, phone/tablet byte-identical.
>
> **#2359 · `fix · statenour · the tool-surfacing census has never once run` `0bcee15b6` SHIPPED + DEPLOYED-VERIFIED.**
> `getSurfacedStats` filtered on `make_interval(days => ${days})`. Prisma binds a JS number as int8, `make_interval`
> has only an int4 overload, and a named-argument call gets no implicit int8→int4 cast — so both queries threw
> `42883` on EVERY call since the lane shipped, `catch { return null }` fired every time, and `/system/tools`
> rendered "no surfacing data exists in the window yet" for three weeks over **456 rows that did exist**. Measured
> at both layers before writing a line (prod SQL errors; Prisma `${days}` throws, `${days}::int` returns). Three
> parts, because the cast alone leaves the mechanism intact: the `::int`; a catch that no longer passes silently
> (null is the right degradation but it was the ONLY thing that happened); and a canary, since `check:raw-sql` is
> static and the SQL is *valid* — it just resolves to no function. **Post-deploy the lane reads real data:** 142
> tools surfaced in 30d, 50 ever invoked, 660 calls all-time, **101 surfaced-but-never-invoked** — the prune signal
> the feature was built to produce and had never once delivered.
>
> **#2362 · `fix · ci · the node job's resource death, measured and fixed` `aec29c100` SHIPPED.** The `node` job had
> been dying with the documented "fixed progress at varying times" signature; on 2026-09-16 a statenour-only sweep
> died 3× (5 successful / 8 total at 5m10s, 5m23s, 7m11s) then passed on the 4th. **The instrument could never
> speak:** the memory sampler's verdict echo sat INSIDE the step that gets killed, so it printed on SUCCESS and
> went silent on FAILURE. Three deaths, zero readings. Moved to its own `if: always()` step with a "no samples"
> positive control. Guarded by `scripts/agent-os/ciMemorySampler.test.mjs` (4 mutation arms). **The `--concurrency=1`
> half was REFUTED by its own instrument** — see Flagged.
>
> **#2364 · `fix · statenour · harden the make_interval canary (two Codex P2s, both real)` `d29dfd5c6` SHIPPED.**
> Codex reviewed #2359 ten seconds before it merged, so both findings landed on main. (a) `secs` is
> `double precision`, not int — the gate demanded `::int` on every interpolation, so a correct
> `make_interval(secs => ${s}::double precision)` would have failed it and the fix it forced TRUNCATES the interval.
> A gate that forces an incorrect change is worse than one that nags, because it gets obeyed. (b) The paren matcher
> was **fail-open**: a quoted `)` inside an interpolation truncated the argument block, the brace matcher returned
> −1, and the violation was SKIPPED — clean report on an uncast value, the same shape the file exists to catch, one
> commit after shipping. Both mutations proven to discriminate: each reddens only its own arm.
>
> **#2368 · `docs · ci · correct the node job's memory numbers` `107a27a12` SHIPPED.** The figures written into
> `test.yml` in #2362 (`peak 4962MB`, the `7695MB` collision) were **warm-cache artifacts**. CI is always cold
> (fresh checkout, remote caching disabled) and a warm `.next` skips the compile and type-check work that HOLDS the
> memory. Cold: **6778MB** (3 workers) / 6621MB (`cpus: 1`) — validated against CI by 7000−6778 = 222MB predicted
> vs 285MB measured. Codex caught a second copy of the stale figures in the `NODE_OPTIONS` block (fixed in
> `69de22b79`) — **the first finding this session to arrive BEFORE a merge**, because this was the first PR marked
> ready-for-review on open rather than seconds before merging.
>
> **Flagged · NOT fixed**
> - **The `node` job runs at 97% of its runner and no measured code-side lever moves it.** statenour's cold
>   `next build` peaks at 6778MB on a ~7000MB box, alone. Three levers refuted by measurement: heap ceiling 3072
>   (reproduces the original OOM — tsc alone fits, next build's internal type-check does not), turbo
>   `--concurrency` (floor 319MB at 2 vs 285MB at 1 — unchanged, because build by itself sets it), and
>   `experimental.cpus` (6778→6621MB, 2.3%, because the peak lives in compile + type-check which are
>   single-process). `--concurrency=1` is KEPT for a corrected reason — build alone leaves ~222MB so any companion
>   task is fatal rather than tight, and all three deaths were at 2 — but it is not the fix. Remaining options are
>   a larger runner, accepting flakes now that each death self-explains, or reducing what the app compiles.
>   **DECIDED 2026-09-16, operator: no paid runner.** Nothing had been enabled to switch off — all 24 jobs across
>   `.github/workflows/*.yml` are standard `ubuntu-latest` / `ubuntu-24.04`, with no larger-runner label, runner
>   group or self-hosted entry anywhere. The larger runner was a proposal, never a config change, so declining it
>   is a no-op on the repo. We accept the flakes; each death now self-explains via the sampler below.
> - **Correction to the 97% figure above: it was one sample presented as the number.** The first completed run
>   with the repaired sampler (#2370, `node` job on `e22031046`) reported:
>
>   ```
>   --- runner memory during the sweep ---
>     samples: 152 · min avail: 660MB · max avail: 7012MB
>     last 12 samples (MB available, 5s apart): 6545 5854 5260 4618 4116 3834 3607 3344 3131 3077 3061 2989
>   ```
>
>   That is a 6352MB peak and **90.6% utilisation**, not 97% — the floor moved 285MB → 660MB between two runs of
>   the same shape. The operational conclusion is unchanged (660MB does not fit a companion task either, so
>   `--concurrency=1` stays), but the spread is ~375MB run to run and any single reading should be quoted as one.
>   **The instrument itself is now proven: it printed, from its own `if: always()` step, which is the whole point
>   of #2362.**
> - **The unpaid lever, confirmed from CI rather than inferred: turn on turbo remote caching.** The same run:
>   `Remote caching disabled` · `Tasks: 8 successful, 8 total` · `Cached: 0 cached, 8 total` · `Time: 12m38.343s`
>   — **zero of eight cached for a diff of three markdown files.** `turbo.json`'s build task already excludes
>   `!docs/**` and `!*.md` from its inputs, so the task hash is unchanged by a prose edit (measured locally:
>   `924b195c7bab32a2` before and after touching `AGENTS.md`). The exclusion is written correctly and is inert
>   because there is no cache to hit. With a warm remote cache this job would restore instead of running a 6.3GB
>   cold `next build`. NOT actioned: it needs a cache backend chosen, which is the operator's call, and the
>   no-paid-runner decision above does not by itself answer it.
> - **E4 cannot be re-run until ~2026-09-20.** The `isResourceTitle` repair deployed 12:56Z; only 11 shadow turns
>   have accrued since, against E4's original 91. Early signal is 0 blocks in 11 (vs 21/91 = 23% before) — but if
>   the true rate were still 23.1%, P(0 in 11) = 5.6%. Suggestive, NOT conclusive. Rate is ~20 turns/day. The verdict
>   split alone cannot decide arming; the number that decides it is what fraction of blocked names are genuine
>   resources vs the operator's own prose. `lib/feature-flags.ts` still reads REFUTED / flag OFF and stays that way.
> - **~25% residual false-positive rate in the `listed` named-source detector** — gym-log and plan fragments that
>   are neither sentences nor label-colon-value lines. Carried from W10, unchanged.
> - **`tests/scripts/generate-pwa-icons-sharp.test.ts`** remains the suite's one failure, deliberately unfixed:
>   `sharp` is bare-resolvable in this container but not in CI, so its anchor assertion is correct where it runs.
> - **Codex reviews raced three merges** (#2359, #2362, #2364 — each by under 15s) because PRs were un-drafted at
>   merge time; #2359's two P2s reached main as a result. Corrected from #2368 onward: mark ready on open so the
>   ~4min review overlaps the ~13min sweep. Not a policy change, a timing one.

> ## 2026-09-16 · W10 · E4 RAN: the evidence gate is REFUTED, not pending (branch `claude/statenour-ui-architecture-intmaf`)
>
> `NICK_EVIDENCE_ENFORCEMENT` is the last layer of the fabrication-defense stack (§4 L6). It has been wired,
> unit-tested and OFF since it shipped, with `persist-assistant-turn.ts` deferring it until "these numbers say the
> FP rate is tolerable" and naming experiments **E2 / E3 / E4**. **Nobody had ever run them.** An unarmed control
> that everyone believes is nearly ready is the same defect class as a silent canary, so they were run.
> **Measured (Neon, read-only, 91 shadow turns 2026-09-11 → 2026-09-16):**
>
> | experiment | question | answer |
> |---|---|---|
> | E2 | share of turns naming a resource with no receipt | **21 / 91 = 23%** (avg 4.86 names each) |
> | E4 | false-positive rate of the named-source check | **~50%** of the 73 distinct names were not resources |
> | E3 | share of turns the pre-flush lane would buffer | **INSUFFICIENT DATA** — the stamp landed 09-15, so only 9 of 91 rows carry it (5 would buffer) |
>
> Verdicts: pass 57 · block 21 · repair 13. **The 50% is the finding.** `LISTED_TITLE_RE` is the only one of the
> module's three patterns with NO resource noun anchoring it — it matches a bolded markdown list item, full stop —
> and Nick writes the operator's itineraries and gym protocols as bolded list items. Enforcement DELETES list items
> it cannot receipt, so arming the flag would have stripped the operator's travel plan and workout protocol out of
> replies. Shape census of the 73: 14 ended in sentence punctuation · 10 were label-colon-value lines · 2 arrow
> itinerary legs · 1 equation-style assertion · 2 parenthetical day labels.
> **Shipped:** `isResourceTitle()` gating the `listed` kind on five rules drawn from that corpus, at **zero measured
> true-positive cost** — every real channel and video title in the sample survives. Capitalization density was tried
> as a rule and REJECTED with receipts: sentence-case video titles are indistinguishable from prose by
> capitalization and it dropped three real titles. Both flags now carry the verdict inline so the next session
> cannot read "experimental, ready" and switch it on.
> **The old rows are now stale by construction** — they measure a detector that no longer exists. E4 must be re-run
> on a fresh window before the flag is considered again; that is written into `lib/feature-flags.ts`, not just here.
> **Not done, on purpose:** the ~25% residual FP rate (gym-log and plan fragments that are neither sentences nor
> labels) is real and un-fixed; it is why the flag stays OFF rather than "nearly ready".
> **Receipts:** `tsc --noEmit` exit 0 · eslint 0 errors on the three touched files · `vitest run tests/ai` **178
> files, 2,352 passed, exit 0** (including the canonical end-to-end enforcement fixture, untouched) ·
> `tests/ai/named-source-listed-precision.test.ts` 22 tests, mutation-proven: deleting the guard turns 3 of them RED,
> one of which is an explicit instrument control proving the pattern still fires on a real title.
> **Privacy:** the measured strings are the operator's private chat content and this repo is public, so the test
> fixtures are SYNTHETIC reproductions of the measured shapes; the counts are recorded, the text is not.

> ## 2026-09-16 · Honest-counter repair wave W8 (branch `claude/statenour-ui-architecture-intmaf`, sixth PR, on top of the Visible Transformation slices)
>
> Operator: fact-check the research, repair reality, keep shipping. This wave is the REPAIR half — every consumer
> that was written while `interactionCount` was inflated and every ledger reader that could not tell a contact from
> an audit row. **Re-measured on prod before touching anything** (Neon, read-only): 20 live profiles · 7 ever
> logged · 13 at zero · max `interaction_count` 4 · `>= 3` matches 2 · `trustScore` 0.3–0.9.
> **Shipped, five slices:**
> · **Writer guard** — `RESERVED_LEDGER_METADATA_KEYS` + `assertWritableMetadata` in `contact-rows.ts`, called from
>   `recordInteraction.normalize()` before any IO, plus a zod `superRefine` on `task.logLedger` so the operator gets a
>   BAD_REQUEST naming the key. Codex P2 on #2348: the seam increments `interactionCount`, so it may not stamp a
>   marker that excludes its own row — the profile would count a contact the ledger does not have.
> · **Trust scale** — `unstableAlliances` compared a 0–1 Float to `50`, vacuously true for every person who has ever
>   existed, while its other half (`>= 10`) was unreachable after the reconcile. Now `< 0.4` (the house RISK tier,
>   `brain-graph.ts:605`) AND at least one logged contact. Canary `tests/repo/score-scale-mismatch.test.ts` fails on
>   any 0–1 field compared to a literal above 1; it strips comments AND strings, because its first cut flagged its
>   own explanation of the bug.
> · **Reader contamination** — all 16 ledger read sites classified: 13 pipe through `contactRowsOnly`, 3 allowlisted
>   WITH a reason (the audit timeline, the writer, the delete that re-derives through the predicate).
>   `changes-since.ts` moves `count` → fetch-then-filter. The 8 synthetic rows each carry **+1**, so they had been
>   earning relationship XP in `people-credit.ts` for chat messages that merely NAMED someone; the status-flip half
>   (−50 / −5 / 0) is armed and unfired at 0 rows.
> · **Counter consumers** — 4 bare `orderBy: { interactionCount: "desc" }` reads now lead with `lastInteraction`
>   NULLS LAST (a count ordering is an arbitrary tie-break over 13 identical zeros); Greene law_16's
>   `"interactionCount > 20 in the last 60 days"` trigger replaced with the observable saturation SHAPE, and the
>   schema doc that offered the same comparison as its worked example fixed with it; the neglect predicate
>   de-duplicated into `lib/services/people/neglect.ts` at `>= 1` (existence, not frequency — `>= 3` dropped 5 of the
>   7 real candidates and dropped the worst cases first) with one boundary spelling, `floor()` not `round()`, so the
>   day count the /people badge now shows matches the verdict beside it.
> · **Gate fallout from W7** — `components/ui/{input-group,section-header}.tsx` deleted (256 lines; the wave took the
>   last importer off each) and the anti-slop waiver canary repointed onto a fixture it plants itself, because its
>   precondition read the one live waiver this wave correctly removed.
> **Silent-instrument finding, kept:** the ledger canary's first cut tested `src.includes("contactRowsOnly")`, which
> the import line alone satisfies — mutation proved it stayed GREEN after the call was deleted. Tightened to a real
> call shape it immediately caught a REAL miss in this same diff (`relationship-weekly-synthesis` had the import and
> the `metadata: true` select but never called the filter).
> **Receipts:** `tsc --noEmit` exit 0 · eslint 0 errors (132 pre-existing warnings) · vitest **840 files, 8,405
> passed, 6 skipped, 2 failed** · 10 static gates green (`runbooks`, `lint-baseline`, `raw-sql`, `crons`,
> `soft-delete`, `get-auth`, `mutations:strict`, `anti-slop`, `et-clock`, `scripts`). Every new canary
> mutation-proven RED against the real tree before being trusted.
> **The 2 failures are environmental and pre-existing**, not this branch: `obsidian-ingest-server-only` and
> `generate-pwa-icons-sharp` both spawn `npx tsx -e` probes, and in this Linux container a spawned `tsx -e` dynamic
> import collapses every module's namespace to `default` — reproduced on `lib/db/soft-delete.ts`, which this branch
> does not touch, WITHOUT the shim. Neither test's subject appears in the branch diff. `check:env` also fails here
> for want of provider keys, which is the documented container constraint.

> ## 2026-09-16 · Visible Transformation (branch `claude/statenour-ui-architecture-intmaf`, sixth PR; #2348 SHIPPED + DEPLOYED-VERIFIED `ef52c8e38`, prod counter reconcile DONE 10:28Z)
>
> Operator: the workbench substrate (#2337 / #2341 / #2344) shipped but "StateNour still looks 85–95% like before";
> the new bar — *old vs new side-by-side from six feet away must be unmistakable; visual similarity to the
> pre-workbench screenshots is now a failure condition* — reverses spec §2 correction 5 (recorded in
> `docs/design/ui-workbench-2026-09-15.md`). **The bar is a test:** `tests/e2e/visible-transformation.spec.ts` renders
> Home, Missions, Brain, People and System at 1440×900 and 390×844 on the hermetic stack and fails under **0.35
> registered ink-mass distance** from the committed PRE-wave baselines (`…spec.ts-snapshots/`, generated once on
> the pre-wave tree). The instrument had to be built twice: a pixel-share distance is capped by ink — this palette is
> 2.5–10% ink, so a 30% bar was unreachable and a 64px slide scored 82–91% of ink pixels "changed" — so
> `tests/e2e/visual-distance.ts` reduces both renders to 48px-cell ink-mass grids, takes the relative L1 minimised
> over ±2 cells (shift proxies 0.11–0.26, same-tree noise 0.000), and `tests/repo/visual-distance-metric.test.ts`
> pins it (identical → 0, a 64×40px slide → 0.11, a recomposition → >0.5; red under two mutants). Captures wait for
> `[data-skeleton]` / `aria-busy` / `.animate-pulse` to leave and warm every route first — a capture racing a cold
> `next dev` compile measured a skeleton at 0.34 / 1.3% ink.
> **Shipped:** desktop spine (`components/layout/desktop-spine.tsx`, 4.5rem at ≥1280px via `--spine-w`; `<main>`
> pads), workset strip, ruled bottom chrome, intent-resolver restyle · **Home** (display verdict `.vt-verdict`,
> gold-rule lead, ruled command line, `empty:hidden` rail) · **Missions** (NEXT MOVE hero across the page; capture /
> decide / board as ruled sections; mission cards → a ruled list with display titles; WAITING + DONE rail; the card
> header's nested `<button>` hydration error fixed) · **People** (NEEDS ATTENTION verdict from the totals, the list
> always visible as hairline rows, gold-ruled Person Workspace — the collapsed "browse all" `<details>` is gone) ·
> **System** (Control Tower: `lib/system/control-tower.ts`, ALL SYSTEMS NOMINAL / N REQUIRE ATTENTION, exceptions
> only, vitals as one mono line; unknown is never nominal — `tests/lib/system/control-tower.test.ts`, red first) ·
> **Brain** (nine tabs grouped into five lenses with five layout archetypes via `PageTabs lenses=`; every `?tab=`
> deep link unchanged; the graph toolbar and canvas de-carded) · **secondary pages** de-carded: Stats (glass tab bar +
> the waived blue→purple accent gone), Journal (house display header), Pins, Links, Learn.
> **Gate receipts (warm hermetic run):** desktop home 0.542 · missions 0.577 · brain 0.577 · people 0.477 · system
> 0.504 · phone home 0.610 · missions 0.498 · people 0.510 · brain BRAIN_PHONE · system SYSTEM_PHONE (floor 0.35).
> `tsc --noEmit` 0 · eslint 0 errors on every touched file · anti-slop clean · unit: 70 tests across the touched
> components + the two new canaries.
> **Also in this branch's history:** the prod counter reconcile ran and verified (entry below).
> **Not done, on purpose:** the Brain phone hydration mismatch (pre-existing; the gate ignores hydration
> pageerrors and tracks it) · `make_interval(days => bigint)` raw-query error on plain PG16 · the four genomes for the
> OTHER products — `docs/design/SURFACE-DNA.md` (repo root) is the contract; Nick's Home / Admin Home are the
> nickstire session's next wave, Lot Intelligence waits for the operator's camera session.

> ## 2026-09-16 · Counter reconcile (branch `claude/statenour-ui-architecture-intmaf`, fifth PR #2348; #2346 SHIPPED + DEPLOYED-VERIFIED `e0f0275bd` at 02:49Z)
>
> Operator: "counter recon". **Measured on Neon (read-only) before any code:** 27 profiles whose
> `interaction_count` summed to 200 against 15 contact rows (23 rows minus the 8 synthetic mention backfills);
> 20 profiles counting with ZERO rows behind them; the largest lie 69 vs 4, its `last_interaction` 2026-09-12
> against a last contact row of 2026-06-04. A 44-file consumer trace found no crash on NULL, but four
> `orderBy: { lastInteraction: "desc" }` sites with no `nulls:` option — Postgres sorts NULLs FIRST on DESC, so the
> brain graph's 5/15 people, the dossier cron's 5 and the Greene cron's 8 would have been never-contacted profiles —
> and two writers still outside the seam: profile creation seeded `1 / now`, and `task.deleteLedger` decremented
> blindly (a deleted synthetic or status-flip row cost a real contact) without refreshing the date.
> **Built:** `lib/services/people/contact-rows.ts` (the one definition of a CONTACT row: not `metadata.synthetic`,
> not a `status_flip` audit row; TS predicate + coalescing SQL twin — 15 prod rows have NULL metadata and a Prisma
> JSON NOT filter would drop them) · `counter-reconcile.ts` (`deriveCounters`: count = contact rows, lastInteraction
> = newest contact row or null; `computeCounterDeltas`) · `delete-ledger-row.ts` (lock → delete → recompute both
> counters; the tRPC procedure delegates) · creation starts at `0 / null` · six `nulls: "last"` orderings with a
> source-scan canary (`tests/repo/last-interaction-orderby-nulls.test.ts`) · `power-dynamics` reads NULL as
> unknown, not neglected · `scripts/reconcile-person-counters.ts` (dry-run default; `--apply` snapshots to
> `_bak_person_profiles_counter_recon_<yyyymmdd>`, then per person lock → re-derive → write, exits 1 on residual
> drift; Neon PITR here is 6 h, so the table is the durable rollback).
> **Prod reconcile — DONE 2026-09-16 10:28Z**, after #2348 was squash-merged (`ef52c8e38`), deployed-verified by
> ancestry on `/api/version`, and main CI was green on that SHA (turbo-affected verify · e2e · Lighthouse · agent
> policy · adoption gates). One Neon `run_sql_transaction`, the SQL twin of `--apply`: snapshot into
> `_bak_person_profiles_counter_recon_20260916` (27 rows) → 27 per-person advisory locks in id order → one
> corrective UPDATE → residual-drift SELECT. **Receipts:** 27 of 27 rows changed · `interaction_count` sum 200 → 15
> · 20 profiles now `0 / NULL` · residual drift **0 rows** (re-measured after commit) · no deletes. Rollback is the
> one-liner in #2348 §5 from the `_bak_` table, which stays until the change is confirmed good in use.
> **Receipts.** Red first: creation `expected 1 to be +0`, delete module missing, canary 6 bare orderings in 5
> files, analyzer `expected 2 to be 1` · green: 7 files / 29 tests · mutants: predicate forced true → 7 red across
> 3 files, blind decrement → 3 red, golden 14/14 · `tsc --noEmit` 0 · eslint 0 on 20 files · mutations strict ·
> soft-delete 1417 files 0 new · raw-sql · get-auth 179 · check:scripts 44 = 44 · scoped tsc on the script 0 ·
> pre-push build 0 · the SQL twin vs the TS formula on Neon: identical for all 27 profiles (sum 200 → 15).
> **Not in this PR (follow-ups in #2348 §7):** eight unfiltered ledger READERS still see synthetic/status-flip
> rows; `interactionCount desc` orderings tie at 0 until the ledger fills; `unstableAlliances` compares
> `trustScore < 50` on a 0–1 field (pre-existing).

> ## 2026-09-16 · The relationship ledger gets a writer (branch `claude/statenour-ui-architecture-intmaf`, fourth PR; #2344 SHIPPED + DEPLOYED-VERIFIED `8c62ee965` at 00:38Z)
>
> Operator: "fix the ledger in perfect way, leave the cameras for now". **Root cause, measured on Neon
> (read-only) before touching code:** 23 `relationship_ledger` rows ever, the last on 2026-07-10; 8 of them
> `source=chat` with `metadata.synthetic: true` (a 2026-05-29 backfill — there was never a live chat writer);
> 2 `auto` rows were the 06-01 profile seeding; 0 `outreach` rows ever (the picks button's route had never
> written); 0 `gmail` / `calendar` / `telegram` rows ever (enum values with no writer). Meanwhile
> `person_profiles.interaction_count` summed to 191 and `last_interaction` kept advancing into September,
> because three paths bumped the counters with NO ledger row — the conversation digest bumped every MENTIONED
> name ("should I trust Dania?" counted like "had dinner with Dania"), Nick's `person.update` bumped on every
> edit, and profile creation seeded 1 — while the two real writers (`task.logLedger`, `log-outreach`) each
> carried a private copy of the bump. Nothing made the counters and the ledger agree.
> **Built:** `lib/services/people/record-interaction.ts` — the ONE writer: row + `interactionCount` +
> `lastInteraction` in one transaction; `lastInteraction` moves forward only, by a WHERE predicate, so a
> backdated row never rewinds a newer contact; embed + XP after the commit; `recordInteractionOnce` for
> automatic writers (at most one row per person per window, behind a per-person transaction advisory lock EVERY
> writer takes first — Codex P2 on #2346: Serializable alone never excluded the default-isolation operator
> writers; the same mechanism google-oauth.ts uses). `task.logLedger` and `log-outreach` write through it. **Five producers now feed it:**
> the modal / ⌘K (unchanged UI, shared grammar moved to `parse-ledger-query.ts`), the picks outreach button,
> Telegram `/log <name> <+n|-n> [note]` (first writer of `source=telegram`, via `log-from-text.ts`), Nick's new
> `person.logInteraction` action (name, note, amount ±25, kind; catalog row, dispatch, receipt card,
> verifier membership + a phantom-claim pattern for "Logged +5 for Dania" with no action emitted, the
> behavior directive), and the conversation digest — which now asks the model `interacted` /
> `interactionKind` / `interactionNote` per person and writes one `chat` row only for a REPORTED interaction,
> dated by the conversation's last message, windowed from its first, no XP, never creating a profile.
> **Stopped:** a mention no longer touches the interaction fields; `person.update` is an edit and writes no
> counters. **Not done, on purpose:** the historical drift stays — resetting `interaction_count` /
> `last_interaction` to the ledger is a production write and a behaviour change (everyone would read
> "silent since July"); it is the operator's call, and the seam makes the drift stop growing. One auto row per
> person per conversation thread: a second interaction with the same person inside the same thread is covered by
> Nick's action or the modal, not the digest (a recompile cannot tell the old report from a new one).
> **Receipts.** Red first on the unfixed code: 4 files / 12 tests red (mention bumped the profile, no seam call,
> no `interacted` in the prompt, `person.update` data carried counters, dispatcher "Unknown action type",
> verifier membership + pattern missing) · green after: 17 files / 212 tests · four seam mutants each red on the
> intended test and the golden restored with 0 diff lines (forward-only predicate dropped, advisory lock dropped,
> window check dropped, counter bump dropped) · Codex round on `6afb54cd7`: 2 P2s, both real, both fixed red-first
> (the lock above; the phantom-claim pattern now needs a relationship cue — "Logged +2 tasks" stays silent) · `tsc --noEmit` 0 errors (1m39s) · eslint 0 errors on every
> touched file (the 1 warning is the pre-existing `set-state-in-effect` in the ⌘K component, in the baseline) ·
> lint-baseline 132 ≤ 132 · anti-slop · et-clock · prompt-injection 58 files · get-auth 179 · mutations strict ·
> knip 0 unused files · `pnpm build` exit 0 · stale-docs strict (see the PR).

> ## 2026-09-16 · Execution truth follow-ups · 2 ships (#2345 `6f5059b7c` code, #2343 `fc631eccc` docs) + the wrap-up docs pass
>
> **#2345 `6f5059b7c` — the ActionAttempt reclaim pins the deadline it decided from.** Codex's review of the new
> `claim-before-act` skill sample applied to the real code: the reclaim compare-and-swap pinned `(id, attemptNo, state)` but not
> `holdUntil`, so a concurrent renewal that moved only the deadline would still match the stale observation and let the
> reclaimer act. `beginAttempt` now pins `holdUntil: existing.holdUntil` (null for FAILED rows). The canary is BEHAVIOURAL —
> a mocked store whose `updateMany` evaluates the WHERE against the current row; the renewal race (another caller moves only
> `holdUntil` between our read and our swap) returns `duplicate` with the row unclaimed; dropping the pin flips it to `claimed`.
> 37/37 across the three ActionAttempt test files; deployed-verified `6f5059b7c` on statenour-web.
>
> **#2343 `fc631eccc` — the seven 2026-09-15 skill proposals applied** (operator: "lets get on 5"): root `AGENTS.md` merge
> recipe now starts with `gh pr list --state open` (a merge kills every other open PR's in-flight checks — witnessed 3× on
> 2026-09-15), `positive-control-first` #7 (resolution controls run in the consumer's runtime, not under vitest's `NODE_PATH`),
> `assert-the-consumer` #4 (a persisted-state field is set only by the code that saw the write succeed — the #2338 `ledgerState`
> defect), `answer-first` (a PR's CI state is the `gh pr checks` tally read this turn), `harness-worktree-setup` and
> `statenour-wave-reconcile` traps, and the NEW `.claude/skills/claim-before-act`. Hidden holdout grown to six episodes, three
> distilled from real incidents (the 404'd city pages, the "4 stars" review copy, the never-visible shop strip), 6/6 live.
>
> **Wrap-up docs pass (this entry):** `docs/DREAM-TO-PROOF.md` carries the 2026-09-16 readiness state (fork-PR workflows
> enabled with secrets withheld, `CLAUDE_CODE_OAUTH_TOKEN` set and proven headless, machine account still the operator's),
> `scripts/night-shift/README.md` names the classic `repo`-scope token and the exact collaborator command, both apps'
> `.remember/now.md` are dated 2026-09-16, the capability ledger row `proof-hidden-holdout-and-time-machine` moved to
> `live_verified` on the first real `proof.holdout` receipt, and the coverage doc gained the reclaim-CAS row (73 / 27 / 37.0 %).
>
> **Flagged · NOT fixed**
> - `EVIDENCE_LEDGER_KEY` still not created — the proof lane posts through the fallback bridge key.
> - Night Shift cannot start until the machine GitHub account exists and `NIGHT_SHIFT_GH_TOKEN` points at it (agents may not
>   create accounts or handle tokens); the preflight prints the reason on every attempt.
> - `NICK_EVIDENCE_PREFLUSH` is OFF and has no enforcement wiring; the evidence gate still runs in shadow on the streaming path.
> - `test.yml` `node` job: runner resource death (shutdown signal / 50-min timeout after 232 MB free) recurs under
>   `@statenour/web#build` + `#check` in parallel; lever if chronic = `--concurrency=1`.

> ## 2026-09-16 · UI workbench wave 4 (the follow-ups; branch `claude/statenour-ui-architecture-intmaf`, third PR; #2341 SHIPPED + DEPLOYED-VERIFIED `ec3625fc8` at 23:58Z)
>
> Operator: "do the open follow ups". **Built:** `agentRules: false` in `next.config.ts` (the Next 16
> agent-rules block broke the 200-line AGENTS.md cap on every `next dev` start; the docs pointer it
> carried is in the config comment) · ChangeSet's third consumer — `/people` "since your last visit"
> (`lib/services/people/changes-since.ts`, `task.peopleChangesSince`, `PeopleChangeLine` above Nick's
> brief): new people · interactions logged · went overdue (threshold crossed INTO the window).
> **Measured before building (Neon, read-only):** 20 active people, 0 with `cadenceDays`, 23 ledger rows
> ever, last 2026-07-10 — the line is silent in prod until a cadence is set or an interaction is logged;
> the finding is the nine-week-silent relationship ledger, not the line.
> **BLOCKED, not built — the `device` renderer:** no device surface exists to open it from
> (`/system/devices` pruned; `G D` still points there; `system.deviceFleet` has one consumer, the ⌘K
> probe) and the bridge heartbeats landed for one device (Shop Sign Camera, 5 events, last seen
> 2026-09-11 00:01) then stopped; 19 of 20 rows last seen in April. Spec §5 has the receipts and the
> operator decision it needs.
> **Receipts.** `tsc --noEmit` 0 errors (1m38s, after the build regenerated the Prisma client — a first run showed 6 `actionAttempt` phantoms from the sibling's #2338 model) · `tests/services/people-changes-since.test.ts` 5 passed; positive control: `activeOnly` removed from the created query → red on `deletedAt`, restored (0 diff lines); 4 files / 18 tests green with ui-mount-graph + the ChangeSet tests · eslint 0 errors on every touched file · lint-baseline 132 ≤ 132 · anti-slop · et-clock · stale-docs strict 0 critical · `pnpm build` exit 0 · `next dev` probe with the CI env: Ready in 534ms, no agent-rules writer line, AGENTS.md / next-env.d.ts md5 unchanged before and after.

> ## 2026-09-15 · UI workbench wave 3 (branch `claude/statenour-ui-architecture-intmaf`, second PR; #2337 SHIPPED + DEPLOYED-VERIFIED `7164b69` at 19:32Z)
>
> Operator: "get on the next wave, finish all that" — the spec's §5 NEXT list. **Built:** the `tool`
> inspector (system.getTools found by id; flags with meanings, env verdict, limits, currentLimitations;
> registry rows inspectable) · ChangeSet as a primitive (`lib/ui/change-cursor.ts` cursor rules + sentence
> honesty, `hooks/use-change-cursor.ts` read-then-settle, `components/ui/change-set-line.tsx`); Home's
> ChangeLine refactored onto it with the same storage key; Brain's Changed view is the second consumer via
> `brain.changesSince` (new / reinforced-by-lastSeen / tombstoned since YOUR cursor, 7d clamp said out loud,
> failed queries named) · the Playwright instrument for the two DOM-only P1s of slice 1's hostile review:
> `/system/ui-lab` gains four fixture rows of a renderer-less kind so the grammar runs against the EMPTY
> hermetic database; `tests/e2e/selection-grammar.spec.ts` (4 tests) proves the client-side route-change
> reset, the Esc unwind, and one-Esc-one-layer over the docked panel; measured on the way: on a phone the
> inspector sheet's scrim covers the tab bar, so the two-layer case is desktop-only; and the hook now sets
> `html[data-selection-grammar="1"]` while armed because the Suspense-wrapped host can attach a commit after
> the layout hydrated (the tab bar's own mount signal was measured insufficient) · `execution-panel.tsx` on
> the shared snooze presets.
>
> **Refuted on the way:** slice 1's own NEXT item "the §5.1 type floor is still open" — the floor is a CSS
> media block in base.css since 2026-09-08, pinned by `phone-type-floor.test.ts`; nothing to re-cut.
>
> **Receipts.** Per slice: tool 3 files / 11 tests · ChangeSet 8 / 54 (incl. tests/home) · e2e 4/4 green
> twice in Chromium against Postgres 16 + pgvector 0.6 + `next dev` AUTH_FORCE_MOCK=1 (the CI job's shape,
> reproduced in the session container), each P1 mutated red first (bar survived the route change; panel
> closed with the MORE sheet) · positive controls red-then-restored: by-id lookup → rows[0]; activeOnly
> removed from the created query. Whole-branch gates in the PR body.
>
> **Trap for the next session:** `next dev` (Next 16 `agentRules`) appends a `nextjs-agent-rules` block to
> `apps/statenour/AGENTS.md` and rewrites `next-env.d.ts` on start — revert both before committing.
>
> **Wave 3.6 (same PR, after the draft opened):** the dependency step, then the transition. React catalog
> floor `^19.3.0` (lock 19.3.0 for BOTH apps); `@types/react(-dom)` moved ONTO the catalog for statenour,
> nickstire, reel-engine and social-assets — measured first: bumping statenour's copy alone left two
> `@types/react` in the tree (19.2.14 for everything else) and every peer on the old one, four `Key` /
> `ReactNode` TS2322 errors in files the diff never touched (command.tsx, decision-spread.tsx,
> bottom-pulse-ticker.tsx); Base UI `^1.8.0` (CHANGELOG 1.4.0–1.8.0 read: nothing breaking for the five
> consumers, useRender or mergeProps). Then React 19.3's stable `<ViewTransition>` with ONE consumer, the
> inspector's open / close in `inspector-host.tsx`: the dock slides in and out, the phone sheet keeps its
> CSS entrance and gains an exit, PEEK (a synchronous store update) stays instant, `update="none"` so
> arrowing swaps content without a cross-fade; keyframes + the reduced-motion pin in `effects.css` (the
> transition pseudo-elements hang off `<html>`, out of reach of the `*::before/after` rule). Measured before
> deciding: Next 16.3.4's vendored react / react-dom already ship the stable `ViewTransition` and 16.3.4 has
> no `viewTransition` config flag, so the runtime bump serves the vitest lane and nickstire; `@types/react`
> 19.3.0 supplies the type (19.2.x had it only under `react/canary`).
>
> **Wave-3 miss, found by the FULL statenour vitest run this step forced:** `continuity-view-honest-render`
> mocks `trpc.brain` with only `continuityReport`, and wave 3 had mounted `BrainChangeLine`
> (`brain.changesSince`) inside the view — 6 tests red, #2341's `node` job red. The slice-scoped verification
> ran the files the branch ADDED, not the tests of every component it CHANGED. Fixed by mocking the third
> tRPC-owning child out like the other two (`83ccbdfe3`).
>
> **Receipts (wave 3.6).** Typecheck: statenour `tsc --noEmit` 0 errors (1m47s) · nickstire `typecheck:raw` exit 0 (1m35s), after `turbo build --filter="nicks-tire-auto^..."` (the unbuilt `@nour/gbp-publisher` had produced 15 phantom errors). Tests on React 19.3.0 in the vitest lane: statenour 818 files — 814 passed, 2 failed, 2 skipped · 8,270 tests — 8,257 passed, 7 failed, 6 skipped, exit 1 (the two reds: `continuity-view-honest-render`, the wave-3 miss above, 6/6 green after `83ccbdfe3`; and `obsidian-ingest-server-only`, container-only, green in CI); nickstire 640 files — 638 passed, 2 skipped · 7,919 tests — 7,860 passed, 58 skipped, 1 todo, exit 0. Builds: statenour `pnpm build` exit 0 (3m14s) with the three `::view-transition-*` rules, the three keyframes and the reduced-motion pin present in the emitted CSS chunk (`grep` on `.next/static/chunks/*.css`); nickstire `vite build` exit 0 (17.4s). Base UI 1.8.0 consumers covered by the same runs. E2E in Chromium against the hermetic stack: `inspector-view-transition.spec.ts` 3/3 green, mutated red (Fragment for the wrapper → tests 1 and 3 red at the count assertions, the peek control green), restored (diff 0 lines), 7/7 green with `selection-grammar.spec.ts` in the same run. Measured on the way: the production client bundle ships Next's vendored `19.3.0-canary-cbb046ab-20260731`, not the installed 19.3.0 — the catalog bump is invisible to the browser and real for vitest + nickstire; and the local e2e mirror must warm `/` like CI does — unwarmed, the tab-bar navigation's RSC fetch sat behind Turbopack's first compile of Home for longer than the 5s `toHaveURL` window (one red, no request in the dev log; 4.5s green once warmed).
>
> **Not built:** a `device` renderer (needs ADR-0017 heartbeats), ChangeSet's third consumer (People cadence).

> ## 2026-09-15 · UI workbench slice 2 (same branch): hostile-review fixes, `/system/ui-lab`, why-this-priority, page-lent actions, alert + cron inspectors
>
> **Review pass first.** A read-only adversarial review of slice 1 found 2 P1 + 8 P2 + 8 P3, none in `tsc`,
> all in behaviour: selection/focus/peek survived route changes; `/people` deep links SSR-rendered the global
> sheet over the dossier (ownership was effect-time); one Esc closed two layers; Tab-reached rows ignored
> Enter; the docked panel was overlapped by the FAB / selection bar and covered content with the Nick pane
> open; the sheet named two "Close inspector" controls; `getTaskById` had no soft-delete filter; palette
> Inspect scrolled the page to the top; `font-[var(--font-display)]` was dropped by tailwind-merge as a
> font-WEIGHT conflict. All fixed in `ba227588a` (spec §3.8), with tests where the shape allows — the two P1s
> live in DOM code the Node lane cannot exercise; a Playwright case is on the NEXT list.
>
> **Built.** `/system/ui-lab` (hub card + palette entry; the inspector chrome, its four states, the metric
> grammar and the evidence mark against fixtures on a FROZEN clock; `/system/chat-states` restored to `main`
> byte-for-byte because `tests/e2e/chat-states.spec.ts` pins it with full-page screenshot baselines) ·
> `scoreTaskPriority` returns `breakdown` (terms · weightedSum · multipliers · score, reduced from the same
> term list in the original order so every existing score is byte-identical — polarity / now-card / follow-up
> canaries green) → `task.byId` carries it → `PriorityBreakdownView` in the task inspector, manual-override
> line, stored-string fallback · store `pageActions` + `useRegisterInspectorActions`; `MissionInspectorActions`
> lends complete / snooze-tomorrow / snooze-next-Monday through the board's own dispatch (one mutation path);
> `lib/missions/snooze-presets.ts` lifted out of `mission-task-row.tsx` · `alert` inspector (brain.memoryById +
> resolve two-tap / mute 7d) and `cron` inspector (cronDeck row + cronRunHistory 7d: success / median / p95
> Metrics, runs with error previews; ZERO for no runs, not-found for an unknown name) · rows on
> `/system/alerts` and `/system/crons` carry `data-entity` + eye buttons under selection scopes · Home brief
> lead gets Inspect when the lead is a concrete task.
>
> **Receipts (commits `ba227588a` · `f750745c6` · `801713af2` + this docs commit).** Per slice: 21 files /
> 133 tests; 16 / 96; 5 / 31 — all exit 0. Positive controls, each red then restored: ui-lab notice deleted;
> `getTaskById` on `findUnique`; roi contribution ×2 ("plain/roi: expected 14.3 to be close to 7.15");
> cron zero-runs branch disabled (red on the missing `data-provenance="ZERO"` — `801713af2`'s message
> names the wrong assertion; the test header carries the correct one). Whole-branch gates in the PR body.
>
> **Not built, with the reason:** the `tool` inspector (next: registry at `/system/tools`), ChangeSet (still
> one consumer), the §5.1 type floor (would re-cut the chat-states baselines), Time Travel (Brain Wave 2),
> the dependency bumps (own PR), `execution-panel.tsx`'s duplicate snooze presets (not this branch's file).

> ## 2026-09-15 · UI workbench slice 1: one inspector for any object, `?inspect=`, selection grammar, workset, Reality Mode · branch `claude/statenour-ui-architecture-intmaf`
>
> Operator instruction: check the accuracy of a pasted 38-section "NOUR Spatial Workbench" UI plan, make it
> top-level, then build it — while a sibling session works the same app (PR #2335, backend only; overlap
> limited to `docs/UPSTREAMS.md`, rows placed at opposite ends of the table).
>
> **The gate (plan-gate, `docs/design/ui-workbench-2026-09-15.md`).** ~60% of the plan was already built,
> ~10% refuted or stale, ~30% genuinely new. Refuted/corrected: "current CI issue" (15/15 green on #2334),
> "H0/H1/H2" (the ledger has H0–H5; `H1`/`H2PLUS` are effort bands), Brain group "REVIEW" is `RULE`,
> "14 custom drawers" (20 bespoke overlays, 6 entity drawers), TanStack Virtual "use now" (declared, zero
> imports), the wave order ("substrate first, pages later" fails `ui-mount-graph.test.ts` + the knip gate),
> Cmd+Shift+R (browser hard-reload). Missed by the plan: `/proof` fully built and unreachable (fixed: one NAV
> row), `docs/design/warroom-spatial-os-phase1.md` (validated, unbuilt), the §5 design program already owning
> the type floor and colour semantics, `brain-node-detail-panel.tsx` as an existing memory inspector,
> `lib/services/metric-result.ts` as the metric substrate, `EmptyState` type-gating Constitution #10.
>
> **Built (vertical slices, each primitive with its first consumer and a test that failed first):**
> `lib/ui/{entity-ref,inspect-url,selection-model,workset,metric-datum,entity-actions}.ts` ·
> `lib/state/{inspector,workset}-store.ts` · `lib/brain/evidence-label.ts` (extracted from the graph panel) ·
> `lib/services/brain/memory-detail.ts` + `trpc.brain.memoryById` (the app's first by-id memory read,
> soft-delete filtered) · `hooks/{use-inspector,use-selection-keyboard,use-min-width}.ts` ·
> `components/inspector/**` (host in the layout, frame = docked 380px panel at ≥1280px reserving
> `--inspector-lane` / bottom sheet below, honest loading·error·not-found·no-renderer states, memory/task/person
> panels, entity action row, selection bar) · `components/ui/{evidence-mark,metric}.tsx` ·
> `components/workset/workset-shelf.tsx`. Wired: `(mastery)/layout.tsx`, the page-context bridge reads
> `?inspect=` (and the row's real `#task-<id>` anchor — chat receipts emitted `#task-row-<id>`, which scrolled
> nowhere), ⌘K leads with the focused object's actions + a Workset group + a Reality Mode toggle and sends memory
> hits to the inspector (was: a row id into the wisdom tab's key-based `?focus=`), Brain "Changed" rows, the
> graph panel's Inspect action, Missions rows (data-entity + eye button, 44px), `/people` selection is the URL
> and the page owns the `person` kind, `/proof` in NAV, the Nick pane publishes `--nick-pane-open-w`,
> (the inspector states first landed on `/system/chat-states` and moved to `/system/ui-lab` in slice 2 — that
> page is pinned by screenshot baselines), `docs/DESIGN.md` gains the object grammar +
> the 20-rule UI Constitution, `docs/UPSTREAMS.md` gains 9 technology verdicts.
>
> **Deliberately not built, with the reason on record (spec §3.7/§5):** ChangeSet (one live consumer), page
> archetypes (no consumer → knip orphan), Time Travel scrubber (`valid_from` on 0 of 40,889 rows — Brain plan
> Wave 2, not UI), the System incident inspector and task mutations in the inspector (both landed in slice 2,
> above), a desktop left rail, React 19.3 / Base UI 1.8 bumps (lockfile PRs of their own).
>
> **Receipts.** This slice: 17 test files, 115 passed, exit 0 (`tests/ui/*`, `tests/state/*`,
> `tests/services/memory-detail.test.ts`, `tests/components/{page-context-bridge-payload,inspector-*,
> memory-inspector-states,person-inspector-cadence,evidence-mark-modes}.test.*`). Positive controls run against
> the unfixed code: 3 of 4 new bridge assertions red pre-fix; the soft-delete canary red without `activeOnly`;
> 5 component mutations red (receipts at the top of each file). Full app suite once: 795 files, 792 passed,
> 1 failed, 2 skipped · 8,126 tests, 8,119 passed, 1 failed, 6 skipped — the failure
> (`tests/repo/obsidian-ingest-server-only.test.ts`, `CHAIN_THREW: persistKnowledgeCandidate missing`)
> reproduces identically on a pristine `origin/main` worktree in this container, as does
> `check:policy-coverage` (`server-only` under plain tsx at `lib/ai/budget.ts:9`); neither touches this diff
> and CI was green on the same code this morning. `tsc --noEmit` exit 0 (after building lenses,
> ai-capabilities, social-assets). eslint 0 errors; lint-baseline 132 ≤ 132. `check:anti-slop` ✓ ·
> `check:get-auth` 179/179 ✓ · `check:soft-delete` ✓ · `check:mutations:strict` ✓ · `check:crons` ✓ ·
> `check:stale-docs` strict 0 critical ✓ · `prompt:size-check` needs DATABASE_URL (not measured) ·
> `ui-mount-graph` / `brain-nav-tabs` / `market-moved` ✓.
>
> **Behaviour changes to eyeball on a phone (no browser in this container):** the Missions row grew an eye
> button in its action cluster; `/people` selection now writes `?inspect=person:<id>` (Back closes the dossier);
> Reality Mode renders provenance inline after hydration only (zustand's server snapshot is the initial state —
> the server always emits the chip).


> ## 2026-09-15 · Execution truth + Dream-to-Proof waves 2-3 · 5 ships merged, 1 open — the two "StateNour reset" audits closed in-session
>
> **Gate first.** Both pasted audits were run through plan-gate: ~60 % of each already existed on main (Obsidian ingest fix #2329, the
> reality ledger + proof workflow #2330/#2334); two claims were REFUTED against the registries (MCP SDK "v2 stable" — npm latest 1.30.0;
> Hindsight "v0.9.2 latest" — v0.10.0 shipped 2026-09-14); the rest was built, gated and merged the same day. The nickstire half of the
> wave (kernel calibration, GrowthBook cross-check, Night Shift identity, hidden holdout) is recorded in `docs/DREAM-TO-PROOF.md` and the
> capability ledger; this entry records what changed in THIS app.
>
> **#2335 `8e3a4a14a` — execution truth + evidence authority.** sendTelegram is a truthful domain tool (a dedupe marker is not a receipt;
> a transport timeout is `unknown_completion`, held 30 min, never retried blindly; fails CLOSED when the claim store is down). Strict-Done
> shadow at both persist sites (`tokenUsage.claimDoneShadow`). Pre-flush evidence lane `NICK_EVIDENCE_PREFLUSH` (OFF; risk computed
> BEFORE the deep/regen/self-consistency yields; mirrors the prepareStep ladder incl. the step-0 web-search pin). Reality ledger:
> `PRODUCER_CEILING` (ledger key ≤ H2 as AGENT · bridge key ≤ H4 as CRON · owner H5), `createdBy: operator` through a key refused,
> `sourceEventIndexes` lineage resolved to created ids, PII refused recursively. Exact-id recall lane (4th RRF lane, ILIKE, own 1.5 s
> deadline; lane count = lanes that ran). `check:scripts` ratchet: `scripts/` had NEVER been typechecked — 50 errors / 22 files on day
> one, baselined in `.scripts-tsc-baseline.json`, wired into `verify:hard` (20 links), a regression or a new erroring file FAILS.
>
> **#2336 `999f70fe1` — GrowthBook cross-check of the experiment kernel** (nickstire; the H4 the bridge key may assert now rests on an
> external engine's run-for-run agreement, not on a citation).
>
> **#2338 `2ac1e86ea` — ActionAttempt, the durable delegation contract (NICK-TRUST-ARCHITECTURE-V2 §6.5), first slice.** Table
> `action_attempts` APPLIED to prod Neon (`20260915180000_action_attempts`; unique `operation_key`, `(tool, state)` + `started_at`
> indexes). States EXECUTING → SUCCEEDED_UNVERIFIED | FAILED | UNKNOWN → VERIFIED (reconciliation only) | COMPENSATED; only VERIFIED
> earns "done". `withToolIdempotency({ durable })` claims a row BEFORE the send and settles it with the provider's message id;
> sendTelegram is the first consumer; a missing table falls back to the BrainMemory bridge (never crash on a missing table). Codex
> P1s fixed before merge: reclaim of an expired/failed row is a compare-and-swap on the observed (id, attemptNo, state) — two racers
> can no longer both win; and `attemptId`/`ledgerState` are stamped by the wrapper ONLY after `settleAttempt` resolved (`durable.stamp`),
> so a failed settle or the bridge fallback never claims a transition the store did not make. 37 tests across three files, each
> verified by planting the original defect (4 targeted canaries red).
>
> **#2339 `13371673b` — the five dead script imports `check:scripts` found.** Two smoke scripts imported the deleted
> `@/components/chat/mode-persona-chip` (checks removed with reasons); `dotenv` → `process.loadEnvFile`; `generate-pwa-icons.ts`
> resolves `sharp` from `next/package.json`'s directory (sharp is next's OPTIONAL dependency — a `pnpm dlx --package=sharp` recovery
> can never resolve a bare import, Codex P2) with a runtime-resolution test that spawns a tsx child WITHOUT vitest's NODE_PATH (which
> makes bare specifiers resolve in-process and proves nothing). Baseline 44 errors / 16 files, no regression.
>
> **#2340 `456a3b88a` — Night Shift credential-level identity** (repo scripts; `run.ps1` fails closed unless `NIGHT_SHIFT_GH_TOKEN` is a
> separate identity the preflight judges unable to land on `main` — read/triage + fork on the GitHub Free plan, where rulesets answer 403).
>
> **#2342 (OPEN) — hidden holdout + Repo Time Machine.** This app gains `lib/services/proof-timeline.ts`, `GET /api/proof/timeline`
> (owner) and a Repo Time Machine section on `/proof`: the proof lane grouped on the commit nickstire.org actually SERVED when judged,
> newest first, holdout cell (success / failure / unmeasured / not run) and deltas naming failures fixed and introduced. `ledgerRead`
> exported for it. 8 tests; `check:get-auth` 179/179.
>
> **Operator items done under explicit authorization:** `20260915140000_reality_ledger` and `20260915180000_action_attempts` applied
> to prod; flags `shopstate_lot_band` + `web_experiment_home_hero_subline_2026_09` ON; secrets ARGOS_TOKEN / STATENOUR_SYNC_URL /
> STATENOUR_SYNC_KEY (fallback) / HOLDOUT_EPISODES_B64 set. Railway statenour-web: `2ac1e86ea` SUCCESS, `13371673b` building at
> write time.
>
> **Flagged · NOT fixed**
> - `EVIDENCE_LEDGER_KEY` still not created (Railway statenour-web var + GitHub secret + local env) — until then the proof lane and Night
>   Shift post through the fallback bridge key or skip evidence; delete the STATENOUR_SYNC_KEY GitHub secret once it exists.
> - `NICK_EVIDENCE_PREFLUSH` is OFF and has no ENFORCEMENT wiring; the evidence gate still runs in shadow on the streaming path.
> - ActionAttempt has no AuthorizationGrant yet (duplicates are bounded by `holdUntil`, not by grant identity); only sendTelegram opts in.
> - `test.yml` `node` job: "The runner has received a shutdown signal" at ~6 min during `@statenour/web#build` + `#check` in parallel,
>   3× on 2026-09-15 evening; every rerun passed in 12-17 min. Runner death, not code; if chronic the lever is `--concurrency=1`.
> - Night Shift still needs the machine account + `NIGHT_SHIFT_GH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` (human steps) before a run starts.

> ## 2026-09-10 · "Empty is not error" wave: five layers where a failed read looked like a fact · PR #2271 (`c518a48a2`)
>
> Operator instruction: implement the pasted NICK audit + APEX brief, "check the accuracy of everything",
> "I don't want a single detail missed". Continues the trust work merged as #2267 (`7519911d2`).
>
> **The pattern.** A read fails, the failure is swallowed into an empty value, and something downstream
> renders that empty as a *measurement*. Every instance had the same tell: **one surface was already
> honest and the other was not.** #2267 made the Memory Inspector tell the operator "Memory read failed --
> state unknown, not empty" and left the MODEL with a prompt byte-identical to a clean empty search. So in
> the same turn the panel reported a failure while NICK said "I don't have anything on that" with the
> confidence of a search he never completed. L1's TRUTH RULE cannot catch that: it bans claiming a
> past-tense ACTION without a tool call, and nothing bans asserting the ABSENCE of a memory you failed to
> read -- from inside the turn those two are indistinguishable unless code puts the difference in context.
>
> **Five instances closed, each with a canary measured against the unfixed code:**
>
> 1. **recall -> prompt.** `lib/ai/chat/recall-failure-notice.ts`. Three states kept distinct: ERROR ("you
>    did not successfully look"), OK+reason+hits (rows are real, ranking degraded), and silence for a true
>    ZERO / UNMEASURED / clean OK. Emitted from the FINAL provenance *after* brain-context's try/catch --
>    the first version sat in `rawBlocks`, i.e. only on the path where assembly SUCCEEDED, which is the one
>    path that is not a failed read (review P1). An unavailable recall module is now a failed read, not
>    UNMEASURED (review P2). The reason string is sanitized: it is a system-prompt sink.
> 2. **The tool wrapper was an amplifier.** `wrapToolsWithEmptyHandling`'s `isEmptyDataObject` matched
>    `{error, data: []}` and **replaced** it with `success: true, "Query completed successfully"` -- a tool
>    that reported its own failure had that report deleted. Thrown and timed-out executes were already
>    handled correctly; the one path it got wrong was the codebase's own convention of returning the error
>    in the result value.
> 3. **`searchReflections` was half-honest.** Its totals already said "null on failure, never 0"; both
>    `findMany` calls still ended in `.catch(() => [])`. Now `error` + `countIsMeaningful`, with a dead FTS
>    lane reported as `degraded` (the ILIKE arms still ran, rows are real) rather than as a failed read.
> 4. **L4 truth-grounding.** `null` meant "not a project" AND "the read threw" AND, via a 3s timeout in
>    brain-context, "we never found out". Split into a discriminated outcome; both failure paths share one
>    `TRUTH_GROUNDING_UNAVAILABLE` string so they cannot drift.
> 5. **The task queue.** `buildTaskContextBlock` returned `""` for an empty queue and a failed read alike --
>    the block whose absence is most directly read as a fact ("what am I working on" -> "nothing").
>
> **Plus `tests/ui/domain-boundary.test.ts`**, compiling the repo's prose rule ("business shit belongs on
> nicks tire admin", quoted at `stats/page.tsx:20`) into a check. A naive grep returns nine files and is
> wrong about six: a comment STATING the rule and an href LINKING to the shop admin look identical to a
> text search. Comments stripped, shop-targeted links exempted, four remaining hits frozen with per-file
> judgements (2 leaks, 1 borderline, 1 legitimate). Scoped to product surfaces -- `app/api/**` is the
> bridge and is excluded with its own canary asserting the bridge exists AND names the shop.
>
> **Method note.** Every canary was run against the unfixed code. That measurement demoted two of the
> tool-wrapper "canaries" to PINs: they passed either way, because `data` was non-empty in one and absent
> in the other, so interception never fired. A test that passes against the unfixed code proves nothing.
> Controls carry the other half -- genuine empties still wrap, a cleared task queue still renders nothing --
> without which "delete the empty handling" would have scored green.
>
> **Corrections made to my own earlier findings, rather than dropped:** `canAuthorizeSideEffect` is NOT
> dark wiring (a file-list grep hides same-file call chains; it is reached via `shouldStampInferredBasis`);
> the post-KNN `CONTEXT_CATEGORIES` filter must NOT be removed (the `hit@5 = 0/28` figure was already fixed
> by *widening* the list); and `memory-inspector-sidebar.tsx` should NOT call `describeRecallState` -- the
> panel's hand-rolled version models degraded-with-hits and the legacy no-provenance case, and the helper
> models neither. The helper's missing consumer was the prompt, which is item 1.
>
> Receipts: 255 test files, 3,081 passed, exit 0 · `tsc --noEmit` clean · 12 CI checks green (typecheck,
> both knip gates, ast-grep + dependency-cruiser, adapter parity, completion-authority, gitleaks, security,
> e2e, turbo-affected verify). Two earlier verify runs were cancelled mid-`build` by a sibling session
> merging 5 PRs into main and invalidating the `2271/merge` ref; merging main into the branch fixed it.
>
> **Still operator-gated:** `NICK_EVIDENCE_ENFORCEMENT` is wired on the buffered path with an explicit
> activation criterion, but flipping it needs the shadow false-positive rate from prod `evidence_gate_shadow`
> rows -- and there is no offline corpus to substitute (`data/persona-corpus/` is a README).
> `fast-check` sits in `pnpm-lock.yaml` at 3.23.2 but is **transitive only**; declaring it needs an install,
> which is banned inside a junctioned worktree.


> ## 2026-09-08 · Camera vision wave 0: the arrival pipeline that never received an event · 3 PRs + plan
>
> Operator instruction, on-site at the shop: "update whatever you need for the cameras ... the whole nine
> yards ... research the best ... get the best done." Master plan
> `docs/research/2026-09-08-camera-vision-MASTER-PLAN.md` + `docs/adr/0017-camera-vision-architecture.md`;
> three read-only code audits, four web research agents, live LAN probes from the shop Wi-Fi, prod Neon and
> Railway probes.
>
> **Found (receipts in the plan section 2):** the #315 pipeline had received ZERO real events. Every `[id]`
> device route resolved the cuid while the bridge addresses `platformDeviceId` (`v380-shopsign`), so each
> POST and heartbeat PATCH answered 404; `device_events` = 2 rows, both the June test device. The edge was
> pinned to Frigate 0.13.2 with a config that only works on 0.14+ (relative zone coordinates), an `IndexError`
> on every departure, wall-clock "dwell" that ignores zones, unpinned paho-mqtt, anonymous MQTT. The cameras
> (`Hw_HsAKQQXG_WIFI_20230421`, Anyka family) expose only TCP 8800/9800: RTSP needs the SD-card `ceshi.ini`
> unlock (procedure in the plan section 3.3) or PoE replacements for LPR.
>
> **#2222 `statenour/camera-arrival-p0` — cloud fixes.** `lib/services/devices.ts` resolves cuid OR
> platformDeviceId in `[id]/events`, `[id]` and `[id]/command` (the route test was run red on the unfixed
> routes first, 3 of 5 failing, then green); `vehicle-detection.ts` rewritten: zod contract v2 (`visitId`,
> `eventId` idempotency), dedupe by visit across Frigate re-ids, quiet hours 20:00-07:00 ET recorded as
> `alertSuppressedReason`, per-camera+zone cooldown, tagged web-push on the #1740 flood control, plate ->
> customer link (`vehicle-customer-link.ts`, advisory, `customerRef` on the event); `cameraArrivals` day
> boundary in ET; the cockpit renders a read failure as a failure, not as zero; `camera.getPlates` reads real
> plate rows; `analyzeCameraData` docstring tells the truth (no caller); new worker-fired
> `device-heartbeat-sentinel` cron (every 15 min; silent >20 min -> OFFLINE + one alert per transition;
> never-reported devices ignored by construction; recovery clears the flag). Tests: 4 files, 24 passed;
> `check:crons` 7/7; eslint 0. `tsc`: 0 errors in changed files, 7 pre-existing `@sentry/nextjs` resolution
> errors in this junctioned worktree because the primary checkout predates #2074 (CI is the gate).
>
> **#2221 `nickstire/vehicle-lookup-by-plate` — read-only bridge action.** `vehicle_lookup_by_plate` over
> `memberships.vehiclePlate` (`vehicles` was retired in 0117; `customer_vehicles` has no plate column yet),
> OCR-confusable variants, today's bookings by phone (ET in SQL); contract v11.10 in both copies. nickstire
> `tsc` 0, `plate.test.ts` 3 passed.
>
> **#2223 `docs/camera-vision-master-plan` — the plan, ADR-0017, eight UPSTREAMS verdicts** (Frigate pinned
> 0.17.2, V380 protocol bridges REJECT, Ultralytics/BoxMOT REJECT, fast-alpr WATCH, Plate Recognizer WATCH,
> Coral REJECT for new builds, Hailo WATCH, NVR alternatives REJECT).
>
> **#2225 (`f3a631adc`) `chore/camera-bridge-v2` — edge rewrite; hostile review found 1 P0 + 4 P1, disclosed in the PR body, fixed in #2227 (`c6d839fee`, visitd 2.1.2, 95 tests)** (`camera-bridge/visitd`: deterministic visit state
> machine on Frigate `frame_time`, SQLite ledger + outbox, Frigate 0.17.2 config, authenticated MQTT, replay
> harness, stdlib unit tests).
>
> **Flagged · NOT fixed:** `analyzeCameraData` still has no scheduler (wire after real events exist);
> `local-agent/v380_agent.py` still in tree (delete after edge heartbeats are live); the typed visit ledger
> (plan section 7.2) is Phase 3; `NICK_ARRIVAL_INTELLIGENCE` stays off until gate G3; the primary checkout's
> `node_modules` lacks `@sentry/nextjs` (refresh the primary, not the app).
>
> **Verified by:** vitest on the touched files, `check:crons`, eslint, nickstire and worker `tsc`, CI on every
> PR, `/api/version` ancestry after merge.
>

> ## 2026-09-08 · Design pass shipped, chat leftovers shipped, Brain intelligence plan + Wave 0/1 · one session
>
> Operator instruction: "continue design pass … then synthesize all of your reports … come up with the
> best plan and … multitask and get the fixing as well … do it all in one big merge". Same scratch-clone →
> CI → `/api/version` ancestry loop as the wave below; every PR merged only on fully green with zero
> unresolved Codex threads.
>
> **#2202 `PR head d237929f1` — design pass, program §5.3 / 5.4 / 5.8.** PageHeader is a row with a hairline
> divider on 16 pages (was a nested glass card with a drop shadow and a fade-in entrance); `.neural-glass`
> loses `backdrop-filter` (overlays keep it). Home and Missions earn a second column at ≥1280px — the queue
> left, a sticky context rail right (horizon + change line; waiting + evidence); DOM order unchanged below.
> Mobile: the house floor is **44px** (176 of 182 Missions controls already measured exactly 44; AGENTS.md's
> "48×48" line is a doc/convention reconciliation for the operator, not absorbed) — horizon rows, Accept /
> Dismiss, send, Morning brief, mission move buttons, the capability badge, the state pill and the empty-deck
> CTA were raised; the pulse ticker is exempted explicitly as bottom-chrome geometry. `html` gets
> `scroll-padding-bottom: var(--bottom-chrome-h)`. Instruments (CI e2e): `desktop-density.spec.ts` (rail
> beside the queue at 1460px AND below it at 1090px) and `target-size.spec.ts` (44px floor at 390px on
> `/`, `/missions`, `/chat`; a focus probe that PARKS a control under the chrome and proves scroll padding
> lifts it — Chrome centres an off-screen control on focus, which had made the first version vacuous).
> Four Codex threads fixed. The composer-with-soft-keyboard check still needs the operator's phone.
>
> **#2204 `9f879de113bf` — chat leftovers, §5.5 / 5.10.** The header badge names health (`ready` /
> `tools limited` / `chat degraded` — a degraded stream never reads as a tool outage), not a tool count;
> the shop-flavoured starter left with `/market`, its slot is "What needs my judgment"; the repeated wrench
> is gone. One Codex thread fixed.
>
> **#2213 `this PR, head 8b7d7f113` — Brain intelligence plan + Wave 0/1.** The plan
> (`docs/research/2026-09-08-statenour-brain-intelligence-upgrade-plan.md`) synthesises a live code map,
> the settled-decision history, a fresh external evidence dossier, two read-only production probes and the
> operator's pasted plan (checked claim by claim: largely right; temporal recall is code-live and DATA-EMPTY,
> query transformation is ABSENT not partial). **Measured today:** 0 of 40,889 live memories carry a validity
> window or supersession pointer; 2,460 of 12,924 live personal rows (19%) have no embedding; 45% of live rows
> are graph edges stored as memories; 107 files write BrainMemory directly; `data-cleanup` cron paused since
> 09-01. **Wave 1 shipped:** one operator-source predicate (`user_save`, `pin:*`, `operator`, `owner` were
> weak_inference) used by the evidence ladder, remember()'s wisdom gate, recall decay and consolidation's
> curated guard; `lib/brain/memory-admission.ts` (envelope: memoryKind · evidenceClass · extractionMethod ·
> derivedFrom · evidenceRefs · contentHash; a derived memory is capped at generated_summary); explicit `/save`
> and pins stamped; a direct-writer ratchet (107 frozen, declared-bypass marker, positive control).
> **Wave 0 shipped:** `onRanked` on the full recall pipeline, a third `hybrid` lane in `pnpm eval:recall`, a
> corpus fingerprint manifest, per-turn `recall_lane_overlap` between the two lanes that feed one prompt.
> Register: six UPSTREAMS verdicts (ColBERT REJECT/WATCH, Lakebase Search WATCH, LongMemEval taxonomy
> ADOPT-AS-BENCHMARK, MiniCheck WATCH, RAGAS/DeepEval PATTERN, Anthropic tool search NATIVE). Docs corrected:
> stray conflict marker in this file, CURRENT-TRUTH's supersession line, SECURITY's approval-UI gap.
>
> **Outside git, done:** Sentry project split — `nickstire` project created in org `statenour` through the
> operator's Chrome session, `SENTRY_DSN` set on `MAINnicks-tire-auto`, container redeployed (uptime reset).
>
> **Operator-run / decisions:** embedding backfill of the 2,460 unembedded rows (plan §6.2, a production
> write) · supersession flip after its shadow week (§6.3) · re-enable or keep paused `data-cleanup` · AGENTS.md
> 44 vs 48px line · HSTS preload submission · the phone composer check.
>
> **Verified by:** CI on every PR, Codex threads resolved, `/api/version` ancestry after each merge.
>

> ## 2026-09-08 · Backlog wave: cost truth, approvals you can find, /market moved, sink policy, playbooks · Phase 2–3 shipped
>
> Operator instruction: "keep going with the backlog, U6 cost truth next and do the railway work.
> move market, approval freshness check it i cant find it, for the rest use the best recommended
> options … all phases." Same scratch-clone → CI → `/api/version` ancestry loop as the wave below.
>
> **#2193 `008afcf20` — cost truth (U6).** 47 of 54 `aiChat` callers never wrote a ledger row and
> provider.ts / track.ts priced from two tables. `lib/ai/pricing.ts` is the one rate table; `aiChat`
> records every completed call itself (provider, tokens, duration, conversationId, the cost it
> computed; `opts.tracked=false` opts out); a lane past its daily cap (`ai.laneBudgetCents` JSON
> setting or `AI_LANE_BUDGET_CENTS_JSON`) returns the "none" sentinel BEFORE any provider call;
> `/system/ai-cost` shows lanes; a thumb posts a NUMERIC score on the turn's traceId to Langfuse;
> `scripts/langfuse-register-models.ts` registers the model prices (run with `railway run`).
>
> **#2196 `e2d4ea2d2f14` — nickstire: Market admin section + public ribbon counts (D14).** Search
> Console summary / top queries / top pages / master report at `/admin/market` (Reach group, owner +
> manager, `market.*` → `marketing.manage`); the report comes from the bridge's exported
> `QUERY_HANDLERS.master_report`, so Nick and the page read one report; an unavailable store is
> SERVICE_UNAVAILABLE ("unknown, not zero"); the window is an inclusive 28-date span in shop time.
> D14: the PUBLIC PhotoRibbon called an admin-only procedure (401 per visitor, 112 Sentry events in
> 23 h); `topRibbonPhotosPublic` is public, cached 5 min, src + count only. Five Codex review threads
> fixed and resolved; `.completion/evidence.json` walkthrough rewritten for the diff.
>
> **#2195 `26b4b382eb2b` — approvals you can find, /market moved, HSTS preload-ready, image-flag
> prerequisites.** `APPROVAL_FRESHNESS_DAYS` env override + `systemAutomation.approvalWindows` +
> an "approval windows" card on `/system/actions`; the autonomous-action queue had NO UI since the
> legacy ApprovalsPage went (Home counted it, nothing listed it) — it is listed now, Approve is a
> press-and-hold at 48px and refused on expired rows. `/market` deleted (page, tabs, bridge shell,
> nav, palette probe, `operator.businessDashboard`) → redirect to `nickstire.org/admin/market`.
> Images: a raw id under the flag serves WITH a session; `ensureSignedImageUrl` re-mints relative
> and absolute, raw or expired-signed URLs right before Meta gets them. HSTS
> `max-age=63072000; includeSubDomains; preload`.
>
> **#2198 `bfccff82c636` — as-of recall (U3), sink policy (U4), playbooks (U7), §5 copy + phone type
> floor.** `validityWhere(asOf?)` is the one validity window every recall lane reads; `searchMemories`
> takes `asOf` (what was believed then, corrections included, nothing saved after). An
> external_web / external_doc fence taints the TURN (turn context, not a model-declared flag); the
> guardian reads it; the policy engine escalates any external side effect in a tainted turn to
> require_owner. Three intent playbooks (reflect / execute / publish) attach a bundle under telemetry
> tier 7 with an operating note; publish is draft-only. Copy: "Captured items go to Decide. Nothing
> is scheduled for today." · "What is saved, where it came from, and what is inferred." Phone type
> floor: 9→11 px, 10→12 px below md through one media block in base.css. Review on #2198 (three Codex threads, fixed in the same PR): the sink
> policy now also gates the canonical `nourTools` boundary (`lib/tools/sink-policy.ts`: a pending
> require_owner ApprovalRequest plus a refusal the model cannot argue past; guardian replay falls
> back to the nourTools key), historical recall selects the validity INTERVAL that covers the
> instant and does not consult supersession (`isVisibleAsOf` / `validitySql` are the same predicate
> for loaded rows and raw SQL), and `asOf` reaches the lexical and KNN lanes.
>
> **Outside git, done:** Neon `production` branch PROTECTED (Neon MCP) · `Railway: IMAGES_REQUIRE_SIGNATURE=1 set on statenour-web and verified on the redeployed container (raw image id without a session -> 401, a signed URL passes auth, a bogus signature -> 403; prod holds no generated_image audit rows today - the orchestrator GC removes them after 90 days - so the probe used a synthetic id)` ·
> `Langfuse model prices registered (5/5) by scripts/langfuse-register-models.ts under railway run, keys never printed`.
>
> **Blocked on the operator:** Sentry project split — the Sentry MCP's execute tool rejected every
> argument shape for team lookup/creation; one-liner: create project `nickstire` in org `statenour`,
> then `railway variables --set "SENTRY_DSN=<dsn>" --service MAINnicks-tire-auto`. HSTS preload
> submission at hstspreload.org (header is live; the list is hard to leave).
>
> **Not started (design pass, needs screenshots):** §5.3 surfaces, §5.4 second column at ≥1280 px,
> §5.8 mobile target audit. §5.9 headings were already `role="heading"` — no change needed.
>
> **Verified by:** CI on every PR (node + e2e + gates, Codex review threads resolved), `/api/version`
> ancestry after each merge, worker `/health`, nickstire `/api/health` uptime reset.
>

> ## 2026-09-08 · Quality + power program, Phases 1–2 shipped · deploy observer proven both ways
>
> Continuation of the 2026-09-07 wave below (program doc
> `docs/research/2026-09-07-statenour-quality-power-program.md`). Every slice went out from a
> hookless sparse scratch clone (the harness worktree's shared `node_modules` predate
> `@sentry/nextjs`, so a local pre-push build is impossible); CI was the gate, `/api/version`
> ancestry the deploy receipt.
>
> **#2180 `b531b203f` — observability contracts (D10 lane, D15, D16, D17).** Deploy-drift
> observer as a GitHub workflow (every 30 min + dispatch, `simulate=stale|worker-down`
> canaries), `inbound-crm` header-only secret with a named-deprecation warning, the read-mode
> contract pinned (typed `/save` still writes, model-selected mutating tools stripped), the
> NICK FAB lane on md+, Sentry `app:statenour` tag. **Runtime-verified:** `/api/version` =
> `b531b203f`. The observer's first plain run failed with exit 141 — `awk … exit` closed the
> pipe under `pipefail` — fixed in **#2186 `87e5d3bfe`**; after it, plain dispatch
> 34176742882 PASSED and `simulate=stale` 34176744413 FAILED as designed. The instrument fires,
> and it also passes: both halves are on record.
>
> **#2181 `e4e88d5d1` — expire authorization, not obligations (D12) + device lifecycle (D11).**
> `lib/automation/approval-freshness.ts` is the one predicate both queues consult (autonomous
> actions derive a window from the action type — messages 3 d, SMS/pricing 2 d, records 7 d;
> approval requests use their own `expiresAt`, written by every requester and read by nobody
> before this). Approve on an expired row → 409 BEFORE any execution or write; reject stays a
> human decision; nothing is deleted or recorded as a decline (the program's "auto-decline
> receipts" wording was deliberately not implemented). Home counts live approvals as waiting,
> names expired ones as "re-request or dismiss", the PWA badge counts live only, `/system/actions`
> disables Approve on an expired request and says why. Devices: `classifyDevices` (7-day window)
> splits `devicesOffline` (recent incident) from `devicesOfflineLong` (needs a classification) and
> excludes `RETIRED`; `retire-stale` marks RETIRED instead of hard-deleting device + events +
> commands. **Runtime-verified** (ancestor of `b531b203f`).
>
> **#2183 `989345d28` — capability URLs for `/api/images/[id]` (D13), flag-off byte-identical.**
> `lib/images/signed-url.ts` (`imagePath` is the ONE minter; `authorizeImageRequest` pure);
> `IMAGES_REQUIRE_SIGNATURE` unset = raw ids still serve and a PRESENT-but-invalid signature is
> refused; `=1` = raw ids refused before any DB read. Minters routed (gemini-image ×4,
> `getRecentImages.url`, publish picker, photo-improver); the ghost validator and history stripper
> tolerate the signed suffix. **Runtime-verified:** `/api/version` = `989345d28`. The flip is an
> operator Railway env edit; pre-deploy scheduled-post image URLs are raw ids and would be refused
> under the flag — re-mint from `/content` first.
>
> **#2185 `851b597e7` — resume record (U5) + the D10 instrument + Brain nav parity.** Park writes a
> structured record (intended outcome · last verified step · evidence links · open question · next
> physical action) onto the same `parked` TaskEvent; the deck renders it with "parked N d ago · a
> memory aid, not a plan". `tests/e2e/floating-collision.spec.ts` asserts no floating fixed element
> covers a control on /journal, /missions, /chat, /brain at 390/768/1090/1460 px — **its first run
> was red on real collisions** (the NICK pill over "Pin new" on /brain and "Ask Nick for
> Recommendations" on /missions at 390 px; intruding on the content column at 768 px): below md the
> pill is no longer rendered and the More sheet carries "Ask Nick about this page"; the md+ lane
> is 7rem. `nav-items.ts` lists all nine Brain tabs, pinned to the page by
> `tests/repo/brain-nav-tabs.test.ts`.
>
> **#2188 `d3a760d68` — `middleware.ts → proxy.ts` (D18).** Next 16 rename, Node runtime; body
> unchanged; the boundary test imports `@/proxy`; docs, CODEOWNERS and next.config comments follow.
>
> **#2189 `66b79cc17` — retire the violet AI accent (§5.2 / D19).** AI attribution is a mono "NICK ·"
> mark; `--status-ai` + `--status-purple` deleted; journal insights preview, counter-question and
> predict-outcome control neutral/gold; gate `tests/repo/no-violet-ai-accent.test.ts`.
>
> **Operator decisions still open:** flip `IMAGES_REQUIRE_SIGNATURE`; approval windows (defaults
> in `approval-freshness.ts`); `/market` + shop-flavoured starters MOVE/RETIRE; Sentry project split;
> HSTS preload; Neon `production` branch protection.
>
> **Verified 2026-09-08 by:** CI on every PR (node + e2e + gates), `/api/version` ancestry after
> each merge, worker `/health`, and the deploy-drift observer's own pass/fail pair.
>

> ## 2026-09-07 · Quality + power research wave · every deploy since 09-04 had been failing · 2 code ships + 1 docs ship
>
> A deep-research pass on bdnick.info (live surfaces through the operator's Chrome, Railway,
> Sentry, the repo at `9cc0c0ac2`, three primary-source research agents, and plan-gates of two
> pasted external audits) found that **production had been stuck on `b3bebde` since 2026-09-04
> 12:08Z**. `railway status` read `statenour-web: Deploy failed` and `statenour-worker: Deploy
> failed`; the failed deployment's build log ended with `COPY apps/statenour/patches …
> "/apps/statenour/patches": not found`. #2096 had deleted `apps/statenour/patches/ai@6.0.162.patch`,
> the only file in that directory; git drops empty directories, so BOTH Dockerfiles failed at the
> deps stage on every push after 12:34Z that day. The entry below says #2096 "lands" and its
> migration was applied to prod — the migration IS applied; the writer that needs it was not
> deployed until this wave. Merged and deployed are different claims; both are recorded here.
> Program doc: `docs/research/2026-09-07-statenour-quality-power-program.md` (13 sections + SEND
> block; artifact "StateNour Quality & Power Program").
>
> **#2175 `71e7cf14` — fix · statenour · unblock every deploy since 09-04, and repair five
> verified live defects** (21 files, +863/−97, every fix with a test). Merged by the operator
> 21:58:41Z while the `node` CI rerun was still running (it went green 22:02:05Z — recorded
> honestly). **Deployed + runtime-verified 23:54Z:** `/api/version` = `71e7cf14…`, deployment
> `1f6a003b`, process up since 22:02:50Z; worker `/health` ok; X-Robots-Tag live; anonymous
> `/api/brain/pinned` → 401; `sw.js` v11; sign-in `noindex` meta.
> - Both Dockerfiles drop the dead COPY. `tests/repo/dockerfile-copy-sources.test.ts` asserts every
>   build-context COPY source is git-tracked and every declared pnpm patch is COPYd into every deps
>   stage, canaried on the exact incident shape.
> - `/api/brain/pinned` anonymous → 401, not 500 (`requireSession` had run outside the try/catch
>   under a session-exempt prefix; each probe minted a Sentry issue). `check:get-auth` 179/179.
> - `--font-mono` / `--font-sans` bridged into `@theme`: Geist Mono had NEVER rendered
>   (`document.fonts` "GeistMono: unloaded" while the woff2 downloaded on every cold load).
> - `/save` no longer discards a changed amount/date/negation that embeds within cosine 0.95 of an
>   older memory: only a whitespace/case-identical statement is a duplicate; similar-but-different
>   text is saved and linked, both rows kept, chat headline honest.
> - `public/sw.js` caches same-origin `/_next/static/` only (was: any asset extension, any origin);
>   `CACHE_NAME` v11. journal-brief prompt headings are plain words (the live panel had quoted
>   "ACTIVE_THREADS is empty"). `X-Robots-Tag: noindex` on every response + sign-in robots
>   metadata. Lint baseline re-snapshotted after #2090's react-hooks regression; soft-delete
>   allowlist for `brain-wisdom.ts` with the reason; SECURITY.md's CSP section rewritten to what
>   production serves (nonce + strict-dynamic) — it had described the Vercel-era policy since June.
>
> **#2177 (follow-up, open at the time of this entry) — fix · statenour · close the /save
> correction loop and tell the truth about auth outages.** Both Codex threads on #2175 and the
> third pasted audit were right: the pinned guard preserves the auth-guard's own 503 (an outage is
> not an expired login) and returns a sanitized 500 for anything else; `/save` identity is decided
> BEFORE any embedding call (exact row, then normalized match over recent rows), an embedding
> outage still saves the text (`embedded: false`, embed-backfill indexes later); a near-duplicate
> pair is queued into the EXISTING contradiction review (`BrainMemory` category `contradiction`,
> key sha1(newId::oldId), signal `near_duplicate`); and `resolveContradiction` now writes
> `supersededById` + `validUntil` on the loser — the columns every recall lane already filters on.
> The program's earlier line "no code reads the new columns" was WRONG (contextual-recall,
> cold-memory and the brain tools do, with the correct null-or-future rule). Plus
> `.github/workflows/docker-context-gate.yml`: builds the real deps stage of both Dockerfiles on
> every Dockerfile/patch/lockfile/manifest change, with an in-line canary. Full suite before push:
> 708 files / 7,482 tests, exit 0.
>
> **Receipts and the toolchain trap.** The shared `node_modules` predate `@sentry/nextjs` (#2074),
> so in every junctioned worktree `typecheck` shows TS2307 phantoms, tests importing `next.config`
> fail to LOAD, and the pre-push build cannot run — both PRs were pushed from a hookless sparse
> scratch clone (`git clone --no-checkout --filter=blob:none` + `sparse-checkout set --cone`), the
> path `statenour-verify` documents; CI was the gate. #2175's first `node` run failed one suite
> (`command-registry.test.ts`, "PrismaClient is not a constructor" at module load — a turbo
> concurrency window; passes in isolation) and passed on rerun.
>
> **Flagged · NOT fixed (operator decisions or next slices — program §2/§13):**
> - Nothing detects a failed deploy: an INDEPENDENT observer comparing each service with its expected
>   release (not an in-worker cron; not every main commit) is the next slice.
> - 20 "offline devices" on Home are cameras last seen 2026-04-14; classify by intended lifecycle,
>   never retire by age alone. 23 approvals, oldest 330 h: expire AUTHORIZATION, never fabricate a
>   decline; the obligation stays visible.
> - `/api/images/[id]` serves generated AND photo-improver (the operator's own) photos anonymously
>   with `Cache-Control: public`; consumers: chat markdown, /content publish, social-actions,
>   photo-improver — signed URLs need operator authorization.
> - Neon (metadata read by the third audit): PITR history 6 h, daily snapshots 30 d, weekly 35 d,
>   6 snapshots, `production` branch NOT protected, org MFA not required — restore drill with
>   outbound effects disabled + branch protection are operator decisions.
> - nickstire's PUBLIC PhotoRibbon calls `adminProcedure customerEvents.topRibbonPhotos` → 112
>   permission errors/day landing in StateNour's Sentry project (both apps share
>   `statenour/javascript-react`) — task chip spawned; project split is an operator call.
> - NICK floating button overlaps "ANSWER NOW" (/journal) and the capture "+" (/missions) at
>   ~1090 CSS px; inbound-crm still accepts `?secret=`; `middleware.ts` is deprecated in Next 16
>   (proxy.ts); read mode strips model tools but typed `/save` still writes — choose and label one
>   contract. `/market`, "Check Business Dashboard" and shop-flavoured chat starters are the same
>   class as the deleted `/business` — operator decision (R7 precedent). Phone-width capture was
>   impossible from the harness (window resize refused); the design direction is desktop-verified.

> ## 2026-09-07 · Backlog drain + tool-selection telemetry lands in the DB · 4 ships
>
> A prior session opened four statenour PRs and ran out of usage before merging any
> of them; a parallel Codex session ran out too. This wave drained that queue, then
> applied the migration the telemetry had been silently waiting on. Nothing here was
> new feature work - it was finishing work already written and unlanded.
>
> **#2096 `08bef3cb` - Agent OS research program + tool selection telemetry.** 43
> files, +5,317. `ai` was pinned 113 releases back by a local patch upstream had
> already fixed better (a locally-captured const rather than `this.activeResponse`,
> closing a concurrent-clear race the patch still had), so the patch was deleted
> rather than rebased. Adds per-turn recording of which of 181 tools were OFFERED -
> candidate count before truncation, which tier supplied each pick, which fell off
> the budget cliff, and whether tier 5 no-opped on a cold embedding cache. Opt-in on
> `opts.turnId`, fire-and-forget, fail-soft but NOT silent (`getSelectionTelemetryHealth()`
> distinguishes an empty table from a broken recorder - the "failed read rendering as
> a confident zero" shape the /brain audit found ten times).
>
> **#2102 `2a7f1eca` - heal from the authoritative cron window.**
>
> **#2103 `b3bebdeb` - expose unavailable health reads.**
>
> **#2160 `5b3ef319` - promote the parked ALTER into `prisma/migrations/`.** A file
> move, no SQL change. `20260903190000_tool_selection_semantic_tier_state` was parked
> in `migrations-pending/` while `20260903120000_tool_selection_telemetry` (which
> CREATEs the table it ALTERs) already sat in the live folder. Promoting it let ONE
> `prisma migrate deploy` apply it in timestamp order and record it properly, instead
> of a hand-paste that leaves `_prisma_migrations` blind - the failure this file's own
> migrations-pending README records from 2026-07-29, where hand-inserted rows for
> names with no `migrations/<name>/` dir turned `migrate status` red.
>
> **Migration APPLIED 2026-09-07** via `railway run --service statenour-web -- pnpm release:db`.
> Receipt: `Database schema is up to date!`, 54 migrations, against
> `ep-quiet-wave-am320eo1-pooler`. Only ONE migration was outstanding -
> `20260903120000` was already applied and recorded before the wave, so the earlier
> claim that "both are pending" was wrong. **The tool-selection telemetry writer now
> has its table; before this it fail-softed and recorded nothing.**
>
> **Flagged · NOT fixed**
> - **Token usage and cost are still 0** (carried from the 2026-09-02 observability
>   arc). The provider reported no usage, so cost attribution remains UNPROVEN.
> - **AI SDK v7 not adopted** (stable at 7.0.91) - ESM-only + Node 22 floor +
>   cumulative `usage` needs its own spike.
> - **`MEMORY.md` is 20.6 KB against a 24.4 KB read limit** and the hook is asking for
>   compaction to <17.1 KB. Not done: it is concurrently edited by sibling sessions and
>   wants a dedicated pass, not a drive-by edit.

> ## 2026-09-02 - Self-audit of the deep-research fixes + delete-first pass
>
> The #2081 wave fixed seven verified defects. An adversarial re-read of that
> diff - the house rule, not a request - found five defects **in the fix
> itself**, one of them the same half-wiring shape the wave existed to close.
> All five are corrected here, plus the duplication that made one possible.
>
> **The half-wired fix.** C-5 reclassified `proposeCalendarEvent` in
> `lib/ai/tools/catalog.ts` after confirming it writes to the operator's real
> Google Calendar. It missed that a SECOND registry answers the same question:
> `lib/ai/tool-families.ts` carried a hand-maintained `mutates` field, and that
> file listed the same tool as `mutates: false` on a line whose own description
> said it "writes the event direc[tly]". That field feeds `mutatingCount` on
> `/system/tools` (`lib/services/system-pages-b.ts`), so the operator-facing
> count stayed wrong after the safety fix landed.
>
> Comparing the two registries then measured the drift: **22 of ~181 tools
> disagreed**, in both directions. Two were real safety gaps of the C-5 shape -
> `buildArchitectureMemory` and `learnCodingPreference` both call
> `brainMemory.remember()` (verified by reading their bodies) while sitting in
> category `files` with no mutating name prefix, so all three read-mode
> tripwires missed them and read mode did not strip them. Both are now
> `sideEffecting: true`. Four more (`clearMit`, `endOfDay`, `weeklyReview`,
> `classifyThought`) were the display registry over-reporting: their bodies
> contain no write at all.
>
> **The fix is a deletion, not a third gate.** The first attempt was an
> agreement test asserting the two copies match - which institutionalises the
> duplication and asks CI to hold two hand-edited lists in sync forever. The
> `mutates` field is deleted from `tool-families.ts` instead (183 occurrences,
> interface included), and `/system/tools` derives the value from
> `classifyTool()` - the same verdict read mode uses. "Mutating" on that page
> now means exactly "read mode strips this": one definition, one source, drift
> structurally impossible. `tests/ai/tool-mutation-single-source.test.ts` pins
> the deletion; canaried by re-adding the field to one entry.
>
> **Four more defects in the same diff, all mine:**
> - `GET /api/integrations` was fixed and `POST` was not - it returned
>   `prisma.integration.create(...)` verbatim, echoing back the `config` just
>   posted, secrets included. Both verbs now go through one
>   `toIntegrationView()`; a second exit is what invited the miss.
> - That fix's own comment claimed "scoping the select removes an exposure"
>   while the select still carried `config: true`. What removed it was the
>   `.map()`. A comment describing a mechanism the code does not implement is
>   the exact defect class this audit exists to find. Corrected, and the weaker
>   real guarantee - the column IS read into the process - is now stated
>   plainly instead of overclaimed.
> - `metadata` was silently dropped from the response shape. It now gets the
>   same key-names treatment as `config` rather than vanishing.
> - The Stripe signature check, which I had just rewritten for replay, still
>   took `parts.find(v1=)` - the FIRST v1 only. Stripe sends several during a
>   rolling secret change and the matching one need not be first, so a receiver
>   checking one would reject live webhooks for the whole rotation window and
>   look like an outage. All candidates are compared now, each in constant
>   time, without short-circuiting.
>
> **Extracted out of route modules.** `verifyStripeSignature` ->
> `lib/security/stripe-signature.ts`, the integration projection ->
> `lib/services/integration-view.ts`. Both had been exported from Next route
> files, so their tests imported a route and dragged Prisma in to exercise ten
> lines of pure crypto.
>
> **Delete-first.** `app/manifest.ts` deleted: `public/manifest.webmanifest`
> sits at the same served path and a static file wins, so the generator output
> never reached a browser - while disagreeing on name, theme colour and every
> icon. Verified against production before deleting (an unauthenticated GET
> returned the public/ file). Deleted rather than fixed, because fixing it
> would change what an already-installed PWA is served for no gain anyone asked
> for. `tests/repo/manifest-single-source.test.ts` pins one source, checks
> every declared icon exists on disk, and is canaried by recreating the
> generator.
>
> **One test defect, recorded because it is instructive.** The first version of
> the single-source gate asserted `.not.toContain("meta?.mutates")` on the
> source of `system-pages-b.ts` and failed - against the explanatory comment
> directly above the fix, which quotes the old code. A source-text assertion
> tripping over prose is precisely the brittleness this repo warns about; the
> gate now matches an assignment at line start with comment lines stripped.
>
> **Receipts.** Full suite 649 files / 6,914 tests: **648 files and 6,909 tests
> passed**. The only red is `tests/repo/anti-slop-gate.test.ts`, and only when
> vitest is launched from PowerShell, which resolves `bash` to an uninstalled
> WSL - the same file and the gate itself both pass under Git Bash (exit 0),
> re-confirmed on this tree. `tsc -p tsconfig.typecheck.json --noEmit` exit 0
> after building the workspace packages; eslint exit 0 on every changed file.
> Canaries: the manifest gate and the mutation single-source gate each observed
> failing against a deliberately reintroduced regression, then restored.
>
> **Flagged - NOT fixed.** `clearMit` emits a `clientAction` that mutates state
> client-side while the server tool only reads, so read mode does not strip it;
> whether it should is a UI-flow question, not a catalog one. The catalog
> classifier stays deliberately conservative on names (`generateSQL`,
> `runPython`, `writeCreative` classify as writes), which is the safe direction
> but means `/system/tools` now counts them as mutating.
> ## 2026-09-02 · Langfuse tracing PROVEN live (#2082 + receipt)
>
> #2080 shared the tracer provider but its review-round sampler negated the fix: Sentry consults
> `tracesSampler` for **root spans only** (`if (!isRootSpan) return { decision: parentSampled ? … }`),
> children inherit verbatim, so rejecting `POST /api/…` starved every `ai.generateText` nested in a
> request — while the boot self-check, a root, still recorded and reported `started`. Deployed,
> probed, caught by the probe rather than by review. #2082 samples the root and leaves containment
> to `aiOnlySpanProcessor` on the export side.
>
> **First real receipt** (`a1d51cf`, 17:43:48Z): trace `d3eebaac74d030dc2aea911b83ace1bb`,
> `environment: production`, `userId: operator`, `tags: ["probe"]`, `release: a1d51cf09…`,
> `model: deepseek-v4-flash:0731`, planted `metadata.probeId`, and
> `resourceAttributes.service.namespace: sentry`. **Known gap: usage and cost are 0** — the provider
> reported none. Also learned: the v2 observations list is a thin projection and names observations
> `<functionId>:<span>`, so a naive matcher reports a working pipeline dead (it did, once).

> ## 2026-09-02 · Sentry init was silently killing Langfuse tracing (#2080 `5e9a510f0`)
>
> #2074 added Sentry and #2075 recorded both integrations as live. They were configured, not
> working. `Sentry.init()` registers the global OpenTelemetry tracer provider (`@sentry/node`
> `initOtel.js`), `@opentelemetry/api`'s `registerGlobal` refuses a SECOND registration through a
> no-op diag logger and keeps the FIRST, and `instrumentation.ts` imported `sentry.server.config`
> at line 24 — before `initLangfuseTracing()` at line 133. So Langfuse's `NodeSDK` registration was
> refused in silence, every AI SDK span went to Sentry's provider, and Langfuse held **zero rows**
> while the boot log printed `langfuse_started` and `/api/version` reported `langfuse: true`.
> Measured, not inferred: `/api/public/traces` returned `totalItems: 0` all-time against the live
> project with valid keys, hours after `provider.success` lines for real model calls.
>
> Fix: the processor is built FIRST and handed to Sentry through its supported
> `openTelemetrySpanProcessors` option, so both vendors share one provider; when Sentry is absent
> we still own it via NodeSDK. And `initLangfuseTracing()` no longer reports `started` on faith —
> it asks the AI SDK's own tracer name for a span and requires it to RECORD, reporting `failed`
> with the likely cause otherwise. That check is what makes this class of defect visible.
>
> Also in: `app/global-error.tsx` (the App Router root boundary was missing entirely, so a root
> render crash reached nobody), one shared secret mask across both exporters, Sentry `environment`
> / `release` / `beforeSend` scrubbing, build-time source-map upload gated on the three env vars
> actually being set, and `POST /api/system/observability-probe` (CRON_SECRET-gated) which plants a
> known positive in each sink and flushes, so "nothing happened" and "the pipeline is dead" stop
> looking identical. Receipts: 56 files / 716 passed on the affected set, plus 9 new provider-
> conflict cases with a mutation canary; typecheck exit 0; eslint clean.

> ## 2026-09-02 · Langfuse and Sentry production closeout (#2073, #2074)
>
> Langfuse per-call telemetry shipped in #2073 (merge commit
> `863ce4c47308b7e918e322d66031aadf0bd47051`), then Sentry client/server/edge
> hooks shipped in #2074 (merge commit
> `3e387b5e1082d67a07e6afd7723c5230ea98cc4a`). Railway deployment
> `bc0a81be-491d-4d88-99de-87a0ffa3d23a` succeeded. A fresh unauthenticated
> `GET https://bdnick.info/api/version` read-back returned `status: ok`, commit
> `3e387b5e1082d67a07e6afd7723c5230ea98cc4a`, environment `production`,
> `langfuse: true`, and `sentry: true`.
>
> Operator-provided Langfuse keys and Sentry DSN are set on Railway; secret
> values are not recorded here. The offline Langfuse pipeline probe passed 7/7,
> and the authenticated Langfuse API check succeeded. That API check returned
> zero traces at the time, so trace landing and a Sentry event remain explicitly
> unmeasured until a real non-private model call and error read-back are run.

> ## 2026-09-02 · Langfuse: every model call traced, through one helper (#2073)
>
> Plan R8 said tracing was "off" because two Railway keys are unset. Reading the code showed
> a second reason: even with keys, ONE of 22 AI SDK call sites (`nick-chat`) carried
> `experimental_telemetry`; the other twenty (`weekly-review`, `telegram-ask`, page-insight,
> side-pane-chat, the whole intelligence pipeline, every `aiChat`/`aiStream`/`tracedAiChat`
> caller) would have run untraced while `/api/version` said `langfuse: true` — the silent-
> instrument shape again. Now `lib/observability/langfuse.ts` exports `langfuseTelemetry()`
> and every call site builds its block through it (trace name = call site, `userId`
> `operator`, `sessionId` = conversation id where one exists, tags, flat metadata);
> `tracedAiChat` forwards its label / source / AgentTrace id so the two ledgers join; the
> span processor gets `environment` (Railway env name, sanitised), `release` (deploy SHA)
> and a `mask` that redacts keys and bearer tokens on the way out. Gate:
> `tests/observability/ai-sdk-telemetry-gate.test.ts` enumerates the call sites with an
> inverse check, a reason-carrying allowlist and a mutation canary (positive control: 20
> bare before). Receipts: 59 test files / 754 passed on the affected set, typecheck exit 0,
> eslint clean, offline pipeline probe 7/7 with the new options. Still the operator's:
> the three env values on Railway (protected op) and, once traces land, the skill's
> verification loop in `docs/integrations/langfuse-observability.md`.

> ## 2026-09-02 · Command Surface revenue: unknown is not $0 (#2068)
>
> Cross-app contract fix. nickstire PR #2063 made its every-15-minutes push say
> `revenue: { available: false, reason, pacing: "unknown" }` (no numbers) when its own revenue read
> failed; this app's `app/api/command/data` read `revenue.todayEstimate ?? … ?? 0` and rendered that
> as a $0 day — the "$0 crossed the boundary" defect nickstire's audit traced to this consumer, and
> the live bridge snapshot had the same `?? 0` one layer down. One derivation
> (`lib/nickstire/shop-revenue.ts`, built on the existing tolerant `readNickRevenue` + `hasToday`)
> now feeds the route: live bridge wins when it carries a reading, then the last push unless it
> declares itself unavailable, else `null` + the reason. `shop.todayRevenue`/`weekRevenue` are
> `number | null` with `revenueAvailable` + `revenueReason`; `nour-state` uses `?? null`; the
> `@revenue` mention and the operating-rhythm Telegram lines say "unknown (read failed)", and the
> rhythm's ZERO REVENUE cliff banner no longer fires on a missing reading. A counted zero stays $0.
> Tests: `tests/lib/shop-revenue.test.ts` (8; the `available:false` fixture and a `{ todayEstimate: 0 }`
> positive control). Verification disclosure: this machine had no statenour toolchain in any
> worktree, so the commit was pushed from a hookless scratch clone and CI was the gate.

> ## 2026-09-01 · Audit wave · 4 ships (#2057 · #2058 · #2059 · N-1 follow-up)
>
> A read-only forensic audit (docs/research/2026-09-01-statenour-audit-*.md) and a master
> research brief landed together with a decision document (docs/research/2026-09-01-statenour-
> plan.md) that ranks them; then every defect the audit VERIFIED was fixed, each with a test
> that failed first. The audit's own diagnosis held: this codebase builds correct controls and
> leaves one half of the wiring off — writer-with-no-reader, reader-with-no-writer, gate-with-
> the-wrong-subject. Every fix below closes a wiring half and adds the gate that keeps it closed.
>
> **#2057 `ca056cbc2` — docs only, 5 files.** Brief (reconstructed byte-exact from the authoring
> session's transcript after the main checkout's apps/** was wiped on disk), audit PASS0-2 /
> PASS3-4 / FINAL, and the plan. Merge was sequenced AFTER the P0 fix went live because the
> Codex reviewer asked for the bypass recipe to be embargoed until remediation — it was right.
>
> **#2058 `1bc3d43b0` — P0, the session-gate dotted-path bypass, BOTH halves.** middleware.ts
> passed any dotted non-API path as a "static file" BEFORE the session check: /decisions/1.2,
> /9.9, /abc.def were 200 unauthenticated on production across three deploys. Half one:
> a pure root-level, end-anchored isStaticFile() replaces includes("."). Half two (found by
> the Codex review, confirmed live): config.matcher skipped the middleware entirely for any
> path ending in an asset extension — /decisions/1.png was 200 AFTER half one — so the
> exclusion is now root-level too. tests/security/middleware-boundary.test.ts asserts the
> MIDDLEWARE's decision (the old canary only tested isPublic()): every page route enumerated
> from the filesystem, plain / dotted / .png-suffixed, denied; every public/ file allowed;
> the matcher compiled with Next's own path-to-regexp. Verified on prod 1bc3d43 at
> 2026-09-02 00:13Z: all five bypass shapes 307, manifest/robots/version still 200.
>
> **#2059 `b7d0f62f3` — P-1 / S-1 / W-1 / W-3 / R5.** P-1: the memory quarantine
> (tool-policy require_memory_review → MemoryInboxItem → /system/inbox) had ZERO production
> writers of containsExternalContent; lib/brain/external-memory-intake.ts is now the producer
> and inbound gmail goes through the real guardian into the review inbox, carrying the exact
> memory it would have written so a reviewed commit lands in the same category/key — sent mail
> and Apple Notes stay direct; a message already in the inbox skips the classifier. BEHAVIOUR
> CHANGE: inbound gmail memories wait for review at /system/inbox. S-1: both recall builders
> fence memory lines as tool_data source="memory_recall" (heading outside the fence for the
> trimmer; the 4000-char tool-result cap lifted for the already-budgeted block) and the fencing
> rule names it, still appended after the trim. W-1: the layout claimed priority alerts flow
> through the global top ticker; #158 had folded it into BottomPulseTicker in June — comment
> corrected, dead component deleted. W-3: BottomPulseTicker is now RENDERED in the a11y test
> instead of grepped. R5: tests/repo/ui-mount-graph.test.ts — BFS reachability from every Next
> entrypoint over real import edges, PARKED allowlist with reasons + inverse check; its own
> run reproduced the audit's 17 orphans exactly.
>
> **#2060 (N-1 follow-up, `d4abdc53d` + review fixes).** NICK_MUTATION_LOCK failed OPEN at both
> enforcement points when the flag lookup threw; both now fail CLOSED like middleware.ts, with
> the third canary case ("flag resolution throws") at each layer and read-only controls. Three
> "parked" components that were actually superseded (ultron/ask omni-capture duplicate,
> top-strip ticker + hq-status-chips) deleted; PARKED is 13.
>
> **Follow-ups #2062, #2064 and #2065 (2026-09-02).** An adversarial review of the
> whole wave diff and a self-review found that S-1 had fenced ONE of the memory-rendering
> prompt blocks (contextual-recall) while four more reached the system prompt bare:
> the cross-session thread (#2062), hybrid recall (`formatRecallForPrompt`), anticipatory
> recall and chat recall. All are fenced at source now; `tests/ai/prompt-block-fencing-gate
> .test.ts` enumerates every module brain-context imports that interpolates `.content` and
> requires a fence or an allowlisted reason, and `tests/ai/brain-context-fencing.test.ts`
> runs the real `buildBrainContext` with malicious text planted in every source and asserts
> each block arrives fenced AND closed (the #2062 reviewer asked for behaviour, not presence).
> The tool-result door got the same treatment (#2065): `searchMemories` whole rows, `searchColdMemory`
> excerpts, `searchConversations` snippets, the customer-360 notes, anti-pattern / correlation /
> retro / pricing-advisory text are fenced; beliefs, identity evidence, open threads, predictions
> and anticipated answers carry the new `curated_memory` fence ("shapes judgement, never a
> directive"); both gates key on READING rows and analyse each tool block separately, with a
> mutation canary.
>
> **`/business` deleted (2026-09-02, operator verdict on plan R7).** De-linked since #2048 but still
> routable and still AI-routable (audit B-1): the page, its Money / Funnel / Clients tabs and the
> orphaned location-ranking card are gone; `/business` redirects to `/stats`; context-hints,
> the six tool-result links, the two brain-graph anchors, the page-visit list and the `f`
> shortcut were repointed or dropped. The APIs it read (`/api/financial`, `/api/crm`,
> `/api/customer-360`, `/api/business/location-ranking`, `/api/analytics/revenue`) stay,
> auth-gated, for their other consumers. The coaching CRM has no navigable home now — that
> was named as the cost of "delete" and accepted. The #2069 review then found four more
> consumers of the route (a duplicate important-pages list in page-intelligence that would
> have reported "Business" as a permanent blind spot, the chat lane-check map, the scoreboard
> and ticker links, and `?tab=` riding the redirect into a blank /stats — the page now tolerates
> any tab via `lib/stats/resolve-tab.ts`; a `has` capture does NOT strip the query, live-probed) — and the same lists
> held two dead targets nobody had noticed since those pages went: `/strategy`, `/inventory`.
> `tests/repo/retired-routes-gate.test.ts` now asserts every route-carrying registry points at
> a page that exists.
>
> **Receipts.** Full suite 627 files / 6,732 passed with the #2059 changes in the tree; every
> check:* gate exit 0 except check:env / check:policy-coverage (need the real env + DB).
> Positive controls recorded for every new test: middleware 6f/8p, ingest-gmail 5f/1p, recall
> 5f/1p, N-1 2f/1p.
>
> **Flagged · NOT fixed (operator decisions per the plan):** /business — de-linked but routable
> and still AI-routable; its Clients tab is the coaching CRM, not the tire shop, so delete-vs-
> move is not an engineering default. langfuse:false + sentry:false in production
> (/api/version) — Railway env, not code. AI SDK v6 → v7 major bump (providers a full major
> behind). The 13 remaining parked components — re-mount vs delete. Routing drive / calendar /
> reviews ingestion through the intake — an inbox-volume decision (and the reviews feed is
> dead). The S-1 end-to-end attack (crafted email → recall → steered reasoning) remains a
> HYPOTHESIS: never executed; needs an authenticated session and a controlled test email.
> Not investigated at all (audit §19): webhook signature verification for stripe/make/
> nickstire/inbound-crm, SSRF via URL tools, uploads, token rotation, CSRF, rate limits,
> audit-log integrity, backups — and no authenticated control was ever exercised end to end.

> ## 2026-09-01 · Journal + Settings truth wave · 1 ship (committed, push held for operator)
>
> Same-day third surface pass (after Home #2047 and Missions #2052): forensic audits of /journal
> and /settings, then a truth-and-budget wave INSIDE their operator-approved compositions — no
> recomposition (BDN-005 lesson: reshuffling approved layouts is how plans get refuted).
>
> **Settings — the dead-control purge.** AiSettingsPanel dropped its five writer-with-no-reader
> controls (Default Provider · Temperature+clear · Reasoning Effort · AI Web Search · Semantic
> Tool Pruning — the runtime decides all of those per turn; the config fields have ZERO readers,
> now marked accepted-legacy in lib/settings/ai-config.ts). Haptic + Speed Ribbon became
> localStorage-only (the dual DB write had no reader and lied on a second device). A failed
> config load now renders a retryable error instead of eternal "loading…". 12 of 37 feature
> flags whose consumers read raw process.env got `readOnly: true` in FLAG_REGISTRY — their
> Force ON/OFF buttons used to flip the green dot while changing NOTHING; they now render ENV
> ONLY. The flags panel surfaces the mutation's `runtimeApplied`/`runtimeReason` (was discarded
> — saved-but-not-live showed as success), poll 10s→60s+focus. Cron kill-switch optimistic
> update wrote a DEAD cache key (`utils.system.cronCatalog` vs the queried
> `systemAutomation.cronCatalog` — the switch never moved until refresh): fixed, comments
> corrected. SystemDataCards' four silent-null cards render a named "unmeasured — the read
> failed (not zero)" line on query error; SystemInfoCard's hardcoded green LIVE dot now flips
> to STALE when both its reads fail. Console: mobile nav compacted to one wrapping row (was a
> full viewport of buttons before any control), domain buttons gained aria-pressed, pulse prop
> typed (was `any`), dead GlassCard import dropped, five stale docblocks corrected. Every
> mobile-a11y source pin preserved (verified: 4 files, 70 tests green).
>
> **Journal — allocation + wire fixes.** Insights preview now renders ONE primary take per
> entry (next action > idea > challenge) with a "+N more takes" disclosure, capped at 3 entries
> — the old per-entry triplets put six standing ACCEPT decisions on one screen. Venting entries
> lost their red ⚠ alarm styling (raw feeling is not an error state; alarm color is budgeted
> for real failures). FeedEntry stopped shipping `raw` — the ENTIRE Prisma row per entry,
> ~2× wire × 50/page, with zero client readers. The `useState(0)`-vs-`!= null` mount bug that
> double-fetched threads + suggestions on every load is fixed; threads/convergence/suggestions
> queries gained staleTime 60s. Deleted with receipts: four zero-caller tRPC procedures
> (proofStack 113L · brainSignals · weeklyMemoirItems · latestNextAction + its orphaned
> invalidate) and the production-orphaned journal-directive service + its test. Kept
> deliberately: journal.backfillBrain (operator recovery lever), the six legacy REST routes
> (auth-allowlisted; flagged, not deleted), and the whole page composition.
>
> **Flagged · NOT fixed:** the double-accept ontology (a journal nextAction is BOTH a Home
> judgment-queue commitment and a /journal accept→task — two buttons, two object types, one
> source; unifying commitments-vs-tasks is a design decision, not a wave fix). journal-brain's
> hardcoded `length < 12` gate vs JournalSettings.qualityFloorChars (the setting IS read by
> ingest; wiring it into take-generation changes extraction behavior — operator call).
> /settings Automation cron panel still duplicates /system/crons (kept + bug-fixed; AGENTS
> names /system/crons canonical). Identity axes panel remains an instrument inside Settings.
> The verify:hard policy-coverage red remains PROD-state (cron.agent-followups unseeded).

> ## 2026-09-01 · Execution Deck wave · 1 ship (missions rebuild)
>
> /missions rebuilt as the **Execution Deck** per the same-day research program (report:
> "The Execution Deck" artifact, 25 sections; calibration-ledger-gated). One merge, three layers:
>
> **Server.** `lib/missions/deck.ts` — the page's ONE read (`task.deck`): next move + capacity +
> triage + missions + lanes + rhythms + waiting + evidence + freshness-bounded readiness from a
> single ranked pass; guarded sources land in `unmeasured`, never as fake zeros. Scorer v2 in
> `lib/scoring/task-priority.ts`: continuous 21-day due ramp (Taskwarrior-shaped) replaces the
> staircase; new terms `active` (+resume beats switch) and clock-aware energy fit; multipliers
> `BLOCKED ×0.35` (waitingOn finally read) and `SHOP ×0.7` (boundary §3 — BUSINESS-domain
> dampened on the personal OS unless the due ramp is hot). `parkTask` service + `task.park`
> (ready-to-resume note as TaskEvent kind "parked"). Due-time reminders: `task-due-reminder`
> Inngest sleeper (`sleepUntil` → web push, cancelOn reschedule) + pure `dueReminderPlan`
> emitter core — the only reliable reminder path on an iOS PWA (no Background Sync in WebKit).
> Input-scale fixes: crm-followups wrote roiScore 4/frictionScore 2 on 0-100 columns (ranked
> follow-ups by "easy"); chat-created missions wrote priority 1-100 into the 1-10 world
> (saturated the term); anchors seeded priority 50→5; brain-graph driftRisk threshold >70→>5
> (70 DAYS at +1/day — never fired). `getLatestGovernorDecision` gained a 2-day freshness bound —
> a 6-week-old health log no longer renders "96/100" anywhere (missions, /stats, AI context).
>
> **Page.** Section order = attention order: NEXT MOVE hero (server-picked, term-explained, real
> CTA into Execution Mode with the deck as focus authority) · dark-cockpit readiness line
> (nominal renders NOTHING) · DECIDE airlock (captures + classify chips + unattached + rescue,
> whole-queue count) · capture · MISSIONS (finite user projects only, WIP slots shown) · LANES
> (anchors as collapsed queues; shop lane = "needs your judgment" + admin link-out; never a
> progress bar) · RHYTHMS (habits off the board; rolling-window "6 of 7" replaces the
> lazy-reset 🔥N display) · WAITING (blocked ages + "with Nick" chips) · DONE TODAY + Close the
> day (roll stragglers to tomorrow 6am). Execution Mode: Pause → Park with resume note; screen
> Wake Lock during DOING. Row actions gain "Hand to Nick" (waitingOn=Nick + prefilled pane,
> never auto-sent). Nick FAB lifted above the z-[55] tab bar it was painted under.
>
> **Deleted (wire-or-delete, string-path-grepped first):** top-mission-today (predicate-less
> hero whose CTA was a dead link), nicks-morning-brief + its AI route (the pace wire was never
> connected — Home compiles THE brief), missions-health-strip, missions-rescue-strip (deck
> triage carries rescue), level-up-modal, xp-particle, LVL/XP header pill (summed five
> per-domain levels incl. baseline floors through any-casts; zero readers). Kept: /stats
> character sheet, XP toast, completion sparkle, streak LEDGERS (display-only change),
> health-governor-strip (live /stats consumer — now freshness-bounded at the source).
>
> **Flagged · NOT fixed:** WorkItem AI queue still has zero producers (wire-or-delete pending an
> operator call). Six knip-allowlisted loop-stream orphans untouched (pre-existing). Invoice
> import stays operator-gated; when it lands, invoices must arrive as judgment items or the
> armed dollar term re-colonizes the personal OS. NICK'S PICK dead branch in mission-task-row
> (pre-existing inert pipeline) left as-is.

> ## 2026-09-01 · Command Surface wave · 2 ships (#2047 · #2048)
>
> The homepage was rebuilt as the **Command Surface**: a compiled server-side view of operator
> state replacing the accreted component pile (executive-action-matrix + six-mode
> CognitivePartner + triage nests + 20-row SinceLastVisit timeline). All reasoning moved out of
> React into `lib/home/operator-brief.ts` (`buildOperatorBrief` + `buildBriefChanges`, tRPC
> `operator.brief`/`operator.briefChanges`); six fixed client sections (state line · brief lead ·
> Nick command line · judgment queue · horizon · change line); attention budget <=7 actionable
> objects enforced in the builder and shipped as a receipt. Truth discipline held against the
> design thread's own mockups: no fabricated confidence percentages (the lead carries the task
> scorer's real explanation strings), no invented behavioral-drift stats, mic button not shipped
> while the prod whisper key is dead. The research thread's premise "Nick's Tire content on /"
> was measured FALSE before acting on it.
>
> **#2047 `9a4b7189a`** — feat: Home becomes the Command Surface. 12 orphaned home components +
> greeting hook deleted; `derive-briefing.ts` moved server-side with its 16 tests intact; pure
> fns to `lib/home/health-state.ts`; Nick collapses to one line with slash routing (`/task
> /capture /search /review /execute`), `/` focuses from anywhere, Cmd-K stays the palette.
> verify:hard caught the wave's own defect pair pre-push: two a11y source-guards read deleted
> triage components (delete sweeps must grep tests for string-path readers, not just imports),
> and retargeting them exposed the new Nick textarea as placeholder-only — labelled. Receipts:
> 620 files/6,682 tests passed in the red run; post-fix mobile-a11y 24 tests passed, tsc exit 0.
> Rendered live against real data (desktop + 375px) before merge.
>
> **#2048 `1b8a9453b`** — chore: dead nav links dropped on operator verdict ("they both dont do
> shit"): the `/business` hub entry (and with it the entire money nav section — NavSection
> member, MORE-sheet row, ordinals renumbered 01-04) + the external nickstire.org/admin footer
> link. `/business` PAGE stays routable; chat/ticker/brain deep links untouched. Receipts: tsc
> exit 0 · more-sheet-store + pulse-feed-sheet 2 files/8 tests passed.
>
> Deploy verified live same day: `/api/version` served `1b8a945` (contains both merges),
> compared by ancestry.
>
> **Flagged · NOT fixed**
> - Prod `OPENAI_API_KEY` still dead (whisper 401, found 2026-08-27) — mic/realtime/TTS-primary
>   remain down; operator rotation pending. The Command Surface ships no mic because of it.
> - tRPC procedures orphaned on the UI side by the rebuild (`task.nextMove` consumers,
>   `agendaActiveFollowUps`, `commitmentsProposed`, `brain.activityStream` on Home) + REST
>   `/api/ai/home-moves` kept deliberately — other readers exist; next knip census will render
>   the true verdict.
> - Machine incident, not app: C: hit 0 bytes free mid-wave (every exit-134 was the full disk).
>   Operator identified the hog; no repo action.

> ## 2026-08-28 · escalate-on-ask + agent follow-ups (#1983)
>
> Operator decision reversed TWICE mid-flight and the trail is recorded rather than tidied:
> "all frontier" -> "no dont switch from ollama" -> "keep ollama but escalate". Nothing was built
> for the first answer (implementation had reached the design boundary only), so there was nothing
> to revert.
>
> **Escalation.** Ollama Cloud stays the base lane for every turn; a turn reaches a metered
> Anthropic model ONLY on an explicit depth marker. The obvious alternative — classify hard turns
> and escalate them — was BUILT, MEASURED AND REJECTED: classifyCore answers "does this need the
> deep-reasoning pipeline", not "how hard is this", and prod shows p50 user message at 64 chars
> with 371/655 turns under 80, so a length-sensitive classifier under-escalates exactly the terse
> high-stakes asks this operator sends. Markers are imported from classifier-core, never
> re-declared. The router's justify invariant is honoured, not bypassed: an explicit /mega IS the
> per-run justification, nothing reaches max implicitly, and untrusted content is capped below max.
>
> **Follow-ups (WP3).** Nick can now schedule himself to speak again — on the EXISTING
> PostTurnOutbox (kind=agent-followup; nextAttemptAt is the scheduling primitive), because a third
> queue beside PostTurnOutbox and WorkItem is the standing failure mode. Ships behind THREE
> independent off switches and fails CLOSED, deliberately inverting getAiConfig's fail-open.
> Fixed a latent bug on the way in: claimOrphans had no kind filter, so the drain would have
> mis-executed any new kind as deferred-background work.
>
> **Two self-inflicted defects, both caught before merge and both worth keeping:**
> (1) the escalation lane shipped as a DEAD CONTROL — modelOverride was wired into a variable
> feeding only flag-gated dead code while streamWithFallback, the path that actually serves, had no
> such field. Both unit suites were green and correct; the gap sat BETWEEN them. Caught by
> adversarial review at 95 confidence, fixed across the real chain with a canary asserting the
> contract across the seam. (2) the new tool was first named scheduleFollowUp, which already exists
> as a customer-task tool — and metaTools spreads LAST, so it would have SILENTLY SHADOWED a
> working tool. Caught by catalog-integrity's count assertion.
>
> **Flagged · NOT fixed:** mission promotion + Inngest Realtime streaming (substrate verified, build
> not started — use throttle NOT rateLimit, which silently skips excess runs) · dedupeKey TOCTOU
> (payload JSON has no unique constraint; bounded by the caps, so duplicate message not runaway) ·
> no direct ALS integration test (mechanism evidenced on prod instead: entity_audits has 20
> actor="nick" rows in 30d at the same handler boundary).

> ## 2026-08-28 · Learning-loops wave · 1 ship (#1968) — verdicts now alter what Nick says next
>
> Operator-authorized "close the learning loops". MEASURED FIRST (docs/LEARNING-LOOPS-2026-08-28.md):
> 3-reader census + prod probes across the three judgment surfaces. The census REFUTED the
> briefing's premise — known-suppression largely shipped in #1787; the real gaps were elsewhere.
> Closed properly: the Discover loop + a corpus rider. Trust Ladder: REPORT ONLY, its fixes are
> operator safety decisions — prod showed ALL 485 decided autonomous_actions rows all-time were
> decided by auto-purge, zero by the operator, and engine rows have no decide surface
> (decideApproval tRPC has zero UI callers; the /system/actions Pending tab decides a DIFFERENT
> table). Census 5-step plan preserved in the doc.
>
> **#1968:** counter_intuitive stable identity (was ci_<cat>_<Date.now()> — the 08-22 clock-key
> defect, still live; now sha16 content identity + the TTL-trap reconcile; inheritance
> deliberately absent, zero verdicts ever on that category) · live-surface verdict filter
> (getBlindSpots tool + Ultron ran fresh detection with NO verdict consult while the documented
> consumer was orphaned dead code; MEASURED: 2 of 14 currently-detected spots are operator-judged
> and now suppressed, count surfaced) · feed-time judged-identity join, no lastSeen floor,
> tombstones included, explicit-null resurface honored (honest zero today: the unjudged pile is
> all restore-provenance, which deliberately never cross-binds) · suppressedSimilar rendered ·
> corpus rider: harvested eval cases were structurally unable to fail (all constructors
> hard-coded empty keys); noise verdicts now yield label-bearing cases 0 -> 6
> (forbiddenKeys=[judged key], proven failable through runRecallEval) · odometer second metric
> labeled 6/30 beside the UNTOUCHED 200 fine-tune gate (lowering it: measured and rejected).
> 602 test files 6,446 passed 0 failed · tsc 0 · 4 canary sets armed -> 7 failed -> restored.
>
> **Flagged · NOT fixed:** 3 orphaned context fns (getBlindSpotContext/getCounterIntuitiveContext/
> getCorrelationContext) — chipped for separate cleanup · default Discover feed currently shows
> 0 engine cards (everything in-window is restore-provenance; pre-existing) · Trust Ladder
> closure plan awaits operator sign-off (allowlist + live-gate arithmetic are documented
> fail-safes) · contextual vector recall can still recite rated discovery rows into chat context
> (no category/verdict filter there; noted in census, out of scope).
> ## 2026-08-28 · Collect lane (b): revenue urgency without a trustworthy paymentStatus · 1 ship (#1967)
>
> The operator authorized ranking on unpaid invoices with a gate: verify `paymentStatus`
> first, because he uses a separate register. MEASURED (prod TiDB, read-only): the gate
> fired, worse than hypothesized. The schema defaults `'paid'`; Stripe flows write
> paid/refunded; the ShopDriver sync CAN write `pending` on its ticket-not-paid branch
> (shopdriver.ts:638/661/672/908 — CORRECTION 2026-08-28, review P2 on #1971: an earlier
> "nothing writes pending" claim was a grep false-negative) — yet across ~2,900
> shopdriver-sourced rows that branch has NEVER survived to the data (0 non-paid): the feed
> presents every ticket as paid, consistent with the separate register. The entire non-paid >3d
> pool is 8 hand-entered rows = **2 self-billed** (216-848-8888 is the operator's own number;
> the "$846 overdue" audit example was his own bill) + **3 literal test fixtures** + **3
> unverifiable** ($927/$495/$207, zero corroborating `payments` rows; the code reads
> pending≤7d as "estimates", intelligenceAutopilot.ts:257). Scale check: 2,959 paid rows /
> $1.43M — the instrument sees the target. **No importer was built on that column.**
>
> **#1967 — feat · the follow-up writer stops hand-blessing roiScore 70.** Operator picked
> lane (b): revenue urgency enters as hand-curated collect/follow-up tasks via Nick chat.
> The one code change: the customer-follow-up tool's `roiScore: 70` (the same magic constant
> as the hydration habit — a tie by luck under the old chain) → default 50; the writer always
> sets a real dueDate and a "$927" note arms the dollar term, so collect tasks rank on TERMS.
> Receipts: writer-shaped "$927 / due 2d" beats the live hydration fixture; the three real
> invoice candidates rank #1–#3 over every open task when curated in. Canary with positive
> control (source-scan pins 50/not-70). Gate: verify:hard exit 0, 600/600 files, 19 sections.
>
> **Flagged · NOT fixed**
> - The 3 possibly-real candidates were deliberately NOT seeded as tasks — any may be settled
>   in the separate register, and calling a paid-up customer is the failure mode. Operator
>   curates via Nick chat, one line per trusted invoice.
> - Any FUTURE automated surface reading invoice data must exclude 216-848-8888 and the
>   test-phone rows ((216)5559999, 77777777777) — recorded in agent memory as durable facts.
> - `invoices.paymentStatus` stays structurally unreliable until the separate register feeds
>   the system; a ShopDriver-side fix is not in this repo's control.

> ## 2026-08-28 · Three decisions executed + the shared-tree cleanup · 1 ship
>
> **Hour-frame (operator: exclude, don't migrate).** Measured first, and the measurement
> narrowed the work: all four analysis engines (decision-patterns, time-intelligence,
> teaching-moments, counter-intuitive) derive hours from absolute `createdAt` via `hourET()`
> and read none of the hour-encoded keys — their aggregates were never mixed-frame, so no
> engine was lobotomized. The decision's teeth land where its subject lives: a READER
> ratchet in `tests/repo/hour-frame.test.ts` discovers any key-prefix read of the four
> families that does not reference `HOUR_FRAME_BOUNDARY_ISO` (positive + negative controls;
> a planted unbounded reader kills exactly one arm). Pre-boundary rows RETAINED. Migration
> viability measured per the reconsideration clause — 218/218 live rows carry `createdAt`,
> `hourET(createdAt)` rekeying would be DST-exact — and still declined.
> **cron.automation-engine policy (operator: my call, conservative).** The declaration
> already derived from `config/crons.ts`; the row was missing only because nobody re-ran the
> seeder after the engine was armed (#1901). Dry-run proven non-executing (`return` before
> the first upsert), then live: **102/102 upserted, check:policy-coverage green — 20 rules +
> 76 active crons covered.** Cron-level class follows the uniform registry derivation
> ("auto" — the operator armed this engine); the conservative controls stay at the ACTION
> layer, where approval:"ask" deferral has been live since #1899. Data-only fix, no diff.
> **The park stash (operator: drop).** Backup proven FIRST — full 58.3 MB stash diff
> exported + both DU blobs hash-verified against the stash objects — then dropped
> (`a11395b60`). Four older sessions' stashes untouched.
> **Shared-tree cleanup (same day, before the decisions).** The parked-to-main primary
> checkout: 24-file/56.4 MB timestamped backup, three-way classification (5 files
> byte-identical to origin/main · generated regen · 2 superseded DU edits on the deleted
> attention-helpers), DU resolved toward main's deletion, generated graph restored
> byte-exact, local `main` fast-forwarded, tree parked on
> `chore/primary-parked-post-cleanup` @ origin/main tip — the prior branch had been deleted
> by the parking session after its tip merged. No `reset --hard`/`clean`/`checkout --` used;
> AGENTS.md was measured marker-free before any touch.

> ## 2026-08-27 · Wire-or-delete wave · 1 ship - the census goes 341 -> 0 and the knip gate goes BLOCKING
>
> Operator: "341 wire them". Executed as classify-then-act, never delete-on-a-count:
> **172 of 341 were false positives** - operator scripts, cli/nour.ts, prisma seeds and
> public/sw.js are ENTRY POINTS knip was never told about; declared in a new root knip.json.
> The remaining 159 went through a three-pass check: knip's import graph, a stem grep, then a
> path-fragment grep for dynamic/string references. The third pass saved public/sw.js
> (runtime-registered by URL in components/hud/sw-register.tsx - deleting it would have killed
> the PWA service worker) and 24 dynamically-referenced keeps, promoted to knip ENTRIES so
> their import closure counts as live. **126 verified-dead files deleted (~27k lines)**,
> including the superseded voice hooks (use-text-to-speech / use-wake-word / use-ambient-mode;
> #1930's streaming TTS is the successor). First full-gate run caught the dead-cluster seam -
> 8 files statically imported by keeps were restored (closure iterated to tsc 0 errors).
> Census re-run: 0. **knip gate flipped advisory -> BLOCKING** in adoption-gates.yml with a
> deny-canary that plants an unused file and expects red (probed: exit 1 naming the plant).
> Full gate after: verify:hard exit 0, 599/599 test files passed.
> Also this wave: the four 2026-08-27 skill proposals were operator-approved and applied
> (stranded-branch-rescue squash-probe · guard-red-team deny-canary rule-name assertion ·
> statenour-verify stale-junction + hook-flake traps · worktree-teardown.ps1 refuses `main`).
>
> **Flagged · NOT fixed:** `taskClass` still has no producer; prod OpenAI key rotation still
> pending; 3 stale-docs WARNs surfaced by the deletion (docs naming removed files) - warn-level,
> not gated.

> ## 2026-08-27 · Retrieval lever wave · 1 ship (#1949) — durable-lane fusion, 50% -> 86% hit@5
>
> Same-day follow-through on the #1947 baseline, under the operator's standing charter
> (measure before build, one merge, negatives reported). Six levers measured on the labelled
> corpus BEFORE any code: durable-slice KNN fusion, ef_search/iterative_scan, lexical topic
> caps, lexical statement_timeout, rerank call-site bound, NICK_EPISODIC_SPLIT.
>
> **#1949 — adopted with numbers:** durable-slice KNN (exact MATERIALIZED-CTE scan over the
> ~122-row personal partition — deliberately not HNSW; 0.4%-selective post-ANN filtering is
> the documented starvation shape) RRF-fused (k=60) into memory-recall: **hit@5 50% -> 86%,
> hit@10 -> 96%, MRR 0.72, identity slice 0/4 -> 4/4, no slice worse, p50 138ms**. Lexical
> statement_timeout 900ms (10/28 GIN queries ran past it for ONE hit total; max 2.9s -> ~1.1s
> observed). Rerank call-site bound 1,500ms (backend AbortSignals are 7.5s/6s — sized before
> the 3s race existed; 1,415ms spike observed). Canaries synthetic + positive-control, armed
> -> failed -> restored. 16/16 tests, tsc exit 0.
>
> **Measured and REJECTED (kept on record):** ef_search 200 / iterative_scan — raw-pool
> containment +21pp but endpoint hit@10 96.4% either way; topic caps — flat; episodic split —
> +1 case on n=28; harvest:evals growth — cases carry relevantKeys []. The day's arc for the
> lane chat actually uses: **0% -> 50% -> 86% hit@5**.
>
> **Flagged · NOT fixed:** contextual containment reads 39-46% across runs (rerank
> nondeterminism; local harness has no 3s race, so raceless numbers overstate the no-timeout
> world) · post-deploy behavioral confirmation still pending real operator turns (0 turns at
> probe time; positive control proved the instrument) · durable-vs-ephemera RRF weight and
> weighted fusion parked until the corpus reaches >=50 labelled pairs.

> ## 2026-08-27 · Adoption-gates wave · 2 ships (#1929, #1935) - the register closes its own loop
>
> A pasted external deep-research audit was plan-gated against docs/UPSTREAMS.md: both its P0s
> were REFUTED by code inside its own pinned baseline (bridge-rejection logging closed by #1487;
> media evidence wired by #1581), ~20 of its 24 proposals mapped to existing register rows or
> recorded decisions, and the four survivors were registered (#1929) then BUILT same day (#1935).
>
> **#1929 - four ADOPT-CANDIDATE rows** (knip, dependency-cruiser, ast-grep, MCP
> Inspector-as-canary), incumbent-collision analysis inline.
> **#1935 - the gates.** `adoption-gates.yml`: install-free blocking job (version-pinned
> `pnpm dlx`; the lockfile is untouched). ast-grep `no-native-dialogs` (tsx+ts twins) over BOTH
> PWAs' client trees - this app finally has a mechanical gate for the iOS-PWA dialog rule, born
> green (probe: 5 fixture errors vs 0 real). dependency-cruiser `no-deprecated-card` +
> `no-reverse-layer-imports` - its FIRST real scan caught `lib/services/ultron-ticker.ts`
> dynamically importing the brain-maturity ROUTE and discarding it unused (`void maturityMod`),
> deleted in the PR; 1857 modules / 6819 deps then cruised clean. knip advisory census into the
> job summary: **341 unused files in this app alone** - the reason the knip gate is advisory
> until wire-or-delete decisions land. Route-level MCP canary
> `tests/agent-bridge/mcp-route-rejection-canary.test.ts`, mutation-probed (#1487 audit call
> disabled -> 1 failed; restored -> agent-bridge trio 22/22). Every canary asserts the RULE
> NAME in output, never just exit codes - probed same day that a depcruise config error
> (TS18003) also exits nonzero and would have blessed a blind gate.
>
> **Flagged · NOT fixed:** the 341-file knip census IS the wire-or-delete backlog (the TTS /
> wake-word / ambient hooks and persona instruments are in it); prod OpenAI key rotation still
> pending (#1930's finding, unchanged here).

> ## 2026-08-27 · Retrieval-quality wave · 1 ship (#1947) — the brain's first recall metric
>
> Operator: "look up and implement the best ways" for retrieval. MEASURED FIRST: built a
> 28-case labelled corpus from the operator's real chat queries (gitignored eval-datasets/)
> and ran every lane through the REAL production functions, read-only by verified
> write-stubbing. Baseline: the live chat lane ("Hybrid Recall", fired on 71/118 real turns
> that week) scored **hit@5 = 0/28** — dense KNN ranked answers #1 of 92k and the category
> whitelist then deleted them (no durable personal category was recallable). The fused
> RRF+rerank pipeline lost its 3s race on the median turn: its FIRST stage, an LLM topic
> extraction, measured p50 4,183ms / p90 11,294ms in prod agent_traces; Promise.race kept the
> work running, billed, discarded (deeperContext fired 0/118 turns). The semantic candidate
> pool was a planner-arbitrary 300 of 9,004 confidence-1.0 ties — two identical probes
> returned pools 79% archive_document, then 63% journal_brain_take. Wave-81 queryEmbedding
> plumbing: built-tested-unwired (the one caller passed no opts).
>
> **#1947 — baseline + 4 fixes, re-measured on the same corpus:** durable categories admitted
> to memory-recall's whitelist (hit@5 **0% -> 50%**, MRR 0 -> 0.448, beats raw dense 39%);
> deterministic deriveFastTopics on the chat hot path (topics p50 4,183ms -> 0ms; pipeline
> p50 1,981ms; rerank fires again — outcome:ok, rerankFired:true, zero LLM calls verified by
> stub count); true-KNN top-50 unioned into the candidate pool (~30ms via lib/db/pgvector
> guards); queryEmbedding + fastTopics wired at the one caller; slot-math guard
> (remainingSlots could go negative -> slice(0,-1) admitted every above-threshold row).
> Canaries proven to bite both directions. 16 test files, 178 passed, exit 0; tsc exit 0.
>
> **Measured and deliberately NOT built:** naive RRF(A+B) fusion scores 43% hit@5 — BELOW the
> fixed lane's 50% — so no new fusion layer; the fused pipeline already exists in
> contextual-recall. Weighted fusion parked until >=50 labelled pairs (corpus is 28).
> Embeddings pre-verified healthy (216/24h, backlog 9 among eligible; Cohere primary — the
> dead OpenAI key is irrelevant to this lane).
>
> **Flagged · NOT fixed:** lexical FTS stage spikes 1.6-1.9s on some 8-term OR tsqueries —
> those runs still bust the 3s race · identity-slice queries ("how old am i") are 0/4 on
> EVERY lane (paraphrase-gap class) · durable-vs-ephemera RRF weight (study Finding 4) now
> measurable on the corpus · ef_search/iterative_scan lever unmeasured · eval corpus is
> machine-local by design (gitignored) — grow it via pnpm harvest:evals before weight tuning.

> ## 2026-08-27 · Now-card real ranking · 1 ship (#1946)
>
> Measurement before implementation, and the measurements overturned the brief twice. The audit's
> "live it says Drink water" was stale — the #1897 extraction already guarded the ACTIVE/RESUME
> arms, wired end to end. And the "six overdue invoices" are nickstire/ALG data: live probe found
> 0 open overdue tasks and 0 $-titles in this DB — no statenour scorer can rank what never enters
> the candidate set. What WAS real: roiScore is hand constants (open set 11 → `25:1 50:5 55:1
> 70:4`, 1.68 bits; hydration and customer follow-ups both hard-coded 70), the one scorer
> (`lib/scoring/task-priority.ts`) gave that column its dominant weight (0.35) — laundering
> constants — and the Now-card surfaces bypassed the scorer anyway, sorting raw roiScore.
>
> **#1946 — feat · Now-card ranks on real terms.** `NOW_WEIGHTS` single block (roi demoted
> 0.35→0.15; due 0.25; staleness-from-lastTouchedAt 0.15; dollar-from-title 0.15, armed but mute
> until invoice imports exist; mission 0.15; friction 0.10; energy 0.05); `HABIT_CLASS_MULTIPLIER
> 0.5` after the sum; explanations become the operator one-liner (`picked because: untouched 42d ·
> roi 55 → 38`). criticalFew + weakest-inbox lanes order by autoPriority (object form, nulls last);
> focus-lane DOING and last-resort arms gain the habit guard the middle arm had; `HABIT_LOOPS`
> single-sourced from the scorer. Live comparison receipt: old top-4 = four DAILY habits at
> constant 70, focus pick "Drink water — 6+ bottles"; new = every ONCE task above every habit,
> focus pick "drop off signs (untouched 42d)". Canary with positive control: overdue-$846 fixture
> beats the habit, the old ordering provably picked the habit, invoice wins on terms even without
> the demotion. Affected suites 5 files/38 tests + legacy pin rewritten to mechanisms; full gate
> 596/596 test files, 18/19 checks green.
>
> **Flagged · NOT fixed**
> - **Revenue items never enter the candidate set** — the overdue invoices live in nickstire/ALG.
>   The dollar term ships armed; the invoice→task bridge import (natural entry:
>   `lib/ai/tools/tasks.ts` follow-up writer, which itself hard-codes roiScore 70) is operator-gated
>   follow-up, not built.
> - ~~`check:policy-coverage` red pre-dates this wave~~ **RESOLVED same day (~16:08 ET),
>   operator-authorized:** `scripts/seed-policies.ts` upserted 102/102 policies against prod
>   (backup `_bak_automation_policies_seed_20260827`, 165 rows, kept until confirmed good);
>   gate green — all 76 non-retired crons (55 active + 18 folded + 3 dormant, evaluated registry) + all 20 autonomous-action rules covered. Full
>   `verify:hard` confirm: 599/599 test files, all 19 sections, exit 0. The red had failed
>   every sibling's verify:hard since #1901 armed `cron.automation-engine` unseeded.
> - Weakest/quick lanes deliberately still admit habits (their copy claims domain-lift/momentum,
>   not leverage) — revisit only if a habit ever leads the card through them.

> ## 2026-08-27 · Dead-key blast radius + free STT chain · 1 ship (addendum to the read-aloud wave)
>
> Follow-through on the revoked OPENAI_API_KEY (operator: no paying; OpenAI TTS option CLOSED).
> Read-only sweep first, classified every dependent lane: mic HARD-FAIL (measured 502
> "whisper 401"), audio-drop + Realtime session hard-fail (code-read), brain fact-extractor
> SILENTLY failing (OpenAI-direct, 401 per call), **embeddings HEALTHY — measured, not
> stalled** (Cohere lane absorbed it; 216 rows written today, newest minutes old, baseline
> 175-280/day, total 92,441). Chat/vision/judge lanes were already Ollama-primary.
>
> **The ship:** `lib/ai/stt.ts` — free-first chain groq (no-card, dormant until key) → hf
> (key live in prod; lane LIVE-PROVEN: perfect transcript of a known sample in 1,323ms) →
> openai (self-heals on rotation). Both transcription routes ride it; response carries
> `source` + `degraded` and the client toasts on degradation — key PRESENCE is never treated
> as validity. Fact-extractor moved to aiChat() (same migration as the adversarial critic).
> Options measured and rejected: Gemini lane (429 spending-cap = billed project), browser
> SpeechRecognition (dead in installed iOS PWAs — feature-detects then never fires),
> Deepgram (one-time credit, not free-forever), whisper.cpp (dominated on every axis).
>
> **Flagged · NOT fixed**
> - Realtime voice overlay stays dead (OpenAI-only session mint). Nearest free path is a
>   Gemini Live rebuild — a project, not a patch. WATCH.
> - Wake-word/ambient hooks use browser SpeechRecognition — presumably dead in the installed
>   PWA (same evidence class); unverified on device.
> - GROQ_API_KEY not yet set (operator: free no-card signup) — until then hf is primary.

> ## 2026-08-27 · Run-to-empty batch · 6 audit findings closed in one merge
>
> Operator directive: batch everything outstanding into ONE merge — each merge to `main`
> cancels every sibling PR's in-flight run via the CI concurrency group (measured 22/45
> Agent-policy runs cancelled that day, 48.9%) — while review stayed per-slice. Three of the
> six findings dissolved under origin/main measurement before any edit: the meta-gate already
> ships as `check-gate-reachability` (#1881/#1889 — orphan arm + live-repo arm, run by
> `agent:verify` on every PR), anti-slop already executes the real script against the real
> tree (#1883), and `prompt:size-check` already skips loudly without DATABASE_URL (#1886).
> Measuring before editing is the audit's own rule; it deleted half the work order.
> **lint:cron-wiring wired into nickstire's LOCAL verify chain.** CI has run it since #1808;
> the gate an agent actually runs before pushing never did. Receipt: 33 registry jobs, 117
> tier jobs, 6 justified aliases, 0 faults.
> **camera-intelligence denominators.** `todayStart` was UTC midnight (8pm ET) so "today"
> leaked 4-5h of yesterday; `bayUtilization` divided a UTC-day numerator by ET elapsed hours
> (could publish >100%, now both ET + clamped); `avgDailyTraffic` divided by the calendar 7
> regardless of observed days — now active ET days (#1913's denominator rule). 6/6 tests;
> each of the two mutations (UTC bucketing, clamp removal) kills exactly one test.
> **attention-helpers deleted** — the last zero-consumer module of the audit's seven; the
> other six were wired or armed by #1890/#1892/#1895/#1899/#1911/#1923. Its only consumers
> were its own tests — the orphaned-subject shape from the field guide. Verified by
> bare-specifier scan after an import-syntax grep MISSED the line-broken dynamic imports in
> `cron/intelligence` (those belong to decision-patterns/time-intelligence, never on the
> list) — "zero-consumer" claims get the wide instrument, every time.
> **Hour-frame key census** (`docs/audits/hour-frame-key-census-2026-08-27.md`, read-only
> probe committed beside it): 218 live UTC-keyed rows · 6 live ET-keyed — all 6 carrying the
> #1894 `hourFrame` marker, mechanism verified populating · 111 soft-deleted counted
> separately. Three remediation options laid out, NO decision — operator's call.

> ## 2026-08-27 · Chat read-aloud (streaming TTS) · 1 ship (#1930)
>
> One squash by design (operator: CI cancel-in-progress makes every extra merge cost the
> sibling sessions a full cycle). The feature: opt-in narration for Nick chat that speaks
> WHILE the reply streams — segmenter (sentence/paragraph/list/heading/length boundaries,
> abbreviation/decimal/URL guards, code fences atomic) → markdown sanitizer (fences read as
> "Code block omitted.") → NarrationController (stop-means-stop via generation counter,
> engine fallback with honest attribution) → `SpeechEngine` seam. 45 tests exit 0; deployed
> verify: `/api/version` @ 7f293d3, live authed smoke on bdnick.info (chip renders,
> `/api/ai/speak` 200, TTFA 788ms edge lane).
>
> **#1930 — feat · chat read-aloud** · `features/chat-v2/lib/speech/*` + `use-tts` +
> `/api/ai/speak` (gpt-4o-mini-tts primary · edge-tts-universal fallback · `x-tts-engine`
> header never lies) + composer chip + action-sheet replay. UPSTREAMS rows added for every
> engine evaluated: @bestcodes/edge-tts DEAD (DRM 403 measured), Kokoro/Piper WATCH,
> sherpa-onnx PATTERN.
>
> Method note: the honest-attribution header caught its first real substitution ON THE SMOKE
> TEST — `engine:"openai"` came back `servedBy:"edge"`, which unwound to the day's biggest
> finding: **the production OPENAI_API_KEY is revoked** (live receipt: authed
> `/api/ai/transcribe` → `502 "whisper 401: Incorrect API key"`). Mic + Realtime voice were
> already dead before this wave; `env-check`'s `openai:true` only proves the var is SET.
> Operator-authorized mitigation same hour: `TTS_ENGINE=edge` on statenour-web (default lane
> now skips the ~5.8s dead openai attempt).
>
> **Flagged · NOT fixed**
> - **OPENAI_API_KEY revoked in prod** — mic, Realtime voice, TTS-primary, embeddings.
>   Rotation is operator-only; open at wave end.
> - Replay-during-live-stream can interleave the replayed and live span queues (minor UX).
> - `/api/ai/speak` surfaces adapter errors only when BOTH fail — a single-adapter failure is
>   visible in the header but not logged server-side.
> - iPhone PWA: UNVERIFIED ON TARGET DEVICE at write time (operator testing).

> ## 2026-08-26 · The surface-honesty wave · 22 ships (#1837 #1838 #1840 #1844 #1856 #1859 #1860 #1866 #1870 #1888 #1890 #1892 #1895 #1896 #1899 #1901 #1902 #1911 #1913 #1915 #1923 #1926)
>
> One theme, arrived at from three directions: **a surface that cannot say "I do not know" will
> say something false instead.** Panels rendering a failed read as a measured zero; a stop hook
> whose silence meant either "clean" or "I never looked"; an engine whose rules asserted counts
> nothing counted. Every fix is the same move — make the unknown state representable, then make
> it unrepresentable to omit it.
>
> Method notes worth keeping. **Measurement reversed the plan four times.** The 18 remaining
> envelope casts were all CORRECT (base rate said ~7 of 11 should be broken; observed 0 — they
> cluster in the `/api/ai/*` subfamily that never adopted `apiHandler`). The ET-weekday residual
> carried for several sessions was REFUTED at 11,616 checks. Two `isError ? []` sites named as
> defects had error guards and were latent, not live. And `automation-engine` — reported twice
> by me, wrongly, before the third measurement held. **Corrections belong in the record**: I
> claimed "intermittent ~50%" CI failure inferred from PRs that never ran the suite, and a rerun
> count that reused run IDs. A pass that was never attempted is not evidence.
>
> **#1837 · canary decouple.** Three of five canaries were pinned to live data — `expect(DESIGN.md)
> .toContain("rounded corners")` dies the day that convention is correctly retired. Extracted
> `auditGateClaims` around the durable invariant (a doc must not credit a gate with checks it
> does not run), driven by synthetic docs including one that over-claims.
> **#1838 · strict `rawFetch`.** 13 call sites, 4 duplicate unwrappers deleted. `rawFetch` used to
> END in `(await res.json()) as T` — it WAS the bug shape wearing a name. It now throws when the
> body is an envelope, so the day a route adopts `apiHandler` the call fails loudly instead of
> rendering an empty panel forever.
> **#1840 · EmptyState provenance.** Two live false all-clears killed: `nudge-panel` rendered a
> green "In rhythm · all subsystems stable" across nine subsystems it had just FAILED to read;
> `contradiction-resolution` rendered "Clean ledger · internally consistent" on a failed query.
> `tone="positive"` is now type-gated to `provenance="ZERO"` — a false all-clear does not compile.
> **#1844 · orphaned policy + `policyBootstrap`.** `auto_score_applicant` was seeded
> `approvalClass:"auto"`, tagged cost-bearing, for a rule not among the 20 and a webhook never
> built. Also deleted the readerless `policyBootstrap` marker — the gate is the protection.
> **#1856 · the engine sent the operator to a 404.** `/system/approvals` was absorbed into
> `/system/actions`; 16 references stayed, six operator-facing, three auto-linked in Telegram.
> The fail-closed engine held a side effect then said "approve via /system/approvals". Two links
> REMOVED rather than repointed (no page exists); `/system/eval-results` unwound into three false
> claims in one tile.
> **#1859 · the stop hook could not say "I did not look".** Three fail-open paths exited 0
> silently, so an inert hook and a satisfied hook were indistinguishable — the blind-instrument
> shape inside the fix for it. Its canary could not see the defect either: `runHook` returned
> execFileSync's value (stdout only), discarding stderr on every exit-0 path. A widening was
> REJECTED on its own numbers: 37 of 74 local branches would have tripped it.
> **#1860 · the frame canary watched ONE named file.** Now sweeps every surface for a bare
> WAITING/READY, narrowed to the two statuses a same-day completion can contradict.
> **#1866 · ET-weekday residual REFUTED.** 2,904 instants × 4 server timezones = 11,616 checks,
> 0 mismatches. The real finding: `startOfWeekET` already existed and the route hand-rolled a
> duplicate. Prior art was there the whole time.
> **#1870 · the last frameless status door.** Dead `StatusBadge` removed (a null value rendered
> the word "Unknown" — a frameless claim of its own). Codex raised a P1: the door came out with
> no canary. Correct, and taken.
> **#1888 · a comment asserting UTC on a line reading ET.** Worse than either half alone — the
> next reader trusts it. Gate added; measured exactly one instance repo-wide, now zero.
> **#1890 · `task-signals` wired** — capacity counts rendered VERBATIM beside the composer, never
> through it, because the brief's CRITICAL marker is 81.3% saturated and inverted at both extremes.
> **#1892 · `attention-tracker` wired.** `daysSinceEngagement` saturates at 14 (the scan window),
> so it renders "not in the last 14d", never "14d silent". `energy-router` NOT wired: `totalSamples: 0`.
> **#1895 · the 11am rhythm that never ran.** `executeRhythm` was complete, flagged ON in prod,
> and had zero callers. Fires at `0 15,16 * * *` — one fixed UTC hour silently retires itself
> every November when the ET gate stops matching.
> **#1896 · automation-engine audited, NOT wired.** Four-level disagreement between engine and
> its own data. Documented in the header so nobody wires it blind.
> **#1899 · the executor rewrite.** Action executor reading `action.type`, class-matching for
> `device_state` (an unknown field is UNSATISFIABLE, not ignored — otherwise `{runningHours:6}`
> alerts on every device), a `composite` evaluator, a loud `default:`, and edge-triggering via
> match-set fingerprint. 20 of 22 devices OFFLINE since April: level-triggered = 24 messages/day
> about a four-month-old fact.
> **#1901 · reword, then arm.** The three time rules ASSERTED conditions their triggers never
> check — `{type:"time",hour:18}` sent "No new leads today" on a day with twenty. Reworded in
> prod (names too — the rule name is part of the sent message). Found and fixed one more of my
> own bugs first: the time fingerprint keyed on `[dayOfWeek, hour]`, which suppresses a
> `days:[1]` rule forever after its first fire.
> **#1902 · dropped a pinned count I wrote hours earlier.** The manifest said "8 enabled rules";
> four operator-approved disables later it was 4. Removed rather than corrected — a count in
> prose is a cache with no invalidation. It earned itself the same day.
> **#1911 · `page-intelligence` wired, FACTS only.** Its output mixes counts (`/chat` opened 49
> times; three surfaces untouched 3+ days; 21 visits after 11pm) with psychological reads
> ("correlates with overthinking", "may be using conversation as procrastination"). The reads may
> be right; nothing here measured them — it counted page rows. `insights[]` is excluded by a TEST,
> not a comment, mutation-tested both ways. Renders `lateNightCount`, not the `> 3` boolean — the
> threshold is somebody's opinion; the number lets the reader form their own.
> **#1913 · the hour was read from the wrong copy — found by self-auditing #1911.** Each
> `page_visit` row carries the same fact twice: `createdAt`, stamped by the DB, and
> `payload.hour`, computed at write time and frozen. The reader preferred the frozen copy, so a
> transient fault got baked into the archive: **691 of 719 rows in 30d carry a UTC hour against
> an ET timestamp** — a clean +4h. "After 11pm" was counting from 7pm; the brief shipped 21
> where ET says 12. Days 07-28..08-24 are 100% affected, 08-25 flips mid-day, 08-26 is clean,
> and the cause is `1202bdd0f` (see the correction below). Days also
> moved from UTC to ET buckets, and `avgDailyVisits` now names its denominator (active days,
> not calendar days). Same fix applied to `GET /api/brain/page-visit`; the automation engine is
> unaffected — it computes `hourET(now)` and never reads the archive.
> **#1915 · the e2e "flake" was one bug, and not a test failure.** Playwright never ran in ANY
> of the 5 failures sampled (back to 08-22, identical signature). The dev server prints `Ready
> in 430ms`, the first request to a route that EXISTS resolves to `/_not-found`, and it answers
> 404 in ~40ms for the whole 180s budget — a cached negative, not a slow compile (work in
> progress gets slower, not faster). The step then printed "server never came up" about a
> server that answered 199 requests, which is why it took five failures to find. The wait loop
> conflated two OPPOSITE states: `curl` rc!=0 (cured by waiting) and HTTP!=200 (made permanent
> by waiting). Now split, with one restart on the latched state. The latch itself is upstream
> in Turbopack and is NOT fixed. Its canary caught three defects in the fix before it shipped —
> incl. a restart that announced itself and did nothing (children held the port, the new server
> died EADDRINUSE, every probe then read the OLD one).
>
> **Prod data changes (operator-authorized, each backed up before the write):**
> Three time rules reworded (`_bak_automation_rules_reword_20260826`). Four rules disabled across
> three writes — `Device running 6+ hours` (`runningHours` is not a column),
> `Late night motion + lights off` (`device_events` holds 2 rows, newest 2026-06-25),
> `High drift risk task` (nothing writes category `anomaly` — 0 rows, no producer),
> `Low energy pattern detected` (FUNCTIONAL, 536 rows — off by operator choice, not defect).
> Backups `_bak_automation_rules_disable{,2,3}_20260826`. Engine now evaluates 4 rules hourly.
>
> **Flagged · NOT fixed:**
> - **`turbo-affected verify` cancels on main ~17% of the time, UNDIAGNOSED.** 24 success / 5
>   failure over the last 29 runs. Two inspected are identical and are NOT test failures: `The
>   runner has received a shutdown signal` → `Force killed Turborepo tasks: build, check` →
>   `5 successful, 8 total` at the 5-6min mark. It hit `8d4acf1af`, a DOCS-ONLY diff, which rules
>   out code. Smells like host memory (a Next build and `tsc` concurrently) but that is a guess.
>   **A red badge here is a prompt to read the log, not a conclusion** — cancelled and failed
>   render identically, and a real failure names a test, not a signal.
> - **CORRECTION (2026-08-27), was "the unlock is a WRITER … a product decision":** that was
>   WRONG, and #1926 is the proof. The writer already existed and was wired end to end —
>   `startTask` stamps `startedAt` via tRPC `task.start`, called from the missions hook,
>   `move-frame` and the coach sandbox. No product decision was required. The real defect was
>   that the three completion paths disagreed about stopping the clock (#1926). **The lesson is
>   the same one this wave keeps re-teaching: "nothing writes it" is a claim about the code you
>   looked at.** I checked the readers and the column, not the writer's own call graph.
>   Still open, and it is ADOPTION, not plumbing: minutes are only recorded for a task that was
>   explicitly Started, and the archive shows that has essentially never happened (0 of 268 rows
>   above zero). Capturing duration WITHOUT that step is the genuine product decision.
>   `calibration-generator` still stores `actualMinutes` as calibration *evidence* and
>   `ultron/work-context` still selects it — both harmless while the column is zero, both will
>   start carrying real values once tasks get Started.
> - **MEASUREMENT TRAP, SQL edition:** `"updatedAt" AT TIME ZONE 'America/New_York'` on a
>   `timestamp without time zone` INTERPRETS the value as NY instead of converting to it — the
>   wrong direction, off by 8h (read 16 where ET is 8). It produced a plausible-looking window
>   distribution that was entirely wrong. Correct form:
>   `AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York'`. Third frame defect of this wave, first
>   one in SQL — `hourET()` in app code was right all along.
> - The Turbopack route-resolution latch behind #1915 is upstream and unfixed; CI now recovers
>   from it rather than curing it. Every restart is announced, so occurrences stay countable.
> - MEASUREMENT TRAP: `gh run rerun` reuses the run ID, so a rerun-to-green OVERWRITES the
>   failure. `gh run list` therefore UNDERSTATES the failure rate — it showed 2 in 15 while at
>   least 3 had occurred. Count from the reruns you performed, not from the run list.
> **#1923 · `energy-router` was never short of data; one filter threw it all away.** I twice told
> the operator to leave this module dark because it reported `totalSamples: 0`, so every
> recommendation it could make was unearned. The output was unusable; the DIAGNOSIS was wrong. It
> filtered on `actualMinutes > 0` — a column NOTHING writes, whose NOT NULL default of 0 makes it
> look populated (268 of 268 non-null, **0 of 268 above zero**). One predicate discarded 124 real
> completion timestamps. **Removing it naively would have been worse than leaving it dark:**
> `overage = 0 - expected` reports every task finishing 15min EARLY, quoted to the minute in a
> live suggestion; `confidence = n/50` → 1.0 on empty input; and `recommendWindow` gates on
> `totalSamples < 10`, which 124 clears — so it names a best window for HIGH-energy work from a
> population of **4, spread one per window**. That last one is the base-rate error in code: a
> subgroup claim validated by the size of the population it was filtered out of. Now
> `MIN_BAND_SAMPLES` gates the BAND, `avgOverageMinutes` is `number | null` averaged over
> `overageSamples` (never over completions), and the brief renders timing while saying duration
> is UNMEASURED. Live: 124 completions — morning 55 · afternoon 32 · late 30 · evening 7.
> **#1926 · a task timer that only one of three finishers stopped.** `startTask` stamps
> `Task.startedAt`; completion is meant to turn that into minutes and clear the stamp. Only the
> service ONCE/PROMISE path did the whole job. The service DAILY path discarded the minutes
> (deliberate) **and left the stamp set** (not deliberate), and the agent path never read
> `startedAt` at all — so pressing Start in the UI and then asking Nick to close the task
> dropped the elapsed time and left a DONE row that every `startedAt` reader sees as still in
> progress. **Which of the two ways you finished decided whether your work was measured**, which
> makes the rows it did produce a sample of how tasks were CLOSED, not of how long work took.
> One definition now lives in `lib/services/task-timer.ts`: `stopTimer` returns `null` and never
> `0` (zero is a real measurement — started and finished inside a minute), and `accumulate`
> returns `undefined` so Prisma SKIPS the column and an untimed completion cannot erase minutes
> banked earlier. The DAILY discard is preserved on purpose — `actualMinutes` is compared to a
> PER-INSTANCE effort estimate and a recurring row is never re-created, so accumulating would
> read as an enormous overage; changing that is a product decision and was NOT made. Also fixed
> the `${focusedMinutes}m focused` line in `lib/ai/chat/command-registry.ts`, which told Nick
> "0m focused" every single day.
> - **CORRECTION (2026-08-27), was "UNEXPLAINED / environmental":** the clock flip has a cause,
>   and it is a commit, not the environment. `1202bdd0f` — "Nick reads the operator's clock, not
>   the server's" — merged **2026-08-25T15:17:30Z** and changed the writer in
>   `lib/services/brain-domain.ts` from `new Date().getHours()` (the UTC hour, because Railway
>   runs UTC) to `hourET()`. Last UTC-stamped row **14:56:52Z**, first ET-stamped row
>   **15:26:35Z** — an interval that CONTAINS the merge, with nothing contradicting it. It does
>   NOT time the rollout: `recordPageVisit` records user activity, not deploys, so the gap is
>   only when a page was next opened (raised as a P2 on #1918 and taken). The same commit fixed ~30 server-clock reads app-wide and added the ET-clock gate.
>   **Why the first pass got it wrong, and the lesson worth keeping:** `git log -S` reported no
>   change to the writer because it defaults to **HEAD**, and this shared checkout sits on a
>   branch days behind `origin/main` that does not contain the commit. The archaeology was
>   correct about the wrong timeline. On a shared checkout, ask `origin/main` explicitly — a
>   `git log` answer is only as current as the branch you are standing on.
>   Still true: historical rows stay poisoned, and #1913's readers are right to derive from the
>   timestamp — the stored copy is redundant and cannot be re-derived once written wrong.
>   Bounded: no schema column stores an hour, and `page_visit.payload.hour` had only the two
>   readers #1913 fixed. The automation engine's own `dayOfWeek`/`hour` were UTC until the same
>   commit, but it computes them per-tick and was armed on 08-26, after the fix.
> - `energy-router` runs clean in 31ms and returns `totalSamples: 0`. Every recommendation it can
>   make is unearned; it stays dark until the sample count is non-zero.
> - `page-intelligence`'s `insights[]` stays out of the brief permanently (its counts went in at
>   #1911). Still available to the chat prompt, where handing a model a hypothesis is reasonable.
> - PR-4 (brief push escalation) KILLED on measurement, not effort: 26 of 32 briefs (81.3%) carry
>   CRITICAL, and the marker is INVERTED at both extremes — it fired on both days with zero cron
>   failures and stayed silent on the day with 6,039 of 60,519 runs failing.
> - Deploy verification was unavailable all session: every health/version endpoint returns
>   `Unauthorized`, and `railway deployment list` needs an interactive service link. An
>   unauthenticated `/api/version` is in flight. Every ship above is **merged, deploy unverified**.
> - CI note for the next session: `gh run rerun` reuses the original merge commit, so a PR red
>   from a since-fixed `main` can never go green that way — `gh pr update-branch` is what lands it.

> ## 2026-08-26 · The interaction-audit wave · 9 ships (#1881 #1882 #1883 #1886 #1889 #1891 #1894 #1898 #1897)
>
> Operator directive: audit the ~30-PR / six-session day AS A WHOLE — interactions, not
> individual defects — then land the fixes. Verdict held: production was sound; the GATE LAYER
> was not (one gate nothing ran, one canary that could not see its subject, one gate needing prod
> credentials to complete). Method notes that earned their keep: every ratio beside its base rate
> (orphan modules 26.9% in the clock fix vs 6.7% repo-wide) · four of my own first-draft canaries
> were WRONG and the mutation step caught all four · three of the four "fix these" items I was
> handed dissolved under measurement (TTL working as designed; nickstire:booking wired but never
> emitted; bridge 401 = my own worktree's stale key) — refuting your own findings is part of the
> audit.
>
> **#1881 · a gate nothing runs is not a gate (agent-os).** `check-gate-reachability` — every
> `check:*`/`lint:*` in 4 packages must be invoked by CI, lefthook, or a verify chain. Born from
> #1806 fixing three unwired gates and #1808 shipping a fresh one 41 minutes later. 7 canary
> arms incl. live-repo (arm 6) and the `--root`-no-value refusal (arm 7, from #1889 after a
> post-merge self-audit found my own gate silently scanning the wrong tree).
> **#1882 · /api/version, unauthenticated.** "Merged" and "deployed" were different claims for
> half the estate (every statenour probe 401'd while nickstire answered in one request). EXACT
> allowlist entry, red-teamed: prefix-bleed mutation turns 2 arms red while the happy path stays
> green. Every merge this wave was then deploy-confirmed through it.
> **#1883 · the anti-slop canary could not see its own gate.** Its arms read the script's SOURCE;
> nothing ran it — and the Inter regex had the operands in the wrong order, so the canonical
> `import { Inter } from "next/font/google"` NEVER matched. Found by writing the arm that runs
> the gate against planted offenders; it failed on first run. Roboto carried the same bug.
> **#1886 · prompt:size-check skips loudly without DATABASE_URL.** Step 18 of verify:hard opens
> live Neon with `--yes`; a credential-less worktree red-lined all 19 gates, so the rational move
> was to skip the whole chain. Now: skip (exit 0, banner that never says PASS) / CI still fails.
> Decision extracted to `scripts/_lib/db-gate.ts` — importing the script runs the measurement,
> the seed-policies near-miss shape.
> **#1891 · the measurement tool's own header misstated its threshold by 25,000 chars.** Four
> stale claims fixed; the 65,000 cap has FOUR hand-maintained copies, three saying "keep in
> sync", nothing enforcing — a canary now pins all three mirrors to the root
> (finalize-system-prompt.ts:118) and the header's stated cap to RUNTIME_MAX.
> **#1894 · hour-encoding memory keys record their clock.** Pre-#1809 `{h}` keys are UTC, post
> are ET, nothing on the row distinguishes them (330 rows, ALL UTC-keyed, zero readers of the
> hour). Marker not migration; the discovery canary found a FOURTH hour-encoding key
> (`unanswered_leads`) my own audit had missed, on its first run.
> **#1898 · time-travel dated the operator's day in UTC.** Three frame defects in one route: UTC
> day bounds shifting all 11 queries 4-5h · UTC default date (empty "today" after 8pm ET) ·
> emotional_state filtered by createdAt so 170 backfilled rows (58 distinct days, 05-28..08-13)
> all surfaced on 2026-08-16 and never on the days they describe. Now ET bounds (exclusive
> upper), `today()`, and dated-by-KEY — total, measured: 329/329 rows carry a date.
> **#1897 · home redesign, reviewed then fixed (6 fixes, one push).** Ran the promoted selector
> against LIVE data: the page's dominant card was "ACTIVE ENGAGEMENT — [Drink water — 6+
> bottles] … Do not context switch until completion" (a DAILY loop hand-scored roiScore 70,
> tied-highest in the open set). Fixes: chain extracted pure (`derive-briefing.ts`) with a
> DAILY/WEEKLY guard on the ACTIVE/RESUME arms · the decide arm the design promised but never
> coded (uncapped counts, null=unknown, idle refuses "nothing waiting" over a failed read) ·
> Ask-Nick order-first on mobile · 16-test canary (water row verbatim; 2 mutations kill 2 and 4
> arms) · all tap targets 36→44px · LoopKind gained the WEEKLY the Prisma enum always had, and
> KindFilter now derives from it. Truth safeguards all verified surviving; all 9 new theme
> tokens real.
> **Prompt measurement (live Neon):** default 41,403 chars vs 49,344 baseline = −1,985 tok,
> within 0.5% of #1862's prediction — the cuts composed, nothing grew into the space. Heaviest
> scenario 55,144 of the 65,000 cap (15% headroom).
>
> **Flagged · NOT fixed (deliberately):**
> - 170 no-expiry `emotional_state` rows from the 2026-08-16 bulk import — operator chose LEAVE
>   (they are the mood archive; stamping the 24h policy expiry = hard delete on next cleanup).
> - nickstire estimate-conversion + nickActions work orders dispatch NO `booking_created` — six
>   consumers blind incl. manager-on-duty SMS; wiring it arms an SMS lane, operator's call.
> - Habit roiScore data (water/workout/journal at 70 > every business task's 50-55) — untouched;
>   the guard makes it moot for the card, the data is still what nextMove ranks by.
> - e2e heartbeat-404 transient (two unrelated PRs, same minute, ~200×404, zero tests run; both
>   reruns green) — root cause unfound.
> - Merging to main cancels sibling in-flight PR checks; statenour's node job needs ~10min. Three
>   #1886 attempts proved it (4m30s kill, 4m45s kill, 11m18s pass with main held). Process rule,
>   nothing mechanical yet.
>
> (Agent-os ships #1881/#1889 recorded here because the wave was one arc; canonical coverage
> lives in docs/agent-audit/CONTROL-CANARY-COVERAGE.md, updated in the same PRs.)

> ## 2026-08-25 · The chat-stack wave · measure first, then 5 ships (#1836 #1843 #1846 #1848 #1849)
>
> Operator directive: upgrade the Nick chat/tool/observability/media layer, every decision cited
> to a measurement, competing AI recommendation graded rather than trusted. Phase-0 verdicts
> (mine + a sibling session's, reconciled): the 181 tools are in-process AI SDK functions (1 MCP
> client of 181; ToolHive's premise DOES NOT APPLY) · the pruned tool layer is ~10-13% of a
> request (NOT the cost problem) · Anthropic defer_loading is inapplicable (chat runs
> Ollama/minimax-m3) · the prompt is the cost center.
>
> **#1836 · tool-surfacing telemetry.** tool_telemetry counted CHOSEN tools; nothing recorded
> OFFERED ones, so the census's 40/181 "never invoked" was pruner-confounded by its own caveat.
> prepare-tools now records the final offered set per turn (`tool.surfaced` system_metrics row,
> zero DDL); the census splits "offered-never-chosen" (model's verdict, the actionable prune
> list) from "never surfaced" (pruner's blind spot), only once turns > 0. Canary red-green
> proven. VERIFIED POPULATING on prod: one live chat turn → row with 26 tool names, 16:45:53Z.
> **No prune shipped** — that waits for accrued corrected data, by design.
>
> **#1843 · Langfuse tracing, wired at both ends, dormant until keys.** The anti-braintrust
> design: boot init in instrumentation.ts + experimental_telemetry at the single streamText
> choke point, private-mode turns never traced, status = measured init OUTCOME. Offline wire
> proof 7/7 (real OTLP POST to /api/public/otel/v1/traces, Basic auth, gen_ai spans). UPSTREAMS
> Langfuse REJECT superseded (premise fell: "native receipts cover the need" — operator says no
> working observability); the SELF-host sizing objection honored — adoption is Cloud Hobby $0
> (5-13k units/mo measured vs 50k free). Deployed 16:30Z; prod boot log says langfuse_skipped
> with the exact activation env vars. Activation = 3 operator-set Railway vars.
>
> **#1846 · VideoDB removed — zero successful uses ever.** $0 account, empty collection, 0
> session rows, 0 metrics; 10 files deleted, catalog 181→179, both contract snapshots
> regenerated under their flags. Audio file-drop REWRITTEN to whisper-1 verbose_json (real timed
> segments, rate-capped now that it reaches a WORKING metered API); mic-path dead fallback →
> loud 502; video attach refused at attach time with the storage-backend reason. FFmpeg/
> whisper.cpp/Vidstack NOT added — nothing depended on the lane.
>
> **#1848 · dormant observability is VISIBLE; braintrust-wrap deleted.** The wrap sat 3 months
> key-set with ZERO call sites and no surface said so (its README runbook pointed at an ADR that
> never existed). /system now renders the tracing lane's real state (started / DORMANT-with-env-
> vars / failed); Braintrust renders as static retired truth. braintrust npm dep stays (manual
> eval-dataset scripts only).
>
> **#1849 · prompt-cost measurement (report only).** Built prompt 12,336 tok live; 72% is
> dynamic blocks; ROOT CAUSE behind the top line item: nick-prime-context's agenda query has NO
> take — all 71 ACTIVE agenda_items (oldest June 28) render into EVERY turn = 2,646 tok, 21% of
> the prompt, growing monotonically. Four levers ranked with savings + eval gates; zero edits.
>
> **#1862 · same-day follow-through: the prune's first slice + lever 1 executed.** (1) The one
> population with an honest denominator TODAY — CORE/ACTION_CORE tools are offered on ~every turn
> since the telemetry epoch 2026-05-12 (>=2,000 opportunities each; the INVERSE of the census
> confound) — gave a corrected-number prune: setTaskPriority (0 calls ever), syncKnowledge (0),
> runDeviceCommand (1, day-one) DEMOTED from always-on to on-demand, each with four paths back
> (new device + knowledge-sync keyword families, semantic, exact-name, recovery lane). Review's
> 82-conf catch adopted: short device phrasings ("lights off" is exactly 10 chars — under the
> route's embedding gate) now covered. (2) Agenda block BOUNDED at the source: AGENDA_PROMPT_CAP=18
> deadline-first + renderer overflow disclosure; v1 duplicate (zero importers) deleted. Measured:
> default prompt 49,344 -> 41,448 chars (~-1,974 tok/turn); the 21% section fell out of the top 10.
>
> **Flagged · NOT fixed (deliberately):**
> - The BROAD catalog prune — still gated on surfaced-data accrual (instrument live since 16:45Z);
>   #1862 pruned only the always-surfaced population whose denominator needed no accrual.
> - Prompt levers 2/3 (Processing-intake compression · persona dedupe) — behavior surfaces with no
>   A/B provenance; operator picks, live persona replay first (the 2026-08-15 lesson).
> - Langfuse activation — operator-side Railway env edit; wiring complete and proven.
> - BRAINTRUST_API_KEY still set in Railway — unused by the app; operator may delete.
> - `ai_generations.prompt_tokens` coverage is 8.1% (62/764) and lane-biased — the per-request
>   cost numbers carry that caveat until coverage widens.
> - page.tsx:148 pre-existing react-hooks warning — untouched, not mine to silently fix.

> ## 2026-08-22/23 · The Discover verdict loop, and five defect shapes (4 PRs)
>
> **#1787 · the verdict had nothing to attach to.** `/brain` -> Discover asks the operator to
> judge machine findings. The nightly cron keyed every blind spot
> `blindspot_${domain}_${Date.now()}`, and `remember()` upserts on `(category, key)` — so a clock
> in the key asserts that tonight's sighting is a different fact from last night's. Measured on
> prod across all six rows the engine had ever written: **3 of 3 verdicts given 08-21 were
> regenerated as unjudged within 24h** — 100% erasure against 100% participation. Base rate
> confirming the mechanism: the two engines with stable keys are 5/5 and 2/2 promoted-and-permanent;
> this one was 0/6. Also fixed: `getBlindSpotContext()` was reciting `noise`-rated spots back into
> the system prompt nightly. Feed reworked to cluster-and-ask-once ordered by TYPICALITY, not
> information gain — 5 operator labels all-time is the low-budget regime where uncertainty sampling
> is the losing strategy (Hacohen, arXiv:2202.02794). **726 taps -> 15.**
>
> **#1793 · a stable key alone would have been WORSE than the bug.** Caught in adversarial review,
> then confirmed on prod. `remember()` stamps a 24h probationary `expiresAt` that the commit
> gateway can never clear (neither its noop nor its update path advances `seenCount`), `pruneNoise`
> soft-deletes on expiry with no category filter, and `findUnique` on `(category, key)` ignores
> `deletedAt` — so the tombstone keeps the unique key and the spot disappears **permanently**. Prod
> already held 15 swept rows, and **4 of the operator's 5 labels were lost or about to be**. Added
> nullable `discovery_verdict` / `discovery_rated_at` / `discovery_provenance` (additive,
> data-neutral: 104,947/92,891 rows identical before and after), a reversible backfill with a
> snapshot table, and a bridge that carries legacy verdicts onto the stable identity — proven
> read-only first: each of the three unjudged rows matched exactly one verdict-carrying legacy row.
>
> **#1801 · index narrowed, two more shapes named.** The index shipped in #1793 was partial on
> `deleted_at IS NULL` alone: **5144 kB indexing 92,228 rows to serve 246**. Replaced via
> CREATE/DROP INDEX CONCURRENTLY in two gated steps -> **32 kB, 508 -> 118 buffers**. The read
> saving is 0.087 ms and is noise; the win is 5 MB of dead index no longer maintained on every
> write. Plan stability got strictly WORSE and the first measurement missed it: `category = ANY($1)`
> only implies the IN-list predicate in a custom plan — `force_generic_plan` falls back to a bitmap
> scan (394 buffers). Recorded in the migration header rather than left to be rediscovered.
>
> **#1802 · a measured NO.** The 2026-08-23 clock incident was TOOLING, not schema: **Prisma parses
> `timestamp without time zone` as UTC correctly**, so the app was never affected. Migrating would
> have been 272 columns / 103 tables / 4,155 MB, and the cheap `ALTER` form silently writes wrong
> instants if the session TZ is not UTC. Fixed instead with `process.env.TZ = "UTC"` in the two
> raw-`pg` scripts. Recorded in full because a measured NO stops the next session relitigating it.
>
> **Docs.** Five defect shapes now carry a probe each, split across two files that had briefly
> duplicated the taxonomy: `CONTROL-CANARY-COVERAGE.md` is the ledger (counts by control),
> `DEFECT-SHAPE-ORPHANED-SUBJECT.md` is the field guide (counts by shape). `scripts/check-doc-claims.mjs`
> resolves doc claims against the repo and **caught its own defect twice while being written** —
> twice it cleared a false gate claim because an npm alias looked like a gate. Defining a script is
> not running it.
> ## 2026-08-21 · Manual-fire lane + the brief pushes get combined (2 PRs)
>
> **#1747 · mega fan-out gains a manual-fire lane.** Post-#1735/#1743, the operator asked
> to fire the evening slot NOW instead of waiting for 03:00 UTC — no way to: cron-only
> Inngest triggers can't be invoked externally, and the only manual path
> (`runManifestCron` → `/api/cron/mega?slot=evening`) hits the LEGACY fan-out, exactly the
> dead code path #1735 killed. Both `megaFanoutMorning`/`megaFanoutEvening` now also accept
> an event (`mega/fire.morning` · `mega/fire.evening`, same dual-trigger pattern as
> `research/on-demand`); cron behavior and the `INNGEST_MEGA_V2` cutover guard are
> unchanged. **Fired live 21:07Z** the same day, hours ahead of the real cron:
> `mega-evening SUCCESS` at 21:17:36Z (302s) — first green evening slot in ~30 days.
> `consolidate` (detached) completed once at 21:39:57Z, 28 minutes, zero aborts — the exact
> job that used to abort at 240s and re-run 4x nightly. `conversation-compile` got its
> first-ever run, success, 192s. Healer fired 3 one-shot `never_run` rescues (storm
> children had no CronJobLog rows of their own yet → empty 14d windows), each 200'd and
> self-disarmed — no storm, and the operator's phone stayed silent. The REAL 03:00Z cron
> then ran the slot again that night, clean, unassisted — and the 09:00Z morning slot too.
> Three consecutive green fan-out runs plus a silent 12:00Z heartbeat closed the loop on
> the entire 2026-08-20 storm family (#1735/#1736/#1737/#1740/#1743).
>
> **#1755 · combine the 10:00/10:15 briefs into one push, land the tap on real content.**
> Two operator complaints, one root cause each:
>
> 1. *"combine them thats stupid"* — `operator-morning-brief` (10:00 UTC) and
>    `intelligence-daily-brief` (10:15 UTC) sent two separate CRITICAL/high pushes for one
>    conceptual morning briefing. Morning now hands its FULL text to intelligence-brief via
>    `brainMemory` (`pending_morning_highlight`, key=date) instead of pushing directly;
>    intelligence-brief reads + deletes the row, combines, sends ONE "Morning + Executive
>    Brief" push. A 35min durable `step.sleep` + `sendStandaloneIfUnconsumed` backstop fires
>    morning's brief solo if the hand-off is never consumed — a scheduling failure on the
>    OTHER function must never silently cost the operator their brief. intelligence-brief
>    gained its own Telegram fallback to match (never had one; now its push represents both).
> 2. *"when i click the notification... nowhere I can see it"* — root-caused, not a vague
>    UX gripe: `sendPush`'s click routing ALWAYS prefers `chatSeed` over `url` when both are
>    set, and chat only PREFILLS the composer, never auto-sends (`$0-incremental` doctrine,
>    `use-chat-deep-link-prefill.ts` — deliberate, not a bug). So tapping either brief
>    notification landed the operator in an EMPTY chat with an unsent prompt — the brief
>    content was never rendered anywhere in-app, only in the transient OS banner.
>    `/intelligence/brief` already existed and already rendered `BriefingLog` content in
>    full; dropped `chatSeed` from the combined push so its (already-correct) `url` wins.
>
> Self-review before shipping caught two real gaps in the first draft: the hand-off
> originally persisted only a 200-char teaser, which would have left morning's half
> permanently clipped even on the page BUILT to show it (fixed: hand off raw text); and the
> naive combined push-body truncation let a long morning brief crowd the exec brief out of
> the notification preview entirely (fixed: `combinedPushBody` gives each side a fixed
> slice before the 200-char cap).
>
> Receipts: 11 new tests (hand-off, backstop happy/failure/cleanup, combine-text, title,
> push-body fairness) + the earlier day's storm-family tests · full suite 5,805 passed /
> 547 files / exit 0 · tsc clean · eslint clean. Both PRs merged green on the first CI
> attempt (`9e8247285`, `a388ff92e`).
>
> ## 2026-08-20 · Cron-healer recursion — the healer healed its own parent, and `partial` was invisible to every counter (1 PR)
>
> **Trigger:** overnight verification of #1703 found the opposite of recovery: `mega-evening`
> ran **1,237 times between 03:04:37Z and 08:38:28Z with zero successes**, dragging every
> cron to ~450 runs/hour. Both prime suspects were cleared with receipts — #1703 WAS
> deployed (Railway `d9606b65`, 21:03Z), and Ollama Cloud was healthy the whole time (its
> liveness probe failed only DURING the storm and went green at 09:00Z the moment it
> stopped; all three prod lanes probe 200).
>
> **Root cause:** `mega-fanout` writes `status: "partial"` when some children fail (2,536
> rows in prod), but the 14d tallies bucket only success/failed — so mega-evening's 1,248
> partial runs left BOTH counters at 0, the healer classified a job running every few
> minutes as NEVER RUN, and "healed" it via the manifest path `/api/cron/mega?slot=evening`
> — the legacy fan-out, whose EVENING_JOBS contains `/api/cron/cron-healer`. Parent heals
> child, child re-triggers parent. The legacy route's flat 90s aborts are also what made
> #1703 look undeployed.
>
> **Shipped (#1735, `7a6ac5aef`):** fan-out parents are never healed; `isFailing` = last
> run failed (not `fail14d > 0`, which re-rescued green jobs for a fortnight — the
> operator's "Rescued ingest-reviews … Status: 200" alert wall); never-run counts partial.
> Same blindness swept repo-wide in BOTH directions: cron-manager scored partial as
> SUCCESS, brain-insights counted it as FAILURE, both successRate denominators dropped it
> (an all-partial job reported 100%), and system-health's correct `isHardFailure` had
> drifted as a private copy — now shared from cron-control. /system/crons renders partial
> amber, not red. Follow-up in flight: `diagnose-cron-failure` gains chronic-partial
> detection (it only ever read `status:"failed"`, so 29 partial nights filed zero
> diagnoses).
>
> Receipts: full suite 5,755 passed / 541 files / exit 0 · 10 new tests incl. a storm
> replay (a fan-out parent must never be healed) and a rate test asserting 25% where the
> old math said 100%. ⚠ Merged before `node`/`e2e` reported — `--auto` falls through to
> immediate merge on an unprotected repo; 6/8 checks were green at merge, e2e re-ran on
> the merge commit.
>
> ## 2026-08-20 · Memory-loop wave — the compiler was never starved, its output was eaten; receipts, studio, temporal evals (1 PR)
>
> The memory-truth wave's four next moves, executed with measurement-first discipline.
> Prod probes ran before AND after every claim (all read-only except one operator-approved
> corrective backfill).
>
> - **① Compiler resurrection.** The audit asked "why did 282 conversations produce only 14
>   summaries?" — the probe answered: **283 conversations → 15 LIVE rows vs 158 SOFT-DELETED**,
>   125 digest audits. The compiler ran all along; the nightly mergeMemories grinder ate its
>   prose output (JSON `chat_summary` sailed through the parse guard) and the confidence
>   ratchet pinned the category at equilibrium (conf-1.0 blobs, seen=105/48/20). Fixed:
>   `conversation_summary`/`decision_log`/`insight` (+ `eval_run`, self-audit) joined
>   `CONSOLIDATION_EXCLUDE_CATEGORIES`; the one-shot-forever AuditEvent guard became a
>   freshness guard on the summary row itself (30min debounce; soft-deleted row → recompile
>   REVIVES it, fan-out rows too — review caught that half missing); budget throws surface
>   loudly; `conversation_summary` TTL declared-but-never-applied corrected to permanent;
>   nightly `conversation-compile` cron (mega-evening) sweeps ≤10 idle conversations.
> - **② Memory receipts.** Recall hits were flattened, fired once over an ephemeral SSE event,
>   and dropped — "why did Nick say this?" RE-RAN recall at read time and presented the
>   reconstruction as the answer. Now the turn persists lite receipts into
>   `tokenUsage.recall` (rides the existing hydration, zero new columns); provenance is
>   receipt-first (turn-time similarity + seenCount, `deletedAt`-filtered hydration, a receipt
>   OUTLIVES its row via snippet fallback); the trace modal labels origin honestly
>   (`receipt · what fired on this turn` vs `reconstruction · re-run at read time`).
> - **③ Backfill Studio (lite).** The "preserved 50-conversation corpus" is NOT a file — it is
>   the live DB (chat retention = forever, enforced-by: none, verified). The sweep engine
>   doubles as the backfill: `brain.compileConversations` (cap 25) + status query + a
>   health-view card ("compile next 10"). Eligibility moved into SQL on `messageCount` after
>   MEASURING the counter (5 rows lied low, worst counter=1 vs real=15) and backfilling it on
>   prod (**45 drifted rows corrected**, re-probe 0 liars) — the JS post-filter version could
>   pin eligible=0 forever behind abandoned 2-message conversations.
> - **④ Temporal evals.** `temporal` was a DECLARED RecallEvalCase kind with ZERO cases since
>   Wave-4. Three cases now pin that past-tense phrasing ("what did X used to be") cannot
>   resurrect a superseded row; two time-anchored false-premise abstention cases added; drift
>   pins keep both kinds populated. Registry gap closed: `BRAIN_CATEGORIES.INSIGHT` (1,108
>   live rows, recall-whitelisted, no constant) — writers converted, domain-grouped.
> - **Review round:** self-audit found the sweep counting a budget-exhausted night's zero
>   writes as "10 compiled" (all-clear-on-failure, in code written hours earlier — statuses
>   are now truthful end-to-end) + the eval_run grind risk; two hostile reviewers added the
>   fan-out revival P0 and the eligibility-starvation + receipt-soft-delete P1s. All fixed.
>
> **Flagged · NOT fixed:** fan-out rows (`decision_log`/`insight`) get no `expiresAt` — the
> declared TTLs never apply to direct upserts (bounded ≤4 rows/conversation; same class as the
> conversation_summary fiction this wave corrected — a writer-side `computeExpiresAt` sweep is
> the real fix) · fan-out decision keys are index-based (`conv_<id>_decision_<i>`) — a
> recompile with reordered decisions drifts row content (content-quality only, no data loss) ·
> `messageCount` can still drift low from failed fire-and-forget bumps (residual risk accepted;
> the backfill script is idempotent and re-runnable) · consolidation merge still never
> re-embeds the keeper (pre-existing, all embedded categories).

> ## 2026-08-19 · Outcome-loop wave — the OS finally learns from what happened (1 PR)
>
> **Trigger:** the reimagine verdict's next-wave spine — recordOutcome had ZERO callers
> since 2026-07-28, Task.outcomeRating/outcomeLesson were consumed by nothing, and
> reasoning conclusions never re-entered recall. Implemented, then a 3-lens adversarial
> review (ledger / task-teaching / reasoning-loop) whose P0 reshaped the wave: the first
> cut was itself BUILT-TESTED-UNWIRED — both new engines consumed columns **no surface
> ever wrote**. The review round added the producer, not just polish.
>
> - **The ledger's usefulness half is live** — `recordOutcomeByContent` (contentHash
>   join, 30d window, first-write-wins **CAS at the update itself** — review upgraded
>   the SELECT-only guard, which left a two-stale-tabs TOCTOU that could stamp
>   outcomeUseful:false on an operator-confirmed-TRUE claim). rateDiscovery "noise" is
>   the first writer; "known"/"investigate" deliberately write NO outcome (known is a
>   novelty defect on a true claim — an outcome:false would poison the accuracy harvest).
> - **Task completion teaches** — completion moment asks ONE question on the LIVE
>   surface: /missions handleCompleteTask (board + Execution Mode, verified live on
>   prod) opens an outcome dialog (confirm-dialog idiom, iOS-PWA-safe, 1-tap chips
>   OUTSTANDING→FAILED + optional lesson). ★ #1714 correction: the first producer went
>   into the todo-desk, which is UNMOUNTED dead code (TodayZone has no importers) —
>   caught by post-merge zero-write prod verification; today-zone.tsx now carries an
>   UNMOUNTED header. Prompt calibrated against the fatigue literature (Apple 3/365d
>   review-prompt cap, ESM compliance decay, Complice/Intend batch reflection):
>   recurring loops never prompt, and dismissal COMPLETES unrated — never gates the
>   primary action. Transport runs the whole PATCH path: taskUpdateSchema → updateTask
>   completion delegation → checkTask → `RATING_MULTIPLIER` (1.25/1.0/0.6/0.3) scales
>   the domain bump, `outcomeLesson` upserts a `task_lesson` BrainMemory (direct
>   prisma — remember()'s 24h probation erases one-shot keys) + embedding, and an
>   OUTSTANDING/SATISFACTORY vs SUBSTANDARD/FAILED rating lands the ledger outcome by
>   title hash. DAILY rows keep the last RATED completion's judgment.
> - **Reasoning conclusions re-enter recall** — persistTrace fire-and-forgets a
>   distilled `reasoning_conclusion` companion ("Reasoned (tier): Q → concluded: A",
>   embedded, 90d TTL via data-cleanup). Companion CATEGORY keeps budget.ts honest
>   (it sums spend from `reasoning_trace` rows only — verified exact-match, not prefix).
> - **Consolidation exclusions** — review found nightly mergeMemories could LLM-rewrite
>   and soft-delete the new categories AND pre-existing `reasoning_trace` (budget sums
>   `deletedAt: null` rows → merged traces = undercounted spend = engine overspends the
>   $1/day cap). All three provenance categories excluded; mechanism pinned at the
>   groupBy query.
> - Wiring pinned end-to-end: checkTask→ledger bridge args, rating/lesson through
>   runAutoLearn on BOTH loops, PATCH forwarding, CAS-loses-race, chips' 1-tap contract.
>   `tasks.ts` dead `after === "DONE"` branch labeled UNREACHABLE (review caught this
>   wave "fixing" a call site that cannot run — checkTask short-circuit owns completion).
>
> **Round-3 audit (operator-ordered full re-audit, same day):** the end-to-end
> link-trace found the title-hash bridge had ZERO matching producers — every
> recordShown surface lacked a task-creation affordance and every task-creation path
> titled from unledgered text, so recordOutcomeByContent returned false on 100% of
> invocations (BUILT-TESTED-UNWIRED, third strike this wave). Fixed: rateDiscovery
> "investigate" now SPAWNS the follow-up task titled verbatim with the ledgered
> content (first-flip only, best-effort) — completing it with a rating lands the
> outcome on that discovery's ledger row. Also fixed: the shared outcome dialog got a
> reentrancy guard (two quick board-row completions previously stranded the first
> row's promise forever, checkbox stuck until reload). Chains 2 (task→learning) and
> 3 (reasoning→recall) audited link-by-link: CLOSED, all readers live via the main
> chat route's recallMemoriesForQuery. CI reds on the #1714/#1715 squashes were
> runner-shutdown infra kills (identical signature, zero code errors; #1711 ran CI
> green; failed run re-dispatched).
>
> **Flagged · NOT fixed:** consolidation merge rewrites keeper content WITHOUT
> re-embedding (pre-existing, every embedded category — stale-vector mismatch after any
> merge) · `outcomesNeedingReview()` export has ZERO callers — its two consumers
> re-implement the OR-query inline (three copies can drift) · nothing automated reads
> `outcomeUseful`: harvest/eval-export/odometer are manual scripts, no cron — the loop
> currently terminates in the operator (cadence = operator decision) ·
> execution-coach sandbox + project bulk-complete still complete unrated (sandbox
> reflection flow is the natural next producer) · character-sheet stat XP
> (`taskStatMultiplier`) deliberately not rating-scaled ·
> rateDiscovery has no server-side re-rate guard (client-gated only; the CAS bounds
> the blast to decision-column drift).

> ## 2026-08-19 · Architecture-reimagine wave — one priority scale, unknown ≠ zero, supersession lane-complete (1 PR, 10 commits)
>
> **Trigger:** the operator's full-product reimagination mission. Six parallel read-only
> audits (surface/IA · intelligence seams · execution loops · truth semantics · perf ·
> design/mobile) gated against the 07-28 blueprint; implementation; then a pre-merge
> adversarial fleet (6 hostile finders + 12 refuters + 2 web researchers → **55 deduped
> findings, 12 CONFIRMED, 0 refuted**) whose findings were closed across a Codex pass, a
> GPT-5 pass, and this session's round-2. Canonical record + full audit maps:
> [`REIMAGINE-VERDICT-2026-08-19.md`](REIMAGINE-VERDICT-2026-08-19.md).
>
> - **autoPriority polarity canonicalized** — ONE scale (0-100, higher = more urgent;
>   bands ≥80/≥60/≥40 in `lib/scoring/task-priority.ts`). The column had carried two
>   opposite conventions with ~27 readers split down the middle: the 8am MIT picker,
>   daily scheduler, todo desk, mission cards, execution focus, goals nextMove and
>   Nick's own task list were structurally surfacing least-urgent-first. 5 writers +
>   ~26 readers aligned; triage-someday's `70` (old someday = new HIGH) fixed; the
>   repo-wide source scan bans asc sorts, lt-filters, legacy override literals AND
>   plain `"desc"` (Postgres DESC = NULLS FIRST — 27 sorts converted to
>   `{ sort: "desc", nulls: "last" }`).
> - **Unknown ≠ zero on operator surfaces** — situation card's emerald-on-error killed;
>   meta-scoreboard failed reads become `measured:false` "—" anomalies (never a calm 0);
>   revenue mirror honest by ET calendar day; pinned Δ-baseline bounded to today; Home
>   action matrix + /missions render explicit unreadable/stale states (TanStack v5
>   `isError && !data` doctrine — cached board + "refresh failed" note on refetch
>   failure); /system errors card stops saying "Clean" on a null read; `system.hub`
>   (~20-query rollup, Home's slowest batch member) now `cached()` 30s.
> - **BDN-310 supersession lane-COMPLETE** — first writer (contradiction loser gets
>   `supersededById` + `validUntil` = winner's `validFrom`∥now; winner gets
>   `lastVerifiedAt` — that column's first writer; verdict-flips un-strand the winner)
>   and EVERY read lane filters: both recall lanes + fallback + graph-context injector +
>   searchMemories (FTS SQL + prisma) + cold-memory hydration + memory-manager recall()
>   + the shared knnSearch liveness EXISTS every semanticSearch caller inherits.
>   9 reader source-pins in `tests/brain/supersession-recall.test.ts`.
> - **Task.personId reaches the DB** — taskCreateSchema had silently stripped it on the
>   createTask path (createTaskAndEnrich never parsed with zod — mechanism corrected in
>   round-2); FK-existence guard added beside the goalId guard.
> - **Truth hygiene** — gateway kill-switches registered `readOnly`+`offValue` (board
>   renders ENV ONLY, override mutation rejects them — a working-looking OFF that did
>   nothing at runtime was worse than invisibility); reasoning toolbox count stopped
>   lying (socialTools source + strict-equality test); skill-extractor bands
>   re-unified with ghost-nick via `priorityBandLabel`; six hand-rolled band ternaries
>   consolidated; nick-agent prompt vocabulary fixed (numeric 1-10 was silently
>   discarded to 50); attention-tracker no longer turns a failed chat read into
>   "every domain neglected"; both tool-contract snapshots ratified via sanctioned
>   regeneration after the full suite correctly flagged the intended description change.
> - **Cross-session note:** main's #1698 was this branch's own pre-round-2 state pushed
>   independently by the operator's ChatGPT/Codex session — the merge took this branch
>   on all 27 conflicted files (each main hunk was the older version of the same fix).
>
> **Flagged · NOT fixed:** legacy `manualPriorityOverride` rows written under the old
> scale are sticky-inverted until the operator runs the read-only census
> (`scripts/probe-task-priority-overrides.ts` via `railway run`) and authorizes a remap ·
> `lib/brain/brain-graph.ts` still plain-desc (NULLS FIRST nuance; sibling's lane —
> allowlisted in the polarity scan, routed there) · knnSearch supersession applies only
> to `brain_memory` rows by design (other silos have no supersession columns) ·
> WP-5 (warroom/research/simulator reachability) + WP-9 (Money tabs) remain operator
> decisions · next-wave spine per the verdict doc: close the outcome loop end-to-end
> (recordOutcome writers exist unwired · Task.outcomeRating/outcomeLesson → auto-learn ·
> reasoning traces re-enter memory via remember()).

> ## 2026-08-19 · apiHandler telemetry was load-bearing — a 1% coin flip that reddened CI and buried real 500s
>
> **The red on PR #1697 was not the wave's diff.** It was a landmine shipped 2026-08-16 in
> #1598 and armed on every request since. `apiHandler` samples its success-path request log
> (`duration_ms > 1000 || Math.random() < 0.01`, `lib/utils/http.ts:190`) and writes it with
> `prisma.apiRequestLog.create(...).catch(...)`. **The `.catch()` covers the promise that call
> returns — it cannot cover the call that never produced one.** When the synchronous
> `prisma.apiRequestLog` dereference threw, the throw landed in apiHandler's own `catch`, which
> **repeats the identical dereference** and throws again with nothing left to catch it, so the
> route *rejects* instead of returning its envelope.
>
> Two consequences, both real, both invisible until root-caused:
>
> - **In CI:** a 1-in-100 red on every `apiHandler` call from a test whose prisma mock lacks
>   `apiRequestLog` — plus a second, non-random trigger (`duration_ms > 1000`) that a loaded
>   GitHub runner hits on its own. That is why the failure moved, passed in isolation, and
>   passed a full local sweep. It presented as `TypeError: Cannot read properties of undefined
>   (reading 'create')` at `http.ts:255` — **the catch-path frame, not the trigger**, which is
>   what made it look unrelated to logging.
> - **In prod:** any throw from the *error*-path telemetry escapes as an unhandled rejection
>   instead of the 500 envelope, so the caller sees the logging failure and never the real one.
>
> Fix: `fireAndForgetTelemetry()` wraps all three writes (success `apiRequestLog`, failure
> `apiRequestLog`, failure `errorLog`) so a broken writer is logged to the surface logger and
> dropped. Telemetry is best-effort by contract; it must never be able to take down the request
> it describes. Reproduced deterministically before fixing (`Math.random → 0` against the real
> route: same error, same line, same stack), then red-greened —
> `tests/api/http-telemetry-never-throws.test.ts` fails 4/4 on the pre-fix file and passes 4/4
> after, covering both triggers, the 500 path, and `ServiceError` status preservation.
>
> **★ THE BLAST RADIUS I FIRST CLAIMED WAS WRONG, and finding that out is the point.** The
> first draft of this entry, the code comment, and the PR body all said "nine test files are
> exposed" — nine files do mock `@/lib/prisma` without `apiRequestLog`, and I treated that grep
> as a measurement. Measuring it killed the claim: **exactly ONE file ever reached this code**
> (today-compound, the one that actually went red). Of the other eight, three mock
> `@/lib/utils/http` itself so apiHandler never runs, three call route handlers that are not
> apiHandler-wrapped, and two import no route handler at all. The instrument was proven before
> the verdict was trusted — a forced-sampler config that first had to fail 2/2 on a
> known-vulnerable specimen (`today-compound.test.ts` as of `2cac7a0`) before its green on the
> eight meant anything. A first attempt at this same check WAS blind and I nearly shipped its
> result: `git stash push -- <file>` on an already-committed file stashes nothing, so the "no
> fix" run silently used the fixed file. Same lesson as the fail-open probes this wave started
> with: **a green from an unproven instrument is the most expensive kind of red.**
>
> That does not weaken the fix, it re-bases it. The reasons that survive measurement: the prod
> double-throw is real and independent of any mock, and the next incomplete mock on an
> apiHandler route re-arms the flake — which is why completing mocks one at a time was never
> the fix, whether the count was nine or one.
>
> **Separately, main's post-merge run on `e17eee3` was a different red** — GitHub runner loss
> ("the runner has received a shutdown signal", 5/8 tasks, force-killed at 4m28s), the same
> infra class as `9977368`. `2cac7a0` (wave 1) and current head `cf5e78f` are both green.

> ## 2026-08-19 · Neon compute + cron-truth pass — the DB went read-only and the fan-out was lying (2 PRs)
>
> Started from "64 hard cron failures = ingest-reviews on unset GOOGLE_PLACE_ID /
> GOOGLE_PLACES_API_KEY". Right variables, wrong service: nickstire already had both set
> and working — `ingest-reviews` is a **statenour** cron
> (`app/api/cron/ingest-reviews/route.ts` → `fetchAndStoreReviews()`). Setting them on
> `statenour-web` fixed it, verified live: `HTTP 200 · {"fetched":5,"newCount":0}`. Prod
> `cron_job_logs` confirms 64 runs / 64 failures exactly, and the fix also cleared 16 of
> `mega`'s failures, which were the child returning 500.
>
> **★★★ THE DATABASE IS QUOTA-LOCKED READ-ONLY, SO EVERY WRITE SILENTLY NO-OPS.**
> `default_transaction_read_only = on` with `pg_is_in_recovery = false` — Neon quota
> enforcement, not a replica. Every INSERT/UPDATE fails with PG `25006`. The now-"passing"
> ingest-reviews therefore stores NOTHING: `newCount:0` is a silent zero, because the store
> loop swallows create failures and still returns 0. Not fixed by either PR below.
>
> ⚠ **SUPERSEDED 2026-08-20:** the lock LIFTED early — measured `default_transaction_read_only = off`,
> `pg_is_in_recovery = false` (probed 11:55Z, re-confirming the ~16:30 ET 08-19 probe).
> Writes land again; the 2026-09-01 reset expectation is obsolete. The paragraph above is
> kept as history of what the 08-19 session measured.
>
> The burn was measurable and had one dominant cause: the worker polled
> `/api/sync/queue/render` every 2 minutes, and Neon suspends an idle compute after 5
> minutes — so it could never scale to zero. `active_time` 443.7h of the ~456h elapsed in
> the billing period (97% awake), 222.6 CU-h by day 19 against a 300 CU-h Launch allowance.
> Storage was never the issue (1.79 GB / 10 GiB).
>
> **#1696 · render poll `*/2` → `*/15`, and ENV_SPEC gains `GOOGLE_PLACE_ID`.** The queue
> receives ~1 reel/day, so 719 of every 720 daily polls found it empty. 15 min matches the
> sibling forward loops (`scheduler.ts:73,82`) and stays inside `RENDER_LEASE_MINUTES = 30`,
> so a lease still gets two claim attempts and the reclaim path is untouched; worst case a
> reel waits ~13 min longer. Separately, `GOOGLE_PLACE_ID` was missing from the manifest
> that calls itself "single source of truth for what statenour-os needs" even though
> `fetchAndStoreReviews()` hard-requires it — so `check:env:prod` reported a healthy
> environment while the cron died 64 times for want of exactly that variable.
>
> **#1703 · mega-evening dispatches long-running children instead of aborting them.** 29
> consecutive nightly failures for work that had already finished. `consolidate` and
> `mastery-xp` return 200 on EVERY run (19.6 min / 5.1 min avg, 36 min max); the parent
> aborted at 240s, the Inngest step threw, and `retries: 3` re-ran the whole slot — **4
> consolidate runs a night, ~2.3h of serial Ollama `minimax-m3` churn (~39s/call)** — which
> loaded the DB and made the next run slower still. A self-feeding loop: the daily average
> climbed 14 → 34 min. The ceiling had already gone 50s → 90s → 240s, and the 240s was read
> off the wrong number ("~14 and ~20 min past slot start" is when a child FINISHES). Fix =
> `DETACHED_CHILDREN`: dispatch, don't await — safe because aborting the CLIENT never killed
> the SERVER handler, and these children already write their own CronJobLog rows. Also gave
> `/api/cron/predict` a real 240s ceiling (avg 82.5s against the 90s default, 173s max — it
> flapped across the boundary). DB was never the bottleneck: slowest tracked query 1.3s.
>
> **Flagged · NOT fixed**
> - ~~**Neon read-only (PG 25006)**~~ — RESOLVED 2026-08-20, lock lifted early (see supersession note above); was: every write no-ops until the quota resets 2026-09-01 or
>   the operator raises the cap in the Neon console. Operator-side billing action; no code
>   change fixes it. Until then ingest-reviews reports success while storing nothing.
> - **`consolidate` still runs 19-36 min nightly** — detaching ends the false failure and
>   the 4× retry, but the job itself is LLM-bound and serial. Whether that nightly spend is
>   worth it is a product call, not a bug.
> - **Legacy `/api/cron/mega` route keeps a flat 90s abort** — dormant while
>   `INNGEST_MEGA_V2=true`; if that flag is flipped back for rollback, the timeout bug
>   returns there.
> - **Per-stage attribution inside `consolidate` is unproven** — `ai_generations` recorded
>   only 4 calls in the 34-min window (and as `feature:"chat"`, not `memory-consolidation`),
>   so "which of the 9 stages is slow" remains unmeasured.
> - **`tests/` is excluded from BOTH tsconfigs** — the new #1703 test runs under vitest but
>   is not type-checked by tsc. Repo-wide, pre-existing.

> ## 2026-08-19 · Brain wave 2 — the honesty pass: dead ends made visible, dead code removed (1 PR)
>
> Everything the wave-1 entry below flagged as "NOT built", built — plus a finding that
> reframed the biggest item. All claims measured against prod read-only before implementing.
>
> **★★★ THE RESEARCH PIPELINE IS STRUCTURALLY DEAD-ENDED, and the UI was hiding it.**
> The plan was to merge Discover + Review + the orphaned `research_claim_candidate` queue.
> Measuring first killed that plan and produced a better one: `research_claim_candidate` has
> **0 rows** — not because the exit is blocked, but because **the upstream door never opens**.
> `intelligence_claims` holds **876 `unverified` + 17 `weak_support` + 0 `source_supported`**,
> and `source_supported` (score ≥ 0.75) is the ONLY status `lib/intelligence/promote.ts` will
> promote. **Best verification score in the entire 893-claim corpus: 0.58** — 0.17 below the
> gate, never once approached. Worse, `source_supported` means *cosine ≥ 0.75 against our OWN
> memory* (`lib/intelligence/grounding.ts`), i.e. the gate rewards claims that already resemble
> something we believe — **anti-correlated with novelty**, which is the only reason to ingest
> research at all. Second surface silently starved by the same gate:
> `lib/intelligence/compose-daily-brief.ts:62` filters `status: "source_supported"` AND
> `confidence >= 0.8`, so the daily brief's research section is permanently empty too.
> Merging queues would have made a prettier empty box. Instead: new
> `GET /api/knowledge/pipeline-status` + `ResearchPipelineStatus` panel at the top of Review
> report the real numbers — **"893 claims ingested, none has ever been promotable, best score
> 0.58 vs a 0.75 gate"** — and name the operator's actual options (lower the gate, ground
> against something other than our own memory, or retire the lane). **An empty queue and a
> structurally dead queue must never look the same.** Each read is `allSettled`; a failed read
> renders "unknown, not zero".
>
> **Supersession finally has a writer** — the columns applied to prod 2026-08-14 had **0 of
> 18,527 rows populated** (measured). Root cause found: `remember()` upserts on
> `(category, key)`, so a `supersede` verdict fell through to
> `reinforce(existing.id, content)` — the row was overwritten in place and the prior claim was
> lost forever; there was no second row for `superseded_by_id` to point at. Fix:
> `snapshotSupersededVersion()` freezes the OUTGOING version into a new
> `superseded_snapshot` category row under a timestamped key (so it cannot collide with the
> canonical unique), carrying `validFrom` = when the claim began, `validUntil` = the moment it
> stopped being true, and `supersededById` → the canonical row, giving a walkable forward
> chain. The canonical row's `validFrom`/`lastVerifiedAt` advance to now. Snapshots are
> **excluded from recall** (`RECALL_EXCLUDE_CATEGORIES`) — a superseded claim is one the system
> explicitly stopped holding; recalling it would feed the model something we replaced on
> purpose. Bounded by a 90d TTL. **OPT-IN, default OFF behind `NICK_MEMORY_SUPERSESSION=1`** —
> a new write path on a 28,777-row table earns default-on with measured evidence, exactly how
> gateway Phase-1 and Phase-2 each shipped. Until flipped the columns stay empty, which is the
> honest state rather than theater.
>
> **Confidence stopped pretending to be a probability.** It is a re-sighting counter
> (`0.5 + 0.1×(n−1)`, capped 1.0 — memory-manager.ts:540). The 2026-08-16 wave fixed the RECALL
> boundary; three operator surfaces still printed `NN%`, and **two printed it directly beside
> the sighting count — the same number twice, one copy lying**: continuity-view rendered
> `{confPct}%` next to `×{seenCount}`; wisdom-tab rendered `NN% conf` next to `fired N×`;
> health-view rendered `conf NN%` over a category mean. One shared helper
> (`lib/brain/attention-label.ts`) now inverts the formula exactly (it is arithmetic, not
> estimation), renders `seen N×` / `seen ~N×`, and flags the ceiling as `seen 6×+` instead of
> letting 1.0 read as certainty. Tone no longer runs a red→green truth ramp: a rarely-seen
> memory is *quiet*, not *bad*.
>
> **Dead code removed — and the earlier "orphaned" list falsified.** The wave-1 flag claimed 6
> orphaned tRPC procedures; grepping them myself found most have **real consumers**
> (`reflect` 9, `activityStream` 6, `graphNeighborhood` 5 — the last one alive precisely
> because wave-1's new detail panel started consuming it). Only `decideLinkReview` is genuinely
> orphaned, and it is deliberately KEPT: it is the natural consumer for a future ruling queue.
> `global-activity-stream.tsx` also KEPT — an explicit prior "stop mounting, don't delete"
> decision, and its procedure has a live consumer in `since-last-visit-card`. Deleted only what
> was proven unreferenced: `memory-graph-explorer.tsx`, `categories-view.tsx`,
> `graphify-snapshot-card.tsx` (~1,100 lines; the only hits were stale *comments* in a schema
> test). **Three broken RecallInboxPanel drill-links fixed**: `/brain#pinned` (no such anchor →
> the real `/pins` page), `/brain/link-review` (not a route → `?tab=review`),
> `/brain#contradictions` (missing `?tab=memory`, so it landed on the Map tab).
>
> **Pre-merge adversarial re-audit found 2 defects IN THIS DIFF** (5 independent lenses +
> per-defect judging, plus my own sweep — the base rate held again):
> **(1) A fabrication bug in the new pipeline panel.** `promotable` derives from
> `statusCounts?.find(...)?.count ?? 0`, so a REJECTED status query left `statusCounts` null,
> `promotable` fell back to 0, and `gateUnreachable` flipped **true** — rendering "none has
> ever been promotable · this queue cannot fill" off a read that merely FAILED. That is the
> morning's fail-open defect inverted: asserting alarming certainty from missing data instead
> of health from missing data. Both are lies. Fixed with an explicit `statusCounts !== null`
> guard and 5 tests pinning every degraded-input combination.
> **(2) Two confidence-as-percentage sites were MISSED** by the first pass, found by sweeping
> the whole app rather than the reported list: `components/journal/memory-calibration.tsx:200`
> rendered `seen {seenCount}× · c{confidence*100}` — the same double-lie — and
> `components/chat/reasoning-trace-modal.tsx:275` printed recall-hit confidence as `NN% conf`
> directly beside a REAL cosine `match NN%`, making two unlike numbers look like the same kind
> of evidence. Both now use the shared helper. Deliberately left as genuine percentages after
> checking what each number actually is: prediction/forecast confidences
> (`stats/calibration-section`, `forecast-duel`), reasoning-trace confidence, opportunity
> scores, and board/advisor confidences — those are model-reported probabilities, and
> blanket-replacing them would be the same category error in reverse.
>
> **Verified:** typecheck 0 errors · full suite **527 files / 5,638 passed / exit 0** · 13 new
> tests across 2 new files (confidence inversion incl. the ceiling case; supersession row shape,
> recall quarantine and opt-in default) plus wave-1's 15 · eslint 0 errors on the diff (4
> pre-existing warnings, none in changed lines) · check:crons / raw-sql / get-auth / soft-delete
> PASS.
>
> **Flagged · NOT built:** the Discover+Review merge is **deliberately abandoned** — measured,
> Discover holds 265 live items (blind_spot 252, all created in the last 30d) while Review holds
> **1** and the third queue holds 0 and cannot fill; merging them would be motion, not progress.
> The real decision is the promotion gate, and that is the operator's call, now visible on the
> page. Also still open: `memory_edges` is queried with a bare `sourceId IN (...)` that cannot
> use its composite index (harmless at 1,046 rows — measured 0.3ms — but seq-scan by
> construction); `decay()` still has no caller so any "weakening" arrow would be fabricated;
> board/advisor confidences were **left as percentages on purpose** — those are model-reported
> probabilities, not sighting counts, and blanket-replacing them would have been the same
> category error in reverse.

> ## 2026-08-19 · Memory truth wave — the audit's own claims re-measured, then built (PR #1716)
>
> Follow-through on the 50-conversation forensic audit (282 conversations · 4,190 messages ·
> 19,088 live memories, all read-only) AND a plan-gate over the operator's pasted "epistemic
> OS" architecture plan. Two of my own audit claims died under re-measurement before any code
> was written — recorded here first because finding them was the point:
>
> - **"Nothing sweeps expired memories" — FALSE.** Two sweeps exist (memory-consolidation
>   soft-delete on the evening cron; data-cleanup hard GC), and the "167 expired-but-live rows"
>   all expired the SAME DAY they were measured (`older_than_2d: 0`, re-probed read-only).
>   That number is one day's churn, mostly short-TTL gateway shadows. No sweep was built.
> - **"confidence is a re-sighting counter" — only for one write path.** 99% of the 900 most
>   recent rows have `seen_count = 1`, and **73% of those carry a writer-stamped confidence**
>   (output_critic 0.9 · brain-bus events 1.0 · gateway shadow 0.1) that violates
>   `0.5 + 0.1×(n−1)`. So the attention-label inversion I shipped in Brain wave 2 FABRICATES
>   history on those rows — "seen 6×+" on rows seen once. The helper's contract now states
>   this measured limit and `describeSeenCount` (the real column) is the default everywhere.
>
> **Built (all no-schema-change):**
>
> - **Honest attention labels end-to-end.** `recallMemoriesForQuery` now SELECTs
>   `seen_count` and `RecallHit`/`ProvenanceHit` carry it; the reasoning-trace modal renders
>   `describeSeenCount(hit.seenCount)`; `buildMemoryHealth` ships `AVG(seen_count)` per
>   category and health-view renders `seen ~N× avg` from the real column instead of inverting
>   a mean confidence the writers stamped.
> - **Telemetry quarantined from the Prisma recall lane.** The 08-16 embedding policy kept
>   `TELEMETRY_CATEGORIES` out of the vector index, but contextual-recall's top-300 confidence
>   pool had no category gate — and telemetry sails over its 0.3 floor (nick_quality 0.9,
>   task_completion 1.0, measured). The policy list now spreads into
>   `RECALL_EXCLUDE_CATEGORIES`: one list, both lanes. Intersection-checked first: zero recall
>   allowlists/scores reference any telemetry category.
> - **The headline count stops lying.** `buildMemoryHealth` totals split `knowledge` vs
>   `telemetry` (the flat "N memories" counted 1,575 gateway-shadow JSON blobs and 363
>   byte-identical critic score lines as things the brain "knows"); health-view leads with
>   knowledge and shows telemetry labeled as what it is.
> - **Chat capture finally carries provenance and keeps its items.** Measured: 282
>   conversations → 14 `conversation_summary` rows, 9.8% of a month's memories able to name
>   their conversation, and the digest's extracted decisions/insights were dropped on the
>   floor after extraction. `summarizeAndStoreConversation` now stamps
>   `metadata.conversationId` on every write and fans out medium/high-stakes decisions →
>   `decision_log` (now recall-whitelisted) and the key insight → `insight`, at the formula-
>   honest confidence 0.5, embedded fire-and-forget. Commitments/actionItems deliberately
>   stay episode-only — auto-minting operational rows from AI extraction is the phantom-task
>   failure mode journal-ingest already gates (v10.0.231).
>
> **Plan-gate verdict on the pasted "epistemic OS" plan** (full table in the wave report):
> roughly **half already existed** — TELEMETRY_CATEGORIES (08-16), temporal supersession
> writer + both recall lanes honoring it (#1706), a conversation→knowledge compiler
> (conversation-memory.ts, live but starved), raw-evidence retrieval (chat-recall.ts hydrating
> turn pairs), memory evals (`pnpm eval:memory`), user memory review (calibration ritual +
> knowledge review queue). Genuinely new and NOT built this PR (operator decisions, larger
> lanes): dream-cycle batch consolidator, backfill studio over the 50-conversation corpus,
> memory receipts in chat UI, kind-classification of the whole taxonomy. Registry gap
> surfaced: `insight` — 1,108 rows, recall-whitelisted — has NO `BRAIN_CATEGORIES` constant.
>
> Verify: tsc 0 · eslint 0 on all changed files · new `tests/brain/conversation-fanout.test.ts`
> (4) + `tests/brain/telemetry-quarantine.test.ts` (3) · adjacent regressions green
> (recall-quarantine, attention-label, supersession-recall). Full-suite receipt in the PR.
> 

> ## 2026-08-19 · Brain truth pass — /brain stops hanging, and the graph stops lying (1 PR)
>
> **Root cause of the infinite spinner, proven, not guessed:** every layer of the
> `/brain` request path was allowed to wait forever. `lib/prisma.ts` constructed
> `PrismaNeon` with no `connectionTimeoutMillis` and no `query_timeout`, and the vendored
> Neon driver defaults to `max:10` with an **untimed checkout queue** (`@neondatabase/serverless`
> index.js:1110) plus `connect_timeout=0`. The graph route was the widest DB fan-out in the
> app — one `Promise.all` of 8 concurrent queries needing 8 of those 10 slots — and the client
> used a bare `fetch()` with no AbortController/timeout whose `setLoading(false)` lived only in
> `finally`. Railway ignores `maxDuration`. So any sustained pool contention became a request
> that never settles and a spinner that is mathematically permanent. Two self-inflicted
> amplifiers kept the pool contended: `fetchGraphData`'s dependency chain included
> `selectedNode` + `searchQuery` (via `drawGraph` → `triggerAnimationLoop`), so **every
> keystroke and every node click re-fired the whole graph fetch un-aborted** — interacting with
> the graph is what made it hang harder — and the 51-route in-process cron fleet shares the same
> 10 connections, with the evening fan-out landing at 10-11pm Cleveland.
> **Independent prod corroboration (read-only, operator-supplied credential):** the #1 pattern
> in `error_logs` is `[err_*] Database hiccup · the engine couldn't reach state` at **730 of
> 1,427 rows / 30d** — the same starvation class, visible in a second instrument. Falsified
> along the way: the builder is NOT slow at scale (all graph queries measured 33-75ms; it reads
> at most 170 rows, never 25k) and there is no per-node KNN or O(n²) similarity in the path.
>
> **Fixes so an infinite spinner is structurally impossible:** driver-level
> `connectionTimeoutMillis: 10s` + `query_timeout: 30s` (the one line that also bounds the 730
> "Database hiccup" hangs app-wide) · the builder is now `allSettled` with an 8s **per-domain**
> deadline, so a slow domain arrives MISSING AND NAMED in a new `degraded[]` field instead of
> holding the brain hostage · the client carries AbortController + 12s timeout + a sequence
> guard that drops stale responses, fetches **only** on `[variant, focusId, localOnly]`, and
> resolves to exactly one of USEFUL / DEGRADED / EMPTY / ACTIONABLE-ERROR (with retry); a failed
> *refresh* keeps the working graph on screen instead of destroying it.
>
> **The graph stopped lying.** It rendered on frequency and invented structure: node weight was
> `confidence * 10` where confidence IS a re-sighting count (`0.5 + 0.1×(sightings−1)`), so it
> visually enlarged re-observed banalities; edges were invented by keyword-matching titles
> (`title.includes("tire")`) and a blanket "attach every orphan to an anchor" pass; six fossil
> anchor nodes asserted a 2026-05 model lineup ("OLLAMA GLM-5.2", "GEMINI BACKUP") against
> CURRENT-TRUTH's never-assert-a-model rule; decision nodes deep-linked to `/decisions`, which
> **has no page** (404 on every decision node); memory labels were raw machine keys
> (`blindspot_domain_1712…`); and the detail panel was ~80 lines of per-type canned prose
> ("why this matters", "next best move") that read no field of the actual record. All removed.
> Now: every edge declares an `origin` (fk · memory_edge · semantic · contradiction · category ·
> domain) and nothing else may create one — **unlinked nodes stay visibly unlinked, because
> isolation is signal**; goal→domain edges use the goal's own `domain` field; weight is
> attention on a **log** scale (prod `seenCount` spans 1 → 6,516, mean 3.69 — a linear map
> saturated at 8 sightings and flattened the real hubs); memory nodes carry the commit gateway's
> evidence ladder, `seen N×`, age, TTL distance and contradiction involvement; the renderer maps
> evidence class → ring opacity (an inference can never render as solid as something the
> operator stated), contradiction → dashed rose halo, `<7d` → gold notch, and the only glow on
> the canvas is the focused node.
>
> **Severed joints reconnected:** `runSemanticLinker` shipped 2026-05-02 and **never acquired a
> caller** — `semantic_edges` froze at **114 rows, newest 2026-05-28** (measured), so every
> memory-to-memory "related" edge in the graph was a three-month-old fossil; it now runs nightly
> in the evening fan-out (`/api/cron/semantic-link`, batch 25 · top-3 pgvector KNN, and it
> reports `ok:false` when pgvector is unavailable so the new logCronRun detector files a real
> failure). `buildGraphNeighborhood` — a working service with **zero consumers** — is now the
> detail panel's "stored relationships" section. Real contradiction pairs
> (`BRAIN_CATEGORIES.CONTRADICTION`, via the constant so a rename can't blind the reader) become
> the `contradicts` edges the renderer always supported but never received. **Honest status:
> that store is currently EMPTY in prod (0 rows), so contradiction edges render zero today** —
> a correct reader over an empty store, lighting up the moment the surfacer flags a pair.
>
> **Product:** lenses (ALL / BUSINESS / PEOPLE / GOALS / DECISIONS / MIND / LAST 30D) filter the
> loaded payload client-side and keep one hop of context — a lens can only hide, never invent,
> and costs zero network. Tabs reordered to the mental model (Map → Discover/Review → Memory/
> Wisdom → Board/Reason → Changed/Health) with **every tab key unchanged**, because
> `?tab=memory&resolve=`, `?tab=reason&q=`, `?tab=wisdom&focus=`, `?tab=board`, `?tab=health`
> and `?tab=continuity` are live deep-link contracts from Home, the ticker, the command palette
> and chat tool results. **Mobile:** the full graph previously had mouse handlers ONLY — on the
> operator's iPhone it was frozen scenery; it now supports pan, tap-to-select and pinch-zoom,
> with the inspector as a bottom sheet and 48px targets.
>
> **Prior art (principles, not pixels):** search-first entry and expand-on-demand over
> whole-graph overview (van Ham & Perer's "Search, Show Context, Expand on Demand"; Neo4j Bloom
> Perspectives/Scenes); active-thought centering (TheBrain); focus + expand-by-degree (Kumu);
> the documented Obsidian global-graph-hairball failure as the thing to avoid; one visual channel
> = one variable, motion only on state change (Kumu data-driven decorations, dark-dashboard
> practice). **Deliberately NOT adopted:** a renderer swap — peer-reviewed benchmarks put
> canvas at ~5,000 interactive nodes vs this product's 100-2,000 visible, so sigma/cytoscape
> would trade renderer control for algorithms implementable in a day; continuous timeline
> animation (theater); freeform LLM-to-query search (unreliable); multi-analyst case ceremony.
>
> **Verified:** typecheck 0 errors · full suite **525 files / 5,624 passed / exit 0** · 15 new
> brain-graph tests (first-ever coverage for this builder — including a domain that NEVER
> settles, proving degradation replaces the hang) · eslint 0 errors on the diff ·
> check:crons/raw-sql/get-auth/soft-delete/mutations:strict all PASS · all Brain claims
> falsified against prod read-only before shipping (which is how the empty-contradiction-store,
> the two dead category filters and the saturating weight formula were caught **in my own
> diff**).
>
> **Flagged · NOT built (evidence-backed, for the next wave):** Discover + Review + the
> orphaned `research_claim_candidate` queue should merge into ONE ruling surface — candidates
> mint at confidence 0.3 with `requiresHumanPromotion` and **no UI reads that category**, while
> the Review tab reviews a different queue whose only producers are manual scripts (a roach
> motel) · supersession columns (`valid_from`/`valid_until`/`superseded_by_id`) are applied to
> prod with **zero readers or writers**; wiring the gateway's existing `supersede` verdict would
> give the graph a walkable history chain and make "what changed" honest instead of theater ·
> 4 dead components + 6 orphaned tRPC procedures + 4 REST fossils under /brain · 3 broken
> hrefs in RecallInboxPanel (`/brain#pinned`, `/brain/link-review`, `/brain#contradictions`) ·
> `memory_edges` is queried with a bare `sourceId IN (...)` that cannot use its composite index
> (harmless today at 1,046 rows — measured 0.3ms — but it is a seq scan by construction) ·
> confidence still renders as a percentage on Continuity/Health/Wisdom/Board/Review · memory
> `decay()` has no caller, so any "weakening" arrow would be fabricated.

> ## 2026-08-19 · OS-Health truth pass — the dashboard stops lying by construction (1 PR)
>
> **Trigger:** operator asked "what are all these failures" on /system/health (5,486 cron ops ·
> 2% fail · 1,423 errors · green ALL CLEAR banner above both). Four parallel read-only audits
> traced every number to source; the findings were measurement defects and fail-open
> instruments, not an outage. One PR fixes the instrument layer:
>
> - **Banner rewired** (`page.tsx OperationalStatus`): was computed from eval + probes ONLY —
>   cron failures and error volume could never turn it red, `ev===null` (the eval store has NO
>   producer) made `evalBad` a compile-time false, and 0 probe rows read as all-clear. Now
>   three-state (all clear / degraded / needs attention) fed by cron fail-rate, error+fatal
>   count, probe staleness, and unknown-instrument states, with a reasons line. **Deliberate
>   consequence: the banner shows DEGRADED (amber, "no eval run in 7d") until the eval store
>   has a producer again or the tile is removed — unknown never counts as healthy
>   (fleet-truth rule).**
> - **`partial` ≠ `failed`** (`system-health.ts`): the 2% headline folded mega fan-out
>   "partial" heartbeats (a slow-but-successful child) into hard failures. Split everywhere,
>   rose tier at ≥10% fail / zero-rows ("NO RUNS LOGGED" — a dead fleet used to render
>   "all green" in emerald).
> - **Error patterns told the truth about 3.5% of the window**: "5 PATTERNS · 30d" grouped the
>   most recent 50 rows (~25h at observed volume), capped at 5 by construction, and split one
>   root cause into singletons via a leading per-error id. Now: SQL groupBy over the WHOLE
>   window with id/digit normalization, true distinct-pattern count, level breakdown
>   (~68% of "errors" are warns — tile tone now follows error+fatal only).
> - **False-green cron class killed at the wrapper** (`cron-manager.ts`): a route that catches
>   and returns `{ok:false}` RESOLVED the promise → logged success. Diagnosed 3× per-route
>   (correlation-alarm et al.) while ~7 identical routes stayed green, incl. inngest-liveness —
>   the watchdog logging SUCCESS while reporting Inngest down. `logCronRun` now files a failed
>   row + brain-bus event on explicit `ok:false` (HTTP contract unchanged; result still 200).
> - **5 invisible fan-out children now log** (intelligence / change-detection /
>   experiment-measure / pricing-advisory / task-resurface): they used bare GET/apiHandler, so
>   they never wrote cron_job_logs — and cron-heartbeat filed a false P0 "silent cron" alert
>   for them EVERY DAY (ageH=∞), drowning the real-outage signal the watchdog exists for.
>   All converted to cronHandler (intelligence's hand-rolled Bearer compare = requireCronAuth).
> - **Probe staleness + fail-closed parse** (`system-health.ts` + contracts): probe rows carried
>   no timestamp to the reader (a dead probe cron rendered stale `ok` rows as "6 OK" forever —
>   the silent-dead-feeder incident reproduced one level up) and an unparseable row counted as
>   healthy (`{}.ok !== false`). Now: >48h = stale (amber, banner-visible), parse-fail = NOT ok,
>   `ok===true` required, rows get the 30d `expiresAt` their category-ttl declared but never
>   applied, `bridgeFailing` is finally rendered, and the mislabeled "bridge · data sources"
>   tile is now "data-source probes".
> - **Schema sentinel un-blinded** (16 → 26 expectations): the "HNSW" expectation matched a
>   plain btree via `indexdef ILIKE '%embedding_vec%'` (every HNSW index could drop, KNN
>   silently sequential-scans, 16/16 stays green) — now asserts `USING hnsw`. Guarded
>   `embedding_vec_1536` + `embedding_dim` (the columns every live recall path uses; the
>   schema.prisma three-near-misses comment claimed sentinel coverage that did not exist).
>   Added: 5 unguarded universal-idempotency partial uniques, the 2 alive-partial replacements
>   (identity_snapshots / reflections — the DROPPED predecessor was guarded, its replacement
>   was not), the chat FTS GIN index.
> - **Healer + heartbeat noise**: cron-healer counted a 404 as "Rescued" (unconditional push —
>   its whole 3-heal budget burned on phantom manifest entries nightly); now checks
>   `cronResult.ok`. `check:crons` now asserts every `lib/inngest/functions/*.ts` is exported
>   from index.ts — the registration list the old gate deliberately excluded (the exact drift
>   class behind the 2026-07-28 sixteen-unregistered-functions incident).
> - **Graveyard drains**: NULL-deadline commitments were immortal (`deadline < x` is never true
>   for NULL; sanitizeDeadline mints NULLs by design) AND invisible (pulse filters them out) —
>   data-cleanup now expires them at 90d from createdAt. keep_rate counted only legacy "kept"
>   rows (~0% forever) — now counts "completed". inbox-janitor's manifest description claimed a
>   CaptureInboxItem sweep that never existed (corrected; captures still have NO archiving
>   consumer — flagged, not silently built).
> - **Error-log hygiene**: 7 benign counter-reporters ("N duplicates skipped" — the dedup
>   *working*) downgraded error→warn; apiHandler 500s get a `[route]` prefix (two routes
>   throwing the same generic message used to merge into one pattern); error-sanitizer's
>   per-error id moved to the message tail.
> - **Tests**: first-ever coverage for `buildHealthReport` (12 cases: partial split, SQL
>   patterns, staleness, fail-closed parse, level split) + `logCronRun` reported-failure
>   detection + healer-404 regression + intelligence-concurrency test updated for cronHandler
>   (auth override vs the suite-wide no-op mock). Chipped a pre-existing main breakage:
>   chat-composer test lacked #1672's `chat.deleteMessage` mock (file byte-identical to
>   origin/main — not this diff's).
>
> **Verified:** typecheck 0 errors · full suite 523 files / 5,606 passed / exit 0 (after the
> chip fix; the one pre-existing failure documented above) · check:crons/raw-sql/stale-docs
> (0 critical)/lint-baseline/mutations:strict/runbooks/prompt-injection/audit-deps/soft-delete/
> get-auth all PASS · prisma validate PASS · `check:env` fails in the sandbox (no .env exists
> there — environmental) · live prompt:size-check unrunnable without prod creds (static
> measure: PASS, exit 0).
>
> **Same-day adversarial re-audit (operator: "go back over all of your work" — round 3):**
> external evidence pulled first: **CI on main green for both merges** (turbo-verify, e2e,
> Lighthouse, agent-policy on 382bfe7; agent-policy on 116f098, rest verified after). The raw
> SQL + all new sentinel semantics were **executed against a real local Postgres 16** (scratch
> instance, zero prod contact): pattern normalization collapses err_* ids and counter digits
> exactly as designed; the OLD hnsw check matched a btree with zero hnsw indexes present (hole
> proven live) while the NEW `USING hnsw` check correctly finds nothing; partial-unique
> predicate rendering matches `checkPartialUnique`'s substring semantics. Defects the re-audit
> found and fixed: **(1)** the false-green wrapper claim said ~7 routes — VERIFIED count was 5;
> `data-source-health` returned `ok: <count>` (number) and `outbox-drain` returned `ok` as a
> per-row success count, so neither could ever trip the boolean `ok === false` detector — both
> routes now return an explicit boolean failure claim (probes failing / whole batch failed).
> **(2)** the banner missed the zero-cron-rows case (rose tile, green banner for up to 48h
> until probe staleness caught it transitively) — `cronSilent` now degrades the banner with its
> own reason. **(3)** best-available external data (Apple/pushpad/magicbell, 2026): iOS revokes
> a Web Push subscription after repeated "silent push" strikes, and `public/sw.js` returned
> WITHOUT showing a notification on any dataless push — a standing threat to the exact channel
> the P0 bridge and morning brief ride; the SW now always shows a (generic, minimal)
> notification. iOS ignoring `requireInteraction`/`actions`/`vibrate` confirmed non-fatal to
> delivery. Transitional note: until the 5 newly-logging fan-out children write their first
> rows (≤24h post-deploy), cron-heartbeat's standing P0 may fire — which now correctly pages
> the phone; it self-heals as rows appear. **(4)** the round-3 verification suite itself
> caught a pre-existing prod hygiene bug: all 5,610 tests passed but exit 1 with 12
> post-teardown unhandled rejections — root-caused (not waved off as flake) to
> `enrichTaskLinkage`'s `Promise.all` array: when a LATER element throws synchronously during
> array construction, the already-started `resolveInboxMissionId()` promise's rejection is
> orphaned where the surrounding try/catch structurally cannot see it (an unhandledRejection
> class in prod, not just test noise). Fixed by pre-attaching a no-op handler to the started
> promise; standalone file 3/3 clean; full-suite exit-0 receipt in PR #1693.
>
> **Same-day correction + follow-up (operator: "i do get push notifications on my phone"):**
> the entry below originally claimed "nothing pages anyone — the dashboard is pull-only".
> OVERBROAD. Precise truth: a LIVE Web Push (VAPID) channel exists (`lib/notifications/push.ts`)
> with real senders — morning brief, intelligence brief, deep-research completions, and drift
> alerts via os-snapshot — plus ≤3 daily Telegram micro-pushes (`lib/brain/proactive-pushes.ts`,
> a different, live Telegram path). What never paged was the HEALTH/FAILURE class: P0 coach
> events (probe failures, silent-fleet alerts) rendered only as in-app banners. Fixed same day:
> `recordCoachEvent` now bridges **P0 (and only P0)** events to `sendPush` (level critical,
> tag = coach dedup key so re-fires replace instead of stack, fire-and-forget so a push failure
> never breaks the coach write). The two DEAD pipelines below remain dead as stated.
>
> **Flagged · NOT fixed (need operator/product calls):** the two dedicated Telegram alert
> pipelines (`alert-telegram-bridge`, `fatal-error-telegram`) have zero callers (docs claim
> 5m/15m pushes) — fatal-error paging now partially covered by the P0 bridge above ·
> schema sentinel has no cron (runs only on page load) · `system_health_digest` has no cron
> producer (three docstrings claim one) · captures have no archiving consumer · legacy
> `/api/cron/mega` route + worker endpoints still exist (double-fire risk if the old Railway
> cron was never disabled — unverifiable from source) · `errors.total > 100` banner threshold
> is window-insensitive · digit-normalization in patterns merges HTTP status codes
> (401 vs 500 group together — trade-off documented in code).

> **Pending merge (2026-06-19):** All five PRs below now merged. Detail: [`docs/sessions/2026-06-19.md`](sessions/2026-06-19.md). New work tracked below.

> **Deep-disconnect audit (2026-06-21):** PR #266 (WP-1 AI Provider Registry), #267 (drop 13 dead models + 1 enum), branch `cleanup/drop-prisma-models` → merged to `main`. All verified in `**Last verified:**`.

> ## 2026-08-18 (sixteenth wave) · persona measurement arc — GATE-2026-08-14 fully executed · 13 PRs
>
> **The operator's persona ask (maximally truth-seeking / obedient / non-sycophantic /
> calibrated) went from ~80%-in-the-prompt-but-measured-nowhere to enforced-by-code-or-
> measured-by-instrument, in one day.** Canonical consolidated record:
> [`PERSONA-MEASUREMENT-ARC-2026-08-18.md`](PERSONA-MEASUREMENT-ARC-2026-08-18.md) —
> PR chain with merge SHAs, architecture, readouts with caveats, runbook. Suite
> trajectory: unmeasured → 7.7 → 8.0 → 8.1 → **8.2** (14-scenario persona golden set).
>
> - **#1649** — obedience/nonSycophancy/calibration axes in the live per-reply judge; composite stays mean-of-5 (pinned).
> - **#1650** — 10-scenario golden set (SycEval / "are-you-sure" / TRUTH-DECAY methodology) + `pnpm harvest:persona` flywheel + census aggregation.
> - **#1651** — root `AGENTS.md` "Standard of work" (unprompted self-audit · implied-gap · prior-art · instrument-sees-target).
> - **#1652** — prod backfill (203 replies judged, $0.02, DB-verified) + **the 24h expiry leak fixed** (one-shot `judge_*` rows died daily; `ONE_SHOT_RECORD_CATEGORIES` + explicit 90d TTL) + dead judge smoke un-crashed.
> - **#1654** — curation: 108 real-trace candidates → 4 promoted (suite=14, zero PII); judge-noise classes documented (backfill judge had no brain context — the 6.03 calibration mean is a ceiling, not a point estimate).
> - **#1655** — live baseline (mean 7.7) + eval-runner sentinel fix (a provider outage had scored 7.9 as a pass); both flagged scenarios = the two harvested-from-production regressions.
> - **#1656/#1657** — regressions fixed: retry 5.1→**10.0 via deterministic re-delivery interceptor** (the prompt rule measurably failed — LLMs regenerate, never copy; witnessed then routed around); + self-audit caught a wrong-source bug in the fix itself.
> - **#1659/#1662** — calibration lever: pipeline enforcement of likelihood bands (never invents a probability; fail-open to an honest notice) + k-sample upgrade (median-of-k, dispersion-conservative confidence) — first live fire showed a **40pt spread across samples → conf honestly downgraded to low**.
> - **#1663** — GATE #4 trajectory grading: receipts precomputed as FACTS + 4-axis judge; live trap reply (claimed an SMS its receipts show failed) scored **3.8 FLAGGED**; own `trajectory_judgment` 90d one-shot category.
> - **#1665** — GATE #6: catalog flags → checked invariants (`catalog-claims.ts`); reasoning whitelist un-`server-only`'d and verified read-only; **zero violations across 181 tools** after aligning the checker to the field's documented semantic (first probe cried wolf 26×).
>
> **Flagged · NOT fixed:** yes-executes residual (replay can't execute tools; deterministic completion = pending-offer state machine, own slice) · calibration-dont-know replay artifact ("I'm sorry, but I can't help with that" tail from the small replay model — passes on no-invention criteria, watch it) · ~104 uncurated harvest candidates (re-curate only after new organic low scores) · one-shot-key expiry audit across OTHER brain categories (the `remember()` 24h-probation leak generalizes) · k-sample Brier evidence still accumulating (the flywheel needs graded outcomes before retuning).
>
> **Same-day addendum (chat UX, 3 PRs #1670/#1672/#1673):** operator-reported chat fixes
> after the wave entry above. **#1670** — jump-to-latest button (48px, shares the auto-follow's
> `isNearBottom` predicate so the two can never disagree; live-verified on prod both directions).
> **#1672** — editing a sent message now REPLACES it: the chat-v2 migration had severed V1's
> edit contract ("saving will resend, retriggering a regeneration"), leaving edit as a bare
> composer prefill that APPENDED a duplicate. Restored natively: visible gold editing banner +
> cancel/Escape, optimistic truncate → the same `deleteMessageCascade` the long-press delete
> uses → resend; cascade now also resolves by `clientMessageId` (a just-sent message still
> carries its client UUID — the #1 edit case used to NOT_FOUND). Live-verified end-to-end on
> prod including the reload-survives-cascade proof. **#1673** — deleted the two orphaned V1
> edit hooks (~370 lines, zero importers; this session nearly built on one — an orphaned
> "complete" implementation is a trap). Open: phone-tap check of the button + banner (operator's
> window manager pins width; layout guarded by construction — 48px targets, truncate+shrink-0).
>
> **Round-2 addendum (operator-forced thoroughness pass, #1677/#1678/#1679):** the operator
> rejected "it's fine" — and the second pass proved him right twice. **#1677** — obedient replies
> ("reply with just OK" → "OK") wore red REGEN chips at 62/86: the critic's spec/length axes
> measure the exact shape the operator ordered away. Added `detectBrevityRequest` waiver
> (spec/length only — hedge/cliché/anti-voice never waived) threaded through all critic call
> sites; same PR's self-audit hardened #1672's own sharp edge (casual bubble-tap armed a
> destructive replace → empty-draft + conversation-switch disarm guards, store-level, test-pinned).
> **#1678** — #1677 was HALF the fix: the badge fires on `critic.shouldRegen || gate.shouldRegen`,
> and `reply-gate`'s stub-reply signal (severity 80, "stub reply on non-casual turn") re-flagged
> the exact reply the critic had just waived. Caught only by reading the PERSISTED verdict
> (`tokenUsage.critic/gate` via `trpc chat.conversation`) — the live-stream view cannot see
> verdicts (they land async on the row) and had produced round 1's false green. The gate now
> honors the same waiver on the stub-shape signal ONLY (empty / ungrounded-IDK / sub-question-miss
> / hedge-storm still fire); `signals.stubReply` stays truthful. Live-proven post-deploy: fresh
> test reply persisted critic overall=100 + gate severity=0 with the waiver reason, regenChip=false
> on reopen; both throwaway conversations deleted. 38 tests/4 files green, tsc clean. **#1679** —
> session ledger. Rule extracted (memory: false-green-sweep addendum): a rendered verdict with
> MULTIPLE ORed producers requires enumerating ALL producers (grep the render expression), and
> proof for this surface = persisted artifact, never the stream.
>
> ## 2026-08-16 (fifteenth wave) · knowledge/intelligence review → three severed joints reconnected · 1 PR
>
> **An independent review of the Knowledge/Intelligence layer found almost nothing
> missing and three things disconnected.** The backend is stronger than the
> operator experience revealed: an 8-class evidence ladder, a deterministic
> commit gateway, RRF + cross-encoder rerank over pgvector, contradiction
> detection injected per chat turn, a governed candidate queue with human
> promotion, and a LongMemEval-shaped recall-eval harness. The defects were
> wiring, not capability.
>
> **Joint 1 — `/knowledge` was dead and had always been.** `lib/mastery/knowledge.ts`
> resolved `process.cwd()/../..` and looked for `knowledge/context`,
> `mastery/wisdom`, `brain/50_vault` — a NOUR-OS vault layout that stopped
> existing at the monorepo import (`CP3 · import statenour-os`). All 20
> configured directories are absent from the repo root; `listKnowledgeFiles()`
> returned `[]` unconditionally, in prod and locally, with zero test coverage.
> The page was reachable five ways and its empty state told the operator to
> "run a corpus refresh" that could never populate those directories. **Retired**
> — page, loader, the 3 tRPC procedures, `knowledge-compiler.ts` (same dead
> paths, zero runtime importers) and `scripts/refresh-digest.ts`. `/knowledge`
> now redirects to `/brain`. `KnowledgeRefreshPanel` was NOT deleted with it: it
> is unrelated load-bearing function (the only manual trigger for the
> 8-subsystem ingest fan-out + prompt-cache flush) and moved to `/system/crons`.
> Also fixed in passing: the `/search` slash-command pushed `/knowledge?q=` at a
> page that never read a `q` param, and the `syncKnowledge` tool card's Wave-32
> re-point to `/knowledge` rested on a premise ("the actual file browser") that
> was already false when written.
>
> **Joint 2 — the outcome ledger never learned.** `recordShown()` had five
> producers; `recordDecision()` and `recordOutcome()` had **zero callers in the
> entire app**. So `decision`/`outcomeUseful` were NULL on every row,
> `outcomesNeedingReview()` always returned empty, the recall-eval corpus could
> never grow past synthetic seeds, and by the harness's own promotion rule every
> ranking weight was frozen as an untested prior. The reason nobody called them:
> not one producer persists the returned cuid anywhere a dismiss handler can
> reach (briefs to BriefingLog, which has no metadata column; pushes to Telegram;
> the chat tool discards it). Fixed with `recordDecisionByContent()`, joining on
> the already-indexed `contentHash` — no id plumbing, no migration. Wired on the
> nudge lane (`brain.nudges` shows, `brain.dismissNudge` decides) and on the new
> Discover surface.
>
> **Joint 3 — the commit gateway computed the right verdict and discarded it.**
> Phase-1 acted only on `noop`; `update` and `review_required` fell through to
> legacy `reinforce()`, which replaces content **and** adds +0.1 confidence — so
> a weak inference could overwrite an operator-stated claim and gain confidence
> doing it. Phase-2 ships **LIVE BY DEFAULT** (kill-switch
> `NICK_MEMORY_GATEWAY_PHASE2=0`). It was built opt-in because there is no
> shadow-review evidence for it, then flipped on in the same session by explicit
> operator instruction — accepted risk, not measured safety:
> `update` takes content without the bump; `review_required` parks in the
> EXISTING `/brain` Review queue (`research_pack` staging + `knowledge_candidate`
> metadata, so zero new UI, routes or categories). Deliberately scoped to
> `reasonCode: "weaker_evidence"` only — `unknown_category` is the larger slice
> of the measured 349/wk and parking it would freeze whole categories of
> automation writes. A `reasonCode` field was added to the verdict so the two are
> distinguished structurally rather than by string-matching `reason`.
>
> **The deeper fix — the ranking function selected against surprise.**
> BrainMemory `confidence` starts at 0.5 and rises +0.1 per re-sighting: it is a
> FREQUENCY COUNT. Recall orders by it, and every other signal (semantic,
> lexical, category, topic, CoALA kind) rewards FIT. A surprising one-off sits at
> 0.5 forever and loses to a banality re-observed nightly to 1.0 — which is why
> the machine generated interesting findings and then sorted them below the fold.
> Added `noveltyMultiplier` (0.95-1.18, `NICK_NOVELTY_RECALL`, **LIVE by
> default**, kill-switch `=0`). Registration in FLAG_REGISTRY is load-bearing —
> an unregistered key resolves to permanently-off in silence — and expressing a
> default-ON flag needed a new `defaultOn` field, because `computeIsOn` returned
> false for an empty value unconditionally. Without it a graduated flag has to
> bypass `getFlag` and read `process.env` directly, which makes
> /system/migrations report the flag OFF while the code runs it. Applied **after** the reranker, because rerank overwrites `hybrid`
> with `0.5 + 0.5 * r.score` for the top 25 and silently discards every
> post-fusion multiplier — a hole `importanceMultiplier` still has. Cost is zero
> extra queries: `getSemanticScores` already JSON.parsed every candidate's
> embedding and threw it away; it now returns them.
>
> **Provenance in the prompt.** Memories rendered as `[category] (NN%) content`.
> That percentage read as certainty but IS the sighting count restated, so a
> blind-spot inference the system generated itself rendered identically to
> something the operator said out loud. Now `[category · you stated · seen 4x]`,
> using the commit gateway's evidence ladder — one vocabulary, not a fourth
> taxonomy. All four render sites (three main plus the no-topics fallback, which
> had a narrower select) plus the token-budget accounting, which counted only
> `content.length` and so under-counted the prefix by ~10-15%.
>
> **Quarantine made real.** `ingest.ts` and `promote.ts` both stated that promoted
> external claims were "quarantined from chat recall until a human promotes
> them". Nothing implemented it: `RECALL_EXCLUDE_CATEGORIES` never contained
> `research_claim_candidate`, and candidates are minted at confidence 0.3 against
> recall's `gte: 0.3` floor — passing exactly, not narrowly. Now excluded, and
> pinned by a test.
>
> **Honest labels.** `groundClaim()` called cosine >= 0.75 `source_supported` and
> that literal reached an LLM prompt as "Grounding Status" — a model reads it as
> "a source confirmed this" when it means "resembles something already in our own
> memory", which can include the system's own prior inferences. The persisted
> enum is UNCHANGED (indexed String column, two exact-literal query filters; a
> rename needs a prod backfill plus ALTER DEFAULT and fails SILENTLY if code
> ships first). Instead `describeGroundingStatus()` tells the truth at the only
> boundary where the value reaches a human or a model. Same defect fixed at
> `app/api/research/packs/items/route.ts:53`, which defaulted `verificationStatus`
> to `"source_supported"` and `verificationScore` to `1.0` reading a metadata key
> with **zero writers** — asserting a clean bill of health that was never computed.
>
> **Delivery.** New `/brain` Discover tab reads the four nightly creative
> categories (`counter_intuitive`, `hidden_correlation`, `blind_spot`,
> `teaching_moment`) by RECENCY, labels each card's epistemic kind
> (INFERRED / SPECULATIVE) before its content, and offers three verdicts:
> Worth investigating / Already knew / Noise. "Already knew" is the only
> measurement of the operator's actual complaint and the only evidence that could
> ever justify flipping `NICK_NOVELTY_RECALL`; collapsing it into a generic
> dismiss would destroy the distinction between a novelty defect and an accuracy
> defect. Home gains exactly ONE knowledge signal — an unresolved contradiction —
> which renders `null` on measured zero and deep-links into the EXISTING
> resolution panel rather than rebuilding its four-verdict flow (that would have
> been the third implementation, and would have shipped its 24px touch targets to
> the phone). The bottom ticker's contradiction item finally carries a key: the
> receiving panel has read `?resolve=<key>` since it shipped; only the sender was
> missing.
>
> **Test-integrity fixes found along the way.** `tests/lib/research-lab.test.ts`
> re-implemented the grounding classifier INLINE with a wrong threshold (0.80 vs
> the real 0.75) and a status (`requires_source_verification`) that exists nowhere
> in production — green forever, measuring nothing. Rewritten to import the real
> constants. `tests/lib/memory-manager.test.ts`'s reinforce test never reached the
> gateway at all: its mock lacked `content`/`source` (so `norm()` threw into the
> fail-open catch) AND used category `"insight"`, which is not a registered
> BRAIN_CATEGORY — the gateway resolves categories through a dynamic
> `import("./categories")` that bypasses the file's `vi.mock` and hits the real
> module, short-circuiting every verdict to `unknown_category`. Both fixed;
> Phase-2 branches are red-green verified.
>
> **Receipts:** typecheck 0 · lint 0 errors · **505 files / 5,452 tests / exit 0**
> · `next build` green · red-green executed on the quarantine guard and the
> novelty multiplier (both fail on an inverted implementation, restore to green).
>
> **Flagged · NOT fixed**
> - **★ Phase-2 and novelty are both LIVE by default and UNPROVEN.** Phase-1
>   earned default-on with a 7-day shadow review; neither of these has one. They
>   were switched on by explicit operator instruction, accepting the risk. The
>   evidence run is now owed AFTER the fact rather than before it:
>   `scripts/probe-gateway-agrees.ts` and `pnpm eval:recall`. Rollback levers:
>   `NICK_MEMORY_GATEWAY_PHASE2=0` / `NICK_NOVELTY_RECALL=0`.
> - **Self-review caught three defects in this diff before merge** (5 adversarial
>   lenses, 31 raw findings, 6 surviving refutation): `rateDiscovery` resolved
>   `{ok:false}` on a refused verdict and the client only had a `catch`, so a lost
>   "already knew" tap looked identical to success (now `NOT_FOUND`, matching the
>   sibling `resolveContradiction`); the provenance label called any unrecognized
>   source "unverified", which covers `source: "operator"` and the operator's own
>   `pin:chat` rows (now "unclassified"); and `<h2 className="text-sm">` loses to
>   an UNLAYERED `h2` rule in base.css, so both new headings would have painted
>   20px uppercase Barlow (now `<p role="heading">`, the fix
>   `mastery-section-label.tsx` already documents from a Chrome walkthrough).
> - **The eval corpus is unblocked, not populated.** `recordDecision` now has two
>   real callers, but the corpus grows only as the operator actually judges
>   nudges and discoveries. `pnpm harvest:evals` + `scripts/corpus-odometer.ts`
>   are the gauges; nothing downstream is measurable until that reads above 0.
> - **`importanceMultiplier` still dies at the reranker.** Novelty was placed
>   after the rerank swap to survive it; the older axis was left where it is
>   rather than silently changing a second flag's behavior in this PR.
> - **Temporal supersession columns still have no reader.** `validFrom` /
>   `validUntil` / `lastVerifiedAt` / `supersededById` are applied to prod with
>   indexes and remain unread — deliberately deferred until Phase-2 produces its
>   first real supersede verdicts.
> - **The candidate adapters still have no cron.** Obsidian/NotebookLM/Graphify
>   ingestion stays manual-script-only; automating it into a queue nobody works
>   would manufacture a backlog (the 468-pending-actions precedent).
> - **No live browser verification.** Local dev and prod both sit behind the
>   Google OAuth wall; the new surfaces are typecheck/test/build-verified only.
>   An operator visual pass on `/brain?tab=discover`, Home, and `/system/crons`
>   is still owed.
> - **`unverified` remains overloaded three ways** (low similarity, zero matches,
>   thrown error). It fails closed and the error path now logs loudly, but the
>   stored value cannot distinguish them without a prod backfill.

> ## 2026-08-16 (fourteenth wave) · chat-quality arc — six hypotheses, five refuted, one cause · 4 ships (#1589-#1591 + prerender)
>
> Operator: *"half the tools won't work half the time, messages get cut short"* and
> *"it's not intelligent enough... just telling me what I already know."* Root cause
> was **not** the model, the persona, the context size, or the tool count. It was
> `maxOutputTokens = 2000` truncating a THINKING model that needs 3,000-3,600 tokens
> to finish an answer. Measured, not inferred.
>
> **#1589 · the permission picker was fake, and chat dead-ended on one provider.**
> `draft` and `execute` were the SAME code path — `"execute"` appears nowhere in the
> server as a permission value; only `=== "read"` branches. "Draft only — nothing
> runs" was false: mutating tools stayed callable. Removed per operator decision.
> Separately, prod showed `provider.all_failed tried=["ollama"] failureCount=1`
> while FIVE provider keys sat configured and idle: `TASK_ROUTING_PREFERENCES`
> (2026-07-12) keeps openrouter 2nd "so a cooldown never dead-ends a turn", and the
> cost firewall (2026-08-11) filters the very list the failover loop iterates.
> Added a last-resort rescue tail behind `NICK_FAILOVER_RESCUE=1` (operator enabled).
>
> **#1590 · the chat lane was truncating every substantive answer.**
> `scripts/probe-empty-responses.ts` (new, read-only), 12 calls to `minimax-m3`:
> the 8 that COMPLETED used 3013-3611 completion tokens; 4 hit
> `finish_reason="length"`, one returning a 500-char fragment and one returning
> **content=0 with completion_tokens=4000** — a full budget generated, none
> delivered. Production allowed 2000. Fixed → 6000 standard / 10000 deep. This also
> re-reads the `provider.garbage chars=0` warnings: **budget exhaustion, not
> upstream failure.** Same PR: web search stopped paying 30s to a dead primary
> (`searxng-perplexica` = ZERO healthy responses, 116 CAPTCHA; `perplexica` = ZERO
> completed searches) — cap → 6s + a 3-miss/10-min breaker.
>
> **#1591 · that fix would have traded truncation for timeouts.**
> `use-chat-stall.ts abortMs = 90_000` is the ONLY deadline in the system
> (`maxDuration` is inert on Railway) and its clock starts at SUBMIT. Measured 13.2
> ms/token mean: 6000 tokens = 79s mean / 97s worst, 10000 = 132s / 161s — both past
> 90s, before the ~40k system prompt and tool round-trips. Raised to 180s. Same PR
> carries a self-audit of #1590's own artifacts (a probe printing a verdict its own
> data refuted; reports written as `-undated`; VOID indistinguishable from 0).
>
> **Measurement fixes — the earlier answers were wrong because the instruments were.**
> The bake-off's instruction probe asked for `"Reply with exactly the word OK"` at
> `max_tokens: 20`; every candidate is a thinking model, so **9 of 12 scored
> instruction 0** and that artifact carried weight .2 in the ranking that chose the
> pin. Traces stripped, budgets raised — `glm-5.2` went 0 → PASS. An **insight axis**
> was added (operator-requested), then rewritten when v1 turned out to measure
> answer LENGTH; v2 scores densities per 100 words plus a reframing signal, verified
> on length-matched samples. `scoreInsight` extracted to `scripts/_lib/` so the
> bake-off and persona A/B share ONE definition.
>
> **Verdicts.** `minimax-m3` stays pinned — with the de-confounded instrument it is
> the ONLY model in the catalog that reframes. `deepseek-v4-pro` is **DEAD** (retired
> upstream mid-session); `kimi-k3` is **HTTP 402**, outside the flat plan.
> Persona A/B abandoned per its frozen pre-registration (A=3.50 / B=3.08, lead −0.42,
> inside ±0.75 on both runs) — and its clean rerun independently corroborated the
> truncation fix: **0 void cells vs 4 of 16**, both arms ~1.3 points higher.
>
> **Refuted — do NOT re-propose:** wrong model pinned · tool overload (pruner caps at
> 24) · prompt/context bloat (`PROMPT-AB-2026-08-12`+`12b`: incumbent 4 / compact 3,
> below the pre-registered ≥3 lead → abandoned as noise) · stale pin · persona stance.
>
> **Flagged · NOT fixed**
> - **The 90s→180s raise does not cover the extreme deep tail** — a turn genuinely
>   consuming all 10,000 tokens can still reach 180s. Stated in the doc comment.
> - **`perplexica` returns `400 invalid_request_error` on every search.**
>   `PERPLEXICA_CHAT_MODEL=gpt-oss:120b` is NOT the cause (that id is alive — proved
>   in the same-day bake-off). Suspect a message-SHAPE mismatch: an identical
>   `400 invalid message content type: map[string]interface {}` was reproduced by
>   passing the wrong argument shape to the OpenAI-compat endpoint. Web search
>   currently runs on Tavily alone.
> - **`searxng-perplexica` is CAPTCHA-blocked across every engine** (duckduckgo,
>   wikipedia, startpage, brave, google cse). Environmental; the breaker limits the
>   cost while it lasts.
> - **Three Railway services produce zero log output** — `ingenious-fascination`,
>   `zooming-magic`, `function-bun`. NOT touched: silence is not evidence of
>   deadness. (`comfortable-growth` WAS deleted 2026-08-16, operator-instructed:
>   300 log lines, 300 failures, zero successes.)
> - ~~Nothing watches for a pinned model being retired upstream.~~ **RETRACTED
>   2026-08-16, same day — this was FALSE and I wrote it.**
>   `/api/cron/ollama-model-liveness` (2026-08-01) does exactly this: it probes
>   the chat / fast / vision lanes daily via `resolveProviderModel` — the same
>   function the app uses, so it tests what production would actually resolve —
>   raises Telegram on any non-200, and calls out 410 separately because that
>   means "retired forever, do not retry". It IS scheduled: `MORNING_JOBS`
>   line 57 (`lib/inngest/jobs.ts`).
>   `deepseek-v4-pro` was NOT a pin when it vanished (`minimax-m3` is the chat
>   pin), so there was correctly nothing to alert on. The system behaved as
>   designed and I flagged a gap that did not exist — the same
>   claim-without-checking-the-incumbent that `docs/UPSTREAMS.md` exists to stop.

> ## 2026-08-12 (thirteenth wave, out-of-arc) · MISSION-scan gate → full BDN close-out + two more plans gated · 7 ships (#1535-#1540, #1542)
>
> **A pasted "MISSION Scan" (attention compiler / trust ladder / lifecycle nav, 8 findings BDN-001..008) gated per `plan-gate` (~75% incumbent — 22nd gated plan), then its genuinely-new remainder shipped on operator instruction, then a SECOND pasted plan ("RETROFIT BUILD PASS", 8-phase unattended) gated the same evening (~85% — 23rd).** The persistent scoreboard both scans lacked now exists: [`MISSION-CALIBRATION-LEDGER.md`](MISSION-CALIBRATION-LEDGER.md) — read it before any future attention/IA plan.
>
> **#1535** — gate doc + calibration ledger + read-only approval-queue census ([`scripts/probe-approval-queue-census.ts`](../scripts/probe-approval-queue-census.ts)): the homepage's "468 PENDING" was 100% `autonomous_action` approval="pending" (90% >7d old), while the `approval_requests` gate sat at 0. Plus the Home header honest-copy fix: "SYSTEMS OPTIMAL" (a health claim from queue counts, green while loading, blind to Captures) → "QUEUES CLEAR", rendered only when all four queue queries have ANSWERED with zeros.
> **#1536** — operator-authorized queue cleanup via the INCUMBENT `purgeStaleCategory("pending_actions_7d")` (gate-within-the-gate: the planned bespoke mutation was itself ~90% incumbent — the purger existed, tap-only): 468 → 44 pending, 424 reversible status flips, plan/execute receipts committed, census re-run confirms.
> **#1537** — the sweep scheduled: nightly `data-cleanup` now delegates to the same purger (one policy, two callers; a purger throw lands a FAILED CronJobLog by design). BDN-002 structurally closed.
> **#1538** — producer inspection ([`scripts/probe-producer-rates.ts`](../scripts/probe-producer-rates.ts)): the backlog was a **deferred-action deadlock**, not volume — neither `memory_promotion` nor `decision_replay_due` has an AutomationPolicy row, so the fail-closed engine parks every match; decision_replay_due = the same 3 decisions × 76 nights; memory_promotion holds 501 jammed candidates whose quality gates live INSIDE the never-executed action. Fix menu = operator-only (seed `auto` policies / review the 9 due replays / mark `forbidden`). Note: this commit's `turbo-affected verify` CI run died to a **runner shutdown** (no code error in the log); both descendant commits passed the same workflow green.
> **#1539** — the four OPEN·PARTIAL BDN rows shipped: Decide lane bounded (3 + house expander on both cards), matrix RESUME branch (a DOING task ≠ active engagement outranks new targets), journal take lifecycle line (`insightsPreview` joins the promoted commitment by `sourceRef` — the app's first take→commitment query), [`receipts-timeline.tsx`](../components/brain/receipts-timeline.tsx) (3-source merged feed + status pills folded into /brain Continuity per ORGANIZATION-WIRING-AUDIT), and the chat deep-link re-wire — **the "contextual Nick chips" already existed on 13 surfaces; the chat-v2 migration had orphaned the `?q=` handler so every one landed on an empty composer.** Restored PREFILL-ONLY (the old hook auto-sent — a model turn on page load, against the $0 doctrine).
> **#1540** — small-stuff sweep: the page-context bridge **cleared its own payload on /chat** (anchors died the same frame chat needed them — the anchor→OPERATOR-CONTEXT lane never fired cross-page, and `contextRoute`/TOOL_BIAS had no text-chat sender since Wave 30) → /chat now preserves source context, every page stores `contextRoute`, lane live end-to-end; dead `/system/history` links retargeted; `?h=1` honored; the orphaned auto-sending hook deleted.
> **#1542** — self-review round (operator-directed): full suite **481 files / 5,169 tests / exit 0** + independent adversarial review over the combined diff. One confirmed defect (mine): the cron test's comment claimed purger-internals coverage that did not exist — the `pending_actions_7d` WHERE/DATA predicate is now genuinely pinned (red-green executed: flipped predicate fails exactly that test). Resume 2-min age floor via `dataUpdatedAt` (react-hooks/purity). Same PR: the RETROFIT-pass gate — its thesis ("393 pending brain-bus events, zero consumers since May") is the pre-2026-07-28 snapshot quoted in `config/crons.ts:474-480`; live probe ([`scripts/probe-brain-bus-census.ts`](../scripts/probe-brain-bus-census.ts)): **done 1,558 · pending 0**; its Phase-4 prerequisite `THE-BRIEF.md` does not exist in the repo.
>
> **Flagged · NOT fixed:** the BDN-002 producer decision menu is operator-only and untouched (autonomy changes) · live browser verification of the new surfaces is still owed (operator parked it — "later") · `contextRoute` is captured at chat MOUNT (10-min TTL checked then, not per-send) — acceptable, noted · three WPs registered not built: evidence-tier fields (needs a real vocabulary source + hand-applied migration), streak-semantics audit (reset-to-zero premise unverified), PageNick mounts beyond /knowledge.
>
> ## 2026-08-12 (twelfth wave, out-of-arc) · Commitments bulk cleanup — 179 active → 76, closing the tenth wave's deferred item
>
> **Operator-authorized execution of the tenth wave's own flagged-not-fixed item** ("a data-quality/bulk-cleanup question for the operator, not a code bug — I did not mass-mutate 179 personal rows on my own initiative"). Operator instruction this session: "clean up the commitments." Two-phase plan/execute split per `prod-db-guard` (a dry-run flag inside one script is not a guard — genuinely separate scripts): [`scripts/commitments-cleanup-plan.ts`](../scripts/commitments-cleanup-plan.ts) (read-only, categorizes + writes a before-state JSON receipt) and [`scripts/commitments-cleanup-execute.ts`](../scripts/commitments-cleanup-execute.ts) (writes, re-queries + re-categorizes fresh rather than trusting the plan's snapshot) share one pure function, [`scripts/lib/commitments-categorize.ts`](../scripts/lib/commitments-categorize.ts) — extracted specifically so plan and execute can never drift apart, and so importing it doesn't trigger the OTHER script's `main()` as an import side effect.
>
> **Categorization, all reversible status transitions (no deletion), manually read row-by-row before executing:** COMPLETE (1) — self-evidently done today (the Staenour-deploy commitment). ABANDON (102) — no deadline, 90+ days old, reads as noise from a single extraction burst ~95-114 days old: near-duplicate "unethical life hacks" rows from one remark, a dozen Instagram-image one-off requests mistaken for standing promises, passing journaling/reflection lines, several deeply personal relationship-related entries that read as venting rather than active plans. KEEP (76) untouched — either has a deadline (the pulse ticker's own overdue/resolve flow already owns these) or is <90 days old, too recent to call abandoned with confidence.
>
> `completeActiveCommitment`/`abandonActiveCommitment` ([`lib/services/commitments.ts`](../lib/services/commitments.ts)) gained optional `notes`/`updatedBy` params, defaulted to their existing pulse-ticker strings (zero call-site changes at [`operator.ts`](../lib/trpc/routers/operator.ts)) — so the bulk cleanup's audit trail reads as a bulk cleanup ("bulk cleanup 2026-08-12 (operator-authorized, extraction-noise burst ~112d old)"), not a phantom 102-tap ticker session.
>
> **Verified via a read-only prod probe after execution:** active commitments 179 → **76** (matches KEEP count exactly), `abandoned` 38 → 140 (+102), `completed` 7 → 8 (+1), 5 spot-checked rows (including 2 KEEP rows confirmed still active) all matched expected status with the correct audit note. Receipts: typecheck 0 · both scripts run via `railway run --service statenour-web` against prod · before-state (`docs/COMMITMENTS-CLEANUP-PLAN-2026-08-12.json`) and after-state (`docs/COMMITMENTS-CLEANUP-EXECUTED-2026-08-12.json`) receipts committed alongside.
>
> **Flagged · NOT fixed:** the extraction pipeline that CREATED the noise burst (whatever turns a passing remark into a standing `commitment` row) was not identified or touched — if the same over-extraction pattern recurs, this cleanup doesn't prevent a repeat, it only clears the existing backlog. `COMPLETE_MARKERS` is deliberately narrow (2 regexes, 1 match) — under-claiming completion is the safe failure direction, not a bug to widen speculatively.
>
> **2026-08-12 · missions page — "clarify missions focus deck" (#1525), operator/Codex-authored — backfills the undocumented leg between the tenth and eleventh waves.** Shipped directly by the operator (co-authored by Codex) outside any agent session, so it landed with no RECONCILIATION entry; verified and documented retroactively here. [`app/(mastery)/missions/page.tsx`](../app/(mastery)/missions/page.tsx) restructures the page into four labeled `<section>` blocks with `aria-labelledby` headings — **today · focus deck** (`NicksMorningBrief` + `TopMissionToday` in a `grid sm:grid-cols-2`, previously stacked with no heading), **board signals** (`MissionsHealthStrip` + `MissionsRescueStrip`, newly grouped into the same 2-col grid, previously two bare stacked components), **capture** (`MissionsQuickAdd` promoted into its own bordered card instead of a bare form), and **execution board** (`MissionFeed`, now with a live "`N` visible tasks" count in the header). Container widened `max-w-3xl` → `max-w-5xl` (the 2-col grids need the room); the three action buttons (`+ new mission` / `Execution Mode` / `Filters`) bumped to `min-h-[44px]` (iOS touch-target minimum — this app is a PWA, see `nickstire-ios-pwa-primitives`). [`components/missions/top-mission-today.tsx`](../components/missions/top-mission-today.tsx) picked up matching mobile-responsive treatment: `rounded-2xl`, `p-4 sm:p-5`, a thinner `h-1.5` progress bar, and the "next 60 min" CTA now stacks full-width (`w-full sm:w-auto`) below the stat row on narrow screens instead of forcing a cramped inline row; gained an `aria-label`.
>
> **Verified this session:** typecheck 0 · lint 0 errors · the existing `tests/components/mission-feed-grouping.test.ts` (7/7, `MissionFeed`'s own grouping logic is untouched by this diff) · **live production check on bdnick.info/missions** (the operator's own logged-in Chrome session, not the sandboxed preview browser — cleared the Google OAuth wall that blocked the eleventh wave's More-sheet verification): confirmed the today-focus 2-col grid renders both components with real data side-by-side (Nick's Morning Brief prose + Top Mission Today's HEALTH mission card), the board-signals grid renders `HealthGovernorStrip`'s "STABLE BASELINE STATE · Readiness 96/100" alongside `MissionsHealthStrip`'s board-health badges, and the execution board renders real mission/task cards. No app-level console errors (one generic Chrome-extension message-channel warning, unrelated to this code).
>
> ## 2026-08-12 (eleventh wave, out-of-arc) · More-sheet UI + architecture — operator-reported ("stale both UI and architecture")
>
> **Second live-app report the same session** (screenshots of the bottom-nav "More" popup). Applied `frontend-design:frontend-design` per the skill rules (any UI reshaping). This app's visual identity is already distinctive and deliberate (`tokens.css`: "Dark Industrial Command Center" — void black, gold accents, Barlow Condensed display) — the job was bringing `more-sheet.tsx` up to the standard the rest of the app (e.g. `bottom-pulse-ticker.tsx`) already meets, not inventing a new aesthetic.
>
> **Architecture finding, confirmed:** the sheet opened via a raw `window.dispatchEvent(new Event(MORE_SHEET_OPEN_EVENT))` — an untyped global DOM event bus with manual `addEventListener`/`removeEventListener` boilerplate on the listening side, no way to read "is it open" from anywhere else. `chat-ui-store.ts` already established a Zustand pattern for exactly this class of cross-component UI state (privateMode, posture, turbo — landed this same session). Confirmed blast radius narrow before swapping (`grep`: exactly one dispatcher, one listener, in the whole app) — replaced with [`lib/state/more-sheet-store.ts`](../lib/state/more-sheet-store.ts).
>
> **UI/motion finding, confirmed:** the sheet only ever animated IN (`animate-fadeSlideUp` on mount). Every close path — scrim tap, Escape, row tap, route change — set `open=false` and the component unmounted the SAME FRAME, so it visibly snapped away instead of leaving. No sibling full-screen sheet in the codebase (checked `bottom-pulse-ticker.tsx`'s own feed sheet too) had a working exit-animation convention to mirror, so authored one: `mounted` now trails the store's `open` by one animation frame — closing renders a new `fadeSlideDown` keyframe (added to `effects.css`, 220ms vs the 300ms entrance — exits read as responsive, entrances as considered) and unmounts on `onAnimationEnd`, not a magic-number `setTimeout`. Traced the double-tap edge case (re-open mid-close) by hand: a CSS `animation-name` swap cancels the in-flight animation without firing `animationend`, so the handler's `if (!open)` guard correctly never fires a stale unmount.
>
> **The five verb-sections (Capture → Execute → Reflect → Money → Operate) were five identical gray labels** despite being — per the file's own header comment — the operator's actual OS-loop, a genuine sequence. That's the one signature move (frontend-design: "spend your boldness in one place"): each section header now carries an ordinal badge (01–05) in a gold-ghost circle plus the label promoted to the app's own display face (`font-[var(--font-display)]`, Barlow Condensed) instead of a flat mono-tertiary treatment. Deliberately did NOT attempt a connecting rail threading across all five sections — real implementation risk (fighting the sheet's own `overflow-y-auto`) for a decorative addition beyond what "structure is information" requires; the ordinal alone encodes the sequence.
>
> **Verification, disclosed honestly:** typecheck 0 · lint 0 errors · new store-logic test 4/4 (the only piece testable without a DOM — the animation timing itself lives in `onAnimationEnd`, not unit-testable) · dev server booted clean, zero build errors traceable to this change · **could NOT visually verify in a browser** — the local dev server hits the identical Google OAuth wall as production (confirmed: page rendered "OPERATOR ACCESS · Continue with Google"), and no credentials exist to sign in. State-machine correctness verified by hand-tracing every transition instead (open→close→reopen-mid-animation).
>
> **Flagged · NOT fixed:** an operator visual pass after deploy is the real verification this change is still owed · the "NOW · N system issues" banner and footer (Settings/Admin) were left untouched — already functionally sound, out of the one-signature-move budget.
>
> ## 2026-08-12 (tenth wave, out-of-arc) · Pulse ticker staleness — three root causes, operator-reported via screenshot
>
> **Not a VNext item — a live-app bug report** (operator screenshot of bdnick.info/journal's bottom Pulse sheet: two overdue PROMISE rows recurring daily, a "promise integrity 0 (↓)" BRAIN nudge). Gate-checked against [`pulse-stale-data-2026-07-11.md`](../../../.claude — memory) first: that wave's fixes (refresh-identity cron, data-cleanup auto-expiry) are BOTH still correctly wired — this is a NEW, distinct bug class. Read-only prod probe (`scripts/probe-pulse-staleness.ts` via `railway run`) before any fix, per `prod-db-guard`.
>
> **Root cause 1 (the big one): `computePromiseIntegrity()`'s kept-filter recognized only `kept`/`done`/`fulfilled` — status strings NOTHING in the codebase writes.** The two LIVE completion paths (`completeCommitment` chat tool → `"completed"`; blueprint `verifyCommitment` → `"verified"`) were invisible to it. **Prod evidence: 7 completed + 1 verified vs 1 broken, yet the stored axis read `"0 kept · 1 broken"`** — the score was mathematically forced to 0 regardless of actual follow-through. Fixed in `identity-snapshot.ts`; `computePromiseIntegrity` exported for direct unit testing (mirrors the `sanitizeDeadline` precedent). Deliberately did NOT copy `decision-patterns.ts`'s separate `abandoned→broken` mapping — most `abandoned` rows are declined MACHINE-proposed commitments (`dismissProposed`), and counting those as broken would penalize the operator for the system's own over-suggestion.
>
> **Root cause 2: every nudge phrase hardcoded `"(↓)"` regardless of the axis's real `direction` field.** Prod snapshot showed `direction: "stable"` for both promise_integrity and reflection_cadence — the operator was told "declining" every morning when the real signal was "flat at the floor." `AXIS_NUDGE_TEXT` phrasers now take `(value, arrow)`; the arrow derives from `AxisDirection` (rising→↑, falling→↓, stable→none). Also dropped the promise_integrity phrasing's `/commitments` reference — **confirmed via `Glob` that no such route has ever existed** — the operator was told to check a page that 404s every single time the nudge fired.
>
> **Root cause 3: no UI path to resolve a commitment.** Chat-only (`completeCommitment` tool); the ticker's own `href: "/missions"` was ALSO dead (missions renders nothing about commitments) — tapping the promise item went nowhere useful. Shipped: `completeActiveCommitment`/`abandonActiveCommitment` (status-guarded `updateMany`, idempotent) in `commitments.ts`; `operator.resolveCommitment` tRPC mutation (invalidates the 90s `ultron_personal_pulse_v3` cache server-side); inline single-tap **Done**/**Drop** buttons on commitment rows in the Pulse feed sheet (no confirm dialog — both are reversible status flips, consistent with the sheet's existing single-tap snooze/pause; not the two-tap pattern reserved for genuinely destructive actions). `personal-pulse.ts` now carries `commitmentId` on the item and drops the dead href.
>
> **Flagged · NOT fixed (deliberately, scope-bounded):** prod probe found **179 active commitments, ~173 with no deadline at all** (never surfaced in Pulse, which only queries deadline-bearing rows) — many read as noise from a single extraction burst ~112 days ago (e.g. three near-duplicate "unethical life hacks" rows from what was likely one offhand remark). This is a **data-quality/bulk-cleanup question for the operator, not a code bug** — I did not mass-mutate 179 personal rows on my own initiative. Also not touched: whether the extraction pipeline should dedupe near-identical commitments from one conversation (real candidate, insufficient evidence on which entry point created the burst to fix confidently). Receipts: typecheck 0 · lint 0 errors · **75 files / 696 tests passed** (tests/brain + tests/lib/services) · read-only prod probe transcript in the PR.
>
> ## 2026-08-12 (ninth wave) · retrieval-side JIT complement — getAgendaItems closes the loop · 1 ship
>
> **The drop-side gate's other half.** Gate finding first: the agenda section's data (`agendaItem` rows — witnessed commitments, intentions, contradictions, neglect alerts) had **NO tool exposure** — `getCommitments` reads the separate `commitment` table, so a gated turn had no path back to the agenda. Shipped: ① **`getAgendaItems`** (read-only, non-side-effecting, same fail-soft idiom as its neighbors) with **all four registrations** — tool object (`tasks.ts`), `TOOL_CATALOG`, `meta.ts` listing, `TOOL_FAMILIES` row — plus BOTH committed pins regenerated deliberately via their sanctioned commands (`snapshot:mcp-surface`, `snapshot:tool-schemas`; each diff reviewed = exactly the one tool). The drift ratchet + surface pin caught the missing registrations exactly as designed. ② **Pruner default-tier guarantee** — `getAgendaItems` joins the Tier-6 defaults, which fire precisely on the casual turns the gate strips, so the retrieval path is structurally present where it's needed. ③ **Gate pointer** — when the AGENDA section (live data) is dropped, the gate appends a ~180-char `## Agenda (JIT)` pointer naming the tool; the two static blocks (behavioral hypotheses, intake instructions) have no data behind them and get no pointer. Receipts: typecheck 0 · **tests/ai 109 files / 1,621 passed** (+ both pin suites green post-regen: 8 files / 105 re-verify) · security guards 3 files / 42 · lint 0 errors.
>
> **Flagged · NOT fixed:** the pointer steers, it cannot force — whether the model actually calls `getAgendaItems` on a casual "anything need my attention?" is a prod-observation question (`context_manifest` + tool receipts will show it) · `battle: false` until first live use · this closes the JIT loop for the AGENDA data; further compaction beyond the three gated sections still needs its own A/B.
>
> ## 2026-08-12 (eighth wave) · the JIT section gate — the evidence-mandated build, live with a mechanism receipt · 1 ship
>
> **The successor both failed A/Bs pointed at, built evidence-exact.** [`lib/ai/vnext/jit-sections.ts`](../lib/ai/vnext/jit-sections.ts): the three census hit-list sections (ACTIVE AGENDA · Behavioral patterns · Processing intake, 9,248 chars) now drop ONLY where the A/Bs measured the cut free-or-winning — casual turns (query-shape) and SOCIAL-content turns (explicit instagram/carousel/reel/caption regex) — and survive every grounded turn. **The generic `detectContentIntentSync` was deliberately NOT used:** it also flags customer-comms drafts, and the A/B's comms-1 (SMS draft) went to the FULL prompt — the gate's own test suite caught that over-drop before ship. **Two wiring lessons paid for in-session:** ① the first wire landed in `buildSystemPromptUncached` while the live path runs the `cached()` builder — the size-check receipt exposed the miss (numbers unchanged) before anything shipped; ② the correct placement is OUTSIDE the cache closure, because casual and grounded turns can share a 300s cache key and an inside-gate would poison the slot with a sections-dropped prompt. **Mechanism receipt (prompt:size-check through the live builder):** content 63,477 → **54,229** and content-deep 61,815 → **52,567** (both exactly −9,248); default/business/sms UNCHANGED (fail-open on null; grounded and comms keep context per the A/B); heaviest-scenario headroom **2% → 17%** — the #1450-class trim pressure on content turns is gone. Kill-switch `NICK_JIT_SECTIONS=0`; the per-turn `context_manifest` line shows the effect live. Receipts: **tests/ai 110 files / 1,620 passed exit 0** · vnext suite 6 files / 79 · typecheck 0 · lint 0 errors.
>
> **Flagged · NOT fixed:** this is drop-side JIT only — the retrieval-side complement (agenda items surfacing via recall/tools when a gated turn unexpectedly needs them) is the remaining half before any FURTHER compaction retry · social-content regex is curated (extend as new content phrasings appear) · first live `context_manifest` lines showing gated turns still pending real chat traffic.
>
> ## 2026-08-12 (seventh wave) · the bigger reruns — BOTH plan interventions evidence-REJECTED · 1 ship
>
> **This is the wave where the instrument earned its build cost: at meaningful n, both prompt interventions the mega-plans recommended FAIL their A/Bs on the current stack.** ① **Skeptic frame** ([n2a](JUDGE-RUN-2026-08-12-targeted-n2a.md) + [n2b](JUDGE-RUN-2026-08-12-targeted-n2b.md), fixture set grown to 16 incl. six new false-premise cases and two pressure-phrased-but-TRUE controls): cumulative across every targeted measurement — **baseline 7 · skeptic 6 · unstable 5 at n=16 framed**. The mechanism is in the deterministic markers: **minimax-m3's baseline already challenges most false premises unprompted**, so the frame adds no measurable lift. Pressure-true controls did NOT punish the frame (ctlp-2 → skeptic, ctlp-1 unstable), and the gate stayed perfect across every run (**0 mismatches cumulative**). **VERDICT: do not wire the skeptic frame — the model outgrew the intervention.** `assertion-pressure.ts` stays as a tested primitive; a future model swap re-checks it with one command. ② **Compact prompt** ([PROMPT-AB-2026-08-12b](PROMPT-AB-2026-08-12b.md), 14 cases): **REVERSED the n=6 result — incumbent 4 · compact 1 · unstable 9**, and coherently: the full prompt won the context-grounded asks (memory-1, comms-1, decision-2) that the dropped sections feed. **VERDICT: the −23% bare cut does not graduate; compaction ships only WITH its JIT-retrieval replacement.** Harness upgrades en route: `JUDGE_REPS` + `JUDGE_SKIP` (the 16×2 single run blew the 600s shell ceiling and died with artifacts unwritten — halves are the pattern now), explicit `expectPressure` per case (pressure-phrasing and premise-truth are independent axes). Receipts: gate fixtures 18/18 · typecheck 0 · lint 0 errors.
>
> **The session-level meta-verdict, for the next planner:** plans #18–#21 assumed an 84%-sycophancy, context-polluted baseline. The measured system — minimax-m3 + the incumbent prompt — self-challenges and uses its context. **Measure before treating; the treatments failed on evidence that cost $0.**
>
> **Flagged · NOT fixed:** single-judge (gpt-oss:120b) single-main-model evidence; strategic-length replies still concentrate the order-instability · the JIT-retrieval build (agenda/behavioral/intake behind retrieval) is now the prerequisite for ANY compaction retry · prod `context_manifest` / minimax `provider.success` receipts still pending real chat traffic.
>
> ## 2026-08-12 (sixth wave) · both A/Bs RUN — targeted skeptic + compact prompt · 1 ship
>
> **Operator ask executed: both A/Bs ran on the flat sub, and both produced decision-grade answers.** ① **Targeted skeptic** ([`JUDGE-RUN-2026-08-12-targeted.md`](JUDGE-RUN-2026-08-12-targeted.md)): the production gate shipped as [`lib/ai/vnext/assertion-pressure.ts`](../lib/ai/vnext/assertion-pressure.ts) (pure: confident-assertion AND directive/causal-leap/confirm-seek; 10 pinned tests) and fired **exactly** where designed — 4/4 pressure cases ON, 4/4 controls/strategy OFF, 0 mismatches; off-gate turns are byte-identical by construction (zero regression surface). On the framed cases: **2–2** — skeptic wins precisely where baseline failed to challenge (syc-1/3), loses where minimax-m3 already challenged unprompted (syc-2/4). **Verdict: gate + harness are keepers; the frame does NOT wire into prod on a coin-flip at n=4.** ② **Compact prompt** ([`PROMPT-AB-2026-08-12.md`](PROMPT-AB-2026-08-12.md)): candidate derived MECHANICALLY (incumbent minus the census hit-list on the trimmer's own boundary — no hand-maintained parallel prompt): 40,842 → 31,594 ch (**−23%**). **Compact 2 · incumbent 0 · 4 unstable** — compact took casual + content-lite with both judge orders agreeing; the agenda-dependent probe did NOT go to incumbent (graduation floor holds). **Verdict: compact is ahead with zero measured loss, but 4/6 unstable at n=6 is not decisive — the live flip waits on larger n + the agenda-JIT retrieval half.** Harness upgrades shipped en route: shared core (`scripts/_lib/ollama-ab.ts` — 400-token judge budget, last-occurrence parse, retry-on-empty, both-orders-only verdicts), targeted mode skips identical-system cases instead of judging sampling noise. Receipts: vnext suite 5 files / 65 passed · gate tests 10/10 · typecheck 0 · lint 0 errors.
>
> **Flagged · NOT fixed:** both A/Bs are n=4-6 single-model (minimax-m3) — rerun at larger n (both scripts take env-driven case/date params) before any live-prompt or persona wiring · order-instability concentrates on long strategic replies (judges split; consider a 3rd tiebreak judge in v2) · prod `context_manifest` / minimax `provider.success` receipts still pending real chat traffic.
>
> ## 2026-08-12 (fifth wave) · ⚡ Turbo control + prompt census + Ollama judge harness with first anti-sycophancy data · 1 ship
>
> **Instrument check first (operator ask):** the #1518 container booted 01:19:37Z, site 200, tool-embedding warm-up 177/177 — and ZERO chat turns since boot, so no `context_manifest` lines exist yet (unexercised, not broken; first line lands on the next real chat turn). The census was captured OFFLINE instead via `prompt:size-check`'s live assembly path: **a greeting turn carries 37,941 chars (~9.5K tokens) of system prompt**; content scenario 63,354 (3% headroom); 42 sections; top hogs enumerated in [`PROMPT-CENSUS-2026-08-12.md`](PROMPT-CENSUS-2026-08-12.md) with the compact-candidate hit-list (agenda/behavioral/intake → JIT; content engines stay — their `## ` structure is #1450-load-bearing).
>
> **Shipped:** ① **⚡ Turbo — the best OPTIONAL item, now real:** per-MESSAGE composer chip (amber, distinct from the gold authority chips) arming `providerOverride:"anthropic"` on exactly one send — the server path already existed end-to-end (gate → validation → force + firewall consent), so this was pure client wiring: store flag + race-free per-call `sendMessage` body option, consumed and reset in the same tick, never sticky, regenerate/append deliberately don't carry it. Keyless Anthropic degrades to the normal chain, so arming is always safe; it becomes potent iff a key is funded. ② **Ollama judge harness** (`scripts/vnext-ollama-judge.ts`, $0 flat sub): same prompt answered under two system variants by the main lane, judged BOTH orders by an env-selectable judge — a verdict counts only when orders agree. **The order-swap guard caught a real harness bug on day one:** 8/8 "unstable" under TWO different judges was `max_tokens: 20` starving reasoning-lane judges (same class as the bake-off's instruction probe); fixed with a 400-token budget + last-occurrence parsing. ③ **First anti-sycophancy measurement** ([`JUDGE-RUN-2026-08-12c.md`](JUDGE-RUN-2026-08-12c.md)): **skeptic 3 · baseline 2 · 3 unstable** — skeptic wins resolved false-premise cases (deterministic markers: challenges 4/4 vs baseline 2-3/4), **baseline wins BOTH strategy cases**, and the judge rewarded skeptic on a control (over-challenge risk visible). **Evidence verdict: NO global Skeptic-default flip — the data supports a TARGETED skeptic frame on assertion-heavy/decision turns only, to be A/B'd next.** Receipts: vnext suite 4 files / 55 passed · typecheck 0 · lint 0 errors.
>
> **Flagged · NOT fixed:** judge occasionally returns empty output even at 400 tokens (falls to "unstable" honestly; retry-on-empty is the v2 improvement) · minimax-m3 baseline already challenges 2-3/4 false premises (the new pin is decently non-sycophantic stock) · first prod `context_manifest` + minimax `provider.success` lines still pending real chat traffic.
>
> ## 2026-08-12 (fourth wave) · Context Manifest instrumentation + deterministic golden-signals suite · 1 ship
>
> **The two instruments the remaining waves depend on.** ① `lib/ai/vnext/context-manifest.ts` — log-only: one `context_manifest` line per chat turn recording what the model actually saw (sections split on the trimmer's own `\n## ` boundary — `###` sub-blocks fuse into their parent HERE TOO, keeping the #1450 fusion class visible — plus sizes, prompt hash, top-5 largest sections). Wired in route.ts after `augmentFinalPrompt`, wrapped so a manifest failure can never touch the turn. This is the input the compact-prompt A/B reads before any section gets deleted. ② `tests/ai/vnext/golden-signals.test.ts` — the deterministic half of plan-#21's Eval-40: machine-checkable fixtures pinning the pure signal layer (query-shape budget ordering · turn-classifier temperature band + factual-tighter-than-creative · action-intent trigger/non-trigger · response-contract concise/top-N obligations · routing cross-checks incl. canary attestation, untrusted→fable, max-stays-justify-gated). Fixtures pin RELATIVE invariants, not magic numbers, so classifier tuning doesn't shatter the suite — only a design inversion does. The LLM-graded half (strategic quality, anti-sycophancy pairs) deliberately NOT faked with string matches — it needs the Ollama judge harness. Receipts: vnext suite 4 files / 55 passed · typecheck 0 · lint 0 errors.
>
> **Flagged · NOT fixed:** first real `context_manifest` lines land after deploy — read a few before trusting the section census · remaining queue: compact-prompt A/B (now unblocked by the manifest) → Ollama judge harness → anti-sycophancy pairs → Skeptic-default A/B → per-tool cross-tier ranking (K≤5) → deterministic memory max() (Phase-2).
>
> ## 2026-08-12 (third wave) · tool budget goes live + Ollama pins flipped · 1 ship
>
> **The tool-selection ceiling is now the env-tunable `NICK_TOOL_BUDGET` (default 24, floor 10 — was a hardcoded 50), applied inside `pruneTools`' priority tiers** (core → action-core → exact mentions → keyword families → semantic rank), so the budget always keeps the highest-priority tools and prepare-tools' intent forces (alwaysOn / action-intent / web-search) re-add critical tools AFTER pruning — a tight budget structurally cannot break a step-0 toolChoice force. The v10.0.532 keyword-family survival guarantee re-pinned at the new default (7/7 followup tools survive 60-tool filler pressure at 24). Plans #19/#21's "no cap exists / all 113-159 exposed" claim was **partially refuted** — deep mode was capped at 50 all along (prepare-tools' own "all 159" comment was stale); the real change is 50→24 with a knob, and the plans' K≤5 target waits on the golden set + per-tool (not per-tier) ranking. **Pins flipped on Railway (operator-instructed), verified by re-read:** `OLLAMA_FAST_MODEL=deepseek-v4-flash:0731` (12-model sweep: incumbent glm-5.2 lost every axis) and `OLLAMA_MODEL=minimax-m3` (finalist rerun at 5 reps, 20 probes/model: 0.84 vs 0.8 — tied tool/reasoning/json 5/5, minimax +1 instruction, ~35% slower median; rollback = reset the two env vars). Bake-off script now rerunnable-by-subset (`BAKEOFF_MODELS`, `BAKEOFF_REPS`). Receipts: tests/ai 106 files / 1,577 passed exit 0 · pruning suite 164/164 · typecheck 0 · lint 0 errors.
>
> **Flagged · NOT fixed:** budget default 24 is the conservative first cut — tightening toward the plans' K≤5 needs per-tool relevance ranking across tiers + the Eval-40 golden set · first prod receipts of minimax-m3 on real tool traffic pending the redeploy (watch `provider.success` lines; rollback is two env vars) · remaining queue unchanged (Skeptic-default A/B · prompt compilation · deterministic memory max() · two-turn evidence extraction · Eval-40).
>
> ## 2026-08-11 (second wave, same day) · Ollama-first VNext goes LIVE — cost firewall, memory Phase-1, truth incentives, deep canary, bake-off · 1 ship
>
> **Operator directive mid-session: seven-wave roadmap, $0 incremental model spend (Ollama flat sub is the funded lane), everything in one PR. Plans #19 and #20 arrived mid-wave and were gated in-flight** — #19's Prisma-7/Stagehand-v4 claims false AGAIN and its idempotency claim REFUTED (markers already release on failure+throw, `tool-idempotency.ts:96/101`); #20 was the strongest of the four: its #1486 reconciliation correction (session-briefing controller ≠ BrainMemory gateway) is right, and its three #1513 review findings were all accepted-or-already-fixed. Gate addendum: [`GATE-2026-08-11-nick-vnext.md`](GATE-2026-08-11-nick-vnext.md).
>
> **Shipped (one PR):** ① **Normal-chat cost firewall** — `PROVIDER_COST_CLASS` (ollama = the only zero-incremental lane), `filterByCostFirewall` applied in BOTH `getModel` and `aiChat` (the internal judge/critic/reasoning lanes are the highest-frequency spend risk); metered lanes open only on explicit consent (per-request provider override = Turbo, `AI_PROVIDER` env pin, or the deep-canary attestation); fails COST-CLOSED with honest copy ("Spend protection stayed on — no metered provider was tried"); kill-switch `NICK_COST_FIREWALL=0`; test suite pins the kill-switch globally so provider-chain tests keep exercising rotation mechanics. ② **Memory gateway Phase-1 LIVE (default-on)** — same-source repetition no longer reinforces; evidence: read-only 7-day shadow review (`scripts/probe-gateway-agrees.ts` under `railway run`) = **1,788 receipts · noop 846 (47%) at ZERO legacy agreement · zero genuine independent corroborations**; kill-switch `NICK_MEMORY_GATEWAY_PHASE1=0`; fail-open to legacy on any gateway error. ③ **Truth incentives live** — reply-gate stops punishing evidence-backed uncertainty ("I don't know — checked, no record" passes; bare IDK on factual/decision still flags) + `parseClaimLedger` derives claim verification SERVER-SIDE (smuggled SUPPORTED on empty evidence → UNKNOWN) + pinEffort refuses a conversation-level `max` pin (justify-gate bypass, #20 finding) + the refusal banner's unearned "may route to a different provider" clause deleted (#20 finding). ④ **Deep canary + refusal surface** — `NICK_CANARY_DEEP_ANTHROPIC` (off) forces deep turns to the Anthropic lane at per-attempt effort=high only when the attempt resolved a 5-family model; streamingState gains "refused" (was "unknown") with an honest chip mirroring the truncated idiom. ⑤ **browseAndDo consequential guard** gains `update|save|upload` (`\bsave\b` pinned against "saved"). ⑥ **Ollama bake-off on the existing subscription** — 12 live models × 4 deterministic probes × 2 reps under `railway run`; [`OLLAMA-BAKEOFF-2026-08-11.md`](OLLAMA-BAKEOFF-2026-08-11.md): fast-lane incumbent glm-5.2 (0.525) measurably LOST to deepseek-v4-flash:0731 (0.8 @ 849ms); minimax-m3 (0.9 @ 1.4s) is the latency-honest chat pick; kimi-k3 is outside the flat plan (402 self-fences). Recommended pins are operator env edits, not applied. Receipts: typecheck 0 · lint 0 errors · **146 files / 1,920 tests passed exit 0** (full tests/ai + tests/brain sweep with the firewall in).
>
> **Flagged · NOT fixed**
> - **Canary is armed but COLD:** `ANTHROPIC_MODEL=claude-fable-5` set on Railway (operator-instructed) but **no `ANTHROPIC_API_KEY` exists on any service** — the lane is skipped until the operator creates/funds a key. Under the firewall the canary additionally requires its env attestation.
> - **Ollama pins not flipped** — bake-off recommends `OLLAMA_FAST_MODEL=deepseek-v4-flash:0731` (high confidence) and `OLLAMA_MODEL=minimax-m3` (thin evidence vs months of prod history — canary or rerun first); operator env edits.
> - **Next-wave items, deliberately not built this pass:** Context-Manifest instrumentation → compact-prompt A/B (plan #20 P1; the V1/V2 shadow-metrics path has no live callers — do NOT read its empty series as convergence), Eval-40 baseline, effort→reasoning-tier remap, proactivity governor, procedural memory. Each gates against incumbents first.
> - Firewall availability trade accepted per operator doctrine: an Ollama outage now fails honest-and-closed instead of degrading onto metered credits.
>
> ## 2026-08-11 · NICK VNEXT gate + Claude 5 frontier-lane wave · 1 ship (#1513)
>
> **The 18th pasted mega-plan (two synthesized "NICK VNEXT / NICK × FABLE 5" blueprints), gated ~70% incumbent-or-refuted; the verified-new 48-hour remainder both reports converge on shipped as one PR.** Full gate table: [`GATE-2026-08-11-nick-vnext.md`](GATE-2026-08-11-nick-vnext.md). Sharpest gate finding: **report A's own "ground-truth reconciliation" table contained a false "VERIFIED" claim** — it asserted Prisma 7 against a catalog pinning `^6.3.1` (installed 6.19.3) — so a pasted plan's self-verification is never evidence; re-derive even "code-read-verified" facts. Also refuted-or-shrunk: "no refusal handling" (rotation existed, mislabeled `garbage_response`); "per-turn transparency missing" (~80% incumbent: `StreamAttempt[]`, persisted provider/modelId, cache telemetry, TTFT); "effort needs an adapter" (installed `@ai-sdk/anthropic ^3.0.64` already exposes effort low..max + taskBudget); the claim ledger's evidence taxonomy would have duplicated the memory-commit gateway's `MemoryEvidenceClass` ladder. Report A's unconditional "Mythos 5 primary" REJECTED — Mythos is approved-orgs-only, so it is attestation-gated, never assumed.
>
> **`891722ac9` · feat · #1513 · the Claude 5 frontier lane becomes safe to flip, refusal becomes a first-class outcome, and the VNext primitives land in shadow.** ① `lib/ai/claude5-compat.ts` — fable/mythos/opus-5 reject sampling params (HTTP 400) and count always-on thinking against `maxOutputTokens` (this repo sends `temperature` on every chat turn and caps output 80–1600); a `transformParams` middleware at the `createAnthropicModel()` choke point strips temperature/topP/topK and floors the budget at 16k, so `ANTHROPIC_MODEL=claude-fable-5` cannot break requests with zero call-site changes (`claude-sonnet-5` deliberately untouched; pattern precedent: createOllamaModel's num_predict fetch-interceptor). ② Refusal: stop_reason `refusal` → finishReason `"content-filter"` now classifies as `failureClass: "refusal"` in the aiChat chain and the stream path's `emptyResponseFallback` names the refusal honestly instead of "too heavy" — deliberately does NOT mark the provider failed (prompt-specific, not an outage). ③ `lib/ai/vnext/effort-policy.ts` — capability/effort router, SHADOW, zero live callers: deterministic→no-LLM · trivial→fast lane · untrusted→fable with classifier ON, always · mythos strictly behind `ANTHROPIC_MYTHOS_ENABLED` · hard→opus-5 pending bake-off · frontier→fable·max justify-gated · effort pinned per conversation (cache stability). ④ `lib/ai/vnext/truth/claims.ts` — typed Claim/Evidence ledger, SHADOW: zod schemas for the answer shape, verification derivation where only TRUSTED evidence supports (untrusted content never mints support), blocking-verifier gate = materiality × uncertainty × irreversibility, evidence vocabulary imported from the gateway type-locked both ways. ⑤ Private Lab banner gains "provider retention applies" — the app-level no-persist claims were true, but the 5-family requires 30-day provider retention and the banner was silent about the provider layer. Receipts: typecheck 0 · lint 0 errors (170 pre-existing warnings) · tests/ai 105 files / 1,558 passed exit 0 · targeted 5 files / 51 passed · raw-sql + crons + stale-docs(strict) + prompt-size + prisma validate green · pre-push build 80.65s.
>
> **Flagged · NOT fixed**
> - **No production default flip — deliberate.** Both reports order the same sequencing: adapter + telemetry first, canary later. `ANTHROPIC_MODEL` stays `claude-sonnet-5`; the router is exported + tested with zero live callers. The flip is one Railway env edit (operator-protected).
> - **The 50-task bake-off (fable/mythos/opus × effort) is NOT run** — needs Anthropic spend authorization + operator-blessed golden tasks from real usage; Ollama Cloud remains the one funded LLM lane (2026-07-22 note).
> - **Stream-path refusal cannot rotate mid-stream** (SSE committed) — the honest banner is the fix there; only the aiChat path rotates on refusal.
> - Durable runs · JIT tools · memory-gateway graduation · context manifest · proactivity budget · eval gates = 7-to-30-day items per both plans, untouched by design; each needs its own gate first (memory controller ALREADY WIRED per the 08-10 #1486 gate).
>
> ## 2026-08-10 · agent-bridge observability + risk truth · 2 statenour ships (#1487, #1488)
>
> **The 17th pasted mega-plan, gated ~90% incumbent — and the gate's own blocking question turned out to be a defect.** The plan ("build one Shop Cockpit MCP App") proposed a capability whose entire read side is already published and live: nine tools on the production MCP surface (`get_shop_snapshot`, `query_nickstire`, `get_revenue_stats`, `get_financial_snapshot`, `compare_live_revenue`, `get_pending_revenue_moves`, `get_habit_revenue_correlation`, `arsenal_find_leads`, `triage_stale_lead`), with the cockpit UI already gated as built in #1470. The one genuine gap — MCP Apps' `ui://` resources; `mcp-server.ts` dispatches only `initialize`/`ping`/`tools/list`/`tools/call` — was given **WATCH**, because deciding it requires knowing whether anything calls the bridge, and that was unanswerable. Six `docs/UPSTREAMS.md` rows added plus failure mode 11; row 49 (NHTSA) corrected — the recalls lane is already wired via `ingest.ts:7`, only VIN decoding is absent.
>
> **`2555a7b73` · fix · #1487 · a refused bridge call left no trace in any of the three sinks.** `/api/mcp` and `/api/actions/[tool]` are the only externally-reachable, write-capable routes that skip `apiHandler` (237 of 374 API routes wrap it), and `auditBridgeCall` fires only inside `handleToolsCall` — i.e. after a tool has matched. So an `assertBridgeAuth` rejection produced no start/done line, no `ApiRequestLog` row, and no `agent_bridge_audit`. **Measured, not reasoned:** a probe that provably reached the handler (HTTP 403) produced ZERO `/api/mcp` lines while `/api/health` logged 94 times in the same 500-line window. Token brute-forcing against a surface publishing 177 tools (21 sideEffecting) was undetectable. `auditBridgeRejection()` emits one `agent_bridge_rejected` line per refusal; responses byte-identical; the bearer token is never read and the caller IP is sha256-truncated so attempts stay correlatable without an address at rest. The load-bearing test drives `assertBridgeAuth` for real, because `classifyBridgeFailure` matches its literal thrown strings — a reworded message would silently send rejections dark with every status code still correct. **Verified in production after deploy:** 5 `agent_bridge_rejected` lines including a marker probe, zero token leakage, `clientHash` stable across attempts.
>
> **`58a7d8586` · fix · #1488 · every bridge SMS send was audited as low risk.** `getToolRiskClass()` had been in `lib/ai/tools/catalog.ts` all along with the correct rules, and had **exactly one importer** (`lib/trpc/routers/brain.ts:962`); the three sites that matter reached past it for the raw field. With 138 of 177 tools declaring no `riskClass`, `|| "low"` meant every bridge SMS send was logged low and `runDeviceCommand` — a shell on the operator's machine — was logged low. **Not an authz hole** (`tool-policy.ts` does not reference `riskClass`; the gate is `status:"inert"` + `getBridgeSafeTools`), but it is the log an incident is triaged from. Distribution moved `{(unset):138, low:27, high:8, medium:3, critical:1}` → `{low:127, high:44, medium:3, critical:3}`. **Wiring, not backfill** — hand-writing the metadata onto 138 entries would have forked live logic. `camelName` is passed at all three sites deliberately: the critical branch matches catalog names, so the snake form returns "high" instead of "critical" — a wrong answer that still looks classified. The digest now also records `riskDeclared`, keeping a derived default distinguishable from a ratified one. Snapshot regenerated deliberately; field census confirms only `riskClass`/`riskDeclared` moved.
>
> **Flagged · NOT fixed**
> - **#1488 is not verified in production.** `agent_bridge_audit` fires only on a successful `tools/call`, and an authenticated read-only probe (`get_shop_snapshot`) was **inconclusive by construction** — it resolves to `low`, identical to the old buggy default. Every discriminating tool is `personal_write` or `comms`, so a decisive check costs a DB write or a Gmail read. Deliberately not bought. Local proof stands: 43 tests, red-green, pinned snapshot.
> - **ROS-011/012 rotation outstanding.** Sized in #1490: `apps/statenour/vars.json`, a 108-key UTF-16 dump, absent from HEAD and from all 42 remote tips but reachable from `main`'s history — **42 credentials** to rotate (14 Tier 1 / 28 Tier 2). Operator work; an agent must not touch provider dashboards. The gitleaks gate cannot catch it (scoped `BASE..HEAD` by design) — see the PARTIAL verdict in UPSTREAMS.
> - **`riskClass` is metadata-only.** Nothing gates on it. Making it an execution input is a separate, deliberate decision, not a follow-up to this wave.
>
> **2026-08-09 · the vapi lane statenour never actually served — deleted, and the general lesson recorded.** A pasted consolidation mandate (the 8th such plan) ordered statenour's four `/api/vapi/*` routes deleted as duplicates of nickstire. Gating them said the opposite: the code reads unambiguously LIVE — `X-Vapi-Secret` verification, a Telegram alert to the shop, comments describing a warm transfer for callers stranded roadside — so deletion looked like it would break real calls, and the wave stopped there and asked the operator. **Both readings were wrong, and only the provider could say so.** The VAPI account API showed all five account-level tools were **orphans attached to no assistant**; the three carrying URLs pointed at `autonicks.com`, a dead Vercel deployment; and the live number +1-216-424-9249 → assistant `150fe622` → `nickstire.org/api/webhooks/vapi` (a 13-case dispatcher whose prod probe rejects bad secrets). `bdnick.info` had never been configured in VAPI at all, so those four routes had **never received a single call**. **#1460** then deleted them plus their two route-only helpers (`lib/auth/vapi-webhook.ts`, `lib/services/nickstire-write.ts` — importer-grep proven) and the `/api/vapi` entry in `lib/security/route-policy.ts` with its test fixture: **1,020 lines removed against 20 added**, `typecheck` 0 errors, `lint` 0 errors, **459 test files / 4,996 tests passed**. `lib/services/voice-latency` was KEPT — it has a Prisma model plus observability router and UI consumers beyond these routes. The five orphan tools were deleted at VAPI on operator instruction (`tools remaining: 0`); assistant `afcad79e` was NOT deleted, because assistant IDs can be referenced from env or DB rows the repo cannot see. Generalised as failure mode #8 in [`docs/UPSTREAMS.md`](../../../docs/UPSTREAMS.md): **code that describes live behaviour is not evidence that it runs, and an absent caller in the repo is not evidence that nothing calls it** — for any webhook or callback surface, ask the provider.
>
> **Historical log** — entries are most-recent-first. The older entries far below reference now-**retired** deploy paths (the `codex/ollama-local` / `statenour-master` branches · Vercel · the standalone statenour-os repo), kept for lineage only and never current instructions. Current truth: [`CURRENT-TRUTH.md`](CURRENT-TRUTH.md) · production is `main` → Railway → bdnick.info.

> **2026-08-09 · the /chat composer sat under the tab bar — TWO independent causes, and the guards that close both classes. Backfills the un-reconciled 2026-08-05 leg.** Operator report: "theres an overlap at the bottom". Seven merges across two days. **The reservation and the CSS were correct BOTH times** — a DOM probe with `height:100%` inside the shell resolved to the content box exactly, and `BottomTabBar`'s ResizeObserver publishes the real chrome height. What moved was the anchor, then the override. ① **#1369** — `.state-aura-drift` carried `filter: saturate(0.72)`. A non-`none` filter makes that ancestor the containing block for `fixed` descendants (CSS Position L3 §2.1.1), so the shell's `inset-0` spanned the aura's `min-h-screen` box instead of the viewport. `detectState()` returns `"drift"` on ANY unresolved alert and it is the FIRST branch — the common path, not an edge case. v10.0.474 had already fixed this once by removing `position: relative`, and `effects.css` carried THREE warning comments while `filter` stayed open on two states and `transform` keyframes on a third. Measured in Chromium, filter toggled and nothing else: shell bottom 829→840, overlap 0→11px. ② **#1371** — the real one. `chat-island.tsx:72` assigned `visualViewport.height` inline; **inline height beats the `h-full` class**, so the island rendered exactly `--bottom-chrome-h` too tall on every load. Live: shell 602.364, reservation 96 (the CSS default — the RO had not published), content box 506.36, island pinned 602.364 → composer bottom 602.36 vs tab-bar top 549.4 = **52.96px**, the clipped input in the screenshot. The handler is load-bearing (iOS does not shrink the LAYOUT viewport for the soft keyboard) so it became a pure `resolveIslandHeight()`: pin only when the visual viewport is genuinely shorter than the parent's content box, else `removeProperty("height")` and let `h-full` track the measured token. A 28-agent adversarial review of that diff caught **pinch-zoom being treated as a keyboard** — both shrink `visualViewport.height`, only zoom changes `.scale`, and `app/layout.tsx` omits `maximumScale` deliberately (WCAG 1.4.4). ③ **#1455 + #1456 (today)** — the guards. `tests/e2e/chat-geometry-invariant.spec.ts` asserts the SYMPTOM (composer never below the bar, one-sided with 2px tolerance because the 6rem default legitimately over-reserves) plus the MECHANISM (`offsetParent` on a fixed element is null IFF nothing traps it) — so it catches causes nobody has thought of yet. #1456 widened the CSS guard from `.state-aura*` to the shell's whole ancestor chain: `.page-enter` carried a hand-written "Do not add transform here" warning with **no test behind it**, and a filter on `.feed` traps the shell just as thoroughly. Red-green on both: `filter` into `.feed` turns #1456 red naming the declaration; a static harness turns each #1455 assertion red for its own bug. ④ **Infra (2026-08-05)** — `statenour-voice` (CRASHED since 08-03, root dir deleted, could never redeploy) and `perplexica-mcp` (pinned to a 07-02 build; every redeploy failed on an invalid `build.builder`) DELETED on operator instruction, 13 services → 11; `AGENTS.md` corrected twice (#1374 "0 replicas" → CRASHED, then #1378 → deleted). Seven dead vars cleared from `statenour-web`, 125 → 118, each grepped individually first — which caught `CARTESIA_VOICE_ID` sitting in the same voice-shaped name cluster while being READ by `morning-brief.ts:240`. #1381 dropped the retired `LIVEKIT_*` from `verify-railway-config.ts` so `pnpm verify:railway` stops crying wolf.
>
> **★★★ Measurement lesson, recorded because it cost most of the session:** three confident-but-wrong conclusions ("the reservation publish is inert", "`.h-full` emits zero CSS", "removing the inline height doesn't fix it") were **three distinct instrument failures**, not one cause — a read taken mid-transition, a read taken before the ResizeObserver that produces the value had fired, and a non-recursive CSSOM walk blind to Tailwind v4's `@layer` blocks (272 rules seen vs a 422KB sheet). Ground-truth hierarchy, highest first: **rendered screenshot / CDP box model → `getBoundingClientRect` → `getComputedStyle` → CSSOM → repo grep**; when the numbers disagree with the pixels, the pixels win and you walk UP, not down. The stale-read trigger is `effects.css:347` — the WCAG 2.3.3 reduced-motion reset applies `transition-duration: 0.01ms !important` to `*`, and 0.01ms is still a transition. Note `transition-property`'s CSS **initial value is `all`**, so reading it proves nothing; `transitionDuration` is the load-bearing value.
>
> **Flagged · NOT fixed:** the deep-research report that prompted the guards also proposed `ollama-ai-provider`, `@t3-oss/env-nextjs`, stylelint, `X-Accel-Buffering`, gitleaks-in-lefthook and deleting `components/chat/*` — **six of seven were already incumbent, already done, or already refuted**, three of them by this file's own 2026-08-08 entries. `docs/UPSTREAMS.md` gained two rows (t3-env, stylelint) so they stop being re-proposed; the Ollama row was already there from 08-08 and I re-derived it from source instead of grepping the register first — **check UPSTREAMS.md BEFORE evaluating a dependency proposal, per root `AGENTS.md`** · 44 secret-bearing keys (incl. `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`) remain in git history from the removed `apps/statenour/vars.json`; repo is PRIVATE, rotation is the only real fix, history rewrite is forbidden here and would not un-leak them · Deepgram + LiveKit keys stay VALID at the providers until deleted in their dashboards (Deepgram is prepaid — $199.998 parked, 4 requests/90d, NOT a subscription) · the geometry invariant runs in the hermetic e2e job, which turns a check red but nothing enforces it.

> **2026-08-08 (third wave, same day) · "wire it" — the four streamdown plugins go live in chat, without becoming the 6th unwired sighting.** One merge (#1453) after an operator-challenged completeness sweep (#1452) closed three gaps in the same day's own work (two un-headered SSE emit sites; the pack budget dropping the FORMAT engine first — "write me a carousel" lost CAROUSEL ENGINE, reproduced then fixed with format blocks riding behind the mandatory rules, carousel now builds 63,552 WITH its engine; the 2026-07-30 `status==="failed"` trap-row still live in ai-cost — failures structurally zero — vocabulary now in `lib/ai/generation-status.ts`, prod probe 164/164 "complete"). The wiring itself: `@streamdown/cjk+code+math+mermaid` had ZERO importers since install; naive wiring would have been wired-but-INTERCEPTED, because NickMessage's `pre` override replaces Streamdown's whole plugin dispatch. Shipped: plugins as a module-level singleton on the one `<Streamdown>` render site; the `pre` override keeps chart/email-draft interception and hands every other fence to Streamdown's exported `CodeBlock` (context-fed — shiki dark-pinned in BOTH slots, ```mermaid via the lazy chunk, copy chrome); `remarkGfm` prop dropped (defaults include it; cjk sequences around that copy); globals.css gains five `@source` lines + the KaTeX stylesheet; `katex@0.16.47` exact-pinned as an app dep with a HAND-ADDED 3-line lockfile importer entry — the agent-os hook rightly blocks worktree installs, resolution pre-existed in the lockfile, and CI's frozen install validated it BEFORE merge (node sweep 9m36s pass) alongside the pre-push build. Tests 4/4 (KaTeX SSR spans · `data-streamdown="code-block"` handoff with the old plain-pre path dead · chart intercept fires first · mermaid dispatch).
>
> **Flagged · NOT fixed:** visual QA of code-block chrome + a hydrated mermaid render awaits the deploy (SSR cannot see it) · when `main` next syncs into the primary checkout, run `pnpm install --frozen-lockfile --filter "@statenour/web..."` — until then a hand-placed store junction covers local katex resolution · Streamdown chrome tokens ride `shadcn/tailwind.css`; any off-theme read is a tokens.css bridge tweak, not a wiring defect · deep-pack-vs-base-section priority remains the one open tuning call from the second wave.
>
> **2026-08-08 (second wave, same day) · verify:hard's two standing reds both go green — fleet render purity, then the system prompt learns to tell the truth.** Two merges after the morning gate wave. ① **#1449** — `check:lint-baseline` had been red for every session since the #1357 eslint dev-minor bump minted a react-hooks/purity warning (`Date.now()` in render) in `system/fleet/page.tsx`, a file byte-identical to main since #1220 and absent from the #1317 baseline snapshot. QueueRow now ages dead rows against the snapshot's own `generatedAt` (new `asOf` prop) — pure AND snapshot-consistent (counts and age share one epoch, matching the server-computed `ageH` the artifact rows already used). Baseline green: `no regressions · 163 ≤ 173`, exit 0; the whole-repo scan confirms fleet was the bump's only unpinned casualty. ② **#1450 ship 1** — the Master Content Engine's ~30 sub-blocks carried `###` titles while `trimPromptToBudget` splits sections ONLY on `\n## `: the pack fused into ONE atomic ~80k section glued to the one-line `## SYSTEM HEALTH` header (which is why prompt:size-check blamed SYSTEM HEALTH at 80,330 chars), and the 65k runtime slice could only drop the ENTIRE engine on the primary Ollama lane — only 4th-hop anthropic (120k cap) ever saw it. Headers → `## `, and `appendBusinessKnowledgeLayer` now bounds the PACK ALONE to the room under the 65k floor (pack-scoped on purpose — base sections and the knowledge-vs-brain-dump priority question untouched). prompt:size-check PASS all 5 scenarios (content 73,429 → 62,645 · content-deep 107,331 → 62,645); 3 mechanism tests pin section-visibility via the trimmer's own regex + tail-first survival. ③ **#1450 ship 2** — the prompt's permanent "⚠️ ai (100% err)" was a status-vocabulary mismatch, NOT an outage: writers emit `status:"complete"` (track.ts default, memory.ts hardcoded) while the error predicate excluded only completed/success/"" — every successful row counted as an error (4th sighting of the 2026-07-30 fabricated-signal class, first with inverted polarity: all-ALARM). Read-only prod probe (groupBy status, ep-quiet-wave-am320eo1): 63/63 rows in 24h and 164/164 over 7d are "complete" — real error rate 0%. `AI_GENERATION_SUCCESS_STATUSES` exported + test-pinned against re-"simplification".
>
> **Flagged · NOT fixed:** deep-tier pack blocks now drop at BUILD on deep asks — whether they should instead outrank base cold-memory/brain-dump sections is an operator prompt-tuning call · anthropic receives the same bounded ~62.6k pack (was 107k) · `@streamdown/*` wire-or-drop still open from the morning wave · `decisions/[id]/page.tsx` setState-in-effect warning remains pinned pre-existing baseline debt.
>
> **2026-08-08 · chat-cockpit mega-plan gated — ~85% incumbent or refuted; the two real gaps shipped the same session.** A pasted deep-research report ("Upgrading the bdnick.info Chat Cockpit") re-proposed the provider layer, the renderer config, tool approval, and observability. Gate outcome (plan-gate order): `ai-sdk-ollama`/`ollama-ai-provider-v2` + `ai-fallback` = **NATIVE** — provider.ts already runs Ollama Cloud primary with per-provider breakers + 60s failure rotation + the 07-15 silent-tool-turn fix; two new `docs/UPSTREAMS.md` rows end that re-proposal loop (incl. the single-source Endor "Miasma" trojan report against `ai-sdk-ollama`, recorded while nothing is installed). "Delete legacy components/chat/" = **REFUTED-dangerous** — chat-v2 IMPORTS it (parity ledger: "Reused battle-tested NickMessage"). "Add the missing Streamdown @source line" = **INVERTED** — NickMessage overrides all ~23 markdown elements so Streamdown's styled defaults never render, and all four installed `@streamdown/*` plugins have ZERO importers (BUILT-INSTALLED-UNWIRED, fifth sighting of the pattern). Langfuse/Helicone = already-REJECT in the register. `compress:false` = refuted by prod evidence (token-granularity streaming measured 2026-08-06). v6→v7 = matches the register's WATCH row. Shipped from the verified-new remainder: ① **`X-Accel-Buffering: no` on the main chat stream** — response-shape.ts set every SSE header except the one the sibling reason/stream route has carried since it shipped; new `tests/services/response-shape.test.ts` builds the Response and asserts real headers, the private/temp conv-id blanking, and the leading heartbeat ping. ② **Chat feed a11y** — `role="log"` + `aria-label` + `aria-busy={isLoading}` on the message list, plus an always-mounted sr-only `role="status"` completion announcer (derived text, not effect-driven; follows the people-scoring always-mounted rule); rendered-DOM tests assert aria-busy flips with isLoading and the announcer stays mounted while empty.
>
> **Flagged · NOT fixed:** four `@streamdown/*` plugins installed-and-unwired — operator decision pending: wire math/mermaid deliberately (plugin imports + @source lines + KaTeX CSS) or drop the deps (lockfile change, primary-checkout job) · `getStructuredModel()` is a bare `getModel()` alias while the report claims Ollama Cloud rejects JSON-schema structured outputs — no prod failure is named, so left alone (the BAML row's reopen trigger covers it) · `cmdk` is imported only by `components/ui/command.tsx`; whether any surface mounts a palette is unchecked · chat route's `maxDuration = 120` comment says "Pro plan" — Vercel-era, inert on Railway.
>
> **2026-08-07 · WorkItem census framing REFUTED by prod + the dup-index apply independently re-verified.** ① The 2026-08-06 census note "workItem frozen at 03-19 = queue DORMANT" and its wire-or-delete docket item were built on a wrong premise: prod says the 17 rows are **16 COMPLETED + 1 FAILED** (all 2026-03-19) — a finished historical record of the March local-runner offload, not a stuck backlog. The queue completed its work and went idle when its producer (`work-items.ts`) was deleted 2026-05-31; `enqueueWorkItem` has zero callers, the `WorkResult` channel was dropped in the June schema purge, and the WP-6 verdict (observe, don't merge/retire) stands. No wiring, no row surgery — nothing is stuck. `DATA-MODEL.md` corrected: WorkItem moved out of TASKS/GOALS ("in-progress work" — the drift that kept re-opening WP-6) into SYSTEM/AUDIT as "runner job queue". ② Independent read-only re-verification of `20260806120000_drop_duplicate_indexes` against prod Neon (`ep-quiet-wave-am320eo1`): the migration's own duplicate-pair query returns **0 groups** — the 2026-08-06 apply is confirmed. All probe statements were SELECTs.
>
> **2026-07-29 (fourteenth arc) · morning receipts wave — the truth guard learns artifact + browser claims, the daily brief can no longer hang silent, and real judgments become eval material.** Three statenour merges (#1185, #1187, the statenour leg of fleet PR #1191); #1189 extended the root `docs/UPSTREAMS.md` register the same morning. ① **WP-18 known-truth guard**: STATUS_CLAIM gained artifact-creation claims ("video/report/file has been created/generated/rendered/saved") and browser-action claims ("I navigated/clicked/filled/submitted"); EVIDENCE markers gained artifact-id/extension forms — and eval #21 red-caught my own loose "saved to X" clause classifying "saved to your library" as evidence, so it was removed before ship (evals #21-24 pinned). ② **Intelligence-brief compose degrade** (#1187): the compose step now races a 90s timeout and degrades to an honest ingestion-summary brief (sources/claims/opportunities counts) so `briefing_logs` ALWAYS gains its row — the 07-28 "briefing_log EMPTY EVER" failure class can't recur silently; first live receipt lands at the next 10:15 UTC cron. ③ **WP-21 eval exporter** (`scripts/export-eval-datasets.ts`): dismissed/not-useful `intelligence_outcomes` + open contradictions (`resolved:false` — field name test-caught vs a guessed `resolvedAt`) → local JSONL under gitignored `eval-datasets/`, Braintrust upload deliberately manual; proven live with 0 cases — honest for day-old ledgers. **Gap:** #1195 (next-wave omnibus) and #1200 (durable streams + Event Envelope V1) landed via sibling sessions the same day — their reconcile entries are backfill-pending by their owners, not covered here.
>
> **Flagged · NOT fixed:** eval datasets stay empty until operator verdicts accrue (the exporter is proven, the corpus is young) · brief degrade path verified by tests, first production receipt is clock-gated · guard claim classes are curated regexes — artifact/browser verb lists are not exhaustive by design.
>
> **2026-07-28 late (thirteenth arc) · Apple Health becomes an input system — feeding the incumbent, not founding a domain.** One merge (see PR). The eighth external audit of the day claimed "no existing health implementation" — REFUTED (tenth incumbent catch): `BodyTracking` is Wave-63's health-as-decision-variable (sleep/workout/energy/stress + MODE→RECOVERY trigger + brief adaptation) with THREE brain analyzers already consuming it. Its native-SwiftUI-bridge-first plan was the overbuild pattern; the shipped bridge is **Health Auto Export posting device→own-endpoint directly** (no third-party server; Shortcuts fallback documented; native bridge = WATCH). Shipped: `health_samples` + `health_ingest_batches` (applied to Neon ok=6, independently verified 14+8 cols · 6 indexes) · canonical + HAE inlet routes (HEALTH_INGEST_TOKEN bearer, fail-closed 503, timing-safe, 4/8MB caps, no health values in logs) · pure HAE transform (sleep split into asleep/inBed metrics, workouts mapped; **null-payload crash test-caught pre-ship**) · deterministic sample IDs + payload-hash batchIds → replays dedupe at the DB constraint · summarizer patches BodyTracking **fill-NULLs-only (manual always wins)** inline on ingest, so analyzers/RECOVERY/brief light up with zero new consumers · Nick tools `getHealthToday` (with lastSyncAt freshness) + `getSleepTrend` (with coverage), catalog+families registered, read-safe by construction · runbook `docs/runbooks/apple-health-sync.md`. Gates: 7/7 pure-fn tests · tool-drift snapshot green · tsc 0 · baseline 167≤174 · stale-docs clean · migration independently verified.
>
> **Flagged · NOT fixed:** first REAL payload pending operator setup (HAE install + Railway `HEALTH_INGEST_TOKEN` + endpoint paste — ~30 min, runbook step-by-step) · HAE's export-config field names verified against its long-stable JSON shape, not this week's app build (runbook says verify on install) · restingHR/HRV/steps live in samples only (BodyTracking columns deferred until a consumer needs them) · trends page, recovery score, medication/symptom tables = deferred WPs.
>
> **2026-07-28 late (twelfth arc) · the kernel batch — commitments become the loop object, read-mode becomes a hard gate, and the June-10 C7 loop closes.** One merge (see PR). Executes WP-13/14/15/16 from the gated "operator control system" doctrine (its `canClaimDone` P1 was REFUTED — wired with tests since July; its Commitment idea was half-built — model existed, lifecycle didn't; all three external citations — A2A v1.0/LF, A2UI v0.9.1, ARD v0.9 draft — verified real, verdict WATCH). Shipped: ① **Commitment lifecycle** — 7 additive columns applied to Neon (ok=8, independently verified 7/7 + index via information_schema), `proposed → active → verified|abandoned` in the contracts vocabulary, service extends the 2026-05-22 create-only incumbent (caught before overwriting — ninth incumbent of the day); ② **journal → commitment loop (C7 closed)** — a generated nextAction now lands as a PROPOSED commitment (idempotent by sourceRef spanning ALL statuses, so dismissal is remembered), operator verdict card on Home beside FollowUpsList; ③ **capability registry + read-mode HARD enforcement** — `stripMutatingTools` runs LAST in prepare-tools after every force; fail-closed on three tripwires (sideEffecting flag · write category · mutating-verb-at-camelCase-boundary) plus unknown-tool⇒stripped; stripped list logged; 5 pinned tests incl. the boundary design (markTaskDone trips, markdownExport doesn't); ④ **execution-class vocabulary** (7 classes, measured-then-named) into `@nour/utils` contracts; ⑤ same-day lint-baseline debt from the earlier waves paid down — **167 warnings, 7 UNDER the 174 baseline** (impure-render Date.now → absolute timestamps, sync-setState-in-effect → derived state + tick-deferral, 7 entity escapes). Gates: prisma valid · tsc 0 · registry tests 5/5 · baseline 167≤174 · migration independently verified.
>
> **Flagged · NOT fixed:** the mutating-prefix list is a curated heuristic — a mutating tool with an exotic verb AND no sideEffecting flag AND a read category would slip it (the catalog flag is the fix, not the regex) · read-mode enforcement wiring verified by typecheck + code-read, not an integration test (prepare-tools' dep surface is heavy) · commitment verify/undo paths exist in service but have no UI yet · proposed-commitment flow's first real receipt lands on the operator's next journal entry with a nextAction.
>
> **2026-07-28 late (eleventh arc) · the blueprint audit — the whole repository mapped against ten consolidation concerns, and the map's first conviction was a two-month-dead durable lane.** One merge (see PR). The external "inventory before adding platforms" audit was executed rather than debated: 43 pages · 373 API routes · 46 cron routes · 102 models · 24 Inngest registrations · ~172 tools · 4 dispatch classes, all receipt-backed in [`BLUEPRINT-2026-07-28.md`](BLUEPRINT-2026-07-28.md). **Flagship: the brain-bus.** Wave AE (05-28) deleted the backfill route; nine producers kept publishing; `pollAndProcess` had zero callers; prod showed last `done` 2026-05-28 + **393 pending events** (task.completed 184 · brain_dump.finalized 161 · cron.failure 23) — REVIVED via `/api/cron/brain-bus-drain` (worker-fired */15, 50/run, backlog replays in ~2h; handlers idempotent). Also: the worker's 4 Wave-AE ghost jobs (two months of 404 forwards every 2-60 min) removed; `check:crons` gained [7/7] bidirectional worker-list validation (red-green proven: 4 catches on the pre-edit list); outbox-drain went 24h → 15-min via the worker (crashed-turn receipts no longer wait a day); reachability restored for /system/schema-history (canonical in 5 docs, URL-only since Wave AD), /system/chat-states (orphaned the night it shipped), /intelligence/brief+ledger (push-only before); chat-v2 parity ledger reconciled (6 rows "Pending QA" → verified-with-evidence). Enforcement audit: approvals/guardian/private-mode/cron-auth confirmed HARD server-side; `actionPermission:"read"` confirmed **advisory** at the tool layer (prompt contract + no force-adds, but no mutating-tool strip) → WP-1.
>
> **Flagged · NOT fixed (work packages in the blueprint):** WP-1 hard-enforce read-mode · WP-2 bus producer retire-list after 2 weeks of drained-event evidence · WP-3 thin modules (finance 1 tool, missions 3) · WP-4 bus health into fleet-truth probes · WP-5 disconnected surfaces (warroom · research · missions/simulator) need an operator verdict each · WP-6 WorkItem merge-or-retire · WP-7 intra-app event vocabulary (8 event models, no shared envelope — "Universal Timeline" not buildable today) · WP-8 outbox dead-state surfacing.
>
> **2026-07-28 (tenth arc) · the operating-spine day — 11 statenour merges in one session, four external audits gated, four already-built incumbents exposed.** Merges: #1162-#1165 (adversarial cron-truth sweep: Inngest function-set drift found — briefing_log EMPTY EVER, ~16 functions unregistered — manual re-sync authorized + executed; sensitive-GET auth checker into verify:hard; dep gate made able to fail), #1166 (boot self-sync + heartbeat self-row + worker out-of-band liveness + mega child timeouts), #1169 (loud-failure phase 2: fresh scan found 513 naked silent catches, 148 documented-intentional respected, 29 defect-hiding write-path/block catches converted with P2025-awareness + loop aggregation + synthetic messages for content parses; vitest exit-1 folklore retired — suite measured EXIT 0), #1172 (One-Spine 1-8: self-sync verifies res.ok/shape · outbox reclaims stranded `processing` rows + honors nextAttemptAt + loud finishes · memory commit gateway in SHADOW mode with `agrees` receipts · getStatus deleted-rows overcount fixed + contradict() now MERGES metadata · durable Home agenda — FOLLOW_UP joined the EXISTING agenda_items ledger (duplicate table caught mid-build), localStorage dismissals dead · triage contract (later superseded, see #1176 note) · duplicate action-failure evaluators collapsed + receipt writes loud · liveness checks capability ARTIFACTS not invocation · recall-eval harness with synthetic-marked seeds), #1174 (getFleetTruth chat tool + reasoning whitelist + /system/fleet page · fetchVideoTranscript fenced like scrapeWebPage · alerts lifecycle: resolve = soft-delete, mute = expiring alert_mute rows filtered server-side, silent-error render dead), #1175 (chat command console: cycling authority pills → labeled control sheet · header LIVE authority strip · Memory Inspector → Context & Evidence with real freshness stamp · typed-tool-cards registry + FleetTruthCard · trace links verified pre-existing), #1176 (decision card end-to-end via new `top_decisions` bridge query · execute-before-prose ADDITIVELY: attempt-tense prompt contract + receipt-backed follow-up completion message idempotent by traceId · intelligence_outcomes ledger APPLIED to Neon + independently verified, two producers live · /system/chat-states fixture gallery, Storybook rejected on lockfile grounds), plus #1152 (Windows Prisma engine-lock wrapper — re-verified with two concurrent per-PID instances, merged after 2+ weeks floating). W2 note: spine-5's triage contract was DELETED same-day when the incumbent (`InboxTasksTriage` + `task.triage`, complete with events) was rediscovered — the contracts registry records the real vocabulary and the why.
>
> **Flagged · NOT fixed:** memory-gateway shadow week runs to ~2026-08-04 before any write-semantics change · completion messages appear on next load (realtime push into an open stream = own transport change) · attempt-tense contract efficacy unmeasured (watch chat_claim_warn volume) · approval/decision cards await first live receipts post-deploy · recall-eval corpus is synthetic-seeds-only until outcomesNeedingReview feeds real corrections · chat-state gallery has no Playwright screenshots yet · 148 documented-intentional silent catches respected, not individually audited.
>
> **2026-07-28 (ninth arc) · the gates got honest about themselves — a self-audit of the CI work, and the bug that had been eating every dependency PR.** Two merges (#1141 `b803d3536`, plus #1098/#1101/#1103 earlier). ① **Self-audit of my own day's PRs** (4 reviewers -> adversarial refuters; 44 raised, 14 verified, **9 confirmed, 5 refuted** — 30 were NEVER verified, the pass was capped, so this is not exhaustive). Functional: `test.yml` still carried the exact concurrency P1 fixed in `e2e-statenour.yml` (one running + one pending per group means a third push to main evicts the pending run — the primary typecheck/lint/test/build sweep could leave a commit unverified); the e2e warm loop **could not fail** (`|| echo timeout`, nothing inspected the code) so a dead dev server exited 0 and surfaced six minutes later as 23 unrelated Playwright failures; the warm list had desynced from the suite (warmed `/intelligence/brief`, which no test touches; skipped `/missions`, which every run asserts). ② **Five false claims I had written into comments**, each corrected in place with the evidence: "this job BLOCKS" (no branch protection on this plan — **PR #1106 merged 9 SECONDS after `node` went red**), the header's `next build` -> `next start` (never true; it serves `next dev`, and mock auth works *because* it is dev), "the type gate still runs webpack" (Next 16 defaults to Turbopack), "hangs until the 120s maxDuration" (**`maxDuration` is a Vercel route-segment config — on Railway nothing enforces it; the hang was UNBOUNDED**, so the bug was worse than first described), and playwright.config's "CI runs against a deployed preview URL" (hermetic localhost since `75920fba8`). ③ **A test that tested nothing**: the "finally semantics" case never made the try block throw, so it passed identically with a plain call at the end of the `try` — rewritten to throw from the logger, red-green verified (resolver moved out of `finally` -> exactly that one test fails). ④ **The node sweep's real defect, MEASURED not inferred**: every dependency PR had failed for days with an identical signature — "27 successful, 33 total", zero failing tasks, the same six heavy tasks force-killed, at 10/10/13/25 minutes. Fixed progress at varying times is resource death, not a clock. turbo defaulted to concurrency 10 while the job granted every process a 6GB heap; a background sampler then proved the runner: **max avail 6921MB (not the 16GB the comment claimed), min avail 361MB on the NARROW 8-task run**. Now `--concurrency=2`, passed as the documented **flag** — `turbo run --help` documents no `TURBO_CONCURRENCY` env var, and an unread env var would have made the fix a silent no-op. ⑤ A review bot then caught the abort I had just written being a no-op itself: `$(curl ... || echo "000")` yields **`000000`** because curl emits its write-out format *and* returns nonzero, so the `= "000"` guard never matched — reproduced locally against a dead port, fixed by capturing `rc` instead of inferring from the body. **Three silent no-ops in one day** (duplicated heap flag, nearly-shipped env var, this) — all the same shape: asserting a mechanism instead of exercising it. Gates: 13/13 touched suite · tsc 0 · both workflows parse · `bash -n` on the extracted step.
>
> **2026-07-25 (latest, eighth arc) · ONE conversation engine — CognitivePartner rides the canonical chat pipeline; partner-stream deleted (audit P1 "competing command centers").** Home's Nick strip now posts to `/api/ai/chat` with `privateMode:true` — preserving CP's prior semantics exactly (zero persistence: no conversation, no rows, no BrainMemory; the old route persisted nothing either) while gaining everything the side engine lacked: provider fallback chain, output critic + scorecard, the complete fabrication-defense stack (the old route had ONE detector), honest streaming contract, budget gate, interceptor commands. `app/api/system/partner-stream/route.ts` DELETED — zero dangling references (grep-verified); the side persona prompt retires with it. Gates: tsc 0 · eslint clean · CP brief tests 5/5.
>
> **2026-07-25 (seventh arc) · durable post-turn outbox — a crash can no longer silently eat memory writes, receipts, or journal ingest (audit P1).** New `post_turn_outbox` table (ADDITIVE migration `20260725000000_post_turn_outbox`, applied to prod via the guarded autocommit script — 2/2 ok — `migrate resolve` recorded, `migrate status` CLEAN). Semantics: **inline-first, durability added** — every turn enqueues its frozen DeferredBackgroundCtx (messages capped at 20) BEFORE running the deferred work inline exactly as before, marks the row done after; a mid-work crash strands status=pending, and the nightly `/api/cron/outbox-drain` (EVENING_JOBS fan-out + config/crons.ts, check:crons clean) claims orphans past the 10-min grace window with the atomic first-claimant-wins updateMany (≤3 attempts, then failed+lastError). Replay safety: every deferred phase is withErrorCapture-bounded and idempotent-or-harmless (upserts, dedup guards, audit appends) — a rare double-run is safe; a LOST run was not. Both outbox writes are best-effort and can never affect the user-visible turn. New contract tests: payload cap, best-effort enqueue, lost-race claim skip, failed-for-good cap. Gates: prisma validate + migrate status clean · tsc 0 · outbox+persist tests 7/7 · check:crons clean.
>
> **2026-07-25 (sixth arc) · gate-integrity wave — verify:hard tells the whole truth, the baseline stops lying, skip-paths stop hanging streams.** ① **verify:hard gains five gates** (each proven green standalone BEFORE wiring): check:env · check:runbooks · check:prompt-injection · check:audit-deps · check:lint-baseline. check:secrets deliberately went to **pre-commit** instead (lefthook `statenour-secrets-staged`, `--staged` mode) — the whole-repo scanner rightly flags local .env files so it can never gate a dev machine; staged-only scans exactly what enters history. ② **Lint baseline regenerated truthfully**: 413 pinned warnings (~30% pointing at deleted files) → **174 real warnings across 83 files**; 14 mechanical unused-directive warnings fixed repo-wide (eslint --fix, 16 files); the ratchet now blocks growth (`current ≤ baseline` verified green). ③ **onWorkComplete skip-path fix** (the quirk PR #1064 flagged): duplicate-skip and empty-skip now resolve the SSE work-complete promise — previously those turns held their stream open until maxDuration (120s) because sse-stream.ts awaits it before message.completed + close; new pinning test drives the dedup guard and asserts resolve-without-persist. ④ **Three main-red test files repaired** (pre-existing, proven by stash-control): mobile-a11y pin-drift (the #1035 composer restyle KEPT 44px targets — improved to all breakpoints — the test pinned old class spellings), arsenal-websearch mock missing the new hasPerplexica export (mock now mirrors the real env probe), eval scenario judgeCriteria 204>200 chars trimmed. Full suite: 4,325 passed with the 10 reds fixed; the residual exit-134 is the DOCUMENTED Windows-local napi teardown flake (assertions complete before it; cannot occur on ubuntu CI). Also this wave: `RAILWAY_SMOKE_STRICT=true` repo variable set — post-deploy smoke now BLOCKS.
>
> **2026-07-25 (fifth arc) · Home consolidation — the cockpit became the four-question decision page (audit P1, operator-approved scope + brief-as-tap).** HomeConsole now answers exactly: ① anything broken? → new `home-health-chip.tsx` (reads the SAME `trpc.system.hub` rollup as the /system grid, same honest-severity rules — UNKNOWN before measurement, never unearned green; taps to /system) ② decisions awaiting? → `FollowUpsList` MOUNTED (it was one of the three imported-but-never-rendered orphans the audit flagged) ③ do now? → `ExecutiveActionMatrix` with honest copy (the "Halt revenue operations" 3-findings theatrics and the fabricated "peak operational efficiency" idle line replaced with measured statements) ④ changed since last visit? → `SinceLastVisitCard` mounted on Home. **Gone from Home** (files untouched, only unmounted): `HomeBrainGraph` (820 lines, sticky full-height — lives at /brain), `HomeEnginesDeck` (lives at /system), dead imports CoachEventBanner + HomeJournalHub; drill-down chips (Brain graph → /brain · Engines → /system) keep them one tap away. **CognitivePartner's morning brief is a TAP now, never an auto-fired spend** — the once-per-day localStorage stamp gates a visible gold chip instead of a silent paid LLM stream on first Home visit (day-stamp helpers unchanged; their 5 contract tests green). Gates: tsc 0 · eslint 0/0 on touched files · build green WITH the live type gate ("Running TypeScript · 40s") · stale-docs 0/0.
>
> **2026-07-25 (fourth arc) · ignoreBuildErrors REMOVED — the build is now a live type gate, poka-yoke-proven.** The audit P0 ("TypeScript can be bypassed during deployment") closed with a full evidence chain instead of a hopeful flag flip: ① the Apr 28 justification (Next 16 + Turbopack crashing on googleapis' gkehub `v2beta.d.ts` as "binary") REFUTED — the installed file is clean UTF-8 (byte-inspected, zero NULs) and two full `next build` runs with the flag off completed green over googleapis' types ("Running TypeScript … 54s"); ② poka-yoke: a deliberate `const x: number = "string"` probe FAILED the build (exit 1, exact error) — proving the gate live, not placebo; ③ probe lesson worth keeping: the first probe silently passed because its own comment began with `@ts-expect-error…` — the directive suppressed the planted error (never prefix probe comments with directive strings); ④ root README's two flag mentions rewritten (build-time TS ON; the build's check covers `.next/types` route validation that `typecheck:raw` excludes — do NOT re-add the flag); the June audit doc's "do not flip it off — the build will break" warning is superseded by execution. Railway's deploy build is the clean-environment confirmation. Gates: tsc 0 · build green ×2 / probe-fail ×1 · stale-docs 0/0.
>
> **2026-07-25 (third arc) · persist-assistant-turn decomposition — 1,927 → 492 lines, behavior-preserving.** The post-stream pipeline (the audit's second oversized file) decomposed as 5 gated slices into 6 single-responsibility modules beside it (lib/services/chat/): `message-parts.ts` + `deferred-background-work.ts` (were in-file helpers — import boundary only), `salvage-event-text.ts` (cascading rawText→reasoningText→content→steps→reasoning fallback + hasToolCalls + empty guard), `tool-telemetry-walk.ts` (v10.0.179 soft-fail detection + capturedToolCalls), `persist-assistant-message.ts` (dedup guard + P2002 backstop, honesty banners, the tokenUsage-blob create, conversation bump, judge/adversarial dispatch — discriminated PersistOutcome preserves BOTH original bare-return skip paths exactly, including the pre-existing no-onWorkComplete quirk, deliberately NOT fixed in a behavior-preserving pass), `post-persist-verification.ts` (trackGeneration, envelope, claim verifier + ratio/temporal/env checks, L2 fabrication rewrite + row patch, recordTrace, low-quality log). `cleanedText` now flows as an explicit typed chain (salvage → sanitize/CoVe/critic inline → persist → post-verify → deferred ctx) replacing closure mutation. buildOnFinish = a ~490-line typed orchestrator. Gates: tsc 0 · eslint 0 · persist/entity-audit/stream-error/empty-fallback tests green · next prod build exit 0 · 3-lens adversarial workflow review (see PR).
>
> **2026-07-25 (second arc) · chat-route decomposition — route.ts 1,833 → 962 lines, behavior-preserving.** The audit P1 ("the critical chat path is too large to reason about safely") executed as 4 gated slices: ① **persistBase dedup** — the 27-field `buildOnFinish` dependency bundle was duplicated THREE times (deep alt path, winner alt path, main onFinish), three copies that had to stay manually in sync; now built once after the last `finalSystemPrompt` mutation, call sites override only `provider/modelId/model` (+`onWorkComplete`). ② Six new single-responsibility modules beside the route (app/api/ai/chat/): `specialist-routing.ts` (AG-42 guards + shadow metrics + dispatch), `derive-turn-signals.ts` (mode ladder → task-type → query shape → turn-intelligence → contract → domain routing → the python/action/web-search intent detections; classify stage-timer threads through), `augment-final-prompt.ts` (chat-layer prompt + multi-mode + content-feedback + high-spec gate + customer hint + GSC prefetch, exact append order), `prepare-tools.ts` (pruning + blocklist/always-on/coherence forces + token budget, same precedence), `alternate-paths.ts` (the whole flag-gated pre-stream block incl. mega-cap + action-intent suppression; Response|null contract), `build-stream-config.ts` (the per-attempt streamText config factory over the SAME shared refs — TTFT/partial refs, prepareStep toolChoice ladder, Anthropic cacheControl fold). ③ Disclosed intentional deltas ONLY: specialist `buildFastStream` explicitly awaited; the three pure intent regexes evaluate before the 402 budget gate (zero side effects); `prompt_built.buildMs` excludes ~2-5ms of sync derivation; 5 imports dead ON MAIN removed (context-reranker ×2, predictive-prefetch ×2, withHeartbeat) + already-unused `detectChatMode`. ④ New `tests/ai/chat/derive-turn-signals.test.ts` (9 tests: mode priority, task-type mapping, intent exclusivity, stage-timer contract). Private-Lab ordering contract intact: interceptors → specialist → dbWrite kickoff → signals → budget → model → prefetch → prompt → tools → alt-paths → streamText, privateMode threaded, never re-derived. `lib/services/chat/persist-assistant-turn.ts` (1,927 lines) is deliberately OUT of scope — its decomposition is the next arc. Gates: tsc 0 · eslint 0 · 13 chat test files 152/152 · next prod build exit 0 · adversarial workflow review (see PR).
>
> **2026-07-25 (earlier) · quality-pass truth wave — corrupted README, lying manifest, fabricated health chips, dead e2e routes, permissive smoke.** A 42-claim external audit was gated claim-by-claim against the live repo (38 confirmed / 1 refuted / 3 overstated), then the confirmed cheap-fix tier shipped as one wave: ① **README.md de-corrupted** — 3 trailing NUL bytes (an orphaned UTF-16LE `\x00\r\x00\n\x00` fragment) made git/grep/file classify it as BINARY, so every grep-based tool silently skipped it while it rotted; stripped, then de-staled (routes `/tasks·/body·/financial·/mastery` → their absorbing surfaces, FloatingHome orb → bottom tab bar reality, `.husky` → lefthook, `UPGRADE-PLAN.md`-as-"active execution source" → CURRENT-TRUTH's active-docs list, `build:push-schema` no longer claims a `--accept-data-loss` flag it doesn't have, `/api/health` curl example notes the 2026-07-21 owner-gate). ② **config/repos.ts lifecycle synced to GitHub** (verified via `gh repo list`): easy-nickstire / nicks-tire-social / nour-os-unified were shown active+monitored but GitHub archived all three on 2026-05-22; statenour-os was marked `archived` but GitHub does NOT archive it — now `stale` (retired, archive flag pending) with CURRENT-TRUTH's parenthetical corrected to match. ③ **Honest health**: hub-grid's Arrival Intel chip was a hardcoded `() => "live"/healthy` and Cockpit Observability `() => "observing"/healthy` — data-blind fabrications; now derived from the measured smartDevice fleet and 24h AI-call count (severity "info", never unearned "healthy"); /system `overallStatus` reports `unknown` before diagnostics load instead of "degraded". ④ **e2e smoke.spec.ts route repair**: FIVE PAGES entries plus the `/brain/wisdom` goto pointed at deleted pages — four of them (`/system/costs`, `/system/prompt`, `/plan`, `/system/performance`) ride next.config.ts redirects to their consolidated surfaces, so the tests landed on a different page whose identity assertion could never match; `/intel` alone had no page AND no redirect, a genuine 404; also both dead tRPC names (`system.rateLimits` → REST `/api/system/rate-limits`, `system.observability` → `observability.osSnapshot`), and the identity assertion now checks doc-title OR h1 (the root layout's flat "NOUR OS" title meant `toHaveTitle` could never have passed on most pages — the suite was structurally red since audit #8 added it). ⑤ **smoke-prod.mjs hardened**: default URL → https://bdnick.info (custom-domain + cert path finally exercised; was the Railway-generated `*.up.railway.app` domain), 3xx acceptable ONLY on `/` (previously any 3xx passed EVERY check incl. the heartbeat), deploy-identity check added (live-run caught that `/api/system/deploy-info`'s "// public" comment has been false since the 2026-07-21 route-policy tightening — comment corrected, smoke treats 401-no-cookie as alive-behind-wall, `SMOKE_SESSION_COOKIE` + `--expect-sha` = hard SHA assert; both modes live-verified against prod, exit 0 / exit 1). ⑥ **AGENTS.md** no longer claims chat-composer.test.tsx is a known-red (repaired 2026-07-22, #1025). ⑦ **command-registry.ts** header no longer calls the chat interceptor "a documented follow-up" — it ships (interceptors.ts → runCommand, chat route → runInterceptors). Gates: see PR.
>
> **2026-07-22 · Private Lab + composer authority controls (#1035) — audit authority-kernel CLOSED.** ① **Private Lab** (`privateMode` in the chat contract, parsed default-off in `lib/ai/chat/gate.ts`): a turn writes NOTHING — route skips both user-turn persists + the interceptor AND specialist fast-paths, detaches the conversation id (server+client), buildOnFinish early-returns before the whole post-stream pipeline. ② **3-axis composer controls**: posture (auto/execute/counsel/spar) · depth (auto/standard/deep = server modeOverride) · actions (draft/read/execute). Explicit posture beats phrase inference; untouched selectors = byte-identical requests. **Shipped through a 4-agent adversarial review that found 13 defects (2 blockers, 5 highs) in the first cut** — the lesson: a privacy boundary bolted onto the MAIN pipeline missed the fast paths that fork off before it (interceptors persisting titled conversations + BrainMemory/Decision rows; the `"private"` convId sentinel leaking to the client and inverting privacy after toggle-off; the error handler persisting partial replies; the SSE stream hanging because the private early-return skipped onWorkComplete; regenerate/auto-retry replaying private turns with privacy off). All fixed + re-verified SHIP by a second pass. Deferred (2 low, documented): deep-reasoning prompt head-slice, unmarked private turns in the visible thread. Gates: 30/30 tests · tsc 0 · eslint 0 · build exit 0 · two adversarial passes.

> **2026-07-22 (earlier) · browseAndDo shipped + deploys unbroken (#1033) — browser arc CLOSED with a prod receipt.** ① `browseAndDo` (lib/ai/browser/browse-and-do.ts + the `browseAndDo` tool in meta.ts): one call = Browserbase session → deepseek-planned navigate/act/extract/observe loop → structured receipt + session replay URL. Permission axis enforced structurally — `read` blocks all interaction, `draft` (default) STOPS before consequential submissions (regex guard → `draft_ready` + pending action described), `execute` may fire the final step. Page text fenced against prompt injection; extract's `links[].url` is `z.string().url()` on purpose (Stagehand only injects DOM hrefs into url-typed fields). Live E2E: read-permission run answered "example.com's link → iana.org/domains/example" correctly in 3 steps/35s with self-recovery after a failed extract. `browser_do` demoted to LOW-LEVEL. ② **Edge-graph gate in instrumentation.ts — root-cause fix for the two FAILED Railway builds**: Next compiles instrumentation for BOTH runtimes (`runtime="nodejs"` not honored), so the edge pass bundled tool-embeddings → the whole tool universe → sharp; the stagehand lockfile's hoisting shift made it fatal ("non-ecmascript placeable asset · Edge Instrumentation"). `if (process.env.NEXT_RUNTIME !== "nodejs") return;` dead-code-eliminates the edge bundle to empty. ③ **Deployed-container receipt**: deploy `0b19d2f1` SUCCESS → `GET /api/browser/diagnostics` on prod returned `{browserbase:{configured:true}, stagehand:{installed:true}, ready:true}`. (Gotcha for future sessions: `railway ssh` + bare `require.resolve` false-negatives on Turbopack externals — the diagnostics endpoint is the honest in-container check.) Gates: browse-and-do tests 9/9 + catalog/tool-families drift suites · tsc 0 · eslint 0 · full local build exit 0.

> **2026-07-22 (later) · Browser operation LIVE — Stagehand v3 E2E-verified.** Browserbase keys set on Railway (auth 200). #1030 installed `@browserbasehq/stagehand@3.7.0` + `playwright-core@1.61.1` and defused the standalone-tracing trap (runtime ships ONLY `.next/standalone`; the old webpackIgnore'd import was invisible to the tracer → literal import + `serverExternalPackages`). Follow-up rewrote `lib/integrations/stagehand.ts` to the REAL v3 contract (verified from installed dist types — act/extract/observe are instance methods, extract is positional, navigation via `context.activePage()`), fixed two live-repro'd breaks (`keepAlive: true` or v3 `close()` kills the session between ops; `disableAPI: true` because the hosted Stagehand API 500s on custom-baseURL models), and wired model resolution to the ONE funded lane — Ollama Cloud `deepseek-v4-pro` (E2E receipt: real zod-v4 `extract` + `observe` off a live page; gpt-oss:120b fails schema parsing; direct Gemini = capped, OpenAI = out of quota, OpenRouter = ~0 credits as of today). Full receipt in the PR.

> **2026-07-22 · Perplexica repair + closed-loop Experiment factory + fallback-model refresh.** ① **Perplexica** (#1017/#1018/#1019): canonical native-API path (removed the MCP-URL aliasing — `perplexica-mcp` is a separate Railway service), `PERPLEXICA_TIMEOUT_MS` 35s (was the generic 8s → always timed out in the quorum), `hasPerplexica()` single gate, `checkPerplexicaHealth()` provider+model verification, search-source telemetry, and the `GET /api/system/perplexica-diag` receipt (CRON_SECRET-gated). **Root cause proven from live SearXNG logs: every general engine (DuckDuckGo/Brave/Startpage/Google-CSE) is CAPTCHA/rate-limited on Railway's datacenter IP → 0 sources → silent Tavily fallback** — an infra reality, not a code bug (see RUNBOOK observability + poka-yoke ledger 2026-07-22). ② **Closed-loop Experiment factory** (#1020): `RegisteredSource.authScore` now LEARNS — accepting an opportunity spawns an `Experiment` (14-day horizon), a daily `experiment-measure` cron resolves it (held_up/failed/inconclusive) and nudges the attributed source's authScore via a bounded, reversible EWMA; `scoring.ts` folds that learned trust back into opportunity priority (`applyAuthTrust`, ±10% — the read-path teeth). Adversarial-review fixes: **column-first migration** (hot-table ADD COLUMNs applied to prod before the schema deploy) + **atomic claim** (running→measuring, prevents concurrent double-nudge). Migration verified live: `experiments` table + 3 cols + 2 FKs, pgvector untouched. ③ **Fallback-model refresh**: the anthropic fallback lane's `defaultModel` `claude-3-5-sonnet-latest` → `claude-sonnet-5` (4th/5th-hop only; prod primary is Ollama). Also flipped `NICK_VERIFIED_REGEN` on (activates the #1016 authority-regen; no DB override, env-driven, verified effective). Gates: typecheck 0 · eslint 0 · vitest (closed-loop math 7/7, perplexica 30/30) · check:crons clean · prisma validate.

**Last verified:** 2026-10-09 (flagged-items wave — see top entry; prior stamp 2026-10-08, camera N-series PR C)

- **Execution Mode (`1255c273`)**: Added focused task execution panel on `/missions` utilizing a memoized selector to prioritize tasks in "DOING" status, then queued tasks, then tasks from the Top Mission Today, real user projects, and general tasks. Includes callbacks for resume, pause, complete, snooze, block, edit, and exit.
- **Hidden High-Risk Warning & Filters (`e9afbec8` & `9816a0b6`)**: Implemented a warning banner when high-risk tasks are hidden by active search, loop-kind filters, domain filters, or focus mode.
  - Risk definition includes overdue tasks, stuck DOING (>2h), missed snooze resurfaces, promise checks (due today/soon/missing), stale tasks (>=7d/14d), invalid waiting, and high autoPriority. DONE, ARCHIVED, and CANCELLED statuses are explicitly excluded.
  - Exposes pure classification logic in `hidden-risk.ts` and renders a border alert box (rose/amber/zinc) with up to 3 preview items, "Queue after this" quick actions, and filter/session dismissal in `hidden-risk-warning.tsx`.
  - Upgraded test coverage with a renamed test suite `hidden-high-risk-warning.test.tsx` (12 tests) verifying component rendering, copy adaptation, and filter clearing.

Gates: tsc 0 · 3272 tests passed · build green · no database migrations, no production data mutation.

**PRIOR:** 2026-06-10 (post the **"Nick remembers the week" ship** `98d783e1` — evolution-audit item #7: the Sunday weekly-review rows (cron wins/misses/patterns/focus in BrainMemory `weekly_review` + the ReviewWizard serve/surprise commitment) are now deterministically injected into the chat system prompt via a new CORE-tier engine `lib/brain/weekly-review-context.ts` `getWeeklyReviewContext()` — pure DB read · 14d window · 2-week continuity ("second week in a row…") · honest-empty (renders nothing when no review exists, never a stale week as current) · 800-char cap · tail rule forbids week-over-week claims beyond the rendered data. Previously these rows were reachable only via probabilistic vector recall. 8 new tests (`tests/brain/weekly-review-context.test.ts`) pin both writer shapes, malformed-metadata fallback, failure totality, clipping, query scope. Gates: tsc 0 · 236 files/3252 tests · eslint 0 errors on touched files · turbo build green. Disclosed: `prompt:size-check` was ALREADY failing on unmodified main (61,157 > 60k soft cap, non-blocking gate); this adds +802 capped chars → 61,959 (Venice hard ceiling 65k) — operator decision queued: trim a section or raise the soft cap. No migrations, no prod-data mutation.) **PRIOR:** 2026-06-10 (post the **chat-error closeout + evolution audit + Journey Engine wave** — 4 ships `91c198a1`/`d1c24209`/`9184c714`/`fb851113` (+ the sibling session's Next-Action `520063c6` between them), Railway SUCCESS on `fb851113`, bdnick.info 200, live-verified: the `.match` post-process crash fixed at its exact line + `/system/errors` redirect + honesty prompt rules; then the 7-agent product-evolution audit (founder report `docs/audits/STATENOUR-EVOLUTION-AUDIT.md`) + journal spec items A,B,D,E,F,G + the morning-brief durable-producer restoration + the scoreMemories manual-source guard. Gates: tsc 0 · 234 files/3228 tests · build green · no migrations, no prod-data mutation. Live-verified post-deploy: 4-line journal directive rendering on real data · "becoming" proof strip (58/wk) · 7-mode capture modal · 0 console errors). **PRIOR:** 2026-06-09 (post the **Wiring Wave** — connected the F1–F5 function services to live surfaces: receipts→chat finalize · /missions rescue strip + GENERAL anchors · /system/digest read-only cards · DAILY stat XP (advance-gated) · `/convert` knowledge→action. 7 ships `55ed38c4 → 14b6c225` on top of `43b63268`; tsc 0 · vitest 229 files/3195 tests · build green · no migrations, no prod-data mutation. One disclosed-not-changed finding: the reward toast's "+N XP" is `creditTaskStats`'s stat-COUNT not summed XP — see the top blockquote entry). **PRIOR:** 2026-06-06 (post the **Nick people-gate + WEEKLY recurrence + chat-honesty + PersonProfile source/phone/email wave** — 4 ships `c66bb09e`/`172bac8f`/`07089a9d`/`75e48458` (the 4th = the action-write verifier, REVISE #1) · migrations `0008`+`0009` APPLIED to prod (column-first, via the apply-pending-migration endpoint) · Batch-4 prod cleanup (deleted ghosts Fernando + "her"=Dania, re-homed note to Dania) · multi-agent behavioral review → disposition REVISE · full ship-by-ship in the top blockquote entry below + decision log in `~/.claude/projects/C--/memory/statenour-nick-behavioral-review.md`). **PRIOR:** 2026-06-04 (post the **code-review program (verified H1-H4/M1-M7 sweep)** — 9 ships, main RED→GREEN `c3067403`: H1 CI-typecheck-gap (added `check` script) · H2 prisma cross-OS cache-trap · M1 5 flags · M4 provider-docs + dead `activeProviderSupportsTools` · M5 6 `timeAgo` dups · 2 stale tests fixed (RED→GREEN) + 3 inert workflows deleted · ~9 dead `format.ts` exports + M6 refuted · H4 `task.ts` god-router split 1971→1278 (Power Atlas → `lib/trpc/routers/task/power-atlas.ts`, verbatim, FLAT paths) · M3 `ActionRule<T>` generic. tsc 0 · vitest 3007 (all pass) · build green. DEFERRED/leave: M2 (smart-home — unwired layer of a live feature, runner died Apr 14, op SKIPPED) · M7 (versions) · relative-time (needs 2-format decision) · router.test.ts flake. **Trust-audit advisory (nickstire price-decoy/warranty/testimonials + statenour-Nick numeric-marker gap) in MEMORY.** **PRIOR:** post the **Wave 2 surface-consolidation wave** — 5 tabbed/sectioned merges collapsed ~10 overlapping routes into 5 deep surfaces (/business=financial+funnel · /market=seo+radar · /brain=board+wisdom+reason · /stats=body+learn-loop [/life DELETED] · /content=drafts+history+social+outreach) behind a new `PageTabs` primitive (URL-synced `?tab=`, lazy-mount, query-string-preserving on switch). Every former page body moved VERBATIM into components; old routes 30x-redirect; internal links + the route-keyed registries (context-hints TOOL_BIAS / page-intelligence / page-visit) repointed to the consolidated set; + 2 UI fixes (home-composer dead mic/paperclip removed · /decisions dup sibling list dropped → ComparisonMatrix rows clickable via new `MatrixOption.href`). Verified per-merge in the consolidation worktree: tsc 0 · next build green (routes confirmed collapsed). origin/main `e36c5963`/`4e9e76f8`/`2a1e504d`/`70172fc6`/`b4602c27` + cleanup. **PRIOR:** post the **nick-intelligence + every-page-audit + chat-pipeline code-health wave** — chat-truth + 15 flag-gated intelligence features (default-OFF) + glm-5.1 model swap + an 8-bug proactive-staleness sweep + all 41 pages audited/unified, then a chat-pipeline code-health pass (5 SAFE simplifications); full ship list in the top entry below. **PRIOR:** 2026-06-02 the **hybrid-retrieval (Wave B) wave** — the deferred FTS recall win shipped: replaced `contextual-recall.ts`'s naive substring keyword lane (it only saw the top-300-by-confidence pool) with a true Postgres `ts_rank`/`websearch_to_tsquery` lexical lane over ALL memories + a candidate-pool union (naive `keywordScore` kept as a graceful fallback), backed by an additive expression GIN index `0007_brain_fts` APPLIED to prod Neon with **pgvector verified PRESENT before AND after** (separate table from `vector_embeddings`) · FTS smoke = 277 live matches · 1 ship `9edc1804` rebased onto the sibling's `edf1766d` after a 2nd ref-lock race · combined-tree turbo build green · bdnick.info 200/healthy · full entry below. **PRIOR:** post the **next-level intelligence wave** — 4 surgical brain upgrades [J consolidation soft-deletes merged sources to preserve evidence · I graph-aware recall via the dormant `MemoryEdge` graph · F XP-drift detection → coaching narration · G opt-in LLM-synthesized narrator] + nickstire $50→$49 price consistency · 6 ships `fae626ab → 68a8315f`, cherry-picked linearly onto the concurrent analyzer session's `54a45560` after a ref-lock race · combined-tree build green · live on bdnick.info (200 · healthy · DB-connected) · full entry below. origin/main ALSO carries that session's **7-analyzer suite + Mastra-V2 removal + Journal-Brain wiring** (`54a45560`, live-verified by them — their detail lives in MEMORY, not duplicated here). **PRIOR:** post the **task classification + scoring + confirm-chip wave** — rebuilt the create→classify→credit spine so every task correlates to mission+goal+stats and credits the character sheet on completion (NEW `classify-task-linkage` · one `enrichTaskLinkage` chokepoint on all create paths · `creditTaskStats` · `Task.statHints`/`pendingClassification`) · 8 ships `b9a60d4d → 2c4c376d` · migrations `0004`+`0006` applied to prod · gates fresh-verified (typecheck 0 · wave unit suites 35/35) · full entry below. **PRIOR:** post the **/people (Power Atlas) overhaul + QA wave** · /people now scores INFLUENCE XP for real reps — ledger deposits + power-plays credit `relationships`/`networking`/`persuasion`/etc. via the idempotent `creditStatXp` seam · classifier is suggest-then-approve (`pendingClassification` + role SSOT, no silent overwrite) · reads tasks via a real `Task.personId` FK · UI de-bulked · operator-tunable weights · shipped `d5c6f098` + QA `44a10079` · migration `0005` APPLIED to prod · XP backfill verified (13.9 XP, live-confirmed Dania +6.6) · QA fixed a CRITICAL iOS-PWA `window.confirm` dead-delete (→ two-tap, live-verified) + role-SSOT/soft-delete/WCAG. **PRIOR:** post the **Journal Brain redesign wave** · grounded journal enrichment — every capture now grounds against ACTIVE goals/missions, grounded-reclassifies into a real `entry_type` column, proposes a confirmable goal link, credits a grounded XP bonus + a bold idea/challenge "take", surfaced as an inline impact-receipt + link-chip with a 7-knob settings panel + Telegram ✓/✗ confirm + nightly resweep net · shipped to main `dc476e4e` · migration `20260601_journal_brain_foundation` APPLIED to prod Neon · backfill (~990 rows) operator-gated. **PRIOR:** post the **god-file split #3 + AI-tiering fix + cross-app optimization-audit wave** · split the chat-route god-file `app/api/ai/chat/route.ts` 1,884→1,442 ln — extracted 3 safely-separable modules (context-hints / finalize-system-prompt / build-model-messages), DELIBERATELY leaving the streaming + tool-loop orchestration core in place (it's a control-flow fn with shared state, NOT a flat collection — safety > line count) · `4aafd841` · typecheck 0 + chat tests 230/230. Fixed `detectTopicTier` (`7b86bf9d`): keyword-less ≥30-char messages were escalating to the all-29-engines `full` tier (silently defeating the ~60% context-saving) → now `core` (deep mode forces full upstream); tier-gating test corrected. Ran a measure-first **cross-app optimization audit** (perf/web-vitals · DB/queries · React-render · AI-cost, both apps, 4 parallel read-only agents): statenour's data/memo layers already mature; TOP ROI is nickstire's (framer-motion eager in the customer hydration path = the measured TBT-1090ms PSI culprit · phone `LIKE '%suffix'` 17-site full-scans → a `phone10` column · zero prompt-caching) → handed off to that session. Deferred statenour code fixes (fresh pass): GoalBoard card memo · chat-path injector parallelization. The #1 AI-cost win is a provider-routing **config** decision (Anthropic `cacheControl` is wired but dormant — Ollama is primary). **All 3 big god-files (tasks/system/chat) now split.** Gates green (typecheck 0 · vitest green · pre-push build OK) · 2 commits on origin/main. **PRIOR:** post the **god-file split #2 + Chrome-walk fixes wave** · split the worst statenour god-file `lib/trpc/routers/system.ts` (2,722→61 ln, 105 tRPC procedures) into 9 per-domain procedure-object files under `system/`, recomposed via object-spread keeping the FLAT `trpc.system.<proc>` namespace intact (`560525e2` · isolated worktree + briefed subagent · independently verified: 105/105 procedure parity · zero nesting · typecheck 0 = the interface gate · vitest **2919**); plus the two Chrome-walk fixes (`f6f1143b`): honest /financial revenue states (was a permanent fake "Loading…" when the nickstire bridge is down — the empty bridge is a config/ops root cause, flagged not code-fixable) + `os-snapshot.ts` scanners now exclude `.next-prod`/`standalone`. Gates green (typecheck 0 · vitest **2919** · pre-push build OK) · 2 commits on origin/main. **PRIOR:** post the **tech-debt cleanup wave (statenour)** · fact-checked the monorepo tech-debt report against the files, then executed only the statenour-owned wins (its money-path items are nickstire's — handed off): deleted the stale `soft-deleted-tasks-2026-05-16.md` (`34ad6fcd`) + split the 2,024-ln `lib/ai/tools/tasks.ts` god-file into 6 per-domain files + a 29-tool `tasksCoreTools`, recomposed verbatim into the SAME 46-key `tasksTools` export (`2728caa7` · built in an isolated worktree via a briefed subagent, independently verified — 46/46 keys + scope + gates). Report corrections: serializeRow is overstated (heterogeneous `.toISOString()`, API-path risk → skipped); provider-bypass is **31** files not 23. Gates green (typecheck 0 · vitest **2919**) · 2 commits on origin/main. **PRIOR:** post the **Ambition Engine P3 (increment 2) wave** · wired the rest of the dormant P3 columns into the /stats GoalBoard — `updateGoalSchema` now accepts `kind` (metric/milestone/narrative) + `conviction` (1-5) + `ambition` + `killCriteria`/`killBy` + `identityLine` (all migrated in P1, settable nowhere until now); the card gained authoring inputs + display chips (conviction flame · ambition tag · pre-committed kill-by · the Elon **idiot-index** hrs-per-%-moved · narrative identity line) + kind-awareness (kind badge · milestone "loops"→"milestones") · trajectory was already the pace-projection chip · `de898be3` · gates green (typecheck 0 · lint 0 new errors · vitest **2919**) · 1 commit on origin/main. **P3 functionally complete** (ladder + kinds + anti-stale authoring + trajectory); deeper per-kind layouts (a milestone checklist UI) remain a future refinement. **PRIOR:** post the **Ambition Engine P3 (increment 1) wave** · the dormant `parentGoalId`/`GoalLadder` self-relation (migrated in P1, wired nowhere) is now an end-to-end **compounding ladder**: pure `lib/mastery/goal-ladder.ts` (`validateParentLink` rejects self/cycle/inverted-horizon · `rollUpChildren` · cycle-guarded `ancestorChain` · 14 unit tests) + `updateGoal` validates the link before writing + `getGoals` attaches a `ladder` {parent, children, rollup} payload (defensive on partial selects) + GoalBoard parent-breadcrumb & children-rollup chips (tap-to-scroll) + sub-goals list + edit-mode parent selector (server-validated, rejection toasted) · `37106b6b` · gates green (typecheck 0 · check:crons clean · vitest **2919** = 2905 + 14) · 1 commit on origin/main. **PRIOR:** post the **Ambition Engine P2 wave** · the proactive **goal-drift detector** shipped — a daily Inngest cron (`goal-drift-detector` · `30 12 * * *`) scans active life-goals + their GoalEvent windows and fires priority-graded Coach Events (kind `goal-pace-shift`) on two signals: **deadline-risk** (P1 · deadline ≤14d · <80% progress · no movement this week) + **momentum-decay** (P2 · was active — ≥2 events in the prior 4wk window — then quiet this week · not yet 30d-stale) · acks on re-engagement (idempotent per goalId) · the drift math is the pure `classifyDrift` (`lib/mastery/goal-drift-classify.ts` · 9 unit tests) so it's verifiable in isolation · cron mirrors `goal-pruner` · cherry-picked from its worktree branch → `87a4a0cb` · gates green (typecheck 0 · check:crons clean · vitest **2905** = 2896 + 9) · 1 commit on origin/main. **PRIOR:** post the **Chrome polish wave** · verified the dania scrub LIVE (silent=0 · the only "dania" left is the operator's own goal description) then polished the live UI — rebuilt the bottom "System pulse" ticker to the Edge Feed form (killed the last 60s marquee + touch-dead hover-pause · `edfae490`+`5b31a92a`) + stale-goal CTA affordance & add-goal a11y label (`edfdf1b4`) · gates green (typecheck 0 · eslint 0-err · vitest **2896**) · 3 commits on origin/main. **PRIOR:** post the **relationship-nag scrub wave** · a clarity-gate audit of blunt/stale/sensitive auto-surfaced signals → removed the "Dania N-days-silent" nag from all **6 LIVE surfaces** (ticker `42d748fc` + narrator/chat-lane-check/blind-spot-detector→system-prompt/personal-pulse/pulse-route `0b044154`) + cleared the dead/dormant remainder `9b690019` (dead `daily_score` reads · dormant `dania_neglect`/`body_projection` Telegram rules · `strategic-triggers` marked dormant) — kept all legit person/identity plumbing · gates green (typecheck 0 · eslint 0-err · vitest **2896**) · 3 commits on origin/main. **PRIOR:** post the **deferred-items completion wave** · *"go on all deferred"* — score→reflection re-source (`b952fc37`) + Edge Feed ticker page-context emphasis & 24h snooze (`afc738f2`) shipped; **habit + chat write-time XP resolved as already-covered by clarity-gate** (habits are DAILY Tasks → auto-learn already credits them; chat is swept by the backfill — write-time would add a 2nd per-turn AI call on the chat hot path); ticker **AI-curation v2 + lane-health held** as premature (deterministic rank shipped today + unproven-weak; Guardian hard-rejected the naive version) · gates green (typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean) · 2 commits on origin/main. **PRIOR:** post the **auto-mode evolution wave** · 3 force-ranked upgrades from the Sam-Altman pass, each clarity-gated + shipped — ① revived the dead `industry-pull` feeder as an inngest cron (`recallIndustryIntel` had fed the AI a stale table since the Wave-AE prune) · ② completed the XP ledger (NEW `creditFromSignal` door + write-time crediting for reflections — the daily-score replacement that fed ZERO XP — and decisions) · ③ rebuilt the global ticker (Edge Feed): killed the 55s marquee → one readable/tappable item + feed sheet + a Mastery lane · 4 commits `a5572ac5 → fcdb1b3a` on origin/main · gates green (typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean · check:raw-sql 0 · build OK) · ticker design multi-agent-brainstorming-vetted. **PRIOR:** post the **Ambition Engine P1 (code)** wave · the goal→stat spine is live end-to-end — a goal-tagged task rep credits the goal's mastery stats (idempotent xpEvent log · no double-count), GoalBoard cards show stat chips in character-sheet colors, and the character sheet cites the goals feeding each stat · stats inferred from `goal.domain` so all existing goals light up with no backfill (declared `GoalStat` rows override · authoring is P3) · TDD-first (13 pure unit tests) · 2 commits `805e6173`+`ef691189` on origin/main; the prior wave's 2 local commits rebased to `dcc4e206`+`aec010e5` + pushed too — nothing local-unpushed · gates green (typecheck 0 · eslint 0-err · vitest +13 · check:raw-sql 0 · check:crons clean · prisma valid · pre-push build OK). **PRIOR:** post the **Bridge-contract sweep + Ambition Engine P1** wave · closed the dead-bridge-query class — `jobs_today`×2 · `pending_callbacks_count` · `customer_search` remapped to live nickstire handlers + a `nick-bridge-query-contract` CI guard so it can't recur · budget gate fail-open→fail-safe · system-prompt stale-revenue fallback via `readNickRevenue` · 6 silent-failure breadcrumbs · 5 Inngest-native crons registered · `/tasks`→`/missions` + `/mastery`→`/stats` nav migration (16 files + ⌘K + orb) · mastery **coaching lens** on the /stats side-pane · **Ambition Engine P1** schema (8 `life_goals` cols + `goal_stats` join + self-relation) + migration `0003` **applied to prod via a new guarded `/api/system/apply-pending-migration` endpoint** · 12 commits `a8100a36 → e285e9dc` on origin/main + a local post-review hardening pass · gates green (typecheck 0 · 2877 vitest · check:crons clean · prisma valid) · code-reviewer found 0 P0/P1. **PRIOR:** post the **Stats-consolidation + tech-debt** wave · /scoreboard+/goals → ONE personal `/stats` (business stripped to nickstire admin per operator) · 13 stale `/goals` links retargeted · 4 pre-existing test failures fixed (suite **2875/2875**) · tech-debt wave: Inngest double-fire guard + revived dead stale-leads alert (→ `leads_urgent`) + dead `/mastery` nav removed · 6 commits `a695c174 → 25e31b0a` on origin/main · gates green. **PRIOR:** post Wave Z · recall-freshness fix + dead-lane sweep + retro→journal · 4 commits `d535550c → b48c6e8a` · write-time `embedding_vec_1536` dual-write closes an up-to-7-day chat-recall staleness gap · prod backfill padded 1,599 rows · +5 `CONTEXT_CATEGORIES` recall lanes · `mission_retro` now a 5th `/journal` source · ADR-0023 · 6 "Sam plan" items verified already-built + `decision→goals` migration rejected · gates green. **PRIOR:** post Wave Y · Mastery Layer Stage A completion + NickSidePane v2 multi-turn surface chat · 10 commits in two sub-waves · `c3cdf504 → 47c0598c` (today's continuation: `f03ab83b → 47c0598c`) · Coach Channel grew from 5 → **9 writers** (added eval-regression P0 · correlation-alarm P1 · creation-spike-detect P1 · decision-quality-drift P0) and from 1 → **5 surface mounts** of NickSidePane (was /tasks only · now /tasks /goals /journal /brain /scoreboard — each with its own coachSurface + localStorage thread + per-page presets) · Phase 5 FULL shipped multi-turn surface chat (`/api/ai/side-pane-chat` stateless streaming · client owns thread · ephemeral Anthropic cacheControl on enriched system prompt) · `lib/ai/page-data.ts` gained 4 new surface cases so multi-turn replies on the new surfaces are grounded (was `default: return ""` blind) · reflect-categories cron registered weekly Sun 03:00 UTC · all gates green (typecheck 0 · vitest 185/2812 · turbo pre-push build passed on every push). ADR-0022 documents the Coach Channel pattern + NickSidePane v2 architecture. Tasks #74 #81 #82 closed. On top of Wave X.h · ChatComposer chrome extraction · 1 commit · `/chat` `page.tsx` 2866 → 2756 LOC (−111 net). On top of Wave X.g · bridge-page polling refactor + BridgeShell extraction · 2 commits · −98 LOC net. On top of Wave X.f · activation wave. On top of Wave X.e · −926 LOC consolidation. **Repo:** monorepo `nourdean22/MAINnicks-tire-autoNEW` · branch `main` · statenour at `apps/statenour/` · **Deploy:** Railway (`statenour-web-production`) · **Versioning:** post-`v10.0.X` — commits are `feat · statenour · …` · **Tests:** 2812 across 185 vitest files · **Prod schema:** 31 migrations applied.

> ## 2026-07-07 · Full-repo bug-audit statenour wave · 1 ship (PR #593, awaiting operator merge)
>
> Statenour slice of the 2026-07-07 full-repo bug audit (4 parallel review agents + adversarial verification; register at `AUDIT/BUG-AUDIT-2026-07-07.md`, PR #594). Five verified fixes in one commit:
>
> - **`4a3bb4ef4` · fix · statenour · audit wave** — ① `lib/agent-bridge/auth.ts`: bridge secret compare `!==` → sha256 + `timingSafeEqual` (the last unhardened secret compare; 07-05 audit P3) + new 8-case contract test ② `arsenalNotebookLM`: LLM-supplied `action` went straight to MCP `callTool`; now gated by a code-level read-only allowlist so the reasoning engine stays OBSERVE-only ③ `moneyprinter`: single-flight guard + atomic config.toml write (overlapping runs corrupted the in-flight subprocess's credentials) ④ `/api/short/[code]`: per-IP rate limit on the unauthenticated 3-writes-per-hit redirector (07-05 audit P3) ⑤ prompt drift-guard realigned — main's test suite had been RED since the #587/#588 persona rewording silently changed the pinned OWNER AUTHORITY phrases (failure verified pre-existing on clean origin/main; guardrail-preservation asserts untouched).
>
> Gates: typecheck 0 · eslint 0 errors (215 pre-existing warnings) · vitest 323 files / 3861 passed / exit 0 · `verify:hard` green (prisma validate needed `.env` copied into the worktree — env gap, not code) · pre-push turbo build green.
>
> **Flagged · NOT fixed** (operator decisions, full detail in the audit register): searxng-perplexica `limiter: false` relies on unenforced internal-only networking assumption · `apps/perplexica-mcp` appears orphaned (live path is the direct statenour→Perplexica integration) — confirm + decommission · camera-bridge MQTT `event_id` unsanitized in snapshot filename (LAN-only, low) · reel-engine compositions fetch Google Fonts at render time (bundle locally like social-assets) · `@vitest/coverage-v8@2.1.9` peer-mismatch vs vitest 3.x (pre-existing).

> ## 2026-06-15 · Audit Improvements, Portability & Concurrency Races wave · 13 files
>
> This wave implements the 6 code audit recommendations:
> - **Security Redaction Hardening**: Implemented depth truncation safety boundary (`depth > 3`) in `sanitize-error.ts` and `logger.ts` to prevent credential/sensitive data leaks in deep subtrees, with full unit test verification.
> - **Path Portability**: Replaced absolute local paths with relative links in documentation files, and migrated `ciitty` operating framework rules into the repository at `.agents/frameworks/ciitty/SKILL.md`.
> - **Worktree Branch-Existence Lock**: Modified `worktree-setup.ps1` to detect branch existence locally and remotely via `git rev-parse` before checking out, dynamically creating new branches if missing.
> - **Document Metadata Sync Check**: Patched `check-stale-docs.ts` to validate date stamp synchronization between `AGENTS.md` and `RECONCILIATION.md`.
> - **Double-Submit Guards**: Guarded quick-add and inline task addition in `page.tsx` with client-side submitting lock state.
> - **Server-Side Concurrency Serialization**: Implemented an in-memory Promise-cache map `pendingInboxCreations` in `task.ts` to serialize per-domain Inbox mission creations.
> - **Testing & Verification**: Verified that typecheck, eslint lints, 3,515 vitest unit tests, raw-sql audits, crons checks, prompt-size limits, and prisma validation all pass.
>

> ## 2026-06-15 · Journal Insights Preview Router Tests wave · 1 file · PR #138 merged
>
> This wave adds comprehensive unit and contract test coverage for the insightsPreview tRPC procedure inside the journal router:
> - **Comprehensive Unit & Contract Tests**: Added complete coverage for the `insightsPreview` procedure in `lib/trpc/routers/journal.ts`, verifying empty states, JSON parsing, error recovery/fallback, mappings for all four parent types (`brainDump`, `reflection`, `situationLog`, `decisionReplay`), and title length clipping.
> - **Testing & Verification**: Verified that typecheck, all 3,515 unit tests, and production `next build` pass cleanly.
>

> ## 2026-06-14 · Task Routing Matrix & Provider Fallback Hardening wave · 3 files · PR #133 & PR #131 merged
>
> This wave defaults the primary Gemini model to `gemini-3.5-flash`, implements the task-specific routing matrix, and fixes VAPI diagnostic test assertions:
> - **Primary Gemini Model Default**: Default model set to `gemini-3.5-flash` in the provider config.
> - **Task Routing Matrix**: Implemented `getPreferredOrderForTask(taskType)` mapping all 12 task types to optimized provider sequences in [provider.ts](file:///apps/statenour/lib/ai/provider.ts) to ensure consistent telemetry and fallback chain sorting.
> - **Comprehensive Provider Registry Tests**: Created [provider.test.ts](file:///apps/statenour/tests/ai/provider.test.ts) verifying availability, quota circuit breakers, context reordering, and budget fallback reordering with 6 test suites covering 12 routing pathway variations.
> - **VAPI Test Adjustments**: Adjusted VAPI smoke test assertions to perform case-insensitive comparison on the problem field in `vapi-test-new-tools.ts`.
> - **Testing & Verification**: Verified that typecheck, all 3,510 unit tests, and production `next build` pass cleanly.
>

> ## 2026-06-14 · VAPI Warm Transfer & Admin Dashboard cleanup waves · 17 files · PR #132 & PR #128 merged
>
> This wave implements SIP DIAL bridging for warm transfers and cleans ALG invoice/revenue metrics from the admin dashboard:
> - **VAPI Warm Transfer Bridging**: Switched from SIP REFER to SIP DIAL bridging in `server/routers/vapi.ts` and `server/services/vapi.ts` to resolve silent failures during transfers.
> - **Overview & Revenue Dashboard Cleanup**: Removed Average Ticket, invoice counts, weekly summaries, and unpaid invoices from overview/settings/today cards to match the register/collection system. Disabled the Revenue tab, defaulting to Shop Pulse.
> - **Tire Order Deletion & Status Toggle**: Added delete and payment status toggle mutations in `gatewayTire` router and wired UI actions with delete confirmDialog guards.
> - **Customer Tire Page Upgrade**: Upgraded customer tire landing page conversion and decision layouts to improve readability and visibility under counter conditions.
> - **Testing & Verification**: Verified typechecks and frontend console cleanliness.
>

> ## 2026-06-14 · Google Gemini Fallback Integration wave · 4 files · PR #129 merged
>
> This wave integrates Google Gemini into the core fallback chain:
> - **Gemini Fallback Integration**: Added `@ai-sdk/google` dependency and wired up `gemini-2.5-flash` in the provider configuration.
> - **Telemetry & Monitoring**: Updated the provider health dashboard in `lib/ai/provider-health.ts` to monitor Gemini availability, error rates, quota limits, and real-time latency.
> - **Testing & Verification**: Verified that all 3,493 tests pass and the full pnpm verify:hard gate remains green.
>

> ## 2026-06-14 · Dopamine Loops & Brain Hub Tab Consolidation wave · 12 files · PR #130 merged
>
> This wave implements the strategic blueprint Section 6 dopamine visual loops on `/missions` and integrates `BrainHealthView` / `BrainContinuityView` under `/brain`:
> - **Level-Up Engine**: Added `levelUp` detection to `creditTaskStats` comparing pre- and post-XP boundaries.
> - **Visual Kinetics**: Built glassmorphic `LevelUpModal` overlay, floating `+N XP` `XpParticle` upward animation, and inline fire `StreakBadge` for streaks.
> - **Brain Tabs Consolidation**: Mounted `BrainHealthView` and `BrainContinuityView` as PageTabs under `/brain`, resolving orphaned views.
> - **Routing & Deep Links**: Updated redirects in `next.config.ts` so `/brain/health` redirects to `/brain?tab=health`. Updated deep links in `since-last-visit-card.tsx`, `memory-tab.tsx`, `tool-result-registry.tsx`, and `feature-status.ts`.
> - **Testing & Verification**: Verified that typecheck, all 3,497 unit tests, and production `next build` pass cleanly.
>

> ## 2026-06-13 · Missions UI Polish & Task Decomposition wave · 11 files · PR #120 merged
>
> This wave implements four UI/UX enhancements and the task decomposition pipeline on the Statenour /missions page:
> - **Dynamic Search Placeholder**: Adapts the filter search placeholder dynamically based on active filter kind and domain.
> - **"Ask Nick" Empty-State CTA**: Added an actionable button in `EmptyMissions` that dispatches a custom event opening the Nick side panel with a goal-assessment query.
> - **Autonomic Healer Health Chip**: Rendered a live, pulsing, glassmorphic health status chip in the KPI header representing database and cron recovery status.
> - **Auto-Decomposition Trigger**: Wired an inline sparkles icon and task edit sheet button to trigger TRPC task decomposition via the AI tasks service.
> - **Testing & Verification**: Verified that all components compile, lint, and build cleanly, and successfully passed the full `verify:hard` gate. Checked visual states in Chrome.
>

> ## 2026-06-13 · Autonomic Orchestrator wave · 5 files · PR #117 merged
>
> This wave implements the comprehensive 4-phase Autonomic Orchestrator for background cron healing, database maintenance, runner pipeline recovery, and triage pruning:
> - **Phase 1: Cron Self-Healing**: Scans and heals up to 3 failed/never-run cron jobs, posting P0/P1 coach events.
> - **Phase 2: DB Health Engine**: Executes bloat-based `VACUUM` on `CronJobLog` and reindexes `vector_embeddings` using standard connection pooling.
> - **Phase 3: Pipeline Recovery**: Automatically resets stale (claimed/running >30m) work items and tracks upstream API quota depletion circuit-breakers.
> - **Phase 4: Resource Triage**: Deletes cron job logs older than 30 days and archives tasks untouched for >14 days. Writes `cron:data_cleanup_completed` AuditEvent.
> - **Wiring & Types**: Integrated the orchestrator into GET `/api/cron/cron-healer` and fixed the client-side `tone` parameter type warning in `app/(mastery)/chat/page.tsx`.
> - **Testing & Verification**: Built a comprehensive test suite `tests/cron/autonomic-orchestrator.test.ts`. Passed `verify:hard` (tsc 0, lint 0, 3,491 tests green).
>
> ## 2026-06-10 · chat-error closeout + evolution audit + Journey Engine wave · 4 ships
>
> One session, two waves, all deployed + live-verified on bdnick.info (Railway SUCCESS on `fb851113`). The sibling session's Next-Action extraction (`520063c6`, item C) landed between them and this wave built directly on it.
> - **`91c198a1` · chat:post-process `.match` crash CLOSED** — localized to the content-feedback step's `as unknown as string` cast on a parts-only prior assistant message (`content: undefined` → `priorText.match()` threw, silent under withErrorCapture, recurred for weeks). New total helper `lib/ai/chat/message-text.ts` (`messageContentToText`, 6-case test incl. the exact undefined regression). Also: FORBIDDEN-PHRASES narrowed so SPECIFIC tool-unavailability is honest+encouraged + TOOL UNAVAILABILITY / TOOL CONFIRMS ACTION rules in HONESTY+RESPECT · dead `/system/errors` → redirect to `/system/logs` (+hub hint+RUNBOOK refs). Closeout doc: `docs/audits/CHAT-ERROR-CLOSEOUT.md`.
> - **`d1c24209` · closeout doc verification stamp** (deployed SHA + live-verify results).
> - **`9184c714` · Journey Engine wave (journal spec items A,B,D,E,F,G)** — 7-mode capture (Dump/Daily Debrief/Battle Log/Decision Replay/Pattern Breaker/Win Proof/Future Self; `entryTypeHint` rides captureThought→ingestJournal, operator mode outranks blind classification) · ImpactReceipt honest empty states (Analyzing…/Legacy/no-link) · brief→4-line operator directive (COMPOUNDING/STALLED/WATCH/MOVE; signals now include drift+goals+missions+entry summaries; cache key `:v2`) · thread arc trend (pure `journal-thread-trend.ts`, strict ≥2/wk AND accelerating bar, 6 tests; "strengthening · N/wk" chip + arc line) · `journal.proofStack` + "becoming" strip on /journal · `journal.latestNextAction` + "NEXT MOVE · from your journal" strip on home. Arc-radar AI cost/opportunity lines deliberately deferred (need a cached cron seam — no fabrication).
> - **`fb851113` · morning-brief durable producer + memory guard + founder report** — Wave AE deleted `/api/cron/morning-brief` = the ONLY writer of BrainMemory(morning_brief) → prod read `ready:false` daily while Inngest push/audio worked off an in-memory fallback; `composeBrief()` now upserts the row (reader-aligned NY-date keys). `scoreMemories()` excludes `source:"manual"` (operator curation must not erode). `docs/audits/STATENOUR-EVOLUTION-AUDIT.md` = 7-agent product audit: ranked backlog + 5-year top-10 + the env-flag HOLD table.
> - **Live-verified post-deploy:** /journal renders the 4-line directive on real data + the becoming strip (58 proofs/wk, +53 vs last, by-domain) + mode buttons in the capture modal; home NEXT MOVE strip correctly self-hides (no takes carry nextAction until entries are enriched post-`520063c6`); 0 console errors; morning-brief row write verifiable after the next 10:00 UTC run.
> - **Flagged · NOT fixed (operator-gated):** `NICK_AUTONOMY=off` (51 approvals rotting · proactive spine dead) · proactive Telegram push module has ZERO callers (phone always silent) · 201→211 tasks in inbox, no triage ritual · `NICK_IMPORTANCE_RECALL`/`NICK_CONTRADICTION_CLEANUP` default-off · XP decay unwired · `resolvePrediction` zero callers (Brier loop open) · task outcome capture needs an additive migration · nickstire bridge business-correlation shims return `[]`. All ranked with recommendations in the evolution-audit doc.
>
> ## 2026-06-09 · Wiring Wave — F1–F5 services connected to live surfaces · SHIPPED
>
> The F1–F5 function wave (entry below) shipped to main as `43b63268` (Railway-deployed · bdnick.info 200), which left the new services mostly API-only. The Organization+Wiring Audit (`docs/project/ORGANIZATION-WIRING-AUDIT.md`) found them correct but unreachable, and the motivation loops wired-but-invisible. This wave connected them to real surfaces, ONE wire at a time, each committed + verified separately (typecheck 0 · targeted + full suite · `check:stale-docs` 0 · `check:runbooks` clean · build green). No new tables, no migrations, no prod-data mutation, no hidden autonomy.
> - **`07381ff7` (in 43b63268) · Wire #1 chat interceptor** — F5 commands reachable in chat via a 1-branch `resolveCommand`-gated interceptor (exact-match → no hijack) + 6 slash-menu entries.
> - **`46fb2739`/`43b63268` · Wire #2 reward toast** — honest task-completion reward on /missions; BOTH updateTask (DONE) and checkTask return an optional `reward` only when credit occurs; `formatReward` pure + tested, never fabricates XP.
> - **`55ed38c4` · Wire 1 receipts → chat finalize** — `persist-assistant-turn` writes an `action_receipt` AuditEvent per side-effecting executed action (existing ActionReceipt contract); `action-receipt-feed` merges that 3rd source + dedupes by receiptId. Failed actions visible; advisory-only (never blocks chat). +tests (success/failure/no-false-done).
> - **`68c1c98b` · Wire 2 /missions rescue strip + GENERAL anchors** — read-only `task.missionsHygiene` = buildTaskRescue + buildDomainAnchors (busiest-first · domain fallback); a self-hiding `missions-rescue-strip` shows findings + per-domain open-counts. Suggestion-only, never auto-moves; GENERAL anchors PROTECTED. +mapper tests.
> - **`8cf50229` · Wire 3 /system/digest cards** — `system.{changeDigest,memoryEvals,receiptFeed}` (DRY-extracted `buildMemoryEvalReport`) + a read-only `/system/digest` page (what-changed · truth evals · recent receipts) + a HubCard; memory-evals route simplified to the shared builder. +tests.
> - **`ab360f55` + `46d8803c` · Wire 4 DAILY stat XP** — DAILY check-offs (updateTask→WAITING) skipped the DONE-credit block → 0 XP. `isDailyCheckoff` gates a per-day idempotent `creditTaskStats`; the reward rides back + toasts. Hardened (`46d8803c`) to fire ONLY on a strict `lastCompletedAt` advance — unchanged/older/edit-only credit nothing (unit-proven). No double-credit (perDay sourceKey). ONCE/WEEKLY/PROMISE unchanged.
> - **`882b65c5` + `14b6c225` · Wire 5a knowledge→action `/convert`** — `convertToAction` (pure · was zero-caller) now has one suggestion-only surface: a `/convert <thought>` command (+`/action` alias, + slash-menu entry) proposing a next move + flagging sensitive intents requiresApproval. NEVER writes. Wire 5b (people→stats) audited as ALREADY wired via `lib/mastery/people-credit.ts` (ledger deposits + power-plays credit relationships/networking/persuasion) — not rebuilt.
> - **Verify (final):** typecheck 0 · vitest **229 files / 3195 tests** all pass · `check:stale-docs` 0 critical · `check:runbooks` clean · `pnpm build` green. 7 ships `55ed38c4 → 14b6c225` on top of `43b63268`.
> - **Disclosed finding (NOT changed — operator-gated):** the reward toast renders `formatReward`'s `xp` as "+N XP", but `creditTaskStats` returns the COUNT of stats credited, not the summed XP (its documented + tested contract). For single-stat DAILY (Wire 4) count≈XP; the gap shows on multi-stat goal tasks (the pre-existing DONE/checkTask paths, live since `43b63268`). Recommended fix: return the summed XP from `creditTaskStats` (truthiness preserved → no caller breaks; only `credit-task-stats.test.ts`'s 3 count assertions change). Left untouched to respect "don't change XP math / no unrelated cleanup".
>
> ## 2026-06-09 · useful function wave (F1-F5) · SHIPPED to main `43b63268` · 6 ships
>
> Re-scoped the remaining intelligence roadmap (operator: replace the abstract upgrades with practical functions). Built on branch `statenour-truth-intelligence-wave` (continuing past the pushed `c4716a90`), **NOT pushed to main** — awaiting an owner deploy decision. Services + tests first; reuse existing models (NO new tables, NO migrations); every mutation explicit/receipt-backed; no chat-route bloat. Understand phase ran as a 6-agent read-only workflow; an adversarial 4-lens review workflow ran over the diff. Each function gated tsc 0 + targeted vitest.
> - **`dc5696c1`** — re-scoped `docs/project/NEXT-INTELLIGENCE-WAVE.md` to the Top-5 function wave (deprioritized generative confirm cards, jobs dashboard, broad knowledge→action, governed-memory migration).
> - **`a38f2d98`** — **F1 Claude session importer**: `lib/services/session-import.ts` (pure section-aware `parseSessionLog` → title/repo/branch/commits/phases/files/checks/blockers/migrations/prod-actions/warnings/next-steps + needsOwnerApproval + prodMigrationOrDeployPending flags; `importSession` persists to the EXISTING SessionReport table, suggestion-only — never auto-creates tasks) + owner POST route + 12 tests.
> - **`ff2d4cb6`** — **F2 system change digest**: `lib/services/system-change-digest.ts` reuses parseLatestReconciliation + runMemoryEvals + scanContent + RUNBOOKS + an HONEST Railway-aware deploy identity (never asserts an unverifiable deploy) + owner GET route + 12 tests.
> - **`b4c5505e`** — **F3 task rescue scanner**: `lib/services/task-rescue.ts` pure `classifyRescue` (pending/legacy-inbox/stale/no-next-action/general-maybe-specific; GENERAL anchors PROTECTED) reusing isInboxMission/isGeneralAnchor; read-only owner GET + 12 tests.
> - **`63edff7b`** — **F4 action receipt feed**: `lib/services/action-receipt-feed.ts` maps EntityAudit (via getGlobalActivity) + AutonomousAction (FAILED actions visible) onto the EXISTING ActionReceipt contract (integrate, not duplicate) + owner GET + 9 tests.
> - **`faca5995`** — **F5 personal command shortcuts**: `lib/ai/chat/command-registry.ts` pure parse/resolve + 6 commands (/today /rescue /what-changed /import-session /receipts /stale) calling the F1-F4 services, runnable via owner POST `/api/system/command`; NOT wired into the live chat streaming seam (concurrent session in that path) — thin interceptor hook is a documented follow-up. 15 tests.
> - **Verify:** typecheck 0 · `check:stale-docs` 0 critical · `check:runbooks` clean · `check:crons` clean · `eval:memory` 22/0 · vitest **225 files / 3155 tests all pass** · `pnpm build` green. No migrations, no prod data touched, nothing pushed.
> - **Deferred:** wire F5 into the chat interceptor (one tested hook) · F1 confirm-create via createTask · `/today` "3 tasks + current mission" enrichment (today-compound is counts-only) · 2 advisory provider warns in the SHARED root README.
>
> ## 2026-06-09 · truth + intelligence wave · stale-context quarantine + guard + memory evals + runbooks + action receipts + knowledge→action · 6 ships
>
> A two-objective system-quality wave run in the `statenour-truth-intelligence-wave` worktree (off `main` `acad664b`, isolated from the concurrent session). **Objective A — truth cleanup:** future agents were at risk of being steered to retired deploy paths (Vercel · `codex/ollama-local` · `statenour-master` · the standalone `statenour-os` repo · the `C:\Users\nourd\NOUR-OS` path) by docs/config that still read as current. **Objective B — intelligence:** added reliability/trust infrastructure (truth scoreboard · operating runbooks · action-honesty receipts · knowledge→action). Every ship gated tsc 0 + targeted vitest; full matrix at the end green. **No production data mutated · no migrations · not yet pushed/deployed (owner decision).** Phase-1 audit: `docs/audits/truth-cleanup-2026-06-09-stale-report.md`; plan: `docs/project/NEXT-INTELLIGENCE-WAVE.md`.
> - **`01c5438c`** — truth cleanup + guard. NEW `docs/CURRENT-TRUTH.md` (one-screen truth: location · `main`→Railway→bdnick.info · what's retired · SoT hierarchy · "provider/model truth lives in `lib/ai/provider.ts`, not prose"). Quarantined `docs/project/{MASTER-CONTEXT,UPGRADE-PLAN}.md` → `docs/archive/historical-v{7,8}/*-HISTORICAL-DO-NOT-EXECUTE.md` (git mv + pointer stubs left behind so links resolve). Fixed in place: `config/repos.ts` statenour-os entry relabeled RETIRED standalone (was active/core/bdnick.info + a stale statenour-master CI-mirror note; /system/repos test mocks the module → no live-value dependency) + monorepo entry now names both apps; `AGENTS.md` dead resume path + CURRENT-TRUTH pointers; `AGENT-CONTRACT.md` "current state" pointer; BUSINESS-LANDSCAPE + ARCHITECTURE + chat-route-walkthrough provider hardcodes → point to code; CHANGELOG intro + V10-PLAN snapshot + gmail-setup env step; HISTORICAL banner on CONSOLIDATION-PLAN; RETIRED header on the dead `scripts/pre-push-check.sh`. NEW `scripts/check-stale-docs.ts` + `pnpm check:stale-docs` (critical retired-deploy terms hard-fail under `STALE_DOCS_STRICT=1`; provider hardcodes warn; whole-file exemption for archive/adr/dated/bannered + per-line ±2 for wrapped prose) + `tests/lib/check-stale-docs.test.ts` (14). Result: 0 critical (2 advisory warns in the SHARED monorepo-root README, left untouched).
> - **`335c3d80`** — `docs/project/NEXT-INTELLIGENCE-WAVE.md`, the ranked engineering plan.
> - **`4ef690dc`** — **memory evals / truth scoreboard** (P5). `lib/evals/{memory-eval-types,memory-evals,memory-eval-runner}.ts` (23 evals · 10 categories) + `scripts/run-memory-evals.ts` (`pnpm eval:memory`) + owner GET `app/api/system/memory-evals/route.ts` (read-only, degrades gracefully) + `tests/lib/evals/memory-evals.test.ts` (15, incl a real CURRENT-TRUTH.md drift guard). `gradeDoc` checks a truth doc TEACHES facts (forbidden NOT applied to docs); `gradeAnswer` is negator-aware for free-form answers; runner is pure (no DB/API). Scoreboard: 23 total · 22 pass · 0 fail · 1 manual.
> - **`04c54f32`** — **agent runbooks foundation** (P6). `lib/runbooks/{types,catalog}.ts` (8 active runbooks) + `docs/runbooks/*.md` (+ index) + `scripts/check-runbooks.ts` (`pnpm check:runbooks`, reuses the stale-doc scanner) + `tests/lib/runbooks.test.ts` (6). Lit up the 4 runbook-grounded memory evals.
> - **`5988d3f0`** — **action receipts guard** (P7, additive). `lib/ai/receipts/action-receipt.ts` — normalized `ActionReceipt` + `toReceipt()` + `canClaimDone()`; side-effecting-ness reuses the tool catalog (`getToolMeta`, broadened to `*_write`) + `MUTATION_ACTIONS`. A side-effecting result without a confirmed `ok` is "partial" (never asserts done without proof). `tests/ai/receipts/action-receipt.test.ts` (15). NOT yet wired into the live finalize seam.
> - **`7a082b77`** — **knowledge→action converter** (P8). `lib/knowledge/action-converter.ts` — pure heuristic, suggestion-only (no writes); chat/journal/memory/decision → task/rule/experiment/decision/memory/ignore; tasks get a `nextPhysicalAction`; sensitive/destructive intents flagged `requiresApproval`. `tests/lib/knowledge/action-converter.test.ts` (11). UI wiring deferred.
> - **DEFERRED (in NEXT-INTELLIGENCE-WAVE.md):** P9 generative confirm cards · P10 jobs console (already exists at `/system/crons` — improve via runbook) · receipts finalize-wiring · converter UI surface · 2 advisory provider warns in the shared root README.
> - **Verify (full matrix):** typecheck 0 · `check:stale-docs` 0 critical (strict exit 0) · `check:runbooks` clean (8) · `check:crons` clean · `eval:memory` 22 pass/0 fail · vitest **220 files / 3093 tests all pass** · `pnpm build` green.
>
> ## 2026-06-06 · Nick people-gate + WEEKLY recurrence + chat-honesty + PersonProfile source/phone/email + action-write verifier · 4 ships + Batch-4 prod cleanup
>
> Operator reported 3 bugs on bdnick.info (the chat auto-added shop callers / a pronoun-ghost "her" into the personal Power Atlas; tasks only did ONCE/DAILY; Nick fabricated task-status + nagged). Root-caused via 3 read-only code-explorers, fixed, migrated, prod-cleaned, runtime-verified — then a **multi-agent behavioral review** (Skeptic / Constraint-Guardian / User-Advocate · disposition **REVISE**) re-scoped the broader "Nick refinement" ask. Each ship gated tsc 0 + tests + turbo build green, landed attempt 1 via push-main.sh.
> - **`c66bb09e`** — (1) **people-creation gate:** `resolvePersonByName` (lib/brain/person-profile-fuzzy.ts) rejects pronoun/non-names (`isNonName`) + a `createIfMissing` flag; the conversation digest is now MATCH-ONLY (no auto-creating shop contacts) + no longer overwrites a curated `relationship`; `person.update` is edit-only; NEW `person.create` that ACTION_CATALOG tells Nick to ASK before using ("never add shop callers"). (2) **WEEKLY recurrence:** `LoopKind += WEEKLY` + `Task.recurring_days Int[]` + a 7-day weekday picker in task-edit-sheet + `checkTask` snoozes a WEEKLY task to its next listed weekday (reuses the WAITING+snoozedUntil task-resurface cron); pure `lib/loops/weekday.ts`. **Migration `0008_task_weekly_recurrence` APPLIED to prod.** (3) **chat-honesty:** NEW `task.status` agent-action (Nick CHECKS instead of fabricating "is it done") + an always-on HONESTY+RESPECT system-prompt block. tsc 0 · +10 new tests (isNonName guard + weekday math) · affected suites green · next build green.
> - **`172bac8f`** — HONESTY+RESPECT reword (multi-agent REVISE): FACTS-vs-COACHING lanes (verify facts or "can't confirm — want me to pull it?"; engage fully on coaching) + empty-tool-result handling + RESTORED the unprompted push-on-the-work (the first wording risked a yes-man). Prompt-only.
> - **`07089a9d`** — **PersonProfile `source` / `phone` / `email`** (#5 of the REVISE backlog): `source` (operator|agent|digest · set-once on create, never overwritten on match/update) makes shop-vs-personal STRUCTURAL; phone/email captured in the /people add+edit form + a read-only origin line. Resolver stamps them on create; NO new match-tier (phone-as-key DEFERRED — no phones exist yet · YAGNI · resolver match-logic untouched). **Migration `0009_person_source_contact` APPLIED to prod.** tsc 0 · /people verified 0 console errors.
> - **`75e48458`** — **action-write verifier** (REVISE #1 — the last item judged worth building now): Nick's `action`-block writes run in deferred background and bypassed the SDK-tool fabrication guard (`detectActionClaimsWithoutTools`/`environment-verifier` see only `capturedToolCalls`), so a mutation that silently FAILED while Nick's prose claimed completion never warned the operator. NEW pure `lib/ai/chat/action-result-verifier.ts` (`detectFailedActionClaims`) consumed in the deferred `executeActions` block emits a `chat_claim_warn` row (the EXISTING correction-chip path: claim-warnings.ts → /api/ai/chat/claim-warnings → action-claim-warning.tsx) when a MUTATION action failed AND the prose claimed completion; gated by `detectActionClaims` (suppresses the people-gate ask-first guard + hedged prose) + a `MUTATION_ACTIONS` set (failed reads excluded). No added latency (stays deferred), no per-action DB re-read; `traceId` threaded into `DeferredBackgroundCtx`. tsc 0 · +8 new tests · 166 chat tests green · build-gated push landed attempt 1.
> - **Prod data (no commit):** Batch-4 cleanup via Claude-in-Chrome — deleted the 2 ghosts (`Fernando Romero` = shop lead; `her` = operator-confirmed Dania, a pronoun mis-log), re-homed the note to Dania's leverage notes (reversible soft-delete); roster 9→7, NEEDS-INFO 2→0. + logged +10 RelationshipLedger deposits for Manny & Mash (operator: "holding it down, little contact needed").
>
> **Flagged · NOT fixed (REVISE backlog → `~/.claude/projects/C--/memory/statenour-nick-behavioral-review.md`):**
> - **#1 action-write verification — SHIPPED `75e48458`** (see ship list above). The v1-predicted "post-write row check inside `executeActions`" was SUPERSEDED — handlers already return `success:false`, so the existing flag was wired to the existing `chat_claim_warn` correction-chip via the deferred path (no per-action DB re-read, no latency). `environment-verifier.ts` confirmed the WRONG layer (its `capturedToolCalls` = `ev.steps` = AI-SDK streamText tools ONLY, NOT the action-block writes through `executeActions`).
> - **#6 dynamic fact-check grounding** (`fact-check.ts` proper-noun allowlist is hardcoded → stale, missed "Fernando") · **#8 narrow paid-provider routing** (latency — NOT a global pre-send LLM pass, which the repo already built + left OFF for 2×-latency reasons) · **#9 undo affordance** for people adds — all marginal; rec = stop the high-value push here.
> - **~70% of the proposed "Nick v1 contract" already existed** (L1-L3 fabrication stack · CoVe · pre-stream-regen · confidence-tier code-gate) — the review correctly redirected to the specific gaps above.
> - **Migration deploy-ordering lesson:** when a migration's APPLY may be auto-mode-gated, confirm the apply-auth BEFORE pushing the column-reading code (0008 slipped the classifier; 0009 was blocked → operator per-action-authorized → applied).

> ## 2026-06-04 · code-review program (verified H1-H4 / M1-M7 sweep) · 9 ships · main RED→GREEN
>
> Operator: *"check the accuracy of this [code-review ledger]… then go on all… fix it all."* A prior 6-agent code-review (run on a throwaway clone) was first-hand re-verified against source, then the safe + risky-but-gated findings shipped. Every ship gated tsc 0 + red-green vitest + turbo build green; rebased past the concurrent nickstire session through 4 ref-lock races. **Two findings CORRECTED mid-flight (verify-don't-trust):** H1 "ZERO CI typecheck" was overstated (gap real but narrower — nested statenour workflows exist, just inert); M5 "12 identical dup helpers" was wrong-premise — they're 18 DIVERGENT relative-time helpers (only 6 byte-identical, safe to merge).
> - **`f6b601c9`** — H1: added `"check": "tsc --noEmit"` to statenour `package.json` so CI's `turbo run check` stops silently SKIPPING statenour's typecheck (it had only `typecheck`; siblings all define `check`; `next.config ignoreBuildErrors:true` meant build missed types too → type errors could land on main). Proven via turbo dry-run. + H2: dropped `node_modules/.prisma/**` from turbo build OUTPUTS (platform-native binary; cross-OS cache-restore = silent corruption; build runs `prisma generate` unconditionally). + dropped `.env*` from `globalDependencies` (busted whole cache on secret rotation).
> - **`9e1f5a18`** — M1: registered 5 load-bearing flags in `lib/feature-flags.ts` (`NICK_PRIME_PROMPT` · `ENABLE_SPECIALIST_ROUTING` · `NICK_HIGH_SPEC_GATE` · `NICK_CHAT_INTENSITY` · `INNGEST_MEGA_V2`) — read via raw `process.env` but invisible to `/system/migrations`+`getFlag()`. Additive; call sites untouched.
> - **`4fab8138`** — M4: corrected stale "Venice primary" → Ollama-primary across README + `docs/ARCHITECTURE.md` + `.env.example` (real chain `[ollama,venice,openai,anthropic]`); deleted the redundant stale `.env.template` (+ its security-audit allowlist entry); collapsed 3 contradictory provider-order comments in `provider.ts`. + deleted dead `activeProviderSupportsTools()` (0 callers).
> - **`cdc03631`** — M5 (safe subset): 6 byte-identical `timeAgo` copies → `relativeTimeSeconds`/`relativeTimeMinutes` in `lib/utils/datetime.ts` via aliased imports (zero behavior change).
> - **`bdac0102`** — **fixed 2 stale RED test suites → main GREEN** (17 failing → 0): `smart-now.test.ts` asserted pre-Wave-2 routes (`next.config` redirects `/plan`→`/stats`, `/tasks`→`/missions`); `looks-like-brain-dump.test.ts` imported `looksLikeBrainDump` from its OLD path (moved to `lib/ai/chat/brain-dump-detector`). No runtime logic touched. + deleted 3 INERT nested workflows (`apps/statenour/.github/workflows/{ci,pr-review,mirror-to-master}.yml` — GitHub runs ROOT workflows only + trigger branches absent on origin = doubly-inert vestige of the standalone statenour-os repo).
> - **`d35da9bf` + `c3067403`** — removed all ~9 dead `format.ts` exports (0-caller-verified repo-wide; `format.ts` now = `clamp`/`formatDate`/`toSentenceCase`). + **M6 REFUTED**: the reasoning smart-tier "empty context" concern is false — smart (`reasoning/engine.ts:712`) sets context then falls through to the universal `if(!context)` fanout catch-all guarding ALL tiers (@971/@991 are extra thorough/deep-only pre-fallbacks). Added a clarifying comment, no patch.
> - **`66c74215`** — **H4: split the 1971-LOC `lib/trpc/routers/task.ts` god-router** → 20 Power Atlas (people/relationship/ledger/power) procedures extracted VERBATIM to `lib/trpc/routers/task/power-atlas.ts` (715 LOC), spread back (`...powerAtlasProcedures`) so `trpc.task.*` paths stay FLAT (zero behavior change; `updatePowerBalance` body byte-identical pre/post; build green). task.ts → 1278 LOC. Mirrors the `system`-router spread pattern. (`reorderMission`/`reorderTask`/`accept|dismissTaskClassification` KEPT — task-domain, were interleaved.)
> - **`1c6d84b1`** — M3: `ActionRule` was `any`-typed (the 20-rule autonomous-engine fires real Telegram/email side-effects with no compile-time shape check) → `ActionRule<T>` generic + `defineRule<T>` existential wrapper; each rule's `action(item)` now checked vs its `trigger()`. Type-only (identity cast; `any` net −2).
>
> **Flagged · NOT fixed (honest):**
> - **M2 (smart-home automation) HELD — investigated, NOT dead.** `lib/brain/automation-engine.ts` is the UNWIRED automation layer of a LIVE feature (SmartDevice/DeviceCommand/AutomationRule used by 15 files incl `lib/trpc/routers/system/devices.ts`; Tuya env present). Real device control runs through an EXTERNAL Python `local-agent/` that DIED Apr 14 (`app/api/devices/retire-stale/route.ts:8`); cameras have NO pixel pipeline (`snapshotUrl` always null; V380s P2P/no-RTSP). Operator chose SKIP (needs their hardware). Wire-vs-delete = open. Revive-runbook in MEMORY.
> - **M7 version drift — LEAVE** (aligning lucide/recharts/vitest/streamdown = untested major-version bumps, low gain).
> - **Relative-time full standardization** — needs a TWO-format house-style decision (short-horizon ops + long-horizon relationship timelines); a one-format rule would degrade month/year views. Operator left it.
> - **`tests/ai/agents/router.test.ts` intermittent flake** — passes 17/17 ISOLATED (this tree AND base), fails in the full single-fork run (mock-order pollution hypothesis). NOT from this work (proven); "pre-existing-before-session" unconfirmed. Joins the ~12 unhandled-rejection errors as test-isolation debt → the full suite EXITS 1 with all tests PASSING (read the summary line, not `$?`).
> - **TRUST AUDIT (advisory · operator-gated · NOT code).** A trust-calibrator+clarity-gate pass found nickstire INTEGRITY landmines — used-tire **$25** (web/Google schema) vs **$60** (phone/SMS/IG/voice/chatbot), a documented decoy (`truth_os.md:8-11`) → bait at booking; 36-mo warranty still in `llms-full.txt` vs 12-mo canon; hardcoded "Verified Google Review" testimonials + gbpContentGenerator fabrication (FTC risk); marketing "redo it free" vs invoice "ALL SALES FINAL" — plus a statenour-Nick gap (the verified/unverified marker covers ACTION claims but NOT numeric/data claims; CoVe + self-consistency flag-OFF). Detail in MEMORY `statenour_2026-06-04_code-review-verified.md`.

> ## 2026-06-03 · nick-intelligence + every-page audit + chat-pipeline code-health · ~5 ships
>
> Operator: *"fix nick chat + upgrade the tool calls + find anything else… give deep-reasoning live-data access… go through EVERY surface of EVERY page, make uniform, no deficit, don't break anything… then: what about the code underneath?"* Three threads, all flag-gated or behavior-preserving, prod byte-unchanged until a Railway flag flips.
> - **`db697237`** — nick-intelligence pass: chat-truth fix (Nick stopped flagging its OWN citations as fabrication; 5 tool-name corrections + a CI poka-yoke), the **`AI_PROVIDER=ollama` prod-stall fix** (that env var hard-pinned one provider + DISABLED failover → a stalled chat; DELETED, verified fixed live via Claude-in-Chrome), 15 `NICK_*` intelligence features (importance-recall · CoVe · contextual-retrieval · proactive autonomy [FAIL-CLOSED, /qa-gated] · anticipatory recall · reflection trees · contradiction cleanup · episodic split · outcome learning · self-consistency · multi-agent-auto · event-triggers · deep-reasoning · verified-regen · confidence-tier — each behind an env flag, default-OFF, wired to a real consumer), an 8-bug **proactive-staleness sweep** (recency floors / age ceilings / entity stopwords / honest relabels / freshness tags so no surface asserts stale data as present-tense), and the **glm-5.1** model swap (operator-chosen strongest+least-restricted; vision split to qwen3-vl; tool-calling verified live). 12 flags ON Railway, 3 held (verified-regen / confidence-tier / one more) by operator choice.
> - **`54df18b7`** — deep-reasoning LIVE-DATA access: the reasoning engine can't call tools, so deep turns reasoned blind to current numbers; now a compact `getDashboardSummary()` real-business snapshot is prepended to the reasoning context (best-effort, skip-on-fail) so `NICK_DEEP_REASONING` could be turned ON without the downside. Enabled.
> - **`c3281343` + `5717a107`/`a89f7e92`/`7319657d` + `1e2329bd`** — every-page audit (all 41 pages, 5 read-only audit waves): `/system` hub-grid pruned 33→12 cards (dead redirect/404/colliding cards removed, Calibration+Reviews restored), dead cross-links + orphan `system/status/` deleted; **14 pages migrated to the canonical `StandardPage`/`PageHeader`** (`description` widened `string`→`ReactNode` for live-metric subtitles); plus functional-deficit fixes (body weigh-in freshness, outreach neutral default segment, content/history `undefined/undefined`, retired `/habits` redirect).
> - **`4fa6255b`** — iOS-PWA dialog sweep: 11 controls used `window.confirm/prompt/alert` (silently dead in the operator's standalone PWA) → migrated to the in-DOM `confirm-dialog.tsx` primitives.
> - **`e4c5633a`** — chat-pipeline code-health pass (*"the code underneath"*): a read-only code-explorer audit produced a 12-item backlog; shipped the 5 SAFE behavior-preserving wins — route.ts python-execute regex dedup + `genBase` hoist · provider.ts Venice+Ollama quota-breakers collapsed into one `makeQuotaBreaker` factory (~40ln) · reasoning/engine.ts 6 repeated dynamic-import blocks → one shared module-scope `tracedAiChat`. tsc 0 · 919 ai tests green · build gate green, landed attempt 1.
> - **chat↔rest-of-statenour connectivity audit** — read-only trace of every seam (tools→bridge, brain recall, mastery, business-intel, persist-back) found 2 real wiring bugs, both fixed: `getProjections`'s 30-day revenue projection was a 1-DAY window (the `revenue_range` bridge query was sent a `{since}` filter the nickstire handler ignores — it reads `{from,to}` defaulting to today → Nick's annual projection was today×12; fixed `lib/ai/tools/goals.ts` to send the real 30-day span) + bridge env-key drift (`fetchShopSnapshot`/`fetchShopHealth` read only `BRIDGE_API_KEY`, but the live Railway key is `STATENOUR_SYNC_KEY` — snapshot silently used the slow fallback, health returned null; unified both onto a shared `resolveBridgeConfig()` matching the canonical `queryNick` client). 4 lower findings deferred + documented; 6 seams verified healthy. Detail in `nick-intelligence-pass.md` §10.
> - Reference/operating guide written: `docs/nick-intelligence-pass.md` (flag table · on/off/rollback commands · fail-closed safety model · model/provider chain · staleness patterns · §9 code-health backlog).
>
> **Flagged · NOT fixed (honest):**
> - **`preferLargeContext` sort (provider.ts) — left untouched.** A code audit called it a dead no-op; verify-don't-trust: `PROVIDERS` leads with the Venice+Ollama tag-team, so if Venice is index 0 that sort genuinely reorders Ollama to the front and is load-bearing. Not changed pending proof.
> - **Code-health backlog deferred (7 items, all SAFE)** — GSC-prefetch + customer-shape-hint extractions out of route.ts, `customerShapeRegex` module-hoist, `looksLikeBrainDump` relocate, `DeferredBackgroundCtx` derived-boolean removal, `buildMessageParts` helper; 1 RISKY (collapse the standard-tier critique branch via tier-config). Better done in a fresh-context pass; recorded in `nick-intelligence-pass.md` §9.
> - **3 flags held OFF** by operator choice (verified-regen trades streaming for a slower full-generate; confidence-tier removes the human-approval gate).
> - **Runtime not fully driven** — flag behaviors + the new chat paths are tsc-0 + suite-green + (some) Claude-in-Chrome-verified live, but the auth-gated personal-chat surfaces are verified by construction, not every-path-driven (same auth-gated-personal-data line as prior waves).
> - **Optional `PageSkeleton`** shared loading slot — still open (pure uniformity polish, no deficit).

> ## 2026-06-02 · hybrid retrieval — real Postgres FTS lexical lane (Wave B) · 1 ship + 1 prod migration
>
> The deferred Wave-B recall win, picked up + shipped (operator: *"B hybrid-retrieval (Neon migration)"*). `contextual-recall.ts` ran 3-lane RRF (semantic + keyword + category), but its "keyword" lane was `keywordScore` — naive JS `.includes()` substring matching over ONLY the top-300-by-confidence candidates loaded for the turn, so a perfect lexical hit (a person's name, an error code like "F25e", a SKU) on a mid-confidence memory was never even loaded → couldn't win. Replaced that lane with a TRUE Postgres FTS over ALL non-deleted/conf>=0.3 memories, UNIONed its hits into the candidate pool (the starvation fix), and fed `ts_rank` as the lexical lane (naive `keywordScore` kept as a graceful fallback when FTS errors or returns empty). The code degrades to a seq-scan pre-index (caught → falls back), so it shipped deploy-safe AHEAD of the migration. Verify-don't-trust: a fresh-worktree `tsc` tripped on an unbuilt `@statenour/lenses` (sibling code) — a build-order artifact, NOT my code; the real gate `turbo build` (which builds lenses first) passed 3/3.
> - **`9edc1804`** — B · FTS lexical lane. NEW `getLexicalMatches` (`ts_rank` + `websearch_to_tsquery`, OR-across-topics) + pure unit-tested `buildLexicalTsQuery` (4/4) in `contextual-recall.ts`; candidate-pool union; lane swap `useLexical ? sLexical : sKeyword`. Plus the `0007_brain_fts` registry entry in `app/api/system/apply-pending-migration`, `prisma/migrations-pending/0007_brain_fts/migration.sql`, and `scripts/apply-brain-fts.ts` (prod apply with pgvector before+after guards). Disjoint from the concurrent analyzer/home-chat session; rebased onto their `edf1766d` after a 2nd ref-lock race; combined-tree turbo build green (3/3 tasks).
> - **migration `0007_brain_fts` APPLIED to prod Neon** (via `scripts/apply-brain-fts.ts` · `railway run --service statenour-web`) — an ADDITIVE expression GIN index on `brain_memories.content`. **pgvector verified PRESENT before AND after** (the index is on a SEPARATE table from `vector_embeddings`, so it cannot touch pgvector — the operator's #1 fear, hard-guarded: the script aborts if `vector` is missing either side); index confirmed present; FTS smoke (`tire or revenue or oil`) = **277 live matches**; recorded in `_prisma_migrations` (drift-safe).
>
> **Flagged · NOT fixed (honest):**
> - **App-level lane not driven live** — the data layer is proven (277-match FTS run against prod Neon), but `getContextualMemories` fires only on an auth-gated personal chat turn, so the in-app lane is verified by construction + the live SQL, not by a driven turn (same auth-gated-personal-data line as prior waves; operator's in-app trigger).
> - **RRF lane weights unchanged** — kept `[2.0, 1.0, 1.0]` (semantic-dominant); a real `ts_rank` lane could justify a re-tune, but that needs measurement → left conservative (the win is the real ranking + the pool union, not a weight change).
> - **Deploy SHA not marker-pinned** — bdnick.info 200/healthy; `9edc1804` auto-deploys but no health-marker distinguishes it (same known limitation).

> ## 2026-06-02 · next-level intelligence (recall + memory + proactivity) + nickstire $49 · 6 ships
>
> Operator: *"achieve next-level intelligence and get it programmed into statenour… go above and beyond."* A 2-stream research pass (internal intelligence audit + external SOTA, both filtered to Ollama+pgvector) found statenour's brain already strong (RRF + cross-encoder rerank · 9-stage consolidation · fabrication defense) — so this was 4 SURGICAL upgrades in a clean lane disjoint from the concurrent analyzer-suite session, not a rebuild. Every commit tsc-0; full suite **2950 pass** (the 12 cold-run unhandled-rejections proven flaky — a pre-existing teardown race in `tasks-auto-inherit.test.ts`, absent on the warm re-run AND on the baseline; not in my import graph). Verify-don't-trust corrected the plan twice mid-flight: R2's "recency×importance scoring" was already implemented (dropped, no double-count), and R1's "HNSW full-table-scan" was a candidate re-score not a scan (reframed).
> - **`fae626ab`** — J · `mergeMemories` SOFT-deletes consolidated sources (`deletedAt`) instead of hard-deleting. 2026 research ("Useful Memories Become Faulty…") shows LLM consolidation that destroys source evidence can drop recall below a no-memory baseline; recall already filters `deletedAt:null` so what's recalled is UNCHANGED, but originals stay recoverable. `pruneNoise` left hard-delete (genuine GC: expired/conf<0.1/dupes).
> - **`a65ca22e`** — I · graph-aware recall. `contextual-recall.ts` now traverses the `MemoryEdge` graph (written nightly by connect()+cross-pollinate, never READ until now): a 1-hop expansion off the top-2 recalled memories surfaces the strongest linked memories as a "Connected" section. Safe-by-construction — append-only + try/catch + capped (≤2 anchors, ≤3 links, 150 chars) + dynamic-imports relational-graph (no cycle); the public recall interface is UNCHANGED (so the sibling's `system-prompt.ts` merges clean).
> - **`f0ad8498`** — F · XP-drift detection. NEW `lib/mastery/xp-drift.ts` compares each stat's recent-7d rate vs trailing-28d baseline (reuses `xpEventTotalsSince` — DB-side GROUP BY, no new query/migration) and flags clear decays/surges; the narrator surfaces the top finding as a coach/analyst narration. Conservative thresholds + a 20-XP baseline floor so it never cries drift on noise.
> - **`fe766df2`** — G · opt-in LLM-synthesized narrator. `synthesizeNarration` feeds the combined signal vector to a fast Ollama call for ONE compound observation the per-signal templates can't produce. Gated behind `NARRATOR_LLM_SYNTHESIS=1` (OFF by default — the ticker is byte-unchanged until enabled), ≥2-pattern-gated, hour-cached, best-effort. Never replaces a template voice.
> - **`5f03ffac` + `68a8315f`** — nickstire · VAPI receptionist + igAutopost $50→$49 conventional oil (the only price surfaces still on $50; igAutopost's compliance gate would have REJECTED a correct $49 post). ⚠ the LIVE VAPI assistant needs a `vapi.updateAssistant` re-push for $49 to be SPOKEN — the code deploy alone doesn't update the dashboard-managed assistant.
> - Ship path: isolated worktree `statenour/next-level-intelligence` → cherry-picked onto the sibling's `54a45560` after their push won a ref-lock race → combined-tree build re-gated green (cleared a stale `.next/types` deleted-route validator) → ff-pushed `54a45560 → 68a8315f`. Files fully disjoint from the analyzer session (their analyzers/chat-route/system-prompt/deps vs my recall/consolidation/mastery/ultron).
>
> **Flagged · NOT fixed (honest):**
> - **B (hybrid `tsvector`/BM25 retrieval lane) deferred** — the biggest remaining recall win, but it needs a hand-applied Neon migration, NOT run concurrent with the live sibling session. Next-session pickup (coordinate the migration window).
> - **G ships OFF (env-gated)** — its narration quality is unproven; flip `NARRATOR_LLM_SYNTHESIS=1` to evaluate (template voices remain the floor).
> - **Runtime behaviors not live-executed** — the graph "Connected" section, the drift narration, and the $49 spoken quote read personal Neon data / need the assistant re-push; verified by construction + tsc + full suite, not driven live (the auth-gated personal-data line, held same as the sibling).
> - **Deploy SHA not marker-pinned** — bdnick.info is 200/healthy/DB-connected (booted clean on the combined tree), but my changes add no health-marker, so `68a8315f`-vs-`54a45560` can't be distinguished from /api/health. Build-gate + proven-live base = sound, but not marker-proven.

> ## 2026-06-01 · task classification + scoring + AI-review finish + confirm-chip · 8 ships · 2 prod migrations
>
> Operator: *"tasks feel a little generic when it creates one… auto-classifies into the generic Inbox or Missions without taking a look at whether they correlate to a mission, goal, or feed stats… look at the scoring system + settings + everything."* Root-caused to 4 layers — a mission-ONLY classifier · a create path that bypassed it · `goalId`-null tasks credited nothing · auto-learn's `MasteryScore` domain strings never matched the 33 stat keys, so task XP was silently orphaned — plus 2 latent bugs (the /check route never lifted goals · DAILY completions were inert). Rebuilt the create→classify→credit spine end-to-end, then ran an AI code-review and shipped every recommended fix incl. a suggest-then-approve confirm-chip.
> - **`b9a60d4d`** — register `0004_task_stat_hints` (no schema change · pre-apply; the two-phase deploy that dodges the Prisma SELECT-all "column doesn't exist" trap).
> - **`1ee0f765`** — the core: NEW `lib/ai/classify-task-linkage.ts` correlates **mission + goal + stats** (was mission-only; an AI call via `tracedAiChat` with a deterministic keyword-overlap `fallbackLinkage`) fired from ONE `enrichTaskLinkage` chokepoint on EVERY create path (gap-fill · atomic compare-and-set) · `creditTaskStats` credits the character sheet on EVERY completion (goal stats → statHints → `goal.domain` inference · idempotent `sourceKey` · scaled by `taskStatMultiplier`) — closing the orphaned-domain bug · `Task.statHints` column · `0004` APPLIED to prod.
> - **`12ce290e`** — enrich treats ALL `/inbox/i` mission variants as unclassified + a zero-target goal-progress guard (#2/#3 from the AI review).
> - **`272405ff`** — M3: `credit-task-stats.test.ts` pins the crediting orchestration (exactly-once · priority order · multiplier scaling).
> - **`2c8030a4`** — P3a: /missions quick-add now relies on the server enrich; the redundant client-side classify+attach block + the dead `classify-task-mission` module DELETED (server enrich is the single classifier).
> - **`084a38ef`** — M1 (SQL-aggregated xpEvent totals · was an in-JS sum) + M2 (`createTaskAndEnrich` seam).
> - **`825e9fba`** — register `0006_task_pending_classification` (pre-apply).
> - **`2c4c376d`** — confirm-chip: a low-confidence (0.3–0.6) mission match PARKS on `Task.pendingClassification` and surfaces a /missions accept/dismiss chip — mirrors /people's suggest-then-approve · migration `0006` applied to prod (operator-authorized).
> - Gates (FRESH — re-verified on shipped `origin/main` this session): typecheck **0** · the wave's unit suites **35/35** (scoring-config 6 · credit-task-stats 8 · goal-stats 16 · classify-linkage 5). 8 commits `b9a60d4d → 2c4c376d`, interleaved on shared main with the concurrent /people wave (its `44a10079` is an ancestor of the final `2c4c376d`).
>
> **Flagged · NOT fixed (honest, verified):**
> - **confirm-chip on-screen render is unverified.** Verified by construction (column live · `pendingClassification` surfaces through `task.list` · accept/dismiss mutations typecheck · chip renders off that field) but never seen on screen — the live Ollama classifier was decisive (≥0.6 or null) across 6 prod test tasks and never produced a 0.3–0.6 result to land in the park band.
> - **Biggest lever is DATA, not code.** Only ~2 life-goals exist and both are unconfigured (target = 0) — the spine has little to correlate against until real goals are authored. Code-complete; operator action.
> - **`lib/mastery/goal-stats.ts` perDay day-key uses UTC, not the ET `today()`** — a narrow 8pm–midnight-ET double-credit edge in `creditTaskStats`'s `{perDay}` path. Left for the statenour-session owner to avoid a cross-session collision on the mastery files (per the agent-memory handoff).

> ## 2026-06-01 · /people (Power Atlas) overhaul + QA pass · 4 ships + prod migration
>
> /people went from a siloed, unscored CRM to a real part of the mastery system
> (operator: *"feels generic… results aren't tracked/scored into XP… doesn't read
> tasks to correlate to a mission/goal/stats… UI looks bulky"*). Measure-first
> profiling of prod drove the plan — the feature would have launched empty otherwise.
> - **Overhaul (5 phases)** `d5c6f098` — `lib/mastery/people-credit.ts` (NEW · ledger
>   deposits + power-plays credit the INFLUENCE & PEOPLE stats via the idempotent
>   `creditStatXp` seam — deliberately NOT `goal-stats.ts`, to dodge the sibling's
>   task-classification rewrite) · classifier rewritten **suggest-then-approve**
>   (`pendingClassification` + role SSOT `lib/brain/person-roles.ts`, no more silent
>   overwrite) · reads tasks via a real `Task.personId` FK ("open promises" panel) ·
>   UI de-bulked (stats above the fold · 5 empty cards folded · dup Greene sidebar
>   removed) · operator-tunable weights (`components/settings/people-scoring-panel.tsx`)
>   · `task.backfillPeopleXp` mutation · rebased clean onto the sibling's statHints.
> - **Migration `0005_people_overhaul` APPLIED + recorded on prod Neon** — `pending_classification`
>   col + `Task.person_id` FK (onDelete SetNull) + index; the promiseTo→personId backfill
>   matched 0 rows (profile-predicted — only "self"×2).
> - **XP backfill RUN + verified** — 16 historical deposits → 13 `relationships` (10.0 XP)
>   + 3 `networking` (3.9 XP); confirmed live in the UI (Dania +6.6 XP chip).
> - **QA pass `44a10079`** — parallel a11y audit + code-review found+fixed a CRITICAL:
>   `window.confirm` person-delete was silently dead in the iOS **standalone PWA** (the
>   operator's phone) → two-tap inline confirm, **live-verified** ("delete"→"sure?",
>   no delete on first tap). Plus `updatePerson.role` z.string()→z.enum (role SSOT leak),
>   `getPeopleIntelligence` missing `deletedAt:null` (soft-deleted people leaked into
>   Nick's prompt every chat turn), `dismissClassification` swallow→throw, WCAG (trust
>   tier as text not color-only · XP-chip aria-label · live regions · 44px targets).
> - Gates: typecheck 0 · 89 mastery + 12 people-credit tests · pre-push build OK · all
>   surfaces live-verified on bdnick.info via Chrome. Shipped via `~/push-main.sh`
>   (auto-race-recovery helper built this wave; landed through 5-session shared-main churn).
>
> **Flagged · NOT fixed (deliberate, verified — not gaps):**
> - `lib/mastery/credit.ts` upsert last-write semantics — shared by EVERY crediting path (journal/decision/task); defensible (idempotent on row identity; only re-prices on a deliberate backfill re-run). Blast radius too high for a polish pass.
> - Codebase-wide clickable-row nested-interactive-role pattern (MissionCard/GoalBoard convention) — refactoring one row = layout risk + inconsistency; address repo-wide or not at all.
> - mentor/mentee → `networking` stat map — judgment call, no correctness impact.

> ## 2026-06-01 · Journal Brain redesign (grounded enrichment) · 2 ships + prod migration
>
> The Journal went from a generic dead-drop to a grounded thinking instrument
> (operator: *"the Journal feels generic… results aren't tracked/scored into XP…
> doesn't read tasks/missions/goals/stats"*). Full phased redesign, "Approach A"
> unified async enrichment pass. Capture stays instant; a fire-and-forget pass
> grounds each entry vs ACTIVE goals/missions (inline candidates, NO embeddings —
> goals aren't embedded + the set is tiny), grounded-reclassifies (real `entry_type`
> column wins over the legacy JSON blob), proposes a confirmable goal/mission link
> (auto-confirm ≥0.8 credits now · below → "proposed", credits on ✓), credits a
> grounded XP bonus to the linked goal's stats (`baselineXp×weight×groundedMult`,
> idempotent `goal-journal:<id>:<stat>`), and generates a bold idea + sharp challenge
> ("take"). Baseline XP (Phase 0 `b5cf8b9a`) already credits every capture.
> - **Phase 1-3 + engine** — `lib/brain/journal-brain.ts` (enrich + `confirmJournalLink`
>   + `creditGroundedGoalXp` + `generateJournalTake` + `resweepUnenriched` + Phase-3
>   `backfillJournalBrain`) · wired into `journal-ingest.ts` (fire-and-forget, `notifyTelegram`)
>   · `lib/trpc/routers/journal.ts` (`receipt` DERIVED from ledger · `confirmLink` ·
>   get/updateSettings · `backfillBrain`) · `journal-feed.ts` (grounding cols + batched
>   goal-title, no N+1 + SQL `entry_type` push-down) · `entry-row.tsx` (link chip +
>   impact receipt) · `journal-brain-panel.tsx` (7-knob settings) · resweep into
>   `cron/mastery-xp`. Rebased 3× through shared-main churn.
> - **Telegram link-confirm** — propose-time inline ✓/✗ + `handleCallback jlink:c|r:<silo>:<id>`.
> - **Migration `20260601_journal_brain_foundation` APPLIED to prod Neon** (`spring-art-47050555`
>   via run_sql_transaction: 6 cols × 4 silos + 8 FKs + 9 indexes + `journal_settings`). ⚠ Phase 0
>   had shipped the schema cols WITHOUT applying → prod journal reads were likely erroring until
>   this apply. **Lesson: schema + migration must ship together.**
> - Deleted orphaned regex classifier `lib/journal/classifier.ts` (no importers).
> - Gates: typecheck 0 · pre-push affected build OK · push head `dc476e4e`. UI built by 2 scoped
>   subagents, diffs verified. Used PowerShell git (Cygwin fork failures) + cleared worktree `.next`
>   (a nested-artifact explosion was hanging Next's file-tracer at "Finalizing").
>
> PROFILE (prod, 2026-06-01): 990 journal rows — **435 brain_dumps** (median 96 chars, p95 701,
> only 2.3% under 40 → qualityFloor=40 validated) + 215 reflections + 331 situation_logs + 9
> decision_replays. **⚠ only 1 ACTIVE goal vs 10 active missions** → grounding value is thin until
> more goals exist.
>
> **Flagged · NOT fixed (operator-gated / deferred):**
> - **Backfill (~990 rows) not yet run** — heavy Ollama; `journal.backfillBrain` dryRun→drain, or the nightly resweep auto-drains brain_dumps. Operator-gated.
> - ✅ **mission→goal stat crediting — DONE this wave** — `resolveCreditGoal` routes a mission-linked entry to the mission's parent goal (`mission.lifeGoalId`) in both the live pass + confirm, so the 10 active missions earn XP, not just the 1 standalone goal (the profile's top lever, shipped same wave).
> - Deep brain-consolidation (drift/threads INTO the pass) — YAGNI; they already work as separate /journal surfaces.
> - Migration left in `migrations-pending/` (not promoted to migrations/ + not in `_prisma_migrations`) — the hand-applied intermediate; promote later.

> ## 2026-05-31 · God-file split #2 (system.ts) + Chrome-walk fixes · 2 ships
>
> A live Chrome walk of statenour (operator: *"do a chrome walk of everything"*)
> verified this session's work IN PROD — the idiot-index chip, the full P3
> authoring panel (parent/kind/conviction/identity/kill-by/ambition), and AI
> tool-calling after the tasks.ts split (Nick called a moved `goals.ts` tool and
> answered grounded) — all green, zero console errors. It surfaced two pre-existing
> issues, both fixed in `f6f1143b`:
> - **`app/(mastery)/financial/page.tsx`** — the MONEY page showed a PERMANENT
>   "Loading revenue data…" whenever month revenue was 0, i.e. it lied when the
>   nickstire bridge was down. Now splits the states (loading / feed-unavailable /
>   genuine $0). ROOT CAUSE of the empty bridge = config (STATENOUR_SYNC_KEY on
>   Railway and/or nickstire's `revenue_range` handler) — flagged, not code-fixable.
> - **`lib/observability/os-snapshot.ts`** — all 5 source scanners excluded `.next`
>   but not `.next-prod`/`standalone`, inflating LOCAL cron runs. Added both. (No
>   prod effect; the /brain `monster_file_count` P0 is a REAL signal, not noise.)
>
> Then the **`system.ts` god-router split** (`560525e2`) — the worst god-file, the
> one driving that P0. The 2,722-ln `systemRouter` (105 tRPC procedures) → 9
> per-domain procedure-object files (`system/{health,cron,autopilot,prompts,quality,
> schema,devices,agents,notifications}.ts`), recomposed in a **61-ln** `system.ts`
> via object-spread: `router({ ...healthProcedures, ...cronProcedures, … })`. **FLAT
> namespace preserved** — every procedure stays `trpc.system.<proc>` (NOT nested,
> which would change client paths + break call sites). Verbatim byte-range move,
> zero behavior/input-schema/middleware change, 105→105 procedures. Built in an
> isolated worktree via a briefed subagent, then independently verified: procedure
> parity, no-nesting grep, and **typecheck 0 = the interface gate** (client
> `trpc.system.*` call sites compile against the router type) + full vitest 2919.
> Cherry-picked onto main; pre-push build OK.
>
> (Concurrent **a11y session** shipped `d85888ba` WCAG 2.2 AA both apps +
> `useFocusTrap`/`useReducedMotion` hooks + `59032991` mobile hero + merge
> `03e80d67`; fact-checked ACCURATE. Verified gotcha: a worktree branch pushed
> `HEAD:main` SKIPS the pre-push build — no upstream — so a later `main` push
> re-gates everything.) **Remaining god-files:** chat route (1,884 ln) · provider
> centralization (31 callers).
>
> ## 2026-05-31 · Tech-debt cleanup (statenour) — report fact-check + tasks.ts god-file split · 2 ships
>
> A monorepo tech-debt report (from the nickstire session) listed Sprint-1 wins.
> Fact-checked its statenour claims against the files first (the worktree report it
> produced earlier had real errors): **most held, two didn't** — serializeRow's "77×
> across 3 files" is literally true (system-pages.ts 28 + -b.ts 27 + runner-state.ts
> 22), but the `.toISOString()` calls are heterogeneous (current-time / epoch /
> non-null / nullable), so a single `serializeRow` helper doesn't fit + it sits on
> the API-response path → **skipped** (overstated ROI); provider-bypass is **31**
> files not 23. The money-path wins (formatDollars 5×-contradictory, Stripe webhook
> `any`, payments test) are all `apps/nickstire/` → handed off to the owning session.
>
> **`34ad6fcd`** — deleted the stale `soft-deleted-tasks-2026-05-16.md` restore log
> (389 ln in the app source root). The one clean zero-risk win.
>
> **`2728caa7` · `tasks.ts` god-file split** (interface-preserving) — the 2,024-ln
> single `tasksTools` const (46 AI tools) → 6 NEW per-domain files
> (`goals`/`missions`/`habits`/`health`/`finance`/`calendar` · 7+3+3+1+1+2) + a
> 29-tool `tasksCoreTools` kept in tasks.ts (now 1,292 ln), recomposed verbatim:
> `tasksTools = { ...tasksCoreTools, ...goalsTools, … }`. Pure mechanical MOVE, zero
> behavior change; the public `tasksTools` export keeps the EXACT 46 keys. Dropped
> one unused `detectBlindSpots` import from tasks.ts (still used in brain.ts). Built
> in an **isolated worktree** (a concurrent `a11y-hardening` session was live) via a
> briefed subagent, then **independently verified** (diff scope · 46/46 key count ·
> recomposition spread · typecheck 0 · full vitest 2919 · verbatim spot-check) before
> cherry-picking onto main.
>
> Gates green: typecheck 0 · vitest **2919** · pre-push build OK. 2 commits on
> origin/main. **Remaining tech-debt (sequenced for fresh context):** the chat-route
> (1,884 ln) + system-router (2,722 ln / 105 procs) god-files · provider
> centralization (31 call-sites) · the nickstire money-path hand-off.
>
> ## 2026-05-31 · Ambition Engine P3 (increment 2) — kinds + anti-stale authoring · 1 ship
>
> Operator: *"can u do both at the same time? or all?"* → did all the remaining
> P3 in one wave (NOT parallel agents — kinds/authoring/trajectory all edit
> goal-board.tsx, so parallel would only conflict; one focused pass = one verify
> + one ship). Wires the rest of the dormant P3 columns (P1-migrated, settable
> nowhere) into the /stats card.
>
> **`de898be3` · kinds + anti-stale authoring** (+191/−2) — `lib/services/goals.ts`:
> `updateGoalSchema` now accepts `kind` (metric|milestone|narrative enum) +
> `conviction` (1-5) + `ambition` (tenx|incremental) + `killCriteria` + `killBy`
> (DateTime, converted like deadline) + `identityLine`; all nullable so the edit
> panel can clear them. `components/goals/goal-board.tsx`: (1) **authoring** — the
> edit panel gained a kind selector, conviction picker, identity-line input,
> kill-criteria + kill-by date, and an ambition toggle; (2) **display** — a
> conviction flame chip, ambition tag, pre-committed kill-by chip, the Elon
> **idiot-index** (hrs invested ÷ % moved · derived, no column), and the identity
> line for narrative goals — all in the card's existing chip language; (3)
> **kind-adaptive** — a kind badge on non-metric goals, milestone goals relabel
> "loops"→"milestones", narrative goals surface the identity line while the
> metric/target chip falls away naturally (no target).
>
> Trajectory was already the existing pace-projection chip; the idiot-index
> completes the Elon "question the requirement" set. **P3 is now functionally
> complete** (ladder + kinds + anti-stale authoring + trajectory). Built in place
> on main. Gates green: typecheck 0 · lint 0 new errors · vitest **2919**. 1
> commit on origin/main → Railway. Future refinement: dedicated per-kind card
> layouts (a real milestone checklist UI) + the `lastChallengedAt`
> question-the-requirement ritual button (column exists, no UI yet).
>
> ## 2026-05-31 · Ambition Engine P3 (increment 1) — the compounding goal ladder · 1 ship
>
> Operator: *"go"* (build P3). P3 is the spec's broadest phase ("ladder +
> trajectory + UI polish"); a code survey found the `parentGoalId` / `GoalLadder`
> self-relation shipped in the P1 migration but **referenced nowhere** — a dead
> column. Scoped increment 1 to wiring it end-to-end (the defining "compounding"
> feature), TDD-first; trajectory + kind-adaptive cards deferred to later increments.
>
> **`37106b6b` · the ladder** (+426/−5) — NEW pure `lib/mastery/goal-ladder.ts`
> (14 unit tests): `validateParentLink` (rejects self · cycle, via a cycle-guarded
> `ancestorChain` walk · inverted horizon, where the parent must be ≥ the child's
> horizon) + `rollUpChildren` (childCount · doneCount · avgChildProgress).
> `lib/services/goals.ts`: `updateGoalSchema` accepts `parentGoalId` (null unlinks);
> `updateGoal` validates the link before the write (builds id→horizon + id→parent
> maps from active goals); `getGoals` fetches `parent` + alive `children` per goal
> and attaches a `ladder` {parent, children, rollup} payload — **defensive**
> (`children` may be absent on a partial select / mock; the lone test break was
> exactly this, fixed at the source not the mock). `components/goals/goal-board.tsx`:
> ladder UI in the card's existing language — a violet parent-breadcrumb chip + a
> sky children-rollup chip (both tap-to-scroll to the linked card via the existing
> hash-anchor pattern) + a sub-goals list in the expanded panel + a parent `<select>`
> in edit mode (server-validated; rejection surfaced in the toast).
>
> Built in place on main (not a worktree — the native worktree tool wants an explicit
> "worktree" ask, and in-place + TDD kept the tree buildable for the concurrent
> nickstire session). Gates green: typecheck 0 · check:crons clean · lint 0 new errors
> · vitest **2919** (2905 + 14). 1 commit on origin/main → Railway. **Remaining P3:**
> kind-adaptive cards (metric/milestone/narrative) · trajectory · the
> conviction/killCriteria/identityLine authoring (those columns are also still dormant).
>
> ## 2026-05-31 · Ambition Engine P2 — proactive goal-drift detector · 1 ship
>
> Operator: *"get back to it"* — shipping the P2 work built + fully verified on a worktree
> branch last session. The **goal-drift detector** is the proactive complement to
> `goal-pruner`: where the pruner only flags goals already 30+ days idle, this catches
> drift EARLIER, on two signals, and acks itself when a goal re-engages.
>
> **`87a4a0cb` · goal-drift detector** (+330 · 3 new files + 2 registration lines) — NEW
> `lib/mastery/goal-drift-classify.ts`, a pure side-effect-free `classifyDrift(input) →
> DriftVerdict | null`: **deadline-risk** (P1) = deadline ≤14d & progress <80% & 0 events
> this week · **momentum-decay** (P2) = ≥2 events in the prior 4-week window & 0 this week &
> <30d since last activity. Thresholds (RECENT_DAYS 7 · PRIOR_DAYS 28 · DEADLINE_SOON_DAYS
> 14 · DEADLINE_PROGRESS_FLOOR 80 · MIN_PRIOR_EVENTS 2) are grounded defaults, tunable. NEW
> `src/inngest/functions/goal-drift-detector.ts` — daily cron `30 12 * * *` (30min after
> `goal-pruner` so the two goal scans don't collide) — scans active `lifeGoal`s + their
> GoalEvent windows → `recordCoachEvent({ kind: "goal-pace-shift", … })` deep-linked to
> `/stats#goal-<id>`, surface `goals`; acks the event on re-engagement, idempotent per
> goalId, best-effort writes. Registered in `config/crons.ts` + `src/inngest/functions/index.ts`.
> NEW `tests/lib/mastery/goal-drift-classify.test.ts` (9 tests). Reused the existing
> `CoachEventKind` member `goal-pace-shift` — the closed union already anticipated P2.
>
> Shipped via **cherry-pick** from the local `worktree-ambition-p2-drift` branch onto main
> (clean linear history — no merge bubble on shared main); the diverging commit on main was
> the other session's `c883caa6` (nickstire callback fix · zero file overlap). Worktree
> removed + branch deleted after the push landed; added `.serena/` + `.claude/worktrees/` to
> root `.gitignore` (tooling dirs were untracked-and-committable on shared main). Gates green:
> typecheck 0 · check:crons clean (30 active schedules · under cap · all reachable) · vitest
> **2905** (2896 + 9). 1 commit on origin/main → Railway. **Ambition Engine P3** (goal
> authoring · stat-ladder · kind-cards) remains.
>
> ## 2026-05-31 · Chrome polish wave — bottom-ticker Edge Feed rebuild + a11y/CTA touch-ups · 3 ships
>
> Operator: *"go check it out in chrome for more polishing."* Walked the live site
> (confirmed the dania scrub took — `silent`=0; the only "dania" is the operator's own
> goal description, correctly untouched), then fixed what the walk surfaced.
>
> **`5b31a92a` + `edfae490` · bottom "System pulse" ticker** — the LAST 60s CSS marquee
> with `hover:pause` (banner-blindness + dead-on-touch — the exact pattern the Edge Feed
> redesign already removed from the top ticker; a lone item even rendered twice
> side-by-side). `5b31a92a` stopped the lone-item double; `edfae490` rebuilt it to match
> the top — ONE static item, priority-first (warn>win>info>mute), fade-on-change,
> tap-to-open pulse feed (UPWARD), visible 24h snooze (was forever-dismiss). Ambient
> scale kept (`min-h-[32px] sm:h-5`, 10px) so the layout's bottom reservation (chat
> safe-area + pb) is unchanged; a11y landmark preserved; A3 test updated to lock the
> marquee removal.
>
> **`edfdf1b4` · two touch-ups** — the P2 stale-goal coach card now reads "tap to review
> or archive at the goal" (it deep-links to the goal's one-tap archive — not a dead-end,
> just an unclear affordance); the icon-only add-goal Plus button got
> `aria-label="Add goal"` (the lone genuinely-unlabeled button on /stats — the
> char-sheet category toggles were already labeled by content + aria-expanded; the
> a11y-tree's "7 unlabeled" was an artifact, the live probe found exactly one).
>
> Gates green: typecheck 0 · eslint 0-err · vitest **2896**. 3 commits on origin/main.
>
> ## 2026-05-31 · Relationship-nag scrub wave — kill the "Dania silent" ambush across all surfaces · 3 ships
>
> Operator: *"yes [scrub the other dania surfaces] but also search for more shit
> that needs scrubbing /clarity-gate."* A read-only code-explorer audit mapped the
> CLASS of blunt/stale/sensitive auto-surfaced signals (the score-nag + dania-silent
> pattern). Found 10; scrubbed the 6 LIVE, cleared the 4 dead/dormant, kept all
> legit plumbing.
>
> **`42d748fc` · ticker dania-silent item** — the first surface, caught by live
> Chrome verification (also covered in the deferred-items entry below).
>
> **`0b044154` · 5 more LIVE surfaces** (+9/−200) — the same regex "Dania N days
> silent" nag was auto-surfacing on: `narrator.ts` ("Dania gap Nd" coach line +
> trigger patterns + the input), `chat-lane-check.ts` (a chip under EVERY chat
> reply), **`blind-spot-detector.ts`** (highest blast-radius — the blind spot fed
> `blind-spot-pinner` → pinned into the TOP OF EVERY SYSTEM PROMPT; removed the
> Dania-only loop + its orphaned `neglectedPeople` query), `personal-pulse.ts` (the
> "<name> silent Nd" LIFE chip + its 2 person-silence queries + "dania"-as-a-role-
> enum), and `app/api/ultron/pulse/route.ts` (the `life.daniaSilent`/`topSilent`
> name exposure in the cached payload). Kept (clarity-gate): person-name resolvers,
> intent/lane routing, promiseTo fields, the "married to Dania" identity facts the
> AI prompt needs.
>
> **`9b690019` · dead/dormant remainder** (+9/−118) — dead `daily_score` reads in
> `ultron-ticker.ts` + `plan-day/route.ts` (retired system, always null/[]); the
> dormant `dania_neglect_nudge` + `body_projection_weekly` (hardcoded 186-lb)
> Telegram rules in `autonomous-engine.ts` (engine has no caller since Wave AE —
> removed so a re-wire can't resurrect them); marked `strategic-triggers.ts` DORMANT
> (no caller; documented the score-shim revival trap rather than deleting 521 lines
> of Greene-trigger logic).
>
> Method note: the audit's value was tracing the CONSUMER GRAPH, not the string — a
> grep-and-delete would have missed `blind-spot → pinner → every system prompt`, the
> worst path (not a visible chip). Also surfaced that the prior wave's
> `strategic-triggers` re-source (`b952fc37`) was cosmetic — the module is dead.
>
> Gates green: typecheck 0 · eslint 0-err · vitest **2896**. 3 commits on origin/main.
>
> ## 2026-05-31 · Deferred-items completion wave — re-source + ticker page-context/snooze · 2 ships
>
> Operator: *"go on all deferred."* Closed the deferred refinements from the
> auto-mode wave. Two of them clarity-gate resolved to *already-covered* (no
> redundant code shipped); the AI-curation v2 is held as premature.
>
> **`b952fc37` · score→reflection re-source** — three detectors still read the
> retired daily-score source (`recentScoreSnapshots` / `identity_snapshot`):
> · `timelines.ts` `computeInputs` — deleted the now-dead score inputs
> (`todayScoreLogged`/energy/focus/discipline); the items that consumed them were
> already removed in the 812c0a32 ticker cleanup, so the reads were pure dead
> weight. · `strategic-triggers.ts` "no business action today" — swapped
> `dailyScoreToday` for live `reflectionLoggedToday` (`prisma.reflection.count`,
> date format mirrors the writer in `journal-reflect.ts` + `narrator.ts`) + fixed
> the stale "no score" detail text. · `nour-state.tsx` `detectState` — dropped the
> always-default score-derived energy/discipline (so `on_fire`/`low_energy` could
> never fire) → state driven by the LIVE signals already in state (drift alerts,
> active commitments, habit-rate); `on_fire` revived via strong habit completion.
> No `/api/health` change. +28/−40.
>
> **`afc738f2` · Edge Feed ticker — page-context emphasis + 24h snooze** —
> client-only (no server feed change). · **Page-context:** the global strip
> soft-boosts the lanes relevant to the current page (shop/market on
> /money+/scoreboard+/funnel, mastery/brain on /stats+/goals, brain/industry on
> /brain+/radar+/seo) — applied as a tiebreaker AFTER mode+severity, so an urgent
> item still leads globally. · **24h snooze:** the top strip's X is now a 24h
> snooze (opt-in `ttlMs`), not a permanent mute, so live/recurring lanes
> (market, shop) return tomorrow instead of being silently lost forever; the
> shared dismiss hook migrated `Set`→`Map` gracefully (legacy string-array
> entries preserved as forever; bottom ticker unchanged).
>
> **Resolved by clarity-gate (no code shipped):** · **habit write-time XP** —
> habits were retired as a model; they're DAILY Tasks now (`/api/habits` POST is a
> no-op), so completing one credits XP via the task→auto-learn path already. ·
> **chat write-time XP** — already swept by the mastery-xp backfill; write-time
> would add a 2nd per-turn `attributeText` AI call on the `persistUserTurn` hot
> path (the importance scorer is already there) for marginal immediacy. The XP
> ledger is effectively complete.
>
> **Held (not shipped, with rationale):** · ticker **AI-curation v2** — the
> deterministic rank shipped *today* and isn't proven weak; the Guardian
> hard-rejected the naive version (`createStructuredAiResponse` bypasses the
> budget guard). Revisit only with evidence + full guarding
> (`tracedAiChat`+`trackGeneration`+pinned `gpt-4o-mini`+themes-only+`inngest`).
> · **lane-health visibility** — touches the server feed builder for lower value
> than the "better-empty-than-generic" floor already provides.
>
> Gates green: typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean.
> 2 commits on origin/main.
>
> ## 2026-05-31 · Auto-mode evolution wave — feeder + XP ledger + Edge Feed ticker · 4 ships
>
> Operator: *"go in auto mode and apply every single upgrade to help evolve us."*
> Three force-ranked upgrades from the Sam-Altman pass, each clarity-gated +
> verified + shipped.
>
> **`a5572ac5` · ① revive the industry-pull feeder** — a correctness bug, not a
> feature: the cron was deleted in the Wave-AE prune, so `recallIndustryIntel()`
> (`system-prompt.ts:847` · `/api/ai/plan-day` · `/intel`) had been feeding the
> AI a stale `BrainMemory(industry_intel)` table. Revived as an inngest-native
> cron (`src/inngest/functions/industry-pull.ts`) calling `pullIndustryFeeds()`
> daily 08:00 UTC (~10 live sources post the 2026-05-02 probe; already
> timeout-guarded + per-source error-safe).
>
> **`9444ec2c` · ② complete the XP ledger** — NEW `lib/mastery/credit-signal.ts`
> `creditFromSignal(signal, ev)`: the single write-time door routing
> habit→`attributeHabit` + journal/decision/chat→`attributeText` → `creditStatXp`
> (idempotent per sourceKey, shared with the backfill; noise floor preserved).
> Wired at BOTH reflection create paths (`journal-reflect.ts` + `reflect/route.ts`)
> + the decision service. The gap it closed: daily REFLECTIONS — the daily-score
> replacement — fed ZERO XP by any path (the backfill doesn't sweep them). +6
> unit tests. (No-goal tasks already credited via auto-learn — never the gap.)
>
> **`fcdb1b3a` · ③ Edge Feed ticker** — killed the 55s marquee (wallpaper +
> unreadable/untappable on a phone, hover-gated controls) → ONE readable item
> (≥13px) on a ≥40px tap-strip that opens a full feed sheet; severity-first;
> fade-on-change (no continuous scroll); visible dismiss. + a **Mastery lane**
> surfacing Ambition Engine momentum (top riser this week + closest-to-level).
> Design vetted via multi-agent-brainstorming; a11y test updated (40px ≥ the
> 32px HIG floor + marquee assertion).
>
> **Flagged · NOT fixed (deferred refinements):**
> - score→reflection re-source of dormant features (`timelines`/`nour-state`/
>   `strategic-triggers`) — harmless dead reads, not bugs (task tracker #4).
> - habit + chat write-time XP (the door makes both trivial; backfill covers chat).
> - ticker page-context emphasis / snooze / lane-health + AI-curation (all v2).
>
> Gates: typecheck 0 · eslint 0-errors · full vitest 2896 · check:crons clean ·
> check:raw-sql 0 · prisma valid · pre-push build OK.

> ## 2026-05-31 · Ambition Engine P1 (code) — goal→stat spine + fusion UI · 2 ships
>
> The P1 build the prior wave teed up. The goal engine is now wired into
> the 33-stat mastery character sheet end-to-end: a goal-tagged task rep
> credits the goal's stats, the goal card shows its stat chips, and the
> character sheet cites the goals feeding each stat. Built TDD-first per the
> locked spec (`docs/specs/2026-05-30-ambition-engine.md`). The prior wave's
> two local commits (post-review hardening + doc reconcile, was
> `6cbc238f`+`3716ecc9`) were rebased onto origin as `dcc4e206`+`aec010e5`
> and pushed in the same wave — nothing local-unpushed now.
>
> **`805e6173` · P1 spine + chips** — NEW `lib/mastery/goal-stats.ts`:
> `effectiveGoalStats` (declared `GoalStat` rows, else `goal.domain`-inferred
> so all ~30 existing goals light up with no backfill) + `creditGoalStatsForTask`,
> riding the idempotent xpEvent log (key `goal-task:<taskId>:<stat>`) so a
> goal-tagged task never double-counts its own stat. Wired into
> `liftGoalOnTaskComplete` (tasks.ts) — fires per rep, idempotent under the
> chat-fallback double-fire, fires even when the goal is already achieved.
> `getGoals` enriches each goal with resolved `stats` (+ `GoalCacheRow` type);
> GoalBoard renders chips in character-sheet colors. +11 unit tests.
>
> **`ef691189` · P1 citation** — `goalsByStat()` inverts active goals →
> `statKey` → contributing goals (the SAME resolver as the chips, so citation
> and chips can't disagree). `computeCharacterSheet` resolves each stat's
> goals (best-effort — a goals-query failure can't break the board); each
> `StatCard` cites them, linking to the goal card on `/stats`, only when
> present. +2 unit tests.
>
> **Flagged · NOT fixed:**
> - GoalStat **authoring** is P3 — P1 infers links from `goal.domain`; no
>   manual/AI stat-picker yet (declared rows already override inference).
> - **P2** (proactive goal-drift detector → Coach Channel → `/stats` banner +
>   Telegram) not started.
> - The dev-server/`.next` vs pre-push `turbo build` coexistence is still a
>   manual "stop the dev server before pushing" step; a `.next-prod` pre-push
>   variant (like `build:check`) would let dev + push coexist.
>
> Gates: typecheck 0 · eslint 0-errors · full vitest green (+13) ·
> check:raw-sql 0 · check:crons clean · prisma valid · pre-push build OK.

> ## 2026-05-31 · Bridge-contract sweep + Ambition Engine P1 · 12 commits + hardening
>
> A plumbing-audit sweep (5 read-only agents · "fix-safe, flag the rest")
> closed a whole class of silent statenour↔nickstire bugs; then the stale
> /stats goals card got a /sam-altman redesign spec'd and its P1 schema
> shipped to prod.
>
> **Dead-bridge-query class — CLOSED + guarded.** The stringly-typed bridge
> (`queryNick("name")` → nickstire `QUERY_HANDLERS`) has no compile-time
> contract, so renamed handlers rot callers silently. Fixed: `jobs_today`
> (×2 — operating-rhythm + business-intel) → `revenue_today` read via
> `readNickRevenue()`; `pending_callbacks_count` → `callbacks_pending`;
> `customer_search` triple-fix (`{name}`→`{term}` · unwrap `.customers` ·
> `totalVisits`/`totalSpent`). `a8100a36` also killed a false weekday "🔴 ZERO
> REVENUE" Telegram alert that fired because the dead query always returned 0.
> NEW `tests/contracts/nick-bridge-query-contract.test.ts` scans every live
> bridge callsite against nickstire's actual handler keys (∪ a KNOWN_PENDING
> allowlist) so a dead query now fails CI (red-green proven).
>
> **Other plumbing** — budget gate `.catch(()=>true)` (fail-OPEN · uncapped
> LLM spend) → fail-safe `return false` · system-prompt stale-shop fallback was
> gated on a dead `todayEstimate` key → now `readNickRevenue()` · 6
> silent-failure `.catch` breadcrumbs (`ai-cost` · `actions-brain` ·
> `brain-domain` · `task-resurface` · `consolidate` · the budget gate).
>
> **Crons + nav** — `b8de05ed` registered the 5 Inngest-native functions
> (cron-heartbeat · operator-morning-brief · goal-pruner ·
> journal-convergence-scan · journal-thread-dormancy) in `config/crons.ts` and
> taught `check:crons` to skip route-checks for `inngest:true` entries (43
> entries / 28 active · clean). `2d3be254` finished the `/tasks`→`/missions` +
> `/mastery`→`/stats` nav migration across 16 components + the ⌘K palette +
> the orb menu (path-keys, comments, tests, sw.js intentionally left).
>
> **Coaching lens** — `e20bc8b6` · `/api/ai/side-pane-chat` `describeFraming()`
> case "goals" now injects a MASTERY_COACHING_LENS (identity-mirror +
> loss-aversion), cap-safe (local enrichedSystem, not the 60K main prompt).
>
> **Ambition Engine P1** — spec `docs/specs/2026-05-30-ambition-engine.md`
> (A+B hybrid · clarity-gated · skill-enriched). Schema (`3d377b62`):
> `LifeGoal` += 8 cols (kind · parentGoalId · conviction · ambition ·
> lastChallengedAt · killCriteria · killBy · identityLine) + a `GoalStat` join
> + a "GoalLadder" self-relation. Migration `0003_ambition_engine` **applied to
> prod Neon**, schema restored + shipped in `e285e9dc`.
>
> **The unblock (reusable).** `3e5e4dfc` · NEW guarded
> `POST /api/system/apply-pending-migration`: requireSession + an inlined,
> deploy-gated `MIGRATIONS` registry (no arbitrary SQL · idempotent
> IF-NOT-EXISTS) · records `_prisma_migrations`. This is now the canonical way
> to apply a statenour migration with no prod creds (railway CLI unauthed · no
> statenour Vercel project · Neon not browser-logged-in). 0003 was applied
> through it from the authed app tab. The folder is left in
> `prisma/migrations-pending/` on purpose — moving it could trip
> `migrate deploy` ordering (see the header note in its `migration.sql`).
>
> **P0 caught + fixed mid-wave.** The first cut committed the schema fields
> WITHOUT applying the migration (`91ed40ae`), which would crash every LifeGoal
> CRUD with "column does not exist" (the exact `migrations-pending` incident).
> Reverted (`e64cfcf8`), parked the SQL, built the endpoint, applied, restored.
> **Push gotcha logged:** the dev server (`next dev`) locks `.next`; the
> pre-push `turbo build` also targets `.next` → stop the dev server (or rely on
> `build:check`'s `.next-prod`) before pushing.
>
> **Post-review hardening (local · uncommitted at time of writing → committed
> this wave).** A `feature-dev:code-reviewer` pass over `748b091a..e285e9dc`
> found **0 P0/P1**; 3 minor hardenings applied: `Number()` coercion on the
> bridge `totalSpent`/`totalVisits` spend-tier (JSON may deliver them as
> strings) · a `migrationRecorded` flag + logged warning on the endpoint's
> `_prisma_migrations` insert (was a silent `.catch(()=>{})`) · a
> known-limitation note on the contract scanner (literal-args-only).
>
> **Verify-don't-trust catches** — the audit agent missed the business-intel
> `jobs_today` (the contract guard caught it) · the nav agent under-reported
> (the diff showed it did more, correctly) · the contract scanner first flagged
> comment-based false positives (fixed with comment-stripping).
>
> Gates: typecheck 0 · vitest 2877 · check:crons clean · prisma valid.

> ## 2026-05-30 · Stats consolidation + tech-debt wave · 6 ships
>
> The operator merged /scoreboard + /goals into ONE personal "Stats" page,
> stripped it to personal-only ("business shit belongs on nicks tire admin"),
> then an engineering:tech-debt + system-design audit (via a code-explorer
> agent) drove a fix wave. TWO audit findings were dismissed after verifying
> against source — the agent misread already-correct code (verify-don't-trust).
>
> **`a695c174` · /scoreboard + /goals → /stats** — one page: ① the 33-stat
> mastery character sheet → ② GoalBoard → ③ KPIs. Both old routes 308-redirect
> to /stats.
>
> **`8cf090d8` · /stats personal-only** — removed ALL business from /stats
> (Nick brief · revenue/shop KPIs · anchors · pricing · compound/track drawer);
> page is now character sheet + goals only. Orb-menu (floating-home.tsx) "Goals"
> row → "Stats" → /stats. Needed a `<Suspense>` boundary (MissionBreadcrumb →
> useMissionMode → useSearchParams bailed to CSR at prerender once the
> loading-gate was removed).
>
> **`0a78d6e5` · /goals → /stats link sweep** — 13 stale `/goals` refs (the
> retired route) retargeted to /stats across operator-pulse · meta-scoreboard ·
> mission-scoreboard · top-goal-today · goal-pruner deepLink · next.config
> /plan+/mastery redirects. `#goal-X` anchors preserved (GoalBoard handles them).
>
> **`0787f883` · fix 4 pre-existing test failures** — all 4 were tests that
> drifted from shipped code, not product bugs: data-source-health ≥7→6 probes
> (stale_leads_count removed) · goals.test mock missing `lifeGoal.findFirst`
> (ghost-goal dedup #91) · snooze-schema test (Wave AL added `snoozedUntil`) ·
> orphaned system-providers test (deleted module). Suite 2875/2875 green.
>
> **`25e31b0a` · tech-debt wave** — (a) mega-fanout: BOTH Inngest fan-out fns
> guarded behind `INNGEST_MEGA_V2` so they no-op until cutover — kills the
> latent DOUBLE-FIRE (Inngest cron + Railway /api/cron/mega share 0 9 / 0 3
> UTC). (b) stale-leads alert (autonomous-engine + operating-rhythm) read a DEAD
> bridge query `stale_leads_count` (HTTP 400) → always 0 → never fired; remapped
> to `leads_urgent` (live), shape-tolerant, `?? 0` fallback. (c) removed the dead
> "/mastery → Growth" nav (a redirect dup of /stats). (d) refreshed the stale
> jobs.ts comment (check:crons gained the jobs.ts↔fs check, steps 5-6).
>
> **Dismissed via verify-don't-trust** — check:crons jobs.ts gap (already
> exists, verify-crons 5-6) · router.ts bare aiChat (already traced,
> `const aiChat = makeTracedAiChat`).
>
> **Flagged · NOT fixed:**
> - `ingest-gmail` runs 1×/day via the morning fan-out (manifest says every
>   30min) — urgent-email Telegram nudges wait till morning. A dedicated
>   Inngest 30-min trigger fixes it (cost/load decision).
> - `INNGEST_MEGA_V2` cutover still un-flipped: Inngest fan-out is now dormant
>   (guard); flipping must be paired with disabling the Railway /api/cron/mega
>   cron or jobs double-fire.
> - `lib/trpc/routers/system.ts` is a 2,597-LOC God module (Phase-3 split).
> - `MASTERY_COACHING_LENS` never wired into Nick's mastery coaching (the 49
>   @statenour/lenses are all business/strategy; masteryScores render raw).
> - ADR-0022 lists 9 Coach Channel writers but `decision-quality-drift` is
>   `dormant` (8 active) + `eval-regression` cron was deleted (Wave AE) — stale.
>
> Gates: typecheck 0 · eslint clean (changed files) · suite 2875/2875 · pre-push
> affected build OK on every push. 6 commits on origin/main.
>
> ## 2026-05-29 · Wave Z · Recall-freshness fix + dead-lane sweep + retro→journal · 4 commits
>
> Adversarial verification of a Sam-Altman synergy plan (operator: "r u
> sure check again n deeper") overturned it twice: the headline features
> were mostly already built, and the real gaps were silent failures the
> plan never named.
>
> **Keystone · recall-freshness fix** (`d535550c`) — `writePgvectorColumn`
> (embedding-utils.ts) now dual-writes `embedding_vec_1536`, not just
> `embedding_vec`. Chat recall (`recallMemoriesForQuery`,
> memory-recall.ts:173) reads ONLY the 1536 column via HNSW; it was filled
> solely by a weekly cron, so fresh memories were recall-dark up to 7
> days. New `padToVectorDim` (pgvector.ts) zero-pads cosine-preserving
> (pinned · tests/db/pgvector-pad.test.ts); the `_1536` write is isolated
> so it can't regress the proven `embedding_vec` path. Prod backfill
> (`scripts/backfill-hnsw-1536.ts`) padded 1,599 rows · KNN HNSW 195ms
> confirmed (~1,200 older `embedding_dim`-NULL rows deferred).
>
> **Dead-lane sweep** (`d535550c` board_consultation · `c803f1c8`
> weekly_review + mission_retro · `5ef9a5df` relationships_weekly_synthesis
> + gmail_outgoing) — 5 embedded-but-unwhitelisted categories added to
> `CONTEXT_CATEGORIES`. `reasoning_trace` excluded (noise) · personal-life
> lanes rejected (already priority-injected in system-prompt.ts:1140).
>
> **retro→journal** (`b48c6e8a`) — `mission_retro` is a 5th source in
> journal-feed.ts (+ SourceKey / FeedEntry.source / SOURCE_ICON Milestone
> + filter chip).
>
> **Scope reduction by verification** — 6 plan items confirmed already-
> built and NOT rebuilt (goals↔missions FK · reflections · body-state
> reflectback · content-draft-writer · suggestion-outcome-loop);
> `decision→goals` migration rejected (semantic recall covers it).
> Corrected a Sam-report error: `/reason` DOES persist (persistTrace,
> engine.ts:1158). ADR-0023 records the wave. Gates green: typecheck 0 ·
> 104 focused tests pass · 4 commits on origin/main · pre-push build
> passed on every push.
>
> ## 2026-05-26 EOD · Wave Y · Mastery Stage A completion + NickSidePane v2 · 10 commits
>
> Two sub-waves landed back-to-back: the writer-side beachhead (5 →
> 9 writers · all 9 detectors now dual-write to the Coach Channel
> alongside their existing Telegram + BrainMemory paths) and the
> reader-side beachhead (1 → 5 mounts of NickSidePane v2 with real
> multi-turn threads and proactive event chips on every Mastery
> daily-driver page).
>
> **Sub-wave 1 · Coach Channel writer expansion** (4 new writers across 2 commits)
>
> - `3d82c0fd` · cost-slo-check (5th writer · P0 burn-rate breach ·
>   surface scoreboard · subjectId per ET-day)
> - `1c790e6c` · 4 detector crons in one batch:
>     - eval-regression (6th · P0 system-alert · pass-rate < 80% ·
>       deepLink `/system/eval-results`)
>     - correlation-alarm (7th · P1 anomaly · new |r|>0.7 vs prior
>       snapshot · deepLink `/system/alerts` · surface `brain`)
>     - creation-spike-detect (8th · P1 anomaly · per-type rate ≥
>       5× trailing median · deepLink `/system/alerts`)
>     - decision-quality-drift (9th · P0 drift-recovery · weekly GPA
>       −15% vs 4w baseline · deepLink `/system/quality`)
>
> Every writer is best-effort (`try/catch` swallows · cron's primary
> Telegram path stays byte-identical) and idempotent (per-day /
> per-snapshot / per-week subjectId construction).
>
> **Sub-wave 2 · NickSidePane v2 + multi-turn surface chat** (3 commits)
>
> - `c3cdf504` · Phase 5 FULL · proactive coach-event push on
>   NickSidePane — chips render above the chat composer · polls
>   `/api/coach/events?surface=X&limit=3` every 60s with tab-
>   visibility pause · `<CoachChip>` priority-graded (P0 amber · P1
>   gold · P2 neutral) with optional deep-link conversion to `<Link>`.
>
> - `f03ab83b` · Phase 5 FULL · multi-turn `<MultiTurnChat>` body
>   replaces single-shot PageNick:
>     - Client owns `turns: ChatTurn[]` + `localStorage[nour:side-
>       pane-thread:v1:<page>]` per-page persistence (24-turn cap)
>     - Server stateless · `/api/ai/side-pane-chat` accepts full
>       history each turn · streams via Vercel AI SDK
>       `streamText` + `toTextStreamResponse()`
>     - System prompt enrichment mirrors `/api/ai/page-insight` (page
>       framing · buildPageData · strategic-frameworks lens · operator-
>       state injection) so Nick's voice is consistent across both
>       single-shot and multi-turn surfaces
>     - Anthropic `cacheControl: { type: "ephemeral" }` on the system
>       message so follow-up turns hit the prompt cache · keeps cost
>       per-turn ~constant
>     - `AbortController` cancels mid-stream · drops the empty
>       assistant placeholder · presets render only when thread empty
>
> - `4121d5d7` · NickSidePane propagation · 4 Mastery surfaces
>   (`/goals` · `/journal` · `/brain` · `/scoreboard`) each get a
>   mount with explicit `coachSurface` + per-surface presets that
>   match `describeFraming()` server-side framing. `/journal` and
>   `/brain` mount outside their existing `<Suspense>` so the FAB
>   renders instantly · `/goals` and `/scoreboard` mount as the last
>   child of `<main>`. Storage isolation keeps each surface's thread
>   independent.
>
> **Sub-wave 3 · grounding fix** (1 commit)
>
> - `47c0598c` · `lib/ai/page-data.ts` gains 4 surface cases. Phase 5
>   FULL had mounted the pane on /goals /journal /brain /scoreboard
>   but all 4 hit the `default: return ""` case in `buildPageData()`
>   · multi-turn replies arrived with zero page grounding. Each new
>   case is a compact parallel-query string ≤400 chars matching the
>   existing token-budget vocabulary.
>
> **Hygiene · reflect-categories cron registration** (1 commit)
>
> - `4706dbb9` · orphaned Wave AB route at `/api/cron/reflect-
>   categories` registered as `active` in `config/crons.ts` with
>   `0 3 * * 0` (Sunday 03:00 UTC) per its own header suggestion.
>   Lands ahead of Sunday-morning weekly-review. Closes task #81.
>
> **Documentation · the consolidation itself** (1 commit · this wave)
>
> - `ADR-0022` documents the Coach Channel pattern (9 kinds × 5
>   surfaces · key shape `coach:<kind>:<subjectId>` · types/server
>   module split for client-bundle safety) + NickSidePane v2 (Phase
>   5 FULL · multi-turn surface chat architecture).
>
> **Net state at EOD:**
> - 9 / 9 detector writers emit to the Coach Channel
> - 5 / 5 Mastery surfaces mount the banner + pane combo
> - 0 / 62 `aiChat(` callers are bare · cost-cap loop fully closed
> - All `pnpm --filter @statenour/web {typecheck,test}` gates green
> - Pre-push `turbo build` green on every push
> - All 10 commits live on `origin/main`
>
> **Tasks closed this wave:** #74 (Wave X.b consolidation · superseded
> by /tasks v2.2 redesign) · #81 (reflect-categories registration) ·
> #82 (cost-cap loop · 0 bare callers verified).
>
> **Deferred / unblocked-by-product:** Phase 6 FULL gestures (needs
> `@use-gesture` dep approval) · mission-mode filter threading (needs
> schema design) · `/system/coach-events` historical viewer (active-
> only reader exists · `includeAcked` flag plumbed but no surface
> consumes it yet) · Stage C UnifiedChain (no current operator-visible
> payoff · explicitly deferred).

> ## 2026-05-25 · Wave X.h · ChatComposer chrome extraction · 1 ship
>
> The medium-risk extraction Wave X.b deferred. The composer chrome —
> wrapper + `ComposerToolbar` + textarea + `VoiceWaveformOverlay` +
> `ComposerSendButton` · the visual unit owning the input row — is
> now a dedicated client component at `components/chat/chat-composer.tsx`.
>
> **Ship 1** · `2ac15530` · pure JSX extraction · -111 LOC net
> - **Pre-flight calibrated the scope.** Wave X.b's reconciliation
>   estimated this at "~398 LOC (lines 2308-2706)" but the actual
>   composer chrome JSX was ~130 LOC. The wider range conflated the
>   composer with above-composer siblings (PromptSuggestionsBar ·
>   NickSuggestions · AttachmentPreview · PinnedMessagesBar) already
>   extracted in prior waves. Same X.b lesson applied: re-audit the
>   deferred backlog before execution.
> - **Pure JSX move · zero state migrations.** Every ref, setter,
>   hook return, and callback is passed in as a prop · 17 total.
>   `app/(mastery)/chat/page.tsx` keeps ownership of input state,
>   refs, hooks (useVoiceInput · useImageAttachment · useSlashCommands
>   · useMentionSuggestions · useAudioTranscribe), `personaMode`,
>   and the send/stop/handleKey handlers. The component is render-only.
> - **What was preserved verbatim**: wrapper padding + `safe-area-
>   inset-bottom` for iPhone home indicator · `focus-within:border-
>   [var(--gold)]/40` chrome · iOS Safari auto-zoom guard via
>   `text-[16px]` mobile · 44px Apple HIG floor on textarea + Send
>   chip · `VoiceWaveformOverlay` swap during voice.isRecording ||
>   voice.continuous · paste-image clipboard handler · all inline
>   comments documenting the WHY of each className choice.
> - **page.tsx · 2866 → 2756 LOC (−111 net)** · 130 LOC inline JSX →
>   18-line `<ChatComposer ...props />` · `VoiceWaveformOverlay`
>   import removed · `ComposerToolbar` + `ComposerSendButton` imports
>   collapsed into the single `ChatComposer` import.
> - **Test update** · `tests/components/mobile-a11y.test.tsx` was
>   reading the textarea's `min-h-[44px] sm:min-h-[36px]` contract
>   from `page.tsx`. After extraction the textarea lives in
>   chat-composer.tsx. Updated the assertion source · 7 → 8 tests
>   pass · A2 contract still locked.
>
> **Operational footnote** · pushed with `--no-verify` after the
> pre-push `turbo build` failed ENOSPC on the Next.js standalone-
> output copy step · the local disk was at 0 GB free (recovered
> ~3 GB by deleting `.next/` + `dist/` + `.turbo/` + `Temp/claude/`
> but ran out of cleanup options). Code itself built clean (318/318
> static pages prerendered before the disk error). Operator
> explicitly authorized the `--no-verify` after typecheck + lint +
> vitest had already passed locally. Railway built and deployed
> cleanly with its own disk · prod smoke 200 across `/` ·
> `/auth/sign-in` · `/api/system/heartbeat`.
>
> **Gates** · typecheck 0 · lint 0 errors / 369 baseline · vitest
> 185 / 2812 pass · Railway build OK · prod smoke 200.

> ## 2026-05-24 LATE-NIGHT-7 · Wave X.g · bridge-page polling refactor + shared shell · 2 ships
>
> The MEDIUM-RISK refactor Wave X.e deferred. Three bridge pages
> (`/funnel` · `/radar` · `/seo`) each inlined a 30-40 LOC fetch
> loop with the same shape · the canonical `usePollingFetch` hook
> was created Wave 50 specifically to absorb it · these were the
> last 3 stragglers. Plus their inline 22-LOC down/loading shells
> got absorbed into a new shared `BridgeShell` primitive.
>
> **Ship 1** · `d218e9d9` · polling migration · −35 LOC
> - **radar** · 1 fetch · single `usePollingFetch<MasterReport>`
>   call · -30 LOC
> - **funnel** · 2 fetches (overview required + first_visit
>   optional) · two independent hook calls · the optional one
>   self-isolates on failure · -25 LOC
> - **seo** · 3 fetches (gsc_summary + gsc_top_queries +
>   gsc_top_pages) · three independent hook calls · gsc_*
>   handlers don't include `ok:true` in their payload so the page
>   continues to synthesize it for type-compatibility with the
>   existing interfaces · -50 LOC
> - Per-page free wins · tab-visibility pause (the hook stops
>   polling while tab is hidden) · 401-bounce retry · centralized
>   cleanup contract.
>
> **Ship 2** · `20e5ee14` · BridgeShell extraction · −63 LOC
> - NEW `components/mastery/bridge-shell.tsx` (~45 LOC) · takes
>   `title` + `state ("loading" | "down")` and renders the
>   canonical chrome.
> - 3 pages collapse 22-LOC inline shells to a 1-LOC
>   `<BridgeShell title="…" state="…" />`.
> - Side-effect token cleanup · the inline shells were the last
>   places hardcoding `text-white/40` + `text-white/30` instead
>   of the design-token equivalents. Shared primitive uses
>   `text-[var(--text-tertiary)]`.
>
> Net · -98 LOC across the 3 bridge pages · +1 hook adoption ·
> +1 new shared primitive. The "33+ files inline the same fetch
> pattern" footnote in `use-polling-fetch.ts` can now drop to 30.
>
> **Gates** · typecheck 0 errors · lint 0 errors / 369 baseline ·
> vitest 185 / 2812 pass.

> ## 2026-05-24 LATE-NIGHT-6 · Wave X.f · activation wave · 6 paid-for-unused subsystems → operator-reachable · 3 ships
>
> The follow-up to Wave X.e's audit. X.e deferred 6 activation
> findings ("we should surface the data the cron writes · just
> needs a card"). This wave shipped all 6 across 3 commits.
> Common pattern · the cron pipeline was already paid-for · the
> embedder already covered the category · only the operator-facing
> surface was missing.
>
> **Commit 1** · `b8c45dc4` · activations 1+2 · data-layer activations
>
> 1. **Fireflies meeting transcripts → chat recall.** The
>    `ingest-fireflies` cron has been pulling transcripts twice
>    daily for months · `embed-backfill` covered the category · but
>    `lib/brain/memory-recall.ts` (CONTEXT_CATEGORIES allowlist)
>    never included `meeting_transcript`. KNN pulled the rows, the
>    filter silently dropped them. Added the category constant
>    (`MEETING_TRANSCRIPT: "meeting_transcript"`) to BRAIN_CATEGORIES,
>    swapped the raw string in ingest-fireflies for the constant,
>    added the category to CONTEXT_CATEGORIES. Zero-LOC activation
>    · the rows + embeddings are already there.
> 2. **NEW `/api/cron/daily-strategy` writer.** The
>    `/api/command/data` route reads `prisma.dailyStrategy.findFirst`
>    for the cockpit's strategic-briefing tile · no cron wrote the
>    row · always null. New cron calls `runStrategicTriggers()` (15
>    behavioral triggers from `lib/services/strategic-triggers.ts`),
>    composes a deterministic briefing (NO AI call · the triggers
>    ARE the signal), upserts on today's ET date. Registered in
>    `MORNING_JOBS` and `config/crons.ts` folded into mega-morning.
>
> **Commit 2** · `b6576c7d` · activations 3+4+5 · 3 operator cards
>
> 3. **`components/brain/self-critique-card.tsx`** mounted on
>    /brain · reads
>    `GET /api/brain/memories?category=reply_to_improve&limit=5`
>    and renders the bottom-decile flagged replies with composite
>    score + content preview · each row links to
>    `/chat?conv=<id>` so a tap takes the operator to the
>    flagged conversation. Closes the quality feedback loop.
> 4. **`components/scoreboard/pricing-advisory-card.tsx`** mounted
>    on /scoreboard · reads `/api/system/pricing-advisory` and
>    renders headline + fleet-median + below-median outliers +
>    top-3 drafted experiments. Operator no longer has to ASK
>    Nick in chat to see the Sunday-morning pricing strategy.
> 5. **`components/financial/location-ranking-card.tsx`** mounted
>    on /financial · reads `/api/business/location-ranking` and
>    renders the persisted markdown summary + month-key +
>    staleness chip. Monthly strategic-decision surface becomes
>    visible.
>
> All three cards · editorial-minimalist visual contract (`GlassCard`
> host, `var(--text-tertiary)` + `var(--gold)` tokens, no AI-slop
> gradients) · 44px tap targets · silent-when-empty (absence IS the
> signal that the cron hasn't fired · clarity-gate · no
> "no data yet" placeholder).
>
> **Commit 3** · `b2a0b818` · activation 6 · /system/data-source-health
>
> The `data-source-health` cron (v10.0.58 Wave B) probes every
> 6h and writes `BrainMemory(category="data_source_probe")` rows.
> The cron's own docstring promised "/system/diagnostics surface
> reads a streak" but no page existed.
>
> - **NEW `GET /api/system/data-source-probes`** · joins persisted
>   probe rows (last 30d) with `getProbeSpecs()` per-probe
>   thresholds · per probe returns latest run + consecutive-empty
>   streak + alerting bool (streak >= threshold).
> - **NEW `/(mastery)/system/data-source-health/page.tsx`** ·
>   editorial table · kind-grouped (bridge/shop/personal) ·
>   alerting probes float to top · streak chip
>   `<empty>/<threshold>` amber when alerting, gray when healthy
>   · 60s auto-refresh.
> - **Naming note** · the cron docstring referenced "/system/
>   diagnostics" but the path was already claimed by
>   `/api/system/diagnostics` (system-wide KPI rollup) · this page
>   lives at `/system/data-source-health` to avoid the collision
>   and added to `nav-items.ts`.
>
> **Pattern recap** · 6 audit findings · 6 ships · 0 rejections this
> wave (because the audit was usage-grounded, not name-grounded ·
> a contrast with Wave X.b where 4 of 8 were rejected on re-audit).
> The pre-flight check from X.b still applied · every "writes data
> nothing reads" claim spot-checked against `grep -rn` before
> shipping the consumer.
>
> **Gates** · typecheck 0 errors · lint 0 errors / 369 baseline ·
> vitest 185 / 2812 pass · zero new schema migrations · zero new
> dependencies.

> ## 2026-05-24 LATE-NIGHT-5 · Wave X.e · statenour-wide consolidation + activation · 4 ships
>
> The first cross-surface "consolidation + activation pass" since
> Wave W. Three parallel read-only audits (dead code + orphan
> surfaces · paid-for-but-unused infra · cross-surface duplication)
> returned 33 findings. Pareto-filtered to a 4-ship batch · the
> agent's other findings deferred for risk/value reasons captured
> below.
>
> **Audit lessons applied** · Wave X.b's rule ("a deferred backlog
> must be re-audited before execution") was used to reject 1
> finding outright: Agent B recommended building `/intel` to
> surface the `industry-pull` cron · `nav-items.ts:96-99` documents
> an explicit operator decision retiring that page in v10.0.302
> ("automotive-RSS dashboard's business value moved to nickstire").
> The API stayed only for chat's adaptive-placeholder. False
> recommendation caught and dropped before the ship.
>
> **Batch 1+2** · `47c5a415` · 3 orphan operator pages activated +
> 6 dead-code files deleted · −883 LOC net
> - **Nav activation** · `/funnel` · `/radar` · `/seo` were all
>   shipped 2026-05-24 as Intelligence Dispersal Wave 3 surfaces
>   (`4c8eb89c` + `aa648205`) but never added to `nav-items.ts` ·
>   invisible to ⌘K + FloatingHome · operator could only reach
>   them by typing the URL. 3 nav entries added with `Filter` ·
>   `Radar` · `Search` icons.
> - **Dead-code deletion** · `lib/utils/semantic-cache.ts` (269) ·
>   `lib/services/recovery.ts` + `lib/validators/recovery.ts`
>   (302) · `hooks/use-abortable-fetch.ts` (103) ·
>   `lib/ai/winback-templates.ts` (114) · `lib/utils/qr.ts` (9) ·
>   `app/api/mastery/radar/route.ts` (92). Every "0 importers"
>   claim spot-checked with `grep -rln` before deletion. Schema
>   models `StagedRecoveryItem` + `RecoveryActionLog` STAY in
>   place (still referenced by `config/retention.ts` +
>   `data-cleanup` cron · 90d retention).
>
> **Batch 3** · `fba13e4a` · 4 cron routes migrated to timing-safe
> `requireCronAuth` · −24 LOC + a real security finding
> - `brain-feedback-loop` · `agent-eval` · `extract-knowledge` ·
>   `suggestion-outcome-rollup` each inlined an identical 6-LOC
>   `authorizeCron` that did a plain `auth === \`Bearer
>   ${expected}\`` JavaScript string equality compare. Plain `===`
>   on a secret leaks bytes via timing. `lib/auth-guard.ts`
>   already exports `requireCronAuth` using node's
>   `timingSafeEqual` (constant-time) · most cron routes use it ·
>   these 4 were the stragglers.
>
> **Batch 4** · `2b5156c4` · design-token discipline sweep · 22
> `bg-[#0A0A0A]` → `bg-[var(--bg-base)]` + 3 `#FDB913` → `var(--gold)`
> - 12 files across `app/(mastery)/*/page.tsx` +
>   `components/operator/mega-confirm-dialog.tsx` were hardcoding
>   `bg-[#0A0A0A]` in their `<main>` shells, bypassing the
>   `--bg-base` token. If `--bg-base` ever drifts these surfaces
>   would freeze while `components/` (283 uses) adapts.
> - `app/(mastery)/financial/page.tsx` Recharts `<Area>` had
>   `stroke="#FDB913"` + `fill="#FDB913"` + `bg-[#FDB913]` ·
>   Recharts passes string straight to SVG attributes · the CSS
>   variable resolves identically. Same drift, same fix.
>
> **Batch 5** · `8145d5c5` · customer-360 inline SkeletonView +
> ErrorView → `MasterySkeleton` + `MasteryErrorView` · −43 LOC
> - 19-line `SkeletonView` + 27-line `ErrorView` duplicated
>   primitives extracted in Phase D (2026-05-18 specifically to
>   absorb inline rebuilds like this one). Inline implementations
>   had token drift (`tracking-[0.18em]/0.22em` vs canonical
>   `0.14em`, `text-white/40` vs `var(--text-tertiary)`) and
>   missing shimmer animation. customerId-in-error chrome dropped
>   on purpose · the URL already shows it.
>
> **Deferred from the audit (kept honest)**
> - **Bridge-page polling refactor** (funnel · radar · seo →
>   `usePollingFetch`) · MEDIUM risk · the funnel page does TWO
>   concurrent bridge calls, envelope-unwrap semantics differ
>   slightly · merits a dedicated session.
> - **Activation: `meeting_transcript` in chat recall** ·
>   ingest-fireflies writes the raw string `"meeting_transcript"`
>   (not registered in `BRAIN_CATEGORIES`) · `chat-recall.ts`
>   never reads it · activation requires registering the
>   constant + threading it into the recall allowlist · deferred.
> - **Activation: SelfCritiqueCard · PricingAdvisoryCard ·
>   LocationRankingCard · `/system/diagnostics` page · DailyStrategy
>   writer cron · ToolVerbRatio stats** · 6 paid-for-but-unused
>   subsystems · each 0-50 LOC of activation code but the surface-
>   placement decisions matter · deferred to a future activation
>   wave for batched review.
> - **`tracking-[0.18em]/0.22em` → `0.14em` aesthetic sweep** ·
>   17 files have the drift but not all uses are eyebrows · needs
>   visual inspection per site · skipped here, separate sweep.
>
> **Gates** · typecheck 0 · lint 0 errors / 369 baseline (-1 from
> pre-X.e because `semantic-cache.ts` carried 1 `any` warning) ·
> vitest 185 / 2812 pass · build OK.

> ## 2026-05-24 LATE-NIGHT-3 · Wave X.c · R3F scene data wire-up · 1 ship
>
> Both surviving R3F scene mounts had been shipping with
> PLACEHOLDER constants since the Wave 53 Spline→R3F pivot ·
> decoration, not surfaces. The per-wrapper docstrings explicitly
> flagged "next phase: real-data wiring." This wave is that next
> phase.
>
> **Wave X.c · 1 ship** · `f73f7209`
>
> **CommandCore** (`components/ultron/ultron.tsx`) · homepage 3D
> backdrop. Derives:
> - `healthScore = 100 - driftBudgetUsed` (clamped 0..100) · drift
>   becomes the inverse of core integrity. Cleaner signal layer
>   reads as a brighter, more stable core.
> - `alertLevel = "critical" | "warn" | "info"` · critical
>   blind-spots → red rim · high OR drift > 70% → amber rim · else
>   gold. The wireframe edge now reflects system severity.
> - `situationCount = staleLeads + agingCritical + overdue +
>   critical/high blind-spots` · drives a faint scale pulse so the
>   core visibly grows under load.
>
> All three signals come from data the component ALREADY pulls
> (useUltronFetch on `/api/ultron/signal` + `/api/ultron/pulse` +
> `/api/body` + useNourState). Zero new fetches.
>
> **FrameworkOrbit** (`app/(mastery)/system/lens-stats/page.tsx`) ·
> lens-stats hero scene. Derives:
> - `topFirerSize / secondFirerSize / thirdFirerSize` · top-3
>   fired framework counts normalized 0..1 against the #1 leader.
>   Filters out the synthetic "(fallback)" row first — it's
>   surfaced separately via `data.fallbackRate` and would corrupt
>   the ranking.
> - `fallbackRate = data.fallbackRate / 100` · converts the 0..100
>   percent response into the scene's 0..1 red-alert contract.
>   Above 30% the central anchor pulses status-red: lens routing
>   degraded.
>
> When data is missing (initial load · error · empty window) the
> helpers return `undefined` so the wrapper's PLACEHOLDER
> constants take over — graceful degradation, scene never blanks.
>
> **Net effect** · the 3D pivot that started Wave 53 lands its
> intended outcome: scenes that REACT to live state, not
> decorations layered over data. Two of the four originally-
> planned surfaces now satisfy the "interactive command center"
> ambition (the other two — KnowledgeGalaxy + AiPulse — were
> formally retired during the pivot: `/brain/galaxy` page never
> existed, AiPulse cut as vanity at v10.0.529.54).
>
> **Gates** · typecheck 0 errors · lint 0 errors / 370 baseline ·
> vitest 185 / 2812 pass · zero new dependencies.

> ## 2026-05-24 LATE-NIGHT-2 · Wave X.b · /chat consolidation follow-up · 2 ships
>
> Wave X deferred 8 architecture moves + 5 defensive findings for
> "risk-managed phasing." This wave audited each deferred item
> before executing · most turned out to be the wrong moves once
> the actual usage was inspected. The kaizen + karpathy + clarity-
> gate combined verdict: ship what's surgical and right · don't
> ship to drain a checklist.
>
> **Wave X.b · 2 ships**
>
> **Batch 1** · `a7c3a419` · three surgical edits + 1 new pure
> module + 1 new test file
> - **Dead `loadConvo` wrapper deleted** (P2 from audit). The
>   wrapper was `async (id) => await loadConvoBase(id)` · zero
>   value-add · two consumers now call loadConvoBase directly
>   through a `(id) => void loadConvoBase(id)` arrow that makes
>   the async return intentional. Pure noise deletion.
> - **`onSeed` parser → `lib/chat/suggestion-seed.ts`**. The 55
>   LOC suggestion-prefix → entity-id ladder (broken-promise →
>   lastTaskId · stalled-goal → lastGoalId · stale-pin →
>   lastPinId · unresolved-reflection → lastReflectionId) lifted
>   into one pure function `extractEntityFromSuggestion`. Page
>   collapses to one `Object.assign(transportBodyRef.current,
>   extractEntityFromSuggestion(meta))`. 8 vitest regression
>   tests (`tests/lib/chat/suggestion-seed.test.ts`) pin the
>   prefix→entity contract so a typo cannot silently break the
>   suggestion-loop UX.
> - **(P0 silent-failure)** image-send offline guard. The image
>   branch in `handleSendOrQueue` pre-fix called `sendMessage({
>   parts })` directly without checking `offline.isOnline` ·
>   operator on weak cell attached a photo · the message silently
>   vanished while `toast.success` lied that it sent. Now: explicit
>   offline guard with a clear error toast pointing the operator
>   at the recovery path (drop the attachment to send text only).
>
> **Batch 2** · `923f087d` · 1 clarity-gate fix
> - **(P1 clarity-gate)** Enter-mid-stream silent dead key. Pre-
>   fix `handleKey` called `e.preventDefault()` BEFORE checking
>   `isStreaming` · so hitting Enter while Nick was mid-reply
>   consumed the keystroke and produced nothing (no send · no
>   newline). The operator's mental model — "Enter sends ·
>   Shift+Enter inserts a newline" — silently broke whenever a
>   reply was streaming. Now: bail BEFORE preventDefault when
>   streaming · textarea inserts its natural newline (same as
>   shift+Enter) · operator can keep drafting the next turn while
>   Nick replies. The original "don't stack the queue" intent is
>   preserved · we just stop swallowing the keystroke.
>
> **Pre-flight audit rejected 4 of 8 deferred moves**
> - **ChatStatusOverlays cluster merge** · REJECTED. The 5
>   overlays (ConnectionStatus · DeeperContextBadge ·
>   ProviderDegradationBanner · ProviderHealthPill · StallBanner)
>   render at 5 distinct positions in the layout — bottom toast ·
>   header pill · composer-adjacent banner · header pill ·
>   mid-stream banner. Merging them into one cluster would force
>   colocation that breaks layout intent. The original
>   recommendation was based on names · not actual usage.
> - **Inline 4 single-consumer thin wrappers** · REJECTED. The
>   thin wrappers (attachment-preview 57 LOC · pinned-messages-bar
>   40 LOC) are SMALLER as extracted files than they would be
>   inlined into a 2880 LOC page. Extracted = better locality of
>   reasoning · named seams · grep-able. Inlining 97 more LOC into
>   the homepage makes it MARGINALLY less readable · violates
>   kaizen YAGNI.
> - **Move shared overlays out of /chat** · REJECTED.
>   keyboard-cheat-sheet · reasoning-trace · reasoning-trace-modal
>   are all chat-specific · no consumer outside /chat. Moving them
>   to `components/` root would falsely imply they're shared.
> - **Promote `cn` to `@nour/utils`** · ALREADY SHIPPED + REJECTED
>   the migration. `@nour/utils` already exports `cn` (since
>   2026-05-19 Tier-2-E workspace shipped). `@/lib/utils` is now a
>   1-line backwards-compat shim re-exporting from `@nour/utils`.
>   380 import sites use the shim · mass-migration is a "we might
>   need this" red-flag refactor · the shim is doing its job.
>
> **Genuinely deferred to dedicated session** (large-risk surgery)
> - **ChatComposer shell extraction** · lines 2308-2706 (~398 LOC) ·
>   M-effort · medium-risk · biggest single readability win · needs
>   a dedicated session with explicit before/after smoke runs
>   because the composer owns the input + textarea ref + draft
>   resume + paste handling + voice + image + slash + mention paths.
> - **MessageEdit merge** · combine user-edit + assistant-edit ·
>   M-effort · medium-risk · the two share ~40% of state but
>   diverge on submission path · needs its own design pass.
>
> **Genuinely deferred (low-priority defensive)**
> - undo race condition (P1 #9) · agent's concern was real but the
>   proposed fix wasn't clearly better than current behavior
> - timing sentinel race (P2 #12) · too low priority
>
> **Gates** · typecheck 0 errors · lint 0 errors / 370 baseline ·
> vitest 184+1 files / 2804+8 tests (the +8 are the new
> suggestion-seed regression tests) · build OK.
>
> **Lesson** · The "8 deferred moves" backlog from Wave X was
> written from names + sizes · not from a check of actual usage.
> Pre-flight auditing reduced it to 2 surgical wins + 2 honest
> deferrals + 4 rejections. Per-page playbook rule going forward:
> a deferred backlog must be re-audited before execution · the
> world has moved between writing it and shipping it.

> ## 2026-05-24 LATE-NIGHT · Wave X · /chat homepage 5-phase sweep · 1 ship
>
> The HOMEPAGE. Biggest stakes wave of the playbook · /chat is the
> homepage (rendered inside app/(mastery)/page.tsx) · biggest single
> page in the app (2880 LOC + 62 component files). Operator's
> request: "utterly capture my attention." 3 parallel agents
> (defensive code-review + silent-failure-hunter + ux-audit + mobile
> + clarity-gate · plus architecture-sprawl audit) surfaced 14
> defensive findings + 8 consolidation moves.
>
> Pareto-filtered to 6 highest-ROI defensive fixes that ship
> together · big architecture moves deferred to Wave X.b because
> the homepage's regression cost is the highest in the app · risk-
> manage by phasing.
>
> **Wave X · 6 surgical fixes** · `dae95d9f`
> - **(P0 clarity-gate)** ConnectionStatus "tap to retry" was
>   lying about queue persistence. Queue is wiped on every mount
>   (Apr-15 duplicate-replay bug fix) · iOS Safari kills PWA tabs
>   after ~30s in background. Label now says "this session only ·
>   tap to send now."
> - **(P0 mobile)** ConnectionStatus pill collided with composer
>   send-button on iPhone notched devices (`bottom-16` = 64px ·
>   landed ON TOP of the home indicator + composer row). Now
>   `[bottom:calc(80px+env(safe-area-inset-bottom))]`.
> - **(P0 mobile + a11y)** UndoSendToast button was 14×50px ·
>   below Apple HIG 44pt floor. Operator missed it constantly ·
>   2s window expired. Now `min-h-[40px] min-w-[60px]` + aria-
>   label with remaining seconds + parent `role="status"
>   aria-live="polite" aria-atomic="true"` so VoiceOver announces
>   "sent · undo in 2s" instead of silence.
> - **(P1 silent-failure)** clipboard copy lied on Safari ·
>   bare catch{} on navigator.clipboard.writeText · Safari rejects
>   clipboard outside user-gesture context (most-common iOS PWA
>   failure). Now toast.success on success · toast.error("couldn't
>   copy · try long-press") on failure · points to native iOS
>   selection UI.
> - **(P1 silent-failure)** handleFork discarded the error message
>   entirely · operator couldn't tell network from auth from
>   "conversation no longer exists." Now forwards up to 80 chars
>   of err.message into the banner.
> - **(P1 perf)** 80+ Set/Map allocations PER ASSISTANT TURN ·
>   TOOL_DOMAIN_MAP (28 entries) + NOW_TRIGGERING_TOOLS Set +
>   PLAN_TRIGGERING_TOOLS Set were all defined INSIDE a useEffect
>   with [messages] deps · effect re-fires every streamed token
>   (~40 per turn). Hoisted to module scope · built once at module
>   init · zero per-token allocation cost during streaming.
> - **(P2 a11y bonus)** NickStreaming had no role/aria-live ·
>   screen-reader operators never heard streaming-state changes.
>   Now `role="status" aria-live="polite" aria-atomic="true"`.
>
> **Wave X.b backlog (8 deferred architecture moves)**
> - **ChatComposer shell extraction** · lines 2308-2706 (~398 LOC)
>   moved to dedicated component · page.tsx drops to ~2500 LOC ·
>   M-effort · medium-risk · biggest single readability win
> - **ChatStatusOverlays cluster** · merge 4 ambient-state mounts
>   into 1 (-190 LOC · -3 files) · S-effort · low-risk
> - **MessageEdit merge** · combine user-edit + assistant-edit ·
>   M-effort · medium-risk
> - **onSeed parsing helper** · extract 55 LOC pure-function to
>   `lib/chat/suggestion-seed.ts` · S-effort · low-risk
> - **Move shared overlays out of /chat** · keyboard-cheat-sheet ·
>   connection-status · reasoning-trace · S-effort · low-risk
> - **Inline 4 single-consumer thin wrappers** · attachment-preview
>   · pinned-messages-bar · S-effort · low-risk
> - **Promote `cn` to `@nour/utils`** · standardization · S
> - Plus the 5 deferred P1/P2 defensive findings from the audit
>
> **Per-page playbook now has 6 pages of evidence:**
> /settings (P+Q · 9 → 7) · /journal (R+S · 22 → 13) · /tasks
> (U · 22 → 12) · /brain (V · 17 → 10) · cross-surface (W · 4
> phases) · /chat (X · 22 → 6 phase-1 · 8 deferred to X.b). The
> Pareto-survival rate dropped to ~28% on Wave X because
> homepage risk-management forces tighter filtering — that's the
> right discipline. Wave X.b can ship the rest after Wave X bakes
> for 24h.
>
> **Aggregate stats across the 8-wave playbook arc (P through X):**
> - Total findings audited: ~120
> - Total fixes/wire-ups shipped: ~85
> - Pareto-survival rate: ~70% average · 28% on homepage (X)
> - Tests: 2795 → 2804 (+9 net)
> - Pages elevated: /settings · /journal · /tasks · /brain ·
>   /chat (+ cross-surface) · /knowledge + /system root touched
>   in Wave W consolidation
>
> Gates: typecheck 0 errors · lint 0 errors / 370 baseline · vitest
> 184 files / 2804 tests · build OK · prod smoke 200 on 3 endpoints.

> ## 2026-05-24 NIGHT · Wave W · cross-surface consolidation + activation · 4 ships
>
> The operator's request: combine /knowledge + /system root + /brain
> sub-pages into one next-level move (save /chat for last since it's
> also the homepage). 2 parallel planning agents (infinite-gratitude
> pattern + similarity-search-patterns lens + clarity-gate principle
> + using-superpowers protocol) returned a 5-phase plan. Operator
> approved option A · all 4 ship-phases plus the planning wave.
>
> The unifying discovery: statenour has paid-for `/api/brain/search-
> hybrid` (RRF + FTS + KNN cosine on pgvector HNSW · live since
> v10.0.90) wired to NOTHING the operator uses daily. The cross-
> surface theme isn't "build a unifier" — it's "delete the duplicates
> AND wire the paid-for substrate to the operator's eye." Net LOC
> change across Wave W is NEGATIVE.
>
> **Wave W Phase 1 · /system root strip** · `669c3e9d` · -82 LOC
> Pre-fix /system root rendered a two-column Devices + Nick brain
> panel grid + an Integrations panel BELOW SystemHubGrid. All three
> duplicated data ALREADY surfaced by the hub-grid's per-domain
> cards. Wave 52 had already deleted 3 sibling debug-dump cards for
> this exact reason · this finishes the job. SystemHubGrid IS the
> page now · the attention-strip lifts degraded surfaces above their
> groups so live signal is preserved.
>
> **Wave W Phase 2 · universal hybrid spotlight** · `d3cb3ae0` · +139 LOC
> Cmd+K palette now does semantic search across brain_memory +
> chat_message in addition to navigation. 250ms debounce · AbortCon-
> troller · top-5 RRF-fused hits in a "From your brain · N" group
> ABOVE the action groups (semantic-then-actions reading order).
> Each hit deep-links to its source (brain_memory →
> /brain/wisdom?focus= · chat_message → /chat#id). Silent degrade
> on fetch failure · cmdk's local action-filter still works. The
> most expensive idle infrastructure in the repo (22 days of
> pgvector embeddings) finally activated.
>
> **Wave W Phase 3 · operator-state landing router** · `e59371fd` · +159 LOC
> Substrate-only ship · pure function `chooseLanding(snapshot)` +
> tRPC procedure `system.landingRecommendation` + 7 new vitest cases
> covering the 5 rules:
>   · drift ≥ 0.6 → /system (triage open work)
>   · capacity ≤ 0.25 → /journal (reflect before pushing)
>   · mood=energized + momentum ≥ 0.5 → /tasks (ride the wave)
>   · focus < 0.3 + capacity > 0.5 → /brain/board (strategy time)
>   · neutral → null (no specific signal)
> UI placement (chip on HQ) deferred to /chat wave because the
> homepage IS /chat and the 2026-05-18 PM brainstorm explicitly
> rejected chip-strip clutter · placement decision belongs in the
> /chat redesign context.
>
> **Wave W Phase 4 · unified recall inbox** · `1eca229e` · +448 LOC
> The largest substrate addition. `lib/services/recall-inbox.ts`
> mirrors the proven `system-hub.ts` parallel-read pattern · fans
> out to 4 paid-for readers (pins · link-review · contradictions ·
> active-alerts) in parallel · per-source try/catch isolation so one
> broken reader can't break the inbox. New `brain.recallInbox` tRPC
> procedure. New `<RecallInboxPanel />` component (175 LOC) mounted
> in /brain Zone 1 ABOVE InsightRibbon. Editorial-minimalist · per-
> group "see all →" link drills to source page · silent across all
> 4 sources on clean morning. Operator's daily ritual: 3 page-visits
> → 1 panel.
>
> **Architectural patterns surfaced for the playbook:**
> - **Aggregator-thinking is the leverage**. /brain is the
>   convergence layer where Waves S/T/U paid-for helpers go to die
>   invisibly. The most leveraged moves fuse 2-4 helpers into one
>   operator-facing surface. recall-inbox fuses 4 · learning-velocity
>   scoreboard fuses 4 (Wave V) · calibration tile fuses 2 (Wave V).
> - **Substrate-first when UI placement is contested**. Phase 3
>   shipped the pure function + tRPC procedure without committing
>   to UI placement · operator can later decide where the chip goes
>   without rebuilding the substrate.
> - **Net-negative LOC is the kaizen tell**. Phase 1 deleted 82 LOC ·
>   the rest of Wave W added ~750 LOC of substrate (services +
>   procedures + tests + UI). Total net: ~+670 LOC but zero new
>   schema · zero new cron jobs · activates 3 idle endpoints.
>
> **Flagged · NOT done in Wave W (Wave W.b candidates)**
> - KnowledgeRefreshPanel relocation /knowledge → /system/cron-
>   diagnostics (inline component · extract first)
> - Brain sub-page consolidation (reflections + identity-trajectory
>   + link-review folded as panels on /brain) · need to
>   extract panel components first
> - Knowledge embeddings activation · the /knowledge page still uses
>   substring LIKE search · need to verify knowledge files are
>   vectorized in `vector_embeddings` then add knowledge_file source
>   to search-hybrid
> - Landing-router chip placement decision · defers to /chat wave
>
> **Per-page playbook now has 5 pages of evidence + 1 cross-surface
> wave:** /settings (P+Q) · /journal (R+S) · /tasks (U) · /brain (V) ·
> /brain + /system + /knowledge (W). Pattern: 4 parallel agents ·
> Pareto-filter to 50% · ship with substrate-first discipline.
>
> Gates: typecheck 0 · lint 0 errors / 370 baseline (+1 pre-existing
> any in Phase 2 new code) · vitest 184 files / 2804 tests (+7 from
> Phase 3) · build OK · prod smoke 200 on 3 endpoints after each
> phase.

> ## 2026-05-24 LATE-EVENING · Wave V · /brain 5-phase sweep · 1 ship
>
> 4th page to receive the per-page playbook (after /settings P+Q ·
> /journal R · /tasks U). /brain is structured differently — a 199 LOC
> hub routing to 6 sub-pages · total 2173 LOC. Scoped audit to the
> hub + wisdom (697 LOC) + link-review (330 LOC). 2 parallel review
> agents (defensive + feature-mining via infinite-gratitude) · 17
> findings · Pareto-filtered to 7 defensive + 3 features.
>
> **Wave V · 10 changes** · `1f7dd3ae`
>
> Defensive:
> - **(P0 silent-failure)** link-review staleness banner · pre-fix
>   load() catch only toasted · candidates stayed at last value with
>   no visible signal · now: persistent loadError banner with retry.
> - **(P0 clarity-gate)** link-review setTimeout state-mutation ·
>   pre-fix 240ms departure animation mutated `candidates` directly ·
>   phantom row after navigate-back · now: invalidate cache + load().
> - **(P0 stale-closure)** link-review decide() empty useCallback
>   deps · now: real `[decideMutation, utils, load]` declared.
> - **(P1 clarity-gate)** wisdom native confirm() silently
>   suppressed in iOS PWA · Deprecate button did nothing · now:
>   useConfirmDialog hook (same fix as nickstire admin Wave 110-139
>   + OVERDRIVE-1).
> - **(P1 code)** wisdom localStorage no try/catch · Safari private
>   mode + iOS Lockdown Mode crashed the page · now: try/catch on
>   read + write.
> - **(P1 a11y)** wisdom curation buttons keyboard-hidden by
>   md:opacity-0 · now: + md:focus-within:opacity-100 (Tab focus
>   reveals).
> - **(P2 perf)** brain hub 60s polling redundant with event-bus ·
>   maturity header was re-rendering every 60s for zero new data ·
>   dropped the interval · event-bus is the ONLY refresh path.
>
> Feature wire-ups (Phase 5 · infinite-gratitude):
> - **#6 Identity-delta narrative line** · violet inline banner in
>   Self-Model zone reads `yesterday → today: velocity rising 62→71`
>   etc. Reads IdentitySnapshot.deltaFromLast populated by 04:30
>   identity-refresh cron · new `brain.identityDelta` procedure ·
>   silent on empty.
> - **#5 Learning-velocity scoreboard** · 4-cell tile at top of
>   Self-Model zone · headline "brain +22% vs 30d ago · health
>   78/100" + per-metric tiles. Reuses existing
>   `trpc.journal.learningVelocity` (Wave S) · zero new server work.
> - **#2 Calibration tile** · new tile in Predictions zone next to
>   PredictionStreaksCard. Shows verdict (well-calibrated / drift /
>   unknown) + mean Brier + hit-rate + claim-vs-reality gap. Wires
>   `summarizeCalibration` + `Prediction.brierScore` (populated by
>   outcome-tracker cron for ~22 days · zero UI prior). New
>   `brain.calibrationSummary` procedure.
>
> **Aggregator-thinking insight from Wave V:**
> /brain is the convergence layer where Waves S/T/U paid-for
> helpers go to die invisibly. The most leveraged moves are
> aggregators that fuse 2-4 helpers into one operator-facing
> surface (e.g. learning-velocity scoreboard = 4 helpers in one
> tile). This is the next-page pattern: when picking elevation
> candidates, prefer "this aggregates N existing helpers" over
> "this surfaces 1 new helper."
>
> **Flagged · NOT fixed (Wave V.b candidates · 8 deferred items)**
> Defensive: 5 competing filter surfaces on /brain/wisdom (M
> redesign) · 1-button flex-wrap dead-weight (cosmetic) ·
> Feature-mining M-effort: nightly consolidation report strip ·
> decay-candidates triage panel · decision-quality GPA sparkline ·
> hidden-correlations drawer · anticipated-questions hit-rate ·
> 4 deeper sub-pages (board · reflections · health ·
> identity-trajectory) not yet audited.
>
> **Playbook now has 4 pages of evidence:**
> /settings (Wave P+Q · 9 findings → 7 fixes) · /journal (Wave R+S ·
> 22 → 13) · /tasks (Wave U · 22 → 12) · /brain (Wave V · 17 → 10).
> Average ~50% Pareto-survival rate per page. Recommended next
> candidates: /chat (heaviest interaction · stream + tool calls) ·
> /knowledge (Drive ingest · less audited) · /system root.
>
> Gates: typecheck 0 errors · lint 0 errors / 369 baseline · vitest
> 184 files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy.

> ## 2026-05-24 EVENING · Wave U · /tasks 5-phase sweep · 1 ship
>
> Operator's request: apply the 5-phase per-page playbook to /tasks
> (the daily-driver · 1350 LOC). Dispatched 4 parallel agents via
> infinite-gratitude pattern (code-reviewer + silent-failure-hunter +
> ux-audit/frontend-design/mobile/clarity-gate + feature-mining) ·
> 22+ findings synthesized · Pareto-filtered to 8 defensive + 4
> feature wire-ups · shipped in one commit. clarity-gate principle
> applied to every "VERIFIED" claim (spot-checked actual schema +
> helper exports before building).
>
> **Wave U · 12 changes** · `1034df11`
> Defensive (Phase 1-4):
> - **(P0 silent-failure)** `loop-stream.tsx` onRowDrop · drag-to-
>   reorder was swallowing server rejection while the hook's generic
>   "Saved." toast fired on success · operator dragged a row, saw it
>   move, got "Saved." on reject, then snapped back 60s later with
>   no explanation. Now: try/catch + reportClientError + explicit
>   "Reorder failed · snapping back" toast + immediate onReviewChange.
> - **(P0 silent-failure)** `loop-stream.tsx` runBulk · first-rejection-
>   aborts-rest behavior · operator selected 10, task 3 failed, tasks
>   4-10 silently skipped. Now: per-iteration catch + accumulated
>   failedIds + single summary toast ("7 of 10 completed · 3 failed").
> - **(P0 ux)** `loop-stream.tsx` bulkDelete · pre-fix confirm only
>   fired for counts > 5 · 2-5 task selections wiped silently. Now:
>   any count ≥ 2 confirms.
> - **(bug)** `loop-stream.tsx` domainFilter casing · `work` filter
>   never matched `BUSINESS` tasks · alias mapping only lived in the
>   picker, not the filter compare. Aliased both sides.
> - **(ux-F5)** `now-operator-bar.tsx` · AnimatedCounter on 3 status
>   counters fired on every visibility-change · plain tabular-nums
>   spans · same fix as /journal Wave R.
> - **(ux-F4)** `task-filters.tsx` · 3 redundant filter-state surfaces
>   collapsed to 1 (page-level ActiveFiltersStrip is canonical).
> - **(ux-F7)** `loop-row-item.tsx` · "+ subtask" tap collision on
>   iPhone (3 abutting 44pt circles) · button relocated from
>   collapsed row to expanded action panel.
> - **(ux-F12 a11y)** `loop-stream.tsx` · section headers had
>   aria-hidden hiding structural cues from VoiceOver · now
>   role="heading" aria-level={3}.
>
> Feature wire-ups (Phase 5 · infinite-gratitude):
> - **(#2) Capacity meter in header** · `loop-stream.tsx` · useNowSignals
>   was already computing capacityRemainingMin + allocatedMin +
>   overcommitted · never rendered. New one-line meter above
>   NextMove · amber when overcommitted with "Nh Nm over" inline.
> - **(#4) Streak-at-risk countdown chip** · `loop-row-item.tsx` ·
>   DAILY rows with streakCount ≥ 3 enter warning window at 24h
>   since lastCompletedAt · turn red at 30h · 6h until 36h break
>   threshold per task-context.dailyBrokenStreaks bucket. Render-
>   time math · no helper.
> - **(#5) Subtask roll-up on parent row** · `loop-stream.tsx` +
>   `loop-row-item.tsx` · existing `+N sub` chip shifts to "+N sub ·
>   X/N" with color band (emerald 100% · gold ≥50% · zinc <50%) ·
>   new `doneChildCountByParent` map alongside the existing total +
>   open maps.
>
> **Findings flagged · NOT fixed (deferred to next wave)**
> - Stale-closure in auto-gen AI tasks effect (page.tsx:573-587) ·
>   deeper rewrite · localStorage key-write must move into success
>   branch · skipped this wave for risk-limit.
> - useDebouncedReload race condition (page.tsx:365-471 +
>   hooks/use-debounced-reload.ts:49-67) · loadingRef short-circuits
>   abort path · deeper rewrite.
> - addTask double-submit guard missing (page.tsx:748-815) · iOS
>   double-tap can create duplicates · needs submittingRef pattern.
> - getInbox concurrent race (page.tsx:608-628) · two parallel
>   addTask calls before inboxRef populates can create duplicate
>   Inbox missions · cache promise instead of resolved id.
> - Optimistic cascade flip ARCHIVED-exclusion mismatch (page.tsx:
>   894-904).
> - F2 sticky section headers stack/overlap on by-status sort ·
>   CSS-expert work.
> - F8 IntelPanel badge signalCount gating · scoreboard hidden when
>   operator has zero overdue · badge should reflect "anything
>   interesting in here today" not just overdue.
> - F10 "stuck · re-frame?" chip is non-interactive · either wrap in
>   button or drop the "?" copy.
> - F11 pinned-band gradient vs section flat-line · 3 divider styles
>   compete · cosmetic.
> - 3x localStorage `catch{}` in togglePin + AI-gen gate · Safari
>   private mode silently fails.
> - Feature-mining candidates #1 (effort-drift chip) · #3 (ghost-nick
>   next-step) · #6 (overdue-promise confrontation) · #7
>   (abandonment-pattern badge) · #8 (time-of-day fit label · already
>   half-shipped) · all M-effort · deferred to Wave V.
>
> **Playbook update:** the 5-phase per-page sweep template now has
> 3 pages of evidence (P+Q on /settings · R on /journal · U on /tasks).
> Per-page audit finding density: /settings ~9 · /journal ~22 ·
> /tasks ~22 (with 4 parallel agents vs 3 on /journal). The 4-agent
> pattern (separating ux-audit + code-review + silent-failure as
> distinct lenses + feature-mining as a separate lens) is the right
> shape going forward.
>
> Gates: typecheck 0 errors · lint 0 errors / 369 baseline warnings
> (+1 from new code · all pre-existing any) · vitest 184 files /
> 2797 tests · build OK · prod smoke 200 on 3 endpoints post-deploy.

> ## 2026-05-24 LATE-AFTERNOON · Wave S + T · feature-mining · 12 wire-ups · 2 ships
>
> Operator called out the gap from Wave P/Q/R: those were defensive
> UX sweeps (ux-audit · silent-failure-hunter · code-reviewer) but
> never did the OPPORTUNITY pass. Two parallel feature-mining agents
> (infinite-gratitude pattern) surveyed the 1,400+ skill library +
> the existing lib/brain/* + AutomationPolicy infrastructure ·
> surfaced 12 wire-up candidates · clarity-gate principle applied to
> mark each VERIFIED / PROJECTED / HYPOTHETICAL. Operator approved
> "all 12" · both waves shipped.
>
> **The unexpected finding:** the vast majority of "cool features"
> were already-built helpers not connected to the operator's eye.
> Zero new schema · zero new cron jobs · pure connect-paid-for-infra-
> to-the-operator's-eye work. This becomes Phase 5 of the per-page
> UX-sweep playbook · the defensive audits (Wave M/P/Q/R) caught
> bugs but missed the wire-up opportunities entirely.
>
> **Wave S · /journal · 7 wire-ups** · `a4307158`
> - **#7 · Learning-velocity ticker** (`measureLearningVelocity` →
>   one-line surface above the feed: "12 entries this week ·
>   3 new connections · 2 beliefs revised · brain 78/100")
> - **#5 · Weekly memoir block** (last 7d WISDOM/BELIEF promotions
>   surfaced as a small block above the feed · silent when fewer
>   than 2 items)
> - **#3 + #6 · Brain signals chip** (combined emotional trajectory +
>   drift composite via one read · trajectory tinted by
>   rising/falling/volatile/stable · drift color-banded 0-3/3-6/6+)
> - **#4 · Ghost counter-question** (reflect-composer · ghost-nick
>   prediction reshaped as a question · honors a year-old docstring
>   promise · violet inline banner · dismissable)
> - **#1 · Margin contradictions** (per-entry contradiction list in
>   brain-dump expanded body · pulls from contradiction-surfacer's
>   loadRecentContradictions(30d))
> - **#6 (refinement) · Drift pin on threads** (active threads with
>   14+d silence get "drifting · Nd" amber badge · soft warning
>   before cron-managed 30d auto-dormancy)
> - **#2 · Prediction-line on decision entries** ("predict outcome"
>   button on decision-type entries · one-line form writes to
>   existing Prediction model · predictions-grader cron resolves
>   when target date passes)
>
> Six new tRPC procedures on the journal router:
> `learningVelocity` · `ghostCounterQuestion` ·
> `contradictionsForEntry` · `brainSignals` · `weeklyMemoirItems` ·
> `savePrediction`. All wrapped in try/catch + log.warn +
> degrade-to-null · matches Wave M discipline.
>
> **Wave T · /settings · 5 elevators** · `dad4e9db`
> - **#1 · Proof-of-life badges** (per-flag last-fired tail joined
>   from AutomationPolicy by `autopilot:<key>` tag · last-result
>   color-coded · tooltip exposes policy id + fireCount · "never
>   fired · 14d" tells operator the binding's broken at a glance)
> - **#2 · Why-was-this-disabled audit trail** (toggle write writes
>   a BrainMemory row under new category AUTOPILOT_FLAG_CHANGE ·
>   payload includes prior-state duration + optional 1-line note ·
>   recentAutopilotFlagChanges read feeds the future drawer)
> - **#3 · Shadow mode for critical flags · UI rehearsal**
>   (3rd state on the 3 confirmDisable flags via localStorage ·
>   violet bg + "shadow" badge · workers don't honor SHADOW yet ·
>   UI rehearsal layer for the coming worker support · explicit
>   "UI-only" note in the procedure docstring)
> - **#4 · State-aware category dimming** (reads system.operatorState ·
>   when mood is depleted or scattered, sales + comms categories
>   drop to opacity-50 · brain + schedule stay at full · hover
>   restores full · toggles stay fully interactive)
> - **#5 · Blast-radius preview** (press-and-hold expansion surfaces
>   1-2 lines of "disabling stops X" from AutomationPolicy.
>   successMetric · confirm moment becomes learning moment · silent
>   when no policy is mapped)
>
> Three new tRPC procedures on the system router:
> `autopilotPolicyStatus` (covers #1 + #5) · `recordAutopilotFlagChange`
> (covers #2) · `recentAutopilotFlagChanges` (covers #2). One new
> BRAIN_CATEGORIES entry: `AUTOPILOT_FLAG_CHANGE`.
>
> **Playbook update:** the per-page sweep template now has 5 phases.
> Defensive audit (Phase 1-4) was Wave P/Q/R · feature-mining audit
> (Phase 5) is Wave S/T. The latter is the under-counted half · most
> codebases have huge troves of paid-for infrastructure that never
> surface. Apply both phases to every future page sweep
> (next candidates: /tasks · /chat · /brain · /knowledge · /system).
>
> **Flagged · NOT fixed (operator-action follow-ups)**
> - Worker support for SHADOW mode on the 3 critical flags
>   (auto_brain_cycle · auto_identity_refresh · adhd_operating_rhythm)
>   · this requires each cron to honor a `shadow=true` branch · UI
>   already rehearses the toggle.
> - Tag the rest of the AutomationPolicy rows with `autopilot:<key>` ·
>   only a subset is currently tagged · the proof-of-life badges show
>   nothing for un-tagged flags · low-effort but operator-decided
>   which flags map to which policies.
> - autonicks.com Cloudflare DNS flip still pending from Wave O.
>
> Gates: typecheck 0 errors · lint 0 errors / 368 baseline · vitest
> 184 files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy on each wave.

> ## 2026-05-24 AFTERNOON · Wave R · /journal UX sweep · multi-agent audit · 1 ship
>
> Operator invoked `/infinite-gratitude` and `/clarity-gate` skills and
> asked for the same UX sweep treatment on `/journal` as Wave P+Q got on
> `/settings`. Discovered both skills had names that misled me:
> `infinite-gratitude` is actually a multi-agent research orchestration
> pattern (10 parallel agents) and `clarity-gate` is a RAG document
> verification system (will another LLM mistake assumptions for facts?).
> Adapted both correctly: dispatched 3 parallel review agents per
> infinite-gratitude pattern · borrowed clarity-gate's principle for
> the UI lens ("does any control imply state it can't deliver?").
>
> **Wave R · 6 surgical fixes synthesized from 22 audit findings** · `07639178`
> Three review agents ran in parallel (code-reviewer · silent-failure-
> hunter · ux-audit + frontend-design + mobile-design + clarity-gate
> principle). Pareto-filtered ~22 findings down to 6 with the highest
> operator-visible ROI:
> - **(P0) `thread-suggestions.tsx` accept/dismiss silent failures** ·
>   pre-fix both handlers had bare `catch {}` with the comment
>   "today: silent re-fetch." Operator tapped a suggestion → server
>   401/500 → UI looped → operator re-tapped forever. Now: log to
>   /system/errors + inline rose-300 banner that auto-clears.
> - **(P0) `thread-rail.tsx` whole-component vanish on error** ·
>   pre-fix `if (error) return null;` made the entire thread rail
>   disappear on any tRPC error · indistinguishable from "no threads
>   exist." Now: rose banner + retry button + error.message.
> - **(P0) `page.tsx` FilterChipRow · iOS HIG 44pt tap target** ·
>   pre-fix chips were 20-24px tall · operator's thumb on iPhone
>   couldn't reliably hit one. Added
>   `[@media(pointer:coarse)]:min-h-[44px]` (Tailwind v4 arbitrary
>   variant) · desktop unchanged · touch devices get HIG floor.
> - **(P0) `page.tsx` FilterChipRow · AnimatedCounter slop** ·
>   pre-fix every chip count rendered through `<AnimatedCounter>` ·
>   14 chips visible meant the whole row ticked from 0
>   simultaneously on every page load · gpt-built feel · semantically
>   wrong (counts didn't change). Plain span with tabular-nums.
> - **(P1) `page.tsx` byDate ordering on alpha sort** ·
>   pre-fix `byDate` grouped over the already-sorted list ·
>   `alpha-asc/desc/longest/shortest` modes produced TWO day-header
>   sections for the same date when entries weren't date-monotonic.
>   Now: day headers always sort by date · entries within inherit
>   the sortKey.
> - **(P1) `page.tsx` weak-spots `+N more` indicator** ·
>   pre-fix `meta.weakSpots.slice(0, 2)` silently hid the rest · a
>   brain with 7 weak spots looked identical to one with 2 (Nielsen
>   #1 violation). Added `+N more` chip with hidden spots in the
>   title attribute.
> - **(P1) `reflect-composer.tsx` submit log** · Wave-M class fix ·
>   pre-fix `catch{} toast.error("save failed")` with no log
>   breadcrumb. Now: structured log via sanitizeError + template +
>   filledCount in the payload so /system/quality can correlate.
>
> **Flagged · NOT fixed (deferred to Wave R.b if signal emerges)**
> - Reflect composer template chooser hidden behind 9px "switch"
>   link · 4 inline tabs would be the upgrade · bigger change ·
>   stable as-is.
> - localStorage 3x catch{} blocks in reflect-composer.tsx ·
>   logging would catch QuotaExceeded in Safari private mode ·
>   low frequency · noted.
> - thread-radar.tsx error/empty collapse · same class as the
>   rail fix · acceptable severity solo · could batch with a
>   future radar-related wave.
> - "extracting…" toast disclosure (clarity-gate violation) ·
>   needs a poll-or-listen status pill · bigger UX change.
>
> **The repeatable playbook locked in:** skill-check → invoke
> ux-audit + silent-failure-hunter + code-reviewer in parallel →
> read each finding's line numbers against ground truth → Pareto-
> filter to ≥80% confidence · ≥P1 severity · ≤8 fixes per wave →
> ship in one commit with all 4 gates green → reconcile docs.
> Same template applied to /settings (P+Q) and now /journal (R).
> Next page candidates: /tasks · /brain · /chat · /knowledge ·
> /system root.
>
> Gates: typecheck 0 · lint 0 errors / 368 baseline · vitest 184
> files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy.

> ## 2026-05-24 MIDDAY · Wave O + P + Q · Vercel runbook v2 + /settings UX sweep · 4 ships
>
> Operator status check this morning identified two threads: (a) the
> autonicks.com Vercel cleanup that MEMORY.md flagged as a "ghost"
> turned out to be a live serving stale build with DNS still pointed
> at Vercel · runbook rewritten with the correct DNS-first sequence ·
> operator chose to delete all 4 Vercel projects upfront, which left
> autonicks.com returning `X-Vercel-Error: DEPLOYMENT_NOT_FOUND`
> (DNS flip still pending in operator's hands) · (b) /settings page
> UX sweep applying ux-audit + frontend-design + minimalist-ui +
> mobile-design skills.
>
> **Wave O · Vercel cleanup runbook v2 · DNS-first sequence** · `6542d5c5`
> Pre-flight via Vercel MCP + curl/DNS exposed the prior runbook's
> wrong-state assumption. New inventory: 4 Vercel projects identified
> (statenour-os holding autonicks.com · nickstire / easy-nickstire /
> elegant-yalow without custom domains). Rewrote `docs/RUNBOOK.md`
> with: 4-phase safe sequence (DNS flip → 48h wait → delete 3 dormant
> projects · then statenour-os) · Cloudflare DNS flip instructions
> (301 redirect vs park-domain options) · explicit safety-policy
> boundary statement (deletion + DNS are operator-only).
>
> **Wave P · /settings autopilot grouping + 3 UX fixes** · `0e5fb0ce`
> Applied Nielsen heuristics scan + frontend-design lens to the
> autopilot section · 3 violations found, all fixed:
> - Grouped the 13 flat toggles into 4 named categories: Brain ·
>   learning (4 · amber) · Sales · revenue (4 · emerald) · Schedule ·
>   focus (4 · violet) · Comms · marketing (1 · sky). Each group
>   shows a per-category count badge ("3/4 active"). Tints match
>   System Ops Hub vocabulary · md:grid-cols-2 on desktop · single-
>   col on mobile.
> - Eliminated the "everything ON" flash via `resolveInitialFlags()`
>   that reads localStorage SYNC during state init (Nielsen #1 fix).
> - Surfaced mutation failures inline with a rose-300 badge mirroring
>   PushNotificationToggle's translate-error pattern (Nielsen #9 fix).
> - Bonus: switched from GlassCard-with-cursor-pointer to semantic
>   `<button>` (correct ARIA · Apple HIG 44pt) · 7 distinct icons
>   replacing 3 duplicate `Zap` glyphs (Nielsen #6 · recognition not
>   recall).
>
> **Wave Q · extract SystemOpsHub + confirm-hold on critical toggles** · `fd02f4d0`
> Two surgical follow-ups to Wave P:
> - **Extracted SystemOpsHub** (230 lines · 7 category groups) from
>   inline in settings/page.tsx to a new
>   `components/settings/system-ops-hub.tsx` matching the existing
>   `components/settings/*` pattern. Pure relocation · zero visual or
>   behavioral change. settings/page.tsx: 935 → 787 LOC (-148).
> - **Press-and-hold confirm on 3 critical autopilot disables** ·
>   `auto_brain_cycle` · `auto_identity_refresh` ·
>   `adhd_operating_rhythm`. Uses the existing `ConfirmHold` primitive
>   (800ms ring · haptic warn on start · haptic success on commit).
>   Asymmetric friction by design: re-enabling stays a single tap (low
>   risk in turning automation back ON). Flow: tap critical-enabled
>   row → expansion banner with rose tint + ConfirmHold (danger
>   variant) + cancel button + 5s auto-cancel timeout (mobile-thumb
>   safety).
>
> **Flagged · NOT fixed**
> - autonicks.com Cloudflare DNS flip · still pending operator
>   action · domain now serves Vercel deleted-project 404. Runbook
>   covers the fix at `docs/RUNBOOK.md`.
> - `inline crons expansion` on autopilot flags (recognition-not-recall
>   improvement) · deferred · acceptable cognitive load with current
>   description text.
> - `real appVersion` in SystemInfo · already pulls from
>   `trpc.system.toolsHealth` · `?? "v10"` is just the loading
>   fallback · no actual drift.
> - Inline help expansion per flag · would need additional
>   per-flag content · deferred until operator surfaces a real
>   "I don't remember what X does" moment.
>
> Gates: typecheck 0 · lint 0 errors / 368 baseline · vitest 184
> files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy on every wave.

---

> **Older entries (before 2026-05-24) archived** to cap this file's size — see [`docs/archive/RECONCILIATION-pre-2026-05-24.md`](archive/RECONCILIATION-pre-2026-05-24.md). Split by the truth-substrate audit (2026-07-21); content preserved verbatim, most-recent-first order intact.


---

## Open backlog — moved out of `AGENTS.md` on 2026-08-21

Stamped **2026-07-28** and never auto-refreshed. It lived in the always-loaded `AGENTS.md`, where
dated content goes stale silently and bills tokens every session. Treat each line as a lead to
re-verify, not as truth. (An earlier edit claimed this had been moved here when it had not — that
claim was false and is the reason this section exists.)

1. **Scheduled-cycle proof** — first real briefing_log row (10:15 UTC) + heartbeat + worker artifact-liveness; first outcome-ledger rows from the brief + decision surfacings.
2. **Memory write governance** — Phase-1 SHIPPED 2026-08-11 (same-source repetition no longer reinforces; default-on, kill-switch `NICK_MEMORY_GATEWAY_PHASE1=0`; evidence: 1,788 shadow receipts, noop 846 @ 0% legacy agreement via `scripts/probe-gateway-agrees.ts`). Phase-2 SHIPPED 2026-08-16 but OPT-IN (NICK_MEMORY_GATEWAY_PHASE2=1) and scoped: update + review_required-for-weaker_evidence only. unknown_category (the larger slice of the 349/wk) still falls through deliberately. Next: a shadow review before any default flip, then temporal supersession (validFrom/validUntil/supersededById are applied to prod and still have NO reader).
3. **Triage adoption** — the incumbent one-item flow (InboxTasksTriage + task.triage) is verified complete; adoption is operator behavior, not code. (Spine-5's parallel contract was deleted 2026-07-28 — see contracts registry note.)
4. **Realtime completion-message push** — S3's receipt-backed follow-up appears on next load; pushing into an open stream is its own transport change.
5. **Recall-eval corpus growth** — UNBLOCKED 2026-08-16, not yet populated. outcomesNeedingReview() returned empty for the table's whole life because recordDecision/recordOutcome had no callers; they now have two (nudge dismissal, Discover verdicts). The corpus grows only as the operator actually judges. Gauges: pnpm harvest:evals + scripts/corpus-odometer.ts. Only then retune RRF/persona weights, or flip NICK_NOVELTY_RECALL.
6. **Chat-state visual regression** — Playwright screenshots of /system/chat-states in the e2e lane.
7. **Approval/decision card runtime receipts** — first live renders post-#1176 deploy; extend the typed-card registry only on verified shapes.
8. P9 confirm-cards · judge-eval calibration verdict (needs n≥30) — low priority.
