# Operator Revenue-Unlock Runbook

**Date prepared:** 2026-05-19 · wave-181.80
**Audience:** operator (Nour)
**Total time to unblock all three:** ~90 seconds

---

## TL;DR

Three revenue-cron gates are currently **OFF in prod**. Each cron runs successfully (logs show `status=completed`) but produces **0 sends** because of these gates. Audit chain depth 4 verified all three are production-safe to flip.

| # | Gate | Type | Where | Impact |
|---|---|---|---|---|
| 1 | `FEATURE_DECLINED_RECOVERY` | Env var | Railway | Declined-recovery cron · ~$50k pipeline · 112 runs / 0 sends in 7d |
| 2 | `retention_7day` | DB flag | `/admin → System → Flags` | D7 post-visit check-in · added wave-181.47 · never enabled |
| 3 | `retention_14day` | DB flag | `/admin → System → Flags` | D14 reactivation · added wave-181.47 · never enabled |

---

## Why now is safe to flip

All three crons share the same safety stack (verified by audit waves 181.58 → 181.79):

- **At-most-once claim** (wave-181.59) · `followUp{N}dAttemptedAt` stamps prevent double-send on Railway restarts
- **TCPA opt-out hoisted above gateway routing** (wave-181.60) · opted-out customers never receive marketing SMS
- **Durable daily rate-limit** (wave-181.68) · `sms_rate_limit` table caps 8 sends/phone/24h across multi-pod
- **Sending-hours guard** (wave-181.64) · queues out-of-hours sends for next 8AM ET
- **F25e default routing** (wave-181.60) · all sends go through the shop gateway · Twilio is fallback only
- **Husky pre-commit hook actually running** (wave-181.78) · brand-voice + source-lint enforced on every commit

These guards weren't in place when the gates were first set. Now they are.

---

## How to flip each

### 1. `FEATURE_DECLINED_RECOVERY` (Railway env)

```
Railway dashboard → nickstire service → Variables
Add: FEATURE_DECLINED_RECOVERY = 1
Click: Deploy
```

Next daily cron tick (within 24h) fires up to 20 sends/run. Drains the ~58 active 7d-eligible + ~23 active 30d-eligible estimates over ~4 days.

**Alternative · immediate drain:** `/admin → Declined Work → 🔥 FIRE ALL ELIGIBLE NOW` (wave-181.79 button). 60-90 seconds to clear the queue. Works regardless of the env flag.

### 2 + 3. `retention_7day` + `retention_14day` (DB flags)

```
Open: /admin → System → Flags (or wherever the feature_flags admin UI lives)
Find: retention_7day · toggle to ON
Find: retention_14day · toggle to ON
```

Next daily `retention-all` cron tick fires both tiers. The retention 7d/14d SMS uses the post-visit check-in copy from wave-181.47 (warm tone · no pitch · "based on your last check-up").

**Alternative · raw SQL (if admin UI is unreachable):**
```sql
UPDATE feature_flags SET value = 1, updated_at = NOW()
WHERE `key` IN ('retention_7day', 'retention_14day');
```

---

## Verification after flipping

Watch these for the next 24-48 hours:

### Live SMS health
```bash
pnpm exec tsx apps/nickstire/scripts/diag-sms-recent.ts
```
Expected change · sent count climbs by 50-150 over a few days · failed count stays at 0.

### Recovery progress
```bash
pnpm exec tsx apps/nickstire/scripts/check-recovery-progress.ts
```
Expected change · `sent_7d` and `sent_30d` climb · `attempted_*` matches `sent_*` (no stale claims).

### Cron logs
```sql
SELECT job_name, runs, completed, total_records, last_run FROM (
  SELECT job_name, COUNT(*) AS runs,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
    SUM(records_processed) AS total_records,
    MAX(started_at) AS last_run
  FROM cron_log
  WHERE started_at > NOW() - INTERVAL 24 HOUR
  GROUP BY job_name
) x
WHERE job_name IN ('declined-work-recovery', 'retention-all');
```
Expected · `total_records > 0` for both (not 0 like before).

### Customer-facing smoke test
Send yourself a test SMS via `/admin → Declined Work → 🔥 FIRE ALL ELIGIBLE NOW` (will fire to a small batch · check your phone for the body matching wave-181.43 Repair Haiku style).

---

## What stays untouched

These gates are intentionally OFF · don't flip:

- `weather_triggered_sms` · weather-triggered SMS to lapsed customers (TCPA gray zone · requires legal review)
- `sms_auto_quote` · auto-respond to inbound SMS price questions (needs operator-approved pricing logic)

---

## If something goes wrong

**Customer complains they got an unwanted SMS.** Check `customers.smsOptOut` for their phone. If 0, the opt-out cache had a gap. If 1, they were already opted out and got an SMS anyway → wave-181.60 opt-out hoist is broken → escalate.

**Send rate looks too fast.** `sms_rate_limit` table caps per-phone at 8/24h. If a customer is getting more than that, the cap isn't holding → wave-181.68 durable counter is broken → escalate.

**SMS sends fail.** Check `pnpm exec tsx apps/nickstire/scripts/diag-sms-failures.ts`. Most-likely cause: F25e gateway offline. Look at Capevace dashboard.

**Roll back any flag:** flip to 0 in admin/Railway. Cron stops firing on next tick. No DB cleanup needed.

---

## Why this runbook exists

The wave-181.80 admin dashboard tile flags this state to surface it on every admin load. But the dashboard doesn't tell the full story — this doc does.

Each gate was set conservatively in earlier waves before the safety stack existed. Now that the safety stack is in place (5 waves of audit fixes + 5 production migrations + 4 audit-pass reviews), the gates are obsolete defense. Flipping them is the highest-leverage move available without writing more code.
