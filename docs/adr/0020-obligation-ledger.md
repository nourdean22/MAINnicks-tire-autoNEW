# ADR-0020 · One obligation ledger for nickstire · `customer_promises` as the index, not a new kernel

> **Status**: Proposed (2026-09-30) · design note only, no code in this PR
> **Queue item**: Q-22 in [`docs/research/2026-09-23-estate-master-architecture.md`](../research/2026-09-23-estate-master-architecture.md)
> (§3 property 1, §6.5, row "Obligations" in §5, §14.4)
> **Builds on**: [`CUSTOMER-CORPUS-RESEARCH-2026-09-23.md`](../../apps/nickstire/docs/operations/CUSTOMER-CORPUS-RESEARCH-2026-09-23.md)
> Part D §7 ("extend the Promise Ledger; do not build a kernel"), and
> [`ADMIN-LOOPS-ARCHAEOLOGY-BOUNDARY-2026-09-01.md`](../../apps/nickstire/docs/ADMIN-LOOPS-ARCHAEOLOGY-BOUNDARY-2026-09-01.md)
> §3.2 (StateNour holds owner obligations; nickstire holds the records)
> **Protected core**: the phase 1 build is NOT protected core: it only reads `callback_requests`,
> `sms_response_jobs` and `emergency_requests` and writes `customer_promises`. Phase 2 adds a close
> path for `emergency_requests` (lead/callback persistence), and phase 3 retires alert paths; both are
> protected core and carry the targeted-test, compatibility and rollback notes.
> **Decision drivers**: 45 owed replies were past due at 13:47Z on 2026-09-23 (§1.4) · the same
> customer can be owed something in four stores that do not know about each other · three different
> SLA clocks and five alert paths, none of which say "this obligation is closed" in one place

---

## 1 · The answer

1. **No new table and no DDL in phase 1.** `customer_promises` (0102, UNIQUE
   `uq_promise_source (source_kind, source_id, promise_type)` from 0125, applied 2026-09-22) already
   has every column the unified ledger needs: owner, `due_at`, status, `kept_evidence`,
   `escalated_at`, `source_kind` / `source_id`. It becomes the **index** of everything the shop owes a
   customer. The operational stores stay where they are and stay authoritative for their own work.
2. Each open item in a source store gets exactly **one** ledger row, keyed by
   `(source_kind, source_id, promise_type)`. A re-run hits the unique index and writes nothing, so the
   mirror is idempotent by construction, not by a read-then-write.
3. **Closure follows the source.** When the source row reaches a closing state, the ledger row closes
   with evidence naming that row. Nothing is marked kept on an attempt, only on an outcome.
4. **One sweep escalates.** The existing `sweepOverduePromises` becomes the only place a breach is
   detected. `escalated_at` makes "one escalation per breach" durable across deploys, which the
   in-memory re-alert map in `humanPendingAlerts.ts` cannot be.
5. **One list.** The admin Today queue reads open obligations from the ledger, sorted by `due_at`,
   instead of assembling callbacks and owed texts from separate queries in the client.
6. Rollout: shadow mirror behind a flag (phase 1), then the read cutover (phase 2), then retiring the
   duplicate alert and queue paths one at a time (phase 3). Each phase exits on a measured criterion
   (§8).

## 2 · The premise, re-checked against `origin/main` at `809c2a1`

The queue row says "3 of 4 obligation kinds have no persisted lifecycle". That sentence is a
**conflation of two different sets of four**:

- The master document's §6.5 set is callbacks, spoken promises, owed texts, owner escalations.
- The research doc it cites (Part D §7) tested a different set: callback, rack check, status update,
  transfer recovery. The three with no row are rack check, status update and transfer recovery.

Against the §6.5 set, measured from code:

| Kind | Store | Lifecycle today | Due time | Close path | Escalation |
|---|---|---|---|---|---|
| Callback | `callback_requests` (`drizzle/schema.ts:635`) | enum `new → called / no-answer / completed` | **none stored**; five readers compute ages (2 h `routers/intelligence.ts:90`, 4 h `cron/jobs/crudAutomation.ts:215`, 4 h `cron/jobs/statenourSync.ts:385`, 24 h `cron/scheduler.ts:758`, 24 h `services/safetyMonitor.ts:332`) | admin `callback.updateStatus` (`routers/callback.ts:216`); hygiene closes stale rows as `no-answer` (`routers/admin/dashboard/dbCleanup.ts:110`) | Telegram at 4 h once per row, plus the customer "still in our queue" text (`crudAutomation.ts:244-266`) |
| Spoken promise | `customer_promises` (`services/promiseLedger.ts`) | open / kept / missed / cancelled | `due_at`, derived from shop hours (`voiceAgent.ts:473-486`) | admin Keep with evidence, Cancel; sweep marks `missed` after 48 h | Decision Inbox `promise_overdue`, **once per shop day** (`scheduler.ts:2025-2031`, `oncePerShopDay`) |
| Owed text | `sms_response_jobs`, `status = 'human_pending'` | `human_pending → human_replied / no_reply_required / ...` | `dueAt`, 30-minute SLA | a staff reply; `markNoReplyNeeded` (`client/src/pages/admin/OverviewSection.tsx:168, 382`) | Telegram every 15 min, re-alert at most hourly, **in memory** (`services/humanPendingAlerts.ts:31, 42`) |
| Owner escalation | none in nickstire | `escalateToOwner` is fire-and-forget to StateNour's Inbox (`services/ownerEscalation.ts:12`), by design (boundary doc §3.2) | carried as `deadline` | StateNour-side | StateNour Inbox |
| Emergency request | `emergency_requests` (`schema.ts:1955`) | `status` default `new`, **no writer ever changes it** (`routers/emergency.ts:137` inserts; no updater exists) | none | **none** | one Telegram at insert (`emergency.ts:197`) |

So the true picture is: three of the §6.5 kinds **do** have persisted lifecycles, each in its own
store with its own clock; the owner-escalation kind correctly lives in StateNour; and the one
nickstire-side escalation record, `emergency_requests`, has no lifecycle at all (3 rows open for
158-178 days per Part D §7). The problem is not missing lifecycles. It is **four clocks, five alert
paths and no shared "closed"**.

Two further corrections to earlier documents, recorded so they are not re-used:

- Part C #8 of the research doc ("`markNoReplyNeeded` has no client caller") is **stale**: the Today
  queue calls it at `OverviewSection.tsx:382`.
- The "Today" queue does not read `customer_promises` at all. `PromisesPanel` renders beside it
  (`OverviewSection.tsx:524`), and the Decision Inbox that receives `promise_overdue` was retired from
  that page on 2026-09-07 (`OverviewSection.tsx:464`). An overdue promise therefore surfaces only on
  the Follow-ups tab, once a day.
- Callbacks and overdue owed texts are **double-queued**: once in their store and again as
  `revenue_opportunities` rows (`sourceType` `callback` at `opportunityQueue.ts:1075`,
  `human_pending_sms` at `:1405`).

## 3 · Semantic contract

| Field | Value |
|---|---|
| TERM | obligation |
| DEFINITION | something the shop owes one identifiable customer by a derivable time, where silence past that time is a failure the customer can feel |
| SOURCE | `customer_promises`, one row per obligation; the source store holds the working record |
| GRAIN | one row per (source_kind, source_id, promise_type) |
| UNIT | count of open rows; overdue = open and `due_at < now` |
| OWNER | the `owner` column (`Front Counter` by default); the nickstire operator for the list |
| FRESHNESS | a mirrored row is at most one mirror cycle (15 min) behind its source; the parity check (§6) reports the lag instead of hiding it |
| VALID STATES | `open` (WAITING while `due_at` is ahead, ASSIGNED when `owner` is set), `kept` (outcome evidence), `missed`, `cancelled`; **escalated** is `escalated_at IS NOT NULL`, not a status, so a row can be open-and-escalated |

This maps §6.5's `open → done / escalated / broken` onto the existing columns: done = `kept`,
broken = `missed`, escalated = the stamp. No status value is added.

What is **not** an obligation here: a customer's request that nobody accepted (the intake row is the
record; the obligation starts when the shop owes a response to it, see §4), `voice_followups` (an
at-most-once dial log, `cron/jobs/followupCadence.ts`), and StateNour `open_loop` tasks (the
boundary doc keeps them in StateNour; mirroring them back would be a second owner for one fact).

## 4 · Kinds, keys and due times

`promise_type` is `VARCHAR(32)` and `source_kind` is `VARCHAR(24)`, so the new values need no DDL.
`PROMISE_TYPES` in `promiseLedger.ts` gains `reply` and `emergency_response`.

| Kind | `source_kind` | `source_id` | `promise_type` | Due time (derived, never invented) |
|---|---|---|---|---|
| Callback, web form / StateNour bridge / admin proposal | `callback_request` | `callback_requests.id` | `callback` | created while open: the earlier of `createdAt + 2 h` and that day's close; created while closed: next opening + 2 h |
| Callback, voice `escalate` / `scheduleCallback` | `voice` (unchanged) | Vapi call id (unchanged) | `callback` | unchanged: `nextCloseAt` (`voiceAgent.ts:480`) |
| Owed text | `owed_reply` | `sms_response_jobs.id` | `reply` | `sms_response_jobs.dueAt` (the existing SLA; the ledger does not start a second clock) |
| Emergency request | `emergency` | `emergency_requests.id` | `emergency_response` | created while open: `createdAt + 30 min`; created while closed: next opening + 30 min |
| Spoken / operator promise | `voice` / `operator` (unchanged) | unchanged | unchanged | unchanged |

Rules the mirror must hold:

1. **No due time, no row.** Same refusal as `createVoicePromise`: when shop hours cannot yield an
   instant, the mirror writes nothing and counts the item as `undatable` in its report. An invented
   deadline manufactures a breach the shop never agreed to. The "next opening" helper is
   `nextOpenAt` in `shared/shopState.ts:117`, which is module-private today; exporting it is an
   additive change.
2. **No double row for a voice callback.** `escalate` writes both a `callback_requests` row and a
   `voice` promise, and the two are not linked by id (the call id lives only in the callback row's
   `context` text). The mirror skips a callback row when a `voice` promise exists for the call id
   parsed from `context`; when none exists (the voice write was skipped for no call id or no due
   time), the mirror covers the row. Parsing `context` is a stopgap with a pinned test; a
   `callback_requests.vapi_call_id` column would replace it and is not proposed here.
3. **Only open source rows open a ledger row.** Callback `new`; owed text `human_pending`; emergency
   `new`. A source row created before the flag is armed is mirrored on the first run if it is still
   open and not older than 7 days; older rows are counted, not mirrored, so arming the flag does not
   turn months of history into a wall of "missed".

## 5 · Closure: outcome, never attempt

| Source transition | Ledger result | `kept_evidence` | Attestation class |
|---|---|---|---|
| callback `called` or `completed` | `kept` | `callback #<id> <status> by <calledBy> at <calledAt>` | OPERATOR-ATTESTED (a person pressed a button; the call itself is invisible to the system, research doc Part B "what the census still cannot see" item 4) |
| callback `no-answer` set by a person | stays `open` | — | an attempt is not an outcome; the operator can Keep with evidence ("left voicemail") |
| callback `no-answer` with the `[SYSTEM: Closed as stale]` note (`dbCleanup.ts:110`) | `cancelled` | `closed as stale by hygiene` | SYSTEM |
| owed text `human_replied` | `kept` | `staff reply accepted by gateway, job #<id>` | MEASURED at the "provider accepted" rung: `routers/smsConversations.ts:175` resolves on `result.success`, which is gateway acceptance, not delivery |
| owed text `no_reply_required` | `cancelled` | `marked no reply needed` | OPERATOR-ATTESTED |
| owed text `failed` / `dead` | stays `open` | — | a failed send is not a reply |
| emergency (phase 2 close path) | `kept` / `cancelled` | the operator's note | OPERATOR-ATTESTED |

`promiseLedgerStats` already excludes voice rows from the kept-rate because their only "kept" signal
is a button press. Extended: the kept-rate is reported **per kind with its attestation class**, and
only MEASURED kinds (today: owed texts, and only up to gateway acceptance) are called a rate. The others are reported as counts, the
same honesty rule `voicePromiseBacklog` applies.

## 6 · Mechanism

- **One reconciler, `obligationMirror`** (new service, phase 1). Per kind: a pure mapper from a
  source row to a ledger insert (due time, key, text) and a pure closer from a source state to a
  ledger transition. The effectful part runs `INSERT` and treats a duplicate-key error as "already
  mirrored" (`lib/dbErrors.isDuplicateKeyError`, the recogniser 0125 introduced), and closes rows with
  a compare-and-swap `UPDATE ... WHERE id = ? AND status = 'open'`, checking one affected row (the
  repo's `claim-before-act`; TiDB turns `SKIP LOCKED` into a non-locking read, research doc Part C
  #17).
- **It does not touch the source writers.** The four `callback_requests` writers
  (`routers/callback.ts:61`, `routers/voiceAgent.ts:416` and `:1194`, `_core/bridge-routes.ts:651`,
  `services/proposals.ts:118`) and the `sms_response_jobs` writer stay exactly as they are. A mirror
  that reads is the smallest change that covers all of them, including any future writer; editing
  each insert site would put a protected-core change in five places.
- **Cadence.** The mirror runs in the 15-minute pulse tier, beside `overdue-reply-alert`
  (`scheduler.ts:1201`). The 2-hour, once-per-shop-day tier that runs `promise-sweep` today is too slow
  for a 30-minute reply SLA. Escalation moves to the pulse tier with the mirror (phase 3); the 48-hour
  `missed` marking stays daily.
- **Parity check, every run.** Per kind: open in source, open in ledger, mirrored this run, closed
  this run, undatable, skipped-as-voice. A mismatch between source-open and ledger-open (after
  allowing for undatable and the 7-day cut-off) is reported in the job's `details` and as UNKNOWN on
  the admin tile, never as a healthy zero.
- **Flags** (`services/featureFlags.isEnabled`, the same switch `crudAutomation.ts:246` uses), all
  default OFF: `obligation_mirror_enabled` (phase 1), `obligation_today_enabled` (phase 2),
  `obligation_single_escalation` (phase 3).

## 7 · Escalation: one breach, one alert

Today a single overdue callback can produce a 4 h Telegram (`crudAutomation.ts:258`), a 4 h StateNour
attention alert (`statenourSync.ts:385`), a 24 h safety alert (`safetyMonitor.ts:332`) and a
`callback` Decision Inbox row. An overdue owed text produces a Telegram re-sent at most hourly and a
`human_pending_sms` Inbox row. A promise produces an Inbox row once a day and no Telegram.

Target (phase 3): the sweep sends **one** Telegram per obligation when it first goes overdue,
stamped by `escalated_at` in the same compare-and-swap, and upserts one `promise_overdue` Inbox row.
The other paths retire one PR at a time after the ledger has matched them for 7 days:

1. `humanPendingAlerts` Telegram → the sweep's alert.
2. `escalateStaleCallbacks` **Telegram only**. Its customer "still in our queue" text is a customer
   send and is out of scope here; it stays exactly as it is.
3. `safetyMonitor` 24 h callback check → reads the ledger's overdue count.
4. `opportunityQueue` collectors `callback` and `human_pending_sms` → `promise_overdue` carries both.

**Operator decision needed before phase 3** (not before phase 1): the hourly re-alert on owed texts
is deliberate ("a customer who is still waiting an hour later genuinely warrants a second nudge",
`humanPendingAlerts.ts:27`). "One escalation per breach" (§6.5) removes it. The alternative is one
alert at breach plus one reminder at 4 h overdue, both stamped. Record the choice as a comment by
nourdean22 on the shift-loop issue.

## 8 · Phases, each with its exit

| Phase | Change | Tier | Exit criterion |
|---|---|---|---|
| 0 | This note | LOOP | merged |
| 1 | `obligationMirror` (mappers, closers, parity report), `nextOpenAt` export, `PROMISE_TYPES` += `reply`, `emergency_response`; the sweep ignores mirrored kinds while `obligation_single_escalation` is off, so shadow rows raise no Inbox item | LOOP | flag armed by the operator; 7 consecutive days with parity mismatches = 0 and no row created for a closed source |
| 2 | Today queue reads `promises.listOpen` (extended with the source link and kind) behind `obligation_today_enabled`; `PromisesPanel` merges into it; an admin close path for `emergency_requests`; per-kind kept counts with attestation class | LOOP (emergency close path = PROTECTED CORE) | the ledger list and the old client-assembled list agree for 7 days (counted, per kind) |
| 3 | Single escalation (§7), then the four retirements, one PR each | LOOP (alert paths touching callbacks = PROTECTED CORE) · OPERATOR re-alert decision | overdue obligations at 17:00 ET reported daily from the ledger |

Out of scope, named so they are not assumed covered: StateNour `open_loop` tasks (boundary doc);
`voice_followups`; work-order `promisedAt` (the Today queue already raises it at
`OverviewSection.tsx:271`; a later `completion_notice` kind is the natural home); rack checks and
"we'll text when done", which need **writers** first (research doc Part D §7 recommendation 1).

## 9 · Promotion contract (`OVERNIGHT-MANDATE.md` §5)

| | |
|---|---|
| Metric that should improve | open obligations past `due_at` at 17:00 ET, all kinds, from the ledger; trending to zero |
| Must not regress | owed-text alert latency (an overdue reply must still reach the owner within one pulse, 15 min); no customer send added or removed by phases 1-2; the voice-promise kept-rate exclusion |
| Baseline | 45 owed texts past due at 13:47Z on 2026-09-23 (§1.4); callbacks and emergencies have no baseline, and phase 1's shadow week produces the first one. Today's count is UNKNOWN from this session (no production access) |
| Observation window | 7 days per phase (a full shop week, Sunday hours included) |
| Kill switch | each phase's flag; OFF restores today's behaviour exactly, because no source writer and no existing alert is changed until phase 3 |
| Rollback | phase 1-2: flag OFF; the mirrored rows are inert while the sweep ignores them, and removing them is one operator-run `DELETE ... WHERE created_by = 'obligation-mirror'` (a production write, so operator-only). Phase 3: revert the retirement PR |
| Uncertain | whether callbacks are ever closed promptly enough for the ledger to be believed (24 of 31 rows were `no-answer` in the 2026-09-22 queue census, many set by the old cron); how many callbacks the voice-context parse misses; whether the 2 h callback window matches how the counter actually works |
| Falsifier | if the shadow week shows the ledger's overdue count disagreeing with the source stores by more than the undatable count, the mirror is wrong and phase 2 does not start. If callbacks plus emergencies are under 3% of open obligations, drop them and keep the ledger for replies and promises (the research doc's own falsifier, restated for this set) |

## 10 · Alternatives considered

- **A new `obligations` table with its own state machine.** Rejected: `customer_promises` already
  carries the shape, the idempotency index and a production sweep; a second kernel is a second
  implementation of the same job (research doc Part D §7 reached the same verdict).
- **Write the ledger row inside each source writer's transaction.** Rejected for now: five protected
  write sites, and a missed future writer silently drops obligations. The mirror covers every writer
  including ones not yet written. Revisit if the 15-minute lag proves to matter.
- **Move the source records into `customer_promises`.** Rejected: callbacks feed leads, attribution
  and StateNour through `bridge_outbox`; owed texts drive the SMS job processor. The ledger indexes
  them; it does not own their work.
- **Mirror StateNour `open_loop` tasks back into nickstire.** Rejected: two owners for one
  obligation is the defect this note removes.

**Invalidation condition**: this decision is void if a source store gains its own due time, owner
and close evidence and the Today queue can read all stores with one query of equal cost; at that
point the index is redundant and should be deleted rather than kept in sync.
