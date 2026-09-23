# ADR-0019 · Idempotent nickstire -> statenour writes · keys, a TiDB outbox, receiver receipts

> **Status**: Proposed (2026-09-23) · design note only, no code in this PR
> **Queue item**: Q-12 in [`docs/research/2026-09-23-estate-master-architecture.md`](../research/2026-09-23-estate-master-architecture.md)
> (§8 items 1-3, §10.1 finding S7, §14.4)
> **Protected core**: YES. The design touches lead/callback/booking persistence (the enqueue joins
> their write), the TiDB migration journal, and the nickstire -> statenour bridge
> ([`apps/nickstire/PROTECTED-CORE.md`](../../apps/nickstire/PROTECTED-CORE.md)). It does NOT change bridge
> authentication; per-capability keys are Q-13, which is queued behind this.
> **Decision drivers**: every nickstire event lands in statenour twice · no write carries a key the
> receiver can dedupe on · every retry buffer is in memory and dies on deploy (deploys are frequent, §1.3)
> · a retried critical event re-sends the owner's Telegram alert

---

## 1 · The answer

1. Every nickstire -> statenour **fact** write gets a deterministic idempotency key, derived from the
   event type and the business object it describes. The key never contains PII or a timestamp of
   sending.
2. Fact writes stop going straight to HTTP. They go into a TiDB table, `bridge_outbox`, with
   `INSERT IGNORE` on the key. Where there is a business row (lead, booking, callback), the outbox row
   is written in the **same transaction** as that row.
3. A drainer sends outbox rows. It tries each row immediately after commit (fast path) and then sweeps
   inside the existing `statenour-live-sync` job every 15 minutes. It claims each row with a
   conditional `UPDATE`, one row at a time. It does not need `SKIP LOCKED`.
4. statenour records each key in a new `bridge_receipts` table, in the same Prisma transaction as the
   business write, with `INSERT ... ON CONFLICT DO NOTHING`. A replay returns `200 {duplicate: true}`
   and writes nothing. Work that runs after the response (the brain pipeline, alerts) is keyed through
   `action_attempts`, so a replay re-runs only what did not finish.
5. The double POST ends in two steps. First, a one-line phase 0a narrows `statenour-sync` to the three
   types the bridge does not carry. Then the two bus destinations collapse into one outbox row per
   bus event. The Telegram webhook hop becomes a receiver-side side effect keyed through statenour's
   existing `action_attempts`, so a replay cannot re-alert.
6. Rows that can never be delivered (a permanent 4xx) become `dead` in place. Transient failures never
   kill a row; a pending age over 1 hour raises an alarm instead. The owner sees both as counts, and
   one admin action replays dead rows.
7. Rollout: phase 0a first (it needs no new table), then the receiver, then shadow enqueue with a
   comparison, then cutover one event family at a time behind a flag. It exits on five measured
   criteria (§9).

---

## 2 · Current state (verified 2026-09-23 against `origin/main` f04e4d0)

Paths are relative to `apps/nickstire/server/` (N) or `apps/statenour/` (S).

### 2.1 The four S7 citations: all confirmed

| Claim | Evidence |
|---|---|
| Owner escalation posts with a 5 s timeout and only logs on failure | N `services/ownerEscalation.ts:78` (`void fetchImpl(...)`), `:82` (`AbortSignal.timeout(5000)`), `:84-87` (log-only `.then/.catch`) |
| statenour creates a task on every `open_loop` call | S `app/api/sync/nour-os/route.ts:175` (`case "open_loop"`) -> `:190` `createTask(...)`; `lib/services/tasks.ts:550-906` has no duplicate check |
| The web-experiment cron posts a fresh verdict and claim every run | N `cron/jobs/webExperimentResolve.ts:205` `postToEvidenceLedger(...)`; job `web-experiment-resolve` at `cron/scheduler.ts:2092` |
| The reality ledger never dedupes | S `lib/services/reality-ledger.ts:203` `realityEvent.create` and `:237` `evidenceClaim.create`, in one `$transaction` (`:200`); `RealityEvent` has a cuid PK and no unique key (`prisma/schema.prisma:3739-3763`) |

### 2.2 Inventory: every nickstire -> statenour write

There are ten write paths. **None sends an idempotency key.** Base URL is `STATENOUR_SYNC_URL`, which falls
back to the production URL everywhere except `services/evidenceLedger.ts:59`, where it has no fallback.
Auth is `STATENOUR_SYNC_KEY`, sent as `x-sync-key` or as a Bearer token; statenour's `requireSyncAuth`
accepts both (S `lib/auth-guard.ts:56-63`).

| # | Sender (N) | statenour route (S) | Trigger | Key / stable id | Timeout | Retry | On failure | Receiver dedupe |
|---|---|---|---|---|---|---|---|---|
| 1 | `nour-os-bridge.ts:369` | `/api/sync/events` | bus destination `nour-os-bridge` (`services/eventBus.ts:85-112`); work-order hooks (`services/dispatch.ts:221,253,304`, `services/qcService.ts:190`, `services/workOrderService.ts:417,430`); vendor health (`services/vendorHealth.ts:730`) | `eventId` = `evt_<ts36>_<rand>` (`:264-268`): random per dispatch, and **the receiver drops it** | 10 s; circuit breaker 15 s (`:40-44`) | in-memory queue, 5 attempts, 5 s x 2^n (`:196-223`). **Lost on restart** | dropped with `log.error` after 5 attempts (`:201-207`) | none: `auditEvent.create` (S `app/api/sync/events/route.ts:28`) |
| 2 | `nour-os-bridge.ts:374` | `/api/webhooks/nickstire` | sent in parallel with #1 | same `eventId`, dropped | 10 s | only as a side effect of #1's retry, **so every retry re-sends the Telegram alert** | the response status is never read, so the receiver's deliberate 500 for an undelivered emergency (S `app/api/webhooks/nickstire/route.ts:227-233`) triggers nothing | none (`:203`) |
| 3 | `services/eventBus.ts:505` | `/api/sync/events` | bus destination `statenour-sync`, `handles: "all"` (`:467-525`) | none | 8 s, then 15 s, then 15 s | 3 attempts on 5xx or network error; a 4xx is not retried | caught and logged, **but a final HTTP failure leaves `lastErr` unset, so it logs nothing** (`:503-523`) | none, except `social_draft:sync`, which upserts on `data.id` (S `route.ts:96`) |
| 4 | `cron/jobs/statenourSync.ts:400` | `/api/sync/business` | cron `statenour-live-sync` (`cron/scheduler.ts:1056`, pulse tier, every 15 min, `:720-721`); also `shopDriverMirror.ts:1272` and `_core/bridge-routes.ts:1109` | none | 10 s, then 20 s, then 20 s | 3 attempts; **a 4xx is retried immediately with no backoff** (`:398-423`) | throws, and the cron records a failure | none: 2 `auditEvent` rows per sync (S `app/api/sync/business/route.ts:51,66`) |
| 5 | `services/nickMemory.ts:513` | `/api/sync/nour-os` `insights` | cron `memory-sync-to-statenour` (`cron/scheduler.ts:1471`) | none | 5 s | none | `res.ok` is never checked; the error is swallowed | none (S `route.ts:139`) |
| 6 | `services/ownerEscalation.ts:78` | `/api/sync/nour-os` `open_loop` | `_core/bridge-routes.ts:1017`; `services/revenueReconciliation.ts:162` | none (the trigger appears only in the title text) | 5 s | none | log only | **none: a new task on every call** |
| 7 | `services/evidenceLedger.ts:72` | `/api/sync/evidence` | `webExperimentResolve.ts:205` | none (`sentAt` changes on every call) | 5 s | none | returns false | none |
| 8 | `services/dbBackup.ts:79` | `/api/sync/backup` | cron `db-backup` (`cron/scheduler.ts:1979`) | none | **none** | none | Telegram alert, then throw | none |
| 9 | `routers/content.ts:2291` | `/api/sync/queue` | admin mutation | row `id` | **none** | none | the admin UI sees the error | yes: a status compare-and-swap (S `lib/content/drafts.ts:186,250,288`) |
| 10 | `routers/contentStudio.ts:22` | `/api/trpc/contentStudio.*` on `NOUR_OS_API_URL` | admin mutations | `id` on update and delete | **none** | none | the admin UI sees the error | create: none |

### 2.3 The double POST, precisely

Each bus event that has a bridge mapping reaches `/api/sync/events` **twice**, under two type strings:

- a lead arrives as `nickstire:lead` through #1, which the receiver maps into the brain pipeline
  (S `route.ts:135-155`);
- it arrives again as `nickstire:lead_captured` through #3, which is not in that map, so it is stored
  in the audit log only.

The result is two `AuditEvent` rows per event from `/api/sync/events`. Sender #2 adds a third: the
webhook route writes its own (S `app/api/webhooks/nickstire/route.ts:203`). So today's baseline is
**about 3.0 `AuditEvent` rows per bridged event**. The copies carry the raw `event.data`, **including name and
phone** (`emit.leadCaptured`, N `services/eventBus.ts:672-674`), so PII crosses into Neon today. That
contradicts §8 item 2 of the architecture doc.

The bridge's `typeMap` (`eventBus.ts:93-108`) leaves out `social_draft:sync`, `mirror_synced` and
`data_refreshed`. Those three travel **only** through #3, so #3 cannot simply be deleted.

### 2.4 Nothing replays

- Bus events are not persisted before dispatch.
- `event_dlq` (N `drizzle/schema.ts:3727`) receives subscriber failures and raises a Telegram alert at
  3 or more in 10 minutes (`eventBus.ts:857-907`). **Nothing reads it back.**
- The bridge's retry queue is an in-memory array (`nour-os-bridge.ts:196`).
- `events.jsonl` (`:334-352`) defaults to a Windows path, and nothing in the server reads it.
- A Railway deploy therefore silently drops every in-flight retry.

### 2.5 Prior art this design reuses (not a second implementation)

| Need | Existing mechanism | Where |
|---|---|---|
| Durable claim-and-sweep queue with a unique idempotency key, `dueAt`, `claimedAt/claimedBy`, attempts, backoff and `dead` | `sms_response_jobs` | N `drizzle/schema.ts:3933-3960`; `services/smsResponseJobs.ts:118` (`INSERT IGNORE`), `:263-297` (claim sweep), `:391-404` (claim by id for the fast path), `:522-540` (boot and periodic sweep) |
| Affected-row helper for conditional updates on TiDB | `affectedRowCount` | N `lib/db-affected` |
| Tolerating a table that is in `schema.ts` but not yet in prod | `isMissingTableError` | N `lib/dbErrors` |
| Keyed, at-most-once side effect on the statenour side | `action_attempts.operationKey @unique` | S `prisma/schema.prisma:3772-3796`; `lib/services/action-attempts.ts` |
| Upsert-by-natural-id on the receiver | `socialPublishQueue.upsert` on `data.id` | S `app/api/sync/events/route.ts:96` |

One rule changes from the prior art. `smsResponseJobs.setJobStatus` settles by `id` alone (`:313-323`),
so a worker whose lease was reclaimed can overwrite the new claimant's state. The outbox settles only
when it still holds its own `claim_token` (§5.3). The same hole in `smsResponseJobs` is flagged in §12,
not fixed here.

---

## 3 · Scope: which writes go through the outbox

| Paths | Decision | Why |
|---|---|---|
| #1 + #3 (bus events), #6 (escalation), #7 (evidence) | **Outbox** | These are facts and obligations. Losing one loses information; duplicating one creates false tasks, double counts or double alerts. |
| #2 (Telegram webhook) | **Removed as a sender hop** | The alert moves to the receiver, keyed (§6.3). |
| #5 (memory insight) | **Keyed direct send, no outbox** | A derived daily summary. A lost one costs nothing, and a duplicate is prevented by the key `v1:nick.memory.summary:day:<YYYY-MM-DD ET>`. |
| #4 (business snapshot) | **Out of scope; follow-up** | A state snapshot where the latest one wins. It should upsert on a 15-minute bucket key instead of appending two audit rows; that is a separate change. |
| #8 (backup) | **Out of scope** | The payload is the backup itself. Putting it in TiDB would duplicate the database inside the database. |
| #9, #10 (admin mutations) | **Out of scope; send the key header only** | The operator is waiting on the response, so synchronous is correct. Add `Idempotency-Key` so that a double tap is harmless. |

---

## 4 · The idempotency key

**Format:** `v1:<eventType>:<objectType>:<objectId>[:<discriminator>]`. If the result exceeds 190 chars
(the `varchar(190)` convention of `action_attempts.operationKey`), it becomes
`v1:h:<sha256-hex of the full string>`.

**Rules:**

- **Deterministic** from business identity only. Never use the send time, `Date.now()`, a random value
  or a retry count. The bridge's `evt_<ts>_<rand>` fails this rule, which is why it could never have
  worked as a key.
- **No PII.** Use row ids, never phone numbers or names. For people, use the `customer_key`
  (§8 item 2) once it exists.
- **A new fact gets a new key.** A state change is a new fact, so the new state belongs in the
  discriminator. A repeat of the same fact is the same key.
- **No clock values in keys.** A key names a row id, never a timestamp. A millisecond timestamp is a
  13-digit run, which T1's phone-number guard (no run of 10 or more digits) rejects. When a fact is
  "the Nth time X happened", its key is the id of the row that records the Nth time.
- **The derivation is a registry entry, and an unregistered type is never dropped.** Every bus type
  that exists today has an entry below. A type added later without one falls back to today's direct
  send, with no key, and logs `unregistered_event_type`. Its count is shown on the owner radar next to
  the dead count. This registry is also the event-type registry from §8 item 1; the two are one file.
- **Latest-wins types coalesce.** Some types report current state rather than a fact: drafts, mirror
  and refresh heartbeats. Their key names the object only. The enqueue is
  `INSERT ... ON DUPLICATE KEY UPDATE payload=VALUES(payload), status='pending', due_at=NOW(3), claim_token=NULL`,
  so the newest state replaces an unsent older one. If a send is in flight, clearing `claim_token`
  makes that sender's settle a no-op, and the row goes out again with the newer payload. The receiver
  skips the receipt for these types, because its own upsert is already idempotent (§6.2).

| Source | Event type (registry) | Key |
|---|---|---|
| `emit.leadCaptured` | `lead.created` | `v1:lead.created:lead:<leads.id>` |
| `emit.callbackRequested` | `lead.callback_requested` | `v1:lead.callback_requested:callback:<row id>`. **The emit carries no id today** (`routers/callback.ts:132`), so the implementation must pass the inserted row's id. |
| `emit.bookingCreated` / `bookingCompleted` | `shop.booking.created` / `.completed` | `v1:shop.booking.<created\|completed>:booking:<id>` |
| `emit.invoiceCreated` / `invoicePaid` | `shop.invoice.created` / `.paid` | `v1:shop.invoice.<created\|paid>:invoice:<invoiceNumber>` |
| `emit.paymentReceived` | `shop.payment.received` | `v1:shop.payment.received:order:<orderNumber>` |
| `emit.estimateGenerated` | `shop.estimate.presented` | `v1:shop.estimate.presented:estimate:<id>` |
| `emit.emergencyRequest` | `lead.emergency` | `v1:lead.emergency:emergency:<row id>`. **The emit carries no id today** (`routers/emergency.ts:160-165` sends only name, phone, problem and urgency). The implementation passes the id of the row the route persists. If the route persists none, adding that row is part of the change, and it is protected core. |
| review detected | `review.received` | `v1:review.received:review:<google review id>` |
| work-order status | `shop.work_order.status` | `v1:shop.work_order.status:transition:<work_order_transitions.id>` (`drizzle/schema.ts:2235-2245`). The transition row is the fact, so a work order that re-enters a status gets a new key with no timestamp. Callers of `onWorkOrderStatusChange` must pass the inserted transition id. |
| `emit.tireOrderPlaced` | `shop.tire_order.placed` | `v1:shop.tire_order.placed:tire_order:<order row id>` (emit sites `routers/gatewayTire.ts:747,848`) |
| `campaign_sent` | `comms.campaign.sent` | `v1:comms.campaign.sent:campaign:<campaign id>` (`routers/campaigns.ts:583`) |
| `social_posted` | `content.social.posted` | `v1:content.social.posted:draft:<draft id>:<platform>` |
| `stage_changed` | `shop.stage.changed` | `v1:shop.stage.changed:<entity>:<entity id>:<to stage>`. This is a fact, but a re-entered stage collides with the earlier key. Until the emit site carries a transition-row id, this type stays on the direct-send fallback rather than risk deduping a real re-entry. |
| `social_draft:sync` | `content.draft.synced` (latest-wins) | `v1:content.draft.synced:draft:<id>`. Coalesces; the receiver keeps its existing upsert on `data.id` (S `app/api/sync/events/route.ts:96`). `social_drafts.updatedAt` has one-second precision and moves on any update (`drizzle/schema.ts:3786-3792`), so it cannot be a version. |
| `mirror_synced` / `data_refreshed` | `sync.mirror.completed` / `sync.data.refreshed` (latest-wins) | `v1:sync.<mirror.completed\|data.refreshed>:source:<source name>`. Coalesces to the newest heartbeat per source. |
| escalation (#6) | `obligation.opened` | `v1:obligation.opened:<trigger>:<subjectId>`. **`OwnerEscalation` has no subject field today** (`services/ownerEscalation.ts:20-38`). The change adds a required `subjectId`; the two callers already hold one (the draft or run id at `_core/bridge-routes.ts:1017`, and the reconciliation window at `services/revenueReconciliation.ts:162`). Re-escalating the same subject is the same obligation, so statenour must not open a second task. |
| experiment verdict (#7) | `experiment.verdict` + claim | `v1:experiment.verdict:experiment:<experimentId>:<contractHash>:<status>`. A daily re-post of an unchanged verdict dedupes; a changed status is a new fact. |
| shop-floor / vendor-health snapshots | (not facts) | Excluded from the outbox. They are latest-wins state and stay on the existing sender until #4's follow-up. |

The key travels twice: as the `Idempotency-Key` HTTP header (the shape of the IETF httpapi draft) and as
`idempotencyKey` on each event in the body, because one POST can carry a batch.

---

## 5 · The outbox (nickstire, TiDB)

### 5.1 Table

```sql
-- apps/nickstire/drizzle/NNNN_bridge_outbox.sql  (number assigned at implementation time)
CREATE TABLE IF NOT EXISTS bridge_outbox (
  id               BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  idempotency_key  VARCHAR(190) NOT NULL,
  event_type       VARCHAR(80)  NOT NULL,   -- registry type, dotted lower_snake
  route            VARCHAR(64)  NOT NULL,   -- 'sync/events' | 'sync/evidence' | 'sync/nour-os'
  payload          JSON         NOT NULL,   -- the exact body item to send
  occurred_at      TIMESTAMP(3) NOT NULL,   -- business time, not enqueue time
  status           VARCHAR(32)  NOT NULL DEFAULT 'pending', -- pending|sending|delivered|dead|shadow
  attempts         INT          NOT NULL DEFAULT 0,   -- every claim; observability only, never a death sentence
  due_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  claim_token      VARCHAR(36)  NULL,
  claimed_at       TIMESTAMP(3) NULL,
  last_http_status INT          NULL,
  last_error       VARCHAR(500) NULL,
  delivered_at     TIMESTAMP(3) NULL,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_bridge_outbox_key (idempotency_key),
  KEY idx_bridge_outbox_status_due (status, due_at),
  KEY idx_bridge_outbox_created (created_at)
);
```

These columns follow the `nickstire-tidb-ddl` skill:

- **`VARCHAR` status, not `ENUM`, at width 32.** An out-of-enum write loses the row under
  `STRICT_TRANS_TABLES`, and in this table that would be the failure handler's own write.
- **The longest status value**, `delivered`, is 9 chars.
- **Guarded and additive.** The DDL is `IF NOT EXISTS`, is applied by hand through the scoped runner in
  `prod-db-guard`, and ships only after `INFORMATION_SCHEMA` shows the table is absent.
- **`schema.ts` may land before the DDL.** In that window every enqueue catches `isMissingTableError`
  and falls back to today's direct send, logging `bridge_outbox missing`. This fails **open to today's
  behaviour**, never closed.

### 5.2 Enqueue: in the business transaction

```ts
await db.transaction(async (tx) => {
  const [lead] = await tx.insert(leads).values(...).$returningId();
  await enqueueBridge(tx, { type: "lead.created", objectId: lead.id, payload, occurredAt });
});
void drainOne(key).catch(logOnly);  // fast path: runs once the transaction has resolved; best effort
```

There is no `afterCommit` hook in nickstire. The fast path is simply the next statement after
`await db.transaction(...)` resolves, fired without `await` so that the request never waits on
statenour.

- `enqueueBridge` is `INSERT IGNORE`. `affectedRows === 0` means the fact was already enqueued, which
  is a correct no-op.
- The lead, callback and booking inserts are not in transactions today (for example,
  `routers/lead.ts:146` inserts and then emits at `:173`). Wrapping them is the protected-core part of
  the change. nickstire already runs 7 Drizzle transactions on TiDB (for example
  `services/mediaRegistry.ts:92`), so the primitive is proven here.
- Where there is no business row (the experiment verdict, an escalation), the enqueue is the only
  write. Atomicity then means only "enqueued or not".
- The bus keeps its in-process consumers (Telegram, live feed, SMS attribution and the rest). **Only
  the two statenour destinations are replaced**, by one enqueue.

### 5.3 Drain: claim, send, settle

TiDB gives no `SELECT ... FOR UPDATE SKIP LOCKED` to lean on (per the queue entry), and this design does
not need it. The claim is a per-row compare-and-swap, the shape `smsResponseJobs.ts:281-288` already
uses, tightened per the `claim-before-act` skill:

1. **Read candidates.**
   `SELECT id, status, due_at, claimed_at FROM bridge_outbox WHERE (status='pending' AND due_at<=NOW(3)) OR (status='sending' AND claimed_at < :leaseCutoff) ORDER BY due_at, id LIMIT 50`.
2. **Claim each row** by pinning every field the decision read:
   `UPDATE bridge_outbox SET status='sending', claim_token=:uuid, claimed_at=NOW(3), attempts=attempts+1 WHERE id=:id AND status=:readStatus AND due_at=:readDueAt AND claimed_at <=> :readClaimedAt`.
   `affectedRows === 1` wins. `0` means another drainer has the row: skip it, with no retry loop.
3. **Send** with the `Idempotency-Key` header. The timeout is 10 s. The lease is 2 minutes, which is
   longer than a timeout plus a slow receiver.
4. **Settle** only while the token is still ours, with `... WHERE id=:id AND claim_token=:uuid`:
   - A 2xx, including `{duplicate:true}`, becomes `delivered`.
   - A 408, 429, 5xx or network error becomes `pending` with
     `due_at = NOW + min(30s x 2^(attempts-1), 1h)` plus 0-20% jitter. **These never make a row
     `dead`.** A count-based limit on 15-minute sweeps would kill every row after roughly 2 hours of
     statenour downtime, which is exactly the outage the outbox exists to survive. A long outage
     instead shows up as `oldestPendingAgeSec` on the radar (§5.5).
   - Any other 4xx, or a per-item rejection in a 2xx batch response, becomes `dead`. These are
     permanent: resending the same bytes cannot succeed.
   - `last_error` is truncated to 500 characters in code before the settle. Under
     `STRICT_TRANS_TABLES` an over-long value makes the settle itself fail, and the row would then
     cycle through `sending` forever.
   - If the settle affects 0 rows, the lease was lost and another drainer owns the row. The receiver's
     dedupe makes the double send harmless.
5. **Batching.** The drainer may group up to 20 claimed rows for the same route into one POST. Each
   item carries its own key, and the receiver answers per item, so one poisoned item cannot fail its
   neighbours.

**Where it runs:**

- **The fast path** runs `drainOne(key)` after commit, which is the `claimJobById` pattern. Critical
  events (leads, emergencies, callbacks) therefore reach statenour in seconds, as they do today.
- **The sweep** runs at the start of `statenour-live-sync` (verified: `cron/scheduler.ts:1056`, pulse
  tier, 15 min) and on boot. A fast path that failed because statenour was down is retried within
  15 minutes of recovery. No new timer is added.
- **Deploy churn stops costing data.** A deploy mid-send leaves a `sending` row that the next sweep
  reclaims after the lease expires.

### 5.4 Ordering

- **No global order is promised, and none is needed.** Facts are append-only on the receiver, which
  orders by `observedAt` (the outbox's `occurred_at`), never by arrival. A reader that wants "latest
  state" (for example, a work order's status) takes the max `observedAt` per object.
- **Causal pairs travel as one row.** The experiment verdict event and the claim that rests on it
  (`sourceEventIndexes: [0]`, `webExperimentResolve.ts:233`) are one outbox row whose payload is the
  whole `{events, claims}` batch. Lineage therefore survives a replay: the receiver resolves the index
  against the event row it wrote or, on a duplicate, the one that already exists (§6.2).
- **Sweep order is `due_at, id`.** `id` is only a tiebreak, never a time order: TiDB allocates
  AUTO_INCREMENT in batches per server (S8).

### 5.5 Poison rows: a dead letter the owner can see

- **The row is the dead letter.** `status='dead'` stays in `bridge_outbox` with `last_http_status` and
  `last_error`. This is not a second DLQ table; `event_dlq` stays what it is, a record of in-process
  subscriber failures.
- **Visibility:**
  1. The `statenour-live-sync` payload gains `bridgeOutbox: {pending, dead, oldestPendingAgeSec}`, so
     the owner radar (§9 of the architecture doc) shows a non-zero dead count as an exception.
  2. A Telegram line fires when `dead` goes from 0 to more than 0, once per transition, not per row.
  3. `/admin` lists the dead rows, with their `last_error` text and the payload type, never the
     payload itself.
- **Replay:** one admin action sets `dead -> pending, attempts=0, due_at=NOW()` with a compare-and-swap
  on `status='dead'`. It is safe because the receiver dedupes.
- **An outage alarm.** When `oldestPendingAgeSec` exceeds 1 hour, the same 0 -> >0 Telegram rule
  fires. This replaces the attempt cap as the signal that something is wrong.
- **Retention:** prune in `cleanupOldData` (`cron/jobs/cleanup.ts:7`), which already deletes aged
  rows from other tables. Delivered rows go after 30 days, and leftover `shadow` rows go once phase 1
  ends. `dead` rows are kept until replayed or dismissed. (`retention-all` is the wrong job: it sends
  customer-retention texts and deletes nothing, `cron/scheduler.ts:2176-2191`.)

---

## 6 · The receiver (statenour, Neon)

### 6.1 One table for every bridge route

```prisma
model BridgeReceipt {
  idempotencyKey String   @id @map("idempotency_key") @db.VarChar(190)
  route          String   @db.VarChar(64)
  resultRef      String?  @map("result_ref") @db.VarChar(120)   // the row id written (event, task, claim)
  firstSeenAt    DateTime @default(now()) @map("first_seen_at")
  lastSeenAt     DateTime @default(now()) @map("last_seen_at")
  seenCount      Int      @default(1) @map("seen_count")
  @@index([firstSeenAt])
  @@map("bridge_receipts")
}
```

**Why a receipts table rather than a unique column on each target table.** The targets are
`reality_events`, `evidence_claims`, `tasks`, `audit_events` and `social_publish_queue`. A unique key on
each would mean five migrations, and one of them is on `tasks`, a core table. The receipt is keyed on
the idempotency key, which already embeds `(sourceSystem, eventType, objectId)`, so it enforces exactly
the `(sourceSystem, sourceId, eventType)` uniqueness §8 item 3 asks for, in one place. `seenCount` is,
for free, the measurement of how many duplicates the old system would have written.

### 6.2 The write

Inside the route's existing transaction (for example `reality-ledger.ts:200`):

```sql
INSERT INTO bridge_receipts (idempotency_key, route) VALUES ($1, $2)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING idempotency_key;
```

**`/api/sync/events` has no transaction today.** Each `auditEvent.create` stands alone (S `route.ts:28`),
and `processShopEvent` runs fire-and-forget after the response (S `route.ts:134-157`). The key-aware
path wraps the receipt and the `AuditEvent` in one `prisma.$transaction`.

- **One row returned: first delivery.** Do the business write, then set `result_ref`.
- **Zero rows: replay.** Run `UPDATE bridge_receipts SET seen_count = seen_count + 1, last_seen_at = now()`,
  read `result_ref`, and return `200 {duplicate: true, resultRef}`. For a batch with a claim, the
  claim's `sourceEventIndexes` resolve to the `result_ref` of the duplicate event.
- **No key: the legacy path**, unchanged. This keeps the receiver deployable ahead of the sender.

It is one transaction, so a crash between the receipt and the business write rolls both back, and the
next delivery is correctly "first".

**Work outside the transaction goes behind `action_attempts`, or a receipt would bury it.** Once a
receipt exists, every replay reads as a duplicate. Anything that runs after the response, such as the
brain pipeline, would then never run again if it died. So each such side effect gets its own attempt,
using `beginAttempt` and `verifyAttempt` (S `lib/services/action-attempts.ts:127,251`) and the
`holdUntil` lease:

- `operationKey = "nickstire-pipeline:" + idempotencyKey`, begun before `processShopEvent` and
  verified when it resolves.
- On a replay, the receiver reads that attempt. If it is not VERIFIED and its lease has expired, the
  receiver re-runs **the pipeline only**, never the business write.
- **Latest-wins types skip the receipt.** Their existing upsert is already idempotent: drafts on
  `socialPublishQueue.id` (S `route.ts:96`), heartbeats on their source.

### 6.3 The alert moves behind the key, the same way

- `/api/sync/events` raises the real-time Telegram alert for critical types itself, and only on first
  delivery, through `action_attempts` with `operationKey = "nickstire-alert:" + idempotencyKey`. An
  alert that did not send stays retryable; a delivered one is never re-sent.
- The emergency-undelivered 500 (S `webhooks/nickstire/route.ts:227-233`) becomes an attempt left in a
  non-VERIFIED state. The next delivery of the same key retries **the alert only**, not the business
  write.
- `/api/webhooks/nickstire` stays mounted, and unchanged, for any sender that is not migrated, until
  §9's exit.

### 6.4 One POST per event

- The outbox row for a bus event carries the **bridge's** type vocabulary (`nickstire:lead`, and so
  on), because that is what drives `processShopEvent` (S `route.ts:135-155`).
- It also carries `busType` (`lead_captured`) so that nothing the audit-only copy recorded is lost.
- The receiver writes **one** `AuditEvent` per key.
- `social_draft:sync`, `mirror_synced` and `data_refreshed`, which today travel only via #3, get
  latest-wins registry entries (§4) and ride the same outbox. Every other current bus type has an
  entry too. `stage_changed` is the one exception: it stays on the direct-send fallback until it
  carries a transition id. No type is dropped when the old senders retire.

---

## 7 · Migrations (both hand-applied)

| Side | Artifact | Skill | Notes |
|---|---|---|---|
| nickstire | `drizzle/NNNN_bridge_outbox.sql` + `schema.ts` entry | `nickstire-tidb-ddl`, `prod-db-guard` | Additive `CREATE TABLE IF NOT EXISTS`; the scoped runner, never `pnpm db:migrate`; prove absence in `INFORMATION_SCHEMA` first; re-run `pnpm run check` after applying. |
| statenour | `prisma/migrations/<ts>_bridge_receipts/` | `statenour-migration` | `CREATE TABLE` only, with no ALTER to any existing table and no drop. Park it in `migrations-pending/`, apply with `scripts/apply-pending-migration.ts`, run `prisma migrate resolve --applied`, and confirm with `migrate status` against prod. |

Both are production DDL. Each needs an explicit operator instruction to apply (AGENTS.md, protected
operations).

---

## 8 · Tests (positive control first)

| # | Test | Must fail when |
|---|---|---|
| T1 | Key derivation: the same object gives the same key on every run and process; different objects, or a changed status discriminator, give different keys; no key contains a digit run of 10 or more (a phone-number guard) | the key includes `Date.now()`, a random value or a phone number |
| T2 | Enqueue twice with the same key gives one row, and the second call returns `alreadyEnqueued` | the enqueue becomes a plain `INSERT`, or a pre-check `SELECT` |
| T3 | Transactional enqueue: a lead insert that throws after the enqueue leaves 0 outbox rows; an enqueue that throws leaves 0 lead rows | the enqueue moves outside the transaction |
| T4 | Claim race (`claim-before-act` canary): two drainers share one stale read, and between one drainer's read and its swap the other renews only `claimed_at`. Exactly one sends. The mocked arm asserts that the WHERE clause names `id`, `status`, `due_at` and `claimed_at` | a field is dropped from the predicate, or the claim updates by `id` |
| T5 | A settle holding a stale token affects 0 rows and does not overwrite the new claimant | the settle is `WHERE id=` only (the `smsResponseJobs` shape) |
| T6 | **Receiver replay:** POST the same batch (an event plus a claim resting on it) twice. Expect 1 `reality_events` row, 1 `evidence_claims` row, the second response `{duplicate:true}`, and `seen_count=2`. **Positive control:** the same test without the key header writes 2 rows, which is today's behaviour. That proves the test can see a duplicate. | the receipt insert leaves the transaction, or `ON CONFLICT` is dropped |
| T7 | **End-to-end replay after a crash:** drain a row, have the receiver commit, and kill the drainer before it settles. Advance past the lease, sweep, reclaim and resend. Expect exactly 1 business row in statenour, the outbox row `delivered`, **and the pipeline actually run**: its `nickstire-pipeline:` attempt is VERIFIED. A second arm kills the pipeline after the receipt commits, then replays the key. Expect the pipeline to re-run once and the business write not to be repeated. | any of T2, T4, T5 or T6 regresses, or the pipeline runs outside its attempt |
| T8 | Poison: a 400 becomes `dead` on the first attempt; a 503 becomes `pending` with backoff and **stays pending past 20 attempts**; a replay action moves `dead` to `pending` and then to `delivered`; a 2,000-character error is stored truncated and the settle succeeds | a 4xx is retried forever, a transient error is ever marked dead, or an over-long `last_error` wedges the row |
| T12 | Latest-wins coalescing: two draft updates enqueued back to back give one row carrying the second payload. An update that lands while the first send is in flight makes that sender's settle a no-op, and the row is resent with the newer payload. | the enqueue is `INSERT IGNORE` for a latest-wins type, or it does not clear `claim_token` |
| T13 | An unregistered bus type is sent directly, never dropped, and increments `unregistered_event_type` | the registry rejects it outright |
| T9 | The escalation `open_loop` sent twice creates 1 task | the receipt is skipped on the `nour-os` route |
| T10 | Alert once: a critical event delivered twice sends one Telegram message; an alert that failed on the first delivery is retried on the second | the alert is sent outside the `action_attempts` key |
| T11 | A missing table (`schema.ts` ahead of the DDL) makes the enqueue fall back to the direct send, and the request still succeeds | the fallback throws, which would fail closed on lead creation |

Every one of these is run against the unfixed code, or with the guard removed, before it is trusted
(`positive-control-first`).

---

## 9 · Rollout: shadow, compare, cut over

**The flag is `bridge_outbox_mode`**, one of `off | shadow | drain:<family,...>`, stored in nickstire's
`featureFlags`. It is the kill switch: setting it back to `off` restores today's senders exactly. The
legacy sender code stays until 14 days after the last family has been cut over.

1. **Phase 0a: end the double POST now, with no new table.** Narrow the `statenour-sync` destination's
   `handles` from `"all"` (N `services/eventBus.ts:467-525`) to the three types the bridge does not
   carry: `social_draft:sync`, `mirror_synced` and `data_refreshed`. `AuditEvent` rows per bridged
   event drop from about 3.0 to about 2.0 (the webhook's copy remains). Every one of the 17
   `BusinessEvent` types (N `services/eventBus.ts:25-42`) keeps exactly one path: the bridge maps the
   other 14 (`:93-108`). The trade is honest: #3's copy was also a second chance of delivery when the
   bridge's breaker was open. But that copy was audit-only, never mapped into `processShopEvent`, so
   what is given up is a duplicate audit row, not a pipeline run. This is a one-line change, and it
   can ship before anything else in this note.
2. **Phase 0b: receiver first.** Deploy statenour with `bridge_receipts` and key-aware routes. Senders
   without a key behave as they do today.
3. **Phase 1: shadow (7 days).** nickstire enqueues every fact with `status='shadow'` (never drained)
   while the legacy senders keep running. Compare:
   - **Completeness:** for each day, the rows in `leads`, `bookings`, callbacks and emergencies against
     the `shadow` rows by type. **The target is 0 missing** and 0 duplicates.
   - **Baseline duplication**, measured before cutover: in statenour, `AuditEvent` rows per shop event
     (about 3.0 before phase 0a and about 2.0 after it, from §2.3), and `open_loop` tasks per
     escalation subject.
4. **Phase 2: cutover by family**, from least to most critical:
   1. `experiment.verdict`, which runs daily and has no customer impact;
   2. `obligation.opened`;
   3. content and sync types;
   4. reviews, invoices and work orders;
   5. leads, callbacks, emergencies and bookings.

   Each step turns the drain on for the family and switches off #1, #2 and #3 for it in the same
   deploy.

**Exit criteria.** All five must be measured over 7 days after the last family:

| Criterion | Target | Read from |
|---|---|---|
| Delivery | 100% of non-shadow outbox rows `delivered`, or `dead` with an explanation; 0 rows `pending` for more than 1 h | `bridge_outbox` |
| Duplication | `AuditEvent` per bridged key = 1.00 (baseline about 3.0, about 2.0 after phase 0a); `open_loop` tasks per subject = 1 | statenour `audit_events`, `bridge_receipts` |
| No silent loss | `unregistered_event_type` = 0, or every non-zero type has an entry queued | nickstire logs, radar |
| Dedupe exercised | at least 1 receipt with `seen_count > 1` (proves the path fired, not only that it exists) | `bridge_receipts` |
| Latency | critical families at p95 `delivered_at - occurred_at` of 60 s or less | `bridge_outbox` |

**Rollback.**
1. Set the flag to `off`. The legacy senders resume, and the table stays and is simply not drained.
2. The migrations are additive, so no down-migration is needed.
3. A rollback leaves `pending` rows behind. Before flipping back, replay them or mark them `dead`, so
   that a later re-enable does not flush a stale backlog. The receiver's dedupe makes a late flush
   harmless in any case.

---

## 10 · What this touches in protected core

| Protected item | How | Required with the code PR |
|---|---|---|
| Lead, callback and booking persistence | the insert is wrapped in a transaction with the enqueue | T3, T11; a rollback note (flag `off`) |
| TiDB migrations and journal | a new table | the `nickstire-tidb-ddl` checklist; an operator applies it |
| The nickstire -> statenour bridge | the transport changes; **authentication does not** | T6-T10; the auth header code stays byte-identical, and Q-13 changes keys separately |
| Webhook idempotency (Rule 6) | strengthened | — |

---

## 11 · What this note decides, and what it leaves open

**Decided:**
- the key format and its derivation per type;
- the outbox schema, the claim and settle protocol, and the drain placement (fast path plus the
  `statenour-live-sync` sweep);
- the receiver receipt table and its transaction placement;
- phase 0a (narrowing `statenour-sync`), then collapsing #1, #2 and #3 into one row;
- alerts and the post-response pipeline keyed through `action_attempts`;
- transient failures never kill a row; an age alarm replaces the attempt cap;
- latest-wins types coalesce, and unregistered types fall back to a direct send;
- the dead-letter surface;
- the rollout, the exit criteria, the tests and the scope exclusions.

**Open:**
1. **PII in the payload.** Today's bus payloads (name, phone) land in `AuditEvent` in Neon. Phase 1
   keeps payload parity, so the transport change does not also change semantics. Stripping PII down to
   `customer_key` (§8 item 2) needs `processShopEvent`'s use of name and phone traced first, and that
   is unverified. **Recommendation:** make it the first follow-up after cutover.
2. **The `UPSTREAMS.md` outbox row** (verdict "adopt WITH the write path, not before", 2026-08-09) was
   written about the statenour -> nickstire direction, whose only writer was deleted in #1460. This note
   is the nickstire -> statenour write path the architecture doc cites it for. The implementation PR
   should amend that row to "adopted for nickstire -> statenour (ADR-0019)". Its reopen trigger for
   the other direction still stands.
3. **`stage_changed` needs a transition row.** Until its emit carries one, it stays on the direct
   send. Whether to add a stage-transition table, or to accept a coalescing latest-stage key, is a
   product call.
4. **Idempotency keys on the admin mutations** (#9, #10) are low-risk and could ride the first code PR.
   #10 may already be broken: its tRPC target needs a session cookie that nickstire does not send
   (S `lib/auth-guard.ts:121-141`). That is unverified at runtime.
5. **The emergency row.** Whether `routers/emergency.ts` persists a row the key can name is
   unverified. If it does not, adding one is protected-core work in the first code PR.

---

## 12 · Adjacent defects found during the inventory (flagged, not fixed here)

| Defect | Evidence | Effect today |
|---|---|---|
| A final HTTP failure logs nothing | N `services/eventBus.ts:503-523`: `lastErr` is unset on the 4xx/5xx `break` | Silent loss on the #3 path |
| A 4xx is retried immediately with no backoff | N `cron/jobs/statenourSync.ts:409-414` (no `break` on 4xx) | 3 wasted calls per bad sync |
| The emergency 500 is ignored | N `nour-os-bridge.ts:374-379` never reads the status | An undelivered emergency alert is never retried by that path |
| A full sync fires two syncs | N `_core/bridge-routes.ts:1093` -> `shopDriverMirror.ts:1272`, then `:1109` | 4 `AuditEvent` rows per full-sync |
| The settle is unguarded in the prior-art queue | N `services/smsResponseJobs.ts:313-323` (`WHERE id` only) | A worker whose lease was reclaimed can overwrite the new claimant's status |
| The memory insight ignores `res.ok` | N `services/nickMemory.ts:513-530` | Failures are counted as successes |
| The base URL fallback differs between senders | `evidenceLedger.ts:59` (none) vs. every other sender (prod default) | The same env produces different behaviour |
| `events.jsonl` has a Windows default path and no reader | N `nour-os-bridge.ts:34-35`, `:334-352` | A dead write on every event |
