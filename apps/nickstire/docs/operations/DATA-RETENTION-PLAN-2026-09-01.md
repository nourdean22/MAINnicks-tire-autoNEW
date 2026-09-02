# Data retention plan — 2026-09-01 (PLAN, nothing here has been executed)

**Source finding:** [`ADMIN-AUTOMATION-SECURITY-DATA-AUDIT-2026-09-01.md` §5.3](../ADMIN-AUTOMATION-SECURITY-DATA-AUDIT-2026-09-01.md):
27 of 146 tables have any deleter; 119 grow forever. Every DELETE below is a **production
write** and is operator-gated (`PROTECTED-CORE.md` rule 4; `prod-db-guard`). This document
exists so the first deletion is designed, counted and reversible instead of improvised.

## The shape every retention job must have

1. **Count first, as its own step:** `SELECT COUNT(*) … WHERE <window>` is logged and, above a
   ceiling, the job refuses (the circuit breaker the hard-delete guard already uses for the
   brain, #2043).
2. **Dry run is the default.** A real delete requires an explicit env/flag per table, and the
   dry-run branch must *return before* the write path — a flag that only suppresses logging is
   not a guard (the 870-row incident).
3. **Batched** (`LIMIT 500` per statement, sleep between), never one statement over the table.
4. **Backup before the first live run** using the house idiom (two statements — TiDB rejects
   `CREATE TABLE … AS SELECT`): `CREATE TABLE _bak_<t>_<op>_<yyyymmdd> LIKE <t>; INSERT INTO … SELECT …`.
5. **Receipt:** rows deleted per table lands in `cron_log.details` AND a Telegram line; a
   deleter that reports 0 forever is indistinguishable from one that never ran — plant a
   known positive in its test.

## Candidate tables and proposed windows (row counts: NOT VERIFIED — read before deciding)

| Table | What it is | Proposed window | Why this window | Read first |
|---|---|---|---|---|
| `sms_messages` | every inbound/outbound text | keep **13 months** | TCPA disputes and the SMS learning corpus both look back a year | `SELECT COUNT(*), MIN(createdAt) FROM sms_messages` |
| `customer_notifications` | follow-up queue rows incl. F-1's pre-wave `pending` ones | delete `failed`/`sent` older than **90 days**; `pending` older than 30 days → mark `failed` first (a one-shot operator action, see below) | pending rows nobody will drain are noise in the admin list | `SELECT status, COUNT(*) FROM customer_notifications GROUP BY status` |
| `nexus_audit_jobs` | dead queue (F-18) | **drop the table** via `0115` | producer removed in #2063; nothing reads it | `SELECT COUNT(*) FROM nexus_audit_jobs` |
| `vapi_call_logs` | call facts + transcripts | keep **13 months**; consider transcript column scrub at 90 days | transcripts are PII-dense; call facts feed attribution for a year | `SELECT COUNT(*) FROM vapi_call_logs WHERE createdAt < NOW() - INTERVAL 13 MONTH` |
| `sms_orchestrations` | per-turn orchestration telemetry | **90 days** | debugging value decays in weeks; corpus tables keep the labelled examples | count as above |
| `customer_status_messages` | WO status texts | **13 months** | ties to work orders; keep with invoices | count |
| `lead_delivery_events` | delivery receipts | **13 months** | attribution window | count |
| `admin_proposals` | approval queue | `executed`/`rejected` older than **180 days** | audit trail lives in `audit_log` | `SELECT status, COUNT(*) …` |
| `alg_probe_log` | mirror probe telemetry | **30 days** | pure ops telemetry | count |
| `analytics_snapshots` | daily snapshots | keep **2 years** | trend charts | count |

## The one backfill that is a data correction, not retention

`customer_notifications` rows created by RUN FOLLOW-UPS **before** #2063 while
`sms_review_requests` was OFF are `pending` and will never be drained (audit F-1). Proposed
one-shot, operator-run:

```sql
-- dry run
SELECT COUNT(*) FROM customer_notifications
WHERE status = 'pending' AND createdAt < '2026-09-02';
-- live (after the count is reviewed)
UPDATE customer_notifications SET status = 'failed'
WHERE status = 'pending' AND createdAt < '2026-09-02' LIMIT 500;  -- repeat until 0
```

## What this plan deliberately does not do

- It does not run. No count above has been taken from production by the agent session that
  wrote it.
- It does not touch `invoices`, `customers`, `work_orders`, `leads`, `bookings` — canonical
  records are not retention candidates.
- It does not define the customer-deletion path (audit F-15); that is a counsel question.
