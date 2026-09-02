# StateNour Background-Job Matrix — Read-Only Audit

Snapshot: `git archive` of origin/main @ abdd99395 (prod deployed 2026-09-02 13:23Z). Repo not present as .git in snapshot; no runtime access. All claims are static-code inferences unless noted.

Evidence classes: **A** = verified directly in this snapshot's code (path:line). **H** = inference (plausible from code shape but not directly proven — e.g. row counts from loop bounds). **I** = not verified (would need runtime/DB access; flagged explicitly, not asserted).

Whether any cron actually RAN and succeeded is UNKNOWN from static code — only `CronJobLog` rows (unreadable here) would prove execution. Every LIVE/WIRED classification below describes wiring, not observed runtime behavior.

---

**STATUS: COMPLETE** — see bottom of file for the NOT-VERIFIED consolidated list and coverage note.


## 0. Trigger architecture — read this before the matrix

**Three independent dispatch paths exist, and the manifest's own `worker`/`inngest` flags only
describe two of them.**

1. **Mega fan-out (the majority path).** `app/api/cron/mega/route.ts` (A, whole file) fans out to
   `MORNING_JOBS`/`EVENING_JOBS`/(+`WEEKLY_JOBS` on Sunday-ET) — arrays defined once in
   `lib/inngest/jobs.ts:36-140` and imported by both the legacy route and the Inngest
   reimplementation. `withConcurrency(jobs, dispatch, 6)` (`app/api/cron/mega/route.ts:150-158`)
   caps concurrent children at 6, each child gets a 90s `AbortSignal.timeout` (mega route) — the
   Inngest version (`lib/inngest/functions/mega-fanout.ts:125-128`) raised this to a per-path map
   (`predict` to 240s, default 90s) and **detaches** two children entirely
   (`DETACHED_CHILDREN = {"/api/cron/consolidate", "/api/cron/mastery-xp"}`,
   `mega-fanout.ts:159-169`): the parent only waits 10s for an ack that the child *started*, then
   stops watching. A child that fails after that point is invisible to the parent's retry logic
   and is only visible via its own `CronJobLog` row.

2. **Who actually calls `/api/cron/mega`?** `railway.json` (A, full file, 8 lines) declares only
   `healthcheckPath` + `restartPolicyType` — Railway has no declarative-cron field, unlike the
   retired `vercel.json`. The worker exposes `POST /cron/mega` and `POST /cron/mega-evening`
   (`apps/worker/src/index.ts:163-173`, A) which forward to statenour-web's `/api/cron/mega`, but
   **nothing in this codebase ever calls those two worker endpoints** — `scheduler.ts`'s
   `HIGH_FREQ_JOBS` array (`apps/worker/src/scheduler.ts:120-158`) registers only
   `brain-bus-drain`, `outbox-drain`, `inngest-liveness` and the render poll; no node-cron entry
   fires `/cron/mega(-evening)`. The `index.ts` comment calls these "Railway cron entry points" —
   i.e. the actual scheduler for `MORNING_JOBS`(18) + `EVENING_JOBS`(26) + `WEEKLY_JOBS`(7) = 51
   dispatch slots across the 55 route-based crons (counts by direct grep of
   `lib/inngest/jobs.ts`, positive control: `awk '/export const MORNING_JOBS/,/^\];/' | grep -c
   '"/api/cron/'` = 18, same pattern for the other two) is **a Railway Cron Job service configured
   in the Railway dashboard, outside this git repo** (class **I**, not verifiable from source; the
   whole mega/evening/weekly cascade's liveness depends on a dashboard config this audit cannot
   read).

3. **Inngest's own cron trigger for the SAME fan-out is a no-op by default.**
   `lib/inngest/functions/mega-fanout.ts` registers `triggers: [{cron:"0 9 * * *"}, {event:
   "mega/fire.morning"}]` (and the evening twin), but the function body's first line is:
   `if (process.env.INNGEST_MEGA_V2 !== "true") { ...return {skipped:true}; }`
   (`mega-fanout.ts:344-347,416-419`, A). **Whether this flag is `"true"` in production is
   runtime env, not verifiable from this snapshot (class I).** If it is NOT `"true"`, Inngest's
   morning/evening cron triggers fire every day and immediately no-op, meaning path #2 (an
   unverifiable external Railway Cron Job) is the ONLY thing driving those 51 dispatch slots (across
   most of the 55 route-based crons), with no code-level fallback if that external job is ever
   deleted or misconfigured. If the flag IS
   `"true"`, both the legacy route (if also still externally triggered) and Inngest would
   double-fire every child — the code has no cross-path double-fire guard beyond the flag itself.

4. **Inngest-native crons (22 manifest rows, `inngest:true`)** fire independently of the above via
   their own `triggers:[{cron:...}]` on Inngest Cloud, confirmed present for 20 of the 22 currently
   in `lib/inngest/functions/*.ts` (id + cron verified per-file, listed in the matrix).
   **One exception: `neglect-penalty`** (`config/crons.ts:940-947`, `mode:"dormant"`,
   `inngest:true`, schedule `0 */4 * * *`) **has no implementing Inngest function anywhere in
   `lib/inngest/functions/*`** — grep for `neglect` across `lib/` and `app/` returns zero
   `createFunction` hits (class A absence; corpus = `lib/inngest/functions/*.ts` + repo-wide
   grep for "neglect"). The manifest's own philosophy comment (`config/crons.ts:26-31`) defines
   "dormant" as "route + code exist and work, but intentionally NOT wired" — `neglect-penalty`
   fails that definition; the code does not exist, not just the wiring. Manifest-accuracy bug,
   not a runtime risk (mode is dormant either way, so nothing currently depends on it firing).

5. **Inngest Cloud's function manifest is registered by a fire-and-forget boot-time self-sync**
   (`lib/inngest/self-sync.ts`, A, whole file) — `PUT /api/inngest` fired 20s after every prod
   boot, because Railway has no native Inngest deploy integration. Fails OPEN (`shouldSelfSync`
   gates on `INNGEST_SIGNING_KEY` + `NODE_ENV==="production"`; a sync failure only logs). The
   file documents the incident it exists for: about 16 cron-triggered functions were registered
   in code and invisible to Inngest Cloud for weeks (2026-07-28) because nothing re-synced after
   the last manual `PUT`. The fix makes staleness bounded by "one deploy," not zero — a boot
   where the fetch throws or 401s leaves the Cloud manifest exactly as stale as before.

6. **Worker to statenour auth**: every worker-to-web call sends `Authorization: Bearer
   ${CRON_SECRET}` (`apps/worker/src/scheduler.ts:331`, A) compared with `timingSafeEqual` on
   both sides (`lib/auth-guard.ts:47-52` `requireCronAuth`; `apps/worker/src/index.ts:53-67`
   `requireCronSecret`, length-checked first so `timingSafeEqual` never sees mismatched-length
   buffers). Both processes fail closed on an empty secret: the worker `process.exit(1)`s at boot
   (`index.ts:43-49`) if `CRON_SECRET` is unset; statenour's `requireCronAuth` throws 401 on a
   blank compare. Constant-time, not spoofable via length or timing — class A.

7. **Every one of the 55 route-based crons** (all except `mega` itself, which uses `apiHandler`
   directly) is wrapped in `cronHandler()` (`lib/utils/http.ts:378-433`, A — confirmed via a grep
   sweep of all 55 route.ts files: 54/54 non-mega routes import `cronHandler`). This single
   wrapper is where three of the matrix's columns come from for EVERY row below, so it is
   documented once here instead of 54 times:
   - **Kill switch** — `isCronEnabled(jobName)` (`lib/services/cron-control.ts:29-40`, A) reads a
     `BrainMemory` row `category="cron_control", key=<jobName>`; default state is **enabled**
     (absence = runs). Disabled via `PATCH /api/settings/crons` -> `setCronEnabled`
     (`cron-control.ts:43-64`) -> same table. A disabled cron returns `{skipped:true}` with HTTP
     200 — invisible as a *failure*, and also writes no fresh CronJobLog row, which is exactly
     the shape the `silent` detector (below) flags after the grace window.
   - **Failure visibility** — `logCronRun()` (`lib/services/cron-manager.ts:104-147`, A) wraps the
     handler, always writes a `CronJobLog` row (success/failed, duration, `resultCount` when the
     handler returns a countable number), and on failure also publishes a durable `cron.failure`
     bus event (`publishCronFailure`, dedup key `cron-failure:<jobName>:<minute-bucket>`,
     `cron-manager.ts:83-102`). A handler that resolves but reports its own failure is filed as a
     `failed` CronJobLog row too (`reportedFailureReason`) — resolving without throwing does not
     automatically mean success.
   - **Auth** — `requireCronAuth` per point 6 above (`{auth:"cron"}`, `http.ts:431`).
   No route-level "retry" exists at this layer — retry is either the mega fan-out's per-child
   `AbortSignal.timeout` + `Promise.allSettled` (no actual re-fire of a failed child; failure is
   only reported), or an Inngest function's own `retries: N` (2-4 typical; exponential backoff is
   an Inngest-platform default, not app code) for the 22 Inngest-native crons.

**"Silent" (the Home count) is computed by `lib/system/cron-diagnostics.ts:270-410`** (A):
`scanCronHealth()` takes every `mode:"active"` manifest row and flags it silent when it has
**zero `CronJobLog` rows of any status in the last 48h, AND** (never logged a success ever, or its
last success is older than `max(48h, ceil(1.5 x natural cadence))` — `silentThresholdHoursFromCron`,
`cron-diagnostics.ts:106-109`). Cadence is derived from the cron string itself
(`maxGapHoursFromCron`, `:39-100`) so a weekly Sunday job gets about 10.5 days of grace, not a flat
48h — this replaced a flat-48h check that false-flagged 5 of 6 jobs on 2026-05-01. **The exact
"17" figure from Home cannot be verified here — it is a live-DB read (CronJobLog rows), and this
audit has no DB access (class I).** What is verifiable: the mechanism only ever inspects
`mode:"active"` rows (46 of the manifest's 78 entries; folded/retired/dormant rows are excluded by
construction), so "17 silent" would mean roughly a third of the active-and-supposedly-scheduled
crons had no log row in their grace window — consistent with, though not proof of, the
external-Railway-Cron-Job uncertainty in point 2 above (if that dashboard job is misconfigured,
every route-based cron in whichever slot it drives goes silent together, all at once).

## 1. THE MATRIX

Shared mechanics (kill switch, CronJobLog, CRON_SECRET auth, no route-level retry) are documented
once in Section 0 and not repeated per row. **No function in `lib/inngest/functions/*` declares an
Inngest `rateLimit` block** (grep for `rateLimit`/`throttle` across the whole directory: zero
hits, class A) — so the specific failure mode of a `rateLimit` silently *dropping* excess runs
does not currently exist in this codebase; the only Inngest-level flow control in use is
`concurrency` (which queues rather than drops) on `mega-fanout` (limit 5-6) and
`customer-preferences` (limit 4).

### 1a. Inngest-native crons (own Inngest cron trigger, no `/api/cron/*` route)

| id | schedule (UTC) | fn file:line (id+trigger) | what it does | writes | LLM | external FX | retries | notes / class |
|---|---|---|---|---|---|---|---|---|
| cron-heartbeat | `0 12 * * *` | cron-heartbeat.ts:198,205 | out-of-band fan-out liveness watchdog; writes a self-row proving Inngest invoked it at all | BrainMemory (create) | no | Telegram (sendTelegram) + CoachEvent/push on missed-heartbeat detection | 2 | Canary for the 2026-07-28 drift incident (self-sync, section 0.5). LIVE, class A. |
| inngest-liveness | `0 13 * * *` | app/api/cron/inngest-liveness/route.ts (88 ln); fired by **worker** node-cron (`scheduler.ts:154-157`), not Inngest itself | reads cron-heartbeat's self-row age; stale/absent -> P0 Telegram | none observed | no | Telegram | n/a (HTTP route, worker-fired) | Deliberately NOT Inngest-scheduled — the one watchdog that survives an Inngest outage. `worker:true` in manifest. LIVE, class A. |
| operator-morning-brief | `0 10 * * *` | morning-brief.ts:468,471 (id `operator-morning-brief`) | composes + pushes the operator's morning brief | BrainMemory (delete+upsert) | no (grep clean; brief content is templated/aggregated, not generated) | web push (sendPush) + Telegram | 2 | Deletes are cache-invalidation of a prior day's cached brief row, not user data (H — not read in full). LIVE, class A. |
| quality-bench-weekly | `0 13 * * 1` | quality-bench.ts:33,38 | weekly quality benchmark on the prod model+sanitizer path | SystemMetric (create) | **yes** — runs the bench itself, which invokes the model path under test (crons.ts description: "$0.05-0.20/run") | CoachEvent + Telegram on regression | 1 | Was written and never scheduled until 2026-08-05 (crons.ts:121-124). LIVE, class A. |
| suggestion-improve-weekly | `30 13 * * 1` | suggestion-improve.ts:28,32 | weekly suggestion-loop noise analysis, propose-only | BrainMemory (suggestion_hypothesis, not captured by writes-grep — see note) | H — "runSuggestionImproveAgent" name implies LLM reasoning, not confirmed by direct grep in this file (delegates to a lib fn) | CoachEvent when kinds flagged noisy | 2 | Propose-only per description; no execution path. LIVE, class A (trigger) / H (LLM use). |
| proactive-push-cron | `0 * * * *` | proactive-push.ts:11,14 | hourly proactive Telegram pushes + governance nudges | none observed directly (delegates) | H (not directly observed) | Telegram/push (delegated — see Section 3) | 2 | Hourly cadence = highest-frequency Inngest-native cron; see Section 3 for the flood-control gap this interacts with. LIVE, class A (trigger). |
| goal-pruner | `0 12 * * *` | goal-pruner.ts:170,173 | prunes stale/abandoned goals | BrainMemory (updateMany + upsert) | no | CoachEvent | 2 | LIVE, class A. |
| goal-drift-detector | `30 12 * * *` | goal-drift-detector.ts:165,169 | momentum-decay + deadline-risk drift detector | none observed directly | no | CoachEvent | 2 | LIVE, class A. |
| journal-convergence-scan | `0 22 * * *` | journal-convergence.ts:30,33 | scans journal threads for convergence/patterns | none observed directly | H | none observed | 2 | Same file also hosts journal-thread-dormancy (next row). LIVE, class A (trigger). |
| journal-thread-dormancy | `0 23 * * *` | journal-convergence.ts:51,54 | flags dormant journal threads | none observed directly | no | none observed | 2 | LIVE, class A. |
| industry-pull | `0 8 * * *` | industry-pull.ts:33,36 | RSS feeder -> BrainMemory(industry_intel) | BrainMemory (writes not caught by the create/update/upsert grep — likely a different write helper; H) | no | outbound RSS fetch (external read, not a notification) | 2 | Revived 2026-05-31 (crons.ts:181). LIVE, class A (trigger). |
| intelligence-daily-brief | `15 10 * * *` | intelligence-brief.ts:208,217 | daily ingestion + claim verification + opportunity scoring + executive brief | BrainMemory (delete), BriefingLog (create) | **yes** (generateText) | web push + Telegram | 2 | Staggered +15min off operator-morning-brief on purpose (crons.ts:189) to avoid double-push + provider contention. LIVE, class A. |
| intelligence-weekly-brief | `0 11 * * 0` | intelligence-brief.ts:446,449 | weekly ingestion + strategic briefing | shares BriefingLog/BrainMemory writes with the daily fn (same file) | **yes** (shares generateText call site) | web push + Telegram | 2 | LIVE, class A. |
| customer-preferences-recompute | `0 11 * * *` | customer-preferences.ts:143,147 | recomputes customer-preferences profile from recent activity | none observed directly | no | none observed | 2 | `concurrency:{limit:4}` — the only other concurrency cap besides mega-fanout. LIVE, class A. |
| diagnose-cron-failure | `0 */4 * * *` | diagnose-cron-failure.ts:107,110 | diagnoses stalled/failing crons, alerts operator | none observed directly | no | none observed directly (H — 285-line file, only greeped) | 2 | Runs 6x/day; overlaps in purpose with cron-healer (folded into mega-evening, 1x/day) and inngest-liveness (1x/day) — three separate "is a cron dead" detectors on different cadences/paths. Possible **DUPLICATE** family, not confirmed identical scope. LIVE, class A (trigger) / H (overlap significance). |
| crm-weekly-followups | `0 9 * * 1` | crm-followups.ts:13,16 | CRM weekly follow-ups proposer | Task (create) | H | Telegram | none set (no `retries:` found — defaults to Inngest platform default) | LIVE, class A. |
| content-performance-weekly | `0 12 * * 1` | content-performance.ts:54,57 | analyzes weekly social-content performance | BrainMemory (upsert) | H | none observed | 1 | LIVE, class A. |
| approval-sweeper | `*/5 * * * *` | approval-sweeper.ts:9,13 | durability backstop: re-fires stuck `approved`/stale-`executing` `ApprovalRequest` rows, **including real customer SMS** (`shop.sendSms`) | ApprovalRequest (status flips, in lib/tools/guardian.ts) | no | **real external send** via `executeApprovedToolAsync` -> guardian's tool dispatch (SMS to customers is in scope per the file's own 2026-07-09 hardening comment) | n/a (5-min poll) | Highest-frequency Inngest cron. Guarded by `expiresAt > now()` + 48h `ageFloor` (approval-sweeper.ts:31-46) specifically so a fresh deploy cannot mass-resurrect and EXECUTE every historically-stuck approval. `take:10`/batch. See Section 3/4. LIVE, class A — this is the most consequential row in the whole matrix. |
| audit-todays-leads | `0 8 * * *` | audit-todays-leads.ts:140,143 | audits today's leads from the Nick's Tire & Auto bridge; can propose `shop.sendSms` approvals | ApprovalRequest (create) | H (not directly observed; likely lib-delegated) | nickstire bridge read + writes an ApprovalRequest that, once approved, can send real SMS (see approval-sweeper row) | 1 | Feeds the approval-sweeper's most consequential queue. LIVE, class A. |
| automation-engine | `0 * * * *` | automation-engine.ts:45,47 | hourly automation-rule evaluation, edge-triggered via match-set fingerprint | none observed directly | no | delegates to AutomationPolicy-gated actions (see Section 4) | none set | Rewritten 2026-08-26 per crons.ts:270 (previously threw on every fire). LIVE, class A. |
| operating-rhythm | `0 15,16 * * *` | operating-rhythm.ts:42,44 | ET-aware mid-morning check (revenue+callbacks+stale leads+focus hours), Telegram push | none observed directly | no | Telegram (delegated) | none set | Dual-UTC-hour trigger (`15,16`) is the DST-safety pattern — `getCurrentSlot()` gates on the ET hour inside the fn so the wrong-hour tick is a no-op (crons.ts:277-280); idempotent per slot/day via `rhythmAlreadyPushed`. LIVE, class A. |
| neglect-penalty | `0 */4 * * *` | **no implementing file** | manifest claims "deducts XP from neglected missions idle >48h + Telegram alert" | n/a | n/a | n/a | n/a | **DEAD** — `mode:"dormant"` in manifest but zero code exists (Section 0.4). Class A (absence). |


### 1b. Event-triggered Inngest functions (not on the cron manifest by design — listed for completeness per "per Inngest function")

These fire on an internal `inngest.send()` call from application code, not on a schedule. Not a
manifest gap: `config/crons.ts` is documented as the schedule manifest, and these are not
scheduled. Included because the task asked for every function in `lib/inngest/functions/*`.

| id | event trigger | fn file:line | what it does | writes | LLM | external FX | retries | class |
|---|---|---|---|---|---|---|---|---|
| bulk-sms-approval | `bulk-sms/proposed` (+ waits on `bulk-sms/approval-response`) | bulk-sms-approval.ts:88,92 | proposes a batch SMS send, waits for an operator approval event before sending | none observed directly | H | Telegram (proposal notice) + a real SMS send on approval (H — not traced to completion) | 0 | Name + `retries:0` + wait-for-event pattern indicates a human-in-the-loop gate; **not traced further given scope** — flag for follow-up if bulk SMS behavior needs its own audit. Class A (trigger), H (full behavior). |
| research-on-demand | `research/on-demand` | deep-research.ts:21,24 | on-demand deep-research run (manual fire, same pattern as `mega/fire.*`) | none observed directly | H (name implies yes; not grep-confirmed in this file — likely delegates) | web push + Telegram (result notification) | 1 | Class A (trigger). |
| nick-event-triggers | `nick/urgent.signal` | event-triggers.ts:124,131 (approx) | real-time lane: an urgent brain-bus signal (e.g. a drift alert) becomes ONE pending `AutonomousAction` row within seconds, instead of waiting for the next 8am poll | AutonomousAction (create) | no | **none** — fail-closed by design, writes a pending row and stops; a human must approve via `/qa` or `/system/actions` before anything executes | 2 | Gated by `NICK_EVENT_TRIGGERS` flag (default OFF per the file's own header). Idempotency key `nick_event::<ruleId>::<date>` collapses same-day retries/duplicate emits to one row (P2002 caught as the happy path). Exemplary fail-closed pattern — class A, full file read. |
| journal-fanout | `journal/entry.captured` | journal-fanout.ts:30,33 | per-entry journal fan-out (thread assignment / downstream processing) on capture | none observed directly | H | none observed | 2 | Class A (trigger). |
| nick-action-approved | `nick-action/approved` | nick-action-approved.ts:34,37 | executes ONE Nick action immediately when the operator approves it via `/qa`, instead of waiting for the 9am `nick-action-execute` batch | shares `runNickActionBatch` core with the cron route (`lib/ai/nick-action-batch.ts`) | no direct call in this file (delegates) | shares the cron's external-FX profile (Telegram digest; `send_sms_outreach` remains **draft-only** — see Section 4) | 0 | Gated by `NICK_AUTONOMY` flag. Cuts the up-to-23h approval-to-execution latency the file's own comment names. Class A. |
| social-publish | `social/publish` | social-publish.ts:67,69 | publishes a queued social post live to **Facebook and Instagram Graph API** (`graph.facebook.com/v20.0`, container-then-publish flow) | SocialPublishQueue (update/updateMany), AuditEvent (create) | no | **real external publish** — the only job in this audit confirmed to post live to a third-party platform on the operator's behalf | not set observed | Event-triggered only (no cron), so it fires exactly when application code enqueues+sends the event — presumably gated upstream by an operator approval/queue-promotion step this audit did not trace to its origin (H for the upstream gate; A for the publish mechanics themselves). **Flag for a dedicated audit of what enqueues `social/publish`** if the operator wants that chain fully verified. |
| task-due-reminder | `task/due.scheduled` (+ `task/due.rescheduled` cancels/replaces via matching `taskId`) | task-due-reminder.ts:24,27 | per-task due-date reminder, self-cancelling/rescheduling via Inngest's event-matching cancellation | none observed directly | no | web push (sendPush) | 2 | Uses Inngest's built-in cancel-on-event pattern rather than a DB flag for reschedule — clean design, not a cron. Class A. |
| mega-fanout (`mega-fanout-morning` / `mega-fanout-evening`) | cron `0 9\|3 * * *` + event `mega/fire.morning\|evening` | mega-fanout.ts:315-392, 400-460 | the Inngest reimplementation of the mega dispatcher (see Section 0) | CronJobLog (create, heartbeat row) | no | none itself; fans out to everything in MORNING/EVENING/WEEKLY_JOBS | 3 | **Gated off by default** (`INNGEST_MEGA_V2` env, Section 0.3) — class A code / class I runtime value. |


### 1c. Route-based crons (`/api/cron/*`, all wrapped in `cronHandler` per Section 0.7 unless noted)

**COMPOSE** (4 manifest rows; `automation-engine` and `operating-rhythm` are `inngest:true` and
already fully covered in Table 1a — listed here only as pointers because crons.ts physically
places them in this category).

| id | schedule | trigger | route:line | what it does | writes | LLM | external FX | class |
|---|---|---|---|---|---|---|---|---|
| mega | `0 9 * * *` (9am UTC = 5am ET) | external Railway Cron Job -> worker `POST /cron/mega` -> this route (Section 0.2, class I for the external leg) | app/api/cron/mega/route.ts:1-197 | fans out `MORNING_JOBS` (14 children) via `withConcurrency(...,6)` | CronJobLog (create, slot heartbeat `jobName:"mega"`) | no | none itself | LIVE (dispatch mechanism), class A code / I external trigger |
| mega-evening | `0 3 * * *` (03:00 UTC = 10-11pm ET) | same route, `?slot=evening`; +`WEEKLY_JOBS` appended when `isSundayET()` | same file | fans out `EVENING_JOBS` (21 children) + weekly (7) on Sunday-ET | CronJobLog (create, `jobName:"mega-evening"`) | no | none itself | LIVE, class A code / I external trigger |
| automation-engine | `0 * * * *` | **Inngest-native** — see Table 1a | lib/inngest/functions/automation-engine.ts | hourly AutomationRule evaluator | — | — | — | pointer row — see 1a |
| operating-rhythm | `0 15,16 * * *` | **Inngest-native** — see Table 1a | lib/inngest/functions/operating-rhythm.ts | ET-aware mid-morning push | — | — | — | pointer row — see 1a |

**NAME COLLISION WARNING (class A):** `automation-engine` (this table, Inngest-native, hourly
`AutomationRule` evaluator) and `autonomous-engine` (ACTION section below, folded into
mega-evening, the `NICK_AUTONOMY`-gated proactive rules engine with ~22 rules) are **two
different jobs with near-identical names** — not a duplicate, but easy to conflate when reading
logs, `/system/crons`, or a Telegram alert naming one of them. `config/crons.ts:270` even notes
the automation-engine executor "previously threw on every fire" until an 2026-08-26 rewrite —
worth double-checking which of the two a historical incident report meant.

**INGEST** (4 rows — all fold through `MORNING_JOBS`, all 1x/day per an explicit 2026-05-30
operator decision recorded in `lib/inngest/jobs.ts:60-64`: "i only need one a day on google").

| id | schedule | trigger | route:line | what it does | writes | LLM | external FX | idempotency | class |
|---|---|---|---|---|---|---|---|---|---|
| ingest-reviews | `0 9 * * *` | mega-morning | app/api/cron/ingest-reviews/route.ts (69 ln) | Google Places review pull -> BrainMemory(google_review), the only writer behind `getReviewStats` | BrainMemory (writes not caught by create/update/upsert grep at route level — delegates; H) | no | Google Places API read | H — not independently confirmed | LIVE, class A (trigger) |
| ingest-gmail | `0 9 * * *` | mega-morning | app/api/cron/ingest-gmail/route.ts (423 ln) | multi-account Gmail pull + AI classify + Telegram nudge on high-urgency needs-reply | not caught by grep at route level (delegates to a service; H) | **yes** (tracedAiChat, confirmed) | Gmail API **read**, Telegram push. No Gmail *write* markers found (`messages.modify`/`labels.create`/`trash` all absent from this route file — grep clean, class A absence at this file, though the underlying Gmail client lib was not separately audited) | H | LIVE, class A (LLM+push), A (no-write-observed at route level) |
| ingest-calendar | `0 9 * * *` | mega-morning | app/api/cron/ingest-calendar/route.ts (179 ln) | Calendar pull | not caught by grep (delegates) | no | Google Calendar API read | H | LIVE, class A (trigger) |
| ingest-drive | `0 9 * * *` | mega-morning | app/api/cron/ingest-drive/route.ts (54 ln) | Drive pull, idempotent per Drive file ID | not caught by grep (delegates) | no | Google Drive API read | keyed on Drive file ID per crons.ts:352 (H, not independently re-verified in the service layer) | LIVE, class A (trigger) |

All four ingest jobs no-op gracefully when Google OAuth is not configured
(`lib/system/cron-diagnostics.ts:215`, referenced by the diagnostics module as a known silent-skip
condition — class A that the *code path* exists; whether OAuth is actually configured in prod is
class I).

**BRAIN** (11 rows, all folded into a mega slot except `embed-backfill`, `conversation-mission-link`,
`predict`, `calibration-generator`, `intelligence` which have their own `schedule` string but still
ride a mega fan-out — "active" here means "on its own manifest schedule line," not "its own
external trigger"; all 11 ultimately fire via the mega mechanism in Section 0).

**NAME COLLISION WARNING (class A):** `/api/cron/intelligence` (row below — nightly cross-source
synthesis writing to `BrainMemory(intelligence)`) is a **different job** from the Inngest-native
`intelligence-daily-brief` / `intelligence-weekly-brief` (Table 1a — executive briefing with
`generateText`, BriefingLog). Same root word, disjoint code, disjoint schedules, disjoint outputs.

| id | schedule | route:line | what it does | writes | LLM | external FX | idempotency/guard | class |
|---|---|---|---|---|---|---|---|---|
| brain-intelligence | folded->mega-evening | app/api/cron/brain-intelligence/route.ts (221 ln) | scans recent BrainMemory for cross-source patterns, writes synthesis rows | BrainMemory (update) | no observed at route level | none | H | LIVE, class A (trigger) |
| embed-backfill | `0 3,9 * * *` (2x/day) | app/api/cron/embed-backfill/route.ts (360 ln) | embedding backfill across 7-8 source types (brain_dump, reflection, situation_log, decision_replay, strategic_law, greene_law, chat_message) + BrainMemory itself | VectorEmbedding writes (not caught by create/update/upsert grep — a dedicated `storeGenericEmbedding` helper) | embedding-model calls (not chat LLM) — `BATCH_PER_TYPE=15` x ~7-8 types + `BRAIN_BATCH=100` for BrainMemory = **up to roughly 200-220 embedding calls/run, 2x/day** (derived from `embed-backfill/route.ts:27-330`, class H per Section 8) | none | every query capped `take:200-500` per source type + `slice(0, BATCH_PER_TYPE)`; bounded scan fixed a prior OOM/silent-timeout (route comment, line ~49-70) | LIVE, class A |
| conversation-mission-link | `0 3 * * *` | app/api/cron/conversation-mission-link/route.ts (10 ln) | scans new chat messages for mission-relevance, writes ConversationMissionLink rows | not caught by grep (10-line route, pure delegation to a service — H) | H | none | H | LIVE, class A (trigger only; 10-line file is a thin wrapper) |
| consolidate | folded->mega-evening | app/api/cron/consolidate/route.ts:1-69 (full read) | brain "sleep cycle": `runConsolidation()` (prune/merge/promote/rescore) + skill-graduation + slow-query flush + semantic near-dup sweep | BrainMemory (via `pruneNoise` — see Section 2), VectorEmbedding drops, SystemMetric | H (merge/promote steps likely use an LLM per the file's own doc comment "AI-merge in runConsolidation," not directly grep-confirmed in this 69-line wrapper) | none | `SEMANTIC_DEDUP_LIVE` env flag gates the dedup pass to **dry-run by default** (`consolidate/route.ts:51-61`, class A code / I runtime value) | LIVE, **DETACHED** from mega's own timeout tracking (Section 0.1 — one of the two `DETACHED_CHILDREN`), class A |
| tool-description-rewrite | folded->mega-evening | app/api/cron/tool-description-rewrite/route.ts (20 ln) | drafts tool-description rewrites from failure telemetry, drafts-only into BrainMemory(tool_description_draft) — a human applies them in code | BrainMemory (not caught by grep — thin wrapper) | H (crons.ts says "drafts," implies LLM) | none | capped ≤3 tools/run per crons.ts:405 | LIVE, class A (trigger) |
| semantic-link | folded->mega-evening | app/api/cron/semantic-link/route.ts (31 ln) | embedding-based cross-memory linker, batch 25, top-3 pgvector KNN -> SemanticEdge upserts | SemanticEdge (not caught by grep — different table name than the create/update/upsert regex scanned) | no (KNN + upsert, not generative) | none | batch 25/run per crons.ts:416 | LIVE, class A (trigger) |
| mastery-xp | folded->mega-evening | app/api/cron/mastery-xp/route.ts (41 ln) | mastery leveling engine, AI-attributes the day's chat/captures/decisions -> stat XP | not caught by grep (delegates to lib/mastery) | **yes** (tracedAiChat, confirmed) | none | idempotent per `sourceKey` per crons.ts:426 | LIVE, **DETACHED** from mega's timeout (Section 0.1, the other `DETACHED_CHILDREN` member), class A |
| predict | `0 3 * * *` | app/api/cron/predict/route.ts (35 ln) | forecasts week ahead from patterns, writes Prediction rows | not caught by grep (thin wrapper) | H | none | H | LIVE — mega's ONE per-path timeout override (`240_000ms` vs default 90s, `mega-fanout.ts:126`) because it averages 82.5s against the 90s default per that file's own measurement comment. class A |
| calibration-generator | `0 3 * * *` | app/api/cron/calibration-generator/route.ts (199 ln) | scans completed tasks/predictions, proposes outcomes for manual calibration | BrainMemory (updateMany), CalibrationReviewItem (upsert) | H | none | H | LIVE, class A |
| reflect-categories | folded->weekly (Sunday-ET) | app/api/cron/reflect-categories/route.ts (116 ln) | reflects on BrainMemory category distribution, hosts `NICK_REFLECTION_TREES` higher-order synthesis | not caught by grep (delegates) | **yes** (aiChat, confirmed) | none | gated sub-feature (`NICK_REFLECTION_TREES`) per crons.ts:456 | LIVE, class A |
| intelligence | `0 3 * * *` | app/api/cron/intelligence/route.ts (129 ln) | nightly cross-source intelligence synthesis -> BrainMemory(intelligence) | not caught by grep (delegates) | H | none | H | LIVE, class A (trigger) — NOT the same job as intelligence-daily/weekly-brief, see collision note above |


**HYGIENE** (11 rows)

| id | schedule | trigger | route:line | what it does | writes | LLM | external FX | guard/idempotency | class |
|---|---|---|---|---|---|---|---|---|---|
| task-resurface | `0 9 * * *` | mega-morning | app/api/cron/task-resurface/route.ts:1-93 (full read) | flips `WAITING`->`READY` when `snoozedUntil<=now`, clears the field | Task (updateMany), TaskEvent (async emit) | no | Telegram (batched, one message/run, ≤10 titles + "…and N more") | `take:100` cap; snoozedUntil-null write is itself the lock (2nd pass = no-op) | LIVE, class A |
| stale-tasks | `0 9 * * *` (doc says "8am daily," actual slot is mega-morning 9:00 UTC) | mega-morning | app/api/cron/stale-tasks/route.ts:1-108 (full read) | bumps `driftRisk` on tasks untouched 5+ days; creates DriftAlert (CoachEvent) when risk>3; marks overdue ScheduledActions | Task (update, per-row loop), ScheduledAction (updateMany) | no | CoachEvent (-> push, flood-controlled per Section 3) | `take:100` cap added 2026 after a 500+-row post-hiatus backlog blew the 60s envelope (route comment) | LIVE, class A |
| data-cleanup | `0 3 * * *` | mega-evening | app/api/cron/data-cleanup/route.ts:1-345 (full read) | **the big nightly retention sweep** — see Section 2 for full detail | 17+ tables (SystemMetric, ApiRequestLog, ErrorLog, DeviceEvent, LocalSyncLog, BrainMemory x2 shapes, Commitment x2, AutonomousAction status flip, AuditEvent x4 shapes, CronJobLog, StateLog, SituationLog, DeviceCommand, RecoveryActionLog, ReviewLog, AgentTrace, AutonomousEvent, ToolVerbRatio) | no | none | `judgeSweep()` circuit breaker (cap 5,000/sweep) added 2026-09-01 after a 54,107-row incident; **DUPLICATE overlap with cron-healer's Phase 4** — see Section 2 | LIVE, class A — **top destructive-job finding, see Section 2** |
| agent-followups | `*/15 * * * *` | **worker** node-cron -> `/api/cron/agent-followups`, but `mode:"dormant"` means it is **not actually registered** in `apps/worker/src/scheduler.ts:120-158`'s `HIGH_FREQ_JOBS` (confirmed: only `brain-bus-drain`/`outbox-drain`/`inngest-liveness` are listed there — `agent-followups` is absent) | app/api/cron/agent-followups/route.ts:1-80 (full read) | delivers follow-ups the agent scheduled for itself | PostTurnOutbox (update) | H (delegates to `runFollowUp`) | Telegram (implied — "the only thing that can deliver an unprompted message" per crons.ts:517-522) | **THREE independent off-switches**: `NICK_AGENT_FOLLOWUPS` flag (default off), `isCronEnabled` kill switch, AND the manifest `mode:"dormant"` itself (worker never calls it). Attempts capped <3, `claimDueFollowUps(5)` batch cap. | **DORMANT by triple-design**, class A — the most conservatively-gated job in the whole matrix |
| outbox-drain | `*/15 * * * *` | **worker** node-cron (confirmed in `HIGH_FREQ_JOBS`) + nightly mega-evening backstop | app/api/cron/outbox-drain/route.ts (partial read) | replays orphaned post-turn chat work via atomic first-claimant-wins claim | PostTurnOutbox writes (via `claimOrphans`/`finishClaim`, not caught by top-level grep) | H (re-runs `runDeferredBackgroundWork`, which may include chat-side LLM work) | Telegram noted by route_scan (H — not traced) | `claimOrphans(25)` cap, `OUTBOX_MAX_ATTEMPTS` dead-letter ceiling | LIVE, class A |
| brain-bus-drain | `*/15 * * * *` | **worker** node-cron (confirmed) | app/api/cron/brain-bus-drain/route.ts:1-44 (full read) | drains the durable BrainBusEvent queue (9 producers: tasks/goals/journal/drift/identity/autonomous-engine/cron-manager failures) through idempotent handlers | BrainMemory (via `dispatchDurableEvent`, findUnique-then-create pattern per the file's own comment — not caught by top-level grep) | no | none | `limit:50`/tick; recovered a 393-row 2-month backlog measured in prod (file header) | LIVE, class A |
| inbox-janitor | `0 3 * * 1` (Monday UTC = Sunday-ET weekly slot) | mega-evening weekly | app/api/cron/inbox-janitor/route.ts:1-117 (full read) | soft-archives empty system Inbox missions idle 30+ days (does NOT touch CaptureInboxItem per crons.ts:568-573 correction) | Mission (update: `deletedAt` + status PAUSED — soft-delete only, never hard) | no | none | 3-of-3 reap criteria (isInboxMission + zero live tasks + 30d-cold); per-inbox live-task recount before each archive | LIVE, class A |
| data-source-health | folded->mega (morning) | app/api/cron/data-source-health/route.ts (partial read) | probes the nickstire bridge + service feeders, writes `data_source_probe` rows | BrainMemory (data_source_probe category, not caught by top-level grep) | no | CoachEvent on HARD-FAIL only (empty-but-ok is not alerted — route comment) | none observed | LIVE — this is the canary that would have caught the nickstire-bridge-$0-revenue regression the file's own header names as its origin story; class A |
| ollama-model-liveness | folded->mega (morning) | app/api/cron/ollama-model-liveness/route.ts (partial read) | proof-of-life for Ollama Cloud chat/fast/vision lanes via the SAME resolver a real turn uses | none observed | no (the "LLM calls" here are liveness pings, not content generation) | Telegram on any non-200; 410 called out specifically as "retired forever" | none observed | LIVE, class A |
| subtask-usage-audit | `0 3 * * *` | mega-evening | app/api/cron/subtask-usage-audit/route.ts:1-129 (full read) | **self-deletes its own ADR doc + a migration directory from the container filesystem** if, on/after 2026-06-22, zero live `Task.parentTaskId` rows exist AND the ADR's two candidate checkboxes are unchecked | **filesystem** `fs.unlinkSync` + `fs.rmSync(recursive:true,force:true)` — NOT a DB write | no | none | Gate = `subtasksInDbCount>0 \|\| candidatesChecked` (DB read is class I; the two ADR checkboxes are confirmed STILL UNCHECKED in this snapshot, class A). **Verified this delete is durably harmless**: `docs/adr/0017-task-subtasks-semantics.md` and `prisma/migrations/20260523_task_parent_task_id/` both still exist in the git source at commit abdd993 — 72+ days after the 2026-06-22 trigger date — proving Railway's ephemeral-container-from-git deploy model means this nightly `fs.rmSync` never touches the actual repo (class A, positive control: the files' continued existence in source IS the proof). Still a code smell: a cron doing raw filesystem deletes in a container, and if `subtasksInDbCount` is ever 0 in prod, this has been logging a `warn`-level "deleted" success message every night for 10+ weeks against files that were never actually gone. | LIVE but **structurally inert against source**, class A |
| cron-healer | folded->mega-evening | app/api/cron/cron-healer/route.ts:1-12 (full read) -> `lib/services/autonomic-orchestrator.ts` (515 ln, substantially read) | 5-phase self-healing: (1) heal failing/never-run crons, max 3/run, (2) Postgres bloat VACUUM ANALYZE, (3) Ollama-quota-tripped work-item rescue, (4) **a second, independent log-pruning sweep of the same tables `data-cleanup` already prunes**, (5) auto-decompose stalled top-level tasks (take 3) | see Section 2 — **DUPLICATE finding** | no | CoachEvent (success path) + raw Telegram (heal-FAILURE path only, unthrottled — see Section 3) | mega-recursion guard (`targetPath==="/api/cron/mega"` skip, added post-2026-08-20 storm), `MAX_HEAL_PER_RUN=3`, `isFailing`/`isNeverRun` reclassified to exclude `partial` status | LIVE, class A — **second-most consequential destructive-job finding, see Section 2** |


**REVIEW** (11 rows; `xp-decay`, `distill-sessions`, `conversation-compile` fully covered in
Section 2 — pointer rows only here)

| id | schedule | trigger | route:line | what it does | writes | LLM | external FX | guard/idempotency | class |
|---|---|---|---|---|---|---|---|---|---|
| weekly-review | `0 3 * * 1` | mega-evening weekly | app/api/cron/weekly-review/route.ts (296 ln; `generateText` confirmed at :188) | writes the weekly review prompt + opens the wizard nudge | not caught by top-level grep (H) | **yes** (generateText, confirmed) | none | H | LIVE, class A |
| weekly-digest | `0 3 * * 1` | mega-evening weekly | app/api/cron/weekly-digest/route.ts (467 ln) | composite digest across missions+relationships+journal+brain | not caught by top-level grep (H) | H (467-line composer, likely template + selective LLM; not confirmed) | **real email via Resend** — `resend.emails.send({from:"NOUR OS <noreply@bdnick.info>", to:"nourdean22@gmail.com"})` (`weekly-digest/route.ts:432-434`, class A, direct read) — degrades gracefully to "assembled but not emailed" if `RESEND_API_KEY` is unset (`:415-426`) | H | LIVE, class A (email confirmed) |
| outcome-harvest | `0 3 * * 1` | mega-evening weekly | app/api/cron/outcome-harvest/route.ts (143 ln) | "corpus odometer" — counts `intelligence_outcomes` corrections, upserts ONE rolling `eval_run` row, flags the 200-correction fine-tune trigger | BrainMemory (upsert) | no | none | rolling upsert, not per-run creates | LIVE, class A |
| pricing-advisory | `0 3 * * 1` | mega-evening weekly | app/api/cron/pricing-advisory/route.ts (81 ln) | ALG win-rate outliers vs fleet median -> competitor prices -> drafted experiments | BrainMemory (upsert) | H | CoachEvent | idempotent per run-date via BrainMemory upsert (crons.ts:667) | LIVE, class A |
| journal-checkin | `0 3,9 * * *` (2x/day: mega-morning slot=morning, mega-evening slot=evening) | mega x2 | app/api/cron/journal-checkin/route.ts (161 ln) | Telegram prompt with the day's journal question, operator can SMS reply | AuditEvent (create) | H | Telegram | H | LIVE, class A |
| os-snapshot | `0 3 * * *` | mega-evening | app/api/cron/os-snapshot/route.ts (101 ln) | captures the day's `DailyEmpireSnapshot` row for trend analysis | SystemMetric (create) | no | CoachEvent | H | LIVE, class A |
| refresh-identity | folded->mega-evening | app/api/cron/refresh-identity/route.ts (81 ln) | rolls the 8-axis identity snapshot (BrainMemory identity_snapshot/current + daily history row) | not caught by top-level grep (H — likely a service-layer upsert) | H | none | H | LIVE, class A (trigger) |
| xp-decay | folded->mega-evening | app/api/cron/xp-decay/route.ts:1-106 (full read) | loss-aversion decay — negative-XP BrainMemory event rows for stats idle past a 7d grace | BrainMemory (create) | no | none | idempotent per stat/day key `decay:<stat>:<dayKey>`, P2002-caught retry; `MIN_LOSS=1` floor avoids noise rows | LIVE, class A — full detail in Section 2 |
| distill-sessions | folded->mega-evening | app/api/cron/distill-sessions/route.ts:1-78 (full read) | distills idle chat sessions into `BrainMemory(chat_summary)` + rolling `nick_current_concerns` | BrainMemory (chat_summary), AuditEvent (brain_insight, conditional), `nick_current_concerns` aggregate | **yes**, one call per distilled conversation | none | batch cap 10/run | LIVE, class A — full detail in Section 2/8 |
| conversation-compile | folded->mega-evening | app/api/cron/conversation-compile/route.ts:1-25 (full read) | nightly tail-catcher for the per-turn conversation compiler | ConversationSummary (via `summarizeIdleConversations`, not caught by top-level grep) | **yes**, one "reason"-lane call per conversation | none | cap 10/run, 200ms apart, **$5/day AI budget enforced pre-flight per call** (route comment) | LIVE, class A — full detail in Section 8 |
| anticipate | folded->mega-evening | app/api/cron/anticipate/route.ts (partial read) | drafts + precomputes tomorrow's 3 anticipated questions | BrainMemory (anticipated_question, upsert) | H (`draftAnticipatedQuestions` name implies LLM; not grep-confirmed directly in the 30-line route since it delegates) | none | idempotent per day (`anticipated_<date>` upsert key) + 6h short-circuit re-check to survive double-fire retries; hard cap 60s total, 3 questions x 10s precompute worst-case 30s | LIVE, class A |


**RELATIONSHIPS / Power Atlas** (6 rows)

| id | schedule | mode | trigger | route:line | what it does | writes | LLM | external FX | guard | class |
|---|---|---|---|---|---|---|---|---|---|---|
| relationship-digest | `0 22 * * 0` | **dormant** | none (not in any `MORNING_JOBS`/`EVENING_JOBS`/`WEEKLY_JOBS` array — confirmed by grep of `lib/inngest/jobs.ts`) | app/api/cron/relationship-digest/route.ts (216 ln) | Greene-voiced weekly relationship digest, cooling + birthdays-this-week | not caught by top-level grep | **yes** (tracedAiChat, confirmed) | Telegram (confirmed) | self-gates `getUTCDay` (confirmed), idempotent per ISO week (crons.ts:758) | **DORMANT** — code exists and is fully wired for LLM+Telegram but never fires because it is absent from the job arrays; class A |
| relationship-birthday | `0 9 * * *` | active | mega-morning | app/api/cron/relationship-birthday/route.ts (112 ln) | birthday/anniversary push | not caught by top-level grep | no | Telegram (confirmed) | idempotent per `personId+date+kind` (crons.ts:773) | LIVE, class A |
| relationship-weekly-synthesis | `0 3 * * 1` | active | mega-evening weekly | app/api/cron/relationship-weekly-synthesis/route.ts (232 ln) | 3-paragraph synthesis of the week's relationship movement | BrainMemory (create) | **yes** (tracedAiChat, confirmed) | none observed | self-gates `getUTCDay` (confirmed), idempotent per ISO week | LIVE, class A |
| kept-word-scan | `0 9 * * *` | active | mega-morning | app/api/cron/kept-word-scan/route.ts:1-21 (full read) | scans last 24h chat for promises made to the operator, upserts `BrainMemory(kept_word)` per (personId, chatMessageId) | BrainMemory (via `scanKeptWords`, not caught by top-level grep) | H (delegates; "scans chat" strongly implies at least a classification pass) | **none by design** — the route's own doc comment says "Silent, no Telegram" (`kept-word-scan/route.ts:8`) | per-(personId,chatMessageId) upsert | LIVE, class A |
| dossier-autodraft | `0 9 * * 1` (Monday, self-gated) | active | mega-morning, self-gates `getUTCDay()===1` | app/api/cron/dossier-autodraft/route.ts (150 ln) | drafts dossier MD updates for stale `PersonProfile` rows; operator confirms via action queue | PersonProfile (update) | **yes** (tracedAiChat, confirmed) | none | weekly cadence achieved via daily-fire + Monday self-gate (avoids 7x AI spend) — same pattern as greene-law-tag-refresh | LIVE, class A |
| greene-law-tag-refresh | `0 9 * * 1` (Monday, self-gated) | active | mega-morning, self-gates `getUTCDay()===1` | app/api/cron/greene-law-tag-refresh/route.ts (49 ln) | refreshes per-person `applicableLaws` array from corpus | PersonProfile (update) | no (grep-clean) | none | same Monday self-gate pattern | LIVE, class A |

**SIGNALS / ALERTS** (4 rows)

| id | schedule | trigger | route:line | what it does | writes | LLM | external FX | class |
|---|---|---|---|---|---|---|---|---|
| correlation-alarm | `0 3 * * *` | mega-evening | app/api/cron/correlation-alarm/route.ts (76 ln) | cross-source correlation anomaly detector | not caught by top-level grep | no | CoachEvent (P1, confirmed) | LIVE, class A |
| decision-quality-drift | `0 16 * * 1` | **dormant** (not in any job array) | app/api/cron/decision-quality-drift/route.ts (70 ln) | weekly decision-quality scan | not caught by top-level grep | no | CoachEvent (P0, confirmed) | **DORMANT**, class A |
| creation-spike-detect | `0 3 * * *` | mega-evening | app/api/cron/creation-spike-detect/route.ts (72 ln) | detects abnormal creation-rate spikes across BrainMemory+Task+Mission+Ledger | not caught by top-level grep | no | CoachEvent (confirmed) | LIVE, class A |
| cost-slo-check | `0 3 * * *` | mega-evening | app/api/cron/cost-slo-check/route.ts (236 ln) | AI cost SLO check, alerts when daily spend exceeds budget cap | BrainMemory (create), UserPreference (delete+upsert) | no | CoachEvent (P0) + **raw Telegram** (both confirmed — this route calls `sendTelegram` directly, bypassing the `sendPush` cooldown wrapper per Section 3) | LIVE, class A — worth double-checking this doesn't storm on a sustained budget breach, since Telegram here is unthrottled (H — not traced whether the route has its own daily-dedup on the direct Telegram call; 236 lines not fully read) |

Two of four SIGNALS/ALERTS jobs are dormant — `decision-quality-drift` alongside
`relationship-digest` above means the manifest currently ships **2 confirmed dormant route-based
crons + `agent-followups` (triple-gated dormant) + `neglect-penalty` (dead) = 4 non-firing
`inngest:true`/route entries out of 77**, all fully coded and none deleted.

**ACTION** (Wave AG Nick Action Queue + closed-loop learning; 7 rows, `neglect-penalty` already
covered in Table 1a as a pointer)

| id | schedule | trigger | route:line | what it does | writes | LLM | external FX | guard | class |
|---|---|---|---|---|---|---|---|---|---|
| relationship-picks-prewarm | folded->mega-morning (~7am UTC) | mega-morning | app/api/cron/relationship-picks-prewarm/route.ts (53 ln) | pre-warms the `RELATIONSHIPS_PICKS_TODAY` cache so the 8am proposer has outreach data | not caught by top-level grep | **yes** (tracedAiChat, confirmed) | none | idempotent — returns cached value if already populated (crons.ts:905) | LIVE, class A |
| nick-action-proposal | folded->mega-morning (~8am UTC) | mega-morning | app/api/cron/nick-action-proposal/route.ts (219 ln) | Nick proposes 3-6 actions (SMS outreach / mission archive / task move / journal commit / AI spend confirm), writes `AutonomousAction(pending)` rows | AutonomousAction (create) | H (219-line proposer, "Nick proposes" implies reasoning; not directly grep-confirmed at this file) | Telegram (`/qa` approve/reject syntax, confirmed) | gated by `NICK_AUTONOMY` (confirmed) | LIVE, class A — full detail in Section 4 |
| nick-action-execute | folded->mega-morning (~9am UTC) | mega-morning | app/api/cron/nick-action-execute/route.ts:1-150 (full read) | executes operator-**approved** `AutonomousAction` rows from the last 24h | BrainMemory (NICK_ACTION_RESULTS, one row/day) + per-action side effects via `runNickActionBatch` | no directly (delegates to `executeNickAction`, which itself is non-LLM per its dispatch table) | Telegram digest (best-effort); **`send_sms_outreach` is confirmed DRAFT-ONLY** — writes a BrainMemory row with `sent:false`, never calls an outbound SMS API (`lib/ai/execute-actions.ts:251-299`, full read, class A) | idempotent per day (BrainMemory NICK_ACTION_RESULTS/today, existence check before running); `NICK_AUTONOMY` gate is defense-in-depth (proposer is already gated) | LIVE, class A — full detail in Section 4 |
| autonomous-engine | folded->mega-evening | mega-evening | app/api/cron/autonomous-engine/route.ts:1-172 (full read) | runs `runAutonomousActions()` (`lib/brain/autonomous-engine.ts`), ~20 proactive rules (revenue-pace, urgent-leads, drift escalation, commitment enforcement, morning brief, expired-quote follow-up, etc.) | delegates (per-rule; not enumerated) | H (per-rule, not traced) | **one rule (`auto_followup_expired_quote`) emails a real customer** — every other outward rule (Telegram/memory) is lower-risk; the route's own pre-flight `assertApprovalGated()` checks all 20 outward rules against the `AutomationPolicy` registry and returns the ungated list IN ITS OWN HTTP RESPONSE, never silently | **fail-closed since v10.0.157**: a rule with no seeded policy row defers to `pending` (missing policy != auto-fire — confirmed by the file's own comment citing "14d of unseeded rules produced only pending rows, zero auto-executions"); `NICK_AUTONOMY` flag gate is checked BEFORE any DB read | LIVE, class A — this is the single richest safety-model file in the audit; full detail in Section 4 |
| change-detection | `0 13 * * *` (~9am ET) | mega-morning | app/api/cron/change-detection/route.ts:1-27 (full read) | Firecrawl scrape + content-hash of watched competitor/regulatory pages -> PageSnapshot | PageSnapshot (via `runChangeDetection`, not caught by top-level grep) | no | outbound Firecrawl scrape (external read) | **observe-only per its own doc comment and code** — no autonomous action branch exists in this 27-line route | LIVE, class A |
| experiment-measure | `0 3 * * *` (~10pm ET) | mega-evening | app/api/cron/experiment-measure/route.ts:1-28 (full read) | resolves DUE experiments (accepted opportunities past horizon), scores each hypothesis, nudges the attributed source's `authScore` (bounded + reversible) | authScore nudge + feedback writes (via `resolveDueExperiments`, not caught by top-level grep) | H | none | **observe+learn only per its own doc comment and code** — no side-effect branch in this 28-line route | LIVE, class A |


---

## 2. DESTRUCTIVE / BULK jobs in detail

### 2.1 `data-cleanup` (`app/api/cron/data-cleanup/route.ts`, full file read, class A) — the primary nightly sweep

Nightly via mega-evening (`0 3 * * *`). Touches 17 tables in one run. **Real incident on record**:
`lib/brain/hard-delete-guard.ts:4-10` (full file read) quotes the exact receipt —

> `AuditEvent eventType="cron:data_cleanup_completed"`, 2026-08-28T07:01:07Z:
> "Pruned 55944 rows across 29 tables", `deletedByTable.brain_memories_gc = 54107`.
> Every neighbouring night: 187, 449, 505, 322, 281.

The predicate that caused it selected `expiresAt < now()` with no category filter and no
`deletedAt` filter — a live, operator-relevant `BrainMemory` row that merely picked up an
`expiresAt` (the file names `blind_spot`'s 24h probation-expiry stamp as a documented prior
instance of the same failure mode) was as eligible for hard-delete as disposable telemetry.

**The fix, quoted verbatim (`lib/brain/hard-delete-guard.ts:86-102`):**
```ts
export function judgeSweep(count: number, cap: number = MAX_HARD_DELETE_PER_SWEEP): SweepVerdict {
  if (!Number.isFinite(count) || count < 0) {
    return { allowed: false, count, cap, reason: `refusing to sweep on an invalid pre-count (${count})` };
  }
  if (count > cap) {
    return {
      allowed: false, count, cap,
      reason:
        `BLOCKED: sweep would hard-delete ${count} rows, over the ${cap} cap. ` +
        `Nothing was deleted. Inspect before raising the cap — on 2026-08-28 a sweep of this ` +
        `shape removed 54,107 rows behind a green "success".`,
    };
  }
  return { allowed: true, count, cap };
}
```
`MAX_HARD_DELETE_PER_SWEEP = 5_000` (`hard-delete-guard.ts:69`) — chosen deliberately above the
measured normal range (187-505/night) and far below the incident (54,107). Every sweep now
**counts first, then decides** — `data-cleanup/route.ts:82-90`:
```ts
const brainGcCandidates = await prisma.brainMemory.count({ where: brainGcWhere });
const brainGcVerdict = judgeSweep(brainGcCandidates);
if (!brainGcVerdict.allowed) {
  blockedSweeps.push({ ...brainGcVerdict, reason: `brain_memories_gc — ${brainGcVerdict.reason}` });
  deletedByTable.brain_memories_gc = 0;
} else {
  const brainGc = await prisma.brainMemory.deleteMany({ where: brainGcWhere });
  ...
```
A blocked sweep now files the whole cron run as **failed**, not a quiet zero
(`data-cleanup/route.ts:331-344`: `ok:false` when `blockedSweeps.length>0`, and
`resultCount: totalDeleted` — the file's own comment notes `cron_job_logs` "recorded NULL on
every run to date — including the night 54,107 rows were deleted," so visible volume is itself
part of the fix).

**Second, independent guard**: `NEVER_HARD_DELETE_CATEGORIES` (`hard-delete-guard.ts:37-63`) —
a static list of 21 durable/operator-facing categories (identity_snapshot, belief, wisdom,
insight, blind_spot, principle, reflection, decision_log, weekly_review, strategic_plan, etc.,
plus everything in `DURABLE_PERSONAL_CATEGORIES`) that are **never eligible regardless of
`expiresAt`**, and a `NOT: [{createdBy:"user"}, {source:"manual"}]` clause on the query itself.
Two independent guards "because one is a single point of failure" — the file's own words.

Beyond `brain_memories_gc`, the same count-then-judge pattern applies per-category to every row
in `BRAIN_MEMORY_RETENTION` (`data-cleanup/route.ts:148-176`), and 16 other tables are pruned
with fixed windows and **no cap at all** (SystemMetric 90d, ApiRequestLog 30d, ErrorLog 30d,
DeviceEvent 90d, LocalSyncLog 90d, AuditEvent tiered 14/60/90/180d, CronJobLog 30d
keeper-aware, StateLog 30d, SituationLog 90d, DeviceCommand-completed 30d, RecoveryActionLog 90d,
ReviewLog 365d, AgentTrace 30d, AutonomousEvent 90d, ToolVerbRatio 30d) — these are lower-risk
(operational telemetry, not personal-memory content) and were not the incident's locus, but they
share the same "no circuit breaker" shape the incident proved dangerous.

### 2.2 DUPLICATE finding: `cron-healer` runs a second, unguarded copy of the same sweep

`lib/services/autonomic-orchestrator.ts` Phase 4 (`:326-430`, read in full) — folded into
mega-evening under the **`cron-healer`** manifest name — independently deletes from
**`api_request_logs`, `error_logs`, `state_logs`, `agent_traces`, `system_metrics`,
`device_events`, `audit_events`, `cron_job_logs`** — the same eight tables `data-cleanup` already
prunes in the same fan-out slot, on the same night. Exact code:
```ts
const highVolumeTables = ["CronJobLog", "system_metrics", "AuditEvent", "api_request_logs", "error_logs", "agent_traces"];
const rowCounts = await prisma.$queryRaw<...>`SELECT relname, n_live_tup::int ... WHERE relname IN (${Prisma.join(highVolumeTables)})`;
const totalRows = rowCounts.reduce((sum, r) => sum + r.n_live_tup, 0);
const isAggressive = totalRows > 40000;
const pruneRetentionDays = isAggressive ? 7 : 30;
const metricsRetentionDays = isAggressive ? 30 : 90;
...
const requestLogs = await prisma.apiRequestLog.deleteMany({ where: { createdAt: { lt: daysAgo(pruneRetentionDays) } } });
```
Three concrete problems, all class A (direct read):
1. **No `judgeSweep`/cap** — this second sweep was never touched by the 2026-09-01 hardening that
   protects `data-cleanup`'s `brain_memories_gc`. It shares the exact "unguarded deleteMany on a
   count-derived window" shape the incident proved dangerous, just on lower-sensitivity tables.
2. **Silent retention override** — when the watched tables exceed 40,000 live rows combined, this
   sweep drops `api_request_logs`/`error_logs`/`state_logs`/`agent_traces`/`cron_job_logs`
   retention from `data-cleanup`'s documented 30d down to **7d**, and
   `system_metrics`/`device_events` from 90d to **30d** — a second, undocumented retention policy
   for the same tables, decided by a row-count heuristic nowhere near `config/retention.ts`
   (the file `data-cleanup` itself reads for its own `BRAIN_MEMORY_RETENTION` policy).
3. **Misattributed audit trail** — the completion row this sweep writes literally claims to be
   the other cron: `autonomic-orchestrator.ts:417-427`:
   ```ts
   await prisma.auditEvent.create({
     data: {
       actor: "cron:data-cleanup",
       eventType: "cron:data_cleanup_completed",
       detail: `Pruned ${result.prunedLogsCount} rows`,
       ...
   ```
   Any forensic query for `actor:"cron:data-cleanup"` or `eventType:"cron:data_cleanup_completed"`
   — including the exact query the hard-delete-guard header itself recommends for auditing this
   class of incident — will silently conflate rows deleted by `cron-healer` with rows deleted by
   `data-cleanup`, understating how many independent code paths can delete from these tables.

**Classification: DUPLICATE**, and the more consequential of the two copies (no cap) is the one
riding the informal-sounding "healer" name rather than the name that already earned hardening
after an incident. Recommend: either delete Phase 4 from `autonomic-orchestrator.ts` (data-cleanup
already owns this responsibility) or route it through the same `judgeSweep`/`NEVER_HARD_DELETE_CATEGORIES`
guards and fix the actor string.

### 2.3 `consolidate` -> `pruneNoise()` — a second real incident, already fixed once

`lib/brain/memory-consolidation.ts:242-326` (full read). Header comment documents its own prior
incident, separate from 2.1/2.2:

> TTL expiry now SOFT-deletes. It hard-deleted until 2026-08-16, and that is where the distilled
> content went: of 4,867 memories found surviving only as orphaned embeddings, the largest
> categories were `insight` (1,046), `nick_advice` (648), `wisdom` (254) and `blind_spot` (249) —
> none of which are "temporary memories."

Current state (fixed): TTL-expiry and low-confidence pruning both write `deletedAt` (soft, via
`updateMany`), not `delete`. The ONLY hard-delete remaining in this function targets exact-duplicate
`action_frequency` rows, bounded `take:500`, and drops the row's embedding alongside it so nothing
orphans:
```ts
const expired = await prisma.brainMemory.updateMany({
  where: { expiresAt: { lt: new Date() }, deletedAt: null }, data: { deletedAt: new Date() },
});
...
await prisma.brainMemory.delete({ where: { id: f.id } });
await dropEmbeddingsForMemories([f.id], "pruneNoise.duplicate");
```
`consolidate` is also one of the two `DETACHED_CHILDREN` in the mega fan-out (Section 0.1) —
its own timeout/failure is invisible to the parent past a 10s start-ack.

Same route also runs `runSemanticDedup({ dryRun: process.env.SEMANTIC_DEDUP_LIVE !== "1" })` —
**dry-run by default** (`app/api/cron/consolidate/route.ts:51-61`, class A code / I runtime env
value); live mode hard-deletes near-duplicate memories at pgvector cosine >=0.95, capped 100/run,
soft-deletes excluded from candidacy (`lib/brain/semantic-dedup.ts:252-273,351-367`).

### 2.4 "Stale-data purge" — mostly a MANUAL action, not a cron

`lib/system/stale-data-purger.ts` (full read) defines **8** category purgers
(`drift_alerts_unresolved_14d`, `pending_actions_7d`, `skill_candidates_30d`,
`open_contradictions_60d`, `abandoned_tasks_30d`, `orphan_conversations`,
`overdue_decisions_reviews`, `ancient_device_events`). **Only `pending_actions_7d` is called from
a cron** (`data-cleanup/route.ts:140`, `purgeStaleCategory("pending_actions_7d")` — a `updateMany`
status flip to `rejected`, never a delete). The other 7, plus the `purgeAllStale()` batch-runner,
are reachable only from `app/api/system/stale-data/purge/route.ts` and the tRPC
`system` router (`lib/trpc/routers/system/schema.ts`) — **operator-tap UI actions, not scheduled**
(class A absence: grep for `purgeStaleCategory\|purgeAllStale` across `app/` + `lib/` returns
exactly those three call sites, none inside `app/api/cron/`). Most purgers are non-destructive by
design (status flips, content-rewrite-to-"dismissed", archive) — the one hard-delete
(`purgeOrphanConvos`, 1-2-message conversations idle 24h+) uses a snapshot-then-re-verify
`$transaction` specifically to close a TOCTOU race the file documents fixing (v11.2 D4).

### 2.5 Non-destructive jobs confirmed safe by direct read

- **`xp-decay`** (`app/api/cron/xp-decay/route.ts`, full read) — never deletes; writes a
  **negative-XP** `BrainMemory` event row, idempotent per `decay:<stat>:<dayKey>` key
  (P2002 caught as the happy path). Fully reversible by deleting the event row.
- **`inbox-janitor`** (full read) — soft-delete only (`deletedAt` + status `PAUSED`), 3-of-3 reap
  criteria re-verified per-row immediately before the write.
- **`task-resurface`** / **`stale-tasks`** (both full read) — status flips only
  (`WAITING`->`READY`, `driftRisk+1`), both capped `take:100`/run.
- **`embed-backfill`** — additive only (creates `VectorEmbedding` rows), every source-type query
  capped (`take:200-500` read, `slice(0,15)` write batch per type).
- **`distill-sessions`** / **`conversation-compile`** — additive only (BrainMemory/
  ConversationSummary), batch-capped at 10 conversations/run each, one LLM call per item.

### 2.6 "Retire-stale devices" — NOT FOUND

No cron retires `Device` rows. Corpus searched: `grep -rn "retire" app/api/cron lib/services
lib/system` (repo-wide) returns only comment text about Ollama *model* retirement
(`ollama-model-liveness`) and ADR/migration retirement language — zero hits for a device-retiring
job. `DeviceEvent` (event *log* rows, not device records) is pruned by `data-cleanup` (90d) and by
the manual `ancient_device_events` purger (180d, UI-only, effectively unreachable since the 90d
cron already clears rows before they'd hit 180d). **Classification: DEAD/absent**, not merely
dormant — there is no code implementing "retire a stale device," gated or not.

### 2.7 `subtask-usage-audit` — filesystem deletes that never touch source (see Table 1c/HYGIENE)

Deletes `docs/adr/0017-task-subtasks-semantics.md` and a migration directory via
`fs.unlinkSync`/`fs.rmSync` on the CONTAINER filesystem, nightly, once `justified` is false. Full
detail and the positive-control proof that this has been a no-op against the actual repo for 70+
days is in the HYGIENE table above — repeated here only as a pointer since it is a genuinely
destructive *file* action, just not a *data* one.

---

## 3. PROACTIVE / NOTIFYING jobs — every job that can push to the operator

Two distinct transports exist, and **only one of them has flood control.**

### 3.1 Web push (`sendPush`, `lib/notifications/push.ts`, full file read) — HAS flood control

This is the channel the 2026-08-20 storm fix targeted. Quoted from the file's own incident note
(`push.ts:69-82`):

> On 2026-08-20 the cron-healer recursion (#1735) sent the operator 2,279 CRITICAL pushes in ~5.5
> hours (1,240x "Rescued ingest-reviews", 1,039x "Rescued ollama-model-liveness"), against a normal
> baseline of 2-3 pushes/day. Content dedup could not have caught it — the bodies differ per run
> ("duration: 54608ms" vs "54415ms"). So the transport now rate-limits per tag.

**Per-tag cooldown by level** (`push.ts:84-96`):
```ts
export const PUSH_COOLDOWN_BY_LEVEL: Record<NotificationLevel, number> = {
  critical: 30 * 60 * 1000,
  high:     60 * 60 * 1000,
  medium:  120 * 60 * 1000,
  low:     120 * 60 * 1000,
};
export function resolveCooldownMs(payload): number {
  if (payload.cooldownMs !== undefined) return Math.max(0, payload.cooldownMs);
  if (!payload.tag) return 0;
  return PUSH_COOLDOWN_BY_LEVEL[payload.level] ?? 0;
}
```
`cooldownMs: 0` is an explicit **lead exemption** — the type comment says "Explicit 0 = never
suppress (leads)" (`push.ts:61`). A tag that pushed within its cooldown is suppressed and the
suppression itself is logged as an `AuditEvent(eventType:"push_suppressed")`
(`push.ts:200-208`) — silence is visible in `/system/events`, never invisible. The check
**fails open**: "Failure of the check itself falls through to sending: flood control must never
become a reason a real page went missing" (`push.ts:183-187`).

**Quiet hours + peak-block** (`push.ts:166-181`, ET clock):
```ts
if ((hour >= 21 || hour < 7) && (payload.level === "low" || payload.level === "medium")) {
  return { sent: 0, failed: 0 };               // 9pm-7am ET: no low/medium
}
if (hour >= 8 && hour < 11 && payload.level === "low") {
  return { sent: 0, failed: 0 };                // 8-11am ET: no low unless critical
}
```
**Web-push TTL per level** (`push.ts:104-115`) — critical 4h/high urgency, high 12h/high urgency,
medium/low 24h/normal-or-low urgency. Pre-2026-08-20 nothing was set and the Web Push default (4
WEEKS) applied, so a queued "critical" alert could deliver days after it stopped being true.

`recordCoachEvent` (`lib/services/coach-events.ts:190-192`) routes into `sendPush` — so **every
CoachEvent-based alert inherits this whole flood-control stack automatically**. This is the
majority of the matrix's "external FX: CoachEvent" rows (data-source-health, correlation-alarm,
creation-spike-detect, cost-slo-check, decision-quality-drift, pricing-advisory, os-snapshot,
stale-tasks, goal-pruner, goal-drift-detector, quality-bench-weekly, suggestion-improve-weekly,
cron-healer's success path).

### 3.2 Telegram (`sendTelegram`, `lib/services/telegram.ts`, full file read) — HAS NO flood control

`sendTelegram()` is a raw `fetch()` to the Telegram Bot API with a 5s timeout and no cooldown, no
quiet hours, no TTL, no per-tag suppression, no audit row on send OR suppress — none of the
mechanisms in 3.1 apply here, because they live entirely inside `push.ts`, a sibling module
`telegram.ts` never imports. **Confirmed by direct read of the whole 203-line file: zero matches
for cooldown/suppress/quiet/dedup/TTL.**

Routes/functions confirmed calling `sendTelegram` directly (bypassing 3.1's protections entirely):
`task-resurface`, `ingest-gmail`, `ollama-model-liveness`, `nick-action-proposal`,
`nick-action-execute` (both success digest and its own failure alert), `cost-slo-check` (in
addition to its CoachEvent), `relationship-birthday`, `relationship-digest` (dormant),
`journal-checkin`, `inngest-liveness`, `outbox-drain`, `crm-weekly-followups`, `deep-research`,
`bulk-sms-approval`, `quality-bench-weekly`, `intelligence-daily/weekly-brief`,
`morning-brief` (operator-morning-brief), plus the two cross-cutting handlers **every Inngest
function and the whole mega fan-out share**:
- `onInngestFailure` (`lib/inngest/on-failure.ts`, full read) — fires a raw `sendTelegram` after
  EVERY Inngest function exhausts its retries, for all 26 functions (all wire `onFailure` per a
  repo-wide grep — 26/26 `createFunction` sites have `onFailure`). No per-function cooldown; if N
  different functions fail on the same bad deploy, N separate unthrottled Telegram messages send.
  Bounded in practice by function count and retry-exhaustion latency, not by design.
- `cron-healer`'s heal-**failure** path (`autonomic-orchestrator.ts:133-148`) calls `sendTelegram`
  directly, in addition to its `recordCoachEvent` call — this specific line is the one part of
  cron-healer's alerting that is NOT flood-controlled, though the recursion guard (Section 0/2.2)
  that caused the original storm has since been fixed at the trigger level (mega/mega-evening can
  no longer re-heal themselves), so the residual exposure is smaller than it was in the incident.

**Net finding**: the 2026-08-20 fix closed the flood-control gap for ONE channel (web push /
CoachEvent) and for the ONE specific recursion bug that caused the storm, but roughly 15+ call
sites across cron routes and Inngest functions still send raw, unthrottled Telegram messages. A
future bug shaped differently from the 2026-08-20 recursion — e.g., a tight retry loop inside a
single Inngest function, or a cron whose own idempotency guard breaks so it re-sends every
15-minute worker tick — would not be caught by `PUSH_COOLDOWN_BY_LEVEL` at all, because that code
path is never reached. **Recommend**: route `sendTelegram` calls in cron/Inngest failure paths
through `resolveCooldownMs`/an equivalent tag-cooldown wrapper, or fold Telegram into `sendPush`'s
existing gate.

### 3.3 Cadence summary of every job that can reach the operator

| Channel | Cadence-of-trigger range | Flood control | Quiet hours | Kill switch |
|---|---|---|---|---|
| Web push via CoachEvent | hourly (automation-engine, proactive-push-cron) down to weekly | YES (3.1) | YES (9pm-7am ET low/med off; 8-11am ET low off) | per-cron (Section 0.7) + the CoachEvent/push code path itself has no separate switch beyond that |
| Direct Telegram | */5min (approval-sweeper's *own actions*, not messaging) down to weekly; most-frequent actual Telegram sender is `outbox-drain`/`brain-bus-drain` at */15min (though their own doc/route text doesn't confirm they messages on every tick — only on findings) | **NO** | **NO** | per-cron (Section 0.7) only |
| Real email (Resend) | weekly (`weekly-digest`) | N/A (weekly cadence, single recipient, graceful no-op if unconfigured) | N/A | per-cron |
| Real SMS to customers | on operator approval only (`approval-sweeper` durability net, `shop.sendSms` via guardian) | N/A — gated by human approval, not cadence | N/A | `ApprovalRequest.expiresAt` + 48h `ageFloor` (Section 4) |

---

## 4. AUTONOMY jobs — what they can do without a human, and what stops them

Three separate autonomy "queues" exist in this codebase, each with its own model and its own drain
policy. They are easy to conflate; treated separately below.

### 4.1 `AutonomousAction` queue — Nick Action Queue (Wave AG)

Producers: `nick-action-proposal` (cron, 8am UTC via mega-morning), `nick-event-triggers`
(Inngest event fn, real-time). Consumers: `nick-action-execute` (cron, 9am UTC) and
`nick-action-approved` (Inngest event fn, fires the moment `/qa` approval lands — cuts up to 23h
of latency per its own file comment).

- **What it can propose without a human**: 3-6 actions/day — SMS outreach, mission archive, task
  move, journal commit, AI-spend confirm (`config/crons.ts:916`). All land as
  `AutonomousAction(approval:"pending")` rows — writing the row is the ONLY unattended action.
- **Approval required**: operator taps approve/reject via Telegram `/qa` inline buttons or
  `/system/actions`. Confirmed by direct read of `execute-actions.ts` that even after approval AND
  execution, `send_sms_outreach` is **draft-only** — it writes a BrainMemory row
  (`RELATIONSHIPS_OUTREACH` category) with `sent:false` and never calls an outbound SMS API
  (`lib/ai/execute-actions.ts:251-299`). The other five action types (`archive_mission`,
  `nudge_task`, `commit_journal`, `reassign_task`, `confirm_spend`) were not individually traced to
  this depth (H) but share the same execute-actions.ts dispatch table and the same
  approval-gate precondition.
- **Approval-queue drain**: `data-cleanup` calls `purgeStaleCategory("pending_actions_7d")` every
  night (`lib/system/stale-data-purger.ts:73-91`) — pending >7d auto-flips to
  `approval:"rejected", approvedBy:"auto-purge"`. This is a **status flip, never a delete** — the
  row and its full history stay queryable. The 7d window is explicitly load-bearing: "since
  2026-08-12 the nightly data-cleanup cron runs this too... changing the window changes how long
  the operator gets to review a pending action" (file comment). This is the fix for the
  "468-row pending backlog" incident named in `config/crons.ts:506`.
- **Idempotency**: one `BrainMemory(NICK_ACTION_RESULTS, key=today)` row per day guards
  `nick-action-execute` against double-running the whole batch (`nick-action-execute/route.ts:82-100`).

### 4.2 `ApprovalRequest` queue — chat tool-call guardian (a DIFFERENT model, real execution power)

Producer: `lib/tools/guardian.ts`'s `withGuardian()` wrapper, invoked when the chat AI proposes a
risky tool call — sets `status:"pending_approval"`. Consumer/drain:
**`approval-sweeper`** (Inngest, `*/5 * * * *`, full file read) — the durability backstop that
re-fires `approved` or stuck-`executing` rows via `executeApprovedToolAsync`.

- **This is the one queue in the matrix with confirmed REAL external-execution power**: the
  file's own 2026-07-09 hardening comment names it explicitly — "including real customer SMS
  (audit-todays-leads writes `shop.sendSms` approvals the third-tier dispatch CAN NOW SEND)."
  `lib/tools/guardian.ts:128` confirms a "third tier: `executeActionWithoutTracing` for unmapped
  cross-system tools (like `shop.sendSms`)".
- **Guard against the queue itself being the blast radius**: on first deploy (or any restart) the
  sweeper does NOT resurrect every historically-stuck `approved` row — it is bounded by
  `expiresAt > now()` (rows expire 24h default / 2h high-critical, per the file's comment) AND a
  hard `createdAt > now()-48h` `ageFloor` "belt+suspenders for legacy rows created before
  `expiresAt` existed" (`approval-sweeper.ts:23-31`, quoted in full):
  ```ts
  const ageFloor = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const requests = await prisma.approvalRequest.findMany({
    where: {
      expiresAt: { gt: now }, createdAt: { gt: ageFloor },
      OR: [{ status: "approved" }, { status: "executing", updatedAt: { lt: staleTime } }],
    },
    take: 10,
  });
  ```
- **Claim-then-execute is atomic**: `executeApprovedToolAsync` flips status to `"executing"`
  before dispatch (`guardian.ts:87`), so the 5-min sweep and a direct operator-approval trigger
  cannot double-execute the same row.
- **No explicit auto-purge/expire job found for stale `pending`, never-approved `ApprovalRequest`
  rows** — the sweeper only acts on `approved`/stale-`executing`; a request the operator never
  approves and never rejects simply ages past its own `expiresAt` and stops being sweeper-eligible,
  but nothing was found that deletes or archives it afterward (H — not exhaustively traced beyond
  the sweeper + `lib/ai/runtime/approval-gate.ts`, which was not read in full given scope).

### 4.3 `Commitment(status:"proposed")` — NOT a scheduled job

Grep-confirmed (class A): `proposeCommitment()` (`lib/services/commitments.ts:94-129`) is called
from exactly one call site, `lib/brain/journal-brain.ts:486-487` — inline journal-processing logic
triggered by a journal entry being captured/processed, **not a cron or Inngest function**.
Idempotent per `sourceRef` (find-then-create). Requires an explicit operator action
(`acceptCommitment`/`dismissProposed`) to leave the `proposed` state. **No automatic drain found**:
`data-cleanup`'s commitment-expiry sweep (`data-cleanup/route.ts:100-107`) only targets
`status: { in: ["active","in_progress"] }` — `"proposed"` is not in that list, so a proposed
commitment the operator never acts on has no observed expiry path in this codebase (H — absence
claim scoped to `app/api/cron/data-cleanup` + `lib/system/stale-data-purger.ts`; a drain elsewhere
was not ruled out exhaustively).

### 4.4 `autonomous-engine` — the ~20-rule proactive engine (folded into mega-evening)

Fully covered in Table 1c/ACTION and worth restating here as the autonomy section's centerpiece:
**fail-closed since v10.0.157** — a rule with no seeded `AutomationPolicy` row defers to
`approval:"pending"` rather than auto-firing (the route's own comment cites 14 days of prod
evidence: unseeded rules produced zero auto-executions). The route pre-flight-checks its own 20
"outward" rules against the policy registry and **reports any ungated rule in its own HTTP
response** (`approvalGate: "UNGATED: ..."` vs `"all outward rules pending-gated"`) — an unusually
strong self-auditing pattern. Exactly one rule (`auto_followup_expired_quote`) reaches a real
customer (email); it is explicitly called out in-code as "highest risk" and must always carry
`approvalClass="pending"`.

### 4.5 Shadow/observe-only jobs (no execution arm at all)

`change-detection` and `experiment-measure` (Table 1c/ACTION, both full file reads) are the
cleanest "observe-only" examples in the matrix — their route files contain no side-effect branch
whatsoever, just a scrape/score-and-write. `nick-event-triggers` (Table 1b) is a fail-closed
real-time proposer that writes exactly one `AutonomousAction(pending)` row and stops — no shadow
*mode flag* is needed because the code has no execution path to gate in the first place.

### 4.6 Summary: approval models are not interchangeable

| Model | Table | Producers | Drain/expiry | Real external power confirmed? |
|---|---|---|---|---|
| Nick Action Queue | `AutonomousAction` | nick-action-proposal, nick-event-triggers | auto-reject pending>7d (data-cleanup, nightly) | NO — `send_sms_outreach` is draft-only |
| Chat tool-call guardian | `ApprovalRequest` | `withGuardian()` (any risky chat tool call) | sweeper acts on approved/stuck-executing only; no purge found for stale never-approved rows | **YES** — confirmed `shop.sendSms` real-customer-SMS path |
| Journal commitments | `Commitment` | `proposeCommitment()` (journal-brain, not a cron) | none found for `status:"proposed"` | N/A (not an execution queue) |
| Autonomous engine rules | n/a (in-memory rule set + `AutomationPolicy`) | autonomous-engine cron | fail-closed default; policy seed script exists | one rule (email to real customer), gated |

---

## 5. The worker (`apps/worker/src/*`) — full read of all three source files

Three files total: `index.ts` (213 ln), `scheduler.ts` (465 ln), `storage.ts` (not read in full,
S3/local-fs upload helper referenced by the render loop — out of scope for a jobs audit).
**No DB client anywhere** — confirmed by the app's own `AGENTS.md`: dependencies are exactly
`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@nour/reel-engine`, `express`,
`node-cron`; every read/write crosses authenticated HTTP to statenour-web.

### 5.1 What it schedules (node-cron, in-process)

`HIGH_FREQ_JOBS` (`scheduler.ts:120-158`, full read) registers exactly three forwarded jobs:
`brain-bus-drain` (`*/15 * * * *`), `outbox-drain` (`*/15 * * * *`), `inngest-liveness`
(`0 13 * * *`) — plus the Remotion render-poll task (`RENDER_SCHEDULE = "*/15 * * * *"`,
`scheduler.ts:166-176`, registered separately at `:410-419`). Each forwarded job is a
`GET ${STATENOUR_WEB_URL}/api/cron/<name>` with `Authorization: Bearer ${CRON_SECRET}`, a 60s
`FORWARD_TIMEOUT_MS`, and a per-job overlap guard (`inFlightForwards` Set — a slow forward causes
the NEXT tick to skip rather than stack a second concurrent call against the same route,
`scheduler.ts:378-385`). **`mega`/`mega-evening` are NOT in this list** — see Section 0.2/6.

### 5.2 Auth to statenour: secret header, constant-time compare — confirmed

`Authorization: Bearer ${CRON_SECRET}` (`scheduler.ts:331`, `forwardCronToWeb`) on every forward.
Received side: `requireCronAuth` (`lib/auth-guard.ts:47-52`) uses `safeEqual` (`node:crypto`
`timingSafeEqual`, length-checked first to avoid a length-mismatch throw). The worker's own
inbound endpoints (`POST /cron/mega`, `POST /cron/mega-evening`) are equally guarded —
`requireCronSecret` (`index.ts:53-67`) length-checks then `timingSafeEqual`s. **Both processes
fail closed on an empty secret**: the worker calls `process.exit(1)` at boot if `CRON_SECRET` is
unset (`index.ts:42-49`); statenour's guard throws 401 on any mismatch including blank-vs-blank.
Confirmed constant-time and confirmed not spoofable by a timing side-channel on length.

### 5.3 The Remotion render loop

`processVideoRenders()` (`scheduler.ts:183-308`, full read): polls
`GET /api/sync/queue/render` on statenour-web for an approved draft, renders locally via
`renderReelVideo()` from `@nour/reel-engine` (Remotion), uploads the MP4 via `storage.ts`
(S3+CloudFront, or a local-fs fallback when `S3_BUCKET` is unset), then
`POST /api/sync/queue/render-complete`. On any render/upload exception it explicitly resets the
queue item back to `approved` (`POST /api/sync/queue` `{action:"approve"}`) so a crash mid-render
doesn't strand the item — a real retry-safety design, not just a try/catch swallow. Guarded against
overlapping runs by a module-level `isRendering` boolean checked at the top of the function.

### 5.4 The `/api/sync/queue/render` poll story — Neon compute never suspends (RESOLVED)

This is a documented, already-fixed incident, not a live risk — but the audit was specifically
asked for the story. `scheduler.ts:393-409` (full read):

> WAS `*/2`. That 2-minute poll was the single largest line item on the Neon bill and it bought
> nothing: the render queue receives roughly one reel a day, so 719 of every 720 daily polls found
> an empty queue. Because every poll hits `/api/sync/queue/render` — which touches Postgres — and
> Neon suspends an idle compute after 5 minutes, a 2-minute tick meant the database could NEVER
> scale to zero. Measured 2026-08-19: `active_time` 443.7h out of ~456h elapsed (97% awake), 222.6
> CU-h by day 19 against the 300 CU-h Launch allowance — which tipped the project into read-only
> and silently broke every write in the app.

Fixed by moving the poll from `*/2` to `*/15` (matches the sibling forward loops; still inside the
30-minute `RENDER_LEASE_MINUTES` so a lease survives two claim attempts). This is the same Neon
read-only incident the operator's memory index already tracks
(`statenour-neon-readonly-and-ingest-reviews-2026-08-19.md`), now traced to its exact root cause
in code: **a health-poll cadence, not a workload spike, kept the compute permanently warm and
burned the CU-hour allowance.** Cost of the fix, stated in the same comment: "a queued reel waits
at most ~13 minutes longer to start rendering" — an explicit, accepted trade-off, not an oversight.

### 5.5 `/health` vs `/health/scheduler` — a liveness/readiness split worth naming

`index.ts:69-143` (full read): `/health` is **unconditionally 200** whenever the process can serve
— it is the Railway `healthcheckPath` target and deliberately never gates on scheduler freshness,
because (the file's own reasoning, preserved) restarting cannot repair a stalled `lastTickAt`
counter (a fresh process resets it to 0) and a boot-grace state that reads unhealthy would
crashloop the very first probe after every restart. Scheduler staleness is a **diagnostic**
surfaced in `/health`'s body and gated separately at `GET /health/scheduler` (503 when stale),
which "nothing restarts on" per the file's comment — this endpoint exists for human/alert
consumption, not container orchestration. The staleness window itself is **derived, not a
literal**: `deriveStaleWindowMs()` (`scheduler.ts:105-113`) takes the fastest schedule in
`TICK_WRITING_SCHEDULES` and applies `(fastest*2+5)` minutes — this itself is the fix for a
documented prior incident where a hardcoded 5-minute window went stale when the render cadence
moved from */2 to */15, making `/health` report "stalled" for 10 of every 15 healthy minutes.

---

## 6. Legacy, dark routes, and the post-fix semantics of the three named watchdogs

### 6.1 `/api/cron/mega` — legacy status is nuanced, not simply "replaced"

`app/api/cron/mega/route.ts` is called "legacy fan-out" throughout the codebase's own comments
(vs. the "Inngest re-implementation" in `mega-fanout.ts`), but per Section 0.3, the Inngest version
is a no-op unless `INNGEST_MEGA_V2==="true"` — so the "legacy" route is, as far as this snapshot's
code can prove, still the operative one (or the only one, if the flag is off). Nothing in this
audit could confirm which state prod is in (class I). **This is not a case of dead legacy code to
clean up** — treat it as live infrastructure until an operator confirms the flag's runtime value.

### 6.2 Routes reachable by an external scheduler but NOT in the manifest

`scripts/verify-crons.ts` (header read, full) runs 7 checks (not 6 — `config/crons.ts`'s own
header comment at line 32 says "`pnpm check:crons` [6/6] enforces," which is stale; the script
itself says "seven checks ([1/7]-[7/7])" — a small, harmless doc/code count drift, class A on both
sides). Checks 1-2 are the bidirectional manifest<->filesystem guard the task description
references. Given that guard, **only one route outside `app/api/cron/*` was found using the same
`CRON_SECRET`-gated auth** (`requireCronAuth`/`cronHandler`, repo-wide grep): `app/api/system/
env-check/route.ts` — an env-diagnostic endpoint, not a scheduled job, but reachable by anyone
holding `CRON_SECRET`. Not a manifest gap (it was never meant to be scheduled) but worth naming
since "reachable by an external scheduler" and "reachable by anyone with the cron secret" are the
same blast radius. Separately, `STATENOUR_SYNC_KEY` (a different secret) gates six more routes
(`api/devices/command/[id]`, `api/devices/queue`, `api/sync/gmail`, `api/sync/nour-os`,
`api/sync/session-reports`, `api/webhooks/nickstire`) — these are the worker/nickstire-bridge sync
surface, not cron routes, and out of this audit's scope, but a leaked `STATENOUR_SYNC_KEY` would
reach further than a leaked `CRON_SECRET` (it is also accepted as a `CRON_SECRET` alternative on
`/api/cron/mega` itself, `mega/route.ts:38-40`: `hasSyncKey` is checked as an OR alongside
`hasCronSecret`) — worth operator awareness even though it's not a jobs-matrix finding per se.

### 6.3 `cron-healer` semantics, post-fix (full read of `autonomic-orchestrator.ts` Phase 1)

The 2026-08-20 storm's root cause, restated precisely from the code (not just the memory index):
cron-healer ran INSIDE the mega-evening fan-out, and "healing" `mega`/`mega-evening` meant
re-entering the very orchestrator that was doing the healing — mutual recursion with no base case.
The fix is a hard path-equality skip, quoted (`autonomic-orchestrator.ts:66-71`):
```ts
const targetPath = row.path ?? `/api/cron/${row.name}`;
if (targetPath === "/api/cron/mega" || targetPath.startsWith("/api/cron/mega?")) {
  continue;
}
```
Exact-match/prefix-match on the real dispatch path, not a substring — the comment explicitly notes
a bare prefix check would also skip an unrelated future cron merely starting with "mega". Two
supporting fixes in the same block: `isFailing` now means "last run failed," not "failed at any
point in 14d" (a `fail14d>0` check kept re-healing already-green jobs, which is what produced the
"Rescued ingest-reviews... Status: 200" alert spam even before the recursion was the dominant
cause); and `isNeverRun` now correctly buckets `partial` status into the run-count, fixing a
classification bug where mega-evening's 1,248 all-`partial` runs in 14 days summed to
`success14d=0, fail14d=0` and were read as "never run" — healed every single pass, forever.
`MAX_HEAL_PER_RUN=3` caps the blast radius of any future variant of this bug. **Net: cron-healer
today can heal at most 3 individually-named non-mega children per run, once per day** (it is
folded into mega-evening, not standalone-scheduled). Its Phase 4 log-pruning sweep remains a live
duplicate-destructive-job concern independent of the healing logic — see Section 2.2.

### 6.4 `inngest-liveness` — confirmed to survive an Inngest outage by construction

`app/api/cron/inngest-liveness/route.ts` (88 ln) is fired by the **worker's** node-cron
(`scheduler.ts:154-157`, confirmed present in `HIGH_FREQ_JOBS`), not by Inngest itself — a
deliberate design so the "is Inngest alive at all" check runs on infrastructure that does not
depend on Inngest being alive. It reads `cron-heartbeat`'s self-row age (that row is written by an
Inngest-scheduled function, `cron-heartbeat.ts`, `0 12 * * *`) and pages Telegram (P0) if it's
stale or absent, one hour after the heartbeat's own slot. This is the one Section-3-style Telegram
alert this audit did not find any known suppression/duplicate risk for, since it fires at most
once/day by construction (worker cron, not retried on a tight loop).

### 6.5 `ollama-model-liveness` — confirmed calls the actual resolver, not a hardcoded probe list

`app/api/cron/ollama-model-liveness/route.ts` (partial read) calls `probeOllamaLanes` /
`summarizeLanes` from `lib/ai/model-liveness.ts` (not read in full — out of scope) which the
route's own doc comment says calls `resolveProviderModel` — "the same function a real turn uses" —
specifically so an env-var override (the failure mode that caused ~6 weeks of dead vision-lane
production traffic per the file's incident note) is exercised by the probe, not just the model
registry default. Alerts via raw `sendTelegram` (not flood-controlled, Section 3.2), with a 410
response called out specially as "retired forever, not retry" so the operator doesn't waste time
waiting on a model that will never come back.

---

## 7. Jobs that write `BrainMemory` (or other canonical personal-data tables) automatically

All rows/run figures are **class H** — derived from loop bounds / batch-cap constants read in the
code, not from measured runtime counts (this audit has no DB access; "202 memory writes in ~20h"
from Home cannot be reconciled to a specific job breakdown without `CronJobLog.resultCount` /
`BrainMemory` row timestamps, which are class I here).

| job | cadence | est. rows/run (H, derived from) | note |
|---|---|---|---|
| kept-word-scan | 1x/day | H — unbounded by code; scales with 24h chat volume x person count, no `take` cap observed in the route (delegates to `scanKeptWords`, not independently re-verified) | Likely the highest-variance writer in the list — "silent, no Telegram" per its own doc comment |
| distill-sessions | 1x/day | 0-10 (`distillIdleSessions(10)` batch cap, confirmed) + 1 for `nick_current_concerns` rolling aggregate | One `chat_summary` row per distilled conversation |
| ingest-reviews | 1x/day | 0-5 (H — Google Places returns at most 5 most-recent reviews per place, per crons.ts:308 comment; not independently re-verified against the Places client) | |
| xp-decay | 1x/day | 0-N where N = distinct stat categories with >=`MIN_LOSS`(1) XP decay that day (confirmed loop bound: `for (const [stat, xp] of totals)`) — mastery stat taxonomies are typically small (single digits to low tens), not independently counted here | Idempotent per stat/day |
| mastery-xp | 1x/day (DETACHED child) | H — "attributes the day's chat/captures/decisions," no cap observed in the 41-line route (delegates) | |
| goal-pruner (inngest) | 1x/day | H — `updateMany` (bulk) + `upsert` (H: 1, a summary row) | |
| refresh-identity | 1x/day | H — 2 (current snapshot + daily history row, per crons.ts:704 description) | |
| anticipate | 1x/day | 1 (upsert key `anticipated_<date>`, confirmed idempotent-per-day) | |
| tool-description-rewrite | 1x/day | 0-3 (confirmed cap, crons.ts:405 "≤3 tools/run") | Drafts only |
| outcome-harvest | 1x/week | 1 (rolling upsert, confirmed pattern) | |
| pricing-advisory | 1x/week | 1 (upsert per run-date, confirmed pattern) | |
| relationship-weekly-synthesis | 1x/week | H — 1 (single synthesis row per the "3-paragraph synthesis" description) | |
| calibration-generator | 1x/day | H — `updateMany` (bulk status flip) + `CalibrationReviewItem.upsert` (H, per-item) | |
| cost-slo-check | 1x/day | H — 1 (a threshold-breach record) | |
| brain-intelligence | 1x/day (folded) | H — `update` (bulk-shaped, not enumerated) | |
| cron-heartbeat (inngest) | 1x/day | 1 (confirmed — the self-row IS the mechanism) | |
| suggestion-improve-weekly (inngest) | 1x/week | H — not grep-caught at this file (delegates); crons.ts says `suggestion_hypothesis` | |
| industry-pull (inngest) | 1x/day | H — not grep-caught (delegates); RSS-feed-shaped, likely small-N per run | |
| content-performance-weekly (inngest) | 1x/week | H — 1 (upsert, confirmed pattern) | |
| morning-brief / operator-morning-brief (inngest) | 1x/day | H — 1 delete (cache invalidation) + 1 upsert (fresh cache row) | Cache row, arguably not "canonical personal data" |
| intelligence-daily/weekly-brief (inngest) | 1x/day + 1x/week | 1 `BrainMemory.delete` (cache) + 1 `BriefingLog.create` (a different table, but canonical) per run | |
| reflect-categories | 1x/week | H — "writes operator-facing reflection rows," not grep-caught at route level (delegates) | |

**Excluded from this list on purpose** (write to canonical tables OTHER than `BrainMemory`, or are
config/settings rows rather than personal-memory content): `dossier-autodraft`/
`greene-law-tag-refresh` write `PersonProfile`; `semantic-link` writes `SemanticEdge`;
`crm-weekly-followups` writes `Task`; `nick-action-proposal`/`nick-event-triggers` write
`AutonomousAction`; `os-snapshot` writes `SystemMetric`; `setCronEnabled`
(kill-switch toggles) writes `BrainMemory(category="cron_control")` but only on an explicit
operator settings action, never from a cron's own initiative.

**Destructive/pruning writers are covered in Section 2, not repeated here** — `data-cleanup` and
`consolidate`/`pruneNoise` both touch `BrainMemory` at far higher volume than anything in this
table, but as deletions/soft-deletions of existing rows, not new personal-data content.

---

## 8. Cost — jobs calling LLMs per run (derived from code, UNMEASURED at runtime)

Every figure below is class H unless marked A (a hard `take`/batch-size constant read directly in
code) or explicitly cited as an in-code cost estimate (class A quote of the comment, not a
verification of the dollar figure itself). No token counts, no per-call pricing, no live spend
data were available to this audit (class I for anything resembling an actual dollar total).

### 8.1 Confirmed LLM-calling jobs (`aiChat`/`tracedAiChat`/`generateText`/`generateObject` grep-confirmed at the route/function file)

| job | cadence | calls/run (best derivation) | class |
|---|---|---|---|
| distill-sessions | 1x/day | 0-10, hard-capped (`distillIdleSessions(10)`) | A (cap) / H (actual count varies with idle-session backlog) |
| conversation-compile | 1x/day | 0-10, hard-capped, AND gated by "the $5/day AI budget enforced pre-flight per call" (route comment, not independently verified against the budget-check code) | A (cap) / H (whether the budget ever actually throttles it) |
| ingest-gmail | 1x/day | H — no cap constant found in the 423-line route at this grep depth; scales with the day's unread/new-email volume across all connected accounts | H |
| mastery-xp | 1x/day (DETACHED) | H — "attributes the day's chat/captures/decisions," at least 1 call, likely more for a busy day; no cap constant found | H |
| dossier-autodraft | 1x/week (Monday) | H — drafts for "PersonProfile rows with stale dossiers" (crons.ts:822), i.e. potentially N calls where N = count of stale profiles that week; no cap constant found | H |
| relationship-weekly-synthesis | 1x/week | H — "3-paragraph synthesis," shape implies 1 call | H |
| relationship-picks-prewarm | 1x/day | H — idempotent/cached, likely 1 call on the first miss of the day, 0 on cache hits | H |
| relationship-digest | **dormant** | n/a — code path exists but never fires | A (dormant) |
| reflect-categories | 1x/week (Sunday-ET) | H — at least 1, plus a gated `NICK_REFLECTION_TREES` higher-order pass if that sub-flag is on | H |
| weekly-review | 1x/week | H — single `generateText` call site observed at line 188 of a 296-line file; likely 1 | H |
| quality-bench-weekly | 1x/week | **the only job with an explicit in-code cost estimate**: "$0.05-0.20/run" (`config/crons.ts:123`, class A quote — dollar figure itself not independently re-derived) | A (quote) |
| intelligence-daily-brief | 1x/day | H — "ingestion, claim verification, opportunity scoring, executive briefing" (crons.ts:184-189) is a multi-stage pipeline sharing one `generateText` call site with the weekly variant; plausibly several calls/run, not confirmed | H |
| intelligence-weekly-brief | 1x/week | H — shares the daily brief's code, same caveat | H |
| suggestion-improve-weekly | 1x/week | H — "runSuggestionImproveAgent," not grep-confirmed as LLM-calling at this file (delegates); crons.ts:126-134 describes it as a noise-analysis agent, which strongly implies at least 1 call | H |
| anticipate | 1x/day | H — "3 questions x 10s precompute timeout" (route comment) suggests up to ~4 calls (1 draft + up to 3 precompute), not confirmed as LLM vs. deterministic at this grep depth | H |

### 8.2 Embedding-model calls (a different cost category — not chat completions)

| job | cadence | calls/run (derived from batch constants, class A for the constants themselves) |
|---|---|---|
| embed-backfill | 2x/day | `BATCH_PER_TYPE=15` across 7 source types (brain_dump, reflection, situation_log, decision_replay, strategic_law, greene_law, chat_message) = up to 105, **plus** `BRAIN_BATCH=100` for BrainMemory itself = **up to ~205 embedding calls/run, up to ~410/day** (constants confirmed by direct read of `embed-backfill/route.ts:27-330`; whether every run actually hits the ceiling depends on how much unembedded content exists, which is class I) |

### 8.3 Grep-confirmed NON-LLM jobs worth stating explicitly (rules out a false-positive cost worry)

Direct import-level grep (not just function-body grep) confirms these have **no** AI/LLM import at
all: `crm-followups`, `industry-pull`, `content-performance-weekly`, `journal-convergence-scan`,
`journal-thread-dormancy`, `goal-drift-detector`, `goal-pruner`, `customer-preferences-recompute`,
`diagnose-cron-failure`, `audit-todays-leads` — class A (absence).

### 8.4 What a daily-cost estimate would need that this audit does not have

A real dollar/day figure requires: (a) confirmation of `INNGEST_MEGA_V2` and whether the legacy
`/api/cron/mega` route or the Inngest fan-out (or both) is actually firing (Section 0.3, class I),
(b) live token counts per call (this audit read code shape, not prompts/responses), (c) actual
daily volumes for the unbounded jobs (`ingest-gmail`, `mastery-xp`, `dossier-autodraft`) which this
audit could only bound at "no cap found," not "typically N." The one number the codebase asserts
about itself with a dollar sign — quality-bench-weekly's "$0.05-0.20/run" — is a single weekly job
and not representative of the other ~14 LLM-calling jobs in 8.1.

---

## 9. NOT VERIFIED — consolidated list (class I items across this whole report)

- Whether `INNGEST_MEGA_V2` is `"true"` in production (Section 0.3) — determines whether the
  Inngest fan-out or the legacy `/api/cron/mega` route (or, if misconfigured, both) is the live
  dispatcher for 51 of the manifest's dispatch slots.
- The existence/configuration of the external Railway Cron Job service that must be POSTing to
  the worker's `/cron/mega` and `/cron/mega-evening` endpoints (Section 0.2) — this audit found
  no code-level trigger for those two endpoints at all.
- Whether Google OAuth is configured in prod (gates all four ingest crons silently).
- Whether `RESEND_API_KEY` is set (gates `weekly-digest`'s actual email send vs. assemble-only).
- Whether `SEMANTIC_DEDUP_LIVE=1` is set (gates `consolidate`'s dedup pass from dry-run to live
  hard-delete).
- Whether the `AutomationPolicy` seed (`scripts/seed-policies.ts`) has been run against prod for
  `autonomous-engine`'s 20 outward rules — moot for safety (fail-closed default covers it) but
  relevant to whether `/system/policies` shows real intent metadata today.
- Live `CronJobLog` row counts/timestamps for every job — meaning every "LIVE" classification in
  this report describes **wiring**, not observed execution; the exact "17 silent crons" / "202
  memory writes" figures from Home could not be reconciled to specific jobs.
- Whether `subtask-usage-audit`'s DB gate (`Task.parentTaskId` live count) is currently 0 or
  positive — the file-delete branch's *code* was fully verified inert against source regardless
  (Section 2.7), but whether it is *attempting* the delete every night is a live-DB fact.
- Full behavioral trace of `bulk-sms-approval` and `social-publish` (both Inngest event-triggered,
  both touched real external channels per their trigger names) — scope did not extend to tracing
  what upstream code enqueues their triggering events.
- The dollar-cost figures in Section 8 beyond the single explicit "$0.05-0.20/run" code comment.

---

## STATUS: COMPLETE

All 8 deliverable sections written. Matrix covers all 77 `config/crons.ts` manifest entries
(19 top-of-file Inngest-native + 3 more `inngest:true` rows placed elsewhere in the file [
`automation-engine`, `operating-rhythm`, `neglect-penalty`] = 22 Inngest-native total, plus 55
route-based entries — counts verified by direct `grep -n "^    name:"` positive control, 77 total)
and all 26 non-barrel files in `lib/inngest/functions/*` (18 files hosting the 20 cron-triggered
functions that match the manifest [`intelligence-brief.ts` and `journal-convergence.ts` each host
2 functions] + `mega-fanout.ts`, already covered under the `mega`/`mega-evening` rows + 7 purely
event-triggered files not on the manifest by design, listed in Table 1b for completeness —
18+1+7=26, matches the filesystem count).
