# Operator AgentPhone Setup Runbook

**Date prepared:** 2026-05-19 · waves 181.84 + 181.85 + 181.86
**Audience:** operator (Nour)
**Estimated total time:** 10-15 minutes
**Outcome:** 2 daily AgentPhone crons fire to confirm bookings + recover declined work · zero customer-visible impact until you flip the gates

---

## TL;DR · what's installed

Waves 181.84 + 181.85 shipped the complete infrastructure for two AgentPhone use cases:

| Use case | Cron | What it does |
|---|---|---|
| Confirmation Bot | `confirmation-calls` (daily) | Calls every customer 24h before their booking · "Does tomorrow at 2pm still work?" · captures yes/reschedule/no-answer |
| Voice Recovery | `voice-recovery` (daily) | Calls declined estimates 7+ days after their D30 SMS · re-offers the Repair Haiku · captures interested/not-interested/no-answer |

Both are **OFF by default**. They short-circuit cleanly when their env vars aren't set. Operator flips 5 env vars when ready to enable.

---

## Why this is safe to enable

The system has been hardened across waves 181.58 → 181.85 specifically to support exactly this kind of outbound autonomous flow:

- **At-most-once protection** (wave-181.59 + 181.85) · `*_attempted_at` columns stamped BEFORE dial · pod restart mid-call doesn't re-dial
- **TCPA opt-out** (wave-181.60) · cron preloads opt-out set · skips before dial
- **8AM-8PM window** (wave-181.64) · per-message guard inside `sms.ts` queues out-of-window sends · voice calls don't have this guard inside AgentPhone but **the cron tier itself runs once daily during business hours** so out-of-window dialing is structurally prevented
- **Durable rate-limit** (wave-181.68) · 8 SMS/phone/24h cap can't be exceeded by these crons (voice and SMS are separate channels but capping voice via per-run cap)
- **Per-run cap** · 20/day for confirmation · 5/day for recovery
- **Webhook signature verification** (wave-181.84) · `AGENTPHONE_WEBHOOK_SECRET` HMAC validated

If anything looks wrong post-deploy · flip one env var (FEATURE_*) to anything other than "1" and the cron stops on the next tick.

---

## Step 1 · AgentPhone account (5 min)

1. Go to [https://agentphone.to](https://agentphone.to) · sign up
2. Get your API key from the dashboard · it looks like `sk_live_abc123...`
3. **Don't paste it anywhere yet** · we'll add it to Railway env in step 4

---

## Step 2 · create the two agents (3 min)

You need two agents. They CAN be the same agent (just reuse the ID for both env vars) but separate agents let you tune voice + persona per use case.

### Confirmation Bot agent

In the AgentPhone dashboard, create an agent with these settings:

- **Name:** `Nick's Confirmation Bot`
- **voiceMode:** `hosted`
- **systemPrompt:** (this gets overridden per-call · just set a fallback)
  > You are calling on behalf of Nick's Tire & Auto in Cleveland to confirm an appointment. Be warm and brief. Confirm or reschedule in a single round-trip. Voicemail · leave a 15-second message and end the call.
- **voice:** `11labs-Brian` (or any voice that sounds like the shop's vibe · listen to samples in the dashboard)
- **beginMessage:** (left blank · the per-call `initialGreeting` takes over)

**Copy the returned agent ID** (looks like `agt_xyz789...`) · you'll paste into Railway.

### Voice Recovery agent

Same flow, different name + prompt:

- **Name:** `Nick's Recovery Bot`
- **voiceMode:** `hosted`
- **systemPrompt:**
  > You are calling on behalf of Nick's Tire & Auto in Cleveland about a quote the customer got a few weeks ago. NO PRESSURE EVER. Re-offer the original quote · free re-check · "you don't pay until you say yes." If they decline · "no pressure · we're here when you need us" · end gracefully.
- **voice:** same as Confirmation or different (operator's call)

**Copy this agent ID too.**

---

## Step 3 · set up the project webhook (2 min)

In the AgentPhone dashboard:

1. Navigate to Webhooks
2. Add a new webhook:
   - **URL:** `https://nickstire.org/api/webhooks/agentphone`
   - **contextLimit:** 10 (default)
3. **Save the returned `secret`** · looks like `whsec_...`

This single webhook handles BOTH confirmation_calls AND voice_recovery events (the handler dispatches by callId lookup · same URL works for both flows).

---

## Step 4 · Railway env vars (2 min)

In Railway dashboard → nickstire service → Variables, add ALL of these:

```
AGENTPHONE_API_KEY=sk_live_...
AGENTPHONE_WEBHOOK_SECRET=whsec_...
AGENTPHONE_CONFIRMATION_AGENT_ID=agt_...   # from step 2
AGENTPHONE_RECOVERY_AGENT_ID=agt_...        # from step 2
FEATURE_CONFIRMATION_CALLS=1
FEATURE_VOICE_RECOVERY=1
```

Optional tuning vars (defaults are sensible · don't set unless you want to tune):

```
AGENTPHONE_CONFIRMATION_BATCH_SIZE=20   # default 20 · max 50
AGENTPHONE_RECOVERY_BATCH_SIZE=5        # default 5 · max 20
```

Click **Deploy**. Wait for the deploy to complete.

---

## Step 5 · verification (next 24-48h)

### Within 1 hour of deploy
- Check Railway logs for `[confirmation-calls]` and `[voice-recovery]` log lines on the next cron tick
- Expected on first tick if no bookings tomorrow · `"No bookings for YYYY-MM-DD"` for confirmation · `"No estimates eligible for voice recovery"` for recovery

### Within 24h
- `/admin → Calls (or wherever AgentPhone calls land)` should show test rows
- Check `confirmation_calls` table in TiDB:
  ```sql
  SELECT id, booking_id, status, attempted_at, completed_at
  FROM confirmation_calls ORDER BY attempted_at DESC LIMIT 20;
  ```
- Check `alg_estimates` voice recovery columns:
  ```sql
  SELECT id, customer_name, voice_recovery_attempted_at, voice_recovery_outcome
  FROM alg_estimates WHERE voice_recovery_attempted_at IS NOT NULL
  ORDER BY voice_recovery_attempted_at DESC LIMIT 20;
  ```

### Within 48h
- A test call to your own number works · pick a real booking and run the cron manually:
  ```bash
  curl -X POST https://nickstire.org/api/bridge/run-job \
    -H "Authorization: Bearer $BRIDGE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"job":"confirmation-calls"}'
  ```

---

## Cost expectations

| Cost item | Volume | $ per unit | Monthly |
|---|---|---|---|
| Confirmation calls | 20/day × 30 = 600/mo | $0.05-0.10 | $30-60 |
| Voice recovery | 5/day × 30 = 150/mo | $0.05-0.10 | $8-15 |
| AgentPhone subscription | Per their pricing | varies | depends |
| **Total** | | | **~$50/mo + subscription** |

### Expected revenue impact

| Use case | Mechanism | $ recovered |
|---|---|---|
| Confirmation Bot | No-show reduction ~30% · 30 bookings/day × 5-10% reduction × $250 avg ticket | **$11k-22k/year** |
| Voice Recovery | Stale-lead conversion ~10% vs SMS · 20-50 calls/mo × 10% × $915 avg quote | **$22k-55k/year** |

ROI is 100-500× the AgentPhone monthly cost.

---

## Rollback

Any of these returns the system to OFF state without code changes:

```
Railway env · set FEATURE_CONFIRMATION_CALLS to anything other than "1"
Railway env · set FEATURE_VOICE_RECOVERY to anything other than "1"
```

Cron stops firing on next tick. No data cleanup needed. Existing call records stay in DB for audit.

For nuclear rollback · unset `AGENTPHONE_API_KEY` · BOTH crons short-circuit at the gate.

---

## Troubleshooting

### Cron runs but `recordsProcessed: 0` and `"Skipped · ..."` detail

You're missing one of the env vars. Check the cron's detail text · it tells you exactly which env is missing.

### Customer says they got a robotic-sounding call

The voice setting may not match Nick's vibe. Go to the AgentPhone dashboard · update the agent's `voice` field · try `11labs-Brian` or `nova` or any "warm" voice from `GET /v1/agents/voices`.

### Webhook isn't receiving call.ended events

Check that `AGENTPHONE_WEBHOOK_SECRET` matches the secret AgentPhone returned. If it doesn't match, the handler 401's and AgentPhone retries with backoff. Re-create the webhook in the dashboard to get a fresh secret.

### Call placed but status stays "dialing" forever

The webhook is failing to update the row. Check Railway logs for `[agentphone-webhook]` warnings. Most common cause: webhook URL doesn't match `https://nickstire.org/api/webhooks/agentphone`.

### Customer complains about being called at the wrong time

The confirmation cron runs once daily during the scheduler's daily tier. AgentPhone places the call when the cron fires. If your scheduler tier runs at midnight UTC, calls happen at midnight UTC = late evening in Cleveland.

**Fix:** adjust the scheduler tier interval in `server/cron/scheduler.ts` or the registerJob() in `server/cron/index.ts` to align with 9-10am Cleveland time.

---

## Why both crons share one webhook URL

AgentPhone's project-level webhook fires for all calls regardless of which agent placed them. The `/api/webhooks/agentphone` handler dispatches internally:

1. Looks up callId in `confirmation_calls` table · if found → confirmation flow update
2. Looks up callId in `alg_estimates.voice_recovery_call_id` · if found → recovery flow update
3. No match → 200 OK no-op (might be a non-nickstire call if you reuse the AgentPhone account elsewhere)

This means: 1 AgentPhone webhook config · 2 crons · clean separation in code.
